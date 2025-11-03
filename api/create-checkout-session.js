// api/create-checkout-session.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

// Stripe Price IDs from your Stripe dashboard
const STRIPE_PRICES = {
  essential: 'price_1SPSCoRzdZsHMZRF5IBmTG6s',  // Essential $49
  scale: 'price_1SPSC3RzdZsHMZRFraOq6siQ',      // Scale $149
  enterprise: 'price_1SPSBRRzdZsHMZRFyFx0E3Ez'  // Enterprise $399
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

    if (!tier || !['essential', 'scale', 'enterprise'].includes(tier)) {
      return res.status(400).json({ error: 'Invalid tier' });
    }

    // Get Stripe price ID for the tier
    const priceId = STRIPE_PRICES[tier];

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
      success_url: `${process.env.FRONTEND_URL || 'https://www.biztrack.io'}/dashboard.html?session_id={CHECKOUT_SESSION_ID}&upgrade=success`,
      cancel_url: `${process.env.FRONTEND_URL || 'https://www.biztrack.io'}/pricing.html?canceled=true`,
      metadata: {
        userId: user.id.toString(),
        tier: tier
      },
      subscription_data: {
        proration_behavior: 'create_prorations',  // ✅ Enable automatic proration
        metadata: {
          userId: user.id.toString(),
          tier: tier
        }
      }
    });

    return res.status(200).json({
      url: session.url,
      sessionId: session.id
    });

  } catch (error) {
    console.error('Checkout session creation error:', error);
    return res.status(500).json({
      error: 'Failed to create checkout session',
      details: error.message
    });
  }
};
