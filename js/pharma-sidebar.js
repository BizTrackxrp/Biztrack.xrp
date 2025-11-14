// js/pharma-sidebar.js
// Pharma-specific sidebar for signed-in pharmaceutical users
// ~200 lines

(function() {
  'use strict';

  function initPharmaSidebar() {
    let container = document.getElementById('pharma-sidebar-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'pharma-sidebar-container';
      document.body.insertBefore(container, document.body.firstChild);
    }

    injectStyles();

    container.innerHTML = `
      <!-- Mobile Hamburger -->
      <button class="pharma-hamburger" id="pharmaHamburger" aria-label="Toggle menu">
        <span></span>
        <span></span>
        <span></span>
      </button>

      <!-- Overlay -->
      <div class="pharma-overlay" id="pharmaOverlay"></div>

      <!-- Sidebar -->
      <nav class="pharma-sidebar" id="pharmaSidebar">
        <div class="pharma-sidebar-logo">
          <h1>🚚 BizTrack</h1>
          <p style="color: #94a3b8; font-size: 0.875rem; margin-top: 0.5rem;">Pharma Compliance</p>
        </div>
        
        <ul class="pharma-sidebar-nav">
          <li><a href="/pharma-dashboard.html" id="pharma-nav-dashboard">
            <i class="fas fa-chart-line"></i> Dashboard
          </a></li>
          
          <li><a href="/pharma/receive.html" id="pharma-nav-receive">
            <i class="fas fa-box"></i> Receive Shipment
          </a></li>
          
          <li><a href="/pharma/partners.html" id="pharma-nav-partners">
            <i class="fas fa-building"></i> Trading Partners
          </a></li>
          
          <li><a href="/pharma/returns.html" id="pharma-nav-returns">
            <i class="fas fa-undo"></i> Returns Processing
          </a></li>
          
          <li><a href="/pharma/quarantine.html" id="pharma-nav-quarantine">
            <i class="fas fa-exclamation-triangle"></i> Quarantine Zone
          </a></li>
          
          <li><a href="/pharma/epcis.html" id="pharma-nav-epcis">
            <i class="fas fa-file-export"></i> EPCIS Export
          </a></li>
          
          <li><a href="/SI-pharma-pricing.html" id="pharma-nav-subscription">
            <i class="fas fa-credit-card"></i> Subscription
          </a></li>
          
          <li><a href="/pharma/settings.html" id="pharma-nav-settings">
            <i class="fas fa-cog"></i> Settings
          </a></li>
        </ul>
        
        <div class="pharma-sidebar-logout">
          <button id="pharmaLogoutBtn">
            <i class="fas fa-sign-out-alt"></i>
            Logout
          </button>
        </div>
      </nav>
    `;

    setupEventListeners();
    setActiveNav();
  }

  function injectStyles() {
    const styleId = 'pharma-sidebar-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      /* Pharma Sidebar Styles */
      
      .pharma-hamburger {
        display: none;
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

      .pharma-hamburger span {
        display: block;
        width: 24px;
        height: 3px;
        background: white;
        border-radius: 2px;
        transition: all 0.3s ease;
      }

      .pharma-hamburger.active span:nth-child(1) {
        transform: rotate(45deg) translate(6px, 6px);
      }

      .pharma-hamburger.active span:nth-child(2) {
        opacity: 0;
      }

      .pharma-hamburger.active span:nth-child(3) {
        transform: rotate(-45deg) translate(6px, -6px);
      }

      .pharma-overlay {
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

      .pharma-overlay.show {
        display: block;
        opacity: 1;
      }

      .pharma-sidebar {
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

      .pharma-sidebar-logo {
        padding: 0 0 2rem 0;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        margin-bottom: 2rem;
      }

      .pharma-sidebar-logo h1 {
        color: #fff;
        font-size: 1.5rem;
        font-weight: 800;
      }

      .pharma-sidebar-nav {
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        flex: 1;
      }

      .pharma-sidebar-nav a {
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

      .pharma-sidebar-nav a:hover {
        background: #1e293b;
        color: #3b82f6;
      }

      .pharma-sidebar-nav a.active {
        background: #1e293b;
        color: #3b82f6;
      }

      .pharma-sidebar-nav a i {
        width: 20px;
        font-size: 1.1rem;
      }

      .pharma-sidebar-logout {
        margin-top: auto;
        padding-top: 1rem;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
      }

      .pharma-sidebar-logout button {
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

      .pharma-sidebar-logout button:hover {
        background: rgba(239, 68, 68, 0.2);
        transform: translateY(-2px);
      }

      .main-with-sidebar {
        margin-left: 280px;
      }

      @media (max-width: 768px) {
        .pharma-hamburger {
          display: flex !important;
        }

        .pharma-sidebar {
          transform: translateX(-100%);
          box-shadow: 4px 0 20px rgba(0, 0, 0, 0.5);
          z-index: 1800;
        }

        .pharma-sidebar.open {
          transform: translateX(0);
        }

        .main-with-sidebar {
          margin-left: 0 !important;
          padding-top: 5rem !important;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function setupEventListeners() {
    const hamburger = document.getElementById('pharmaHamburger');
    const sidebar = document.getElementById('pharmaSidebar');
    const overlay = document.getElementById('pharmaOverlay');
    const logoutBtn = document.getElementById('pharmaLogoutBtn');

    if (hamburger) {
      hamburger.addEventListener('click', toggleSidebar);
    }

    if (overlay) {
      overlay.addEventListener('click', closeSidebar);
    }

    const navLinks = document.querySelectorAll('.pharma-sidebar-nav a');
    navLinks.forEach(link => {
      link.addEventListener('click', function() {
        if (window.innerWidth <= 768) {
          closeSidebar();
        }
      });
    });

    if (logoutBtn) {
      logoutBtn.addEventListener('click', function(e) {
        e.preventDefault();
        if (typeof DashboardComponents !== 'undefined' && typeof DashboardComponents.logout === 'function') {
          DashboardComponents.logout();
        } else {
          // Fallback
          if (confirm('Are you sure you want to logout?')) {
            localStorage.removeItem('biztrack-auth-token');
            localStorage.removeItem('biztrack-user-email');
            window.location.href = '/login.html';
          }
        }
      });
    }

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        closeSidebar();
      }
    });
  }

  function toggleSidebar() {
    const sidebar = document.getElementById('pharmaSidebar');
    if (sidebar.classList.contains('open')) {
      closeSidebar();
    } else {
      openSidebar();
    }
  }

  function openSidebar() {
    document.getElementById('pharmaHamburger').classList.add('active');
    document.getElementById('pharmaSidebar').classList.add('open');
    document.getElementById('pharmaOverlay').classList.add('show');
    document.body.style.overflow = 'hidden';
  }

  function closeSidebar() {
    document.getElementById('pharmaHamburger').classList.remove('active');
    document.getElementById('pharmaSidebar').classList.remove('open');
    document.getElementById('pharmaOverlay').classList.remove('show');
    document.body.style.overflow = '';
  }

  function setActiveNav() {
    const currentPage = window.location.pathname.split('/').pop() || 'pharma-dashboard.html';
    
    const navMap = {
      'pharma-dashboard.html': 'pharma-nav-dashboard',
      'receive.html': 'pharma-nav-receive',
      'partners.html': 'pharma-nav-partners',
      'returns.html': 'pharma-nav-returns',
      'quarantine.html': 'pharma-nav-quarantine',
      'epcis.html': 'pharma-nav-epcis',
      'SI-pharma-pricing.html': 'pharma-nav-subscription',
      'settings.html': 'pharma-nav-settings'
    };
    
    const activeNavId = navMap[currentPage];
    if (activeNavId) {
      const activeLink = document.getElementById(activeNavId);
      if (activeLink) {
        activeLink.classList.add('active');
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPharmaSidebar);
  } else {
    initPharmaSidebar();
  }
})();
