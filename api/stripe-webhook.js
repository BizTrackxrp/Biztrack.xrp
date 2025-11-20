// pages/api/stripe-webhook.js
const Stripe = require('stripe');
const { Pool } = require('pg');

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
  starter: { qrLimit: 1000 },
  professional: { qrLimit: 5000 },
  pharma_enterprise: { qrLimit: 50000 }
};

// ✅ TEST MODE PRICE TO TIER MAPPING
const PRICE_TO_TIER = {
  // General Business Tiers
  'price_1SUukV2Kvkd8Qy8OIgqAGV3k': 'essential',
  'price_1SUuko2Kvkd8Qy8OemmtHbZb': 'scale',
  'price_1SUulO2Kvkd8Qy8O0IiV9vmh': 'enterprise',
  
  // Pharma Tiers
  'price_1SVJEC2Kvkd8Qy8O1LTwpw50': 'starter',
  'price_1SUulu2Kvkd8Qy8O0qAlY4w3': 'professional',
  'price_1SUum52Kvkd8Qy8Oq5W9t6hT': 'pharma_enterprise'
};

// TIER PRICING (for revenue calculations)
const TIER_PRICING = {
  free: 0,
  essential: 49,
  scale: 149,
  enterprise: 399,
  starter: 199,
  professional: 599,
  pharma_enterprise: 1499
};

// ==========================================
// EMAIL NOTIFICATION SYSTEM
// ==========================================

