// wallet.js
// Minimal placeholder for wallet connection. This module defines a global
// Wallet object that will eventually integrate with Xaman or WalletConnect.

window.Wallet = {
  async connect() {
    // In a real application you'd instantiate a WalletConnect provider here,
    // supplying your projectId and RPC configuration. Because this demo
    // environment lacks the backend credentials, we simply notify the user.
    const projectId = window.walletConnectProjectId || null;
    if (!projectId) {
      alert('WalletConnect is not configured. Please set your WalletConnect project ID in the code before connecting.');
      return;
    }
    alert('Connecting wallet… (not implemented in this demo)');
  },
};

document.addEventListener('DOMContentLoaded', () => {
  const link = document.getElementById('connectWalletLink');
  if (link) {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      Wallet.connect();
    });
  }
});
