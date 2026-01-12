// api/verify-product.js - Public product verification endpoint
// Updated for Vercel Blob storage with backwards compatibility
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

    // ==========================================
    // PHOTOS - Check multiple possible columns
    // ==========================================
    let photos = [];
    
    // New format: Vercel Blob URLs stored directly in photo_urls
    if (product.photo_urls) {
      try {
        const urls = typeof product.photo_urls === 'string' 
          ? JSON.parse(product.photo_urls) 
          : product.photo_urls;
        if (Array.isArray(urls)) {
          photos = urls;
        }
      } catch (e) {
        console.error('Error parsing photo_urls:', e);
      }
    }
    
    // Fallback: Old format with IPFS hashes
    if (photos.length === 0 && product.photo_hashes) {
      try {
        const hashes = typeof product.photo_hashes === 'string' 
          ? JSON.parse(product.photo_hashes) 
          : product.photo_hashes;
        if (Array.isArray(hashes)) {
          photos = hashes.map(hash => `https://gateway.pinata.cloud/ipfs/${hash}`);
        }
      } catch (e) {
        console.error('Error parsing photo_hashes:', e);
      }
    }

    // ==========================================
    // LOCATION DATA
    // ==========================================
    let location = null;
    if (product.location_data) {
      try {
        location = typeof product.location_data === 'string'
          ? JSON.parse(product.location_data)
          : product.location_data;
      } catch (e) {
        console.error('Error parsing location_data:', e);
      }
    }

    // ==========================================
    // METADATA
    // ==========================================
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

    // ==========================================
    // SUPPLY CHAIN CHECKPOINTS (with error handling)
    // ==========================================
    let supplyChain = null;
    try {
      const checkpointsResult = await pool.query(
        `SELECT * FROM checkpoints 
         WHERE product_id = $1 
         ORDER BY scanned_at ASC`,
        [id]
      );

      if (checkpointsResult.rows.length > 0) {
        supplyChain = {
          timeline: checkpointsResult.rows.map(cp => {
            let cpPhotos = [];
            if (cp.photo_urls) {
              try {
                cpPhotos = typeof cp.photo_urls === 'string' 
                  ? JSON.parse(cp.photo_urls) 
                  : cp.photo_urls;
              } catch (e) {}
            }

            return {
              stage: cp.location_name || cp.scanned_by_role || 'Checkpoint',
              timestamp: cp.scanned_at,
              scannedByName: cp.scanned_by_name,
              scannedByRole: cp.scanned_by_role,
              location: cp.location_name,
              latitude: cp.latitude ? parseFloat(cp.latitude) : null,
              longitude: cp.longitude ? parseFloat(cp.longitude) : null,
              notes: cp.notes,
              photos: cpPhotos
            };
          })
        };
      }
    } catch (checkpointError) {
      // Checkpoints table might not exist - that's OK
      console.log('Checkpoints query failed (table may not exist):', checkpointError.message);
    }

    // ==========================================
    // BATCH INFO
    // ==========================================
    let batchInfo = null;
    if (product.batch_group_id) {
      try {
        const batchCountResult = await pool.query(
          `SELECT COUNT(*) as count FROM products WHERE batch_group_id = $1`,
          [product.batch_group_id]
        );
        
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
      } catch (batchError) {
        console.error('Error getting batch info:', batchError);
      }
    }

    // ==========================================
    // REWARDS STATUS
    // ==========================================
    let rewards = null;
    if (product.rewards_enabled) {
      try {
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
      } catch (rewardsError) {
        console.log('Rewards query failed (table may not exist):', rewardsError.message);
      }
    }

    // ==========================================
    // QR CODE URL - Check multiple possible columns
    // ==========================================
    let qrCodeUrl = product.qr_code_url || null;
    // Fallback to IPFS hash if URL not present
    if (!qrCodeUrl && product.qr_code_ipfs_hash) {
      qrCodeUrl = `https://gateway.pinata.cloud/ipfs/${product.qr_code_ipfs_hash}`;
    }

    let inventoryQrCodeUrl = product.inventory_qr_code_url || null;
    if (!inventoryQrCodeUrl && product.inventory_qr_code_ipfs_hash) {
      inventoryQrCodeUrl = `https://gateway.pinata.cloud/ipfs/${product.inventory_qr_code_ipfs_hash}`;
    }

    // ==========================================
    // BUILD RESPONSE
    // ==========================================
    const response = {
      success: true,
      product: {
        productId: product.product_id,
        productName: product.product_name,
        sku: product.sku,
        batchNumber: product.batch_number,
        createdAt: product.created_at,
        finalizedAt: product.finalized_at,
        mode: product.mode,
        isFinalized: product.is_finalized,
        
        // Blockchain info
        xrplTxHash: product.xrpl_tx_hash,
        ipfsHash: product.ipfs_hash,
        dataHash: metadata.dataHash || null,
        
        // QR code URLs
        qrCodeUrl: qrCodeUrl,
        inventoryQrCodeUrl: inventoryQrCodeUrl,
        
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
