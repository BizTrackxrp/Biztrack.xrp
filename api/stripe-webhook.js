// api/stripe-webhook.js - Handle Stripe Webhook Events
const { Pool } = require('pg');
const stripeConfig = require('../stripe-config');

const stripe = require('stripe')(stripeConfig.stripeSecretKey);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    // Verify webhook signature
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log('Received webhook event:', event.type);

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        await handleCheckoutComplete(session);
        break;
      }

      case 'customer.subscription.created': {
        const subscription = event.data.object;
        await handleSubscriptionCreated(subscription);
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        await handleSubscriptionUpdated(subscription);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        await handleSubscriptionDeleted(subscription);
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        await handlePaymentSucceeded(invoice);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        await handlePaymentFailed(invoice);
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Webhook handler error:', error);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
};

async function handleCheckoutComplete(session) {
  console.log('Checkout completed:', session.id);
  
  const userId = session.metadata.userId;
  const tier = session.metadata.tier;

  if (!userId || !tier) {
    console.error('Missing metadata in checkout session');
    return;
  }

  const tierConfig = stripeConfig.getTierConfig(tier);

  await pool.query(
    `UPDATE users 
     SET subscription_tier = $1,
         qr_codes_limit = $2,
         qr_codes_used = 0,
         billing_cycle_start = NOW(),
         stripe_subscription_id = $3,
         stripe_price_id = $4
     WHERE id = $5`,
    [tier, tierConfig.qrLimit, session.subscription, tierConfig.priceId, userId]
  );

  console.log(`User ${userId} upgraded to ${tier}`);
}

async function handleSubscriptionCreated(subscription) {
  console.log('Subscription created:', subscription.id);
  
  const userId = subscription.metadata.userId;
  const tier = subscription.metadata.tier;

  if (!userId || !tier) {
    console.error('Missing metadata in subscription');
    return;
  }

  const tierConfig = stripeConfig.getTierConfig(tier);

  await pool.query(
    `UPDATE users 
     SET subscription_tier = $1,
         qr_codes_limit = $2,
         stripe_subscription_id = $3,
         stripe_price_id = $4,
         billing_cycle_start = NOW()
     WHERE id = $5`,
    [tier, tierConfig.qrLimit, subscription.id, tierConfig.priceId, userId]
  );
}

async function handleSubscriptionUpdated(subscription) {
  console.log('Subscription updated:', subscription.id);
  
  // Find user by subscription ID
  const result = await pool.query(
    'SELECT id FROM users WHERE stripe_subscription_id = $1',
    [subscription.id]
  );

  if (result.rows.length === 0) {
    console.error('User not found for subscription:', subscription.id);
    return;
  }

  const userId = result.rows[0].id;
  
  // Get price ID from subscription
  const priceId = subscription.items.data[0]?.price.id;
  const tierInfo = stripeConfig.getTierByPriceId(priceId);

  if (!tierInfo) {
    console.error('Unknown price ID:', priceId);
    return;
  }

  await pool.query(
    `UPDATE users 
     SET subscription_tier = $1,
         qr_codes_limit = $2,
         stripe_price_id = $3
     WHERE id = $4`,
    [tierInfo.tier, tierInfo.qrLimit, priceId, userId]
  );
}

async function handleSubscriptionDeleted(subscription) {
  console.log('Subscription deleted:', subscription.id);
  
  // Downgrade user to free tier
  await pool.query(
    `UPDATE users 
     SET subscription_tier = 'free',
         qr_codes_limit = 100,
         qr_codes_used = 0,
         billing_cycle_start = NOW(),
         stripe_subscription_id = NULL,
         stripe_price_id = NULL
     WHERE stripe_subscription_id = $1`,
    [subscription.id]
  );
}

async function handlePaymentSucceeded(invoice) {
  console.log('Payment succeeded for invoice:', invoice.id);
  
  if (!invoice.subscription) {
    return; // Not a subscription payment
  }

  // Reset QR code counter for new billing cycle
  await pool.query(
    `UPDATE users 
     SET qr_codes_used = 0,
         billing_cycle_start = NOW()
     WHERE stripe_subscription_id = $1`,
    [invoice.subscription]
  );

  console.log('QR code counter reset for subscription:', invoice.subscription);
}

async function handlePaymentFailed(invoice) {
  console.log('Payment failed for invoice:', invoice.id);
  
  // Optionally notify user or take action
  // You could send an email here or flag the account
}
