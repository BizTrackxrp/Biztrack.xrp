const axios = require('axios');
const { Pool } = require('pg');

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

module.exports = async (req, res) => {
  // Allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { id } = req.query;

    if (!id) {
      return res.status(400).json({ error: 'Product ID is required' });
    }

    // Step 1: Get product info from database
    const result = await pool.query(
      'SELECT * FROM products WHERE product_id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const product = result.rows[0];

    // Step 2: Fetch data from IPFS
    const ipfsUrl = `https://gateway.pinata.cloud/ipfs/${product.ipfs_hash}`;
    const ipfsResponse = await axios.get(ipfsUrl);
    const productData = ipfsResponse.data;

    // Step 3: Return verification response
    return res.status(200).json({
      verified: true,
      product: {
        id: product.product_id,
        name: product.product_name,
        sku: product.sku,
        batchNumber: product.batch_number,
        createdAt: product.created_at,
        metadata: product.metadata
      },
      blockchain: {
        ipfsHash: product.ipfs_hash,
        ipfsUrl: ipfsUrl,
        xrplTransaction: product.xrpl_tx_hash,
        explorerUrl: `https://livenet.xrpl.org/transactions/${product.xrpl_tx_hash}`
      },
      rawData: productData
    });

  } catch (error) {
    console.error('Verification error:', error);
    return res.status(500).json({
      error: 'Verification failed',
      details: error.message
    });
  }
};
