// js/dashboard-components.js
// Shared components for both general and pharma dashboards
// ~200 lines

(function() {
  'use strict';

  // ==========================================
  // AUTHENTICATION & API UTILITIES
  // ==========================================

  function getToken() {
    return localStorage.getItem('biztrack-auth-token');
  }

  async function authenticatedFetch(url, options = {}) {
    const token = getToken();
    if (!token) {
      window.location.href = '/login.html';
      throw new Error('No authentication token');
    }

    const headers = {
      ...options.headers,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };

    const response = await fetch(url, { ...options, headers });
    
    if (response.status === 401) {
      localStorage.removeItem('biztrack-auth-token');
      window.location.href = '/login.html';
      throw new Error('Session expired');
    }

    return response;
  }

  function requireAuth() {
    const token = getToken();
    if (!token) {
      window.location.href = '/login.html';
    }
  }

  function logout() {
    if (confirm('Are you sure you want to logout?')) {
      localStorage.removeItem('biztrack-auth-token');
      localStorage.removeItem('biztrack-user-email');
      window.location.href = '/login.html';
    }
  }

  // ==========================================
  // SUBSCRIPTION & USAGE TRACKING
  // ==========================================

  let subscriptionData = {
    qrUsed: 0,
    qrLimit: 10,
    tier: 'free',
    businessType: 'general',
    isPharma: false
  };

  async function loadSubscriptionLimits() {
    try {
      const response = await authenticatedFetch('/api/check-limits');
      const data = await response.json();
      
      if (data.success) {
        subscriptionData = {
          qrUsed: data.usage.qrCodesUsed,
          qrLimit: data.limits.qrLimit,
          tier: data.subscription.tier,
          businessType: data.subscription.businessType || 'general',
          isPharma: data.subscription.isPharma || false,
          maxBatchSize: data.limits.maxBatchSize || 10
        };
        
        return subscriptionData;
      }
    } catch (error) {
      console.error('Failed to load subscription limits:', error);
      return subscriptionData;
    }
  }

  function getSubscriptionData() {
    return subscriptionData;
  }

  // ==========================================
  // UI COMPONENTS
  // ==========================================

  function renderUsageCounter(data) {
    const percentUsed = data.qrLimit > 0 ? Math.round((data.qrUsed / data.qrLimit) * 100) : 0;
    const tierName = data.tier.charAt(0).toUpperCase() + data.tier.slice(1) + ' Plan';
    
    return `
      <div class="usage-counter">
        <div class="usage-counter-info">
          <h4>QR Codes Used This Month</h4>
          <div class="usage-counter-numbers">
            <span>${data.qrUsed.toLocaleString()}</span> 
            <small>/ ${data.qrLimit.toLocaleString()}</small>
          </div>
          <p style="margin-top: 0.5rem; font-size: 0.875rem; opacity: 0.9;">${tierName}</p>
        </div>
        <button class="usage-counter-upgrade" onclick="DashboardComponents.goToPricing()">
          <i class="fas fa-arrow-up"></i> Upgrade Plan
        </button>
      </div>
    `;
  }

  function renderUpgradePrompt(percentUsed, used, limit, tier) {
    const tierUpgrades = {
      free: { next: 'essential', name: 'Essential', price: 49, limit: 500 },
      essential: { next: 'scale', name: 'Scale', price: 149, limit: 2500 },
      scale: { next: 'enterprise', name: 'Enterprise', price: 399, limit: 10000 }
    };
    
    const upgrade = tierUpgrades[tier];
    if (!upgrade) return '';
    
    return `
      <div style="padding: 1.5rem; background: linear-gradient(135deg, #FEF3C7, #FDE047); border-radius: 12px; margin-bottom: 2rem; border: 2px solid #F59E0B;">
        <h3 style="margin: 0 0 0.5rem 0; color: #92400E;">
          <i class="fas fa-exclamation-triangle"></i> You're running low on QR codes!
        </h3>
        <p style="margin: 0 0 1rem 0; color: #92400E;">
          You've used ${percentUsed}% of your monthly limit (${used.toLocaleString()} / ${limit.toLocaleString()}). 
          Upgrade to <strong>${upgrade.name}</strong> for ${upgrade.limit.toLocaleString()} QR codes per month.
        </p>
        <a href="pricing.html" style="padding: 0.75rem 1.5rem; background: #F59E0B; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; display: inline-block;">
          <i class="fas fa-arrow-up"></i> Upgrade Now - $${upgrade.price}/mo
        </a>
      </div>
    `;
  }

  function showMessage(type, message, icon = 'info-circle') {
    return `
      <div class="message ${type}">
        <i class="fas fa-${icon}"></i> ${message}
      </div>
    `;
  }

  // ==========================================
  // IMAGE HANDLING
  // ==========================================

  async function compressImage(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          
          const MAX_WIDTH = 1200;
          const MAX_HEIGHT = 1200;
          
          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height;
              height = MAX_HEIGHT;
            }
          }
          
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          
          resolve(canvas.toDataURL('image/jpeg', 0.8));
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // ==========================================
  // ROUTING
  // ==========================================

  async function goToPricing() {
    try {
      const response = await authenticatedFetch('/api/profile');
      const data = await response.json();
      
      if (data.success && data.user) {
        if (data.user.businessType === 'pharma') {
          window.location.href = '/SI-pharma-pricing.html';
        } else {
          window.location.href = '/pricing.html';
        }
      } else {
        window.location.href = '/pricing.html';
      }
    } catch (error) {
      console.error('Error routing to pricing:', error);
      window.location.href = '/pricing.html';
    }
  }

  // ==========================================
  // EXPORT TO WINDOW
  // ==========================================

  window.DashboardComponents = {
    // Auth
    getToken,
    authenticatedFetch,
    requireAuth,
    logout,
    
    // Subscription
    loadSubscriptionLimits,
    getSubscriptionData,
    
    // UI Components
    renderUsageCounter,
    renderUpgradePrompt,
    showMessage,
    
    // Image handling
    compressImage,
    
    // Routing
    goToPricing
  };

})();
