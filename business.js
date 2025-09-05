// business.js
// Handles product creation form and QR code generation on the business page.

document.addEventListener('DOMContentLoaded', () => {
  const nameInput = document.getElementById('prodName');
  const skuInput = document.getElementById('sku');
  const batchInput = document.getElementById('batch');
  const metadataInput = document.getElementById('metadata');
  const generateBtn = document.getElementById('generateQRBtn');
  const qrOutput = document.getElementById('qrOutput');
  const msgEl = document.getElementById('qrMsg');
  generateBtn.addEventListener('click', () => {
    const name = nameInput.value.trim();
    const sku = skuInput.value.trim();
    const batch = batchInput.value.trim();
    const meta = metadataInput.value.trim();
    if (!name || !sku || !batch) {
      msgEl.textContent = 'Please fill in product name, SKU and batch number.';
      return;
    }
    msgEl.textContent = '';
    // Create a simple product record string. In production you'd mint an NFT or on‑chain token.
    const record = {
      name,
      sku,
      batch,
      metadata: meta,
      id: crypto.randomUUID(),
    };
    // Save to localStorage for demonstration
    const batches = JSON.parse(localStorage.getItem('biztrack-batches') || '[]');
    batches.push(record);
    localStorage.setItem('biztrack-batches', JSON.stringify(batches));
    // Generate a QR code representing the product ID (here: record.id)
    const url = encodeURIComponent(`https://biztrack-xrp.vercel.app/verify.html?id=${record.id}`);
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${url}`;
    qrOutput.innerHTML = `<img src="${qrUrl}" alt="QR Code for product" /><p>Scan to verify</p>`;
    qrOutput.style.display = 'block';
    // Clear inputs
    nameInput.value = skuInput.value = batchInput.value = metadataInput.value = '';
  });
});