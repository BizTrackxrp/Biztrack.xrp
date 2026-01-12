// api/rewards-leaderboard.js - Get customer points leaderboard for a business
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Authenticate
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const businessId = decoded.userId;

    // Get business rewards settings
    const businessResult = await pool.query(
      `SELECT rewards_enabled, points_per_claim, rewards_program_name, business_name
       FROM users WHERE id = $1`,
      [businessId]
    );

    if (businessResult.rows.length === 0) {
      return res.status(404).json({ error: 'Business not found' });
    }

    const business = businessResult.rows[0];

    // Get leaderboard (customers sorted by points)
    const leaderboardResult = await pool.query(
      `SELECT 
        cp.email,
        cp.total_points,
        cp.created_at as first_claim,
        cp.updated_at as last_activity,
        (SELECT COUNT(*) FROM points_claims pc WHERE pc.customer_email = cp.email AND pc.business_id = $1) as total_claims
       FROM customer_points cp
       WHERE cp.business_id = $1
       ORDER BY cp.total_points DESC
       LIMIT 100`,
      [businessId]
    );

    // Get summary stats
    const statsResult = await pool.query(
      `SELECT 
        COUNT(DISTINCT cp.email) as total_customers,
        COALESCE(SUM(cp.total_points), 0) as total_points_awarded,
        COUNT(pc.id) as total_claims
       FROM customer_points cp
       LEFT JOIN points_claims pc ON pc.business_id = cp.business_id
       WHERE cp.business_id = $1`,
      [businessId]
    );

    const stats = statsResult.rows[0];

    // Get recent claims
    const recentClaimsResult = await pool.query(
      `SELECT 
        pc.customer_email,
        pc.points_awarded,
        pc.claim_type,
        pc.claimed_at,
        p.product_name
       FROM points_claims pc
       JOIN products p ON pc.product_id = p.product_id
       WHERE pc.business_id = $1
       ORDER BY pc.claimed_at DESC
       LIMIT 10`,
      [businessId]
    );

    return res.status(200).json({
      success: true,
      settings: {
        rewardsEnabled: business.rewards_enabled,
        pointsPerClaim: business.points_per_claim,
        programName: business.rewards_program_name,
        businessName: business.business_name
      },
      stats: {
        totalCustomers: parseInt(stats.total_customers) || 0,
        totalPointsAwarded: parseInt(stats.total_points_awarded) || 0,
        totalClaims: parseInt(stats.total_claims) || 0
      },
      leaderboard: leaderboardResult.rows.map(row => ({
        email: row.email,
        points: row.total_points,
        claims: parseInt(row.total_claims) || 0,
        firstClaim: row.first_claim,
        lastActivity: row.last_activity
      })),
      recentClaims: recentClaimsResult.rows.map(row => ({
        email: row.customer_email,
        points: row.points_awarded,
        claimType: row.claim_type,
        claimedAt: row.claimed_at,
        productName: row.product_name
      }))
    });

  } catch (error) {
    console.error('Rewards leaderboard error:', error);
    return res.status(500).json({
      error: 'Failed to load leaderboard',
      details: error.message
    });
  }
};
