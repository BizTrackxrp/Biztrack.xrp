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
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let client;

  try {
    const { productName, sku, batchNumber, metadata } = req.body;

    // Validate required fields
    if (!productName) {
      return res.status(400).json({ error: 'Product name is required' });
    }

    // Generate unique product ID
    const productId = `BT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const verificationUrl = `https://www.biztrack.io/verify?id=${productId}`;

    // Step 1: Generate QR Code as PNG buffer
    console.log('Generating QR code...');
    const qrCodeBuffer = await QRCode.toBuffer(verificationUrl, {
      width: 512,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });

    // Step 2: Upload QR code to IPFS
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

    // Step 3: Prepare product data for IPFS
    const productData = {
      productId,
      productName,
      sku: sku || null,
      batchNumber: batchNumber || null,
      metadata: metadata || {},
      qrCodeIpfsHash: qrIpfsHash,
      verificationUrl,
      createdAt: new Date().toISOString(),
      mintedBy: 'BizTrack Supply Chain Tracking'
    };

    console.log('Uploading product data to IPFS...');

    // Step 4: Upload product data to IPFS via Pinata
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

    // Step 5: Write IPFS hash to XRPL using AccountSet
    console.log('Writing to XRPL...');
    
    client = new Client('wss://xrplcluster.com');
    await client.connect();
    console.log('Connected to XRPL');

    const wallet = Wallet.fromSeed(process.env.XRPL_SERVICE_WALLET_SECRET);

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
              timestamp: new Date().toISOString()
            })).toString('hex').toUpperCase()
          }
        }
      ]
    };

    console.log('Getting current ledger...');
    const ledgerIndex = await client.getLedgerIndex();
    console.log('Current ledger:', ledgerIndex);

    // Autofill the transaction
    console.log('Autofilling transaction...');
    const prepared = await client.autofill(tx);
    
    // Get fresh ledger and set LastLedgerSequence
    const freshLedger = await client.getLedgerIndex();
    prepared.LastLedgerSequence = freshLedger + 4;
    
    console.log('Fresh ledger:', freshLedger);
    console.log('LastLedgerSequence:', prepared.LastLedgerSequence);
    console.log('Sequence:', prepared.Sequence);
    console.log('Fee:', prepared.Fee);

    // Sign and submit immediately
    console.log('Signing...');
    const signed = wallet.sign(prepared);
    
    console.log('Submitting...');
    const submitResult = await client.submit(signed.tx_blob);

    const txHash = submitResult.result.tx_json.hash;
    const engineResult = submitResult.result.engine_result;
    const engineResultMessage = submitResult.result.engine_result_message;
    
    console.log('Transaction hash:', txHash);
    console.log('Engine result:', engineResult);
    console.log('Engine result message:', engineResultMessage);

    // Check if submission was successful
    if (engineResult !== 'tesSUCCESS' && engineResult !== 'terQUEUED') {
      throw new Error(`Transaction submission failed: ${engineResult} - ${engineResultMessage}`);
    }

    console.log('Waiting for validation (max 15 seconds)...');

    // Wait for transaction to be validated
    let validated = false;
    let attempts = 0;
    let txResult;

    while (!validated && attempts < 15) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      try {
        txResult = await client.request({
          command: 'tx',
          transaction: txHash
        });
        
        if (txResult.result.validated) {
          validated = true;
          console.log('Transaction validated!');
        }
      } catch (error) {
        // Not found yet, keep polling
      }
      
      attempts++;
    }

    if (!validated) {
      // Transaction submitted but not yet validated
      console.log('Transaction submitted but not yet validated.');
      await client.disconnect();
      
      return res.status(202).json({
        success: true,
        status: 'pending',
        message: 'Transaction submitted successfully. Validation pending.',
        productId,
        ipfsHash,
        qrCodeIpfsHash: qrIpfsHash,
        xrplTxHash: txHash,
        blockchainExplorer: `https://livenet.xrpl.org/transactions/${txHash}`,
        verificationUrl,
        qrCodeUrl: `https://gateway.pinata.cloud/ipfs/${qrIpfsHash}`,
        note: 'Check the explorer link in ~10 seconds to verify transaction success'
      });
    }

    // Transaction is validated!
    const actualFee = txResult.result.Fee;
    const feeInXRP = Number(actualFee) / 1000000;

    console.log('XRPL Transaction validated:', txHash);
    console.log('Actual Fee:', feeInXRP, 'XRP');
    console.log('Fee in drops:', actualFee);

    // Step 6: Save to database
    console.log('Saving to database...');
    
    await pool.query(
      `INSERT INTO products (product_id, product_name, sku, batch_number, ipfs_hash, xrpl_tx_hash, qr_code_ipfs_hash, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [productId, productName, sku, batchNumber, ipfsHash, txHash, qrIpfsHash, metadata]
    );

    await client.disconnect();

    // Step 7: Return success response with ACTUAL COST
    return res.status(200).json({
      success: true,
      productId,
      ipfsHash,
      qrCodeIpfsHash: qrIpfsHash,
      xrplTxHash: txHash,
      actualCost: {
        fee: feeInXRP,
        feeInDrops: actualFee,
        currency: 'XRP',
        feeInUSD: (feeInXRP * 2.5).toFixed(6) // Approximate at $2.50/XRP
      },
      verificationUrl,
      qrCodeUrl: `https://gateway.pinata.cloud/ipfs/${qrIpfsHash}`,
      blockchainExplorer: `https://livenet.xrpl.org/transactions/${txHash}`,
      ipfsGateway: `https://gateway.pinata.cloud/ipfs/${ipfsHash}`
    });

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
