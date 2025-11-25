// api/cancel-subscription.js - Handle subscription cancellation requests
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const { sendCancellationNotification } = require('../js/email-service.js');

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

    const { reason } = req.body; // Optional cancellation reason

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

    // Check if user has an active paid subscription
    if (currentTier === 'free') {
      return res.status(400).json({ error: 'No active subscription to cancel' });
    }

    // Save cancellation request to database
    await pool.query(
      `INSERT INTO subscription_changes (
        user_id,
        change_type,
        from_tier,
        to_tier,
        status,
        reason,
        requested_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [user.id, 'cancellation', currentTier, 'free', 'pending', reason || null]
    );

    // Update user record with pending cancellation
    await pool.query(
      `UPDATE users SET 
        pending_cancellation = true,
        pending_cancellation_date = NOW(),
        cancellation_reason = $1,
        updated_at = NOW()
      WHERE id = $2`,
      [reason || null, user.id]
    );

    console.log(`🚨 Cancellation requested: ${user.email} from ${currentTier}`);

    // Send admin notification email
    if (process.env.RESEND_API_KEY) {
      try {
        await sendCancellationNotification(
          user.id,
          user.email,
          user.name || user.company_name,
          currentTier
        );
        console.log('📧 Cancellation notification sent to admin');
      } catch (emailError) {
        console.error('⚠️ Failed to send cancellation notification:', emailError);
        // Don't fail the request if email fails
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Cancellation request submitted. Your subscription will remain active until the end of your billing period.',
      currentTier
    });

  } catch (error) {
    console.error('❌ Cancel subscription error:', error);
    return res.status(500).json({
      error: 'Failed to process cancellation request',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
