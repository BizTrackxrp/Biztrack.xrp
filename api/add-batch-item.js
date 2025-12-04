const { Pool } = require('pg');
const axios = require('axios');
const QRCode = require('qrcode');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    // Verify authentication
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [decoded.userId]);
    if (userResult.rows.length === 0) {
      return res.status(401).json({ success: false, error: 'User not found' });
    }
    const user = userResult.rows[0];

    const { batchGroupId, batchProductId, productName, sku } = req.body;
    
    if (!batchGroupId || !productName) {
      return res.status(400).json({ success: false, error: 'batchGroupId and productName are required' });
    }

    // Verify the batch exists and belongs to this user
    const batchResult = await pool.query(
      `SELECT * FROM products WHERE batch_group_id = $1 AND user_id = $2 AND is_batch_group = true LIMIT 1`,
      [batchGroupId, user.id]
    );
    
    if (batchResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Batch not found' });
    }
    
    const batchLeader = batchResult.rows[0];

    // Generate new product ID
    const productId = `BT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Generate SKU if not provided
    const productSku = sku || `${productName.substring(0, 3).toUpperCase()}${Date.now().toString().slice(-4)}`;
    
    // Generate tracking QR code (scan URL for checkpoints)
    const scanUrl = `https://www.biztrack.io/scan.html?id=${productId}`;
    const trackingQrBuffer = await QRCode.toBuffer(scanUrl, {
      width: 300,
      margin: 2,
      color: { dark: '#10B981', light: '#FFFFFF' }
    });
    
    // Upload QR to IPFS
    const FormData = require('form-data');
    const formData = new FormData();
    formData.append('file', trackingQrBuffer, { filename: `tracking-qr-${productId}.png` });
    
    const qrResponse = await axios.post(
      'https://api.pinata.cloud/pinning/pinFileToIPFS',
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          'Authorization': `Bearer ${process.env.PINATA_JWT}`
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      }
    );
    
    const trackingQrIpfsHash = qrResponse.data.IpfsHash;

    // Get existing checkpoints from the batch to copy to new item
    const checkpointsResult = await pool.query(
      `SELECT * FROM production_scans WHERE product_id = $1 ORDER BY scanned_at ASC`,
      [batchLeader.id]
    );

    // Insert new item
    const insertResult = await pool.query(
      `INSERT INTO products (
        product_id, 
        product_name, 
        sku, 
        batch_number, 
        qr_code_ipfs_hash,
        metadata, 
        user_id,
        is_batch_group,
        batch_group_id,
        batch_quantity,
        mode,
        is_finalized,
        photo_hashes,
        location_data
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING id`,
      [
        productId,
        productName,
        productSku,
        batchLeader.batch_number,
        trackingQrIpfsHash,
        batchLeader.metadata || {},
        user.id,
        false, // Not a batch leader
        batchGroupId,
        1,
        'production',
        false,
        batchLeader.photo_hashes,
        batchLeader.location_data
      ]
    );

    const newProductId = insertResult.rows[0].id;

    // Copy all existing checkpoints to the new item (it inherits the batch journey)
    for (const checkpoint of checkpointsResult.rows) {
      await pool.query(
        `INSERT INTO production_scans (
          product_id, scanned_at, latitude, longitude, location_name,
          notes, photos, scanned_by_name, scanned_by_role
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          newProductId,
          checkpoint.scanned_at,
          checkpoint.latitude,
          checkpoint.longitude,
          checkpoint.location_name,
          checkpoint.notes,
          checkpoint.photos,
          checkpoint.scanned_by_name,
          checkpoint.scanned_by_role
        ]
      );
    }

    // Update batch quantity on the leader
    await pool.query(
      `UPDATE products 
       SET batch_quantity = (
         SELECT COUNT(*) FROM products WHERE batch_group_id = $1
       )
       WHERE batch_group_id = $1 AND is_batch_group = true`,
      [batchGroupId]
    );

    return res.status(200).json({
      success: true,
      message: 'Item added to batch',
      item: {
        productId,
        productName,
        sku: productSku,
        checkpointCount: checkpointsResult.rows.length
      }
    });

  } catch (error) {
    console.error('Error adding batch item:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to add item',
      details: error.message 
    });
  }
};
