// auth.js
// This module manages user authentication, 2FA with TOTP, and simple in‑memory
// user storage for demonstration purposes. In a real application you would
// connect to a backend service and store credentials securely.

// Utility to convert Base32 string to Uint8Array. Base32 is used for TOTP
// secrets because it is more human friendly. This implementation supports
// upper‑case A–Z and digits 2–7. It ignores padding and whitespace.
function base32ToBytes(base32) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = base32.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  const bytes = [];
  let bits = 0;
  let value = 0;
  for (let i = 0; i < clean.length; i++) {
    const idx = alphabet.indexOf(clean[i]);
    if (idx === -1) throw new Error('Invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
}

// Generate a random Base32 secret of given length (defaults to 16)
function generateBase32Secret(length = 16) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let output = '';
  for (let i = 0; i < length; i++) {
    output += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return output;
}

// Compute a TOTP code for a given secret and time step. This function
// uses the Web Crypto API to perform HMAC‑SHA1 operations. It returns a
// promise that resolves to a six digit string.
async function computeTotp(secret, timeStep = Math.floor(Date.now() / 1000 / 30)) {
  const keyData = base32ToBytes(secret);
  const key = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  // 8 byte buffer representing the time step (big‑endian)
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setUint32(0, 0);
  view.setUint32(4, timeStep);
  const hmac = await crypto.subtle.sign('HMAC', key, buffer);
  const hmacView = new DataView(hmac);
  const offset = hmacView.getUint8(hmacView.byteLength - 1) & 0xf;
  const binCode = (hmacView.getUint32(offset) & 0x7fffffff) % 1000000;
  return binCode.toString().padStart(6, '0');
}

// Basic Auth object storing users in localStorage for demonstration.
const Auth = {
  // Retrieve users array from localStorage or default to empty array
  _users() {
    return JSON.parse(localStorage.getItem('biztrack-users') || '[]');
  },
  _saveUsers(users) {
    localStorage.setItem('biztrack-users', JSON.stringify(users));
  },
  // Find a user by email (case insensitive)
  findUser(email) {
    const users = this._users();
    return users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  },
  // Create a new user; returns error string on failure or null on success
  signUp(companyName, email, password) {
    if (!email || !password) return 'Email and password are required.';
    if (this.findUser(email)) return 'An account already exists for this email.';
    const users = this._users();
    users.push({
      companyName,
      email,
      password,
      totpSecret: null,
    });
    this._saveUsers(users);
    return null;
  },
  // Check credentials; returns {status:'requireTotp', user} if 2FA needed;
  // {status:'success', user} if success; otherwise {status:'error', message}
  async login(email, password, totpCode) {
    const user = this.findUser(email);
    if (!user) return { status: 'error', message: 'User not found.' };
    if (user.password !== password) return { status: 'error', message: 'Incorrect password.' };
    if (user.totpSecret) {
      // 2FA enabled; require totpCode
      if (!totpCode) return { status: 'requireTotp' };
      // Accept codes within ±1 time step to allow slight drift
      const nowStep = Math.floor(Date.now() / 1000 / 30);
      const codes = await Promise.all([
        computeTotp(user.totpSecret, nowStep - 1),
        computeTotp(user.totpSecret, nowStep),
        computeTotp(user.totpSecret, nowStep + 1),
      ]);
      if (!codes.includes(totpCode)) {
        return { status: 'error', message: 'Invalid 2FA code.' };
      }
    }
    // Persist session
    localStorage.setItem('biztrack-current-user', user.email);
    return { status: 'success', user };
  },
  // Logout by clearing session
  logout() {
    localStorage.removeItem('biztrack-current-user');
  },
  // Return true if a session is active
  isLoggedIn() {
    return Boolean(localStorage.getItem('biztrack-current-user'));
  },
  // Get current user object
  currentUser() {
    const email = localStorage.getItem('biztrack-current-user');
    if (!email) return null;
    return this.findUser(email);
  },
  // Update current user data and persist
  updateCurrentUser(updates) {
    const user = this.currentUser();
    if (!user) return;
    const users = this._users();
    const idx = users.findIndex((u) => u.email.toLowerCase() === user.email.toLowerCase());
    if (idx >= 0) {
      users[idx] = { ...users[idx], ...updates };
      this._saveUsers(users);
    }
  },
};

// Export Auth globally for inline scripts to use
window.Auth = Auth;

// Event handlers for login and signup pages
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) {
      loginBtn.addEventListener('click', async () => {
        const email = document.getElementById('loginEmail').value.trim();
        const password = document.getElementById('loginPassword').value;
        const totpInput = document.getElementById('loginTotp');
        const totpCode = totpInput && totpInput.value.trim();
        const result = await Auth.login(email, password, totpCode);
        const msgEl = document.getElementById('loginMsg');
        if (result.status === 'requireTotp') {
          document.getElementById('totpGroup').style.display = 'block';
          msgEl.textContent = 'Enter your 2FA code.';
        } else if (result.status === 'success') {
          // redirect to dashboard
          window.location.href = 'dashboard.html';
        } else {
          msgEl.textContent = result.message;
        }
      });
    }
    const signupBtn = document.getElementById('signupBtn');
    if (signupBtn) {
      signupBtn.addEventListener('click', () => {
        const company = document.getElementById('companyName').value.trim();
        const email = document.getElementById('signupEmail').value.trim();
        const password = document.getElementById('signupPassword').value;
        const err = Auth.signUp(company, email, password);
        const msgEl = document.getElementById('signupMsg');
        if (err) {
          msgEl.textContent = err;
        } else {
          msgEl.style.color = '#090';
          msgEl.textContent = 'Account created! You can now login.';
        }
      });
    }
    // Toggle forms navigation
    const showSignup = document.getElementById('showSignup');
    if (showSignup) {
      showSignup.addEventListener('click', (e) => {
        e.preventDefault();
        document.querySelector('.auth-container').style.display = 'none';
        document.getElementById('signupContainer').style.display = 'block';
      });
    }
    const showLoginFromSignup = document.getElementById('showLoginFromSignup');
    if (showLoginFromSignup) {
      showLoginFromSignup.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('signupContainer').style.display = 'none';
        document.querySelector('.auth-container').style.display = 'block';
      });
    }
    const showReset = document.getElementById('showReset');
    if (showReset) {
      showReset.addEventListener('click', (e) => {
        e.preventDefault();
        document.querySelector('.auth-container').style.display = 'none';
        document.getElementById('resetContainer').style.display = 'block';
      });
    }
    const showLoginFromReset = document.getElementById('showLoginFromReset');
    if (showLoginFromReset) {
      showLoginFromReset.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('resetContainer').style.display = 'none';
        document.querySelector('.auth-container').style.display = 'block';
      });
    }
    // For demonstration: password reset sends code and resets password; we simply display a message
    const resetSendCodeBtn = document.getElementById('resetSendCodeBtn');
    if (resetSendCodeBtn) {
      resetSendCodeBtn.addEventListener('click', () => {
        const email = document.getElementById('resetEmail').value.trim();
        const msgEl = document.getElementById('resetMsg');
        const user = Auth.findUser(email);
        if (!user) {
          msgEl.textContent = 'No account found for this email.';
        } else {
          msgEl.style.color = '#090';
          msgEl.textContent = 'A password reset email has been (pretended to be) sent.';
        }
      });
    }
  });
}