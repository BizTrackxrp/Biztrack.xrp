// api/create-checkout-session.js - Create Stripe Checkout Session
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const stripeConfig = require('../stripe-config');

const stripe = require('stripe')(stripeConfig.stripeSecretKey);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get auth token
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
    const { tier } = req.body; // 'essential', 'scale', or 'enterprise'

    // Validate tier
    if (!['essential', 'scale', 'enterprise'].includes(tier)) {
      return res.status(400).json({ error: 'Invalid subscription tier' });
    }

    const tierConfig = stripeConfig.getTierConfig(tier);
    
    if (!tierConfig.priceId) {
      return res.status(400).json({ error: 'Price ID not configured for this tier' });
    }

    // Create or retrieve Stripe customer
    let customerId = user.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          userId: user.id.toString(),
          companyName: user.company_name || ''
        }
      });
      customerId = customer.id;

      // Save customer ID to database
      await pool.query(
        'UPDATE users SET stripe_customer_id = $1 WHERE id = $2',
        [customerId, user.id]
      );
    }

    // Create Checkout Session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: tierConfig.priceId,
          quantity: 1,
        },
      ],
      success_url: `${req.headers.origin || 'https://www.biztrack.io'}/subscription-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin || 'https://www.biztrack.io'}/dashboard.html?upgrade=cancelled`,
      metadata: {
        userId: user.id.toString(),
        tier: tier
      },
      subscription_data: {
        metadata: {
          userId: user.id.toString(),
          tier: tier
        }
      }
    });

    return res.status(200).json({
      success: true,
      sessionId: session.id,
      checkoutUrl: session.url
    });

  } catch (error) {
    console.error('Checkout session error:', error);
    return res.status(500).json({
      error: 'Failed to create checkout session',
      details: error.message
    });
  }
};
