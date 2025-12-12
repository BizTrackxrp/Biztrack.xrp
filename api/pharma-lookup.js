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
    const userId = decoded.userId;

    const { gtin, serial, productId } = req.query;

    if (!gtin && !serial && !productId) {
      return res.status(400).json({ error: 'GTIN, Serial, or Product ID required' });
    }

    let product = null;
    let lastTransaction = null;

    // Search by product ID first
    if (productId) {
      const result = await pool.query(
        `SELECT * FROM products WHERE product_id = $1 AND user_id = $2`,
        [productId, userId]
      );
      if (result.rows.length > 0) {
        product = result.rows[0];
      }
    }

    // Search by GTIN + Serial
    if (!product && gtin && serial) {
      const result = await pool.query(
        `SELECT * FROM products 
         WHERE user_id = $1 
         AND (
           (metadata->>'gtin' = $2 AND (metadata->>'serialNumber' = $3 OR sku = $3))
           OR (metadata->'gs1'->>'gtin' = $2 AND (metadata->>'serialNumber' = $3 OR sku = $3))
         )
         LIMIT 1`,
        [userId, gtin, serial]
      );
      if (result.rows.length > 0) {
        product = result.rows[0];
      }
    }

    // Search by GTIN only (might match multiple)
    if (!product && gtin) {
      const result = await pool.query(
        `SELECT * FROM products 
         WHERE user_id = $1 
         AND (metadata->>'gtin' = $2 OR metadata->'gs1'->>'gtin' = $2)
         ORDER BY created_at DESC
         LIMIT 1`,
        [userId, gtin]
      );
      if (result.rows.length > 0) {
        product = result.rows[0];
      }
    }

    if (!product) {
      return res.status(200).json({
        success: false,
        found: false,
        message: 'Product not found in system'
      });
    }

    // Get last transaction for this product
    try {
      const txResult = await pool.query(
        `SELECT * FROM pharma_transactions 
         WHERE product_id = $1 
         ORDER BY timestamp DESC 
         LIMIT 1`,
        [product.product_id]
      );

      if (txResult.rows.length > 0) {
        const tx = txResult.rows[0];
        lastTransaction = {
          transactionId: tx.transaction_id,
          type: tx.transaction_type,
          sender: tx.from_party,
          receiver: tx.to_party,
          shipDate: tx.timestamp,
          quantity: tx.quantity
        };
      }
    } catch (txError) {
      // Transaction table might not exist yet
      console.log('Transaction lookup skipped:', txError.message);
    }

    return res.status(200).json({
      success: true,
      found: true,
      product: {
        productId: product.product_id,
        productName: product.product_name,
        sku: product.sku,
        batchNumber: product.batch_number,
        mode: product.mode,
        isFinalized: product.is_finalized,
        metadata: product.metadata,
        createdAt: product.created_at,
        lastTransaction
      }
    });

  } catch (error) {
    console.error('Pharma lookup error:', error);
    return res.status(500).json({ error: 'Lookup failed', details: error.message });
  }
};
