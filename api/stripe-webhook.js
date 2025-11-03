// api/stripe-webhook.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
});

// Tier configuration
const TIER_CONFIG = {
  free: { qrLimit: 100, maxBatchSize: 10 },
  essential: { qrLimit: 5000, maxBatchSize: 50 },
  scale: { qrLimit: 25000, maxBatchSize: 100 },
  enterprise: { qrLimit: 100000, maxBatchSize: 500 }
};

// Map Stripe Price IDs to tiers (TEST MODE)
const PRICE_TO_TIER = {
  'price_1SLwgr2Octf3b3PtKdeaw5kk': 'essential',  // Essential $49 (TEST)
  'price_1SLwkL2Octf3b3Pt29yFLCkI': 'scale',      // Scale $149 (TEST)
  'price_1SLwm82Octf3b3Pt09oWF4Jj': 'enterprise'  // Enterprise $399 (TEST)
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    // Verify webhook signature
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('⚠️  Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`[WEBHOOK] Received event: ${event.type}`);

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object);
        break;

      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(event.data.object);
        break;

      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object);
        break;

      default:
        console.log(`[WEBHOOK] Unhandled event type: ${event.type}`);
    }

    return res.status(200).json({ received: true });

  } catch (error) {
    console.error('[WEBHOOK] Error processing event:', error);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
};

// Handle successful checkout
async function handleCheckoutCompleted(session) {
  console.log('[WEBHOOK] Processing checkout.session.completed');
  
  const userId = session.metadata?.userId || session.client_reference_id;
  const tier = session.metadata?.tier;

  if (!userId) {
    console.error('[WEBHOOK] No userId in session metadata');
    return;
  }

  // Get the subscription
  const subscriptionId = session.subscription;
  const customerId = session.customer;

  // Get subscription details to find the price ID
  let newTier = tier;
  if (!newTier && subscriptionId) {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const priceId = subscription.items.data[0]?.price.id;
    newTier = PRICE_TO_TIER[priceId] || 'free';
  }

  const tierConfig = TIER_CONFIG[newTier] || TIER_CONFIG.free;

  console.log(`[WEBHOOK] Upgrading user ${userId} to ${newTier} tier`);

  // Update user in database
  await pool.query(
    `UPDATE users 
     SET subscription_tier = $1,
         qr_codes_limit = $2,
         qr_codes_used = 0,
         stripe_customer_id = $3,
         stripe_subscription_id = $4,
         subscription_status = 'active',
         updated_at = NOW()
     WHERE id = $5`,
    [newTier, tierConfig.qrLimit, customerId, subscriptionId, userId]
  );

  console.log(`[WEBHOOK] ✅ User ${userId} upgraded to ${newTier}! Counter reset to 0/${tierConfig.qrLimit}`);
}

// Handle subscription updates (plan changes, renewals)
async function handleSubscriptionUpdated(subscription) {
  console.log('[WEBHOOK] Processing customer.subscription.updated');

  const customerId = subscription.customer;
  const priceId = subscription.items.data[0]?.price.id;
  const status = subscription.status;

  // Find user by customer ID
  const userResult = await pool.query(
    'SELECT id, subscription_tier FROM users WHERE stripe_customer_id = $1',
    [customerId]
  );

  if (userResult.rows.length === 0) {
    console.error('[WEBHOOK] User not found for customer:', customerId);
    return;
  }

  const user = userResult.rows[0];
  const newTier = PRICE_TO_TIER[priceId] || 'free';
  const tierConfig = TIER_CONFIG[newTier] || TIER_CONFIG.free;

  console.log(`[WEBHOOK] Updating user ${user.id} to ${newTier} tier (status: ${status})`);

  // Check if tier changed (upgrade/downgrade)
  const tierChanged = user.subscription_tier !== newTier;

  if (tierChanged) {
    // Reset counter on tier change
    await pool.query(
      `UPDATE users 
       SET subscription_tier = $1,
           qr_codes_limit = $2,
           qr_codes_used = 0,
           subscription_status = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [newTier, tierConfig.qrLimit, status, user.id]
    );
    console.log(`[WEBHOOK] ✅ User ${user.id} tier changed to ${newTier}! Counter reset to 0/${tierConfig.qrLimit}`);
  } else {
    // Just update status
    await pool.query(
      `UPDATE users 
       SET subscription_status = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [status, user.id]
    );
    console.log(`[WEBHOOK] ✅ User ${user.id} subscription status updated to ${status}`);
  }
}

// Handle subscription cancellation
async function handleSubscriptionDeleted(subscription) {
  console.log('[WEBHOOK] Processing customer.subscription.deleted');

  const customerId = subscription.customer;

  // Find user by customer ID
  const userResult = await pool.query(
    'SELECT id FROM users WHERE stripe_customer_id = $1',
    [customerId]
  );

  if (userResult.rows.length === 0) {
    console.error('[WEBHOOK] User not found for customer:', customerId);
    return;
  }

  const user = userResult.rows[0];

  console.log(`[WEBHOOK] Downgrading user ${user.id} to free tier`);

  // Downgrade to free tier but DON'T reset counter (let them keep current usage)
  await pool.query(
    `UPDATE users 
     SET subscription_tier = 'free',
         qr_codes_limit = $1,
         subscription_status = 'canceled',
         stripe_subscription_id = NULL,
         updated_at = NOW()
     WHERE id = $2`,
    [TIER_CONFIG.free.qrLimit, user.id]
  );

  console.log(`[WEBHOOK] ✅ User ${user.id} downgraded to free tier`);
}

// Handle successful recurring payment
async function handlePaymentSucceeded(invoice) {
  console.log('[WEBHOOK] Processing invoice.payment_succeeded');

  const customerId = invoice.customer;
  const subscriptionId = invoice.subscription;

  // Update subscription status to active
  await pool.query(
    `UPDATE users 
     SET subscription_status = 'active',
         updated_at = NOW()
     WHERE stripe_customer_id = $1`,
    [customerId]
  );

  console.log(`[WEBHOOK] ✅ Payment succeeded for customer ${customerId}`);
}

// Handle failed payment
async function handlePaymentFailed(invoice) {
  console.log('[WEBHOOK] Processing invoice.payment_failed');

  const customerId = invoice.customer;

  // Update subscription status to past_due
  await pool.query(
    `UPDATE users 
     SET subscription_status = 'past_due',
         updated_at = NOW()
     WHERE stripe_customer_id = $1`,
    [customerId]
  );

  console.log(`[WEBHOOK] ⚠️ Payment failed for customer ${customerId}`);
}
