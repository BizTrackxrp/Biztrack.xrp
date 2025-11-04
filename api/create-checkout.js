// pages/api/create-checkout.js
import Stripe from 'stripe';
import jwt from 'jsonwebtoken';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-10-22.acacia',
});

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
  return res.status(405).json({ error: 'Method not allowed' });
  }

  // === 1. GET JWT FROM AUTH HEADER ===
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];

  let userId;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    userId = decoded.userId;
    if (!userId) throw new Error('No userId in token');
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // === 2. GET PRICE ID ===
  const { priceId } = req.body;
  if (!priceId) {
    return res.status(400).json({ error: 'priceId is required' });
  }

  // === 3. CREATE CHECKOUT SESSION ===
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${process.env.NEXT_PUBLIC_BASE_URL}/dashboard?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_BASE_URL}/dashboard?canceled=true`,

      // THIS MAKES YOUR WEBHOOK WORK
      metadata: {
        userId: userId.toString(),
      },
      client_reference_id: userId.toString(),
    });

    return res.status(200).json({ sessionId: session.id });
  } catch (error) {
    console.error('[CHECKOUT ERROR]:', error);
    return res.status(500).json({ error: error.message });
  }
}
