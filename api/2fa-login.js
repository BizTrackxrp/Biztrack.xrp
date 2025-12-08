// api/2fa-login.js
// Consolidated 2FA login endpoint - handles sending code and verifying during login

import { getDatabase } from '../lib/database.js';
import { Resend } from 'resend';
import { authenticator } from 'otplib';
import jwt from 'jsonwebtoken';

const resend = new Resend(process.env.RESEND_API_KEY);

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action, email, tempToken, code } = req.body;

  // Verify temp token (issued after password check)
  let decoded;
  try {
    decoded = jwt.verify(tempToken, process.env.JWT_SECRET);
    if (decoded.email !== email || !decoded.pending2FA) {
      return res.status(401).json({ error: 'Invalid session' });
    }
  } catch (err) {
    return res.status(401).json({ error: 'Session expired. Please login again.' });
  }

  const db = await getDatabase();
  const userRecord = await db.collection('users').findOne({ email });

  if (!userRecord) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (!userRecord.twoFactorEnabled) {
    return res.status(400).json({ error: '2FA is not enabled for this account' });
  }

  // =============================================
  // ACTION: send-code (send email code during login)
  // =============================================
  if (action === 'send-code') {
    if (userRecord.twoFactorMethod !== 'email') {
      return res.status(200).json({ success: true, message: 'Use your authenticator app' });
    }

    const newCode = generateCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await db.collection('users').updateOne(
      { email },
      { $set: { twoFactorCode: newCode, twoFactorCodeExpires: expiresAt } }
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

    if (userRecord.twoFactorMethod === 'email') {
      if (!userRecord.twoFactorCode || new Date() > new Date(userRecord.twoFactorCodeExpires)) {
        return res.status(400).json({ error: 'Code expired. Please request a new one.' });
      }
      isValid = userRecord.twoFactorCode === code;

      // Clear used code
      if (isValid) {
        await db.collection('users').updateOne(
          { email },
          { $set: { twoFactorCode: null, twoFactorCodeExpires: null } }
        );
      }
    } else if (userRecord.twoFactorMethod === 'totp') {
      if (!userRecord.twoFactorSecret) {
        return res.status(400).json({ error: 'TOTP not configured properly' });
      }
      isValid = authenticator.verify({ token: code, secret: userRecord.twoFactorSecret });
    }

    if (!isValid) {
      return res.status(400).json({ error: 'Invalid verification code' });
    }

    // Issue full auth token
    const token = jwt.sign(
      {
        userId: userRecord._id.toString(),
        email: userRecord.email,
        tier: userRecord.tier || 'free'
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Update last login
    await db.collection('users').updateOne(
      { email },
      { $set: { lastLogin: new Date() } }
    );

    return res.status(200).json({
      success: true,
      token,
      user: {
        email: userRecord.email,
        companyName: userRecord.companyName,
        tier: userRecord.tier || 'free'
      }
    });
  }

  return res.status(400).json({ error: 'Invalid action' });
}
