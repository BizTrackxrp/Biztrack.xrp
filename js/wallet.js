document.addEventListener("DOMContentLoaded", function() {
  const connectBtn = document.getElementById('connect-btn');
  if (connectBtn) {
    connectBtn.addEventListener('click', function() {
      // Open Xaman (XUMM) wallet login page in a new tab
      window.open('https://xumm.app/', '_blank');
    });
  }
});
