const { Pool } = require('pg');
const crypto = require('crypto');
const { sendPasswordResetEmail } = require('../js/email-service.js');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

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
      'SELECT id, email, name FROM users WHERE email = $1',
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

    // Send email using professional template
    const resetUrl = `https://www.biztrack.io/reset-password.html?token=${resetToken}`;
    
    if (process.env.RESEND_API_KEY) {
      try {
        await sendPasswordResetEmail(user.email, user.name, resetUrl);
        console.log('📧 Password reset email sent to:', user.email);
      } catch (emailError) {
        console.error('⚠️ Failed to send password reset email:', emailError);
        // Don't fail the request if email fails
      }
    }

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
