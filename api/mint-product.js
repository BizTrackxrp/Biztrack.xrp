const { Client, Wallet } = require('xrpl');
const axios = require('axios');
const { Pool } = require('pg');

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

  try {
    const { productName, sku, batchNumber, metadata } = req.body;

    // Validate required fields
    if (!productName) {
      return res.status(400).json({ error: 'Product name is required' });
    }

    // Generate unique product ID
    const productId = `BT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Step 1: Prepare product data for IPFS
    const productData = {
      productId,
      productName,
      sku: sku || null,
      batchNumber: batchNumber || null,
      metadata: metadata || {},
      createdAt: new Date().toISOString()
    };

    console.log('Uploading to IPFS...');

    // Step 2: Upload to IPFS via Pinata
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
    console.log('IPFS Hash:', ipfsHash);

    // Step 3: Mint to XRPL
    console.log('Minting to XRPL...');
    
    const client = new Client('wss://s1.ripple.com');
    await client.connect();

    const wallet = Wallet.fromSeed(process.env.XRPL_SERVICE_WALLET_SECRET);

    // Get current ledger and use a much larger buffer
    const ledgerIndex = await client.getLedgerIndex();
    console.log('Current ledger:', ledgerIndex);

    // Create transaction with IPFS hash in memo
    const prepared = await client.autofill({
      TransactionType: 'Payment',
      Account: wallet.address,
      Destination: wallet.address,
      Amount: '1',
      LastLedgerSequence: ledgerIndex + 75,
      Memos: [
        {
          Memo: {
            MemoType: Buffer.from('BizTrack').toString('hex').toUpperCase(),
            MemoData: Buffer.from(JSON.stringify({
              productId,
              ipfsHash
            })).toString('hex').toUpperCase()
          }
        }
      ]
    });

    console.log('Signing transaction...');
    const signed = wallet.sign(prepared);

    console.log('Submitting transaction...');
    const submitResult = await client.submit(signed.tx_blob);

    const txHash = submitResult.result.tx_json.hash;
    console.log('Transaction hash:', txHash);
    console.log('Submit result:', submitResult.result.engine_result);

    console.log('Waiting for validation...');

    // Wait for transaction to be validated
    let validated = false;
    let attempts = 0;
    let txResult;

    while (!validated && attempts < 60) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      try {
        txResult = await client.request({
          command: 'tx',
          transaction: txHash
        });
        
        console.log('Polling attempt', attempts, '- validated:', txResult.result.validated);
        
        if (txResult.result.validated) {
          validated = true;
        }
      } catch (error) {
        console.log('Polling attempt', attempts, '- not found yet');
      }
      
      attempts++;
    }

    await client.disconnect();

    if (!validated) {
      throw new Error(`Transaction not validated within timeout. TxHash: ${txHash}. Check: https://livenet.xrpl.org/transactions/${txHash}`);
    }

    const actualFee = txResult.result.Fee;
    const feeInXRP = Number(actualFee) / 1000000;

    console.log('XRPL Transaction:', txHash);
    console.log('Actual Fee:', feeInXRP, 'XRP');

    // Step 4: Save to database
    console.log('Saving to database...');
    
    await pool.query(
      `INSERT INTO products (product_id, product_name, sku, batch_number, ipfs_hash, xrpl_tx_hash, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [productId, productName, sku, batchNumber, ipfsHash, txHash, metadata]
    );

    // Step 5: Return success response
    return res.status(200).json({
      success: true,
      productId,
      ipfsHash,
      xrplTxHash: txHash,
      actualCost: {
        fee: feeInXRP,
        feeInDrops: actualFee,
        currency: 'XRP'
      },
      verificationUrl: `https://www.biztrack.io/verify?id=${productId}`,
      blockchainExplorer: `https://livenet.xrpl.org/transactions/${txHash}`
    });

  } catch (error) {
    console.error('Minting error:', error);
    return res.status(500).json({
      error: 'Minting failed',
      details: error.message
    });
  }
};
