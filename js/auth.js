// auth.js - Authentication handling for BizTrack

const API_BASE_URL = '/api';

// Check if user is already logged in
function checkAuth() {
  const token = localStorage.getItem('authToken');
  const user = localStorage.getItem('user');
  
  if (token && user) {
    return {
      isAuthenticated: true,
      token,
      user: JSON.parse(user)
    };
  }
  
  return {
    isAuthenticated: false,
    token: null,
    user: null
  };
}

// Login function
async function login(email, password) {
  try {
    const response = await fetch(`${API_BASE_URL}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: email.toLowerCase().trim(),
        password: password
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Login failed');
    }

    // Store token and user info
    localStorage.setItem('authToken', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));

    return {
      success: true,
      message: data.message,
      user: data.user
    };

  } catch (error) {
    console.error('Login error:', error);
    return {
      success: false,
      error: error.message || 'Login failed. Please try again.'
    };
  }
}

// Register/Signup function
async function register(companyName, email, password) {
  try {
    const response = await fetch(`${API_BASE_URL}/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        companyName: companyName.trim(),
        email: email.toLowerCase().trim(),
        password: password
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Registration failed');
    }

    // After successful registration, automatically log in
    if (data.success) {
      // Now login with the credentials
      const loginResult = await login(email, password);
      if (loginResult.success) {
        return {
          success: true,
          message: 'Account created and logged in successfully!',
          user: loginResult.user
        };
      }
    }

    return {
      success: true,
      message: data.message || 'Account created successfully',
      needsLogin: true
    };

  } catch (error) {
    console.error('Registration error:', error);
    return {
      success: false,
      error: error.message || 'Registration failed. Please try again.'
    };
  }
}

// Logout function
function logout() {
  localStorage.removeItem('authToken');
  localStorage.removeItem('user');
  window.location.href = '/login.html';
}

// Get auth token for API requests
function getAuthToken() {
  return localStorage.getItem('authToken');
}

// Get current user
function getCurrentUser() {
  const userStr = localStorage.getItem('user');
  return userStr ? JSON.parse(userStr) : null;
}

// Make authenticated API request
async function authenticatedFetch(url, options = {}) {
  const token = getAuthToken();
  
  if (!token) {
    throw new Error('Not authenticated');
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    ...options.headers
  };

  const response = await fetch(url, {
    ...options,
    headers
  });

  // If unauthorized, redirect to login
  if (response.status === 401) {
    logout();
    throw new Error('Session expired. Please login again.');
  }

  return response;
}

// Redirect to dashboard if already logged in (for login page)
function redirectIfAuthenticated() {
  const auth = checkAuth();
  if (auth.isAuthenticated) {
    window.location.href = '/dashboard.html';
  }
}

// Protect page - redirect to login if not authenticated (for dashboard/protected pages)
function requireAuth() {
  const auth = checkAuth();
  if (!auth.isAuthenticated) {
    window.location.href = '/login.html';
    return false;
  }
  return true;
}
