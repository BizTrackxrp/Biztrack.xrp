document.addEventListener('DOMContentLoaded', function () {
  const connectBtn = document.getElementById('connect-btn');
  if (connectBtn) {
    // Initialize XummPkce with your public API key and optional redirect URL
    const xumm = new XummPkce('YOUR_PUBLIC_API_KEY', {
      redirectUrl: window.location.origin,
    });

    // If returning from the Xumm app on mobile, listen for the retrieved event
    xumm.on('retrieved', async () => {
      try {
        const state = await xumm.state();
        if (state && state.me) {
          console.log('Connected wallet:', state.me);
        }
      } catch (err) {
        console.error('Error retrieving state:', err);
      }
    });

    connectBtn.addEventListener('click', async function () {
      connectBtn.disabled = true;
      try {
        // Start the authorization flow
        const session = await xumm.authorize();
        // The authorize call resolves when returning on desktop; may log state
        console.log('Authorized session:', session);
      } catch (err) {
        alert('Failed to initiate Xaman login: ' + err.message);
      } finally {
        connectBtn.disabled = false;
      }
    });
  }
});
