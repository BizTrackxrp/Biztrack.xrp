// api/register.js - User registration with business type support and strong password validation
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
});

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
  
  // Check for invalid special characters
  const invalidChars = password.replace(/[a-zA-Z0-9]/g, '').replace(new RegExp(`[${allowedSpecialChars.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')}]`, 'g'), '');
  if (invalidChars.length > 0) {
    errors.push(`Password contains invalid characters: ${invalidChars.split('').join(', ')}`);
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
    const { email, password, companyName, businessType } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({ 
        success: false,
        error: 'Email and password are required' 
      });
    }

    if (!businessType || !['general', 'pharma'].includes(businessType)) {
      return res.status(400).json({ 
        success: false,
        error: 'Valid business type is required (general or pharma)' 
      });
    }

    // ✅ STRONG PASSWORD VALIDATION
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      return res.status(400).json({ 
        success: false,
        error: passwordValidation.errors[0], // Return first error
        validationErrors: passwordValidation.errors // Return all errors
      });
    }

    // Check if user already exists
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ 
        success: false,
        error: 'Email already registered' 
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert new user with business_type
    const result = await pool.query(
      `INSERT INTO users (
        email, 
        password_hash, 
        company_name, 
        business_type,
        subscription_tier,
        qr_codes_limit,
        qr_codes_used,
        created_at
      ) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) 
      RETURNING id, email, company_name, business_type`,
      [
        email.toLowerCase(),
        hashedPassword,
        companyName || null,
        businessType,
        'free',
        10,
        0
      ]
    );

    const newUser = result.rows[0];

    console.log('✅ User registered successfully:', {
      id: newUser.id,
      email: newUser.email,
      businessType: newUser.business_type,
      companyName: newUser.company_name
    });

    return res.status(201).json({
      success: true,
      message: 'User registered successfully',
      user: {
        id: newUser.id,
        email: newUser.email,
        companyName: newUser.company_name,
        businessType: newUser.business_type
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    
    // Handle specific database errors
    if (error.code === '23505') {
      return res.status(400).json({
        success: false,
        error: 'Email already registered'
      });
    }
    
    if (error.code === '42703') {
      return res.status(500).json({
        success: false,
        error: 'Database configuration error - please contact support'
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Registration failed',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
  
  // ✅ NO pool.end() - Keep connection pool alive for serverless functions!
};
