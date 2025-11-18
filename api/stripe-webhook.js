// pages/api/stripe-webhook.js
import Stripe from 'stripe';
import { Pool } from 'pg';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false },
});

// ✅ UPDATED: Added pharma tiers
const TIER_CONFIG = {
  free: { qrLimit: 10 },
  essential: { qrLimit: 500 },
  scale: { qrLimit: 2500 },
  enterprise: { qrLimit: 10000 },
  compliance: { qrLimit: 10000 },           // PHARMA
  pharma_enterprise: { qrLimit: 50000 }     // PHARMA
};

// ✅ UPDATED: Added pharma price IDs
const PRICE_TO_TIER = {
  'price_1SLwgr2Octf3b3PtKdeaw5kk': 'essential',
  'price_1SLwkL2Octf3b3Pt29yFLCkI': 'scale',
  'price_1SLwm82Octf3b3Pt09oWF4Jj': 'enterprise',
  'price_1STUPIRzdZsHMZRFBPj64pTW': 'compliance',           // PHARMA $2,500
  'price_1STURMRzdZsHMZRF6bdkpcrN': 'pharma_enterprise'    // PHARMA $5,000
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
      // ✅ NEW SUBSCRIPTION CREATED (checkout completed)
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.metadata?.userId || session.client_reference_id;
        
        if (!userId) {
          console.error('[WEBHOOK] No userId in checkout.session.completed');
          return res.status(400).send('No userId');
        }

        let tier = session.metadata?.tier;
        let subscriptionId = session.subscription;

        // If no tier in metadata, fetch from subscription
        if (!tier && subscriptionId) {
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          tier = PRICE_TO_TIER[sub.items.data[0]?.price.id] || 'free';
        }

        const { qrLimit } = TIER_CONFIG[tier] || TIER_CONFIG.free;

        // ✅ UPGRADE: Reset counter immediately + set new billing cycle
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

        console.log(`[WEBHOOK] ✅ User ${userId} upgraded to ${tier} (${qrLimit} QRs) - Counter reset to 0`);
        break;
      }

      // ✅ SUBSCRIPTION UPDATED (tier change during billing cycle)
      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const customerId = subscription.customer;
        const previousAttributes = event.data.previous_attributes;

        // Determine new tier from price
        const priceId = subscription.items.data[0]?.price.id;
        const newTier = PRICE_TO_TIER[priceId] || 'free';
        const { qrLimit } = TIER_CONFIG[newTier];

        // Get current user tier
        const userResult = await pool.query(
          'SELECT subscription_tier FROM users WHERE stripe_customer_id = $1',
          [customerId]
        );

        if (userResult.rows.length === 0) {
          console.error(`[WEBHOOK] User not found for customer ${customerId}`);
          return res.status(404).send('User not found');
        }

        const currentTier = userResult.rows[0].subscription_tier;

        // Determine if upgrade or downgrade
        const tierOrder = ['free', 'essential', 'scale', 'enterprise', 'compliance', 'pharma_enterprise'];
        const currentIndex = tierOrder.indexOf(currentTier);
        const newIndex = tierOrder.indexOf(newTier);

        if (newIndex > currentIndex) {
          // ✅ UPGRADE: Reset counter immediately
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

          console.log(`[WEBHOOK] ✅ UPGRADE: ${customerId} → ${newTier} (${qrLimit} QRs) - Counter reset to 0`);
        } else if (newIndex < currentIndex) {
          // ✅ DOWNGRADE: Keep counter, update tier/limit only
          // User keeps their QR codes until billing cycle ends
          await pool.query(
            `UPDATE users 
             SET subscription_tier = $1,
                 qr_codes_limit = $2,
                 stripe_subscription_id = $3,
                 updated_at = NOW()
             WHERE stripe_customer_id = $4`,
            [newTier, qrLimit, subscription.id, customerId]
          );

          console.log(`[WEBHOOK] ⚠️ DOWNGRADE: ${customerId} → ${newTier} - Counter NOT reset (waits for billing cycle)`);
        } else {
          // Same tier (renewal or other update)
          await pool.query(
            `UPDATE users 
             SET qr_codes_limit = $1,
                 stripe_subscription_id = $2,
                 updated_at = NOW()
             WHERE stripe_customer_id = $3`,
            [qrLimit, subscription.id, customerId]
          );

          console.log(`[WEBHOOK] ✅ Subscription updated for ${customerId} (same tier)`);
        }
        break;
      }

      // ✅ SUBSCRIPTION CANCELLED/DELETED (downgrade to free at end of billing cycle)
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const customerId = subscription.customer;

        // Downgrade to FREE tier
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

        console.log(`[WEBHOOK] ✅ Subscription cancelled for ${customerId} → FREE tier (${qrLimit} QRs)`);
        break;
      }

      // ✅ PAYMENT FAILED (optional: notify user, don't downgrade yet)
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const customerId = invoice.customer;

        console.log(`[WEBHOOK] ⚠️ Payment failed for customer ${customerId}`);
        // Optional: Send email notification to user
        // Stripe will retry payment automatically
        break;
      }

      // ✅ SUBSCRIPTION TRIAL ENDED
      case 'customer.subscription.trial_will_end': {
        const subscription = event.data.object;
        console.log(`[WEBHOOK] ⏰ Trial ending soon for subscription ${subscription.id}`);
        // Optional: Send reminder email
        break;
      }

      default:
        console.log(`[WEBHOOK] Unhandled event type: ${event.type}`);
    }

    return res.json({ received: true });

  } catch (error) {
    console.error('[WEBHOOK] Error processing event:', error);
    return res.status(500).json({ error: 'Webhook processing failed', details: error.message });
  }
}
```
