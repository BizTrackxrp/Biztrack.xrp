// api/check-limits.js - SIMPLE VERSION FOR DEBUGGING
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

// Tier limits
const LIMITS = {
  free: 100,
  essential: 5000,
  scale: 25000,
  enterprise: 100000
};

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    // Get auth token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    // Get user
    const result = await pool.query(
      'SELECT subscription_tier, qr_codes_used_this_month FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];
    const tier = user.subscription_tier || 'free';
    const qrLimit = LIMITS[tier] || 100;
    const qrCodesUsed = user.qr_codes_used_this_month || 0;

    return res.status(200).json({
      success: true,
      subscription: {
        tier: tier,
        status: 'active'
      },
      limits: {
        qrLimit: qrLimit,
        maxBatchSize: 100
      },
      usage: {
        qrCodesUsed: qrCodesUsed,
        remaining: qrLimit - qrCodesUsed
      },
      canMint: qrCodesUsed < qrLimit
    });

  } catch (error) {
    console.error('Check limits error:', error);
    return res.status(500).json({
      error: 'Failed to check limits',
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
