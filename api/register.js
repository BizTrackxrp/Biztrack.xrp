const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, password, companyName, businessType } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // NEW: Validate business type
    if (!businessType || !['general', 'pharma'].includes(businessType)) {
      return res.status(400).json({ error: 'Valid business type is required (general or pharma)' });
    }

    // Check if user already exists
    const existing = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user with business type
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, company_name, business_type, subscription_tier, qr_codes_used, qr_codes_limit)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, email, company_name, business_type, subscription_tier, qr_codes_used, qr_codes_limit, created_at`,
      [
        email.toLowerCase(), 
        passwordHash, 
        companyName || null,
        businessType, // NEW: Store business type
        'free', // Default subscription tier
        0, // Initial QR codes used
        10 // Free tier limit (10 QR codes)
      ]
    );

    const user = result.rows[0];

    return res.status(201).json({
      success: true,
      message: 'Account created successfully',
      user: {
        id: user.id,
        email: user.email,
        companyName: user.company_name,
        businessType: user.business_type,
        subscriptionTier: user.subscription_tier,
        qrCodesLimit: user.qr_codes_limit
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    
    // Check if error is due to missing column (database schema needs updating)
    if (error.message.includes('business_type') || error.message.includes('column')) {
      return res.status(500).json({
        error: 'Database schema update required',
        details: 'The business_type column needs to be added to the users table. Please run the database migration.',
        technicalDetails: error.message
      });
    }
    
    return res.status(500).json({
      error: 'Registration failed',
      details: error.message
    });
  }
};
