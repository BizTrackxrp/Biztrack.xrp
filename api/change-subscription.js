// api/change-subscription.js - Self-service tier changes + Manual request handling
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const Stripe = require('stripe');
const { Resend } = require('resend');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY); // Add to .env: RESEND_API_KEY=re_xxxxx

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

// Map tiers to Stripe price IDs
const TIER_TO_PRICE = {
  essential: 'price_1SLwgr2Octf3b3PtKdeaw5kk',
  scale: 'price_1SLwkL2Octf3b3Pt29yFLCkI',
  enterprise: 'price_1SLwm82Octf3b3Pt09oWF4Jj'
};

const TIER_INFO = {
  essential: { name: 'Essential', qrCodes: 500, price: 49 },
  scale: { name: 'Scale', qrCodes: 2500, price: 149 },
  enterprise: { name: 'Enterprise', qrCodes: 10000, price: 399 }
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
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
    const userId = decoded.userId;

    const { newTier, requestType, targetPlan, currentPlan, userEmail } = req.body;

    // ========================================
    // HANDLE MANUAL DOWNGRADE/CANCEL REQUESTS
    // ========================================
    if (requestType === 'downgrade' || requestType === 'cancel') {
      console.log('[CHANGE-SUB] Manual request received:', { requestType, userId, currentPlan, targetPlan });

      // Get user info
      const userResult = await pool.query(
        'SELECT id, email, company_name, stripe_subscription_id, stripe_customer_id, subscription_tier FROM users WHERE id = $1',
        [userId]
      );

      if (userResult.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      const user = userResult.rows[0];

      // Log request in database (optional - create table if needed)
      try {
        await pool.query(
          `INSERT INTO subscription_change_requests 
           (user_id, request_type, current_tier, target_tier, status, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())
           ON CONFLICT DO NOTHING`,
          [userId, requestType, currentPlan || user.subscription_tier, targetPlan, 'pending']
        );
      } catch (dbError) {
        console.log('[CHANGE-SUB] Could not log to DB (table may not exist):', dbError.message);
      }

      // Send email to info@biztrack.io
      try {
        const emailSubject = requestType === 'cancel' 
          ? `🚨 CANCELLATION Request - ${user.email}`
          : `🚨 DOWNGRADE Request - ${user.email}`;

        const emailHtml = `
          <h2>🚨 Subscription ${requestType === 'cancel' ? 'CANCELLATION' : 'DOWNGRADE'} Request</h2>
          
          <p><strong>Action:</strong> ${requestType === 'cancel' ? 'CANCEL SUBSCRIPTION' : 'DOWNGRADE'}</p>
          
          <h3>Customer Info:</h3>
          <ul>
            <li><strong>Email:</strong> ${user.email}</li>
            <li><strong>Company:</strong> ${user.company_name || 'N/A'}</li>
            <li><strong>User ID:</strong> ${user.id}</li>
            <li><strong>Current Tier:</strong> ${currentPlan || user.subscription_tier}</li>
            ${requestType === 'downgrade' ? `<li><strong>Requested Tier:</strong> ${targetPlan || 'Not specified'}</li>` : ''}
          </ul>

          <h3>Stripe Info:</h3>
          <ul>
            <li><strong>Customer ID:</strong> ${user.stripe_customer_id || 'N/A'}</li>
            <li><strong>Subscription ID:</strong> ${user.stripe_subscription_id || 'N/A'}</li>
          </ul>

          <hr>
          
          <h3>Next Steps:</h3>
          <ol>
            <li>Go to Stripe Dashboard: <a href="https://dashboard.stripe.com/subscriptions/${user.stripe_subscription_id}">View Subscription</a></li>
            <li>${requestType === 'cancel' 
              ? 'Click "Cancel subscription" → "At period end"' 
              : `Click "Update subscription" → Change to ${targetPlan} tier → Schedule for period end`}</li>
            <li>Reply to customer: ${user.email}</li>
          </ol>

          <p><em>This is an automated notification from BizTrack.</em></p>
        `;

        await resend.emails.send({
          from: 'BizTrack <noreply@biztrack.io>',
          to: 'info@biztrack.io',
          subject: emailSubject,
          html: emailHtml
        });

        console.log('[CHANGE-SUB] ✅ Email sent to info@biztrack.io');
      } catch (emailError) {
        console.error('[CHANGE-SUB] ❌ Email send failed:', emailError);
        // Don't fail the request if email fails - still return success to user
      }

      return res.status(200).json({
        success: true,
        message: `Your ${requestType} request has been received and will be processed within 24 hours.`
      });
    }

    // ========================================
    // HANDLE AUTOMATED TIER CHANGES (EXISTING CODE)
    // ========================================
    if (!newTier || !TIER_TO_PRICE[newTier]) {
      return res.status(400).json({ error: 'Invalid tier specified' });
    }

    // Get user's current subscription info
    const result = await pool.query(
      'SELECT stripe_subscription_id, stripe_customer_id, subscription_tier FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { stripe_subscription_id, stripe_customer_id, subscription_tier } = result.rows[0];

    // Check if user has an active subscription
    if (!stripe_subscription_id) {
      return res.status(400).json({ 
        error: 'No active subscription found',
        message: 'Please upgrade to a paid plan first'
      });
    }

    // Don't allow changing to same tier
    if (subscription_tier === newTier) {
      return res.status(400).json({ 
        error: 'Already on this tier',
        message: `You're already subscribed to ${TIER_INFO[newTier].name}`
      });
    }

    // Get the subscription from Stripe
    const subscription = await stripe.subscriptions.retrieve(stripe_subscription_id);

    // Get the new price ID
    const newPriceId = TIER_TO_PRICE[newTier];

    // Determine if this is an upgrade or downgrade
    const tierLevels = { essential: 1, scale: 2, enterprise: 3 };
    const isUpgrade = tierLevels[newTier] > tierLevels[subscription_tier];

    if (isUpgrade) {
      // UPGRADE: Apply immediately with prorated charge
      await stripe.subscriptions.update(stripe_subscription_id, {
        items: [{
          id: subscription.items.data[0].id,
          price: newPriceId,
        }],
        proration_behavior: 'create_prorations', // Charge difference immediately
      });

      return res.status(200).json({
        success: true,
        message: `Successfully upgraded to ${TIER_INFO[newTier].name}!`,
        tier: newTier,
        immediate: true,
        info: `You've been charged the prorated difference and now have ${TIER_INFO[newTier].qrCodes.toLocaleString()} QR codes per month available immediately!`
      });

    } else {
      // DOWNGRADE: Apply at end of billing period (no refund)
      await stripe.subscriptions.update(stripe_subscription_id, {
        items: [{
          id: subscription.items.data[0].id,
          price: newPriceId,
        }],
        proration_behavior: 'none', // No refund
        billing_cycle_anchor: 'unchanged', // Keep same billing date
      });

      // Calculate when change takes effect
      const currentPeriodEnd = new Date(subscription.current_period_end * 1000);
      const effectiveDate = currentPeriodEnd.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });

      return res.status(200).json({
        success: true,
        message: `Downgrade scheduled to ${TIER_INFO[newTier].name}`,
        tier: newTier,
        immediate: false,
        effectiveDate,
        info: `Your subscription will change to ${TIER_INFO[newTier].name} (${TIER_INFO[newTier].qrCodes.toLocaleString()} QR codes/month) on ${effectiveDate}. You'll continue to have access to your current plan until then.`
      });
    }

  } catch (error) {
    console.error('[CHANGE-SUB] Error:', error);
    return res.status(500).json({
      error: 'Failed to process request',
      details: error.message
    });
  }
};
