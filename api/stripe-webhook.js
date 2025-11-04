// pages/api/stripe-webhook.js
import Stripe from 'stripe';
import { Pool } from 'pg';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-10-22.acacia',
});
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false },
});

const TIER_CONFIG = {
  free: { qrLimit: 100, maxBatchSize: 10 },
  essential: { qrLimit: 5000, maxBatchSize: 50 },
  scale: { qrLimit: 25000, maxBatchSize: 100 },
  enterprise: { qrLimit: 100000, maxBatchSize: 500 },
};

const PRICE_TO_TIER = {
  'price_1SLwgr2Octf3b3PtKdeaw5kk': 'essential',
  'price_1SLwkL2Octf3b3Pt29yFLCkI': 'scale',
  'price_1SLwm82Octf3b3Pt09oWF4Jj': 'enterprise',
};

// === CRITICAL: DISABLE BODY PARSING + GET RAW BODY MANUALLY ===
export const config = {
  api: {
    bodyParser: false,
  },
};

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', () => resolve(Buffer.concat(body)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
    console.log(`[WEBHOOK] ✅ Event verified: ${event.type}`);
  } catch (err) {
    console.error('[WEBHOOK] ❌ Signature failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === 'checkout.session.completed') {
      await handleCheckoutCompleted(event.data.object);
    }
    // Add other handlers if needed
    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('[WEBHOOK] Processing error:', error);
    return res.status(500).json({ error: 'Processing failed' });
  }
}

async function handleCheckoutCompleted(session) {
  console.log('[CHECKOUT] Session completed:', session.id);

  const userId = session.metadata?.userId || session.client_reference_id;
  if (!userId) {
    console.error('[CHECKOUT] ❌ No userId in metadata or client_reference_id');
    return;
  }

  let tier = session.metadata?.tier;
  if (!tier && session.subscription) {
    const sub = await stripe.subscriptions.retrieve(session.subscription);
    const priceId = sub.items.data[0]?.price.id;
    tier = PRICE_TO_TIER[priceId] || 'free';
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
      [tier, config.qrLimit, session.customer, session.subscription || null, userId]
    );

    if (result.rows.length > 0) {
      console.log(`[SUCCESS] Upgraded user ${userId} to ${tier} (${config.qrLimit} QRs)`);
    } else {
      console.error(`[ERROR] User ${userId} not found`);
    }
  } catch (error) {
    console.error('[DB ERROR]:', error);
    throw error;
  }
}
