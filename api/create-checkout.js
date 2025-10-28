// api/create-checkout.js - Create Stripe Checkout Session
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

// Stripe Price IDs (set these in your environment variables)
const PRICE_IDS = {
  essential: process.env.STRIPE_PRICE_ESSENTIAL || 'price_essential',
  scale: process.env.STRIPE_PRICE_SCALE || 'price_scale',
  enterprise: process.env.STRIPE_PRICE_ENTERPRISE || 'price_enterprise'
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
      'SELECT id, email, subscription_tier FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];
    const { tier, discountCode } = req.body;

    if (!tier || !PRICE_IDS[tier]) {
      return res.status(400).json({ error: 'Invalid tier' });
    }

    // Create Stripe checkout session
    const sessionParams = {
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: PRICE_IDS[tier],
          quantity: 1,
        },
      ],
      success_url: `${process.env.BASE_URL || 'https://www.biztrack.io'}/dashboard.html?upgrade=success`,
      cancel_url: `${process.env.BASE_URL || 'https://www.biztrack.io'}/pricing.html?upgrade=cancelled`,
      customer_email: user.email,
      client_reference_id: user.id.toString(),
      metadata: {
        userId: user.id,
        tier: tier,
        previousTier: user.subscription_tier
      }
    };

    // Apply discount code if provided
    if (discountCode) {
      // Validate discount code
      const validateResponse = await fetch(`${process.env.BASE_URL || ''}/api/validate-discount`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ code: discountCode, tier })
      });

      const discountData = await validateResponse.json();
      
      if (discountData.valid) {
        // Create or get Stripe coupon
        try {
          const coupon = await stripe.coupons.create({
            percent_off: discountData.discount.percentage,
            duration: 'once', // Apply only to first payment
            name: discountData.discount.description
          });
          
          sessionParams.discounts = [{ coupon: coupon.id }];
        } catch (error) {
          console.error('Error creating coupon:', error);
          // Continue without discount if coupon creation fails
        }
      }
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    return res.status(200).json({
      success: true,
      checkoutUrl: session.url,
      sessionId: session.id
    });

  } catch (error) {
    console.error('Checkout creation error:', error);
    return res.status(500).json({
      error: 'Failed to create checkout session',
      details: error.message
    });
  }
};
