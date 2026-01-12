// api/verify-product.js - Public product verification endpoint
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { id } = req.query;

    if (!id) {
      return res.status(400).json({ 
        success: false,
        error: 'Product ID is required' 
      });
    }

    // Get product with business info
    const result = await pool.query(
      `SELECT 
        p.*,
        u.rewards_enabled,
        u.points_per_claim,
        u.rewards_program_name,
        u.business_name
       FROM products p
       JOIN users u ON p.user_id = u.id
       WHERE p.product_id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false,
        error: 'Product not found' 
      });
    }

    const product = result.rows[0];

    // Build photo URLs from stored hashes
    let photos = [];
    if (product.photo_hashes) {
      try {
        const hashes = typeof product.photo_hashes === 'string' 
          ? JSON.parse(product.photo_hashes) 
          : product.photo_hashes;
        photos = hashes.map(hash => `https://gateway.pinata.cloud/ipfs/${hash}`);
      } catch (e) {
        console.error('Error parsing photo hashes:', e);
      }
    }

    // Parse location data
    let location = null;
    if (product.location_data) {
      try {
        location = typeof product.location_data === 'string'
          ? JSON.parse(product.location_data)
          : product.location_data;
      } catch (e) {
        console.error('Error parsing location data:', e);
      }
    }

    // Parse metadata
    let metadata = {};
    if (product.metadata) {
      try {
        metadata = typeof product.metadata === 'string'
          ? JSON.parse(product.metadata)
          : product.metadata;
      } catch (e) {
        console.error('Error parsing metadata:', e);
      }
    }

    // Get supply chain checkpoints if this is a finalized production product
    let supplyChain = null;
    if (product.mode === 'production' || product.checkpoints) {
      const checkpointsResult = await pool.query(
        `SELECT * FROM checkpoints 
         WHERE product_id = $1 
         ORDER BY scanned_at ASC`,
        [id]
      );

      if (checkpointsResult.rows.length > 0) {
        supplyChain = {
          timeline: checkpointsResult.rows.map(cp => ({
            scannedAt: cp.scanned_at,
            scannedByName: cp.scanned_by_name,
            scannedByRole: cp.scanned_by_role,
            locationName: cp.location_name,
            latitude: cp.latitude,
            longitude: cp.longitude,
            notes: cp.notes,
            photos: cp.photo_urls ? (typeof cp.photo_urls === 'string' ? JSON.parse(cp.photo_urls) : cp.photo_urls) : []
          }))
        };
      }
    }

    // Build batch info if applicable
    let batchInfo = null;
    if (product.batch_group_id) {
      // Get count of items in this batch
      const batchCountResult = await pool.query(
        `SELECT COUNT(*) as count FROM products WHERE batch_group_id = $1`,
        [product.batch_group_id]
      );
      
      // Get position in batch (simplified - based on creation order)
      const positionResult = await pool.query(
        `SELECT COUNT(*) as position FROM products 
         WHERE batch_group_id = $1 AND created_at <= $2`,
        [product.batch_group_id, product.created_at]
      );

      batchInfo = {
        isBatchOrder: true,
        itemNumber: parseInt(positionResult.rows[0].position) || 1,
        totalInBatch: parseInt(batchCountResult.rows[0].count) || product.batch_quantity || 1,
        batchGroupId: product.batch_group_id
      };
    }

    // Check rewards status
    let rewards = null;
    if (product.rewards_enabled) {
      const claimKey = product.batch_group_id || product.product_id;
      
      const claimResult = await pool.query(
        `SELECT * FROM points_claims WHERE claim_key = $1`,
        [claimKey]
      );

      rewards = {
        enabled: true,
        pointsPerClaim: product.points_per_claim || 10,
        programName: product.rewards_program_name || 'Loyalty Rewards',
        businessName: product.business_name,
        claimType: product.batch_group_id ? 'batch' : 'product',
        alreadyClaimed: claimResult.rows.length > 0,
        claimedAt: claimResult.rows.length > 0 ? claimResult.rows[0].claimed_at : null
      };
    }

    // Build response
    const response = {
      success: true,
      product: {
        productId: product.product_id,
        productName: product.product_name,
        sku: product.sku,
        batchNumber: product.batch_number,
        timestamp: product.created_at,
        finalizedAt: product.finalized_at,
        mode: product.mode,
        isFinalized: product.is_finalized,
        
        // Blockchain info
        xrplTxHash: product.xrpl_tx_hash,
        ipfsHash: product.ipfs_hash,
        ipfsUrl: product.ipfs_hash ? `https://gateway.pinata.cloud/ipfs/${product.ipfs_hash}` : null,
        
        // QR codes
        qrCodeUrl: product.qr_code_ipfs_hash ? `https://gateway.pinata.cloud/ipfs/${product.qr_code_ipfs_hash}` : null,
        inventoryQrCodeUrl: product.inventory_qr_code_ipfs_hash ? `https://gateway.pinata.cloud/ipfs/${product.inventory_qr_code_ipfs_hash}` : null,
        
        // Rich data
        photos,
        location,
        metadata,
        supplyChain,
        batchInfo
      }
    };

    // Add rewards if enabled
    if (rewards) {
      response.rewards = rewards;
    }

    return res.status(200).json(response);

  } catch (error) {
    console.error('Verify product error:', error);
    return res.status(500).json({
      success: false,
      error: 'Verification failed',
      details: error.message
    });
  }
};
