const { Pool } = require('pg');
const axios = require('axios');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { 
      productId,
      latitude,
      longitude,
      locationName,
      notes,
      photos,
      scannedByName,
      scannedByRole
    } = req.body;

    if (!productId) {
      return res.status(400).json({ error: 'Product ID is required' });
    }

    if (!scannedByName || !scannedByRole) {
      return res.status(400).json({ error: 'Name and role are required' });
    }

    // Get product and verify it's in production mode
    const productResult = await pool.query(
      'SELECT * FROM products WHERE product_id = $1',
      [productId]
    );

    if (productResult.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const product = productResult.rows[0];

    if (product.mode !== 'production') {
      return res.status(400).json({ error: 'Product is not in production mode' });
    }

    if (product.is_finalized) {
      return res.status(400).json({ error: 'Product has been finalized and cannot be updated' });
    }

    // Upload photos to IPFS if provided
    let photoUrls = [];
    if (photos && photos.length > 0) {
      console.log(`Uploading ${photos.length} checkpoint photos to IPFS...`);
      
      const FormData = require('form-data');
      
      for (let i = 0; i < photos.length; i++) {
        try {
          const photoData = photos[i];
          
          // Handle both base64 with prefix and without
          const base64Data = photoData.includes(',') 
            ? photoData.split(',')[1] 
            : photoData;
          
          const buffer = Buffer.from(base64Data, 'base64');
          
          const formData = new FormData();
          formData.append('file', buffer, {
            filename: `checkpoint-${productId}-${Date.now()}-${i + 1}.jpg`,
            contentType: 'image/jpeg'
          });

          const pinataResponse = await axios.post(
            'https://api.pinata.cloud/pinning/pinFileToIPFS',
            formData,
            {
              headers: {
                ...formData.getHeaders(),
                'Authorization': `Bearer ${process.env.PINATA_JWT}`
              },
              maxContentLength: Infinity,
              maxBodyLength: Infinity
            }
          );

          const ipfsUrl = `https://gateway.pinata.cloud/ipfs/${pinataResponse.data.IpfsHash}`;
          photoUrls.push(ipfsUrl);
          console.log(`Checkpoint photo ${i + 1} uploaded: ${pinataResponse.data.IpfsHash}`);
        } catch (uploadError) {
          console.error(`Failed to upload photo ${i + 1}:`, uploadError.message);
          // Continue with other photos even if one fails
        }
      }
    }

    // Get IP address
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || 
               req.headers['x-real-ip'] || 
               req.socket?.remoteAddress || 
               null;

    // Insert production scan
    const scanResult = await pool.query(
      `INSERT INTO production_scans (
        product_id,
        latitude,
        longitude,
        location_name,
        notes,
        photos,
        scanned_by_name,
        scanned_by_role,
        ip_address
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9
      ) RETURNING *`,
      [
        product.id,
        latitude || null,
        longitude || null,
        locationName || null,
        notes || null,
        photoUrls.length > 0 ? photoUrls : null,
        scannedByName,
        scannedByRole,
        ip
      ]
    );

    const scan = scanResult.rows[0];

    // Get total scan count for this product
    const countResult = await pool.query(
      'SELECT COUNT(*) FROM production_scans WHERE product_id = $1',
      [product.id]
    );

    console.log(`Checkpoint logged for ${productId}: scan #${scan.id}, ${photoUrls.length} photos`);

    return res.status(200).json({
      success: true,
      message: 'Checkpoint logged successfully',
      scan: {
        id: scan.id,
        scannedAt: scan.scanned_at,
        latitude: scan.latitude,
        longitude: scan.longitude,
        locationName: scan.location_name,
        notes: scan.notes,
        photos: scan.photos,
        scannedByName: scan.scanned_by_name,
        scannedByRole: scan.scanned_by_role
      },
      totalCheckpoints: parseInt(countResult.rows[0].count)
    });

  } catch (error) {
    console.error('Log production scan error:', error);
    return res.status(500).json({
      error: 'Failed to log checkpoint',
      details: error.message
    });
  }
};
