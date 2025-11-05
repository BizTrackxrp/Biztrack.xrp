// api/check-limits.js - FIXED WITH CORRECT COLUMN NAMES
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

const LIMITS = {
  free: 10,
  essential: 500,
  scale: 2500,
  enterprise: 10000
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

    // Get user - USING CORRECT COLUMN NAMES
    const result = await pool.query(
      'SELECT id, email, subscription_tier, qr_codes_used, qr_codes_limit FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];
    const tier = user.subscription_tier || 'free';
    
    // Use qr_codes_limit from DB if set, otherwise use tier default
    const qrLimit = user.qr_codes_limit || LIMITS[tier] || 10;
    const qrCodesUsed = user.qr_codes_used || 0;

    return res.status(200).json({
      success: true,
      subscription: {
        tier: tier,
        status: 'active'
      },
      limits: {
        qrLimit: qrLimit,
        maxBatchSize: tier === 'enterprise' ? 1000 : tier === 'scale' ? 500 : tier === 'essential' ? 100 : 10
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
