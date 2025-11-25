// api/downgrade-subscription.js - Handle subscription downgrade requests
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const { sendDowngradeNotification } = require('../js/email-service.js');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get user from JWT token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];
    let decoded;

    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const { newTier } = req.body;

    if (!newTier) {
      return res.status(400).json({ error: 'New tier is required' });
    }

    // Get user info
    const userResult = await pool.query(
      'SELECT id, email, name, company_name, subscription_tier FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];
    const currentTier = user.subscription_tier;

    // Validate it's actually a downgrade
    const TIER_ORDER = ['free', 'starter', 'professional', 'enterprise', 'pharma_starter', 'pharma_professional', 'pharma_enterprise'];
    const currentIndex = TIER_ORDER.indexOf(currentTier);
    const newIndex = TIER_ORDER.indexOf(newTier);

    if (newIndex >= currentIndex) {
      return res.status(400).json({ error: 'This is not a downgrade. Use upgrade flow instead.' });
    }

    // Save downgrade request to database
    await pool.query(
      `INSERT INTO subscription_changes (
        user_id,
        change_type,
        from_tier,
        to_tier,
        status,
        requested_at
      ) VALUES ($1, $2, $3, $4, $5, NOW())`,
      [user.id, 'downgrade', currentTier, newTier, 'pending']
    );

    // Update user record with pending downgrade
    await pool.query(
      `UPDATE users SET 
        pending_downgrade_tier = $1,
        pending_downgrade_date = NOW(),
        updated_at = NOW()
      WHERE id = $2`,
      [newTier, user.id]
    );

    console.log(`📉 Downgrade requested: ${user.email} from ${currentTier} to ${newTier}`);

    // Send admin notification email
    if (process.env.RESEND_API_KEY) {
      try {
        await sendDowngradeNotification(
          user.id,
          user.email,
          user.name || user.company_name,
          currentTier,
          newTier
        );
        console.log('📧 Downgrade notification sent to admin');
      } catch (emailError) {
        console.error('⚠️ Failed to send downgrade notification:', emailError);
        // Don't fail the request if email fails
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Downgrade request submitted. Your plan will change at the end of your billing period.',
      currentTier,
      newTier
    });

  } catch (error) {
    console.error('❌ Downgrade subscription error:', error);
    return res.status(500).json({
      error: 'Failed to process downgrade request',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
