// api/check-limits.js - Check User QR Code Limits (FIXED VERSION)
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

// Tier configurations (hardcoded since stripe-config might not be available)
const TIER_CONFIG = {
  free: { name: 'Free', price: 0, qrLimit: 100, maxBatchSize: 10 },
  essential: { name: 'Essential', price: 49, qrLimit: 5000, maxBatchSize: 50 },
  scale: { name: 'Scale', price: 149, qrLimit: 25000, maxBatchSize: 100 },
  enterprise: { name: 'Enterprise', price: 399, qrLimit: 100000, maxBatchSize: 1000 }
};

function getTierConfig(tier) {
  return TIER_CONFIG[tier] || TIER_CONFIG.free;
}

function getNextTier(currentTier) {
  const tiers = ['free', 'essential', 'scale', 'enterprise'];
  const currentIndex = tiers.indexOf(currentTier);
  return currentIndex < tiers.length - 1 ? tiers[currentIndex + 1] : null;
}

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

    // Get user from database - only select columns that actually exist
    const userResult = await pool.query(
      'SELECT id, email, company_name, subscription_tier, billing_cycle_start, created_at FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];
    const tier = user.subscription_tier || 'free';

    // Check if billing cycle needs reset (30 days)
    const now = new Date();
    const billingStart = user.billing_cycle_start ? new Date(user.billing_cycle_start) : new Date(user.created_at);
    const daysSinceStart = Math.floor((now - billingStart) / (1000 * 60 * 60 * 24));
    
    let actualBillingStart = billingStart;
    let needsReset = false;

    if (daysSinceStart >= 30) {
      // Reset billing cycle
      await pool.query(
        'UPDATE users SET billing_cycle_start = NOW() WHERE id = $1',
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

    // Update the stored value to match reality (using correct column name)
    await pool.query(
      'UPDATE users SET qr_codes_used_this_month = $1 WHERE id = $2',
      [actualQrCodesUsed, user.id]
    );

    const tierConfig = getTierConfig(tier);
    const qrLimit = tierConfig.qrLimit;
    const remaining = qrLimit - actualQrCodesUsed;
    const percentUsed = qrLimit > 0 ? Math.round((actualQrCodesUsed / qrLimit) * 100) : 0;

    // Determine if upgrade is suggested
    const shouldUpgrade = percentUsed >= 80; // Suggest upgrade at 80%
    const nextTier = getNextTier(tier);

    return res.status(200).json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        companyName: user.company_name
      },
      subscription: {
        tier: tier,
        tierName: tierConfig.name,
        price: tierConfig.price,
        status: 'active'
      },
      limits: {
        qrLimit: qrLimit,
        maxBatchSize: tierConfig.maxBatchSize
      },
      usage: {
        qrCodesUsed: actualQrCodesUsed,
        qrCodesRemaining: remaining,
        percentUsed: percentUsed,
        billingCycleStart: actualBillingStart,
        daysInCycle: daysSinceStart,
        needsReset: needsReset
      },
      canMint: remaining > 0,
      shouldUpgrade: shouldUpgrade,
      nextTier: nextTier ? {
        tier: nextTier,
        config: getTierConfig(nextTier)
      } : null
    });

  } catch (error) {
    console.error('Check limits error:', error);
    return res.status(500).json({
      error: 'Failed to check limits',
      details: error.message
    });
  } finally {
    await pool.end();
  }
};
