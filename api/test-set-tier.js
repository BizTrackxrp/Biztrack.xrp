// api/test-set-tier.js
// ⚠️ DELETE THIS FILE BEFORE PRODUCTION ⚠️
// This is for TESTING ONLY - allows manual tier changes without Stripe

const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

const TIER_LIMITS = {
  free: 100,
  essential: 5000,
  scale: 25000,
  enterprise: 100000
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
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

    const { tier } = req.body;

    // Validate tier
    if (!['free', 'essential', 'scale', 'enterprise'].includes(tier)) {
      return res.status(400).json({ 
        error: 'Invalid tier',
        details: `Tier must be one of: free, essential, scale, enterprise. Got: ${tier}`
      });
    }

    // Get current user info
    const currentUserResult = await pool.query(
      'SELECT subscription_tier, qr_codes_used FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (currentUserResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const currentUser = currentUserResult.rows[0];
    const oldTier = currentUser.subscription_tier || 'free';
    const currentUsage = currentUser.qr_codes_used || 0;

    // Update user's tier AND reset QR counter to 0
    // This gives them a fresh start with their new limit!
    const result = await pool.query(
      `UPDATE users 
       SET subscription_tier = $1, 
           qr_codes_limit = $2,
           qr_codes_used = 0
       WHERE id = $3 
       RETURNING *`,
      [tier, TIER_LIMITS[tier], decoded.userId]
    );

    console.log(`[TEST] User ${decoded.userId} upgraded from ${oldTier} to ${tier}`);
    console.log(`[TEST] Counter reset from ${currentUsage} to 0`);
    console.log(`[TEST] New limit: ${TIER_LIMITS[tier]}`);

    return res.status(200).json({
      success: true,
      tier: tier,
      oldTier: oldTier,
      previousUsage: currentUsage,
      message: `Upgraded from ${oldTier.toUpperCase()} to ${tier.toUpperCase()}! Your QR counter has been reset to 0, giving you ${TIER_LIMITS[tier]} fresh QR codes for this billing cycle.`,
      newLimit: TIER_LIMITS[tier],
      user: {
        id: result.rows[0].id,
        email: result.rows[0].email,
        tier: result.rows[0].subscription_tier,
        limit: result.rows[0].qr_codes_limit,
        used: result.rows[0].qr_codes_used
      }
    });

  } catch (error) {
    console.error('Test set tier error:', error);
    return res.status(500).json({
      error: 'Failed to set tier',
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
