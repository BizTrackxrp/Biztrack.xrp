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

// ==========================================
// GS1 ENCODING HELPERS
// ==========================================

/**
 * Convert NDC to GTIN-14
 * NDC formats: 4-4-2, 5-3-2, or 5-4-1 (10 digits total)
 * GTIN-14: indicator + NDC padded to 11 + check digit = 14 digits
 */
function ndcToGtin14(ndc) {
  // Remove dashes, spaces, and any non-numeric characters
  const cleanNdc = ndc.replace(/[^0-9]/g, '');
  
  // Pad to 11 digits (standard NDC-11 format)
  let ndc11 = cleanNdc;
  if (cleanNdc.length <= 10) {
    ndc11 = cleanNdc.padStart(11, '0');
  } else if (cleanNdc.length > 11) {
    // Truncate if somehow longer
    ndc11 = cleanNdc.substring(0, 11);
  }
  
  // Build GTIN-14: indicator (0) + filler (0) + NDC-11 = 13 digits + check digit
  const gtinWithoutCheck = '00' + ndc11;
  
  // Calculate check digit (GS1 mod 10 algorithm)
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
    // Positions: multiply by 3 at odd positions (1,3,5...), by 1 at even (2,4,6...)
    // Going left to right, index 0 is position 1, so odd index = even position
    sum += digit * (i % 2 === 0 ? 1 : 3);
  }
  const remainder = sum % 10;
  return remainder === 0 ? '0' : String(10 - remainder);
}

/**
 * Format expiry date as YYMMDD for GS1 AI(17)
 * Input: YYYY-MM-DD or Date object
 */
function formatExpiryForGS1(expDate) {
  let date;
  if (typeof expDate === 'string') {
    date = new Date(expDate);
  } else {
    date = expDate;
  }
  
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  
  return yy + mm + dd;
}

/**
 * Build GS1 encoded string for pharmaceutical products
 * Uses Application Identifiers (AIs):
 * - (01) GTIN-14
 * - (21) Serial Number
 * - (17) Expiration Date (YYMMDD)
 * - (10) Lot/Batch Number
 * 
 * Format: (01)GTIN(21)SERIAL(17)EXPIRY(10)LOT
 */
function buildGS1String(ndc, serialNumber, expiryDate, lotNumber) {
  const gtin = ndcToGtin14(ndc);
  const expiry = formatExpiryForGS1(expiryDate);
  
  // Clean serial and lot (alphanumeric only, max 20 chars)
  const cleanSerial = serialNumber.replace(/[^A-Za-z0-9]/g, '').substring(0, 20);
  const cleanLot = lotNumber.replace(/[^A-Za-z0-9]/g, '').substring(0, 20);
  
  // Build the GS1 string with human-readable AIs in parentheses
  // For QR codes, we use the FNC1 character (represented as GS - ASCII 29) between variable-length fields
  // But for simplicity and compatibility, we'll use the parentheses format which most scanners can parse
  const gs1String = `(01)${gtin}(21)${cleanSerial}(17)${expiry}(10)${cleanLot}`;
  
  return {
    formatted: gs1String,
    gtin,
    serial: cleanSerial,
    expiry,
    lot: cleanLot
  };
}

/**
 * Validate NDC format
 */
function validateNDC(ndc) {
  const cleanNdc = ndc.replace(/[^0-9]/g, '');
  if (cleanNdc.length < 9 || cleanNdc.length > 11) {
    return { valid: false, error: 'NDC must be 9-11 digits (common formats: 4-4-2, 5-3-2, 5-4-1, or 5-4-2)' };
  }
  return { valid: true };
}

/**
 * Validate expiry date (must be in future)
 */
