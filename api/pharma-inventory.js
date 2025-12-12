const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    return handleGetInventory(req, res);
  }

  if (req.method === 'POST') {
    // Check request body for action type instead of URL parsing
    const { action } = req.body || {};
    
    if (action === 'quarantine') {
      return handleQuarantine(req, res);
    }
    if (action === 'update-status') {
      return handleUpdateStatus(req, res);
    }
    
    // Default to quarantine for backwards compatibility
    return handleQuarantine(req, res);
  }

  return res.status(405).json({ error: 'Method not allowed' });
};

// ==========================================
// GET INVENTORY
// ==========================================
async function handleGetInventory(req, res) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.userId;

    const { status, location, search, expiring } = req.query;

    let query = `
      SELECT 
        id, gtin, serial_number, lot_number, expiry_date,
        product_id, product_name, quantity, storage_location,
        status, last_updated, created_at
      FROM pharma_inventory
      WHERE user_id = $1
    `;
    const params = [userId];
    let paramCount = 1;

    if (status) {
      paramCount++;
      query += ` AND status = $${paramCount}`;
      params.push(status);
    }

    if (location) {
      paramCount++;
      query += ` AND storage_location = $${paramCount}`;
      params.push(location);
    }

    if (search) {
      paramCount++;
      query += ` AND (
        product_name ILIKE $${paramCount} OR 
        gtin ILIKE $${paramCount} OR 
        serial_number ILIKE $${paramCount} OR 
        lot_number ILIKE $${paramCount}
      )`;
      params.push(`%${search}%`);
    }

    if (expiring) {
      const days = parseInt(expiring);
      if (days > 0) {
        query += ` AND expiry_date <= CURRENT_DATE + INTERVAL '${days} days' AND expiry_date > CURRENT_DATE`;
      } else if (expiring === 'expired') {
        query += ` AND expiry_date < CURRENT_DATE`;
      }
    }

    query += ` ORDER BY 
      CASE WHEN status = 'quarantine' THEN 0 ELSE 1 END,
      expiry_date ASC NULLS LAST,
      created_at DESC
    `;

    const result = await pool.query(query, params);

    const inventory = result.rows.map(row => ({
      id: row.id,
      gtin: row.gtin,
      serialNumber: row.serial_number,
      lotNumber: row.lot_number,
      expiryDate: row.expiry_date,
      productId: row.product_id,
      productName: row.product_name,
      quantity: row.quantity,
      storageLocation: row.storage_location,
      status: row.status,
      lastUpdated: row.last_updated,
      createdAt: row.created_at
    }));

    return res.status(200).json({
      success: true,
      inventory,
      count: inventory.length
    });

  } catch (error) {
    console.error('Get inventory error:', error);
    return res.status(500).json({ error: 'Failed to fetch inventory', details: error.message });
  }
}

// ==========================================
// QUARANTINE ITEM
// ==========================================
async function handleQuarantine(req, res) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.userId;

    const { id, reason } = req.body;

    if (!id) {
      return res.status(400).json({ error: 'Item ID required' });
    }

    // Update status to quarantine
    const result = await pool.query(
      `UPDATE pharma_inventory 
       SET status = 'quarantine', 
           storage_location = 'quarantine',
           last_updated = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const item = result.rows[0];

    // Log transaction
    const transactionId = `TXN-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    await pool.query(
      `INSERT INTO pharma_transactions (
        transaction_id, user_id, product_id, transaction_type,
        from_party, to_party, quantity, timestamp, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8)`,
      [
        transactionId,
        userId,
        item.product_id,
        'quarantine',
        item.storage_location,
        'quarantine',
        item.quantity,
        JSON.stringify({ reason: reason || 'Manual quarantine', previousLocation: item.storage_location })
      ]
    );

    return res.status(200).json({
      success: true,
      message: 'Item moved to quarantine',
      transactionId
    });

  } catch (error) {
    console.error('Quarantine error:', error);
    return res.status(500).json({ error: 'Failed to quarantine item', details: error.message });
  }
}

// ==========================================
// UPDATE STATUS
// ==========================================
async function handleUpdateStatus(req, res) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.userId;

    const { id, status, location } = req.body;

    if (!id || !status) {
      return res.status(400).json({ error: 'Item ID and status required' });
    }

    const validStatuses = ['in_stock', 'reserved', 'quarantine', 'shipped', 'dispensed', 'destroyed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    let query = `
      UPDATE pharma_inventory 
      SET status = $1, last_updated = NOW()
    `;
    const params = [status];

    if (location) {
      query += `, storage_location = $${params.length + 1}`;
      params.push(location);
    }

    query += ` WHERE id = $${params.length + 1} AND user_id = $${params.length + 2} RETURNING *`;
    params.push(id, userId);

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }

    return res.status(200).json({
      success: true,
      message: 'Status updated',
      item: result.rows[0]
    });

  } catch (error) {
    console.error('Update status error:', error);
    return res.status(500).json({ error: 'Failed to update status', details: error.message });
  }
}
