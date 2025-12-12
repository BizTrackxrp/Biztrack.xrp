const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

module.exports = async (req, res) => {
  if (req.method === 'POST') {
    return handleCreateShipment(req, res);
  }
  return res.status(405).json({ error: 'Method not allowed' });
};

async function handleCreateShipment(req, res) {
  const client = await pool.connect();
  
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.userId;

    const { items, recipient, shipDate, poNumber, carrier, trackingNumber, notes } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'At least one item required' });
    }
    if (!recipient || !recipient.name) {
      return res.status(400).json({ error: 'Recipient name required for DSCSA compliance' });
    }
    if (!shipDate) {
      return res.status(400).json({ error: 'Ship date required' });
    }

    const shipmentId = `SHP-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const transactionId = `TXN-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    await client.query('BEGIN');

    const processedItems = [];
    
    for (const item of items) {
      if (item.inventoryId) {
        const updateResult = await client.query(
          `UPDATE pharma_inventory 
           SET status = 'shipped', quantity = quantity - $1, last_updated = NOW()
           WHERE id = $2 AND user_id = $3 AND quantity >= $1
           RETURNING *`,
          [item.quantity, item.inventoryId, userId]
        );
        if (updateResult.rows.length === 0) {
          throw new Error(`Insufficient quantity for item ${item.gtin || item.serialNumber}`);
        }
      }

      const itemTxId = `${transactionId}-${processedItems.length + 1}`;
      await client.query(
        `INSERT INTO pharma_transactions (
          transaction_id, user_id, product_id, transaction_type,
          from_party, to_party, quantity, timestamp, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [itemTxId, userId, item.productId, 'ship', 'inventory', recipient.name, item.quantity, shipDate,
          JSON.stringify({ shipmentId, gtin: item.gtin, serialNumber: item.serialNumber, lotNumber: item.lotNumber, expiryDate: item.expiryDate, recipient, poNumber, carrier, trackingNumber })]
      );
      processedItems.push({ ...item, transactionId: itemTxId });
    }

    await client.query('COMMIT');

    // T3 Document structure
    const t3Document = {
      transactionId, shipmentId, documentType: 'T3', generatedAt: new Date().toISOString(),
      transactionInformation: {
        transactionDate: shipDate, transactionType: 'Sale',
        shipToName: recipient.name, shipToGLN: recipient.gln || null,
        products: processedItems.map(item => ({
          gtin: item.gtin, serialNumber: item.serialNumber, lotNumber: item.lotNumber, expirationDate: item.expiryDate, quantity: item.quantity
        }))
      },
      transactionHistory: { priorOwners: ['Manufacturer', 'Distributor'] },
      transactionStatement: {
        statement: 'The entity transferring ownership certifies that it is authorized to do so under DSCSA.',
        date: new Date().toISOString()
      }
    };

    console.log(`Shipment created: ${shipmentId} | To: ${recipient.name} | Items: ${items.length}`);

    return res.status(200).json({
      success: true, shipmentId, transactionId, itemCount: processedItems.length,
      t3Document, message: 'Shipment created with T3 documentation'
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Shipment error:', error);
    return res.status(500).json({ error: 'Shipment failed', details: error.message });
  } finally {
    client.release();
  }
}
