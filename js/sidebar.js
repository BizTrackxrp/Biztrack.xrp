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
        
        <!-- Use Cases (Simple Link - No Dropdown!) -->
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
  }
});
