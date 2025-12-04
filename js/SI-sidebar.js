// js/SI-sidebar.js - Unified Signed-In Sidebar Component
// Perfect mobile hamburger menu + desktop sidebar

(function() {
  'use strict';

  // Inject sidebar HTML and styles
  function initSidebar() {
    // Create container if it doesn't exist
    let container = document.getElementById('si-sidebar-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'si-sidebar-container';
      document.body.insertBefore(container, document.body.firstChild);
    }

    // Inject styles
    injectStyles();

    // Inject HTML
    container.innerHTML = `
      <!-- Mobile Hamburger Menu -->
      <button class="si-hamburger" id="siHamburger" aria-label="Toggle menu">
        <span></span>
        <span></span>
        <span></span>
      </button>

      <!-- Sidebar Overlay (for mobile) -->
      <div class="si-overlay" id="siOverlay"></div>

      <!-- Sidebar -->
      <nav class="si-sidebar" id="siSidebar">
        <div class="si-sidebar-logo">
          <h1>🚚 BizTrack</h1>
        </div>
        
        <ul class="si-sidebar-nav">
          <li><a href="dashboard.html" id="si-nav-dashboard"><i class="fas fa-plus-circle"></i> Create Products</a></li>
          <li><a href="production.html" id="si-nav-production"><i class="fas fa-industry"></i> In Progress</a></li>
          <li><a href="products.html" id="si-nav-products"><i class="fas fa-check-circle"></i> Finished Products</a></li>
          <li><a href="#" onclick="goToPricing(); return false;" id="si-nav-subscription"><i class="fas fa-credit-card"></i> Subscription</a></li>
          <li><a href="settings.html" id="si-nav-settings"><i class="fas fa-cog"></i> Settings</a></li>
        </ul>
        
        <div class="si-sidebar-logout">
          <button id="siLogoutBtn">
            <i class="fas fa-sign-out-alt"></i>
            Logout
          </button>
        </div>
      </nav>
    `;

    // Setup event listeners
    setupEventListeners();

    // Set active nav
    setActiveNav();
  }

  // Inject CSS styles
  function injectStyles() {
    const styleId = 'si-sidebar-styles';
    if (document.getElementById(styleId)) return; // Already injected

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      /* SI-Sidebar Styles */
      
      /* Hamburger Menu (Mobile Only) */
      .si-hamburger {
        display: none; /* Hidden on desktop */
        position: fixed;
        top: 1rem;
        left: 1rem;
        z-index: 2000;
        background: #0f172a;
        border: none;
        padding: 0.75rem;
        border-radius: 8px;
        cursor: pointer;
        width: 48px;
        height: 48px;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        gap: 5px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        transition: all 0.3s ease;
      }

      /* When sidebar is open, move X button to top-right of sidebar */
      .si-hamburger.active {
        left: 232px;
        background: transparent;
        box-shadow: none;
      }

      .si-hamburger span {
        display: block;
        width: 24px;
        height: 3px;
        background: white;
        border-radius: 2px;
        transition: all 0.3s ease;
      }

      .si-hamburger.active span:nth-child(1) {
        transform: rotate(45deg) translate(6px, 6px);
      }

      .si-hamburger.active span:nth-child(2) {
        opacity: 0;
      }

      .si-hamburger.active span:nth-child(3) {
        transform: rotate(-45deg) translate(6px, -6px);
      }

      /* Overlay (Mobile Only) */
      .si-overlay {
        display: none;
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        z-index: 1500;
        opacity: 0;
        transition: opacity 0.3s ease;
      }

      .si-overlay.show {
        display: block;
        opacity: 1;
      }

      /* Sidebar - Desktop */
      .si-sidebar {
        position: fixed;
        left: 0;
        top: 0;
        width: 280px;
        height: 100vh;
        background: #0f172a;
        padding: 2rem 1.5rem;
        z-index: 1000;
        display: flex;
        flex-direction: column;
        overflow-y: auto;
        transition: transform 0.3s ease;
      }

      .si-sidebar-logo {
        padding: 0 0 2rem 0;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        margin-bottom: 2rem;
      }

      .si-sidebar-logo h1 {
        color: #fff;
        font-size: 1.5rem;
        font-weight: 800;
      }

      .si-sidebar-nav {
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        flex: 1;
      }

      .si-sidebar-nav a {
        display: flex;
        align-items: center;
        padding: 0.875rem 1rem;
        color: #94a3b8;
        text-decoration: none;
        font-weight: 500;
        transition: all 0.2s;
        border-radius: 8px;
        gap: 0.75rem;
      }

      .si-sidebar-nav a:hover {
        background: #1e293b;
        color: #3b82f6;
      }

      .si-sidebar-nav a.active {
        background: #1e293b;
        color: #3b82f6;
      }

      .si-sidebar-nav a i {
        width: 20px;
        font-size: 1.1rem;
      }

      .si-sidebar-logout {
        margin-top: auto;
        padding-top: 1rem;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
      }

      .si-sidebar-logout button {
        width: 100%;
        padding: 0.875rem 1rem;
        background: rgba(239, 68, 68, 0.1);
        color: #ef4444;
        border: 1px solid rgba(239, 68, 68, 0.2);
        border-radius: 8px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        font-size: 0.95rem;
      }

      .si-sidebar-logout button:hover {
        background: rgba(239, 68, 68, 0.2);
        transform: translateY(-2px);
      }

      /* Main content offset for desktop */
      .main-with-sidebar {
        margin-left: 280px;
      }

      /* Mobile Styles */
      @media (max-width: 768px) {
        /* Show hamburger on mobile */
        .si-hamburger {
          display: flex !important;
        }

        /* Hide sidebar by default on mobile */
        .si-sidebar {
          transform: translateX(-100%);
          box-shadow: 4px 0 20px rgba(0, 0, 0, 0.5);
          z-index: 1800;
        }

        /* Show sidebar when open */
        .si-sidebar.open {
          transform: translateX(0);
        }

        /* Remove main content left margin on mobile */
        .main-with-sidebar {
          margin-left: 0 !important;
          padding-top: 5rem !important; /* Space for hamburger */
        }
      }
    `;

    document.head.appendChild(style);
  }

  // Setup event listeners
  function setupEventListeners() {
    const hamburger = document.getElementById('siHamburger');
    const sidebar = document.getElementById('siSidebar');
    const overlay = document.getElementById('siOverlay');
    const logoutBtn = document.getElementById('siLogoutBtn');

    // Hamburger click
    if (hamburger) {
      hamburger.addEventListener('click', function() {
        toggleSidebar();
      });
    }

    // Overlay click - close sidebar
    if (overlay) {
      overlay.addEventListener('click', function() {
        closeSidebar();
      });
    }

    // Close sidebar when clicking nav links on mobile
    const navLinks = document.querySelectorAll('.si-sidebar-nav a');
    navLinks.forEach(link => {
      link.addEventListener('click', function() {
        if (window.innerWidth <= 768) {
          closeSidebar();
        }
      });
    });

    // Logout button
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function(e) {
        e.preventDefault();
        if (confirm('Are you sure you want to logout?')) {
          if (typeof logout === 'function') {
            logout();
          } else {
            // Fallback logout
            localStorage.removeItem('biztrack-auth-token');
            localStorage.removeItem('biztrack-user-email');
            window.location.href = '/login.html';
          }
        }
      });
    }

    // Close sidebar on escape key
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        closeSidebar();
      }
    });
  }

  // Toggle sidebar
  function toggleSidebar() {
    const hamburger = document.getElementById('siHamburger');
    const sidebar = document.getElementById('siSidebar');
    const overlay = document.getElementById('siOverlay');

    const isOpen = sidebar.classList.contains('open');

    if (isOpen) {
      closeSidebar();
    } else {
      openSidebar();
    }
  }

  // Open sidebar
  function openSidebar() {
    const hamburger = document.getElementById('siHamburger');
    const sidebar = document.getElementById('siSidebar');
    const overlay = document.getElementById('siOverlay');

    hamburger.classList.add('active');
    sidebar.classList.add('open');
    overlay.classList.add('show');
    document.body.style.overflow = 'hidden'; // Prevent scrolling when sidebar open
  }

  // Close sidebar
  function closeSidebar() {
    const hamburger = document.getElementById('siHamburger');
    const sidebar = document.getElementById('siSidebar');
    const overlay = document.getElementById('siOverlay');

    hamburger.classList.remove('active');
    sidebar.classList.remove('open');
    overlay.classList.remove('show');
    document.body.style.overflow = ''; // Re-enable scrolling
  }

  // Set active nav item
  function setActiveNav() {
    const currentPage = window.location.pathname.split('/').pop() || 'dashboard.html';
    
    const navMap = {
      'dashboard.html': 'si-nav-dashboard',
      'products.html': 'si-nav-products',
      'production.html': 'si-nav-production',
      'pricing.html': 'si-nav-subscription',
      'SI-pharma-pricing.html': 'si-nav-subscription',
      'settings.html': 'si-nav-settings'
    };
    
    const activeNavId = navMap[currentPage];
    if (activeNavId) {
      const activeLink = document.getElementById(activeNavId);
      if (activeLink) {
        activeLink.classList.add('active');
      }
    }
  }

  // Global routing function for pricing pages
  window.goToPricing = async function() {
    try {
      if (typeof authenticatedFetch !== 'function') {
        console.error('authenticatedFetch is not defined');
        window.location.href = '/pricing.html';
        return;
      }

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
  };

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSidebar);
  } else {
    initSidebar();
  }
})();
