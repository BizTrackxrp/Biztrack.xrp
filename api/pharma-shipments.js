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
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.userId;

    const { limit = 20 } = req.query;

    const result = await pool.query(
      `SELECT * FROM pharma_shipments 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT $2`,
      [userId, parseInt(limit)]
    );

    const shipments = result.rows.map(row => ({
      id: row.id,
      shipmentId: row.shipment_id,
      transactionId: row.transaction_id,
      recipient: row.recipient_info,
      shipDate: row.ship_date,
      poNumber: row.po_number,
      carrier: row.carrier,
      trackingNumber: row.tracking_number,
      notes: row.notes,
      itemCount: row.item_count,
      status: row.status,
      createdAt: row.created_at
    }));

    return res.status(200).json({ success: true, shipments });

  } catch (error) {
    console.error('Get shipments error:', error);
    return res.status(500).json({ error: 'Failed to fetch shipments', details: error.message });
  }
};
