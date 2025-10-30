// api/test-set-tier.js
// ⚠️ DELETE THIS FILE BEFORE PRODUCTION ⚠️
// This is for TESTING ONLY - allows manual tier changes without Stripe

const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

module.exports = async (req, res) => {
  // ⚠️ TEST ENDPOINT - DELETE BEFORE LAUNCH ⚠️
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let pool;
  
  try {
    // Create pool with detailed error handling
    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    
    if (!connectionString) {
      return res.status(500).json({ 
        error: 'Database connection string not configured',
        details: 'DATABASE_URL or POSTGRES_URL environment variable is missing'
      });
    }

    pool = new Pool({
      connectionString: connectionString,
      ssl: { rejectUnauthorized: false }
    });

    // Get auth token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        error: 'Unauthorized',
        details: 'No authorization header found' 
      });
    }

    const token = authHeader.split(' ')[1];
    let decoded;
    
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (jwtError) {
      return res.status(401).json({ 
        error: 'Invalid token',
        details: jwtError.message 
      });
    }

    const { tier } = req.body;

    // Validate tier
    if (!['free', 'essential', 'scale', 'enterprise'].includes(tier)) {
      return res.status(400).json({ 
        error: 'Invalid tier',
        details: `Tier must be one of: free, essential, scale, enterprise. Got: ${tier}`
      });
    }

    // Update user's tier
    const result = await pool.query(
      'UPDATE users SET subscription_tier = $1 WHERE id = $2 RETURNING *',
      [tier, decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'User not found',
        details: `No user found with ID: ${decoded.userId}`
      });
    }

    console.log(`[TEST] User ${decoded.userId} tier changed to: ${tier}`);

    return res.status(200).json({
      success: true,
      tier: tier,
      message: `Tier changed to ${tier} (TEST MODE ONLY)`,
      user: {
        id: result.rows[0].id,
        email: result.rows[0].email,
        newTier: result.rows[0].subscription_tier
      }
    });

  } catch (error) {
    console.error('Test set tier error:', error);
    return res.status(500).json({
      error: 'Failed to set tier',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  } finally {
    if (pool) {
      await pool.end();
    }
  }
};
