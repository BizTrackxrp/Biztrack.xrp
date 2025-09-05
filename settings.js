// settings.js
// Handles the 2FA enable/disable workflow on the Settings page.

document.addEventListener('DOMContentLoaded', () => {
  // Ensure user is logged in; otherwise redirect to login
  if (!Auth.isLoggedIn()) {
    window.location.href = 'login.html';
    return;
  }
  const user = Auth.currentUser();
  const toggle = document.getElementById('toggle2fa');
  const setupSection = document.getElementById('2faSetup');
  const secretContainer = document.getElementById('secretContainer');
  const qrImage = document.getElementById('qrImage');
  const verifyInput = document.getElementById('verifyTotp');
  const verifyBtn = document.getElementById('verifyTotpBtn');
  const verifyMsg = document.getElementById('verifyMsg');
  let newSecret = null;

  // Initialize toggle position based on user.totpSecret
  toggle.checked = !!user.totpSecret;
  toggle.addEventListener('change', async (e) => {
    if (e.target.checked) {
      // Enabling 2FA: generate secret and display QR + verification form
      newSecret = generateBase32Secret(16);
      const otpauthUrl = `otpauth://totp/BizTrack.xrp:${encodeURIComponent(user.email)}?secret=${newSecret}&issuer=BizTrack.xrp`;
      // Use free QR code service to generate the QR data URI
      qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(otpauthUrl)}`;
      secretContainer.textContent = newSecret;
      setupSection.style.display = 'block';
      verifyMsg.textContent = '';
    } else {
      // Disabling 2FA: confirm and remove secret
      const confirmDisable = confirm('Are you sure you want to disable 2FA?');
      if (confirmDisable) {
        Auth.updateCurrentUser({ totpSecret: null });
        alert('2FA has been disabled.');
        setupSection.style.display = 'none';
      } else {
        // Revert toggle
        toggle.checked = true;
      }
    }
  });

  verifyBtn.addEventListener('click', async () => {
    const code = verifyInput.value.trim();
    if (code.length !== 6) {
      verifyMsg.textContent = 'Please enter a 6‑digit code.';
      return;
    }
    // Compare to generated code
    const nowStep = Math.floor(Date.now() / 1000 / 30);
    const codes = await Promise.all([
      computeTotp(newSecret, nowStep - 1),
      computeTotp(newSecret, nowStep),
      computeTotp(newSecret, nowStep + 1),
    ]);
    if (codes.includes(code)) {
      // success: update user with new secret
      Auth.updateCurrentUser({ totpSecret: newSecret });
      setupSection.style.display = 'none';
      verifyInput.value = '';
      toggle.checked = true;
      alert('Two‑factor authentication has been enabled!');
    } else {
      verifyMsg.textContent = 'Incorrect code. Please try again.';
    }
  });
});