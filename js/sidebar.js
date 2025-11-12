// BizTrack Sidebar Component - Shared across all pages
// Usage: Add <div id="sidebar-container" data-page="PAGENAME"></div> to each HTML file

function renderSidebar(activePage) {
  return `
    <nav class="sidebar">
      <div class="sidebar-logo">
        <h1>🚚 BizTrack</h1>
      </div>
      <ul class="sidebar-nav">
        
        <!-- Home -->
        <li>
          <a href="/index.html" class="${activePage === 'home' ? 'active' : ''}">
            <i class="fas fa-home"></i> Home
          </a>
        </li>
        
        <!-- For Businesses -->
        <li>
          <a href="/business.html" class="${activePage === 'business' ? 'active' : ''}">
            <i class="fas fa-briefcase"></i> For Businesses
          </a>
        </li>
        
        <!-- Use Cases with Dropdown -->
        <li class="dropdown ${activePage.startsWith('use-cases') ? 'active-parent' : ''}">
          <a href="/use-cases.html" class="${activePage === 'use-cases' ? 'active' : ''}">
            <i class="fas fa-lightbulb"></i> Use Cases
            <i class="fas fa-chevron-down dropdown-arrow"></i>
          </a>
          <ul class="submenu">
            <li>
              <a href="/pharmaceutical.html" class="${activePage === 'use-cases-pharma' ? 'active' : ''}">
                <span class="submenu-icon">💊</span> Pharmaceutical
              </a>
            </li>
            <li>
              <a href="/cannabis.html" class="${activePage === 'use-cases-cannabis' ? 'active' : ''}">
                <span class="submenu-icon">🌿</span> Cannabis
              </a>
            </li>
            <li>
              <a href="/luxury.html" class="${activePage === 'use-cases-luxury' ? 'active' : ''}">
                <span class="submenu-icon">💎</span> Luxury Goods
              </a>
            </li>
            <li>
              <a href="/food.html" class="${activePage === 'use-cases-food' ? 'active' : ''}">
                <span class="submenu-icon">🍔</span> Food & Beverage
              </a>
            </li>
            <li>
              <a href="/electronics.html" class="${activePage === 'use-cases-electronics' ? 'active' : ''}">
                <span class="submenu-icon">📱</span> Electronics
              </a>
            </li>
          </ul>
        </li>
        
        <!-- Verify Product -->
        <li>
          <a href="/verify.html" class="${activePage === 'verify' ? 'active' : ''}">
            <i class="fas fa-check-circle"></i> Verify Product
          </a>
        </li>
        
        <!-- Pricing -->
        <li>
          <a href="/pricing-public.html" class="${activePage === 'pricing' ? 'active' : ''}">
            <i class="fas fa-dollar-sign"></i> Pricing
          </a>
        </li>
        
        <!-- Login/Signup -->
        <li>
          <a href="/login.html" class="${activePage === 'login' ? 'active' : ''}">
            <i class="fas fa-user"></i> Login/Signup
          </a>
        </li>
        
      </ul>
    </nav>
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

// Dropdown menu functionality
function initDropdowns() {
  const dropdowns = document.querySelectorAll('.sidebar .dropdown');
  
  dropdowns.forEach(dropdown => {
    const link = dropdown.querySelector('a');
    const submenu = dropdown.querySelector('.submenu');
    
    // Desktop: Show submenu on hover
    if (window.innerWidth > 768) {
      dropdown.addEventListener('mouseenter', () => {
        submenu.style.display = 'block';
      });
      
      dropdown.addEventListener('mouseleave', () => {
        submenu.style.display = 'none';
      });
    }
    
    // Mobile: Toggle submenu on click
    link.addEventListener('click', (e) => {
      if (window.innerWidth <= 768) {
        e.preventDefault();
        dropdown.classList.toggle('open');
        
        if (dropdown.classList.contains('open')) {
          submenu.style.display = 'block';
        } else {
          submenu.style.display = 'none';
        }
      }
    });
  });
  
  // Dropdown stays collapsed by default - only expands on hover/click
}

// Handle window resize
window.addEventListener('resize', () => {
  initDropdowns();
});
