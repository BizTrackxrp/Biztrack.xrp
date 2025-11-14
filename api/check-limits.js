// api/check-limits.js - WITH PHARMA TIERS
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

// UPDATED: Added pharma tiers
const LIMITS = {
  free: 10,
  essential: 500,
  scale: 2500,
  enterprise: 10000,
  compliance: 10000,           // NEW PHARMA TIER
  pharma_enterprise: 50000     // NEW PHARMA TIER
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

    // Get user - including business_type and pharma flags
    const result = await pool.query(
      'SELECT id, email, subscription_tier, qr_codes_used, qr_codes_limit, business_type, is_pharma FROM users WHERE id = $1',
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

    // Determine max batch size based on tier
    let maxBatchSize = 10;
    if (tier === 'pharma_enterprise') maxBatchSize = 5000;
    else if (tier === 'compliance') maxBatchSize = 1000;
    else if (tier === 'enterprise') maxBatchSize = 1000;
    else if (tier === 'scale') maxBatchSize = 500;
    else if (tier === 'essential') maxBatchSize = 100;

    return res.status(200).json({
      success: true,
      subscription: {
        tier: tier,
        status: 'active',
        businessType: user.business_type || 'general',
        isPharma: user.is_pharma || false
      },
      limits: {
        qrLimit: qrLimit,
        maxBatchSize: maxBatchSize
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
```
