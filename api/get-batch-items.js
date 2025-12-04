const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

module.exports = async (req, res) => {
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

    // Get batch group ID from query
    const { batchGroupId } = req.query;
    
    if (!batchGroupId) {
      return res.status(400).json({ success: false, error: 'batchGroupId is required' });
    }

    // Get all items in this batch
    const result = await pool.query(
      `SELECT 
        p.id,
        p.product_id,
        p.product_name,
        p.sku,
        p.batch_number,
        p.is_batch_group,
        p.created_at,
        (SELECT COUNT(*) FROM production_scans ps WHERE ps.product_id = p.id) as checkpoint_count
       FROM products p
       WHERE p.batch_group_id = $1 AND p.user_id = $2
       ORDER BY p.created_at ASC`,
      [batchGroupId, user.id]
    );

    const items = result.rows.map(row => ({
      id: row.id,
      productId: row.product_id,
      productName: row.product_name,
      sku: row.sku,
      batchNumber: row.batch_number,
      isBatchLeader: row.is_batch_group,
      createdAt: row.created_at,
      checkpointCount: parseInt(row.checkpoint_count) || 0
    }));

    return res.status(200).json({
      success: true,
      items,
      count: items.length
    });

  } catch (error) {
    console.error('Error getting batch items:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to get batch items',
      details: error.message 
    });
  }
};
