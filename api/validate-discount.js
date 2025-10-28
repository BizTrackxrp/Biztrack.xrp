// api/validate-discount.js - Validate Discount Codes
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

// Hardcoded discount codes (you can move these to database later)
const DISCOUNT_CODES = {
  'UPGRADE50': {
    percentage: 50,
    description: 'Special Upgrade Discount',
    validUntil: '2026-12-31',
    maxUses: null, // unlimited
    usedCount: 0
  },
  'ESSENTIAL25': {
    percentage: 25,
    description: 'Essential Plan Discount',
    validUntil: '2026-12-31',
    tiers: ['essential'], // Only valid for essential tier
    maxUses: null,
    usedCount: 0
  },
  'SCALE30': {
    percentage: 30,
    description: 'Scale Plan Discount',
    validUntil: '2026-12-31',
    tiers: ['scale'],
    maxUses: null,
    usedCount: 0
  },
  'TESTING100': {
    percentage: 100,
    description: 'Testing - Free Upgrade',
    validUntil: '2026-12-31',
    maxUses: 100,
    usedCount: 0
  }
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

    const { code, tier } = req.body;

    if (!code) {
      return res.status(400).json({ error: 'Discount code is required' });
    }

    const upperCode = code.toUpperCase();
    const discount = DISCOUNT_CODES[upperCode];

    if (!discount) {
      return res.status(200).json({ 
        valid: false,
        message: 'Invalid discount code'
      });
    }

    // Check if code is expired
    const now = new Date();
    const validUntil = new Date(discount.validUntil);
    if (now > validUntil) {
      return res.status(200).json({ 
        valid: false,
        message: 'Discount code has expired'
      });
    }

    // Check if max uses reached
    if (discount.maxUses !== null && discount.usedCount >= discount.maxUses) {
      return res.status(200).json({ 
        valid: false,
        message: 'Discount code has reached maximum uses'
      });
    }

    // Check if tier-specific and matches
    if (discount.tiers && tier && !discount.tiers.includes(tier)) {
      return res.status(200).json({ 
        valid: false,
        message: `This code is only valid for ${discount.tiers.join(', ')} plans`
      });
    }

    // Valid!
    return res.status(200).json({
      valid: true,
      discount: {
        code: upperCode,
        percentage: discount.percentage,
        description: discount.description,
        tiers: discount.tiers || null
      }
    });

  } catch (error) {
    console.error('Discount validation error:', error);
    return res.status(500).json({
      error: 'Failed to validate discount code',
      details: error.message
    });
  }
};
