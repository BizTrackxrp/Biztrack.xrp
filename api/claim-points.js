// api/claim-points.js - Claim loyalty points for a product/batch
// FIXED: Now checks product-level custom points first, then business default
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { productId, batchGroupId, email } = req.body;

    if (!productId) {
      return res.status(400).json({ error: 'Product ID is required' });
    }

    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email is required' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Get the product to find the business
    const productResult = await pool.query(
      `SELECT p.*, u.rewards_enabled, u.points_per_claim as default_points, u.rewards_program_name, u.business_name
       FROM products p
       JOIN users u ON p.user_id = u.id
       WHERE p.product_id = $1`,
      [productId]
    );

    if (productResult.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const product = productResult.rows[0];
    const businessId = product.user_id;

    // Check if rewards are enabled for this business
    if (!product.rewards_enabled) {
      return res.status(400).json({ error: 'Rewards program not enabled for this business' });
    }

    // ==========================================
    // FIXED: Check product-level points FIRST
    // Priority: product.metadata.rewardPoints > user.points_per_claim > 10
    // ==========================================
    let pointsToAward = product.default_points || 10;
    
    // Check if product has custom points in metadata
    if (product.metadata) {
      try {
        const metadata = typeof product.metadata === 'string' 
          ? JSON.parse(product.metadata) 
          : product.metadata;
        
        // Check for custom reward points (set during minting)
        if (metadata.rewardPoints && !isNaN(parseInt(metadata.rewardPoints))) {
          pointsToAward = parseInt(metadata.rewardPoints);
          console.log(`[REWARDS] Using product-level points: ${pointsToAward}`);
        }
      } catch (e) {
        console.error('Error parsing product metadata:', e);
      }
    }

    // Determine claim key (batch_group_id for batches, product_id for singles)
    // For batches, ANY product in the batch can trigger the claim, but only once per batch
    const claimKey = batchGroupId || productId;
    const claimType = batchGroupId ? 'batch' : 'product';

    // Check if already claimed
    const existingClaim = await pool.query(
      `SELECT * FROM points_claims WHERE claim_key = $1`,
      [claimKey]
    );

    if (existingClaim.rows.length > 0) {
      return res.status(400).json({ 
        error: 'Points already claimed',
        message: `This ${claimType} has already been claimed.`,
        claimedBy: existingClaim.rows[0].customer_email.replace(/(.{2}).*(@.*)/, '$1***$2'),
        claimedAt: existingClaim.rows[0].claimed_at
      });
    }

    // Start transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Create or update customer points record
      const upsertCustomer = await client.query(
        `INSERT INTO customer_points (email, business_id, total_points)
         VALUES ($1, $2, $3)
         ON CONFLICT (email, business_id)
         DO UPDATE SET 
           total_points = customer_points.total_points + $3,
           updated_at = NOW()
         RETURNING total_points`,
        [normalizedEmail, businessId, pointsToAward]
      );

      const totalPoints = upsertCustomer.rows[0].total_points;

      // Record the claim
      await client.query(
        `INSERT INTO points_claims (claim_key, product_id, batch_group_id, customer_email, points_awarded, business_id, claim_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [claimKey, productId, batchGroupId || null, normalizedEmail, pointsToAward, businessId, claimType]
      );

      await client.query('COMMIT');

      return res.status(200).json({
        success: true,
        pointsAwarded: pointsToAward,
        totalPoints: totalPoints,
        message: `You earned ${pointsToAward} points!`,
        businessName: product.business_name,
        programName: product.rewards_program_name
      });

    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('Claim points error:', error);
    return res.status(500).json({
      error: 'Failed to claim points',
      details: error.message
    });
  }
};
