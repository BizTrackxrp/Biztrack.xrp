// api/check-limits.js - Check User QR Code Limits
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const stripeConfig = require('../stripe-config');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
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

    // Get user from database
    const result = await pool.query(
      'SELECT id, email, company_name, subscription_tier, qr_codes_used, qr_codes_limit, billing_cycle_start FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];

    // Check if billing cycle needs reset (30 days)
    const now = new Date();
    const billingStart = new Date(user.billing_cycle_start);
    const daysSinceStart = Math.floor((now - billingStart) / (1000 * 60 * 60 * 24));

    let needsReset = false;
    if (daysSinceStart >= 30) {
      // Reset counter
      await pool.query(
        `UPDATE users 
         SET qr_codes_used = 0,
             billing_cycle_start = NOW()
         WHERE id = $1`,
        [user.id]
      );
      user.qr_codes_used = 0;
      user.billing_cycle_start = now;
      needsReset = true;
    }

    const tierConfig = stripeConfig.getTierConfig(user.subscription_tier);
    const remaining = user.qr_codes_limit - user.qr_codes_used;
    const percentUsed = Math.round((user.qr_codes_used / user.qr_codes_limit) * 100);

    // Determine if upgrade is suggested
    const shouldUpgrade = percentUsed >= 80; // Suggest upgrade at 80%
    const nextTier = stripeConfig.getNextTier(user.subscription_tier);

    return res.status(200).json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        companyName: user.company_name
      },
      subscription: {
        tier: user.subscription_tier,
        tierName: tierConfig.name,
        price: tierConfig.price,
        qrCodesUsed: user.qr_codes_used,
        qrCodesLimit: user.qr_codes_limit,
        qrCodesRemaining: remaining,
        percentUsed: percentUsed,
        billingCycleStart: user.billing_cycle_start,
        daysInCycle: daysSinceStart,
        needsReset: needsReset
      },
      limits: {
        canMint: remaining > 0,
        shouldUpgrade: shouldUpgrade,
        nextTier: nextTier,
        nextTierConfig: nextTier ? stripeConfig.getTierConfig(nextTier) : null
      }
    });

  } catch (error) {
    console.error('Check limits error:', error);
    return res.status(500).json({
      error: 'Failed to check limits',
      details: error.message
    });
  }
};
