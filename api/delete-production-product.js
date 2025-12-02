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

    // Get the product and verify ownership
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
      return res.status(403).json({ error: 'You do not have permission to delete this product' });
    }

    // Only allow deletion of production mode products that aren't finalized
    if (product.mode !== 'production') {
      return res.status(400).json({ error: 'Only production mode products can be deleted' });
    }

    if (product.is_finalized) {
      return res.status(400).json({ error: 'Cannot delete a finalized product' });
    }

    // Delete all checkpoints first (due to foreign key constraint)
    const deletedScans = await pool.query(
      'DELETE FROM production_scans WHERE product_id = $1 RETURNING id',
      [product.id]
    );

    // Delete the product
    await pool.query(
      'DELETE FROM products WHERE id = $1',
      [product.id]
    );

    // Refund the QR code usage
    await pool.query(
      'UPDATE users SET qr_codes_used = GREATEST(0, qr_codes_used - 1) WHERE id = $1',
      [decoded.userId]
    );

    console.log(`Production product ${productId} deleted with ${deletedScans.rowCount} checkpoints. QR refunded to user ${decoded.userId}`);

    return res.status(200).json({
      success: true,
      message: 'Production entry deleted successfully',
      deletedCheckpoints: deletedScans.rowCount,
      qrRefunded: true
    });

  } catch (error) {
    console.error('Delete production product error:', error);

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }

    return res.status(500).json({
      error: 'Failed to delete production entry',
      details: error.message
    });
  }
};
