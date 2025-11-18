// pages/api/stripe-webhook.js
import Stripe from 'stripe';
import { Pool } from 'pg';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false },
});

// QR LIMITS
const TIER_CONFIG = {
  free: { qrLimit: 10 },
  essential: { qrLimit: 500 },
  scale: { qrLimit: 2500 },
  enterprise: { qrLimit: 10000 },
  compliance: { qrLimit: 10000 },
  pharma_enterprise: { qrLimit: 50000 }
};

// ✅ LIVE PRICE TO TIER MAPPING
const PRICE_TO_TIER = {
  'price_1SPSCoRzdZsHMZRF5IBmTG6s': 'essential',
  'price_1SPSC3RzdZsHMZRFraOq6siQ': 'scale',
  'price_1SPSBRRzdZsHMZRFyFx0E3Ez': 'enterprise',
  'price_1STUPIRzdZsHMZRFBPj64pTW': 'compliance',
  'price_1STURMRzdZsHMZRF6bdkpcrN': 'pharma_enterprise'
};

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(400).end();

  let rawBody;
  try {
    const buffers = [];
    for await (const chunk of req) buffers.push(chunk);
    rawBody = Buffer.concat(buffers);
  } catch (err) {
    console.error('[WEBHOOK] Failed to read body:', err);
    return res.status(400).send('Failed to read body');
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString());
    console.log(`[WEBHOOK] Event received: ${event.type}`);
  } catch (err) {
    console.error('[WEBHOOK] Invalid JSON:', err);
    return res.status(400).send('Invalid JSON');
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.metadata?.userId || session.client_reference_id;
        
        if (!userId) {
          console.error('[WEBHOOK] No userId in checkout.session.completed');
          return res.status(400).send('No userId');
        }

        let tier = session.metadata?.tier;
        let subscriptionId = session.subscription;

        if (!tier && subscriptionId) {
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          tier = PRICE_TO_TIER[sub.items.data[0]?.price.id] || 'free';
        }

        const { qrLimit } = TIER_CONFIG[tier] || TIER_CONFIG.free;

        await pool.query(
          `UPDATE users 
           SET subscription_tier = $1, 
               qr_codes_limit = $2,
               qr_codes_used = 0,
               billing_cycle_start = NOW(),
               stripe_subscription_id = $3,
               stripe_customer_id = $4,
               updated_at = NOW()
           WHERE id = $5`,
          [tier, qrLimit, subscriptionId, session.customer, userId]
        );

        console.log(`[WEBHOOK] ✅ User ${userId} upgraded to ${tier} (${qrLimit} QRs) - Counter reset`);
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const customerId = subscription.customer;

        const priceId = subscription.items.data[0]?.price.id;
        const newTier = PRICE_TO_TIER[priceId] || 'free';
        const { qrLimit } = TIER_CONFIG[newTier];

        const userResult = await pool.query(
          'SELECT subscription_tier FROM users WHERE stripe_customer_id = $1',
          [customerId]
        );

        if (userResult.rows.length === 0) {
          console.error(`[WEBHOOK] User not found for customer ${customerId}`);
          return res.status(404).send('User not found');
        }

        const currentTier = userResult.rows[0].subscription_tier;

        const tierOrder = ['free', 'essential', 'scale', 'enterprise', 'compliance', 'pharma_enterprise'];
        const currentIndex = tierOrder.indexOf(currentTier);
        const newIndex = tierOrder.indexOf(newTier);

        if (newIndex > currentIndex) {
          // UPGRADE: Reset counter
          await pool.query(
            `UPDATE users 
             SET subscription_tier = $1,
                 qr_codes_limit = $2,
                 qr_codes_used = 0,
                 billing_cycle_start = NOW(),
                 stripe_subscription_id = $3,
                 updated_at = NOW()
             WHERE stripe_customer_id = $4`,
            [newTier, qrLimit, subscription.id, customerId]
          );

          console.log(`[WEBHOOK] ✅ UPGRADE: ${customerId} → ${newTier} - Counter reset`);
        } else if (newIndex < currentIndex) {
          // DOWNGRADE: Keep counter
          await pool.query(
            `UPDATE users 
             SET subscription_tier = $1,
                 qr_codes_limit = $2,
                 stripe_subscription_id = $3,
                 updated_at = NOW()
             WHERE stripe_customer_id = $4`,
            [newTier, qrLimit, subscription.id, customerId]
          );

          console.log(`[WEBHOOK] ⚠️ DOWNGRADE: ${customerId} → ${newTier} - Counter kept`);
        } else {
          await pool.query(
            `UPDATE users 
             SET qr_codes_limit = $1,
                 stripe_subscription_id = $2,
                 updated_at = NOW()
             WHERE stripe_customer_id = $3`,
            [qrLimit, subscription.id, customerId]
          );

          console.log(`[WEBHOOK] ✅ Updated ${customerId} (same tier)`);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const customerId = subscription.customer;

        const { qrLimit } = TIER_CONFIG.free;

        await pool.query(
          `UPDATE users 
           SET subscription_tier = 'free',
               qr_codes_limit = $1,
               stripe_subscription_id = NULL,
               updated_at = NOW()
           WHERE stripe_customer_id = $2`,
          [qrLimit, customerId]
        );

        console.log(`[WEBHOOK] ✅ Cancelled ${customerId} → FREE`);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const customerId = invoice.customer;
        console.log(`[WEBHOOK] ⚠️ Payment failed for ${customerId}`);
        break;
      }

      case 'customer.subscription.trial_will_end': {
        const subscription = event.data.object;
        console.log(`[WEBHOOK] ⏰ Trial ending for ${subscription.id}`);
        break;
      }

      default:
        console.log(`[WEBHOOK] Unhandled event: ${event.type}`);
    }

    return res.json({ received: true });

  } catch (error) {
    console.error('[WEBHOOK] Error:', error);
    return res.status(500).json({ error: 'Webhook failed', details: error.message });
  }
}
```

---

## 📦 FILE 3: Update Vercel Environment Variables

Go to Vercel → Environment Variables and **UPDATE** these:
```
STRIPE_PRICE_ESSENTIAL=price_1SPSCoRzdZsHMZRF5IBmTG6s
STRIPE_PRICE_SCALE=price_1SPSC3RzdZsHMZRFraOq6siQ
STRIPE_PRICE_ENTERPRISE=price_1SPSBRRzdZsHMZRFyFx0E3Ez
STRIPE_PRICE_COMPLIANCE=price_1STUPIRzdZsHMZRFBPj64pTW
STRIPE_PRICE_PHARMA_ENTERPRISE=price_1STURMRzdZsHMZRF6bdkpcrN
