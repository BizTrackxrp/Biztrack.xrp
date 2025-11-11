// This generates the sidebar HTML
function renderSidebar(activePage) {
  return `
    <nav class="sidebar">
      <div class="sidebar-logo">
        <h1>🚚 BizTrack</h1>
      </div>
      <ul class="sidebar-nav">
        <li><a href="/index.html" class="${activePage === 'home' ? 'active' : ''}">
          <i class="fas fa-home"></i> Home
        </a></li>
        
        <li><a href="/business.html" class="${activePage === 'business' ? 'active' : ''}">
          <i class="fas fa-briefcase"></i> For Businesses
        </a></li>
        
        <!-- Use Cases with Dropdown -->
        <li class="dropdown">
          <a href="/use-cases.html" class="${activePage.startsWith('use-cases') ? 'active' : ''}">
            <i class="fas fa-lightbulb"></i> Use Cases <i class="fas fa-chevron-down"></i>
          </a>
          <ul class="submenu">
            <li><a href="/use-cases/pharmaceutical.html">💊 Pharmaceutical</a></li>
            <li><a href="/use-cases/cannabis.html">🌿 Cannabis</a></li>
            <li><a href="/use-cases/luxury.html">💎 Luxury Goods</a></li>
            <li><a href="/use-cases/food.html">🍔 Food & Beverage</a></li>
            <li><a href="/use-cases/electronics.html">📱 Electronics</a></li>
          </ul>
        </li>
        
        <li><a href="/verify.html" class="${activePage === 'verify' ? 'active' : ''}">
          <i class="fas fa-check-circle"></i> Verify Product
        </a></li>
        
        <li><a href="/pricing-public.html" class="${activePage === 'pricing' ? 'active' : ''}">
          <i class="fas fa-dollar-sign"></i> Pricing
        </a></li>
        
        <li><a href="/login.html" class="${activePage === 'login' ? 'active' : ''}">
          <i class="fas fa-user"></i> Login/Signup
        </a></li>
      </ul>
    </nav>
  `;
}

// Auto-inject on page load
document.addEventListener('DOMContentLoaded', function() {
  const sidebarContainer = document.getElementById('sidebar-container');
  if (sidebarContainer) {
    const activePage = sidebarContainer.dataset.page || '';
    sidebarContainer.innerHTML = renderSidebar(activePage);
    
    // Add dropdown click handler
    initDropdowns();
  }
});

function initDropdowns() {
  const dropdowns = document.querySelectorAll('.dropdown');
  dropdowns.forEach(dropdown => {
    dropdown.querySelector('a').addEventListener('click', (e) => {
      if (window.innerWidth <= 768) { // Mobile only
        e.preventDefault();
        dropdown.classList.toggle('open');
      }
    });
  });
}
