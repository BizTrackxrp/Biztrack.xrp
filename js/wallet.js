document.addEventListener('DOMContentLoaded', () => {
  const connectBtn = document.getElementById('connect-btn');
  if (connectBtn) {
    connectBtn.addEventListener('click', async () => {
      connectBtn.disabled = true;
      try {
        const res = await fetch('/api/xumm-login', { method: 'POST' });
        const { deepLink } = await res.json();
        window.open(deepLink, '_blank');
      } catch (err) {
        alert('Failed to initiate Xaman login: ' + err.message);
      } finally {
        connectBtn.disabled = false;
      }
    });
  }
});
