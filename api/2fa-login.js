// api/2fa-login.js
// Consolidated 2FA login endpoint - handles sending code and verifying during login
// Uses PostgreSQL

const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { Resend } = require('resend');
const { authenticator } = require('otplib');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const resend = new Resend(process.env.RESEND_API_KEY);
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action, email, tempToken, code } = req.body;

  // Verify temp token (issued after password check)
  let decoded;
  try {
    decoded = jwt.verify(tempToken, JWT_SECRET);
    if (decoded.email !== email || !decoded.pending2FA) {
      return res.status(401).json({ error: 'Invalid session' });
    }
  } catch (err) {
    return res.status(401).json({ error: 'Session expired. Please login again.' });
  }

  // Find user
  const userResult = await pool.query(
    'SELECT * FROM users WHERE email = $1',
    [email]
  );

  if (userResult.rows.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }

  const userRecord = userResult.rows[0];

  if (!userRecord.two_factor_enabled) {
    return res.status(400).json({ error: '2FA is not enabled for this account' });
  }

  // =============================================
  // ACTION: send-code (send email code during login)
  // =============================================
  if (action === 'send-code') {
    if (userRecord.two_factor_method !== 'email') {
      return res.status(200).json({ success: true, message: 'Use your authenticator app' });
    }

    const newCode = generateCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await pool.query(
      'UPDATE users SET two_factor_code = $1, two_factor_code_expires = $2 WHERE email = $3',
      [newCode, expiresAt, email]
    );

    await resend.emails.send({
      from: 'BizTrack <info@biztrack.io>',
      to: email,
      subject: 'Your BizTrack Login Code',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #1E293B; font-size: 24px;">🚚 BizTrack</h1>
          </div>
          <div style="background: #F8FAFC; border-radius: 16px; padding: 30px; text-align: center;">
            <h2 style="color: #1E293B; margin-bottom: 10px;">Login Verification Code</h2>
            <p style="color: #64748B; margin-bottom: 20px;">Enter this code to complete your login:</p>
            <div style="background: linear-gradient(135deg, #4F46E5, #7C3AED); color: white; font-size: 32px; font-weight: 800; letter-spacing: 8px; padding: 20px 40px; border-radius: 12px; display: inline-block;">
              ${newCode}
            </div>
            <p style="color: #64748B; font-size: 14px; margin-top: 20px;">Expires in <strong>10 minutes</strong></p>
          </div>
          <p style="color: #94A3B8; font-size: 12px; text-align: center; margin-top: 30px;">
            If you didn't try to log in, please secure your account immediately.
          </p>
        </div>
      `
    });

    return res.status(200).json({ success: true, message: 'Code sent' });
  }

  // =============================================
  // ACTION: verify (verify code and complete login)
  // =============================================
  if (action === 'verify') {
    if (!code || code.length !== 6) {
      return res.status(400).json({ error: 'Invalid code format' });
    }

    let isValid = false;

    if (userRecord.two_factor_method === 'email') {
      if (!userRecord.two_factor_code || new Date() > new Date(userRecord.two_factor_code_expires)) {
        return res.status(400).json({ error: 'Code expired. Please request a new one.' });
      }
      isValid = userRecord.two_factor_code === code;

      // Clear used code
      if (isValid) {
        await pool.query(
          'UPDATE users SET two_factor_code = NULL, two_factor_code_expires = NULL WHERE email = $1',
          [email]
        );
      }
    } else if (userRecord.two_factor_method === 'totp') {
      if (!userRecord.two_factor_secret) {
        return res.status(400).json({ error: 'TOTP not configured properly' });
      }
      isValid = authenticator.verify({ token: code, secret: userRecord.two_factor_secret });
    }

    if (!isValid) {
      return res.status(400).json({ error: 'Invalid verification code' });
    }

    // Issue full auth token
    const token = jwt.sign(
      {
        userId: userRecord.id,
        email: userRecord.email,
        businessType: userRecord.business_type
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Update last login
    await pool.query(
      'UPDATE users SET last_login = NOW() WHERE email = $1',
      [email]
    );

    // Create session record (same as regular login)
    try {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      await pool.query(
        `INSERT INTO sessions (
          user_id,
          token_hash,
          device_name,
          ip_address,
          user_agent,
          created_at,
          last_active
        ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
        [userRecord.id, tokenHash, '2FA Login', 'Unknown', '']
      );
    } catch (sessionError) {
      console.error('[2FA-LOGIN] Session creation failed:', sessionError);
    }

    return res.status(200).json({
      success: true,
      token,
      user: {
        id: userRecord.id,
        email: userRecord.email,
        companyName: userRecord.company_name,
        businessType: userRecord.business_type
      }
    });
  }

  return res.status(400).json({ error: 'Invalid action' });
};
