*
 * wallet.js
 *
 * Integrates Xaman (XUMM) login via the /api/xumm-login backend endpoint.
 * When the user clicks the connect wallet link, we request a sign-in payload
 * from the backend and display the QR code or open the deep link on mobile.
 */

window.Wallet = {
  async connect() {
    try {
      // POST to our XUMM login API endpoint.
      const res = await fetch('/api/xumm-login', {
        method: 'POST'
      });
      if (!res.ok) {
        throw new Error('Network response was not ok');
      }
      const data = await res.json();

      if (data.qr) {
        // Create a modal container if it doesn't exist.
        let modal = document.getElementById('walletModal');
        if (!modal) {
          modal = document.createElement('div');
          modal.id = 'walletModal';
          modal.style.position = 'fixed';
          modal.style.top = '0';
          modal.style.left = '0';
          modal.style.width = '100%';
          modal.style.height = '100%';
          modal.style.display = 'flex';
          modal.style.alignItems = 'center';
          modal.style.justifyContent = 'center';
          modal.style.backgroundColor = 'rgba(0,0,0,0.6)';
          modal.style.zIndex = '1000';

          const img = document.createElement('img');
          img.id = 'walletQr';
          img.style.backgroundColor = '#fff';
          img.style.padding = '10px';
          img.style.borderRadius = '8px';

          modal.appendChild(img);
          modal.addEventListener('click', () => {
            modal.remove();
          });

          document.body.appendChild(modal);
        }
        const qrImg = document.getElementById('walletQr');
        qrImg.src = data.qr;
        qrImg.alt = 'Scan this QR code with the Xaman app to sign in';

        // Also open the deep link automatically on mobile devices.
        if (/Mobi|Android/i.test(navigator.userAgent) && data.deepLink) {
          window.location.href = data.deepLink;
        }
      } else {
        alert('Login request failed: missing QR code.');
      }
    } catch (err) {
      alert('Failed to connect wallet: ' + err.message);
    }
  }
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
