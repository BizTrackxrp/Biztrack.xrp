const { Pool } = require('pg');
const axios = require('axios');

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

    // Fetch product from database
    const result = await pool.query(
      `SELECT * FROM products WHERE product_id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Product not found',
        message: 'This product ID does not exist in our records'
      });
    }

    const product = result.rows[0];

    // Fetch product data from IPFS
    let ipfsData = null;
    if (product.ipfs_hash) {
      try {
        const ipfsResponse = await axios.get(
          `https://gateway.pinata.cloud/ipfs/${product.ipfs_hash}`,
          { timeout: 5000 }
        );
        ipfsData = ipfsResponse.data;
      } catch (error) {
        console.error('Error fetching from IPFS:', error.message);
        // Continue without IPFS data if it fails
      }
    }

    // Return combined data
    return res.status(200).json({
      success: true,
      product: {
        productId: product.product_id,
        productName: product.product_name,
        sku: product.sku,
        batchNumber: product.batch_number,
        ipfsHash: product.ipfs_hash,
        qrCodeIpfsHash: product.qr_code_ipfs_hash,
        xrplTxHash: product.xrpl_tx_hash,
        metadata: product.metadata,
        createdAt: product.created_at,
        // IPFS data (if available)
        ipfsData: ipfsData,
        // URLs
        qrCodeUrl: product.qr_code_ipfs_hash 
          ? `https://gateway.pinata.cloud/ipfs/${product.qr_code_ipfs_hash}`
          : null,
        ipfsUrl: product.ipfs_hash
          ? `https://gateway.pinata.cloud/ipfs/${product.ipfs_hash}`
          : null,
        blockchainUrl: product.xrpl_tx_hash
          ? `https://livenet.xrpl.org/transactions/${product.xrpl_tx_hash}`
          : null
      }
    });

  } catch (error) {
    console.error('Get product error:', error);
    return res.status(500).json({
      error: 'Failed to fetch product',
      details: error.message
    });
  }
};