function validateExpiry(expDate) {
  const date = new Date(expDate);
  const now = new Date();
  if (isNaN(date.getTime())) {
    return { valid: false, error: 'Invalid expiration date format' };
  }
  if (date <= now) {
    return { valid: false, error: 'Expiration date must be in the future' };
  }
  return { valid: true };
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
      ndc,
      serialNumber,
      lotNumber,
      expDate,
      manufacturer,
      metadata,
      photos, 
      location,
      isBatchOrder,
      batchQuantity,
      mode: productMode
    } = req.body;

    // Validate mode (default to 'live')
    const mode = productMode === 'production' ? 'production' : 'live';
    const isProductionMode = mode === 'production';

    // ==========================================
    // PHARMA-SPECIFIC VALIDATION
    // ==========================================
    
    if (!productName) {
      return res.status(400).json({ error: 'Product name is required' });
    }
    
    if (!ndc) {
      return res.status(400).json({ error: 'NDC (National Drug Code) is required for DSCSA compliance' });
    }
    
    const ndcValidation = validateNDC(ndc);
    if (!ndcValidation.valid) {
      return res.status(400).json({ error: ndcValidation.error });
    }
    
    if (!lotNumber) {
      return res.status(400).json({ error: 'Lot/Batch number is required for DSCSA compliance' });
    }
    
    if (!expDate) {
      return res.status(400).json({ error: 'Expiration date is required for DSCSA compliance' });
    }
    
    const expiryValidation = validateExpiry(expDate);
    if (!expiryValidation.valid) {
      return res.status(400).json({ error: expiryValidation.error });
    }
    
    // Serial number required for single items, auto-generated for batch
    if (!isBatchOrder && !serialNumber) {
      return res.status(400).json({ error: 'Serial number is required for DSCSA compliance' });
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

    // ==========================================
    // QR CODE LIMITS - ONLY CHECK FOR LIVE MODE
    // ==========================================
    if (!isProductionMode) {
      const tierConfig = stripeConfig.getTierConfig(user.subscription_tier);
      const tierDefaultLimit = tierConfig.qrLimit || 10;
      const now = new Date();
      const billingStart = user.billing_cycle_start ? new Date(user.billing_cycle_start) : null;

      if (billingStart) {
        const daysSinceStart = Math.floor((now - billingStart) / (1000 * 60 * 60 * 24));
        
        if (daysSinceStart >= 30) {
          console.log(`[BILLING] Resetting counter for user ${user.id}`);
          
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
        }
      } else {
        await pool.query(
          `UPDATE users SET billing_cycle_start = NOW() WHERE id = $1`,
          [user.id]
        );
      }

      const remaining = user.qr_codes_limit - user.qr_codes_used;

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
    }

    // ==========================================
    // PRODUCTION MODE - Simple tracking flow
    // ==========================================
    if (isProductionMode) {
      console.log(`\n=== PHARMA PRODUCTION MODE ===`);
      
      const productId = `BT-PH-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const scanUrl = `https://www.biztrack.io/scan.html?id=${productId}`;
      const verificationUrl = `https://www.biztrack.io/verify.html?id=${productId}`;

      // Generate serial for batch or use provided
      const productSerial = isBatchOrder 
        ? `SN${Date.now().toString().slice(-8)}-001`
        : serialNumber;

      // Build GS1 string
      const gs1Data = buildGS1String(ndc, productSerial, expDate, lotNumber);
      console.log('GS1 Data:', gs1Data);

      const batchGroupId = isBatchOrder 
        ? `PHARMA-BATCH-${Date.now()}-${Math.random().toString(36).substr(2, 6)}` 
        : null;

      // Upload photos if provided
      let photoHashes = [];
      if (photos && photos.length > 0) {
        console.log(`Uploading ${photos.length} photos to IPFS...`);
        const FormData = require('form-data');
        
        for (let i = 0; i < photos.length; i++) {
          const photoData = photos[i];
          const base64Data = photoData.includes(',') ? photoData.split(',')[1] : photoData;
          const buffer = Buffer.from(base64Data, 'base64');
          
          const photoFormData = new FormData();
          photoFormData.append('file', buffer, {
            filename: `pharma-photo-${Date.now()}-${i + 1}.jpg`,
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
        }
      }

      // Generate tracking QR (points to scan page)
      console.log('Generating tracking QR code...');
      const FormData = require('form-data');
      const trackingQrBuffer = await QRCode.toBuffer(scanUrl, {
        width: 300,
        margin: 2,
        color: { dark: '#000000', light: '#FFFFFF' },
        errorCorrectionLevel: 'M'
      });

      const qrFormData = new FormData();
      qrFormData.append('file', trackingQrBuffer, {
        filename: `${productId}-tracking-qr.png`,
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

      const trackingQrIpfsHash = qrPinataResponse.data.IpfsHash;

      // Save to database
      const pharmaMetadata = {
        ...metadata,
        ndc,
        serialNumber: productSerial,
        lotNumber,
        expDate,
        manufacturer: manufacturer || null,
        gs1: gs1Data,
        dscsa: true,
        pharmaCompliant: true
      };

      await pool.query(
        `INSERT INTO products (
          product_id, product_name, sku, batch_number, 
          qr_code_ipfs_hash, metadata, user_id,
          is_batch_group, batch_group_id, batch_quantity,
          mode, is_finalized, photo_hashes, location_data
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          productId, productName, productSerial, lotNumber,
          trackingQrIpfsHash, pharmaMetadata, user.id,
          isBatchOrder, batchGroupId, quantity,
          'production', false,
          photoHashes.length > 0 ? JSON.stringify(photoHashes) : null,
          location ? JSON.stringify(location) : null
        ]
      );

      console.log('Pharma production entry created!');

      return res.status(200).json({
        success: true,
        isProductionMode: true,
        productId,
        productName,
        ndc,
        serialNumber: productSerial,
        lotNumber,
        expDate,
        gs1Data,
        quantity,
        batchGroupId,
        mode: 'production',
        qrCodeUrl: `https://gateway.pinata.cloud/ipfs/${trackingQrIpfsHash}`,
        scanUrl,
        verificationUrl,
        message: 'Pharma production entry created. Add checkpoints, then Go Live to mint.',
        note: 'No QR codes charged until finalization.'
      });
    }

    // ==========================================
    // LIVE MODE - Full blockchain mint
    // ==========================================
    console.log(`\n=== PHARMA LIVE MODE: Full blockchain mint ===`);

    const products = [];
    const batchGroupId = isBatchOrder 
      ? `PHARMA-BATCH-${Date.now()}-${Math.random().toString(36).substr(2, 6)}` 
      : null;

    // Upload shared photos
    let photoHashes = [];
    if (photos && photos.length > 0) {
      console.log(`Uploading ${photos.length} photos to IPFS...`);
      
      for (let i = 0; i < photos.length; i++) {
        const photoData = photos[i];
        const base64Data = photoData.includes(',') ? photoData.split(',')[1] : photoData;
        const buffer = Buffer.from(base64Data, 'base64');
        
        const FormData = require('form-data');
        const photoFormData = new FormData();
        photoFormData.append('file', buffer, {
          filename: `pharma-photo-${Date.now()}-${i + 1}.jpg`,
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

      // Generate unique serial for each item in batch, or use provided
      let productSerial;
      if (isBatchOrder) {
        const baseSerial = serialNumber || `SN${Date.now().toString().slice(-8)}`;
        productSerial = `${baseSerial}-${String(itemNumber).padStart(3, '0')}`;
      } else {
        productSerial = serialNumber;
      }

      // Build GS1 string for this specific product
      const gs1Data = buildGS1String(ndc, productSerial, expDate, lotNumber);
      console.log(`GS1 for item ${itemNumber}:`, gs1Data.formatted);

      // ==========================================
      // GENERATE SMART QR (Customer-facing - Verification URL)
      // ==========================================
      console.log('Generating customer-facing QR code...');
      const FormData = require('form-data');
      
      const smartQrBuffer = await QRCode.toBuffer(verificationUrl, {
        width: 300,
        margin: 2,
        color: { dark: '#000000', light: '#FFFFFF' },
        errorCorrectionLevel: 'M'
      });

      const smartQrFormData = new FormData();
      smartQrFormData.append('file', smartQrBuffer, {
        filename: `${productId}-customer-qr.png`,
        contentType: 'image/png'
      });

      const smartQrResponse = await axios.post(
        'https://api.pinata.cloud/pinning/pinFileToIPFS',
        smartQrFormData,
        {
          headers: {
            ...smartQrFormData.getHeaders(),
            'Authorization': `Bearer ${process.env.PINATA_JWT}`
          }
        }
      );

      const smartQrIpfsHash = smartQrResponse.data.IpfsHash;
      console.log('Customer QR IPFS Hash:', smartQrIpfsHash);

      // ==========================================
      // GENERATE GS1 QR (Internal/Industry - DSCSA Compliant)
      // ==========================================
      console.log('Generating GS1-encoded QR code...');
      
      const gs1QrBuffer = await QRCode.toBuffer(gs1Data.formatted, {
        width: 300,
        margin: 2,
        color: { dark: '#000000', light: '#FFFFFF' },
        errorCorrectionLevel: 'M'
      });

      const gs1QrFormData = new FormData();
      gs1QrFormData.append('file', gs1QrBuffer, {
        filename: `${productId}-gs1-qr.png`,
        contentType: 'image/png'
      });

      const gs1QrResponse = await axios.post(
        'https://api.pinata.cloud/pinning/pinFileToIPFS',
        gs1QrFormData,
        {
          headers: {
            ...gs1QrFormData.getHeaders(),
            'Authorization': `Bearer ${process.env.PINATA_JWT}`
          }
        }
      );

      const gs1QrIpfsHash = gs1QrResponse.data.IpfsHash;
      console.log('GS1 QR IPFS Hash:', gs1QrIpfsHash);

      // ==========================================
      // UPLOAD PRODUCT DATA TO IPFS
      // ==========================================
      const productData = {
        productId,
        productName,
        ndc,
        gtin: gs1Data.gtin,
        serialNumber: productSerial,
        lotNumber,
        expirationDate: expDate,
        manufacturer: manufacturer || null,
        gs1String: gs1Data.formatted,
        gs1Components: gs1Data,
        photoHashes: photoHashes.length > 0 ? photoHashes : null,
        location: location || null,
        qrCodeIpfsHash: smartQrIpfsHash,
        gs1QrCodeIpfsHash: gs1QrIpfsHash,
        verificationUrl,
        dscsa: {
          compliant: true,
          version: '2024',
          transactionType: 'commission'
        },
        createdAt: new Date().toISOString(),
        mintedBy: 'BizTrack Pharma Compliance',
        batchInfo: isBatchOrder ? {
          isBatchOrder: true,
          itemNumber,
          totalInBatch: quantity,
          batchGroupId
        } : null
      };

      console.log('Uploading product data to IPFS...');
      const pinataResponse = await axios.post(
        'https://api.pinata.cloud/pinning/pinJSONToIPFS',
        {
          pinataContent: productData,
          pinataMetadata: { name: `BizTrack-Pharma-${productId}` }
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

      // ==========================================
      // WRITE TO XRPL
      // ==========================================
      console.log('Writing to XRPL...');
      const tx = {
        TransactionType: 'AccountSet',
        Account: wallet.address,
        Memos: [
          {
            Memo: {
              MemoType: Buffer.from('BizTrack-Pharma').toString('hex').toUpperCase(),
              MemoData: Buffer.from(JSON.stringify({
                productId,
                ipfsHash,
                gs1: gs1Data.formatted,
                gtin: gs1Data.gtin,
                serial: gs1Data.serial,
                lot: gs1Data.lot,
                expiry: gs1Data.expiry,
                timestamp: new Date().toISOString(),
                batchInfo: isBatchOrder ? { itemNumber, totalInBatch: quantity, batchGroupId } : null
              })).toString('hex').toUpperCase()
            }
          }
        ]
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
        ndc,
        gtin: gs1Data.gtin,
        serialNumber: productSerial,
        lotNumber,
        expDate,
        manufacturer: manufacturer || null,
        gs1String: gs1Data.formatted,
        gs1Components: gs1Data,
        dscsa: true,
        pharmaCompliant: true,
        ...(metadata || {})
      };

      const isBatchLeader = isBatchOrder && itemNumber === 1;
      
      await pool.query(
        `INSERT INTO products (
          product_id, product_name, sku, batch_number,
          ipfs_hash, xrpl_tx_hash, 
          qr_code_ipfs_hash, inventory_qr_code_ipfs_hash,
          metadata, user_id,
          is_batch_group, batch_group_id, batch_quantity,
          mode, is_finalized
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          productId, productName, productSerial, lotNumber,
          ipfsHash, txHash,
          smartQrIpfsHash, gs1QrIpfsHash,
          pharmaMetadata, user.id,
          isBatchLeader, batchGroupId, isBatchOrder ? quantity : null,
          'live', true
        ]
      );

      console.log(`Pharma item ${itemNumber} saved!`);

      products.push({
        productId,
        productName,
        ndc,
        gtin: gs1Data.gtin,
        serialNumber: productSerial,
        lotNumber,
        expirationDate: expDate,
        gs1String: gs1Data.formatted,
        ipfsHash,
        xrplTxHash: txHash,
        verificationUrl,
        mode: 'live',
        // QR Code URLs
        customerQrUrl: `https://gateway.pinata.cloud/ipfs/${smartQrIpfsHash}`,
        gs1QrUrl: `https://gateway.pinata.cloud/ipfs/${gs1QrIpfsHash}`,
        // Explorer links
        blockchainExplorer: `https://livenet.xrpl.org/transactions/${txHash}`,
        ipfsGateway: `https://gateway.pinata.cloud/ipfs/${ipfsHash}`,
        timestamp: new Date().toISOString()
      });

      // Small delay between transactions
      if (i < quantity - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    await client.disconnect();

    // Update QR code counter
    await pool.query(
      'UPDATE users SET qr_codes_used = qr_codes_used + $1 WHERE id = $2',
      [quantity, user.id]
    );
    console.log(`Updated QR counter: +${quantity} for user ${user.id}`);

    // Return response
    if (isBatchOrder && products.length > 1) {
      return res.status(200).json({
        success: true,
        isBatch: true,
        batchInfo: {
          productName,
          ndc,
          lotNumber,
          expDate,
          quantity,
          batchGroupId,
          timestamp: new Date().toISOString()
        },
        products,
        gs1Info: {
          gtin: products[0].gtin,
          format: 'GS1-128 / DataMatrix compatible',
          ais: ['01 (GTIN)', '21 (Serial)', '17 (Expiry)', '10 (Lot)']
        }
      });
    } else {
      const product = products[0];
      return res.status(200).json({
        success: true,
        ...product,
        gs1Info: {
          gtin: product.gtin,
          format: 'GS1-128 / DataMatrix compatible',
          ais: ['01 (GTIN)', '21 (Serial)', '17 (Expiry)', '10 (Lot)']
        }
      });
    }

  } catch (error) {
    console.error('Pharma minting error:', error);
    if (client) {
      try { await client.disconnect(); } catch (e) {}
    }
    return res.status(500).json({
      error: 'Pharma minting failed',
      details: error.message
    });
  }
};
