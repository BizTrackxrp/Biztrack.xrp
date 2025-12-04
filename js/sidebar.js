// BizTrack Sidebar Component - Shared across all public pages
// Usage: Add <div id="sidebar-container" data-page="PAGENAME"></div> to each HTML file

(function() {
  'use strict';

  function renderSidebar(activePage) {
    return `
      <!-- Mobile Hamburger Menu -->
      <button class="pub-hamburger" id="pubHamburger" aria-label="Toggle menu">
        <span></span>
        <span></span>
        <span></span>
      </button>

      <!-- Sidebar Overlay (for mobile) -->
      <div class="pub-overlay" id="pubOverlay"></div>

      <!-- Sidebar -->
      <nav class="sidebar" id="pubSidebar">
        <div class="sidebar-logo">
          <h1>🚚 BizTrack</h1>
        </div>
        <ul class="sidebar-nav">
          
          <!-- Home -->
          <li>
            <a href="index.html" class="${activePage === 'home' || activePage === 'business' ? 'active' : ''}">
              <i class="fas fa-home"></i> Home
            </a>
          </li>
          
          <!-- Use Cases -->
          <li>
            <a href="use-cases.html" class="${activePage === 'use-cases' || activePage.startsWith('use-cases') ? 'active' : ''}">
              <i class="fas fa-lightbulb"></i> Use Cases
            </a>
          </li>
          
          <!-- Verify Product -->
          <li>
            <a href="verify.html" class="${activePage === 'verify' ? 'active' : ''}">
              <i class="fas fa-check-circle"></i> Verify Product
            </a>
          </li>
          
          <!-- Pricing -->
          <li>
            <a href="pricing-hub.html" class="${activePage === 'pricing' ? 'active' : ''}">
              <i class="fas fa-dollar-sign"></i> Pricing
            </a>
          </li>
          
          <!-- Login/Signup -->
          <li>
            <a href="login.html" class="${activePage === 'login' ? 'active' : ''}">
              <i class="fas fa-user"></i> Login/Signup
            </a>
          </li>
          
        </ul>
      </nav>
    `;
  }

  function injectStyles() {
    const styleId = 'pub-sidebar-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      /* Public Sidebar Mobile Styles */
      
      /* Hamburger Menu (Mobile Only) */
      .pub-hamburger {
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

      .pub-hamburger span {
        display: block;
        width: 24px;
        height: 3px;
        background: white;
        border-radius: 2px;
        transition: all 0.3s ease;
      }

      /* X animation */
      .pub-hamburger.active span:nth-child(1) {
        transform: rotate(45deg) translate(6px, 6px);
      }

      .pub-hamburger.active span:nth-child(2) {
        opacity: 0;
      }

      .pub-hamburger.active span:nth-child(3) {
        transform: rotate(-45deg) translate(6px, -6px);
      }

      /* Move X to right side when open */
      .pub-hamburger.active {
        left: 212px;
        background: transparent;
        box-shadow: none;
      }

      /* Overlay */
      .pub-overlay {
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

      .pub-overlay.show {
        display: block;
        opacity: 1;
      }

      /* Mobile Styles */
      @media (max-width: 768px) {
        .pub-hamburger {
          display: flex !important;
        }

        .sidebar {
          position: fixed !important;
          transform: translateX(-100%);
          transition: transform 0.3s ease;
          z-index: 1800;
          box-shadow: 4px 0 20px rgba(0, 0, 0, 0.5);
        }

        .sidebar.open {
          transform: translateX(0);
        }

        .main-content {
          margin-left: 0 !important;
          padding-top: 5rem !important;
        }

        .footer {
          margin-left: 0 !important;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function setupEventListeners() {
    const hamburger = document.getElementById('pubHamburger');
    const sidebar = document.getElementById('pubSidebar');
    const overlay = document.getElementById('pubOverlay');

    if (hamburger) {
      hamburger.addEventListener('click', function() {
        const isOpen = sidebar.classList.contains('open');
        if (isOpen) {
          closeSidebar();
        } else {
          openSidebar();
        }
      });
    }

    if (overlay) {
      overlay.addEventListener('click', closeSidebar);
    }

    // Close on nav link click (mobile)
    const navLinks = document.querySelectorAll('.sidebar-nav a');
    navLinks.forEach(link => {
      link.addEventListener('click', function() {
        if (window.innerWidth <= 768) {
          closeSidebar();
        }
      });
    });

    // Close on Escape key
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        closeSidebar();
      }
    });
  }

  function openSidebar() {
    const hamburger = document.getElementById('pubHamburger');
    const sidebar = document.getElementById('pubSidebar');
    const overlay = document.getElementById('pubOverlay');

    hamburger.classList.add('active');
    sidebar.classList.add('open');
    overlay.classList.add('show');
    document.body.style.overflow = 'hidden';
  }

  function closeSidebar() {
    const hamburger = document.getElementById('pubHamburger');
    const sidebar = document.getElementById('pubSidebar');
    const overlay = document.getElementById('pubOverlay');

    if (hamburger) hamburger.classList.remove('active');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('show');
    document.body.style.overflow = '';
  }

  // Initialize on DOM ready
  document.addEventListener('DOMContentLoaded', function() {
    const sidebarContainer = document.getElementById('sidebar-container');
    
    if (sidebarContainer) {
      const activePage = sidebarContainer.dataset.page || '';
      sidebarContainer.innerHTML = renderSidebar(activePage);
      injectStyles();
      setupEventListeners();
    }
  });
})();
