const { Client, Wallet } = require('xrpl');
const axios = require('axios');
const { Pool } = require('pg');
const QRCode = require('qrcode');

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let client;

  try {
    const { 
      productName, 
      sku, 
      batchNumber, 
      metadata, 
      photos, 
      location,
      isBatchOrder,
      batchQuantity 
    } = req.body;

    if (!productName) {
      return res.status(400).json({ error: 'Product name is required' });
    }

    if (isBatchOrder) {
      if (!batchQuantity || batchQuantity < 1 || batchQuantity > 100) {
        return res.status(400).json({ 
          error: 'Batch quantity must be between 1 and 100' 
        });
      }
    }

    const quantity = isBatchOrder ? parseInt(batchQuantity) : 1;
    const products = [];
    const qrCodeBuffers = [];

    // Generate auto SKU prefix for batch orders if not provided
    const skuPrefix = isBatchOrder && !sku 
      ? `${productName.substring(0, 3).toUpperCase()}${Date.now().toString().slice(-4)}`
      : sku;

    // Step 1: Upload shared photos to IPFS
    let photoHashes = [];
    if (photos && photos.length > 0) {
      console.log(`Uploading ${photos.length} shared photos to IPFS...`);
      
      for (let i = 0; i < photos.length; i++) {
        const photoData = photos[i];
        const buffer = Buffer.from(photoData.split(',')[1], 'base64');
        
        const FormData = require('form-data');
        const photoFormData = new FormData();
        photoFormData.append('file', buffer, {
          filename: `batch-photo-${Date.now()}-${i + 1}.jpg`,
          contentType: 'image/jpeg'
        });

        const photoResponse = await axios.post(
          'https://api.pinata.cloud/pinning/pinFileToIPFS',
          photoFormData,
          {
            headers: {
              ...photoFormData.getHeaders(),
              'Authorization': `Bearer ${process.env.PINATA_JWT}`
            }
          }
        );

        photoHashes.push(photoResponse.data.IpfsHash);
        console.log(`Shared photo ${i + 1} IPFS Hash:`, photoResponse.data.IpfsHash);
      }
    }

    // Step 2: Connect to XRPL
    console.log('Connecting to XRPL...');
    client = new Client('wss://xrplcluster.com');
    await client.connect();
    console.log('Connected to XRPL');

    const wallet = Wallet.fromSeed(process.env.XRPL_SERVICE_WALLET_SECRET);

    // Step 3: Process each product
    for (let i = 0; i < quantity; i++) {
      const itemNumber = i + 1;
      console.log(`\n--- Processing item ${itemNumber} of ${quantity} ---`);

      const productId = `BT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const verificationUrl = `https://www.biztrack.io/verify.html?id=${productId}`;

      // Auto-generate SKU for batch orders
      const productSku = isBatchOrder 
        ? `${skuPrefix}-${String(itemNumber).padStart(3, '0')}`
        : (sku || null);

      console.log(`Generating QR code for ${productSku || productId}...`);
      const qrCodeBuffer = await QRCode.toBuffer(verificationUrl, {
        width: 300,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });

      qrCodeBuffers.push({
        buffer: qrCodeBuffer,
        filename: `${productSku || productId}-QR.png`
      });

      console.log('Uploading QR code to IPFS...');
      const FormData = require('form-data');
      const qrFormData = new FormData();
      qrFormData.append('file', qrCodeBuffer, {
        filename: `${productId}-qr.png`,
        contentType: 'image/png'
      });

      const qrPinataResponse = await axios.post(
        'https://api.pinata.cloud/pinning/pinFileToIPFS',
        qrFormData,
        {
          headers: {
            ...qrFormData.getHeaders(),
            'Authorization': `Bearer ${process.env.PINATA_JWT}`
          }
        }
      );

      const qrIpfsHash = qrPinataResponse.data.IpfsHash;
      console.log('QR Code IPFS Hash:', qrIpfsHash);

      const productData = {
        productId,
        productName,
        sku: productSku,
        batchNumber: batchNumber || null,
        metadata: metadata || {},
        photoHashes: photoHashes.length > 0 ? photoHashes : null,
        qrCodeIpfsHash: qrIpfsHash,
        verificationUrl,
        createdAt: new Date().toISOString(),
        mintedBy: 'BizTrack Supply Chain Tracking',
        batchInfo: isBatchOrder ? {
          isBatchOrder: true,
          itemNumber: itemNumber,
          totalInBatch: quantity
        } : null
      };

      console.log('Uploading product data to IPFS...');
      const pinataResponse = await axios.post(
        'https://api.pinata.cloud/pinning/pinJSONToIPFS',
        {
          pinataContent: productData,
          pinataMetadata: {
            name: `BizTrack-${productId}`
          }
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.PINATA_JWT}`
          }
        }
      );

      const ipfsHash = pinataResponse.data.IpfsHash;
      console.log('Product Data IPFS Hash:', ipfsHash);

      console.log('Writing to XRPL...');
      const tx = {
        TransactionType: 'AccountSet',
        Account: wallet.address,
        Memos: [
          {
            Memo: {
              MemoType: Buffer.from('BizTrack-Product').toString('hex').toUpperCase(),
              MemoData: Buffer.from(JSON.stringify({
                productId,
                ipfsHash,
                qrCodeIpfsHash: qrIpfsHash,
                timestamp: new Date().toISOString(),
                batchInfo: isBatchOrder ? { itemNumber, totalInBatch: quantity } : null
              })).toString('hex').toUpperCase()
            }
          }
        ]
      };

      console.log('Autofilling transaction...');
      const prepared = await client.autofill(tx);

      console.log('Signing and submitting...');
      const signed = wallet.sign(prepared);
      const submitResult = await client.submit(signed.tx_blob);

      const txHash = submitResult.result.tx_json.hash;
      const engineResult = submitResult.result.engine_result;
      
      console.log('Transaction hash:', txHash);
      console.log('Engine result:', engineResult);

      if (engineResult !== 'tesSUCCESS' && engineResult !== 'terQUEUED') {
        throw new Error(`Transaction submission failed for item ${itemNumber}: ${engineResult}`);
      }

      console.log('Saving to database...');
      await pool.query(
        `INSERT INTO products (product_id, product_name, sku, batch_number, ipfs_hash, xrpl_tx_hash, qr_code_ipfs_hash, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [productId, productName, productSku, batchNumber, ipfsHash, txHash, qrIpfsHash, metadata]
      );

      console.log(`Item ${itemNumber} saved successfully!`);

      products.push({
        productId,
        productName,
        sku: productSku,
        batchNumber,
        ipfsHash,
        qrCodeIpfsHash: qrIpfsHash,
        xrplTxHash: txHash,
        verificationUrl,
        qrCodeUrl: `https://gateway.pinata.cloud/ipfs/${qrIpfsHash}`,
        blockchainExplorer: `https://livenet.xrpl.org/transactions/${txHash}`,
        ipfsGateway: `https://gateway.pinata.cloud/ipfs/${ipfsHash}`,
        timestamp: new Date().toISOString()
      });

      if (i < quantity - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    await client.disconnect();

    // Step 4: For batch orders, return product data (no ZIP creation)
    if (isBatchOrder && products.length > 1) {
      console.log('\nBatch order complete - returning product data');

      return res.status(200).json({
        success: true,
        isBatch: true,
        batchInfo: {
          productName,
          skuPrefix,
          batchNumber,
          quantity,
          timestamp: new Date().toISOString()
        },
        products: products,
        totalCost: {
          xrp: (0.000012 * quantity).toFixed(6),
          usd: (0.000012 * quantity * 2.5).toFixed(6)
        }
      });
    } else {
      // Single product
      const product = products[0];

      return res.status(200).json({
        success: true,
        productId: product.productId,
        ipfsHash: product.ipfsHash,
        qrCodeIpfsHash: product.qrCodeIpfsHash,
        xrplTxHash: product.xrplTxHash,
        verificationUrl: product.verificationUrl,
        qrCodeUrl: product.qrCodeUrl,
        blockchainExplorer: product.blockchainExplorer,
        ipfsGateway: product.ipfsGateway
      });
    }

  } catch (error) {
    console.error('Minting error:', error);
    if (client) {
      try {
        await client.disconnect();
      } catch (e) {}
    }
    return res.status(500).json({
      error: 'Minting failed',
      details: error.message
    });
  }
};
