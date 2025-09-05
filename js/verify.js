// verify.js
// Handles product verification by ID on the verify page.

document.addEventListener('DOMContentLoaded', () => {
  const verifyBtn = document.getElementById('verifyBtn');
  const idInput = document.getElementById('verifyId');
  const resultEl = document.getElementById('verifyResult');
  const msgEl = document.getElementById('verifyMsg');

  function lookup(id) {
    const batches = JSON.parse(localStorage.getItem('biztrack-batches') || '[]');
    return batches.find((b) => b.id === id);
  }
  // If an id query param is present, auto search
  const urlParams = new URLSearchParams(window.location.search);
  const autoId = urlParams.get('id');
  if (autoId) {
    idInput.value = autoId;
    verify(autoId);
  }
  verifyBtn.addEventListener('click', () => {
    const id = idInput.value.trim();
    verify(id);
  });

  function verify(id) {
    if (!id) {
      msgEl.textContent = 'Please enter a product ID.';
      resultEl.innerHTML = '';
      return;
    }
    msgEl.textContent = '';
    const rec = lookup(id);
    if (!rec) {
      msgEl.textContent = 'Product not found.';
      resultEl.innerHTML = '';
    } else {
      resultEl.innerHTML = `<h3>Product Details</h3>
        <p><strong>Name:</strong> ${rec.name}</p>
        <p><strong>SKU:</strong> ${rec.sku}</p>
        <p><strong>Batch:</strong> ${rec.batch}</p>
        <p><strong>Metadata:</strong> ${rec.metadata || 'N/A'}</p>
        <p><strong>ID:</strong> ${rec.id}</p>`;
    }
  }
});
