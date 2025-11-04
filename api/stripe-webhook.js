// pages/api/stripe-webhook.js
import Stripe from 'stripe';
import { Pool } from 'pg';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false },
});

const TIER_CONFIG = {
  free: { qrLimit: 100 },
  essential: { qrLimit: 5000 },
  scale: { qrLimit: 25000 },
  enterprise: { qrLimit: 100000 }
};

const PRICE_TO_TIER = {
  'price_1SLwgr2Octf3b3PtKdeaw5kk': 'essential',
  'price_1SLwkL2Octf3b3Pt29yFLCkI': 'scale',
  'price_1SLwm82Octf3b3Pt09oWF4Jj': 'enterprise'
};

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // READ RAW BODY
  let rawBody;
  try {
    const buffers = [];
    for await (const chunk of req) buffers.push(chunk);
    rawBody = Buffer.concat(buffers);
  } catch (err) {
    return res.status(400).send('Failed to read body');
  }

  const sig = req.headers['stripe-signature'];
  if (!sig) return res.status(400).send('Missing stripe-signature');

  let event;
  try {
    // SIGNATURE RE-ENABLED — THIS WILL WORK NOW
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
    console.log(`[WEBHOOK] VERIFIED: ${event.type}`);
  } catch (err) {
    console.error('[SIG FAIL]:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.metadata?.userId || session.client_reference_id;
    if (!userId) {
      console.error('[NO USER ID]');
      return res.status(400).send('No userId');
    }

    let tier = session.metadata?.tier;
    if (!tier && session.subscription) {
      try {
        const sub = await stripe.subscriptions.retrieve(session.subscription);
        tier = PRICE_TO_TIER[sub.items.data[0]?.price.id] || 'free';
      } catch (err) {
        console.error('[SUB FETCH FAIL]:', err.message);
        tier = 'free';
      }
    }

    const { qrLimit } = TIER_CONFIG[tier] || TIER_CONFIG.free;

    try {
      await pool.query(
        `UPDATE users SET subscription_tier = $1, qr_codes_limit = $2 WHERE id = $3`,
        [tier, qrLimit, userId]
      );
      console.log(`[UPGRADED] User ${userId} → ${tier} (${qrLimit} QRs)`);
    } catch (err) {
      console.error('[DB ERROR]:', err.message);
    }
  }

  res.json({ received: true });
}
