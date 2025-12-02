const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

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

    const { productId } = req.body;

    if (!productId) {
      return res.status(400).json({ error: 'Product ID is required' });
    }

    // Get product and verify ownership
    const productResult = await pool.query(
      'SELECT * FROM products WHERE product_id = $1',
      [productId]
    );

    if (productResult.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const product = productResult.rows[0];

    // Verify user owns this product
    if (product.user_id !== decoded.userId) {
      return res.status(403).json({ error: 'You do not have permission to finalize this product' });
    }

    if (product.mode !== 'production') {
      return res.status(400).json({ error: 'Product is not in production mode' });
    }

    if (product.is_finalized) {
      return res.status(400).json({ error: 'Product is already finalized' });
    }

    // Finalize the product
    await pool.query(
      `UPDATE products 
       SET mode = 'live',
           is_finalized = true,
           finalized_at = NOW()
       WHERE id = $1`,
      [product.id]
    );

    // Get checkpoint count
    const countResult = await pool.query(
      'SELECT COUNT(*) FROM production_scans WHERE product_id = $1',
      [product.id]
    );

    return res.status(200).json({
      success: true,
      message: 'Product finalized successfully! It is now live for customer verification.',
      product: {
        productId: product.product_id,
        productName: product.product_name,
        sku: product.sku,
        mode: 'live',
        isFinalized: true,
        finalizedAt: new Date().toISOString(),
        totalCheckpoints: parseInt(countResult.rows[0].count)
      }
    });

  } catch (error) {
    console.error('Finalize product error:', error);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    return res.status(500).json({
      error: 'Failed to finalize product',
      details: error.message
    });
  }
};
