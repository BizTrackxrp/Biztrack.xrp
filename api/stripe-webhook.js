// api/stripe-webhook.js - Handle Stripe Events (UPDATED)
const { Pool } = require('pg');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

// Tier configurations
const TIER_CONFIGS = {
  free: { qrLimit: 100 },
  essential: { qrLimit: 5000 },
  scale: { qrLimit: 25000 },
  enterprise: { qrLimit: 100000 }
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object);
        break;

      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(event.data.object);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object);
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return res.status(200).json({ received: true });

  } catch (error) {
    console.error('Webhook handler error:', error);
    return res.status(500).json({ error: 'Webhook handler failed' });
  }
};

async function handleCheckoutCompleted(session) {
  console.log('✅ Checkout completed:', session.id);

  const userId = parseInt(session.metadata.userId);
  const tier = session.metadata.tier;

  if (!userId || !tier) {
    console.error('Missing userId or tier');
    return;
  }

  const tierConfig = TIER_CONFIGS[tier];

  // RESET BILLING CYCLE AND QR COUNTER ON UPGRADE
  await pool.query(
    `UPDATE users 
     SET subscription_tier = $1,
         qr_codes_limit = $2,
         qr_codes_used = 0,
         billing_cycle_start = NOW(),
         stripe_customer_id = $3,
         stripe_subscription_id = $4,
         updated_at = NOW()
     WHERE id = $5`,
    [tier, tierConfig.qrLimit, session.customer, session.subscription, userId]
  );

  console.log(`🎉 User ${userId} upgraded to ${tier} - QR counter reset to 0`);
}

async function handlePaymentSucceeded(invoice) {
  console.log('💰 Payment succeeded:', invoice.id);

  if (invoice.subscription && invoice.billing_reason === 'subscription_cycle') {
    const result = await pool.query(
      'SELECT id FROM users WHERE stripe_subscription_id = $1',
      [invoice.subscription]
    );

    if (result.rows.length > 0) {
      const userId = result.rows[0].id;

      // RESET QR COUNTER ON MONTHLY RENEWAL
      await pool.query(
        `UPDATE users 
         SET qr_codes_used = 0,
             billing_cycle_start = NOW()
         WHERE id = $1`,
        [userId]
      );

      console.log(`🔄 Monthly reset for user ${userId} - QR counter reset to 0`);
    }
  }
}

async function handleSubscriptionDeleted(subscription) {
  console.log('❌ Subscription cancelled:', subscription.id);

  await pool.query(
    `UPDATE users 
     SET subscription_tier = 'free',
         qr_codes_limit = 100,
         qr_codes_used = 0,
         billing_cycle_start = NOW(),
         stripe_subscription_id = NULL
     WHERE stripe_subscription_id = $1`,
    [subscription.id]
  );

  console.log('⬇️ User downgraded to free tier - QR counter reset to 0');
}
