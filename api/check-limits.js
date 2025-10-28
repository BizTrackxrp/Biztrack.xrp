// api/check-limits.js - Check User QR Code Limits (FIXED VERSION)
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
    const userResult = await pool.query(
      'SELECT id, email, company_name, subscription_tier, qr_codes_limit, billing_cycle_start, created_at FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    // Check if billing cycle needs reset (30 days)
    const now = new Date();
    const billingStart = user.billing_cycle_start ? new Date(user.billing_cycle_start) : new Date(user.created_at);
    const daysSinceStart = Math.floor((now - billingStart) / (1000 * 60 * 60 * 24));

    let actualBillingStart = billingStart;
    let needsReset = false;

    if (daysSinceStart >= 30) {
      // Reset billing cycle
      await pool.query(
        `UPDATE users 
         SET billing_cycle_start = NOW()
         WHERE id = $1`,
        [user.id]
      );
      actualBillingStart = now;
      needsReset = true;
    }

    // COUNT ACTUAL PRODUCTS MINTED IN CURRENT BILLING CYCLE
    // This is the SOURCE OF TRUTH - never trust stored counters!
    const countResult = await pool.query(
      `SELECT COUNT(*) as product_count 
       FROM products 
       WHERE user_id = $1 
       AND created_at >= $2`,
      [user.id, actualBillingStart]
    );

    const actualQrCodesUsed = parseInt(countResult.rows[0].product_count) || 0;

    // Update the stored value to match reality (for future reference)
    await pool.query(
      'UPDATE users SET qr_codes_used = $1 WHERE id = $2',
      [actualQrCodesUsed, user.id]
    );

    const tierConfig = stripeConfig.getTierConfig(user.subscription_tier);
    const qrLimit = user.qr_codes_limit || tierConfig.qrLimit;
    const remaining = qrLimit - actualQrCodesUsed;
    const percentUsed = Math.round((actualQrCodesUsed / qrLimit) * 100);

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
        qrCodesUsed: actualQrCodesUsed,
        qrCodesLimit: qrLimit,
        qrCodesRemaining: remaining,
        percentUsed: percentUsed,
        billingCycleStart: actualBillingStart,
        daysInCycle: daysSinceStart,
        needsReset: needsReset,
        maxBatchSize: Math.min(qrLimit, 100) // Max 100 per batch, or tier limit if lower
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
