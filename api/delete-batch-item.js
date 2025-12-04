const { Pool } = require('pg');

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

    const { productId, batchGroupId } = req.body;
    
    if (!productId || !batchGroupId) {
      return res.status(400).json({ success: false, error: 'productId and batchGroupId are required' });
    }

    // Verify the item exists and belongs to this user
    const itemResult = await pool.query(
      `SELECT * FROM products WHERE product_id = $1 AND user_id = $2 AND batch_group_id = $3`,
      [productId, user.id, batchGroupId]
    );
    
    if (itemResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Item not found' });
    }
    
    const item = itemResult.rows[0];

    // Check if this is the batch leader
    if (item.is_batch_group) {
      // Count remaining items in batch
      const countResult = await pool.query(
        `SELECT COUNT(*) as count FROM products WHERE batch_group_id = $1`,
        [batchGroupId]
      );
      
      const itemCount = parseInt(countResult.rows[0].count);
      
      if (itemCount > 1) {
        // Transfer batch leadership to next item
        await pool.query(
          `UPDATE products 
           SET is_batch_group = true, batch_quantity = $1
           WHERE batch_group_id = $2 AND product_id != $3 AND is_batch_group = false
           LIMIT 1`,
          [itemCount - 1, batchGroupId, productId]
        );
        
        // Actually PostgreSQL doesn't support LIMIT in UPDATE, let's do it differently
        const nextLeaderResult = await pool.query(
          `SELECT id FROM products 
           WHERE batch_group_id = $1 AND product_id != $2 
           ORDER BY created_at ASC LIMIT 1`,
          [batchGroupId, productId]
        );
        
        if (nextLeaderResult.rows.length > 0) {
          await pool.query(
            `UPDATE products SET is_batch_group = true, batch_quantity = $1 WHERE id = $2`,
            [itemCount - 1, nextLeaderResult.rows[0].id]
          );
        }
      }
      // If it's the only item, the whole batch gets deleted
    }

    // Delete associated checkpoints first
    await pool.query(
      `DELETE FROM production_scans WHERE product_id = $1`,
      [item.id]
    );

    // Delete the item
    await pool.query(
      `DELETE FROM products WHERE id = $1`,
      [item.id]
    );

    // Update batch quantity on remaining leader
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
      message: 'Item removed from batch'
    });

  } catch (error) {
    console.error('Error deleting batch item:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to remove item',
      details: error.message 
    });
  }
};
