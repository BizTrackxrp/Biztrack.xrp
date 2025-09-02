// A simple client-side verifier for demonstration purposes.
// In a production environment, this script would call a public indexer or XRPL API
// to fetch on‑chain data associated with the product ID.

document.getElementById('verify-button').addEventListener('click', function () {
  const input = document.getElementById('product-id-input');
  const id = input.value.trim();
  const resultEl = document.getElementById('verification-result');
  resultEl.innerHTML = '';

  if (!id) {
    resultEl.textContent = 'Please enter a product ID.';
    return;
  }
  // Example dataset; in real life, fetch from blockchain
  const sampleProducts = {
    '12345': {
      name: 'Organic Honey',
      sku: 'HNY-001',
      batch: '2025-07-A',
      created: '2025-08-20',
      events: [
        { time: '2025-08-21', actor: 'Farmer', description: 'Harvested and packaged at origin.' },
        { time: '2025-08-22', actor: 'Distributor', description: 'Received at warehouse.' },
        { time: '2025-08-24', actor: 'Retailer', description: 'Arrived in store, shelf‑ready.' },
      ],
    },
  };
  const product = sampleProducts[id];
  if (!product) {
    resultEl.textContent = 'No record found for this product ID. Ensure you scanned the correct QR code.';
    return;
  }
  // Build output
  const container = document.createElement('div');
  container.className = 'product-details';
  const title = document.createElement('h2');
  title.textContent = product.name;
  container.appendChild(title);
  const meta = document.createElement('p');
  meta.innerHTML = `<strong>SKU:</strong> ${product.sku} &nbsp; | &nbsp; <strong>Batch:</strong> ${product.batch} &nbsp; | &nbsp; <strong>Created:</strong> ${product.created}`;
  container.appendChild(meta);
  const eventsTitle = document.createElement('h3');
  eventsTitle.textContent = 'Supply Chain Events';
  container.appendChild(eventsTitle);
  const eventsList = document.createElement('ul');
  product.events.forEach(ev => {
    const li = document.createElement('li');
    li.innerHTML = `<strong>${ev.time}</strong> – <em>${ev.actor}</em>: ${ev.description}`;
    eventsList.appendChild(li);
  });
  container.appendChild(eventsList);
  resultEl.appendChild(container);
});
