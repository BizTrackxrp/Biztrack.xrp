// api/create-checkout-session.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

// ✅ STRIPE PRICE IDS (TEST MODE)
const STRIPE_PRICES = {
  // General Business Tiers
  essential: 'price_1SUukV2Kvkd8Qy8OIgqAGV3k',      // $49/mo
  scale: 'price_1SUuko2Kvkd8Qy8OemmtHbZb',          // $149/mo
  enterprise: 'price_1SUulO2Kvkd8Qy8O0IiV9vmh',     // $399/mo
  
  // Pharma Tiers
  starter: 'price_1SVJEC2Kvkd8Qy8O1LTwpw50', // $199/mo - 1,000 QR codes
  professional: 'price_1SUulu2Kvkd8Qy8O0qAlY4w3',   // $599/mo - 5,000 QR codes
  pharma_enterprise: 'price_1SUum52Kvkd8Qy8Oq5W9t6hT' // $1,499/mo - 50,000 QR codes
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Authenticate user
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    // Get user from database
    const userResult = await pool.query(
      'SELECT * FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];
    const { tier } = req.body;

    // Validate tier
    const validTiers = ['essential', 'scale', 'enterprise', 'starter', 'professional', 'pharma_enterprise'];
    
    if (!tier || !validTiers.includes(tier)) {
      return res.status(400).json({ 
        error: 'Invalid tier',
        validTiers: validTiers 
      });
    }

    // Get Stripe price ID for the tier
    const priceId = STRIPE_PRICES[tier];
    
    if (!priceId) {
      console.error('[CHECKOUT] Missing price ID for tier:', tier);
      return res.status(400).json({ 
        error: 'Price ID not configured for this tier',
        tier: tier
      });
    }

    // Determine success URL based on business type or tier
    const isPharma = user.business_type === 'pharma' || 
                     tier === 'starter' || 
                     tier === 'professional' || 
                     tier === 'pharma_enterprise';
    
    const successUrl = isPharma 
      ? `${process.env.FRONTEND_URL || 'https://www.biztrack.io'}/pharma-dashboard.html?session_id={CHECKOUT_SESSION_ID}&upgrade=success`
      : `${process.env.FRONTEND_URL || 'https://www.biztrack.io'}/dashboard.html?session_id={CHECKOUT_SESSION_ID}&upgrade=success`;
    
    const cancelUrl = isPharma
      ? `${process.env.FRONTEND_URL || 'https://www.biztrack.io'}/SI-pharma-pricing.html?canceled=true`
      : `${process.env.FRONTEND_URL || 'https://www.biztrack.io'}/pricing.html?canceled=true`;

    console.log('[CHECKOUT] Creating session for:', {
      userId: user.id,
      email: user.email,
      tier: tier,
      priceId: priceId,
      isPharma: isPharma
    });

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      customer_email: user.email,
      client_reference_id: user.id.toString(),
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        userId: user.id.toString(),
        tier: tier,
        businessType: user.business_type || 'general'
      },
      subscription_data: {
        metadata: {
          userId: user.id.toString(),
          tier: tier,
          businessType: user.business_type || 'general'
        }
      }
    });

    console.log('[CHECKOUT] ✅ Session created:', session.id);

    return res.status(200).json({
      url: session.url,
      sessionId: session.id,
      success: true
    });

  } catch (error) {
    console.error('[CHECKOUT] ❌ Error:', error);
    return res.status(500).json({
      error: 'Failed to create checkout session',
      details: error.message
    });
  }
};
