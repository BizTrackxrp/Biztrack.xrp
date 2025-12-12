const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

// ==========================================
// MAIN HANDLER
// ==========================================

module.exports = async (req, res) => {
  // Handle GET for fetching receipts
  if (req.method === 'GET') {
    return handleGetReceipts(req, res);
  }

  // Handle POST for creating new receipt
  if (req.method === 'POST') {
    return handleCreateReceipt(req, res);
  }

  return res.status(405).json({ error: 'Method not allowed' });
};

// ==========================================
// GET RECEIPTS
// ==========================================
async function handleGetReceipts(req, res) {
  try {
    // Authenticate
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.userId;

    const { limit = 20, today } = req.query;

    // If today=true, just return count for today
    if (today === 'true') {
      const countResult = await pool.query(
        `SELECT COUNT(*) as count FROM pharma_receipts 
         WHERE user_id = $1 
         AND received_at >= CURRENT_DATE`,
        [userId]
      );
      return res.status(200).json({
        success: true,
        count: parseInt(countResult.rows[0].count)
      });
    }

    // Get recent receipts
    const result = await pool.query(
      `SELECT * FROM pharma_receipts 
       WHERE user_id = $1 
       ORDER BY received_at DESC 
       LIMIT $2`,
      [userId, parseInt(limit)]
    );

    const receipts = result.rows.map(row => ({
      id: row.id,
      receiptId: row.receipt_id,
      productId: row.product_id,
      productName: row.product_name,
      gtin: row.gtin,
      serialNumber: row.serial_number,
      lotNumber: row.lot_number,
      expiryDate: row.expiry_date,
      sender: row.sender_info,
      poNumber: row.po_number,
      quantity: row.quantity,
      storageLocation: row.storage_location,
      notes: row.notes,
      receivedAt: row.received_at,
      transactionId: row.transaction_id
    }));

    return res.status(200).json({
      success: true,
      receipts
    });

  } catch (error) {
    console.error('Get receipts error:', error);
    return res.status(500).json({ error: 'Failed to fetch receipts', details: error.message });
  }
}

// ==========================================
// CREATE RECEIPT
// ==========================================
async function handleCreateReceipt(req, res) {
  try {
    // Authenticate
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.userId;

    const {
      gs1Data,
      productName: requestProductName,
      gtin,
      serialNumber,
      lotNumber,
      expiryDate,
      sender,
      poNumber,
      quantity,
      storageLocation,
      notes,
      receivedAt
    } = req.body;

    // Validation
    if (!gtin && !serialNumber) {
      return res.status(400).json({ error: 'GTIN or Serial Number required' });
    }

    if (!requestProductName) {
      return res.status(400).json({ error: 'Product Name is required' });
    }

    if (!sender || !sender.name) {
      return res.status(400).json({ error: 'Sender information required for DSCSA compliance' });
    }

    // Generate receipt ID and transaction ID
    const receiptId = `RCP-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const transactionId = `TXN-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Try to find matching product in our system
    let productId = null;
    let productName = requestProductName; // Use the name from request

    if (gtin && serialNumber) {
      const productResult = await pool.query(
        `SELECT product_id, product_name FROM products 
         WHERE user_id = $1 
         AND (metadata->>'gtin' = $2 OR metadata->'gs1'->>'gtin' = $2)
         AND (metadata->>'serialNumber' = $3 OR sku = $3)
         LIMIT 1`,
        [userId, gtin, serialNumber]
      );

      if (productResult.rows.length > 0) {
        productId = productResult.rows[0].product_id;
        // Only override product name if we found a match AND no name was provided
        if (!requestProductName && productResult.rows[0].product_name) {
          productName = productResult.rows[0].product_name;
        }
      }
    }

    // Insert receipt record
    const insertResult = await pool.query(
      `INSERT INTO pharma_receipts (
        receipt_id, user_id, product_id, product_name,
        gtin, serial_number, lot_number, expiry_date,
        sender_info, po_number, quantity, storage_location,
        notes, received_at, transaction_id, gs1_data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING id`,
      [
        receiptId,
        userId,
        productId,
        productName,
        gtin,
        serialNumber,
        lotNumber,
        expiryDate,
        JSON.stringify(sender),
        poNumber,
        quantity || 1,
        storageLocation,
        notes,
        receivedAt || new Date().toISOString(),
        transactionId,
        gs1Data ? JSON.stringify(gs1Data) : null
      ]
    );

    // If we found a matching product, update its status/location
    if (productId) {
      await pool.query(
        `UPDATE products 
         SET metadata = metadata || $1::jsonb,
             updated_at = NOW()
         WHERE product_id = $2`,
        [
          JSON.stringify({
            lastReceived: receivedAt || new Date().toISOString(),
            currentLocation: storageLocation,
            lastTransactionId: transactionId,
            supplyChainStatus: 'received'
          }),
          productId
        ]
      );

      // Add to transaction history (checkpoints)
      await pool.query(
        `INSERT INTO pharma_transactions (
          transaction_id, user_id, product_id, transaction_type,
          from_party, to_party, quantity, timestamp, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          transactionId,
          userId,
          productId,
          'receive',
          sender.name,
          'inventory', // Your facility
          quantity || 1,
          receivedAt || new Date().toISOString(),
          JSON.stringify({
            poNumber,
            storageLocation,
            notes,
            gs1Data
          })
        ]
      );
    }

    // Update inventory count (if you have an inventory table)
    // This is optional - depends on your schema
    try {
      await pool.query(
        `INSERT INTO pharma_inventory (
          user_id, gtin, serial_number, lot_number, expiry_date,
          product_name, quantity, storage_location, status, last_updated
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        ON CONFLICT (user_id, gtin, serial_number) 
        DO UPDATE SET 
          quantity = pharma_inventory.quantity + EXCLUDED.quantity,
          storage_location = EXCLUDED.storage_location,
          product_name = EXCLUDED.product_name,
          last_updated = NOW()`,
        [userId, gtin, serialNumber, lotNumber, expiryDate, productName, quantity || 1, storageLocation, 'in_stock']
      );
    } catch (invError) {
      // Inventory table might not exist yet - that's OK
      console.log('Inventory update skipped (table may not exist):', invError.message);
    }

    console.log(`Receipt logged: ${receiptId} | GTIN: ${gtin} | Serial: ${serialNumber} | From: ${sender.name}`);

    return res.status(200).json({
      success: true,
      receiptId,
      transactionId,
      message: 'Receipt confirmed and logged',
      productId,
      productName
    });

  } catch (error) {
    console.error('Create receipt error:', error);
    return res.status(500).json({ error: 'Failed to log receipt', details: error.message });
  }
}
