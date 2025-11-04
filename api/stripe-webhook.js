// pages/api/stripe-webhook.js
import { buffer } from 'micro';
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
  'price_1SLwgr2Octf3b3PtKdeaw5kk': 'essential',
  'price_1SLwkL2Octf3b3Pt29yFLCkI': 'scale',
  'price_1SLwm82Octf3b3Pt09oWF4Jj': 'enterprise'
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('⚠️  STRIPE_WEBHOOK_SECRET not set!');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  let event;

  try {
    // Get raw body buffer - CRITICAL: Don't convert to string!
    const buf = await buffer(req);
    
    console.log('[WEBHOOK] Signature present:', !!sig);
    console.log('[WEBHOOK] Buffer length:', buf.length);
    
    // THE FIX: Pass buf directly, NOT buf.toString()
    event = stripe.webhooks.constructEvent(buf, sig, webhookSecret);
    
    console.log(`[WEBHOOK] ✅ Verified! Event: ${event.type}`);
  } catch (err) {
    console.error('⚠️  Webhook verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`[WEBHOOK] Processing: ${event.type}`);

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
        console.log(`[WEBHOOK] Unhandled: ${event.type}`);
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('[WEBHOOK] Processing error:', error);
    return res.status(500).json({ error: 'Processing failed' });
  }
}

async function handleCheckoutCompleted(session) {
  console.log('[WEBHOOK] 💰 checkout.session.completed');
  
  const userId = session.metadata?.userId || session.client_reference_id;
  const tier = session.metadata?.tier;

  if (!userId) {
    console.error('[WEBHOOK] ❌ No userId in session!');
    return;
  }

  const subscriptionId = session.subscription;
  const customerId = session.customer;

  let newTier = tier;
  
  // If no tier in metadata, get it from the subscription
  if (!newTier && subscriptionId) {
    try {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const priceId = subscription.items.data[0]?.price.id;
      newTier = PRICE_TO_TIER[priceId] || 'free';
      console.log(`[WEBHOOK] Determined tier from price: ${priceId} → ${newTier}`);
    } catch (error) {
      console.error('[WEBHOOK] Error fetching subscription:', error);
      newTier = 'free';
    }
  }

  const tierConfig = TIER_CONFIG[newTier] || TIER_CONFIG.free;

  console.log(`[WEBHOOK] Upgrading user ${userId} to ${newTier}`);

  try {
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

    console.log(`[WEBHOOK] ✅ SUCCESS! User ${userId} → ${newTier} (0/${tierConfig.qrLimit} QR codes)`);
  } catch (error) {
    console.error('[WEBHOOK] ❌ Database error:', error);
    throw error;
  }
}

async function handleSubscriptionUpdated(subscription) {
  console.log('[WEBHOOK] 🔄 customer.subscription.updated');

  const customerId = subscription.customer;
  const priceId = subscription.items.data[0]?.price.id;
  const status = subscription.status;
  const cancelAtPeriodEnd = subscription.cancel_at_period_end;

  try {
    const userResult = await pool.query(
      'SELECT id, subscription_tier FROM users WHERE stripe_customer_id = $1',
      [customerId]
    );

    if (userResult.rows.length === 0) {
      console.error('[WEBHOOK] ❌ User not found for customer:', customerId);
      return;
    }

    const user = userResult.rows[0];
    
    if (cancelAtPeriodEnd) {
      console.log(`[WEBHOOK] ⚠️ User ${user.id} set to cancel at period end`);
      await pool.query(
        `UPDATE users SET subscription_status = 'canceling', updated_at = NOW() WHERE id = $1`,
        [user.id]
      );
      return;
    }

    const newTier = PRICE_TO_TIER[priceId] || user.subscription_tier;
    const tierConfig = TIER_CONFIG[newTier] || TIER_CONFIG.free;
    const tierChanged = user.subscription_tier !== newTier;

    if (tierChanged) {
      console.log(`[WEBHOOK] Tier change: ${user.subscription_tier} → ${newTier}`);
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
      console.log(`[WEBHOOK] ✅ User ${user.id} upgraded to ${newTier}!`);
    } else {
      await pool.query(
        `UPDATE users SET subscription_status = $1, updated_at = NOW() WHERE id = $2`,
        [status, user.id]
      );
      console.log(`[WEBHOOK] ✅ Status updated to: ${status}`);
    }
  } catch (error) {
    console.error('[WEBHOOK] ❌ Error updating subscription:', error);
    throw error;
  }
}

async function handleSubscriptionDeleted(subscription) {
  console.log('[WEBHOOK] ❌ customer.subscription.deleted');

  const customerId = subscription.customer;

  try {
    const userResult = await pool.query(
      'SELECT id, subscription_tier FROM users WHERE stripe_customer_id = $1',
      [customerId]
    );

    if (userResult.rows.length === 0) {
      console.error('[WEBHOOK] ❌ User not found for customer:', customerId);
      return;
    }

    const user = userResult.rows[0];

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

    console.log(`[WEBHOOK] ✅ User ${user.id} reverted to free tier (was: ${user.subscription_tier})`);
  } catch (error) {
    console.error('[WEBHOOK] ❌ Error deleting subscription:', error);
    throw error;
  }
}

async function handlePaymentSucceeded(invoice) {
  console.log('[WEBHOOK] 💵 invoice.payment_succeeded');
  const customerId = invoice.customer;

  try {
    await pool.query(
      `UPDATE users SET subscription_status = 'active', updated_at = NOW() WHERE stripe_customer_id = $1`,
      [customerId]
    );

    console.log(`[WEBHOOK] ✅ Payment succeeded for customer: ${customerId}`);
  } catch (error) {
    console.error('[WEBHOOK] ❌ Error updating payment status:', error);
    throw error;
  }
}

async function handlePaymentFailed(invoice) {
  console.log('[WEBHOOK] ⚠️ invoice.payment_failed');
  const customerId = invoice.customer;

  try {
    await pool.query(
      `UPDATE users SET subscription_status = 'past_due', updated_at = NOW() WHERE stripe_customer_id = $1`,
      [customerId]
    );

    console.log(`[WEBHOOK] ⚠️ Payment failed for customer: ${customerId}`);
  } catch (error) {
    console.error('[WEBHOOK] ❌ Error updating failed payment:', error);
    throw error;
  }
}

// CRITICAL: Disable Next.js body parsing!
export const config = {
  api: {
    bodyParser: false,
  },
};
