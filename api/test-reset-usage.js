// api/test-reset-usage.js
// ⚠️ DELETE THIS FILE BEFORE PRODUCTION ⚠️
// This is for TESTING ONLY - resets QR code usage counter

const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

module.exports = async (req, res) => {
  // ⚠️ TEST ENDPOINT - DELETE BEFORE LAUNCH ⚠️
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get auth token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    // Reset QR code usage to 0
    await pool.query(
      'UPDATE users SET qr_codes_used_this_month = 0, updated_at = NOW() WHERE id = $1',
      [decoded.userId]
    );

    console.log(`[TEST] User ${decoded.userId} usage reset to 0`);

    return res.status(200).json({
      success: true,
      message: 'QR code usage reset to 0 (TEST MODE ONLY)'
    });

  } catch (error) {
    console.error('Test reset usage error:', error);
    return res.status(500).json({
      error: 'Failed to reset usage',
      details: error.message
    });
  }
};
