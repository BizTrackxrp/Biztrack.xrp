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
    const { email, password, companyName } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
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

    // Create user
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, company_name)
       VALUES ($1, $2, $3)
       RETURNING id, email, company_name, created_at`,
      [email.toLowerCase(), passwordHash, companyName || null]
    );

    const user = result.rows[0];

    return res.status(201).json({
      success: true,
      message: 'Account created successfully',
      user: {
        id: user.id,
        email: user.email,
        companyName: user.company_name
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({
      error: 'Registration failed',
      details: error.message
    });
  }
};
