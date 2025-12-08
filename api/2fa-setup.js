// api/2fa-setup.js
// Consolidated 2FA setup endpoint - handles status, enable, and disable
// Uses PostgreSQL + AES-256 encryption for TOTP secrets

const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { Resend } = require('resend');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const resend = new Resend(process.env.RESEND_API_KEY);
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';
const TOTP_ENCRYPTION_KEY = process.env.TOTP_ENCRYPTION_KEY || 'default-32-char-key-change-this!'; // Must be 32 chars

// ==========================================
// ENCRYPTION HELPERS (AES-256-GCM)
// ==========================================
function encryptSecret(plaintext) {
  const iv = crypto.randomBytes(16);
  const key = Buffer.from(TOTP_ENCRYPTION_KEY.padEnd(32).slice(0, 32));
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  
  // Format: iv:authTag:encryptedData
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decryptSecret(encryptedData) {
  try {
    const [ivHex, authTagHex, encrypted] = encryptedData.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const key = Buffer.from(TOTP_ENCRYPTION_KEY.padEnd(32).slice(0, 32));
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (err) {
    console.error('[2FA] Failed to decrypt secret:', err.message);
    return null;
  }
}

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Verify JWT token from Authorization header (inline, no external lib)
function verifyToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  try {
    const token = authHeader.split(' ')[1];
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

module.exports = async (req, res) => {
  const user = verifyToken(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Find user in database
  const userResult = await pool.query(
    'SELECT * FROM users WHERE email = $1',
    [user.email]
  );

  if (userResult.rows.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }

  const userRecord = userResult.rows[0];

  // GET - Check 2FA status
  if (req.method === 'GET') {
    return res.status(200).json({
      success: true,
      enabled: userRecord.two_factor_enabled || false,
      method: userRecord.two_factor_method || null
    });
  }

  // POST - Setup, verify, or disable 2FA
  if (req.method === 'POST') {
    const { action, method, code, secret } = req.body;

    // =============================================
    // ACTION: send-code (send email verification code)
    // =============================================
    if (action === 'send-code') {
      const newCode = generateCode();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      await pool.query(
        'UPDATE users SET two_factor_code = $1, two_factor_code_expires = $2 WHERE email = $3',
        [newCode, expiresAt, user.email]
      );

      await resend.emails.send({
        from: 'BizTrack <info@biztrack.io>',
        to: user.email,
        subject: 'Your BizTrack Verification Code',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #1E293B; font-size: 24px;">🚚 BizTrack</h1>
            </div>
            <div style="background: #F8FAFC; border-radius: 16px; padding: 30px; text-align: center;">
              <h2 style="color: #1E293B; margin-bottom: 10px;">Your Verification Code</h2>
              <p style="color: #64748B; margin-bottom: 20px;">Use this code to verify your identity:</p>
              <div style="background: linear-gradient(135deg, #4F46E5, #7C3AED); color: white; font-size: 32px; font-weight: 800; letter-spacing: 8px; padding: 20px 40px; border-radius: 12px; display: inline-block;">
                ${newCode}
              </div>
              <p style="color: #64748B; font-size: 14px; margin-top: 20px;">Expires in <strong>10 minutes</strong></p>
            </div>
          </div>
        `
      });

      return res.status(200).json({ success: true, message: 'Code sent' });
    }

    // =============================================
    // ACTION: setup-totp (generate QR code for authenticator)
    // =============================================
    if (action === 'setup-totp') {
      const newSecret = authenticator.generateSecret();
      const otpauthUrl = authenticator.keyuri(user.email, 'BizTrack', newSecret);
      const qrCode = await QRCode.toDataURL(otpauthUrl, {
        width: 200,
        margin: 2,
        color: { dark: '#1E293B', light: '#FFFFFF' }
      });

      return res.status(200).json({
        success: true,
        secret: newSecret,
        qrCode: qrCode
      });
    }

    // =============================================
    // ACTION: enable (verify code and enable 2FA)
    // =============================================
    if (action === 'enable') {
      if (!code || code.length !== 6) {
        return res.status(400).json({ error: 'Invalid code format' });
      }

      if (!method || !['email', 'totp'].includes(method)) {
        return res.status(400).json({ error: 'Invalid 2FA method' });
      }

      let isValid = false;

      if (method === 'email') {
        if (!userRecord.two_factor_code || new Date() > new Date(userRecord.two_factor_code_expires)) {
          return res.status(400).json({ error: 'Code expired. Please request a new one.' });
        }
        isValid = userRecord.two_factor_code === code;
      } else if (method === 'totp') {
        if (!secret) {
          return res.status(400).json({ error: 'Secret required for TOTP' });
        }
        isValid = authenticator.verify({ token: code, secret: secret });
      }

      if (!isValid) {
        return res.status(400).json({ error: 'Invalid verification code' });
      }

      // Enable 2FA
      if (method === 'totp') {
        // Encrypt the secret before storing
        const encryptedSecret = encryptSecret(secret);
        await pool.query(
          `UPDATE users SET 
            two_factor_enabled = true, 
            two_factor_method = $1, 
            two_factor_secret = $2,
            two_factor_code = NULL,
            two_factor_code_expires = NULL,
            two_factor_enabled_at = NOW()
          WHERE email = $3`,
          [method, encryptedSecret, user.email]
        );
      } else {
        await pool.query(
          `UPDATE users SET 
            two_factor_enabled = true, 
            two_factor_method = $1, 
            two_factor_code = NULL,
            two_factor_code_expires = NULL,
            two_factor_enabled_at = NOW()
          WHERE email = $2`,
          [method, user.email]
        );
      }

      return res.status(200).json({ success: true, message: '2FA enabled successfully' });
    }

    // =============================================
    // ACTION: disable (verify code and disable 2FA)
    // =============================================
    if (action === 'disable') {
      if (!userRecord.two_factor_enabled) {
        return res.status(400).json({ error: '2FA is not enabled' });
      }

      if (!code || code.length !== 6) {
        return res.status(400).json({ error: 'Invalid code format' });
      }

      let isValid = false;

      if (userRecord.two_factor_method === 'email') {
        if (!userRecord.two_factor_code || new Date() > new Date(userRecord.two_factor_code_expires)) {
          return res.status(400).json({ error: 'Code expired. Please request a new one.' });
        }
        isValid = userRecord.two_factor_code === code;
      } else if (userRecord.two_factor_method === 'totp') {
        // Decrypt the secret before verifying
        const decryptedSecret = decryptSecret(userRecord.two_factor_secret);
        if (!decryptedSecret) {
          return res.status(500).json({ error: 'Failed to verify. Please contact support.' });
        }
        isValid = authenticator.verify({ token: code, secret: decryptedSecret });
      }

      if (!isValid) {
        return res.status(400).json({ error: 'Invalid verification code' });
      }

      // Disable 2FA
      await pool.query(
        `UPDATE users SET 
          two_factor_enabled = false, 
          two_factor_method = NULL, 
          two_factor_secret = NULL,
          two_factor_code = NULL,
          two_factor_code_expires = NULL
        WHERE email = $1`,
        [user.email]
      );

      return res.status(200).json({ success: true, message: '2FA disabled successfully' });
    }

    return res.status(400).json({ error: 'Invalid action' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
