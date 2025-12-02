const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { id } = req.query;

    if (!id) {
      return res.status(400).json({ success: false, error: 'Product ID required' });
    }

    const result = await pool.query(
      `SELECT product_id, mode, is_finalized, finalized_at 
       FROM products 
       WHERE product_id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    const product = result.rows[0];

    return res.status(200).json({
      success: true,
      product: {
        productId: product.product_id,
        mode: product.mode || 'live',
        isFinalized: product.is_finalized || false,
        finalizedAt: product.finalized_at
      }
    });

  } catch (error) {
    console.error('Get product state error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get product state',
      details: error.message
    });
  }
};
