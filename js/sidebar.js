// BizTrack Sidebar Component - Shared across all pages
// Usage: Add <div id="sidebar-container" data-page="PAGENAME"></div> to each HTML file

function renderSidebar(activePage) {
  // Determine if we should show the submenu (only when on a use-cases page)
  const isUseCasePage = activePage.startsWith('use-cases');
  
  return `
    <nav class="sidebar">
      <div class="sidebar-logo">
        <h1>🚚 BizTrack</h1>
      </div>
      <ul class="sidebar-nav">
        
        <!-- Home -->
        <li>
          <a href="index.html" class="${activePage === 'home' ? 'active' : ''}">
            <i class="fas fa-home"></i> Home
          </a>
        </li>
        
        <!-- For Businesses -->
        <li>
          <a href="business.html" class="${activePage === 'business' ? 'active' : ''}">
            <i class="fas fa-briefcase"></i> For Businesses
          </a>
        </li>
        
        <!-- Use Cases with Dropdown -->
        <li class="dropdown ${isUseCasePage ? 'open active-parent' : ''}">
          <a href="#" class="dropdown-toggle ${activePage === 'use-cases' ? 'active' : ''}" data-prevent-navigate="true">
            <i class="fas fa-lightbulb"></i> 
            <span>Use Cases</span>
            <i class="fas fa-chevron-down dropdown-arrow"></i>
          </a>
          <ul class="submenu" style="display: ${isUseCasePage ? 'block' : 'none'};">
            <li>
              <a href="use-cases.html" class="${activePage === 'use-cases' ? 'active' : ''}">
                <span class="submenu-icon">🎯</span> All Industries
              </a>
            </li>
            <li>
              <a href="pharmaceutical.html" class="${activePage === 'use-cases-pharma' ? 'active' : ''}">
                <span class="submenu-icon">💊</span> Pharmaceutical
              </a>
            </li>
            <li>
              <a href="cannabis.html" class="${activePage === 'use-cases-cannabis' ? 'active' : ''}">
                <span class="submenu-icon">🌿</span> Cannabis
              </a>
            </li>
            <li>
              <a href="luxury.html" class="${activePage === 'use-cases-luxury' ? 'active' : ''}">
                <span class="submenu-icon">💎</span> Luxury Goods
              </a>
            </li>
            <li>
              <a href="food.html" class="${activePage === 'use-cases-food' ? 'active' : ''}">
                <span class="submenu-icon">🍔</span> Food & Beverage
              </a>
            </li>
            <li>
              <a href="electronics.html" class="${activePage === 'use-cases-electronics' ? 'active' : ''}">
                <span class="submenu-icon">📱</span> Electronics
              </a>
            </li>
          </ul>
        </li>
        
        <!-- Verify Product -->
        <li>
          <a href="verify.html" class="${activePage === 'verify' ? 'active' : ''}">
            <i class="fas fa-check-circle"></i> Verify Product
          </a>
        </li>
        
        <!-- Pricing -->
        <li>
          <a href="pricing-public.html" class="${activePage === 'pricing' ? 'active' : ''}">
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
    
    <style>
      /* Dropdown styles */
      .sidebar .dropdown {
        position: relative;
      }

      .sidebar .dropdown-toggle {
        display: flex;
        align-items: center;
        justify-content: space-between;
        cursor: pointer;
      }

      .sidebar .dropdown-toggle span {
        flex: 1;
      }

      .sidebar .dropdown-arrow {
        font-size: 0.75rem;
        transition: transform 0.3s ease;
        margin-left: auto;
      }

      .sidebar .dropdown.open .dropdown-arrow {
        transform: rotate(180deg);
      }

      .sidebar .submenu {
        list-style: none;
        padding-left: 0;
        margin-left: 1.5rem;
        margin-top: 0.5rem;
        overflow: hidden;
        transition: max-height 0.3s ease;
      }

      .sidebar .submenu li {
        margin: 0.25rem 0;
      }

      .sidebar .submenu a {
        padding: 0.625rem 1rem;
        font-size: 0.9rem;
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .sidebar .submenu-icon {
        font-size: 1rem;
      }

      .sidebar .submenu a:hover,
      .sidebar .submenu a.active {
        background: #1e293b;
        color: #3b82f6;
      }

      /* Highlight parent when child is active */
      .sidebar .dropdown.active-parent > .dropdown-toggle {
        color: #3b82f6;
      }
    </style>
  `;
}

// Initialize sidebar on page load
document.addEventListener('DOMContentLoaded', function() {
  const sidebarContainer = document.getElementById('sidebar-container');
  
  if (sidebarContainer) {
    // Get the active page from data-page attribute
    const activePage = sidebarContainer.dataset.page || '';
    
    // Inject sidebar HTML
    sidebarContainer.innerHTML = renderSidebar(activePage);
    
    // Initialize dropdown functionality
    initDropdowns();
  }
});

// Dropdown menu functionality - CLICK ONLY (no hover)
function initDropdowns() {
  const dropdowns = document.querySelectorAll('.sidebar .dropdown');
  
  dropdowns.forEach(dropdown => {
    const toggleLink = dropdown.querySelector('.dropdown-toggle');
    const submenu = dropdown.querySelector('.submenu');
    
    if (!toggleLink || !submenu) return;
    
    // Handle click to toggle dropdown
    toggleLink.addEventListener('click', (e) => {
      e.preventDefault(); // Prevent navigation
      
      // Toggle the dropdown
      const isOpen = dropdown.classList.contains('open');
      
      if (isOpen) {
        // Close it
        dropdown.classList.remove('open');
        submenu.style.display = 'none';
      } else {
        // Open it
        dropdown.classList.add('open');
        submenu.style.display = 'block';
      }
    });
  });
}

// Handle window resize
window.addEventListener('resize', () => {
  initDropdowns();
});
