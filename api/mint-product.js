const { Client, Wallet } = require('xrpl');
const axios = require('axios');
const { Pool } = require('pg');
const QRCode = require('qrcode');
const jwt = require('jsonwebtoken');
const stripeConfig = require('../stripe-config');

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let client;

  try {
    // AUTHENTICATE USER
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized - Please login' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    // Get user from database with subscription info
    const userResult = await pool.query(
      'SELECT * FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    const { 
      productName, 
      sku, 
      batchNumber, 
      metadata, 
      photos, 
      location,
      isBatchOrder,
      batchQuantity,
      mode: productMode
    } = req.body;

    // Validate mode (default to 'live')
    const mode = productMode === 'production' ? 'production' : 'live';

    if (!productName) {
      return res.status(400).json({ error: 'Product name is required' });
    }

    // Check batch quantity against tier limits
    if (isBatchOrder) {
      const tierConfig = stripeConfig.getTierConfig(user.subscription_tier);
      const maxBatch = tierConfig.maxBatchSize || 10;

      if (!batchQuantity || batchQuantity < 1 || batchQuantity > maxBatch) {
        return res.status(400).json({ 
          error: `Batch quantity must be between 1 and ${maxBatch} for your ${user.subscription_tier} plan` 
        });
      }
    }

    const quantity = isBatchOrder ? parseInt(batchQuantity) : 1;

    // CHECK QR CODE LIMITS WITH FIXED BILLING CYCLE LOGIC
    const tierConfig = stripeConfig.getTierConfig(user.subscription_tier);
    const tierDefaultLimit = tierConfig.qrLimit || 10;  // Get tier's default QR limit
    const now = new Date();
    const billingStart = user.billing_cycle_start ? new Date(user.billing_cycle_start) : null;

    // Only reset if we have a billing start AND it's been 30+ days
    if (billingStart) {
      const daysSinceStart = Math.floor((now - billingStart) / (1000 * 60 * 60 * 24));
      
      if (daysSinceStart >= 30) {
        console.log(`[BILLING] Resetting counter for user ${user.id} (${daysSinceStart} days since start)`);
        
        // Reset usage to 0 AND reset limit to tier default (removes promo bonuses)
        await pool.query(
          `UPDATE users 
           SET qr_codes_used = 0,
               qr_codes_limit = $1,
               billing_cycle_start = NOW()
           WHERE id = $2`,
          [tierDefaultLimit, user.id]
        );
        user.qr_codes_used = 0;
        user.qr_codes_limit = tierDefaultLimit;
        
        console.log(`[BILLING] Reset complete - limit back to ${tierDefaultLimit} (tier default)`);
      }
    } else {
      // First time minting - set billing cycle start
      console.log(`[BILLING] Setting initial billing cycle for user ${user.id}`);
      
      await pool.query(
        `UPDATE users 
         SET billing_cycle_start = NOW()
         WHERE id = $1`,
        [user.id]
      );
    }

    // Calculate remaining AFTER potential reset
    const remaining = user.qr_codes_limit - user.qr_codes_used;

    // Check if user has enough QR codes
    if (quantity > remaining) {
      const nextTier = stripeConfig.getNextTier(user.subscription_tier);
      const nextTierConfig = nextTier ? stripeConfig.getTierConfig(nextTier) : null;

      return res.status(403).json({ 
        error: 'QR code limit exceeded',
        message: `You need ${quantity} QR codes but only have ${remaining} remaining.`,
        limits: {
          tier: user.subscription_tier,
          used: user.qr_codes_used,
          limit: user.qr_codes_limit,
          remaining: remaining,
          requested: quantity
        },
        upgrade: {
          available: !!nextTier,
          nextTier: nextTier,
          nextTierName: nextTierConfig?.name,
          nextTierLimit: nextTierConfig?.qrLimit,
          nextTierPrice: nextTierConfig?.price
        }
      });
    }

    const products = [];

    // Generate auto SKU prefix for batch orders if not provided
    const skuPrefix = isBatchOrder && !sku 
      ? `${productName.substring(0, 3).toUpperCase()}${Date.now().toString().slice(-4)}`
      : sku;

    // Generate batch group ID for batch orders
    const batchGroupId = isBatchOrder ? `BATCH-${Date.now()}-${Math.random().toString(36).substr(2, 6)}` : null;

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

      // ==========================================
      // GENERATE SMART QR (Customer - Verification URL)
      // ==========================================
      console.log(`Generating SMART QR code for ${productSku || productId}...`);
      const smartQrBuffer = await QRCode.toBuffer(verificationUrl, {
        width: 300,
        margin: 2,
        color: {
          dark: '#1E293B',  // Dark blue-gray for branded look
          light: '#FFFFFF'
        },
        errorCorrectionLevel: 'M'
      });

      console.log('Uploading SMART QR code to IPFS...');
      const FormData = require('form-data');
      const smartQrFormData = new FormData();
      smartQrFormData.append('file', smartQrBuffer, {
        filename: `${productId}-smart-qr.png`,
        contentType: 'image/png'
      });

      const smartQrPinataResponse = await axios.post(
        'https://api.pinata.cloud/pinning/pinFileToIPFS',
        smartQrFormData,
        {
          headers: {
            ...smartQrFormData.getHeaders(),
            'Authorization': `Bearer ${process.env.PINATA_JWT}`
          }
        }
      );

      const smartQrIpfsHash = smartQrPinataResponse.data.IpfsHash;
      console.log('SMART QR Code IPFS Hash:', smartQrIpfsHash);

      // ==========================================
      // GENERATE DUMB QR (Inventory - Raw SKU only)
      // ==========================================
      let dumbQrIpfsHash = null;
      
      if (productSku) {
        console.log(`Generating DUMB QR code (SKU: ${productSku})...`);
        const dumbQrBuffer = await QRCode.toBuffer(productSku, {
          width: 300,
          margin: 2,
          color: {
            dark: '#000000',  // Plain black
            light: '#FFFFFF'  // Plain white
          },
          errorCorrectionLevel: 'L'  // Lower error correction for simpler/faster scanning
        });

        console.log('Uploading DUMB QR code to IPFS...');
        const dumbQrFormData = new FormData();
        dumbQrFormData.append('file', dumbQrBuffer, {
          filename: `${productId}-inventory-qr.png`,
          contentType: 'image/png'
        });

        const dumbQrPinataResponse = await axios.post(
          'https://api.pinata.cloud/pinning/pinFileToIPFS',
          dumbQrFormData,
          {
            headers: {
              ...dumbQrFormData.getHeaders(),
              'Authorization': `Bearer ${process.env.PINATA_JWT}`
            }
          }
        );

        dumbQrIpfsHash = dumbQrPinataResponse.data.IpfsHash;
        console.log('DUMB QR Code IPFS Hash:', dumbQrIpfsHash);
      }

      const productData = {
        productId,
        productName,
        sku: productSku,
        batchNumber: batchNumber || null,
        metadata: metadata || {},
        photoHashes: photoHashes.length > 0 ? photoHashes : null,
        location: location || null,
        qrCodeIpfsHash: smartQrIpfsHash,
        inventoryQrCodeIpfsHash: dumbQrIpfsHash,
        verificationUrl,
        createdAt: new Date().toISOString(),
        mintedBy: 'BizTrack Supply Chain Tracking',
        batchInfo: isBatchOrder ? {
          isBatchOrder: true,
          itemNumber: itemNumber,
          totalInBatch: quantity,
          batchGroupId: batchGroupId
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
                qrCodeIpfsHash: smartQrIpfsHash,
                inventoryQrCodeIpfsHash: dumbQrIpfsHash,
                timestamp: new Date().toISOString(),
                batchInfo: isBatchOrder ? { itemNumber, totalInBatch: quantity, batchGroupId } : null
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
        `INSERT INTO products (
          product_id, 
          product_name, 
          sku, 
          batch_number, 
          ipfs_hash, 
          xrpl_tx_hash, 
          qr_code_ipfs_hash,
          inventory_qr_code_ipfs_hash,
          metadata, 
          user_id,
          is_batch_group,
          batch_group_id,
          batch_quantity,
          mode
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          productId, 
          productName, 
          productSku, 
          batchNumber, 
          ipfsHash, 
          txHash, 
          smartQrIpfsHash,
          dumbQrIpfsHash,
          metadata, 
          user.id,
          isBatchOrder && itemNumber === 1,
          batchGroupId,
          isBatchOrder ? quantity : null,
          mode
        ]
      );

      console.log(`Item ${itemNumber} saved successfully!`);

      products.push({
        productId,
        productName,
        sku: productSku,
        batchNumber,
        ipfsHash,
        qrCodeIpfsHash: smartQrIpfsHash,
        inventoryQrCodeIpfsHash: dumbQrIpfsHash,
        xrplTxHash: txHash,
        verificationUrl,
        mode,
        // Smart QR - for customers (verification page)
        qrCodeUrl: `https://gateway.pinata.cloud/ipfs/${smartQrIpfsHash}`,
        // Dumb QR - for inventory/POS (raw SKU)
        inventoryQrCodeUrl: dumbQrIpfsHash ? `https://gateway.pinata.cloud/ipfs/${dumbQrIpfsHash}` : null,
        blockchainExplorer: `https://livenet.xrpl.org/transactions/${txHash}`,
        ipfsGateway: `https://gateway.pinata.cloud/ipfs/${ipfsHash}`,
        timestamp: new Date().toISOString()
      });

      if (i < quantity - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    await client.disconnect();

    // UPDATE QR CODE COUNTER
    await pool.query(
      'UPDATE users SET qr_codes_used = qr_codes_used + $1 WHERE id = $2',
      [quantity, user.id]
    );
    console.log(`Updated QR counter: +${quantity} for user ${user.id}`);

    // Step 4: Return JSON
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
          batchGroupId,
          timestamp: new Date().toISOString()
        },
        products: products,
        totalCost: {
          xrp: (0.000012 * quantity).toFixed(6),
          usd: (0.000012 * quantity * 2.5).toFixed(6)
        }
      });
    } else {
      const product = products[0];

      return res.status(200).json({
        success: true,
        productId: product.productId,
        ipfsHash: product.ipfsHash,
        qrCodeIpfsHash: product.qrCodeIpfsHash,
        inventoryQrCodeIpfsHash: product.inventoryQrCodeIpfsHash,
        xrplTxHash: product.xrplTxHash,
        verificationUrl: product.verificationUrl,
        qrCodeUrl: product.qrCodeUrl,
        inventoryQrCodeUrl: product.inventoryQrCodeUrl,
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
