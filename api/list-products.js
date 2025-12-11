// api/list-products.js - Get all products for logged-in user
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
    // Get auth token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.userId;

    // Fetch all products for this user with checkpoint counts
    const result = await pool.query(
      `SELECT 
        p.id,
        p.product_id,
        p.product_name,
        p.sku,
        p.batch_number,
        p.qr_code_url,
        p.inventory_qr_code_url,
        p.gs1_qr_code_url,
        p.xrpl_tx_hash,
        p.metadata,
        p.is_batch_group,
        p.batch_group_id,
        p.batch_quantity,
        p.created_at,
        p.mode,
        p.is_finalized,
        p.finalized_at,
        (SELECT COUNT(*) FROM production_scans ps WHERE ps.product_id = p.id) as checkpoint_count
       FROM products p
       WHERE p.user_id = $1 
       ORDER BY COALESCE(p.finalized_at, p.created_at) DESC`,
      [userId]
    );

    const allProducts = result.rows.map(row => ({
      id: row.id,
      productId: row.product_id,
      productName: row.product_name,
      sku: row.sku,
      batchNumber: row.batch_number,
      xrplTxHash: row.xrpl_tx_hash,
      metadata: row.metadata,
      isBatchGroup: row.is_batch_group,
      batchGroupId: row.batch_group_id,
      batchQuantity: row.batch_quantity,
      createdAt: row.created_at,
      timestamp: row.created_at, // Keep for backwards compatibility
      mode: row.mode || 'live', // Default to 'live' for legacy products
      isFinalized: row.is_finalized !== false, // Default to true for legacy products
      finalizedAt: row.finalized_at,
      checkpointCount: parseInt(row.checkpoint_count) || 0,
      verificationUrl: `https://www.biztrack.io/verify.html?id=${row.product_id}`,
      // New Vercel Blob URLs (direct URLs, not IPFS hashes)
      qrCodeUrl: row.qr_code_url || null,
      inventoryQrCodeUrl: row.inventory_qr_code_url || null,
      gs1QrCodeUrl: row.gs1_qr_code_url || null
    }));

    // Group batch products together
    const displayList = [];
    const processedBatchGroups = new Set();
    
    allProducts.forEach(product => {
      // If this product belongs to a batch
      if (product.batchGroupId) {
        // Skip if we've already processed this batch group
        if (processedBatchGroups.has(product.batchGroupId)) {
          return;
        }

        // Find ALL products in this batch (including the current one)
        const batchItems = allProducts.filter(p => p.batchGroupId === product.batchGroupId);
        
        // Find the batch group leader (the one with is_batch_group = true)
        const batchLeader = batchItems.find(p => p.isBatchGroup) || batchItems[0];

        // Sum up checkpoint counts for batch
        const totalCheckpoints = batchItems.reduce((sum, item) => sum + (item.checkpointCount || 0), 0);

        displayList.push({
          isBatchGroup: true,
          batchGroupId: product.batchGroupId,
          productId: batchLeader.productId,
          productName: batchLeader.productName,
          sku: batchLeader.sku,
          batchNumber: batchLeader.batchNumber,
          metadata: batchLeader.metadata,
          quantity: batchLeader.batchQuantity || batchItems.length,
          createdAt: batchLeader.createdAt,
          timestamp: batchLeader.timestamp,
          mode: batchLeader.mode,
          isFinalized: batchLeader.isFinalized,
          finalizedAt: batchLeader.finalizedAt,
          checkpointCount: totalCheckpoints,
          qrCodeUrl: batchLeader.qrCodeUrl,
          inventoryQrCodeUrl: batchLeader.inventoryQrCodeUrl,
          gs1QrCodeUrl: batchLeader.gs1QrCodeUrl,
          verificationUrl: batchLeader.verificationUrl,
          items: batchItems.sort((a, b) => {
            // Sort by creation time to preserve Excel upload order
            return new Date(a.createdAt) - new Date(b.createdAt);
          })
        });

        processedBatchGroups.add(product.batchGroupId);
      } else {
        // Single product (not part of a batch)
        displayList.push(product);
      }
    });

    return res.status(200).json({
      success: true,
      products: displayList
    });

  } catch (error) {
    console.error('List products error:', error);
    return res.status(500).json({
      error: 'Failed to fetch products',
      details: error.message
    });
  }
};
