const { Pool } = require('pg');
const { Resend } = require('resend');
const crypto = require('crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const resend = new Resend(process.env.RESEND_API_KEY);

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Find user
    const userResult = await pool.query(
      'SELECT id, email FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    // Always return success even if user doesn't exist (security best practice)
    if (userResult.rows.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'If an account exists with that email, you will receive a password reset link.'
      });
    }

    const user = userResult.rows[0];

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 3600000); // 1 hour from now

    // Save reset token
    await pool.query(
      `INSERT INTO password_resets (user_id, reset_token, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, resetToken, expiresAt]
    );

    // Send email
    const resetUrl = `https://www.biztrack.io/reset-password.html?token=${resetToken}`;

    await resend.emails.send({
      from: 'BizTrack <onboarding@resend.dev>', // Change this to your verified domain later
      to: user.email,
      subject: 'Reset Your BizTrack Password',
      html: `
        <h2>Password Reset Request</h2>
        <p>You requested to reset your password for BizTrack.</p>
        <p>Click the link below to reset your password (link expires in 1 hour):</p>
        <p><a href="${resetUrl}">${resetUrl}</a></p>
        <p>If you didn't request this, you can safely ignore this email.</p>
        <br>
        <p>- The BizTrack Team</p>
      `
    });

    return res.status(200).json({
      success: true,
      message: 'If an account exists with that email, you will receive a password reset link.'
    });

  } catch (error) {
    console.error('Password reset request error:', error);
    return res.status(500).json({
      error: 'Failed to process password reset request',
      details: error.message
    });
  }
};
