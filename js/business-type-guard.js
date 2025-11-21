// js/business-type-guard.js
// Ensures pharma users stay on pharma pages and general users stay on general pages

(function() {
  'use strict';

  function checkBusinessTypeRouting() {
    // Get user from token
    const token = localStorage.getItem('biztrack-auth-token');
    
    if (!token) {
      // Not logged in - no routing needed
      return;
    }

    try {
      // Decode JWT token (simple base64 decode, not verification)
      const payload = JSON.parse(atob(token.split('.')[1]));
      const businessType = payload.businessType;
      const currentPath = window.location.pathname;

      console.log('[BUSINESS-TYPE-GUARD] User business type:', businessType);
      console.log('[BUSINESS-TYPE-GUARD] Current path:', currentPath);

      // Pharma user on general page → redirect to pharma equivalent
      if (businessType === 'pharma' && !isPharmaPage(currentPath)) {
        console.log('[BUSINESS-TYPE-GUARD] ⚠️ Pharma user on general page - redirecting to pharma equivalent');
        redirectToPharmaEquivalent(currentPath);
        return;
      }

      // General user on pharma page → redirect to general equivalent
      if (businessType === 'general' && isPharmaPage(currentPath)) {
        console.log('[BUSINESS-TYPE-GUARD] ⚠️ General user on pharma page - redirecting to general equivalent');
        redirectToGeneralEquivalent(currentPath);
        return;
      }

      console.log('[BUSINESS-TYPE-GUARD] ✅ User on correct page type');

    } catch (error) {
      console.error('[BUSINESS-TYPE-GUARD] Error checking business type:', error);
    }
  }

  function isPharmaPage(path) {
    const pharmaPages = [
      '/pharma-dashboard.html',
      '/SI-pharma-dashboard.html',
      '/SI-pharma-pricing.html',
      '/SI-pharma-settings.html',
      '/pharma/receive.html',
      '/pharma/partners.html',
      '/pharma/returns.html',
      '/pharma/quarantine.html',
      '/pharma/epcis.html'
    ];
    
    // Check if current path matches any pharma page
    return pharmaPages.some(page => path.endsWith(page) || path.includes('/pharma/'));
  }

  function redirectToPharmaEquivalent(currentPath) {
    // Map general pages to pharma equivalents
    const pageMap = {
      '/dashboard.html': '/pharma-dashboard.html',
      '/pricing.html': '/SI-pharma-pricing.html',
      '/settings.html': '/SI-pharma-settings.html',
      '/index.html': '/pharma-dashboard.html',
      '/': '/pharma-dashboard.html'
    };

    // Find matching page
    for (const [generalPage, pharmaPage] of Object.entries(pageMap)) {
      if (currentPath.endsWith(generalPage)) {
        window.location.href = pharmaPage;
        return;
      }
    }

    // Default: send to pharma dashboard
    window.location.href = '/pharma-dashboard.html';
  }

  function redirectToGeneralEquivalent(currentPath) {
    // Map pharma pages to general equivalents
    const pageMap = {
      '/pharma-dashboard.html': '/dashboard.html',
      '/SI-pharma-dashboard.html': '/dashboard.html',
      '/SI-pharma-pricing.html': '/pricing.html',
      '/SI-pharma-settings.html': '/settings.html'
    };

    // Find matching page
    for (const [pharmaPage, generalPage] of Object.entries(pageMap)) {
      if (currentPath.endsWith(pharmaPage)) {
        window.location.href = generalPage;
        return;
      }
    }

    // Default: send to general dashboard
    window.location.href = '/dashboard.html';
  }

  // Run on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkBusinessTypeRouting);
  } else {
    checkBusinessTypeRouting();
  }

  console.log('[BUSINESS-TYPE-GUARD] ✅ Guard initialized');

})();
