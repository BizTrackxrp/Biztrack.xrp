// js/auth.js - Authentication helper with auto token refresh

const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:3000' : '';

// Check if token is expired or about to expire (within 5 minutes)
function isTokenExpiringSoon(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const expiresAt = payload.exp * 1000; // Convert to milliseconds
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;
    
    // Return true if expired or expiring within 5 minutes
    return expiresAt - now < fiveMinutes;
  } catch (e) {
    return true; // If we can't parse, assume expired
  }
}

// Refresh the token
async function refreshToken() {
  const currentToken = localStorage.getItem('biztrack-auth-token');
  
  if (!currentToken) {
    return null;
  }

  try {
    const response = await fetch(`${API_BASE}/api/refresh-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      }
    });

    if (response.ok) {
      const data = await response.json();
      if (data.token) {
        localStorage.setItem('biztrack-auth-token', data.token);
        console.log('Token refreshed successfully');
        return data.token;
      }
    }
    
    // If refresh fails, clear token and redirect to login
    console.log('Token refresh failed');
    logout();
    return null;
    
  } catch (error) {
    console.error('Error refreshing token:', error);
    logout();
    return null;
  }
}

// Get auth token with auto-refresh
async function getAuthToken() {
  let token = localStorage.getItem('biztrack-auth-token');
  
  if (!token) {
    return null;
  }

  // Check if token is expiring soon
  if (isTokenExpiringSoon(token)) {
    console.log('Token expiring soon, refreshing...');
    token = await refreshToken();
  }

  return token;
}

// Enhanced authenticated fetch with auto token refresh
async function authenticatedFetch(url, options = {}) {
  const token = await getAuthToken();
  
  if (!token) {
    window.location.href = '/login.html';
    throw new Error('Not authenticated');
  }

  const headers = {
    ...options.headers,
    'Authorization': `Bearer ${token}`
  };

  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers
  });

  // If we get 401, token might be expired - try refresh once
  if (response.status === 401) {
    console.log('Got 401, attempting token refresh...');
    const newToken = await refreshToken();
    
    if (newToken) {
      // Retry request with new token
      headers['Authorization'] = `Bearer ${newToken}`;
      return fetch(`${API_BASE}${url}`, {
        ...options,
        headers
      });
    } else {
      // Refresh failed, redirect to login
      window.location.href = '/login.html';
      throw new Error('Session expired');
    }
  }

  return response;
}

// Check if user is authenticated
function isAuthenticated() {
  const token = localStorage.getItem('biztrack-auth-token');
  
  if (!token) {
    return false;
  }

  // Check if token is expired
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const expiresAt = payload.exp * 1000;
    return Date.now() < expiresAt;
  } catch (e) {
    return false;
  }
}

// Require authentication (redirect if not authenticated)
function requireAuth() {
  if (!isAuthenticated()) {
    window.location.href = '/login.html';
  }
}

// Logout
function logout() {
  localStorage.removeItem('biztrack-auth-token');
  localStorage.removeItem('biztrack-user-email');
  localStorage.removeItem('biztrack-business-type');
  localStorage.removeItem('biztrack-company-name');
  window.location.href = '/login.html';
}

// ✅ Get user info from token (NOW INCLUDES BUSINESSTYPE)
function getUserFromToken() {
  const token = localStorage.getItem('biztrack-auth-token');
  
  if (!token) {
    return null;
  }

  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return {
      userId: payload.userId,
      email: payload.email,
      businessType: payload.businessType || 'general'
    };
  } catch (e) {
    return null;
  }
}

// ✅ NEW: Get business type from localStorage or token (HELPER FUNCTION)
function getBusinessType() {
  // First try localStorage (faster)
  const stored = localStorage.getItem('biztrack-business-type');
  if (stored) {
    console.log('📋 Business Type from localStorage:', stored);
    return stored;
  }
  
  // Fallback to token
  const user = getUserFromToken();
  const businessType = user?.businessType || 'general';
  console.log('📋 Business Type from token:', businessType);
  return businessType;
}

// Set up automatic token refresh check (every 4 minutes)
let refreshInterval;

function startTokenRefreshTimer() {
  // Clear any existing interval
  if (refreshInterval) {
    clearInterval(refreshInterval);
  }

  // Check token every 4 minutes and refresh if needed
  refreshInterval = setInterval(async () => {
    const token = localStorage.getItem('biztrack-auth-token');
    
    if (token && isTokenExpiringSoon(token)) {
      console.log('Auto-refreshing token...');
      await refreshToken();
    }
  }, 4 * 60 * 1000); // 4 minutes
}

// Start timer when page loads
if (isAuthenticated()) {
  startTokenRefreshTimer();
}
