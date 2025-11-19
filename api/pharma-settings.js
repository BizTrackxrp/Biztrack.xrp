<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pharmaceutical Settings - BizTrack</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'Inter', sans-serif;
      background: #f0f4f8;
      color: #1e293b;
      line-height: 1.6;
      min-height: 100vh;
    }

    .main-with-sidebar {
      margin-left: 280px;
      padding: 2rem 3rem;
      min-height: 100vh;
    }

    .settings-header {
      margin-bottom: 2rem;
    }

    .settings-header h1 {
      font-size: 2.5rem;
      font-weight: 800;
      color: #0f172a;
      margin-bottom: 0.5rem;
    }

    .settings-header p {
      font-size: 1.125rem;
      color: #64748b;
    }

    /* Settings Sections */
    .settings-section {
      background: white;
      border-radius: 16px;
      padding: 2rem;
      border: 2px solid #e2e8f0;
      margin-bottom: 2rem;
    }

    .settings-section-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 1.5rem;
      padding-bottom: 1rem;
      border-bottom: 2px solid #e2e8f0;
    }

    .settings-section-header h2 {
      font-size: 1.5rem;
      font-weight: 700;
      color: #0f172a;
    }

    .settings-section-header i {
      font-size: 1.5rem;
      color: #3b82f6;
    }

    .settings-section-description {
      color: #64748b;
      font-size: 0.95rem;
      margin-bottom: 1.5rem;
      line-height: 1.6;
    }

    /* Form Groups */
    .form-group {
      margin-bottom: 1.5rem;
    }

    .form-group label {
      display: block;
      font-weight: 600;
      color: #334155;
      margin-bottom: 0.5rem;
      font-size: 0.95rem;
    }

    .form-group label .required {
      color: #dc2626;
      margin-left: 0.25rem;
    }

    .form-group input,
    .form-group select,
    .form-group textarea {
      width: 100%;
      padding: 0.875rem 1rem;
      border: 2px solid #e2e8f0;
      border-radius: 12px;
      font-size: 1rem;
      font-family: 'Inter', sans-serif;
      transition: all 0.2s;
    }

    .form-group input:focus,
    .form-group select:focus,
    .form-group textarea:focus {
      outline: none;
      border-color: #3b82f6;
      box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.1);
    }

    .form-group textarea {
      min-height: 100px;
      resize: vertical;
    }

    .form-group-hint {
      font-size: 0.875rem;
      color: #64748b;
      margin-top: 0.5rem;
      display: flex;
      align-items: start;
      gap: 0.5rem;
    }

    .form-group-hint i {
      margin-top: 0.125rem;
      color: #3b82f6;
    }

    .form-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 1.5rem;
    }

    /* Compliance Badge */
    .compliance-badge {
      background: #dbeafe;
      border: 1px solid #3b82f6;
      border-radius: 12px;
      padding: 1rem 1.25rem;
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 1.5rem;
    }

    .compliance-badge i {
      color: #3b82f6;
      font-size: 1.25rem;
    }

    .compliance-badge-content h3 {
      font-size: 1rem;
      font-weight: 700;
      color: #1e40af;
      margin-bottom: 0.25rem;
    }

    .compliance-badge-content p {
      font-size: 0.875rem;
      color: #1e40af;
      margin: 0;
    }

    /* Buttons */
    .btn {
      padding: 0.875rem 1.75rem;
      border-radius: 12px;
      font-weight: 700;
      font-size: 1rem;
      cursor: pointer;
      transition: all 0.2s;
      border: none;
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
    }

    .btn-primary {
      background: linear-gradient(135deg, #3b82f6, #1e40af);
      color: white;
    }

    .btn-primary:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 20px rgba(59, 130, 246, 0.4);
    }

    .btn-secondary {
      background: white;
      color: #3b82f6;
      border: 2px solid #3b82f6;
    }

    .btn-secondary:hover {
      background: #f0f9ff;
    }

    .button-group {
      display: flex;
      gap: 1rem;
      margin-top: 2rem;
    }

    /* Message */
    .message {
      padding: 1rem 1.25rem;
      border-radius: 12px;
      margin-bottom: 1.5rem;
      display: none;
      align-items: center;
      gap: 0.75rem;
    }

    .message.show {
      display: flex;
    }

    .message.success {
      background: #d1fae5;
      color: #059669;
      border: 1px solid #6ee7b7;
    }

    .message.error {
      background: #fee2e2;
      color: #dc2626;
      border: 1px solid #fca5a5;
    }

    /* Toggle Switch */
    .toggle-switch {
      position: relative;
      display: inline-block;
      width: 50px;
      height: 28px;
    }

    .toggle-switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }

    .toggle-slider {
      position: absolute;
      cursor: pointer;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: #cbd5e1;
      transition: 0.3s;
      border-radius: 28px;
    }

    .toggle-slider:before {
      position: absolute;
      content: "";
      height: 20px;
      width: 20px;
      left: 4px;
      bottom: 4px;
      background-color: white;
      transition: 0.3s;
      border-radius: 50%;
    }

    input:checked + .toggle-slider {
      background-color: #3b82f6;
    }

    input:checked + .toggle-slider:before {
      transform: translateX(22px);
    }

    .toggle-group {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1rem 0;
      border-bottom: 1px solid #e2e8f0;
    }

    .toggle-group:last-child {
      border-bottom: none;
    }

    .toggle-label {
      flex: 1;
    }

    .toggle-label h4 {
      font-size: 1rem;
      font-weight: 600;
      color: #0f172a;
      margin-bottom: 0.25rem;
    }

    .toggle-label p {
      font-size: 0.875rem;
      color: #64748b;
      margin: 0;
    }

    @media (max-width: 768px) {
      .main-with-sidebar {
        margin-left: 0;
        padding: 1.5rem;
      }

      .form-grid {
        grid-template-columns: 1fr;
      }

      .button-group {
        flex-direction: column;
      }

      .btn {
        width: 100%;
        justify-content: center;
      }
    }
  </style>
