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

  let client;

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
    
    // Use XRPL Labs cluster (Wietse's infrastructure)
    client = new Client('wss://xrplcluster.com');
    await client.connect();
    console.log('Connected to XRPL');

    const wallet = Wallet.fromSeed(process.env.XRPL_SERVICE_WALLET_SECRET);

    // Prepare transaction template
    const tx = {
      TransactionType: 'Payment',
      Account: wallet.address,
      Destination: wallet.address,
      Amount: '1',
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
    };

    console.log('Getting current ledger...');
    const ledgerIndex = await client.getLedgerIndex();
    console.log('Current ledger:', ledgerIndex);

    // Autofill the transaction
    console.log('Autofilling transaction...');
    const prepared = await client.autofill(tx);
    
    // Override with fresh ledger + 4 (XRPL best practice)
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

    // Wait for transaction to be validated (should be fast with +4 buffer)
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
      // Transaction submitted but not yet validated - this is OK, it will process
      console.log('Transaction submitted but not yet validated. It should process shortly.');
      await client.disconnect();
      
      return res.status(202).json({
        success: true,
        status: 'pending',
        message: 'Transaction submitted successfully. Validation pending.',
        productId,
        ipfsHash,
        xrplTxHash: txHash,
        blockchainExplorer: `https://livenet.xrpl.org/transactions/${txHash}`,
        note: 'Check the explorer link in ~10 seconds to verify transaction success'
      });
    }

    // Transaction is validated!
    const actualFee = txResult.result.Fee;
    const feeInXRP = Number(actualFee) / 1000000;

    console.log('XRPL Transaction validated:', txHash);
    console.log('Actual Fee:', feeInXRP, 'XRP');
    console.log('Fee in drops:', actualFee);

    // Step 4: Save to database
    console.log('Saving to database...');
    
    await pool.query(
      `INSERT INTO products (product_id, product_name, sku, batch_number, ipfs_hash, xrpl_tx_hash, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [productId, productName, sku, batchNumber, ipfsHash, txHash, metadata]
    );

    await client.disconnect();

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
    if (client) {
      await client.disconnect();
    }
    return res.status(500).json({
      error: 'Minting failed',
      details: error.message
    });
  }
};
