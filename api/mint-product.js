// Replace line 268-272 in your mint-product.js with this:

// For batch orders, generate a batch_group_id to group products together
const batchGroupId = isBatchOrder ? `batch-${Date.now()}` : null;

// Then update the INSERT query:
await pool.query(
  `INSERT INTO products (
    product_id, 
    product_name, 
    sku, 
    batch_number, 
    ipfs_hash, 
    xrpl_tx_hash, 
    qr_code_ipfs_hash, 
    metadata, 
    user_id,
    is_batch_group,
    batch_group_id,
    batch_quantity
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
  [
    productId, 
    productName, 
    productSku, 
    batchNumber, 
    ipfsHash, 
    txHash, 
    qrIpfsHash, 
    metadata, 
    user.id,
    isBatchOrder,           // $10
    batchGroupId,           // $11
    isBatchOrder ? quantity : null  // $12
  ]
);
