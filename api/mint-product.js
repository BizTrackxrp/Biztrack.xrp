const { Client, Wallet } = require('xrpl');
const { Pool } = require('pg');
const QRCode = require('qrcode');
const jwt = require('jsonwebtoken');
const stripeConfig = require('../stripe-config');
const { put } = require('@vercel/blob');

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

// ==========================================
// VERCEL BLOB UPLOAD HELPER
// ==========================================
async function uploadToBlob(buffer, filename, contentType = 'image/png') {
  const blob = await put(filename, buffer, {
    access: 'public',
    contentType: contentType
  });
  return blob.url;
}

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
      sameSku,
      mode: productMode,
      // Excel batch grouping
      isExcelBatch,
      excelBatchGroupId,
      excelBatchTotal,
      excelBatchIndex,
      excelBatchName,
      // Industry type (for general/food modes)
      industryType,
      // Customer rewards points (per product) - FIXED: Now extracted!
      rewardsPoints
    } = req.body;

    // Validate mode (default to 'live')
    const mode = productMode === 'production' ? 'production' : 'live';
    const isProductionMode = mode === 'production';

    if (!productName) {
      return res.status(400).json({ error: 'Product name is required' });
    }

    // Check batch quantity against tier limits (applies to both modes)
   if (isBatchOrder) {
  if (!batchQuantity || batchQuantity < 1) {
    return res.status(400).json({ 
      error: 'Batch quantity must be at least 1' 
    });
  }
  
  // Only check against remaining QR codes for live mode
  // Production mode skips this check entirely (handled later)
  if (!isProductionMode) {
    const remaining = user.qr_codes_limit - user.qr_codes_used;
    if (batchQuantity > remaining) {
      return res.status(400).json({ 
        error: `You have ${remaining} QR codes remaining but requested ${batchQuantity}. Upgrade your plan or reduce quantity.` 
      });
    }
  }
}

    const quantity = isBatchOrder ? parseInt(batchQuantity) : 1;

    // ==========================================
    // QR CODE LIMITS - ONLY CHECK FOR LIVE MODE
    // ==========================================
    if (!isProductionMode) {
      const tierConfig = stripeConfig.getTierConfig(user.subscription_tier);
      const tierDefaultLimit = tierConfig.qrLimit || 10;
      const now = new Date();
      const billingStart = user.billing_cycle_start ? new Date(user.billing_cycle_start) : null;

      // Only reset if we have a billing start AND it's been 30+ days
      if (billingStart) {
        const daysSinceStart = Math.floor((now - billingStart) / (1000 * 60 * 60 * 24));
        
        if (daysSinceStart >= 30) {
          console.log(`[BILLING] Resetting counter for user ${user.id} (${daysSinceStart} days since start)`);
          
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
    } else {
      console.log(`[PRODUCTION MODE] Skipping QR limit check for user ${user.id}`);
    }

    // ==========================================
    // PRODUCTION MODE - Simple flow
    // ==========================================
    if (isProductionMode) {
      console.log(`\n=== PRODUCTION MODE: Creating tracking entry ===`);
      
      const productId = `BT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const scanUrl = `https://www.biztrack.io/scan.html?id=${productId}`;
      const verificationUrl = `https://www.biztrack.io/verify.html?id=${productId}`;

      // Generate SKU - for batch or single, auto-generate if not provided
      const skuPrefix = !sku 
        ? `${productName.substring(0, 3).toUpperCase()}${Date.now().toString().slice(-4)}`
        : sku;

      // Generate batch group ID - use Excel batch ID if provided
      const batchGroupId = isExcelBatch ? excelBatchGroupId 
        : (isBatchOrder ? `BATCH-${Date.now()}-${Math.random().toString(36).substr(2, 6)}` : null);

      // For Excel batches, only first item is marked as batch group leader
      const is_batch_group = isExcelBatch ? (excelBatchIndex === 1) : isBatchOrder;

      // Upload photos to Vercel Blob if provided
      let photoUrls = [];
      if (photos && photos.length > 0) {
        console.log(`Uploading ${photos.length} photos to Vercel Blob...`);
        
        for (let i = 0; i < photos.length; i++) {
          const photoData = photos[i];
          const base64Data = photoData.includes(',') ? photoData.split(',')[1] : photoData;
          const buffer = Buffer.from(base64Data, 'base64');
          const photoUrl = await uploadToBlob(buffer, `production-photo-${productId}-${i + 1}.jpg`, 'image/jpeg');
          photoUrls.push(photoUrl);
          console.log(`Photo ${i + 1} uploaded:`, photoUrl);
        }
      }

      // Generate ONE tracking QR code (points to /scan.html for routing)
      console.log('Generating tracking QR code...');
      const trackingQrBuffer = await QRCode.toBuffer(scanUrl, {
        width: 300,
        margin: 2,
        color: { dark: '#000000', light: '#FFFFFF' },
        errorCorrectionLevel: 'M'
      });

      // Upload tracking QR to Vercel Blob
      const trackingQrUrl = await uploadToBlob(trackingQrBuffer, `${productId}-tracking-qr.png`);
      console.log('Tracking QR URL:', trackingQrUrl);

      // Save to database
      console.log('Saving production entry to database...');
      
      // ==========================================
      // FIXED: Include rewardPoints in metadata!
      // ==========================================
      const productMetadata = { ...(metadata || {}), industryType: industryType || 'general' };
      if (isExcelBatch && excelBatchIndex === 1 && excelBatchName) {
        productMetadata.batchDisplayName = excelBatchName;
      }
      // Store sameSku preference for finalization
      if (isBatchOrder && sameSku) {
        productMetadata.sameSku = true;
      }
      // FIXED: Store rewardPoints if provided
      if (rewardsPoints && !isNaN(parseInt(rewardsPoints))) {
        productMetadata.rewardPoints = parseInt(rewardsPoints);
        console.log(`[REWARDS] Storing ${rewardsPoints} reward points for product`);
      }
      
      await pool.query(
        `INSERT INTO products (
          product_id, product_name, sku, batch_number, 
          qr_code_url, metadata, user_id,
          is_batch_group, batch_group_id, batch_quantity,
          mode, is_finalized, photo_urls, location_data
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          productId, productName, skuPrefix || null, batchNumber || null, 
          trackingQrUrl, productMetadata, user.id,
          is_batch_group, batchGroupId,
          isExcelBatch ? excelBatchTotal : quantity,
          'production', false,
          photoUrls.length > 0 ? JSON.stringify(photoUrls) : null,
          location ? JSON.stringify(location) : null
        ]
      );

      console.log('Production entry created successfully!');
      console.log(`[PRODUCTION MODE] NO charge applied - will charge ${quantity} QR codes on finalization`);

      return res.status(200).json({
        success: true,
        isProductionMode: true,
        productId,
        productName,
        sku: skuPrefix,
        batchNumber,
        quantity,
        batchGroupId,
        mode: 'production',
        qrCodeUrl: trackingQrUrl,
        scanUrl,
        verificationUrl,
        message: isBatchOrder 
          ? `Production batch created with ${quantity} items. Add checkpoints, then Go Live to mint to blockchain.`
          : 'Production entry created. Add checkpoints, then Go Live to mint to blockchain.',
        note: 'No QR codes charged yet. You will be charged when you finalize/Go Live.'
      });
    }

    // ==========================================
    // LIVE MODE - Full blockchain mint flow
    // ==========================================
    console.log(`\n=== LIVE MODE: Full blockchain mint ===`);

    const products = [];

    // Generate SKU prefix - auto-generate if not provided (for batch or single)
    const skuPrefix = !sku 
      ? `${productName.substring(0, 3).toUpperCase()}${Date.now().toString().slice(-4)}`
      : sku;

    // Generate batch group ID - use Excel batch ID if provided
    const batchGroupId = isExcelBatch ? excelBatchGroupId 
      : (isBatchOrder ? `BATCH-${Date.now()}-${Math.random().toString(36).substr(2, 6)}` : null);

    // For Excel batches, only first item is marked as batch group leader
    const is_batch_group = isExcelBatch ? (excelBatchIndex === 1) : isBatchOrder;

    // Step 1: Upload shared photos to Vercel Blob
    let photoUrls = [];
    if (photos && photos.length > 0) {
      console.log(`Uploading ${photos.length} shared photos to Vercel Blob...`);
      
      for (let i = 0; i < photos.length; i++) {
        const photoData = photos[i];
        const base64Data = photoData.includes(',') ? photoData.split(',')[1] : photoData;
        const buffer = Buffer.from(base64Data, 'base64');
        const photoUrl = await uploadToBlob(buffer, `batch-photo-${Date.now()}-${i + 1}.jpg`, 'image/jpeg');
        photoUrls.push(photoUrl);
        console.log(`Shared photo ${i + 1} uploaded:`, photoUrl);
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

      // Generate SKU
      let productSku;
      if (isBatchOrder) {
        if (sameSku) {
          productSku = String(skuPrefix);
        } else {
          productSku = `${skuPrefix}-${String(itemNumber).padStart(3, '0')}`;
        }
      } else {
        productSku = sku 
          ? String(sku) 
          : `${productName.substring(0, 3).toUpperCase()}${Date.now().toString().slice(-4)}`;
      }

      // ==========================================
      // GENERATE SMART QR (Customer - Verification URL)
      // ==========================================
      console.log(`Generating SMART QR code for ${productSku || productId}...`);
      const smartQrBuffer = await QRCode.toBuffer(verificationUrl, {
        width: 300,
        margin: 2,
        color: { dark: '#000000', light: '#FFFFFF' },
        errorCorrectionLevel: 'M'
      });

      console.log('Uploading SMART QR code to Vercel Blob...');
      const smartQrUrl = await uploadToBlob(smartQrBuffer, `${productId}-smart-qr.png`);
      console.log('SMART QR Code URL:', smartQrUrl);

      // ==========================================
      // GENERATE DUMB QR (Inventory - Raw SKU only)
      // ==========================================
      let dumbQrUrl = null;
      const skuForQr = productSku && String(productSku).length >= 2 ? String(productSku) : null;
      
      if (skuForQr) {
        console.log(`Generating DUMB QR code (SKU: ${skuForQr})...`);
        const dumbQrBuffer = await QRCode.toBuffer(skuForQr, {
          width: 300,
          margin: 2,
          color: { dark: '#000000', light: '#FFFFFF' },
          errorCorrectionLevel: 'L'
        });

        console.log('Uploading DUMB QR code to Vercel Blob...');
        dumbQrUrl = await uploadToBlob(dumbQrBuffer, `${productId}-inventory-qr.png`);
        console.log('DUMB QR Code URL:', dumbQrUrl);
      }

      // ==========================================
      // FIXED: Include rewardPoints in metadata!
      // ==========================================
      const baseMetadata = { ...(metadata || {}), industryType: industryType || 'general' };
      if (rewardsPoints && !isNaN(parseInt(rewardsPoints))) {
        baseMetadata.rewardPoints = parseInt(rewardsPoints);
        console.log(`[REWARDS] Storing ${rewardsPoints} reward points for product`);
      }

      // Build product data
      const productData = {
        productId,
        productName,
        sku: productSku,
        batchNumber: batchNumber || null,
        metadata: baseMetadata,
        photoUrls: photoUrls.length > 0 ? photoUrls : null,
        location: location || null,
        smartQrUrl,
        inventoryQrUrl: dumbQrUrl,
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

      // Create hash of product data for blockchain
      const crypto = require('crypto');
      const productDataHash = crypto.createHash('sha256').update(JSON.stringify(productData)).digest('hex');

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
                dataHash: productDataHash,
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
      
      // For batch leaders, store display info in metadata
      const isBatchLeader = isExcelBatch ? (excelBatchIndex === 1) : (isBatchOrder && itemNumber === 1);
      const productMetadata = { ...baseMetadata, dataHash: productDataHash };
      if (isExcelBatch && isBatchLeader && excelBatchName) {
        productMetadata.batchDisplayName = excelBatchName;
      }
      if (isBatchOrder && isBatchLeader && !sameSku) {
        productMetadata.batchSkuPrefix = skuPrefix;
      }
      
      // ==========================================
      // FIXED: Now includes photo_urls and location_data!
      // ==========================================
      await pool.query(
        `INSERT INTO products (
          product_id, product_name, sku, batch_number, 
          xrpl_tx_hash, qr_code_url, inventory_qr_code_url,
          metadata, user_id,
          is_batch_group, batch_group_id, batch_quantity,
          mode, is_finalized, photo_urls, location_data
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [
          productId, productName, productSku, batchNumber, 
          txHash, smartQrUrl, dumbQrUrl,
          productMetadata, user.id,
          isBatchLeader, batchGroupId,
          isExcelBatch ? excelBatchTotal : (isBatchOrder ? quantity : null),
          'live', true,
          photoUrls.length > 0 ? JSON.stringify(photoUrls) : null,
          location ? JSON.stringify(location) : null
        ]
      );

      console.log(`Item ${itemNumber} saved successfully!`);

      products.push({
        productId,
        productName,
        sku: productSku,
        batchNumber,
        xrplTxHash: txHash,
        verificationUrl,
        mode: 'live',
        qrCodeUrl: smartQrUrl,
        inventoryQrCodeUrl: dumbQrUrl,
        blockchainExplorer: `https://livenet.xrpl.org/transactions/${txHash}`,
        timestamp: new Date().toISOString()
      });

      if (i < quantity - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    await client.disconnect();

    // UPDATE QR CODE COUNTER (ONLY FOR LIVE MODE)
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
        xrplTxHash: product.xrplTxHash,
        verificationUrl: product.verificationUrl,
        qrCodeUrl: product.qrCodeUrl,
        inventoryQrCodeUrl: product.inventoryQrCodeUrl,
        blockchainExplorer: product.blockchainExplorer
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
