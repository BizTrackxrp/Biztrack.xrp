// pages/api/stripe-webhook.js
import Stripe from 'stripe';
import { Pool } from 'pg';

// Initialize Stripe & DB
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-10-22.acacia',
});
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false },
});

// Tier configuration
const TIER_CONFIG = {
  free: { qrLimit: 100, maxBatchSize: 10 },
  essential: { qrLimit: 5000, maxBatchSize: 50 },
  scale: { qrLimit: 25000, maxBatchSize: 100 },
  enterprise: { qrLimit: 100000, maxBatchSize: 500 },
};

// Map Stripe Price IDs to tiers (TEST MODE)
const PRICE_TO_TIER = {
  'price_1SLwgr2Octf3b3PtKdeaw5kk': 'essential',
  'price_1SLwkL2Octf3b3Pt29yFLCkI': 'scale',
  'price_1SLwm82Octf3b3Pt09oWF4Jj': 'enterprise',
};

// Buffer helper
const getRawBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

// DISABLE BODY PARSING
export const config = {
  api: { bodyParser: false },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let event;
  const buf = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  try {
    // UNCOMMENT THIS LINE WHEN READY FOR PROD
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET);

    // TEMP: REMOVE THIS IN PROD
    // event = JSON.parse(buf.toString());
  } catch (err) {
    console.error('[WEBHOOK] Signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`[WEBHOOK] Event: ${event.type}`);

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
        console.log(`[WEBHOOK] Ignored: ${event.type}`);
    }
    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('[WEBHOOK] Handler error:', error);
    return res.status(500).json({ error: 'Processing failed' });
  }
}

// ——————————————————————————————————————
// HANDLE CHECKOUT COMPLETED (MOST IMPORTANT)
// ——————————————————————————————————————
async function handleCheckoutCompleted(session) {
  console.log('[CHECKOUT] Session completed:', session.id);

  // PRIORITY: Get userId from metadata (YOU MUST SET THIS IN CHECKOUT)
  const userId = session.metadata?.userId || session.client_reference_id;

  if (!userId) {
    console.error('[CHECKOUT] NO USER ID! Set metadata.userId or client_reference_id');
    return;
  }

  const subscriptionId = session.subscription;
  const customerId = session.customer;
  let tier = session.metadata?.tier;

  // If no tier in metadata, get from price
  if (!tier && subscriptionId) {
    try {
      const sub = await stripe.subscriptions.retrieve(subscriptionId);
      const priceId = sub.items.data[0]?.price.id;
      tier = PRICE_TO_TIER[priceId] || 'free';
      console.log(`[CHECKOUT] Tier from price: ${priceId} → ${tier}`);
    } catch (e) {
      console.error('[CHECKOUT] Failed to get price:', e.message);
      tier = 'free';
    }
  }

  const config = TIER_CONFIG[tier] || TIER_CONFIG.free;

  try {
    const result = await pool.query(
      `UPDATE users
       SET subscription_tier = $1,
           qr_codes_limit = $2,
           qr_codes_used = 0,
           stripe_customer_id = $3,
           stripe_subscription_id = $4,
           subscription_status = 'active',
           updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [tier, config.qrLimit, customerId, subscriptionId || null, userId]
    );

    if (result.rows.length > 0) {
      console.log(`[SUCCESS] User ${userId} → ${tier} (${config.qrLimit} QRs)`);
    } else {
      console.error(`[ERROR] User ${userId} not found in DB`);
    }
  } catch (error) {
    console.error('[DB ERROR] Update failed:', error);
    throw error;
  }
}

// ——————————————————————————————————————
// OTHER HANDLERS (Keep these — they’re solid)
// ——————————————————————————————————————
async function handleSubscriptionUpdated(sub) {
  console.log('[SUB UPDATED] ID:', sub.id, 'Status:', sub.status);
  const customerId = sub.customer;
  const priceId = sub.items.data[0]?.price.id;
  const status = sub.status;

  const userRes = await pool.query(
    'SELECT id FROM users WHERE stripe_customer_id = $1',
    [customerId]
  );

  let userId;
  if (userRes.rows.length === 0 && sub.metadata?.userId) {
    userId = sub.metadata.userId;
    await pool.query(
      'UPDATE users SET stripe_customer_id = $1 WHERE id = $2',
      [customerId, userId]
    );
  } else {
    userId = userRes.rows[0].id;
  }

  const tier = sub.metadata?.tier || PRICE_TO_TIER[priceId] || 'free';
  const config = TIER_CONFIG[tier] || TIER_CONFIG.free;

  await pool.query(
    `UPDATE users
     SET subscription_tier = $1, qr_codes_limit = $2, subscription_status = $3, stripe_subscription_id = $4
     WHERE id = $5`,
    [tier, config.qrLimit, status, sub.id, userId]
  );
}

async function handleSubscriptionDeleted(sub) {
  const customerId = sub.customer;
  const userRes = await pool.query(
    'SELECT id FROM users WHERE stripe_customer_id = $1',
    [customerId]
  );
  if (userRes.rows.length === 0) return;

  await pool.query(
    `UPDATE users
     SET subscription_tier = 'free', qr_codes_limit = $1, subscription_status = 'canceled', stripe_subscription_id = NULL
     WHERE id = $2`,
    [TIER_CONFIG.free.qrLimit, userRes.rows[0].id]
  );
}

async function handlePaymentSucceeded(invoice) {
  await pool.query(
    `UPDATE users SET subscription_status = 'active' WHERE stripe_customer_id = $1`,
    [invoice.customer]
  );
}

async function handlePaymentFailed(invoice) {
  await pool.query(
    `UPDATE users SET subscription_status = 'past_due' WHERE stripe_customer_id = $1`,
    [invoice.customer]
  );
}
