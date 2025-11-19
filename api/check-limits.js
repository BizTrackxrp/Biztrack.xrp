// api/check-limits.js - WITH PHARMA TIERS + PROPER BATCH LOGIC
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

// UPDATED: New 3-tier pharma system (GENEROUS LIMITS)
const LIMITS = {
  free: 10,
  // GENERAL BUSINESS TIERS (unchanged)
  essential: 500,
  scale: 2500,
  enterprise: 10000,
  // PHARMA TIERS (updated - GENEROUS!)
  starter: 1000,             // NEW - $199/month - 1,000 QR codes
  professional: 5000,        // RENAMED from "compliance" - $599/month - 5,000 QR codes
  pharma_enterprise: 50000   // RENAMED to "enterprise" - $1,499/month - 50,000 QR codes
};

module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    // Get auth token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];
    let decoded;
    
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      console.error('[CHECK-LIMITS] JWT verification failed:', err.message);
      return res.status(401).json({ error: 'Invalid token' });
    }

    // Get user - including business_type and pharma flags
    const result = await pool.query(
      `SELECT 
        id, 
        email, 
        subscription_tier, 
        qr_codes_used, 
        qr_codes_limit, 
        business_type, 
        is_pharma,
        company_name
       FROM users 
       WHERE id = $1`,
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];
    const tier = user.subscription_tier || 'free';
    
    // Use qr_codes_limit from DB if set, otherwise use tier default
    const qrLimit = user.qr_codes_limit || LIMITS[tier] || 10;
    const qrCodesUsed = user.qr_codes_used || 0;
    
    // Calculate remaining codes
    const remaining = qrLimit - qrCodesUsed;

    // 🎯 FIXED: Max batch size = REMAINING codes (not arbitrary tier limits)
    // If you paid for 50k and used 1, you can batch 49,999!
    const maxBatchSize = remaining;

    console.log('[CHECK-LIMITS] ✅ Success:', {
      userId: user.id,
      tier: tier,
      used: qrCodesUsed,
      limit: qrLimit,
      remaining: remaining,
      maxBatch: maxBatchSize
    });

    return res.status(200).json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        company_name: user.company_name,
        business_type: user.business_type || 'general',
        is_pharma: user.is_pharma || false
      },
      subscription: {
        tier: tier,
        qrLimit: qrLimit,
        qrUsed: qrCodesUsed,
        remaining: remaining,
        maxBatchSize: maxBatchSize,  // 🎯 Now equals remaining!
        status: 'active'
      }
    });

  } catch (error) {
    console.error('[CHECK-LIMITS] ❌ Error:', error);
    return res.status(500).json({
      error: 'Failed to check limits',
      details: error.message
    });
  } finally {
    try {
      await pool.end();
    } catch (e) {
      console.error('[CHECK-LIMITS] Pool end error:', e);
    }
  }
};
