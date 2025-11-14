// api/user/profile.js - Returns user profile including business_type
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ 
      success: false,
      error: 'Method not allowed' 
    });
  }

  try {
    // Get auth token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        success: false,
        error: 'Unauthorized - No token provided' 
      });
    }

    const token = authHeader.split(' ')[1];
    
    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (error) {
      return res.status(401).json({ 
        success: false,
        error: 'Invalid or expired token' 
      });
    }

    // Get user from database
    const result = await pool.query(
      `SELECT 
        id, 
        email, 
        company_name, 
        business_type, 
        subscription_tier, 
        qr_codes_used, 
        qr_codes_limit,
        created_at
      FROM users 
      WHERE id = $1`,
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false,
        error: 'User not found' 
      });
    }

    const user = result.rows[0];

    // Return user profile
    return res.status(200).json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        companyName: user.company_name,
        businessType: user.business_type || 'general', // Default to general if null
        subscriptionTier: user.subscription_tier || 'free',
        qrCodesUsed: user.qr_codes_used || 0,
        qrCodesLimit: user.qr_codes_limit || 10,
        createdAt: user.created_at
      }
    });

  } catch (error) {
    console.error('User profile fetch error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch user profile',
      details: error.message
    });
  } finally {
    try {
      await pool.end();
    } catch (e) {
      console.error('Pool end error:', e);
    }
  }
};
