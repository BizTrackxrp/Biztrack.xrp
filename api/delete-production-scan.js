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

    const { scanId } = req.body;

    if (!scanId) {
      return res.status(400).json({ error: 'Scan ID is required' });
    }

    // Get the scan and verify ownership through the product
    const scanResult = await pool.query(
      `SELECT ps.*, p.user_id, p.product_id, p.is_finalized
       FROM production_scans ps
       JOIN products p ON ps.product_id = p.id
       WHERE ps.id = $1`,
      [scanId]
    );

    if (scanResult.rows.length === 0) {
      return res.status(404).json({ error: 'Checkpoint not found' });
    }

    const scan = scanResult.rows[0];

    // Verify user owns this product
    if (scan.user_id !== decoded.userId) {
      return res.status(403).json({ error: 'You do not have permission to delete this checkpoint' });
    }

    // Don't allow deletion if product is finalized
    if (scan.is_finalized) {
      return res.status(400).json({ error: 'Cannot delete checkpoints from a finalized product' });
    }

    // Delete the checkpoint
    await pool.query(
      'DELETE FROM production_scans WHERE id = $1',
      [scanId]
    );

    console.log(`Checkpoint ${scanId} deleted for product ${scan.product_id} by user ${decoded.userId}`);

    return res.status(200).json({
      success: true,
      message: 'Checkpoint deleted successfully'
    });

  } catch (error) {
    console.error('Delete production scan error:', error);

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }

    return res.status(500).json({
      error: 'Failed to delete checkpoint',
      details: error.message
    });
  }
};
