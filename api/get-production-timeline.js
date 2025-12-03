import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { productId } = req.query;

    if (!productId) {
      return res.status(400).json({ success: false, error: 'Product ID is required' });
    }

    // First, get the product info
    const productResult = await sql`
      SELECT id, product_id, product_name, sku, mode, is_finalized
      FROM products 
      WHERE product_id = ${productId}
    `;

    if (productResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    const product = productResult.rows[0];

    // Get all checkpoints for this product, ordered by scanned_at (newest first)
    const checkpointsResult = await sql`
      SELECT 
        id,
        step,
        scanned_at,
        latitude,
        longitude,
        location_name,
        notes,
        photos,
        scanned_by_name,
        scanned_by_role
      FROM production_scans 
      WHERE product_id = ${product.id}
      ORDER BY scanned_at DESC
    `;

    // Format checkpoints for response
    const checkpoints = checkpointsResult.rows.map(row => ({
      id: row.id,
      step: row.step,
      scannedAt: row.scanned_at,
      latitude: row.latitude,
      longitude: row.longitude,
      locationName: row.location_name,
      notes: row.notes,
      photos: row.photos || [],
      scannedByName: row.scanned_by_name,
      scannedByRole: row.scanned_by_role
    }));

    return res.status(200).json({
      success: true,
      product: {
        productId: product.product_id,
        productName: product.product_name,
        sku: product.sku,
        mode: product.mode,
        isFinalized: product.is_finalized
      },
      timeline: {
        totalCheckpoints: checkpoints.length,
        checkpoints: checkpoints
      }
    });

  } catch (error) {
    console.error('Error fetching production timeline:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch timeline',
      details: error.message 
    });
  }
}
