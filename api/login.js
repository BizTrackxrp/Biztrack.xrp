// api/refresh-token.js - Refresh JWT Token
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';
const TOKEN_EXPIRY = '7d'; // 7 days

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get current token from header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const oldToken = authHeader.split(' ')[1];

    // Verify old token (even if expired, we can still decode it)
    let decoded;
    try {
      decoded = jwt.verify(oldToken, JWT_SECRET);
    } catch (error) {
      // If token is expired, try to decode without verification
      if (error.name === 'TokenExpiredError') {
        decoded = jwt.decode(oldToken);
      } else {
        return res.status(401).json({ error: 'Invalid token' });
      }
    }

    if (!decoded || !decoded.userId) {
      return res.status(401).json({ error: 'Invalid token payload' });
    }

    // Verify user still exists in database
    const result = await pool.query(
      'SELECT id, email FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];

    // Generate new token with fresh expiry
    const newToken = jwt.sign(
      {
        userId: user.id,
        email: user.email
      },
      JWT_SECRET,
      { expiresIn: TOKEN_EXPIRY }
    );

    console.log(`Token refreshed for user ${user.email}`);

    return res.status(200).json({
      success: true,
      token: newToken,
      expiresIn: TOKEN_EXPIRY
    });

  } catch (error) {
    console.error('Token refresh error:', error);
    return res.status(500).json({
      error: 'Token refresh failed',
      details: error.message
    });
  }
};
