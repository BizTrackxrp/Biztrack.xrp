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

    // Fetch full data from IPFS (if available)
    let ipfsData = null;
    if (product.ipfs_hash) {
      try {
        const ipfsResponse = await axios.get(
          `https://gateway.pinata.cloud/ipfs/${product.ipfs_hash}`,
          { timeout: 10000 }
        );
        ipfsData = ipfsResponse.data;
      } catch (ipfsError) {
        console.error('IPFS fetch error:', ipfsError.message);
        // Continue without IPFS data
      }
    }

    // Get supply chain checkpoints (production scans)
    let supplyChain = null;
    const checkpointsResult = await pool.query(
      `SELECT * FROM production_scans 
       WHERE product_id = $1 
       ORDER BY scanned_at ASC`,
      [product.id]
    );

    if (checkpointsResult.rows.length > 0) {
      const checkpoints = checkpointsResult.rows.map((scan, index) => ({
        step: index + 1,
        scannedAt: scan.scanned_at,
        scannedByName: scan.scanned_by_name,
        scannedByRole: scan.scanned_by_role,
        locationName: scan.location_name,
        latitude: scan.latitude ? parseFloat(scan.latitude) : null,
        longitude: scan.longitude ? parseFloat(scan.longitude) : null,
        notes: scan.notes,
        photos: scan.photos || []
      }));

      supplyChain = {
        totalCheckpoints: checkpoints.length,
        timeline: checkpoints,
        finalizedAt: product.finalized_at
      };
    }

    // Combine database and IPFS data for photos
    let photos = [];
    
    // First try IPFS photo hashes
    const photoHashes = ipfsData?.photoHashes || [];
    if (photoHashes.length > 0) {
      photos = photoHashes.map(hash => `https://gateway.pinata.cloud/ipfs/${hash}`);
    }
    
    // Also check database photo_hashes column (for production mode products)
    if (photos.length === 0 && product.photo_hashes) {
      try {
        const dbPhotoHashes = JSON.parse(product.photo_hashes);
        if (Array.isArray(dbPhotoHashes) && dbPhotoHashes.length > 0) {
          photos = dbPhotoHashes.map(hash => `https://gateway.pinata.cloud/ipfs/${hash}`);
        }
      } catch (e) {
        console.error('Error parsing photo_hashes:', e);
      }
    }

    // Get location from IPFS or database
    let location = ipfsData?.location || null;
    if (!location && product.location_data) {
      try {
        location = JSON.parse(product.location_data);
      } catch (e) {
        console.error('Error parsing location_data:', e);
      }
    }

    const productData = {
      productId: product.product_id,
      productName: product.product_name,
      sku: product.sku,
      batchNumber: product.batch_number,
      ipfsHash: product.ipfs_hash,
      qrCodeIpfsHash: product.qr_code_ipfs_hash,
      xrplTxHash: product.xrpl_tx_hash,
      ipfsUrl: product.ipfs_hash ? `https://gateway.pinata.cloud/ipfs/${product.ipfs_hash}` : null,
      timestamp: product.created_at || ipfsData?.createdAt,
      finalizedAt: product.finalized_at,
      mode: product.mode,
      isFinalized: product.is_finalized,
      metadata: product.metadata || ipfsData?.metadata || {},
      photoHashes: photoHashes,
      photos: photos,
      location: location,
      mintedBy: ipfsData?.mintedBy || 'BizTrack',
      batchInfo: ipfsData?.batchInfo || null,
      supplyChain: supplyChain
    };

    return res.status(200).json({
      success: true,
      product: productData,
      verified: !!product.xrpl_tx_hash,
      verifiedOn: product.xrpl_tx_hash ? 'XRP Ledger' : 'Pending',
      blockchainTx: product.xrpl_tx_hash 
        ? `https://livenet.xrpl.org/transactions/${product.xrpl_tx_hash}`
        : null
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
