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
    const { productId } = req.query;

    if (!productId) {
      return res.status(400).json({ error: 'Product ID is required' });
    }

    // Get product
    const productResult = await pool.query(
      `SELECT 
        p.*,
        u.name as owner_name,
        u.company_name
       FROM products p
       LEFT JOIN users u ON p.user_id = u.id
       WHERE p.product_id = $1`,
      [productId]
    );

    if (productResult.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const product = productResult.rows[0];

    // Get all production scans ordered by time
    const scansResult = await pool.query(
      `SELECT * FROM production_scans 
       WHERE product_id = $1 
       ORDER BY scanned_at ASC`,
      [product.id]
    );

    const checkpoints = scansResult.rows.map((scan, index) => ({
      id: scan.id,
      step: index + 1,
      scannedAt: scan.scanned_at,
      latitude: scan.latitude ? parseFloat(scan.latitude) : null,
      longitude: scan.longitude ? parseFloat(scan.longitude) : null,
      locationName: scan.location_name,
      notes: scan.notes,
      photos: scan.photos || [],
      scannedByName: scan.scanned_by_name,
      scannedByRole: scan.scanned_by_role
    }));

    return res.status(200).json({
      success: true,
      product: {
        productId: product.product_id,
        productName: product.product_name,
        sku: product.sku,
        batchNumber: product.batch_number,
        mode: product.mode,
        isFinalized: product.is_finalized,
        finalizedAt: product.finalized_at,
        createdAt: product.created_at,
        ownerName: product.owner_name || product.company_name,
        verificationUrl: `https://www.biztrack.io/verify.html?id=${product.product_id}`,
        qrCodeUrl: product.qr_code_ipfs_hash 
          ? `https://gateway.pinata.cloud/ipfs/${product.qr_code_ipfs_hash}` 
          : null
      },
      timeline: {
        totalCheckpoints: checkpoints.length,
        checkpoints: checkpoints
      }
    });

  } catch (error) {
    console.error('Get production timeline error:', error);
    return res.status(500).json({
      error: 'Failed to get timeline',
      details: error.message
    });
  }
};
