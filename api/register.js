// api/register.js - User registration with business type support
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

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

    if (password.length < 8) {
      return res.status(400).json({ 
        success: false,
        error: 'Password must be at least 8 characters' 
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
        qr_codes_used
      ) 
      VALUES ($1, $2, $3, $4, $5, $6, $7) 
      RETURNING id, email, company_name, business_type`,
      [
        email.toLowerCase(),
        hashedPassword,
        companyName || null,
        businessType, // Save business type
        'free', // Default subscription tier
        10, // Free tier limit
        0 // Start with 0 QR codes used
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
    return res.status(500).json({
      success: false,
      error: 'Registration failed',
      details: error.message
    });
  } finally {
    try {
      await pool.end();
    } catch (e) {
      console.error('Pool end error:', e);
    }
  }
};
