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
// GS1 ENCODING HELPERS
// ==========================================

/**
 * Convert NDC to GTIN-14
 */
function ndcToGtin14(ndc) {
  const cleanNdc = ndc.replace(/[^0-9]/g, '');
  let ndc11 = cleanNdc.padStart(11, '0').substring(0, 11);
  const gtinWithoutCheck = '00' + ndc11;
  const checkDigit = calculateGS1CheckDigit(gtinWithoutCheck);
  return gtinWithoutCheck + checkDigit;
}

/**
 * Calculate GS1 check digit using mod 10 algorithm
 */
function calculateGS1CheckDigit(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    const digit = parseInt(digits[i], 10);
    sum += digit * (i % 2 === 0 ? 1 : 3);
  }
  const remainder = sum % 10;
  return remainder === 0 ? '0' : String(10 - remainder);
}

/**
 * Format expiry date as YYMMDD for GS1 AI(17)
 */
function formatExpiryForGS1(expDate) {
  let date = typeof expDate === 'string' ? new Date(expDate) : expDate;
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return yy + mm + dd;
}

/**
 * Build GS1 encoded string for pharmaceutical products
 */
function buildGS1String(ndc, serialNumber, expiryDate, lotNumber) {
  const gtin = ndcToGtin14(ndc);
  const expiry = formatExpiryForGS1(expiryDate);
  const cleanSerial = serialNumber.replace(/[^A-Za-z0-9]/g, '').substring(0, 20);
  const cleanLot = lotNumber.replace(/[^A-Za-z0-9]/g, '').substring(0, 20);
  const gs1String = `(01)${gtin}(21)${cleanSerial}(17)${expiry}(10)${cleanLot}`;
  
  return { formatted: gs1String, gtin, serial: cleanSerial, expiry, lot: cleanLot };
}

function validateNDC(ndc) {
  const cleanNdc = ndc.replace(/[^0-9]/g, '');
  if (cleanNdc.length < 9 || cleanNdc.length > 11) {
    return { valid: false, error: 'NDC must be 9-11 digits' };
  }
  return { valid: true };
}

function validateExpiry(expDate) {
  const date = new Date(expDate);
  if (isNaN(date.getTime())) {
    return { valid: false, error: 'Invalid expiration date format' };
  }
  if (date <= new Date()) {
    return { valid: false, error: 'Expiration date must be in the future' };
  }
  return { valid: true };
}

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

