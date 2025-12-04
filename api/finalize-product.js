const { Client, Wallet } = require('xrpl');
const axios = require('axios');
const { Pool } = require('pg');
const QRCode = require('qrcode');
const jwt = require('jsonwebtoken');
const stripeConfig = require('../stripe-config');

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
    // Authenticate user
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    const { productId } = req.body;

    if (!productId) {
      return res.status(400).json({ error: 'Product ID is required' });
    }

    // Get product and verify ownership
    const productResult = await pool.query(
      'SELECT * FROM products WHERE product_id = $1',
      [productId]
    );

    if (productResult.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const product = productResult.rows[0];

    // Verify user owns this product
    if (product.user_id !== decoded.userId) {
      return res.status(403).json({ error: 'You do not have permission to finalize this product' });
    }

    if (product.mode !== 'production') {
      return res.status(400).json({ error: 'Product is not in production mode' });
    }

    if (product.is_finalized) {
      return res.status(400).json({ error: 'Product is already finalized' });
    }

    // Get user for limit checking
    const userResult = await pool.query(
      'SELECT * FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];
    const quantity = product.batch_quantity || 1;

    // ==========================================
    // CHECK QR CODE LIMITS BEFORE MINTING
    // ==========================================
    const tierConfig = stripeConfig.getTierConfig(user.subscription_tier);
    const tierDefaultLimit = tierConfig.qrLimit || 10;
    const now = new Date();
    const billingStart = user.billing_cycle_start ? new Date(user.billing_cycle_start) : null;

    // Reset billing cycle if needed
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

    // Check if user has enough QR codes
    if (quantity > remaining) {
      const nextTier = stripeConfig.getNextTier(user.subscription_tier);
      const nextTierConfig = nextTier ? stripeConfig.getTierConfig(nextTier) : null;

      return res.status(403).json({ 
        error: 'QR code limit exceeded',
        message: `You need ${quantity} QR codes to finalize this ${product.is_batch_group ? 'batch' : 'product'} but only have ${remaining} remaining.`,
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

    console.log(`\n=== FINALIZING PRODUCT: ${productId} ===`);
    console.log(`Quantity: ${quantity}, User remaining: ${remaining}`);

    // Get all checkpoints for this product (to include in blockchain data)
    const checkpointsResult = await pool.query(
      `SELECT * FROM production_scans WHERE product_id = $1 ORDER BY scanned_at ASC`,
      [product.id]
    );
    const checkpoints = checkpointsResult.rows;
    console.log(`Found ${checkpoints.length} checkpoints`);

    // Parse stored data
    const photoHashes = product.photo_hashes ? JSON.parse(product.photo_hashes) : [];
    const locationData = product.location_data ? JSON.parse(product.location_data) : null;

    // Connect to XRPL
    console.log('Connecting to XRPL...');
    client = new Client('wss://xrplcluster.com');
    await client.connect();
    console.log('Connected to XRPL');

    const wallet = Wallet.fromSeed(process.env.XRPL_SERVICE_WALLET_SECRET);

    const mintedProducts = [];
    const skuPrefix = product.sku;
    const sameSku = product.metadata?.sameSku || false;

    // ==========================================
    // MINT EACH PRODUCT IN BATCH (or single)
    // ==========================================
    for (let i = 0; i < quantity; i++) {
      const itemNumber = i + 1;
      console.log(`\n--- Minting item ${itemNumber} of ${quantity} ---`);

      // For batch, create new product IDs. For single, use existing.
      const itemProductId = quantity > 1 
        ? `BT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        : productId;
      
      const verificationUrl = `https://www.biztrack.io/verify.html?id=${itemProductId}`;

      // Generate SKU
      // - If sameSku is true: all items get same SKU (no suffix)
      // - If sameSku is false: add sequential suffix (-001, -002)
      let itemSku;
      if (quantity > 1) {
        if (sameSku) {
          itemSku = skuPrefix;
        } else {
          itemSku = `${skuPrefix}-${String(itemNumber).padStart(3, '0')}`;
        }
      } else {
        itemSku = skuPrefix;
      }

      // ==========================================
      // GENERATE CUSTOMER QR (Verification URL)
      // ==========================================
      console.log(`Generating customer QR for ${itemSku || itemProductId}...`);
      const customerQrBuffer = await QRCode.toBuffer(verificationUrl, {
        width: 300,
        margin: 2,
        color: {
          dark: '#1E293B',
          light: '#FFFFFF'
        },
        errorCorrectionLevel: 'M'
      });

      const FormData = require('form-data');
      const customerQrFormData = new FormData();
      customerQrFormData.append('file', customerQrBuffer, {
        filename: `${itemProductId}-customer-qr.png`,
        contentType: 'image/png'
      });

      const customerQrResponse = await axios.post(
        'https://api.pinata.cloud/pinning/pinFileToIPFS',
        customerQrFormData,
        {
          headers: {
            ...customerQrFormData.getHeaders(),
            'Authorization': `Bearer ${process.env.PINATA_JWT}`
          }
        }
      );

      const customerQrIpfsHash = customerQrResponse.data.IpfsHash;
      console.log('Customer QR IPFS Hash:', customerQrIpfsHash);

      // ==========================================
      // GENERATE INVENTORY QR (Raw SKU)
      // ==========================================
      let inventoryQrIpfsHash = null;
      
      if (itemSku) {
        console.log(`Generating inventory QR (SKU: ${itemSku})...`);
        const inventoryQrBuffer = await QRCode.toBuffer(itemSku, {
          width: 300,
          margin: 2,
          color: {
            dark: '#000000',
            light: '#FFFFFF'
          },
          errorCorrectionLevel: 'L'
        });

        const inventoryQrFormData = new FormData();
        inventoryQrFormData.append('file', inventoryQrBuffer, {
          filename: `${itemProductId}-inventory-qr.png`,
          contentType: 'image/png'
        });

        const inventoryQrResponse = await axios.post(
          'https://api.pinata.cloud/pinning/pinFileToIPFS',
          inventoryQrFormData,
          {
            headers: {
              ...inventoryQrFormData.getHeaders(),
              'Authorization': `Bearer ${process.env.PINATA_JWT}`
            }
          }
        );

        inventoryQrIpfsHash = inventoryQrResponse.data.IpfsHash;
        console.log('Inventory QR IPFS Hash:', inventoryQrIpfsHash);
      }

      // ==========================================
      // PREPARE PRODUCT DATA WITH SUPPLY CHAIN
      // ==========================================
      const supplyChainTimeline = checkpoints.map((cp, idx) => ({
        step: idx + 1,
        scannedAt: cp.scanned_at,
        scannedByName: cp.scanned_by_name,
        scannedByRole: cp.scanned_by_role,
        locationName: cp.location_name,
        latitude: cp.latitude ? parseFloat(cp.latitude) : null,
        longitude: cp.longitude ? parseFloat(cp.longitude) : null,
        notes: cp.notes,
        photos: cp.photos || []
      }));

      const productData = {
        productId: itemProductId,
        productName: product.product_name,
        sku: itemSku,
        batchNumber: product.batch_number,
        metadata: product.metadata || {},
        photoHashes: photoHashes.length > 0 ? photoHashes : null,
        location: locationData,
        qrCodeIpfsHash: customerQrIpfsHash,
        inventoryQrCodeIpfsHash: inventoryQrIpfsHash,
        verificationUrl,
        supplyChain: {
          totalCheckpoints: checkpoints.length,
          timeline: supplyChainTimeline,
          finalizedAt: new Date().toISOString()
        },
        createdAt: product.created_at,
        finalizedAt: new Date().toISOString(),
        mintedBy: 'BizTrack Supply Chain Tracking',
        batchInfo: quantity > 1 ? {
          isBatchOrder: true,
          itemNumber: itemNumber,
          totalInBatch: quantity,
          batchGroupId: product.batch_group_id
        } : null
      };

      // Upload product data to IPFS
      console.log('Uploading product data to IPFS...');
      const productDataResponse = await axios.post(
        'https://api.pinata.cloud/pinning/pinJSONToIPFS',
        {
          pinataContent: productData,
          pinataMetadata: {
            name: `BizTrack-${itemProductId}`
          }
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.PINATA_JWT}`
          }
        }
      );

      const ipfsHash = productDataResponse.data.IpfsHash;
      console.log('Product Data IPFS Hash:', ipfsHash);

      // ==========================================
      // MINT TO XRPL
      // ==========================================
      console.log('Writing to XRPL...');
      const tx = {
        TransactionType: 'AccountSet',
        Account: wallet.address,
        Memos: [
          {
            Memo: {
              MemoType: Buffer.from('BizTrack-Product').toString('hex').toUpperCase(),
              MemoData: Buffer.from(JSON.stringify({
                productId: itemProductId,
                ipfsHash,
                qrCodeIpfsHash: customerQrIpfsHash,
                inventoryQrCodeIpfsHash: inventoryQrIpfsHash,
                supplyChainCheckpoints: checkpoints.length,
                timestamp: new Date().toISOString(),
                batchInfo: quantity > 1 ? { itemNumber, totalInBatch: quantity, batchGroupId: product.batch_group_id } : null
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
      if (quantity > 1) {
        // Batch: Insert new product records
        // For first item (batch leader), add batchSkuPrefix for display if not sameSku
        const itemMetadata = { ...(product.metadata || {}) };
        if (itemNumber === 1 && !sameSku && skuPrefix) {
          itemMetadata.batchSkuPrefix = skuPrefix;
        }
        
        const insertResult = await pool.query(
          `INSERT INTO products (
            product_id, product_name, sku, batch_number, 
            ipfs_hash, xrpl_tx_hash, qr_code_ipfs_hash, inventory_qr_code_ipfs_hash,
            metadata, user_id, is_batch_group, batch_group_id, batch_quantity,
            mode, is_finalized, finalized_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
          RETURNING id`,
          [
            itemProductId, product.product_name, itemSku, product.batch_number,
            ipfsHash, txHash, customerQrIpfsHash, inventoryQrIpfsHash,
            itemMetadata, user.id, itemNumber === 1, product.batch_group_id, quantity,
            'live', true
          ]
        );

        // Copy all checkpoints to this new product
        const newProductId = insertResult.rows[0].id;
        for (const checkpoint of checkpoints) {
          await pool.query(
            `INSERT INTO production_scans (
              product_id, scanned_at, latitude, longitude, location_name,
              notes, photos, scanned_by_name, scanned_by_role
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              newProductId,
              checkpoint.scanned_at,
              checkpoint.latitude,
              checkpoint.longitude,
              checkpoint.location_name,
              checkpoint.notes,
              checkpoint.photos,
              checkpoint.scanned_by_name,
              checkpoint.scanned_by_role
            ]
          );
        }
        console.log(`Copied ${checkpoints.length} checkpoints to product ${itemSku}`);
      } else {
        // Single: Update existing record
        await pool.query(
          `UPDATE products SET
            ipfs_hash = $1,
            xrpl_tx_hash = $2,
            qr_code_ipfs_hash = $3,
            inventory_qr_code_ipfs_hash = $4,
            mode = 'live',
            is_finalized = true,
            finalized_at = NOW()
          WHERE id = $5`,
          [ipfsHash, txHash, customerQrIpfsHash, inventoryQrIpfsHash, product.id]
        );
      }

      mintedProducts.push({
        productId: itemProductId,
        sku: itemSku,
        ipfsHash,
        xrplTxHash: txHash,
        verificationUrl,
        qrCodeUrl: `https://gateway.pinata.cloud/ipfs/${customerQrIpfsHash}`,
        inventoryQrCodeUrl: inventoryQrIpfsHash ? `https://gateway.pinata.cloud/ipfs/${inventoryQrIpfsHash}` : null,
        blockchainExplorer: `https://livenet.xrpl.org/transactions/${txHash}`
      });

      // Small delay between batch items
      if (i < quantity - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    await client.disconnect();

    // ==========================================
    // DELETE ORIGINAL PRODUCTION RECORD (for batches)
    // ==========================================
    if (quantity > 1) {
      console.log('Cleaning up original production record...');
      // First delete checkpoints (foreign key constraint)
      await pool.query('DELETE FROM production_scans WHERE product_id = $1', [product.id]);
      console.log('Deleted production checkpoints');
      // Then delete the product
      await pool.query('DELETE FROM products WHERE id = $1', [product.id]);
      console.log('Deleted original production product');
    }

    // ==========================================
    // CHARGE QR CODES
    // ==========================================
    await pool.query(
      'UPDATE users SET qr_codes_used = qr_codes_used + $1 WHERE id = $2',
      [quantity, user.id]
    );
    console.log(`Charged ${quantity} QR codes to user ${user.id}`);

    // Get updated count
    const updatedUser = await pool.query(
      'SELECT qr_codes_used, qr_codes_limit FROM users WHERE id = $1',
      [user.id]
    );

    return res.status(200).json({
      success: true,
      message: quantity > 1 
        ? `Batch of ${quantity} products minted to blockchain and now live!`
        : 'Product minted to blockchain and now live!',
      products: mintedProducts,
      supplyChain: {
        totalCheckpoints: checkpoints.length
      },
      billing: {
        qrCodesCharged: quantity,
        newUsage: updatedUser.rows[0].qr_codes_used,
        limit: updatedUser.rows[0].qr_codes_limit
      }
    });

  } catch (error) {
    console.error('Finalize product error:', error);
    
    if (client) {
      try { await client.disconnect(); } catch (e) {}
    }

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }

    return res.status(500).json({
      error: 'Failed to finalize product',
      details: error.message
    });
  }
};
