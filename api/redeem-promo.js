// api/redeem-promo.js - Redeem a promo code for bonus QR codes
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Authenticate user
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized - Please login' });
    }

    const token = authHeader.split(' ')[1];
    let decoded;
    
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const { code } = req.body;

    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Promo code is required' });
    }

    const promoCode = code.trim().toUpperCase();

    // Get user
    const userResult = await pool.query(
      'SELECT id, email, qr_codes_limit, promo_codes_used, subscription_tier FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];
    const usedCodes = user.promo_codes_used || [];

    // Check if user already used this code
    if (usedCodes.includes(promoCode)) {
      return res.status(400).json({ 
        error: 'Already redeemed', 
        message: 'You have already used this promo code.' 
      });
    }

    // Find the promo code
    const promoResult = await pool.query(
      `SELECT * FROM promo_codes 
       WHERE UPPER(code) = $1 
       AND is_active = true`,
      [promoCode]
    );

    if (promoResult.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Invalid code', 
        message: 'This promo code is not valid.' 
      });
    }

    const promo = promoResult.rows[0];

    // Check if expired
    if (promo.expires_at && new Date(promo.expires_at) < new Date()) {
      return res.status(400).json({ 
        error: 'Expired', 
        message: 'This promo code has expired.' 
      });
    }

    // Check if max uses reached
    if (promo.max_uses !== null && promo.times_used >= promo.max_uses) {
      return res.status(400).json({ 
        error: 'Limit reached', 
        message: 'This promo code has reached its maximum uses.' 
      });
    }

    // All checks passed - apply the bonus!
    const newLimit = (user.qr_codes_limit || 10) + promo.qr_bonus;

    // Update user's QR limit and track used code
    await pool.query(
      `UPDATE users 
       SET qr_codes_limit = $1,
           promo_codes_used = array_append(promo_codes_used, $2)
       WHERE id = $3`,
      [newLimit, promoCode, user.id]
    );

    // Increment times_used on the promo code
    await pool.query(
      'UPDATE promo_codes SET times_used = times_used + 1 WHERE id = $1',
      [promo.id]
    );

    console.log(`[PROMO] ✅ User ${user.email} redeemed code "${promoCode}" for +${promo.qr_bonus} QR codes`);

    return res.status(200).json({
      success: true,
      message: `Success! You've unlocked ${promo.qr_bonus} bonus QR codes.`,
      bonus: promo.qr_bonus,
      newLimit: newLimit
    });

  } catch (error) {
    console.error('[PROMO] ❌ Error:', error);
    return res.status(500).json({
      error: 'Failed to redeem promo code',
      details: error.message
    });
  }
};
