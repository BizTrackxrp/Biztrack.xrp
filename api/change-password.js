// api/change-password.js - Change user password with validation
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { sendPasswordChangeEmail } = require('../js/email-service.js');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

// ==========================================
// PASSWORD VALIDATION (MATCHES FRONTEND)
// ==========================================
function validatePassword(password) {
  const errors = [];
  
  // Length check
  if (password.length < 8) {
    errors.push('Password must be at least 8 characters');
  }
  
  // Uppercase check
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  
  // Lowercase check
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  
  // Number check
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  
  // Special character check (only allowed chars)
  const allowedSpecialChars = '!@#$%^&*-_=+';
  const specialCharRegex = new RegExp(`[${allowedSpecialChars.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')}]`);
  if (!specialCharRegex.test(password)) {
    errors.push(`Password must contain at least one special character (${allowedSpecialChars})`);
  }
  
  // No spaces
  if (/\s/.test(password)) {
    errors.push('Password cannot contain spaces');
  }
  
  return {
    valid: errors.length === 0,
    errors: errors
  };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false,
      error: 'Method not allowed' 
    });
  }

  try {
    // Get user from JWT token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        success: false,
        error: 'Unauthorized' 
      });
    }

    const token = authHeader.split(' ')[1];
    let decoded;
    
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ 
        success: false,
        error: 'Invalid or expired token' 
      });
    }

    const { currentPassword, newPassword } = req.body;

    // Validation
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ 
        success: false,
        error: 'Current password and new password are required' 
      });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({ 
        success: false,
        error: 'New password must be different from current password' 
      });
    }

    // Validate new password strength
    const passwordValidation = validatePassword(newPassword);
    if (!passwordValidation.valid) {
      return res.status(400).json({ 
        success: false,
        error: passwordValidation.errors[0],
        validationErrors: passwordValidation.errors
      });
    }

    // Get user from database
    const userResult = await pool.query(
      'SELECT id, email, password_hash, company_name FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ 
        success: false,
        error: 'User not found' 
      });
    }

    const user = userResult.rows[0];

    // Verify current password
    const passwordMatch = await bcrypt.compare(currentPassword, user.password_hash);
    
    if (!passwordMatch) {
      return res.status(401).json({ 
        success: false,
        error: 'Current password is incorrect' 
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password in database
    await pool.query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [hashedPassword, user.id]
    );

    console.log('✅ Password changed successfully for user:', user.email);

    // Send email notification about password change
    if (process.env.RESEND_API_KEY) {
      try {
        await sendPasswordChangeEmail(user.email, user.company_name);
        console.log('📧 Password change email sent to:', user.email);
      } catch (emailError) {
        console.error('⚠️ Failed to send password change email:', emailError);
        // Don't fail the password change if email fails
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    console.error('❌ Change password error:', error);
    
    return res.status(500).json({
      success: false,
      error: 'Failed to change password',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
