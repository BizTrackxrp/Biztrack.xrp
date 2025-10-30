// api/test-set-tier.js
// ⚠️ DELETE THIS FILE BEFORE PRODUCTION ⚠️
// This is for TESTING ONLY - allows manual tier changes without Stripe

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

    const { tier } = req.body;

    // Validate tier
    if (!['free', 'essential', 'scale', 'enterprise'].includes(tier)) {
      return res.status(400).json({ error: 'Invalid tier' });
    }

    // Update user's tier
    await pool.query(
      'UPDATE users SET subscription_tier = $1, updated_at = NOW() WHERE id = $2',
      [tier, decoded.userId]
    );

    console.log(`[TEST] User ${decoded.userId} tier changed to: ${tier}`);

    return res.status(200).json({
      success: true,
      tier: tier,
      message: `Tier changed to ${tier} (TEST MODE ONLY)`
    });

  } catch (error) {
    console.error('Test set tier error:', error);
    return res.status(500).json({
      error: 'Failed to set tier',
      details: error.message
    });
  }
};
