// api/rewards-leaderboard.js - Get rewards dashboard data for a business
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
    const decoded = jwt.verify(token, JWT_SECRET);
    const businessId = decoded.userId;

    // ==========================================
    // CUSTOMER LEADERBOARD
    // ==========================================
    const leaderboardResult = await pool.query(
      `SELECT 
        email,
        total_points,
        created_at,
        updated_at,
        (SELECT COUNT(*) FROM points_claims pc WHERE pc.customer_email = cp.email AND pc.business_id = $1) as claim_count
       FROM customer_points cp
       WHERE business_id = $1
       ORDER BY total_points DESC
       LIMIT 50`,
      [businessId]
    );

    // ==========================================
    // SUMMARY STATS
    // ==========================================
    
    // Total customers (unique emails with points)
    const customersResult = await pool.query(
      `SELECT COUNT(DISTINCT email) as count FROM customer_points WHERE business_id = $1`,
      [businessId]
    );
    
    // Total points CLAIMED (actually given out)
    const claimedPointsResult = await pool.query(
      `SELECT COALESCE(SUM(points_awarded), 0) as total FROM points_claims WHERE business_id = $1`,
      [businessId]
    );
    
    // Total claims made
    const totalClaimsResult = await pool.query(
      `SELECT COUNT(*) as count FROM points_claims WHERE business_id = $1`,
      [businessId]
    );

    // ==========================================
    // PRODUCTS WITH REWARDS (claimed vs unclaimed)
    // ==========================================
    
    // Get all products that have rewards enabled (live/finalized products)
    // A product has rewards if the business has rewards_enabled = true
    const productsWithRewardsResult = await pool.query(
      `SELECT 
        p.product_id,
        p.product_name,
        p.sku,
        p.batch_number,
        p.batch_group_id,
        p.qr_code_url,
        p.created_at,
        p.metadata,
        CASE 
          WHEN pc.claim_key IS NOT NULL THEN true 
          ELSE false 
        END as is_claimed,
        pc.customer_email as claimed_by,
        pc.claimed_at,
        pc.points_awarded
       FROM products p
       LEFT JOIN points_claims pc ON (
         pc.claim_key = COALESCE(p.batch_group_id, p.product_id)
       )
       WHERE p.user_id = $1 
         AND p.is_finalized = true
         AND p.mode = 'live'
       ORDER BY p.created_at DESC
       LIMIT 100`,
      [businessId]
    );

    // Process products to extract reward points from metadata
    const products = productsWithRewardsResult.rows.map(p => {
      let rewardPoints = null;
      if (p.metadata) {
        try {
          const metadata = typeof p.metadata === 'string' ? JSON.parse(p.metadata) : p.metadata;
          rewardPoints = metadata.rewardPoints || null;
        } catch (e) {}
      }
      return {
        productId: p.product_id,
        productName: p.product_name,
        sku: p.sku,
        batchNumber: p.batch_number,
        batchGroupId: p.batch_group_id,
        qrCodeUrl: p.qr_code_url,
        createdAt: p.created_at,
        rewardPoints: rewardPoints,
        isClaimed: p.is_claimed,
        claimedBy: p.claimed_by ? p.claimed_by.replace(/(.{2}).*(@.*)/, '$1***$2') : null,
        claimedAt: p.claimed_at,
        pointsAwarded: p.points_awarded
      };
    });

    // Split into claimed and unclaimed
    const claimedProducts = products.filter(p => p.isClaimed);
    const unclaimedProducts = products.filter(p => !p.isClaimed);

    // Calculate unclaimed points potential
    // For unclaimed products, estimate points based on their metadata or default
    const userResult = await pool.query(
      `SELECT points_per_claim FROM users WHERE id = $1`,
      [businessId]
    );
    const defaultPoints = userResult.rows[0]?.points_per_claim || 10;

    let unclaimedPointsPotential = 0;
    unclaimedProducts.forEach(p => {
      unclaimedPointsPotential += p.rewardPoints || defaultPoints;
    });

    // ==========================================
    // RECENT CLAIMS (activity feed)
    // ==========================================
    const recentClaimsResult = await pool.query(
      `SELECT 
        pc.customer_email,
        pc.points_awarded,
        pc.claimed_at,
        pc.claim_type,
        p.product_name,
        p.sku
       FROM points_claims pc
       JOIN products p ON pc.product_id = p.product_id
       WHERE pc.business_id = $1
       ORDER BY pc.claimed_at DESC
       LIMIT 10`,
      [businessId]
    );

    const recentClaims = recentClaimsResult.rows.map(c => ({
      email: c.customer_email.replace(/(.{2}).*(@.*)/, '$1***$2'),
      points: c.points_awarded,
      claimedAt: c.claimed_at,
      claimType: c.claim_type,
      productName: c.product_name,
      sku: c.sku
    }));

    return res.status(200).json({
      success: true,
      
      // Summary metrics
      stats: {
        totalCustomers: parseInt(customersResult.rows[0].count) || 0,
        pointsClaimed: parseInt(claimedPointsResult.rows[0].total) || 0,
        pointsUnclaimed: unclaimedPointsPotential,
        totalClaims: parseInt(totalClaimsResult.rows[0].count) || 0,
        productsWithRewards: products.length,
        productsClaimed: claimedProducts.length,
        productsUnclaimed: unclaimedProducts.length
      },
      
      // Customer leaderboard
      leaderboard: leaderboardResult.rows.map(row => ({
        email: row.email,
        points: row.total_points,
        claims: parseInt(row.claim_count) || 0,
        joinedAt: row.created_at,
        lastActivity: row.updated_at
      })),
      
      // Products breakdown
      claimedProducts,
      unclaimedProducts,
      
      // Recent activity
      recentClaims
    });

  } catch (error) {
    console.error('Rewards leaderboard error:', error);
    return res.status(500).json({
      error: 'Failed to fetch rewards data',
      details: error.message
    });
  }
};