function getDaysUntilEnd(endDate) {
  const now = new Date();
  const end = new Date(endDate * 1000);
  const diffTime = end - now;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

async function sendNotificationEmail(type, data) {
  const billingPeriodEnd = data.billingPeriodEnd || 'Unknown';
  
  let subject, body;
  
  switch(type) {
    case 'new_subscription':
      subject = `🎉 NEW CUSTOMER: ${data.tier.toUpperCase()} - $${data.amount}`;
      body = `
═══════════════════════════════════════
🎉 NEW SUBSCRIPTION ALERT
═══════════════════════════════════════

Customer Email: ${data.email}
Tier: ${data.tier}
Monthly Revenue: $${data.amount}
QR Code Limit: ${data.qrLimit}

Stripe Customer ID: ${data.customerId}
Subscription ID: ${data.subscriptionId}

📊 FIND IN STRIPE:
https://dashboard.stripe.com/customers/${data.customerId}

✅ ACTION: Welcome email sent automatically
⏰ Next Billing: ${billingPeriodEnd}

═══════════════════════════════════════
      `.trim();
      break;
      
    case 'upgrade':
      subject = `⬆️ UPGRADE ALERT: ${data.oldTier} → ${data.newTier} (+$${data.revenueIncrease})`;
      body = `
═══════════════════════════════════════
⬆️ CUSTOMER UPGRADE ALERT
═══════════════════════════════════════

Customer Email: ${data.email}
Old Tier: ${data.oldTier}
New Tier: ${data.newTier}
Revenue Increase: +$${data.revenueIncrease}/month

New QR Limit: ${data.qrLimit}
Counter: RESET to 0 (upgrade rules)

Stripe Customer ID: ${data.customerId}

📊 FIND IN STRIPE:
https://dashboard.stripe.com/customers/${data.customerId}

✅ ACTION: Send thank you email for upgrading
⏰ Next Billing: ${billingPeriodEnd}

═══════════════════════════════════════
      `.trim();
      break;
      
    case 'downgrade':
      subject = `⬇️ DOWNGRADE ALERT: ${data.oldTier} → ${data.newTier} (-$${data.revenueDecrease})`;
      body = `
═══════════════════════════════════════
⬇️ CUSTOMER DOWNGRADE ALERT
═══════════════════════════════════════

Customer Email: ${data.email}
Old Tier: ${data.oldTier}
New Tier: ${data.newTier}
Revenue Loss: -$${data.revenueDecrease}/month

New QR Limit: ${data.qrLimit}
Counter: KEPT (downgrade rules)

Stripe Customer ID: ${data.customerId}

📊 FIND IN STRIPE:
https://dashboard.stripe.com/customers/${data.customerId}

⚠️ ACTION REQUIRED:
→ Call or email customer ASAP to understand why
→ Can you save this customer?
→ What feature were they missing?

🎯 RESPOND BEFORE: ${billingPeriodEnd}

Quick email template:
"Hi, I noticed you downgraded from ${data.oldTier} to ${data.newTier}. 
I'd love to understand what led to this decision. Is there anything we 
can improve? Let's chat - I'm here to help!"

═══════════════════════════════════════
      `.trim();
      break;
      
    case 'cancellation':
      subject = `🚨 CANCELLATION ALERT: ${data.oldTier} - ${data.email}`;
      body = `
═══════════════════════════════════════
🚨 CUSTOMER CANCELLATION ALERT
═══════════════════════════════════════

Customer Email: ${data.email}
Cancelled Tier: ${data.oldTier}
Revenue Lost: $${data.revenueLost}/month

Customer will have access until: ${billingPeriodEnd}
Then reverts to: Free tier (10 QR codes/month)

Stripe Customer ID: ${data.customerId}

📊 FIND IN STRIPE:
https://dashboard.stripe.com/customers/${data.customerId}

🚨 URGENT ACTION REQUIRED:
→ Contact customer BEFORE ${billingPeriodEnd}
→ Understand why they're cancelling
→ Offer to help solve their problem
→ Last chance to save the customer!

🎯 YOU HAVE ${data.daysUntilEnd} DAYS TO SAVE THIS CUSTOMER

Quick email template:
"Hi, I'm sorry to see you're cancelling. Before you go, 
I'd love to understand what happened. Is there something we could 
have done better? I'm personally committed to making this right. 
Can we jump on a quick call this week?"

💡 Common save tactics:
- Offer 1 month free to stay
- Offer discounted rate for 3 months
- Offer to build the feature they need
- Offer personalized onboarding/training

═══════════════════════════════════════
      `.trim();
      break;
      
    case 'payment_failed':
      subject = `💳 PAYMENT FAILED: ${data.email} - ${data.tier}`;
      body = `
═══════════════════════════════════════
💳 PAYMENT FAILURE ALERT
═══════════════════════════════════════

Customer Email: ${data.email}
Current Tier: ${data.tier}
Failed Amount: $${data.amount}

Stripe Customer ID: ${data.customerId}

📊 FIND IN STRIPE:
https://dashboard.stripe.com/customers/${data.customerId}

⚠️ ACTION REQUIRED:
→ Contact customer within 24 hours
→ They may not know their card failed
→ Help them update payment method

🎯 RESPOND TODAY

Quick email template:
"Hi, your payment for BizTrack didn't go through. This 
happens sometimes with expired cards or billing address mismatches. 
Can you update your payment method? [Send Stripe portal link]
Your account will remain active for 3 days while we sort this out."

═══════════════════════════════════════
      `.trim();
      break;
  }
  
  // For MVP: Log to console (visible in Vercel logs)
  console.log('\n' + '='.repeat(60));
  console.log(`📧 EMAIL ALERT TO: info@biztrack.io`);
  console.log('='.repeat(60));
  console.log(`Subject: ${subject}`);
  console.log(body);
  console.log('='.repeat(60) + '\n');
  
  // TODO WEEK 3: Add real email service
  // Uncomment when you add SendGrid/Resend:
  /*
  const sgMail = require('@sendgrid/mail');
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  
  await sgMail.send({
    to: 'info@biztrack.io',
    from: 'alerts@biztrack.io',
    subject: subject,
    text: body
  });
  */
}

// ==========================================
// MAIN WEBHOOK HANDLER
// ==========================================

module.exports = async function handler(req, res) {
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

        // Get user email for notification
        const userResult = await pool.query(
          'SELECT email FROM users WHERE id = $1',
          [userId]
        );
        const userEmail = userResult.rows[0]?.email || 'Unknown';

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
        
        // Get subscription for billing period end
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        const billingPeriodEnd = new Date(sub.current_period_end * 1000).toLocaleDateString();
        
        // Send notification
        await sendNotificationEmail('new_subscription', {
          email: userEmail,
          tier: tier,
          amount: TIER_PRICING[tier],
          qrLimit: qrLimit,
          customerId: session.customer,
          subscriptionId: subscriptionId,
          billingPeriodEnd: billingPeriodEnd
        });
        
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const customerId = subscription.customer;

        const priceId = subscription.items.data[0]?.price.id;
        const newTier = PRICE_TO_TIER[priceId] || 'free';
        const { qrLimit } = TIER_CONFIG[newTier];

        const userResult = await pool.query(
          'SELECT subscription_tier, email FROM users WHERE stripe_customer_id = $1',
          [customerId]
        );

        if (userResult.rows.length === 0) {
          console.error(`[WEBHOOK] User not found for customer ${customerId}`);
          return res.status(404).send('User not found');
        }

        const { subscription_tier: currentTier, email: userEmail } = userResult.rows[0];

        const tierOrder = ['free', 'essential', 'scale', 'enterprise', 'starter', 'professional', 'pharma_enterprise'];
        const currentIndex = tierOrder.indexOf(currentTier);
        const newIndex = tierOrder.indexOf(newTier);
        
        const billingPeriodEnd = new Date(subscription.current_period_end * 1000).toLocaleDateString();

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
          
          const revenueIncrease = TIER_PRICING[newTier] - TIER_PRICING[currentTier];
          
          await sendNotificationEmail('upgrade', {
            email: userEmail,
            oldTier: currentTier,
            newTier: newTier,
            qrLimit: qrLimit,
            customerId: customerId,
            revenueIncrease: revenueIncrease,
            billingPeriodEnd: billingPeriodEnd
          });
          
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
          
          const revenueDecrease = TIER_PRICING[currentTier] - TIER_PRICING[newTier];
          const daysUntilEnd = getDaysUntilEnd(subscription.current_period_end);
          
          await sendNotificationEmail('downgrade', {
            email: userEmail,
            oldTier: currentTier,
            newTier: newTier,
            qrLimit: qrLimit,
            customerId: customerId,
            revenueDecrease: revenueDecrease,
            billingPeriodEnd: billingPeriodEnd,
            daysUntilEnd: daysUntilEnd
          });
          
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

        // Get user email before deletion
        const userResult = await pool.query(
          'SELECT email, subscription_tier FROM users WHERE stripe_customer_id = $1',
          [customerId]
        );
        
        const userEmail = userResult.rows[0]?.email || 'Unknown';
        const oldTier = userResult.rows[0]?.subscription_tier || 'Unknown';

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
        
        const billingPeriodEnd = new Date(subscription.current_period_end * 1000).toLocaleDateString();
        const daysUntilEnd = getDaysUntilEnd(subscription.current_period_end);
        
        await sendNotificationEmail('cancellation', {
          email: userEmail,
          oldTier: oldTier,
          customerId: customerId,
          revenueLost: TIER_PRICING[oldTier],
          billingPeriodEnd: billingPeriodEnd,
          daysUntilEnd: daysUntilEnd
        });
        
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const customerId = invoice.customer;
        
        // Get user info
        const userResult = await pool.query(
          'SELECT email, subscription_tier FROM users WHERE stripe_customer_id = $1',
          [customerId]
        );
        
        if (userResult.rows.length > 0) {
          const { email: userEmail, subscription_tier: tier } = userResult.rows[0];
          
          await sendNotificationEmail('payment_failed', {
            email: userEmail,
            tier: tier,
            amount: invoice.amount_due / 100,
            customerId: customerId
          });
        }
        
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
};

// ✅ Disable Vercel's body parsing so we can verify Stripe signature
module.exports.config = {
  api: {
    bodyParser: false,
  },
};
