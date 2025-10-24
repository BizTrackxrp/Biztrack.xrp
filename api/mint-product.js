const { Client, Wallet } = require('xrpl');
const axios = require('axios');
const { Pool } = require('pg');
const QRCode = require('qrcode');
const archiver = require('archiver');
const { Readable } = require('stream');

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

module.exports = async (req, res) => {
  // Only allow POST requests
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

    // Validate required fields
    if (!productName) {
      return res.status(400).json({ error: 'Product name is required' });
    }

    // Validate batch order parameters
    if (isBatchOrder) {
      if (!batchQuantity || batchQuantity < 1 || batchQuantity > 100) {
        return res.status(400).json({ 
          error: 'Batch quantity must be between 1 and 100' 
        });
      }
      if (!sku) {
        return res.status(400).json({ 
          error: 'SKU prefix is required for batch orders' 
        });
      }
    }

    const quantity = isBatchOrder ? parseInt(batchQuantity) : 1;
    const products = [];
    const qrCodeBuffers = [];

    // Step 1: Upload shared photos to IPFS (if provided)
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

    // Step 2: Connect to XRPL once for all transactions
    console.log('Connecting to XRPL...');
    client = new Client('wss://xrplcluster.com');
    await client.connect();
    console.log('Connected to XRPL');

    const wallet = Wallet.fromSeed(process.env.XRPL_SERVICE_WALLET_SECRET);

    // Step 3: Process each product in the batch
    for (let i = 0; i < quantity; i++) {
      const itemNumber = i + 1;
      console.log(`\n--- Processing item ${itemNumber} of ${quantity} ---`);

      // Generate unique product ID
      const productId = `BT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const verificationUrl = `https://www.biztrack.io/verify.html?id=${productId}`;

      // Generate SKU with incremental suffix for batch orders
      const productSku = isBatchOrder 
        ? `${sku}-${String(itemNumber).padStart(3, '0')}`
        : (sku || null);

      // Generate QR Code as PNG buffer
      console.log(`Generating QR code for ${productSku || productId}...`);
      const qrCodeBuffer = await QRCode.toBuffer(verificationUrl, {
        width: 300,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });

      // Store QR buffer for ZIP file
      qrCodeBuffers.push({
        buffer: qrCodeBuffer,
        filename: `${productSku || productId}-QR.png`
      });

      // Upload QR code to IPFS
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

      // Prepare product data for IPFS
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

      // Upload product data to IPFS via Pinata
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

      // Write IPFS hash to XRPL using AccountSet
      console.log('Writing to XRPL...');

      // Prepare AccountSet transaction with memo containing IPFS hash
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

      // Sign and submit
      console.log('Signing and submitting...');
      const signed = wallet.sign(prepared);
      const submitResult = await client.submit(signed.tx_blob);

      const txHash = submitResult.result.tx_json.hash;
      const engineResult = submitResult.result.engine_result;
      
      console.log('Transaction hash:', txHash);
      console.log('Engine result:', engineResult);

      // Check if submission was successful
      if (engineResult !== 'tesSUCCESS' && engineResult !== 'terQUEUED') {
        throw new Error(`Transaction submission failed for item ${itemNumber}: ${engineResult}`);
      }

      // Save to database
      console.log('Saving to database...');
      
      await pool.query(
        `INSERT INTO products (product_id, product_name, sku, batch_number, ipfs_hash, xrpl_tx_hash, qr_code_ipfs_hash, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [productId, productName, productSku, batchNumber, ipfsHash, txHash, qrIpfsHash, metadata]
      );

      console.log(`Item ${itemNumber} saved successfully!`);

      // Store product info
      products.push({
        productId,
        sku: productSku,
        ipfsHash,
        qrCodeIpfsHash: qrIpfsHash,
        xrplTxHash: txHash,
        verificationUrl,
        qrCodeUrl: `https://gateway.pinata.cloud/ipfs/${qrIpfsHash}`,
        blockchainExplorer: `https://livenet.xrpl.org/transactions/${txHash}`,
        ipfsGateway: `https://gateway.pinata.cloud/ipfs/${ipfsHash}`
      });

      // Small delay between transactions to avoid rate limiting
      if (i < quantity - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    await client.disconnect();

    // Step 4: For batch orders, create ZIP file with all QR codes
    if (isBatchOrder && qrCodeBuffers.length > 1) {
      console.log('\nCreating ZIP file with all QR codes...');
      
      // Create ZIP archive
      const archive = archiver('zip', {
        zlib: { level: 9 }
      });

      // Set response headers for ZIP download
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename=BizTrack-QRCodes-${sku}-${Date.now()}.zip`);

      // Pipe archive to response
      archive.pipe(res);

      // Add each QR code to the ZIP
      for (const qrData of qrCodeBuffers) {
        archive.append(qrData.buffer, { name: qrData.filename });
      }

      // Add a summary text file
      const summaryText = `BizTrack Batch Order Summary
=====================================
Product Name: ${productName}
SKU Prefix: ${sku}
Batch Number: ${batchNumber || 'N/A'}
Total Items: ${quantity}
Created: ${new Date().toISOString()}

Products Created:
${products.map((p, idx) => `${idx + 1}. ${p.sku}
   Product ID: ${p.productId}
   Verification URL: ${p.verificationUrl}
   XRPL TX: ${p.xrplTxHash}
`).join('\n')}

Total Cost: ${(0.000012 * quantity).toFixed(6)} XRP
Estimated USD: $${(0.000012 * quantity * 2.5).toFixed(6)}
`;

      archive.append(summaryText, { name: 'BATCH_SUMMARY.txt' });

      // Finalize the archive
      await archive.finalize();

      console.log('ZIP file created and sent!');
    } else {
      // Single product response (original format)
      const product = products[0];
      const estimatedFee = '0.000012';
      const estimatedFeeDrops = '12';

      return res.status(200).json({
        success: true,
        productId: product.productId,
        ipfsHash: product.ipfsHash,
        qrCodeIpfsHash: product.qrCodeIpfsHash,
        xrplTxHash: product.xrplTxHash,
        actualCost: {
          fee: estimatedFee,
          feeInDrops: estimatedFeeDrops,
          currency: 'XRP',
          feeInUSD: (parseFloat(estimatedFee) * 2.5).toFixed(6)
        },
        verificationUrl: product.verificationUrl,
        qrCodeUrl: product.qrCodeUrl,
        blockchainExplorer: product.blockchainExplorer,
        ipfsGateway: product.ipfsGateway,
        note: 'Transaction submitted successfully. Validation will complete in ~5 seconds.'
      });
    }

  } catch (error) {
    console.error('Minting error:', error);
    if (client) {
      try {
        await client.disconnect();
      } catch (e) {
        // Ignore disconnect errors
      }
    }
    return res.status(500).json({
      error: 'Minting failed',
      details: error.message
    });
  }
};
