// api/2fa-setup.js
// Consolidated 2FA setup endpoint - handles status, enable, and disable

import { verifyToken } from '../lib/auth.js';
import { getDatabase } from '../lib/database.js';
import { Resend } from 'resend';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';

const resend = new Resend(process.env.RESEND_API_KEY);

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export default async function handler(req, res) {
  const user = verifyToken(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = await getDatabase();
  const userRecord = await db.collection('users').findOne({ email: user.email });

  if (!userRecord) {
    return res.status(404).json({ error: 'User not found' });
  }

  // GET - Check 2FA status
  if (req.method === 'GET') {
    return res.status(200).json({
      success: true,
      enabled: userRecord.twoFactorEnabled || false,
      method: userRecord.twoFactorMethod || null
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

      await db.collection('users').updateOne(
        { email: user.email },
        { $set: { twoFactorCode: newCode, twoFactorCodeExpires: expiresAt } }
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
        if (!userRecord.twoFactorCode || new Date() > new Date(userRecord.twoFactorCodeExpires)) {
          return res.status(400).json({ error: 'Code expired. Please request a new one.' });
        }
        isValid = userRecord.twoFactorCode === code;
      } else if (method === 'totp') {
        if (!secret) {
          return res.status(400).json({ error: 'Secret required for TOTP' });
        }
        isValid = authenticator.verify({ token: code, secret: secret });
      }

      if (!isValid) {
        return res.status(400).json({ error: 'Invalid verification code' });
      }

      const updateData = {
        twoFactorEnabled: true,
        twoFactorMethod: method,
        twoFactorEnabledAt: new Date(),
        twoFactorCode: null,
        twoFactorCodeExpires: null
      };

      if (method === 'totp') {
        updateData.twoFactorSecret = secret;
      }

      await db.collection('users').updateOne({ email: user.email }, { $set: updateData });

      return res.status(200).json({ success: true, message: '2FA enabled successfully' });
    }

    // =============================================
    // ACTION: disable (verify code and disable 2FA)
    // =============================================
    if (action === 'disable') {
      if (!userRecord.twoFactorEnabled) {
        return res.status(400).json({ error: '2FA is not enabled' });
      }

      if (!code || code.length !== 6) {
        return res.status(400).json({ error: 'Invalid code format' });
      }

      let isValid = false;

      if (userRecord.twoFactorMethod === 'email') {
        if (!userRecord.twoFactorCode || new Date() > new Date(userRecord.twoFactorCodeExpires)) {
          return res.status(400).json({ error: 'Code expired. Please request a new one.' });
        }
        isValid = userRecord.twoFactorCode === code;
      } else if (userRecord.twoFactorMethod === 'totp') {
        isValid = authenticator.verify({ token: code, secret: userRecord.twoFactorSecret });
      }

      if (!isValid) {
        return res.status(400).json({ error: 'Invalid verification code' });
      }

      await db.collection('users').updateOne(
        { email: user.email },
        {
          $set: {
            twoFactorEnabled: false,
            twoFactorMethod: null,
            twoFactorSecret: null,
            twoFactorCode: null,
            twoFactorCodeExpires: null,
            twoFactorDisabledAt: new Date()
          }
        }
      );

      return res.status(200).json({ success: true, message: '2FA disabled successfully' });
    }

    return res.status(400).json({ error: 'Invalid action' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