// ==========================================
// MAIN HANDLER
// ==========================================

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

    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [decoded.userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    const { 
      productName, ndc, serialNumber, lotNumber, expDate, manufacturer,
      metadata, photos, location, isBatchOrder, batchQuantity, mode: productMode
    } = req.body;

    const mode = productMode === 'production' ? 'production' : 'live';
    const isProductionMode = mode === 'production';

    // ==========================================
    // PHARMA-SPECIFIC VALIDATION
    // ==========================================
    if (!productName) return res.status(400).json({ error: 'Product name is required' });
    if (!ndc) return res.status(400).json({ error: 'NDC is required for DSCSA compliance' });
    
    const ndcValidation = validateNDC(ndc);
    if (!ndcValidation.valid) return res.status(400).json({ error: ndcValidation.error });
    
    if (!lotNumber) return res.status(400).json({ error: 'Lot number is required for DSCSA compliance' });
    if (!expDate) return res.status(400).json({ error: 'Expiration date is required for DSCSA compliance' });
    
    const expiryValidation = validateExpiry(expDate);
    if (!expiryValidation.valid) return res.status(400).json({ error: expiryValidation.error });
    
    if (!isBatchOrder && !serialNumber) {
      return res.status(400).json({ error: 'Serial number is required for DSCSA compliance' });
    }

    if (isBatchOrder) {
      const tierConfig = stripeConfig.getTierConfig(user.subscription_tier);
      const maxBatch = tierConfig.maxBatchSize || 10;
      if (!batchQuantity || batchQuantity < 1 || batchQuantity > maxBatch) {
        return res.status(400).json({ error: `Batch quantity must be between 1 and ${maxBatch}` });
      }
    }

    const quantity = isBatchOrder ? parseInt(batchQuantity) : 1;

    // ==========================================
    // QR CODE LIMITS CHECK
    // ==========================================
    if (!isProductionMode) {
      const tierConfig = stripeConfig.getTierConfig(user.subscription_tier);
      const tierDefaultLimit = tierConfig.qrLimit || 10;
      const now = new Date();
      const billingStart = user.billing_cycle_start ? new Date(user.billing_cycle_start) : null;

      if (billingStart) {
        const daysSinceStart = Math.floor((now - billingStart) / (1000 * 60 * 60 * 24));
        if (daysSinceStart >= 30) {
          await pool.query(
            `UPDATE users SET qr_codes_used = 0, qr_codes_limit = $1, billing_cycle_start = NOW() WHERE id = $2`,
            [tierDefaultLimit, user.id]
          );
          user.qr_codes_used = 0;
          user.qr_codes_limit = tierDefaultLimit;
        }
      } else {
        await pool.query(`UPDATE users SET billing_cycle_start = NOW() WHERE id = $1`, [user.id]);
      }

      const remaining = user.qr_codes_limit - user.qr_codes_used;
      if (quantity > remaining) {
        const nextTier = stripeConfig.getNextTier(user.subscription_tier);
        const nextTierConfig = nextTier ? stripeConfig.getTierConfig(nextTier) : null;
        return res.status(403).json({ 
          error: 'QR code limit exceeded',
          limits: { tier: user.subscription_tier, used: user.qr_codes_used, limit: user.qr_codes_limit, remaining, requested: quantity },
          upgrade: { available: !!nextTier, nextTier, nextTierName: nextTierConfig?.name, nextTierLimit: nextTierConfig?.qrLimit }
        });
      }
    }

    // ==========================================
    // PRODUCTION MODE
    // ==========================================
    if (isProductionMode) {
      console.log(`\n=== PHARMA PRODUCTION MODE ===`);
      
      const productId = `BT-PH-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const scanUrl = `https://www.biztrack.io/scan.html?id=${productId}`;
      const verificationUrl = `https://www.biztrack.io/verify.html?id=${productId}`;

      const productSerial = isBatchOrder ? `SN${Date.now().toString().slice(-8)}-001` : serialNumber;
      const gs1Data = buildGS1String(ndc, productSerial, expDate, lotNumber);
      const batchGroupId = isBatchOrder ? `PHARMA-BATCH-${Date.now()}-${Math.random().toString(36).substr(2, 6)}` : null;

      // Upload photos to Vercel Blob if provided
      let photoUrls = [];
      if (photos && photos.length > 0) {
        console.log(`Uploading ${photos.length} photos to Vercel Blob...`);
        for (let i = 0; i < photos.length; i++) {
          const photoData = photos[i];
          const base64Data = photoData.includes(',') ? photoData.split(',')[1] : photoData;
          const buffer = Buffer.from(base64Data, 'base64');
          const photoUrl = await uploadToBlob(buffer, `pharma-photo-${productId}-${i + 1}.jpg`, 'image/jpeg');
          photoUrls.push(photoUrl);
        }
      }

      // Generate tracking QR
      console.log('Generating tracking QR code...');
      const trackingQrBuffer = await QRCode.toBuffer(scanUrl, {
        width: 300, margin: 2,
        color: { dark: '#000000', light: '#FFFFFF' },
        errorCorrectionLevel: 'M'
      });
      const trackingQrUrl = await uploadToBlob(trackingQrBuffer, `${productId}-tracking-qr.png`);

      const pharmaMetadata = {
        ...metadata, ndc, serialNumber: productSerial, lotNumber, expDate,
        manufacturer: manufacturer || null, gs1: gs1Data, dscsa: true, pharmaCompliant: true
      };

      await pool.query(
        `INSERT INTO products (product_id, product_name, sku, batch_number, qr_code_url, metadata, user_id,
          is_batch_group, batch_group_id, batch_quantity, mode, is_finalized, photo_urls, location_data)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [productId, productName, productSerial, lotNumber, trackingQrUrl, pharmaMetadata, user.id,
          isBatchOrder, batchGroupId, quantity, 'production', false,
          photoUrls.length > 0 ? JSON.stringify(photoUrls) : null,
          location ? JSON.stringify(location) : null]
      );

      return res.status(200).json({
        success: true, isProductionMode: true, productId, productName, ndc,
        serialNumber: productSerial, lotNumber, expDate, gs1Data, quantity, batchGroupId, mode: 'production',
        qrCodeUrl: trackingQrUrl, scanUrl, verificationUrl,
        message: 'Pharma production entry created.',
        note: 'No QR codes charged until finalization.'
      });
    }

    // ==========================================
    // LIVE MODE - Full blockchain mint
    // ==========================================
    console.log(`\n=== PHARMA LIVE MODE: Full blockchain mint ===`);

    const products = [];
    const batchGroupId = isBatchOrder ? `PHARMA-BATCH-${Date.now()}-${Math.random().toString(36).substr(2, 6)}` : null;

    // Upload shared photos
    let photoUrls = [];
    if (photos && photos.length > 0) {
      console.log(`Uploading ${photos.length} photos to Vercel Blob...`);
      for (let i = 0; i < photos.length; i++) {
        const photoData = photos[i];
        const base64Data = photoData.includes(',') ? photoData.split(',')[1] : photoData;
        const buffer = Buffer.from(base64Data, 'base64');
        const photoUrl = await uploadToBlob(buffer, `pharma-photo-${Date.now()}-${i + 1}.jpg`, 'image/jpeg');
        photoUrls.push(photoUrl);
      }
    }

    // Connect to XRPL
    console.log('Connecting to XRPL...');
    client = new Client('wss://xrplcluster.com');
    await client.connect();
    console.log('Connected to XRPL');

    const wallet = Wallet.fromSeed(process.env.XRPL_SERVICE_WALLET_SECRET);

    // Process each product
    for (let i = 0; i < quantity; i++) {
      const itemNumber = i + 1;
      console.log(`\n--- Processing pharma item ${itemNumber} of ${quantity} ---`);

      const productId = `BT-PH-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const verificationUrl = `https://www.biztrack.io/verify.html?id=${productId}`;

      let productSerial;
      if (isBatchOrder) {
        const baseSerial = serialNumber || `SN${Date.now().toString().slice(-8)}`;
        productSerial = `${baseSerial}-${String(itemNumber).padStart(3, '0')}`;
      } else {
        productSerial = serialNumber;
      }

      const gs1Data = buildGS1String(ndc, productSerial, expDate, lotNumber);
      console.log(`GS1 for item ${itemNumber}:`, gs1Data.formatted);

      // ==========================================
      // GENERATE CUSTOMER QR (Verification URL)
      // ==========================================
      console.log('Generating customer-facing QR code...');
      const smartQrBuffer = await QRCode.toBuffer(verificationUrl, {
        width: 300, margin: 2,
        color: { dark: '#000000', light: '#FFFFFF' },
        errorCorrectionLevel: 'M'
      });
      const customerQrUrl = await uploadToBlob(smartQrBuffer, `${productId}-customer-qr.png`);
      console.log('Customer QR URL:', customerQrUrl);

      // ==========================================
      // GENERATE GS1 QR (Industry/Internal)
      // ==========================================
      console.log('Generating GS1-encoded QR code...');
      const gs1QrBuffer = await QRCode.toBuffer(gs1Data.formatted, {
        width: 300, margin: 2,
        color: { dark: '#000000', light: '#FFFFFF' },
        errorCorrectionLevel: 'M'
      });
      const gs1QrUrl = await uploadToBlob(gs1QrBuffer, `${productId}-gs1-qr.png`);
      console.log('GS1 QR URL:', gs1QrUrl);

      // ==========================================
      // BUILD PRODUCT DATA
      // ==========================================
      const productData = {
        productId, productName, ndc, gtin: gs1Data.gtin,
        serialNumber: productSerial, lotNumber, expirationDate: expDate,
        manufacturer: manufacturer || null, gs1String: gs1Data.formatted, gs1Components: gs1Data,
        photoUrls: photoUrls.length > 0 ? photoUrls : null,
        location: location || null, customerQrUrl, gs1QrUrl, verificationUrl,
        dscsa: { compliant: true, version: '2024', transactionType: 'commission' },
        createdAt: new Date().toISOString(), mintedBy: 'BizTrack Pharma Compliance',
        batchInfo: isBatchOrder ? { isBatchOrder: true, itemNumber, totalInBatch: quantity, batchGroupId } : null
      };

      // Create a hash of product data for blockchain
      const crypto = require('crypto');
      const productDataHash = crypto.createHash('sha256').update(JSON.stringify(productData)).digest('hex');

      // ==========================================
      // WRITE TO XRPL
      // ==========================================
      console.log('Writing to XRPL...');
      const tx = {
        TransactionType: 'AccountSet',
        Account: wallet.address,
        Memos: [{
          Memo: {
            MemoType: Buffer.from('BizTrack-Pharma').toString('hex').toUpperCase(),
            MemoData: Buffer.from(JSON.stringify({
              productId, dataHash: productDataHash, gs1: gs1Data.formatted,
              gtin: gs1Data.gtin, serial: gs1Data.serial, lot: gs1Data.lot, expiry: gs1Data.expiry,
              timestamp: new Date().toISOString(),
              batchInfo: isBatchOrder ? { itemNumber, totalInBatch: quantity, batchGroupId } : null
            })).toString('hex').toUpperCase()
          }
        }]
      };

      const prepared = await client.autofill(tx);
      const signed = wallet.sign(prepared);
      const submitResult = await client.submit(signed.tx_blob);

      const txHash = submitResult.result.tx_json.hash;
      const engineResult = submitResult.result.engine_result;
      
      console.log('Transaction hash:', txHash);
      console.log('Engine result:', engineResult);

      if (engineResult !== 'tesSUCCESS' && engineResult !== 'terQUEUED') {
        throw new Error(`Transaction failed for item ${itemNumber}: ${engineResult}`);
      }

      // ==========================================
      // SAVE TO DATABASE
      // ==========================================
      console.log('Saving to database...');
      
      const pharmaMetadata = {
        ndc, gtin: gs1Data.gtin, serialNumber: productSerial, lotNumber, expDate,
        manufacturer: manufacturer || null, gs1String: gs1Data.formatted, gs1Components: gs1Data,
        dscsa: true, pharmaCompliant: true, dataHash: productDataHash, ...(metadata || {})
      };

      const isBatchLeader = isBatchOrder && itemNumber === 1;
      
      await pool.query(
        `INSERT INTO products (
          product_id, product_name, sku, batch_number, xrpl_tx_hash, 
          qr_code_url, gs1_qr_code_url, metadata, user_id,
          is_batch_group, batch_group_id, batch_quantity, mode, is_finalized
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [productId, productName, productSerial, lotNumber, txHash,
          customerQrUrl, gs1QrUrl, pharmaMetadata, user.id,
          isBatchLeader, batchGroupId, isBatchOrder ? quantity : null, 'live', true]
      );

      console.log(`Pharma item ${itemNumber} saved!`);

      products.push({
        productId, productName, ndc, gtin: gs1Data.gtin,
        serialNumber: productSerial, lotNumber, expirationDate: expDate,
        gs1String: gs1Data.formatted, xrplTxHash: txHash, verificationUrl, mode: 'live',
        customerQrUrl, gs1QrUrl,
        blockchainExplorer: `https://livenet.xrpl.org/transactions/${txHash}`,
        timestamp: new Date().toISOString()
      });

      if (i < quantity - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    await client.disconnect();

    // Update QR code counter
    await pool.query('UPDATE users SET qr_codes_used = qr_codes_used + $1 WHERE id = $2', [quantity, user.id]);
    console.log(`Updated QR counter: +${quantity} for user ${user.id}`);

    // Return response
    if (isBatchOrder && products.length > 1) {
      return res.status(200).json({
        success: true, isBatch: true,
        batchInfo: { productName, ndc, lotNumber, expDate, quantity, batchGroupId, timestamp: new Date().toISOString() },
        products,
        gs1Info: { gtin: products[0].gtin, format: 'GS1-128 / DataMatrix compatible', ais: ['01 (GTIN)', '21 (Serial)', '17 (Expiry)', '10 (Lot)'] }
      });
    } else {
      const product = products[0];
      return res.status(200).json({
        success: true, ...product,
        gs1Info: { gtin: product.gtin, format: 'GS1-128 / DataMatrix compatible', ais: ['01 (GTIN)', '21 (Serial)', '17 (Expiry)', '10 (Lot)'] }
      });
    }

  } catch (error) {
    console.error('Pharma minting error:', error);
    if (client) { try { await client.disconnect(); } catch (e) {} }
    return res.status(500).json({ error: 'Pharma minting failed', details: error.message });
  }
};