</head>
<body>
  <!-- Pharma Sidebar (auto-loads) -->

  <!-- Main Content -->
  <div class="main-with-sidebar">
    
    <div class="settings-header">
      <h1>Pharmaceutical Settings</h1>
      <p>DSCSA compliance and company information</p>
    </div>

    <div id="message" class="message"></div>

    <!-- Company Information -->
    <div class="settings-section">
      <div class="settings-section-header">
        <i class="fas fa-building"></i>
        <h2>Company Information</h2>
      </div>
      <p class="settings-section-description">
        Basic company details for your pharmaceutical operations
      </p>

      <div class="form-group">
        <label for="companyName">Company Name <span class="required">*</span></label>
        <input type="text" id="companyName" placeholder="Acme Pharmaceuticals LLC">
      </div>

      <div class="form-grid">
        <div class="form-group">
          <label for="email">Email Address <span class="required">*</span></label>
          <input type="email" id="email" placeholder="contact@acmepharma.com">
        </div>

        <div class="form-group">
          <label for="phone">Phone Number</label>
          <input type="tel" id="phone" placeholder="(555) 123-4567">
        </div>
      </div>

      <div class="form-group">
        <label for="address">Business Address <span class="required">*</span></label>
        <input type="text" id="address" placeholder="123 Main St, Suite 100">
      </div>

      <div class="form-grid">
        <div class="form-group">
          <label for="city">City <span class="required">*</span></label>
          <input type="text" id="city" placeholder="San Francisco">
        </div>

        <div class="form-group">
          <label for="state">State <span class="required">*</span></label>
          <input type="text" id="state" placeholder="CA">
        </div>

        <div class="form-group">
          <label for="zip">ZIP Code <span class="required">*</span></label>
          <input type="text" id="zip" placeholder="94105">
        </div>
      </div>
    </div>

    <!-- DSCSA Compliance -->
    <div class="settings-section">
      <div class="settings-section-header">
        <i class="fas fa-shield-alt"></i>
        <h2>DSCSA Compliance Settings</h2>
      </div>

      <div class="compliance-badge">
        <i class="fas fa-exclamation-circle"></i>
        <div class="compliance-badge-content">
          <h3>FDA DSCSA Requirement</h3>
          <p>These fields are required for Drug Supply Chain Security Act compliance</p>
        </div>
      </div>

      <div class="form-grid">
        <div class="form-group">
          <label for="deaNumber">DEA Registration Number</label>
          <input type="text" id="deaNumber" placeholder="AB1234567">
          <div class="form-group-hint">
            <i class="fas fa-info-circle"></i>
            <span>Required for Schedule II-V controlled substances</span>
          </div>
        </div>

        <div class="form-group">
          <label for="stateLicense">State Pharmacy/Wholesale License</label>
          <input type="text" id="stateLicense" placeholder="CA-PH-12345">
          <div class="form-group-hint">
            <i class="fas fa-info-circle"></i>
            <span>Your state-issued license number</span>
          </div>
        </div>
      </div>

      <div class="form-grid">
        <div class="form-group">
          <label for="gs1Prefix">GS1 Company Prefix</label>
          <input type="text" id="gs1Prefix" placeholder="0614141">
          <div class="form-group-hint">
            <i class="fas fa-info-circle"></i>
            <span>For GTIN/SGTIN generation (7-10 digits)</span>
          </div>
        </div>

        <div class="form-group">
          <label for="gln">GLN (Global Location Number)</label>
          <input type="text" id="gln" placeholder="0614141000001">
          <div class="form-group-hint">
            <i class="fas fa-info-circle"></i>
            <span>13-digit location identifier (optional but recommended)</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Returns & Quarantine Settings -->
    <div class="settings-section">
      <div class="settings-section-header">
        <i class="fas fa-undo"></i>
        <h2>Returns & Quarantine Settings</h2>
      </div>
      <p class="settings-section-description">
        Configure default workflows for product returns and quarantine handling
      </p>

      <div class="form-group">
        <label for="returnDisposition">Default Return Disposition</label>
        <select id="returnDisposition">
          <option value="">Select default action...</option>
          <option value="quarantine">Quarantine for Inspection</option>
          <option value="destroy">Destroy Immediately</option>
          <option value="rts">Return to Sender</option>
          <option value="saleable">Mark as Saleable (requires verification)</option>
        </select>
        <div class="form-group-hint">
          <i class="fas fa-info-circle"></i>
          <span>Can be overridden on a per-return basis</span>
        </div>
      </div>

      <div class="form-group">
        <label for="quarantineDays">Auto-Quarantine Period (Days)</label>
        <input type="number" id="quarantineDays" placeholder="30" min="1" max="365">
        <div class="form-group-hint">
          <i class="fas fa-info-circle"></i>
          <span>How long to automatically hold suspicious returns before review</span>
        </div>
      </div>
    </div>

    <!-- Data Retention & EPCIS -->
    <div class="settings-section">
      <div class="settings-section-header">
        <i class="fas fa-database"></i>
        <h2>Data Retention & EPCIS</h2>
      </div>
      <p class="settings-section-description">
        Configure how long event data is retained and EPCIS export preferences
      </p>

      <div class="form-group">
        <label for="retentionYears">Event Log Retention Period (Years)</label>
        <select id="retentionYears">
          <option value="6">6 years (DSCSA minimum)</option>
          <option value="7">7 years</option>
          <option value="10">10 years</option>
          <option value="permanent">Permanent</option>
        </select>
        <div class="form-group-hint">
          <i class="fas fa-info-circle"></i>
          <span>DSCSA requires minimum 6 years of transaction history</span>
        </div>
      </div>

      <div class="form-group">
        <label for="epcisFormat">EPCIS Export Format</label>
        <select id="epcisFormat">
          <option value="xml">EPCIS 1.2 XML</option>
          <option value="json">EPCIS 2.0 JSON-LD</option>
        </select>
        <div class="form-group-hint">
          <i class="fas fa-info-circle"></i>
          <span>Format for regulatory submissions and ATP data sharing</span>
        </div>
      </div>
    </div>

    <!-- Notification Preferences -->
    <div class="settings-section">
      <div class="settings-section-header">
        <i class="fas fa-bell"></i>
        <h2>Notification Preferences</h2>
      </div>
      <p class="settings-section-description">
        Manage alerts for compliance events and system notifications
      </p>

      <div class="toggle-group">
        <div class="toggle-label">
          <h4>Quarantine Alerts</h4>
          <p>Notify when products are moved to quarantine</p>
        </div>
        <label class="toggle-switch">
          <input type="checkbox" id="notifyQuarantine" checked>
          <span class="toggle-slider"></span>
        </label>
      </div>

      <div class="toggle-group">
        <div class="toggle-label">
          <h4>Return Received Alerts</h4>
          <p>Notify when a product return is initiated</p>
        </div>
        <label class="toggle-switch">
          <input type="checkbox" id="notifyReturns" checked>
          <span class="toggle-slider"></span>
        </label>
      </div>

      <div class="toggle-group">
        <div class="toggle-label">
          <h4>ATP Verification Alerts</h4>
          <p>Notify when trading partner verification fails</p>
        </div>
        <label class="toggle-switch">
          <input type="checkbox" id="notifyATP" checked>
          <span class="toggle-slider"></span>
        </label>
      </div>

      <div class="toggle-group">
        <div class="toggle-label">
          <h4>Temperature Excursion Alerts</h4>
          <p>Notify when cold chain requirements are breached</p>
        </div>
        <label class="toggle-switch">
          <input type="checkbox" id="notifyTemp" checked>
          <span class="toggle-slider"></span>
        </label>
      </div>
    </div>

    <!-- Save Buttons -->
    <div class="button-group">
      <button class="btn btn-primary" onclick="saveSettings()">
        <i class="fas fa-save"></i>
        Save Settings
      </button>
      <button class="btn btn-secondary" onclick="resetForm()">
        <i class="fas fa-undo"></i>
        Reset
      </button>
    </div>

  </div>

  <!-- Scripts -->
  <script src="js/auth.js"></script>
  <script src="js/SI-sidebar.js"></script>
  
  <script>
    requireAuth();

    function showMessage(text, type = 'success') {
      const messageEl = document.getElementById('message');
      messageEl.className = `message ${type} show`;
      messageEl.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-circle'}"></i>
        ${text}
      `;
      
      setTimeout(() => {
        messageEl.classList.remove('show');
      }, 5000);
    }

    async function loadSettings() {
      try {
        const response = await authenticatedFetch('/api/pharma-settings');
        const data = await response.json();
        
        if (data.success && data.settings) {
          // Populate form with existing settings
          Object.keys(data.settings).forEach(key => {
            const input = document.getElementById(key);
            if (input) {
              if (input.type === 'checkbox') {
                input.checked = data.settings[key];
              } else {
                input.value = data.settings[key] || '';
              }
            }
          });
        }
      } catch (error) {
        console.error('Failed to load settings:', error);
      }
    }

    async function saveSettings() {
      const settings = {
        companyName: document.getElementById('companyName').value,
        email: document.getElementById('email').value,
        phone: document.getElementById('phone').value,
        address: document.getElementById('address').value,
        city: document.getElementById('city').value,
        state: document.getElementById('state').value,
        zip: document.getElementById('zip').value,
        deaNumber: document.getElementById('deaNumber').value,
        stateLicense: document.getElementById('stateLicense').value,
        gs1Prefix: document.getElementById('gs1Prefix').value,
        gln: document.getElementById('gln').value,
        returnDisposition: document.getElementById('returnDisposition').value,
        quarantineDays: document.getElementById('quarantineDays').value,
        retentionYears: document.getElementById('retentionYears').value,
        epcisFormat: document.getElementById('epcisFormat').value,
        notifyQuarantine: document.getElementById('notifyQuarantine').checked,
        notifyReturns: document.getElementById('notifyReturns').checked,
        notifyATP: document.getElementById('notifyATP').checked,
        notifyTemp: document.getElementById('notifyTemp').checked
      };

      try {
        const response = await authenticatedFetch('/api/pharma-settings', {
          method: 'POST',
          body: JSON.stringify(settings)
        });

        const data = await response.json();
        
        if (data.success) {
          showMessage('Settings saved successfully!', 'success');
        } else {
          throw new Error(data.error || 'Failed to save settings');
        }
      } catch (error) {
        console.error('Save error:', error);
        showMessage(error.message || 'Failed to save settings', 'error');
      }
    }

    function resetForm() {
      if (confirm('Are you sure you want to reset all changes?')) {
        loadSettings();
      }
    }

    // Load settings on page load
    loadSettings();
  </script>
</body>
</html>
