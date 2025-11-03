// api/verify-product.js
const { Pool } = require('pg');
const axios = require('axios');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { id } = req.query;

    if (!id) {
      return res.status(400).json({ error: 'Product ID required' });
    }

    // Get product from database
    const result = await pool.query(
      'SELECT * FROM products WHERE product_id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false,
        error: 'Product not found' 
      });
    }

    const product = result.rows[0];

    // Fetch full data from IPFS
    let ipfsData = null;
    try {
      const ipfsResponse = await axios.get(
        `https://gateway.pinata.cloud/ipfs/${product.ipfs_hash}`,
        { timeout: 10000 }
      );
      ipfsData = ipfsResponse.data;
    } catch (ipfsError) {
      console.error('IPFS fetch error:', ipfsError);
      // Continue without IPFS data
    }

    // Combine database and IPFS data
    const photoHashes = ipfsData?.photoHashes || [];
    const photos = photoHashes.map(hash => `https://gateway.pinata.cloud/ipfs/${hash}`);
    
    const productData = {
      productId: product.product_id,
      productName: product.product_name,
      sku: product.sku,
      batchNumber: product.batch_number,
      ipfsHash: product.ipfs_hash,
      qrCodeIpfsHash: product.qr_code_ipfs_hash,
      xrplTxHash: product.xrpl_tx_hash,
      ipfsUrl: `https://gateway.pinata.cloud/ipfs/${product.ipfs_hash}`,
      timestamp: product.created_at || ipfsData?.createdAt,
      metadata: product.metadata || ipfsData?.metadata || {},
      photoHashes: photoHashes,
      photos: photos,  // ✅ Added full photo URLs
      location: ipfsData?.location || null,
      mintedBy: ipfsData?.mintedBy || 'BizTrack',
      batchInfo: ipfsData?.batchInfo || null
    };

    return res.status(200).json({
      success: true,
      product: productData,
      verified: true,
      verifiedOn: 'XRP Ledger',
      blockchainTx: `https://livenet.xrpl.org/transactions/${product.xrpl_tx_hash}`
    });

  } catch (error) {
    console.error('Verification error:', error);
    return res.status(500).json({
      success: false,
      error: 'Verification failed',
      details: error.message
    });
  }
};
