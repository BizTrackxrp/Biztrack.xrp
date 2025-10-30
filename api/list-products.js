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

    // Fetch all products for this user ONLY
    const result = await pool.query(
      `SELECT 
        product_id,
        product_name,
        sku,
        batch_number,
        ipfs_hash,
        qr_code_ipfs_hash,
        xrpl_tx_hash,
        metadata,
        is_batch_group,
        batch_group_id,
        batch_quantity,
        created_at
       FROM products 
       WHERE user_id = $1 
       ORDER BY created_at DESC`,
      [userId]
    );

    const allProducts = result.rows.map(row => ({
      productId: row.product_id,
      productName: row.product_name,
      sku: row.sku,
      batchNumber: row.batch_number,
      ipfsHash: row.ipfs_hash,
      qrCodeIpfsHash: row.qr_code_ipfs_hash,
      xrplTxHash: row.xrpl_tx_hash,
      metadata: row.metadata,
      isBatchGroup: row.is_batch_group,
      batchGroupId: row.batch_group_id,
      batchQuantity: row.batch_quantity,
      timestamp: row.created_at,
      verificationUrl: `https://www.biztrack.io/verify.html?id=${row.product_id}`,
      qrCodeUrl: row.qr_code_ipfs_hash 
        ? `https://gateway.pinata.cloud/ipfs/${row.qr_code_ipfs_hash}`
        : null
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

        // Create batch group object
        displayList.push({
          type: 'batch',
          isBatchGroup: true,
          batchGroupId: product.batchGroupId,
          productName: batchLeader.productName,
          batchNumber: batchLeader.batchNumber,
          quantity: batchLeader.batchQuantity || batchItems.length,
          timestamp: batchLeader.timestamp,
          items: batchItems.sort((a, b) => {
            // Sort by SKU if available (handles BATCH-001, BATCH-002, etc)
            if (a.sku && b.sku) {
              return a.sku.localeCompare(b.sku);
            }
            return 0;
          })
        });

        processedBatchGroups.add(product.batchGroupId);
      } else {
        // Single product (not part of a batch)
        displayList.push({
          type: 'single',
          ...product
        });
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
