// js/sessions.js - Session management functionality
(function() {
  'use strict';

  const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:3000' : '';

  // ==========================================
  // LOAD AND DISPLAY SESSIONS
  // ==========================================
  async function loadSessions(containerId) {
    const container = document.getElementById(containerId);
    
    if (!container) {
      console.error('[SESSIONS] Container not found:', containerId);
      return;
    }

    // Show loading state
    container.innerHTML = `
      <div style="text-align: center; padding: 2rem; color: #64748B;">
        <i class="fas fa-spinner fa-spin" style="font-size: 2rem; margin-bottom: 1rem;"></i>
        <p>Loading active sessions...</p>
      </div>
    `;

    try {
      const token = localStorage.getItem('biztrack-auth-token');
      
      if (!token) {
        container.innerHTML = `
          <div style="text-align: center; padding: 2rem; color: #ef4444;">
            <i class="fas fa-exclamation-circle" style="font-size: 2rem; margin-bottom: 1rem;"></i>
            <p>Please log in to view sessions</p>
          </div>
        `;
        return;
      }

      const response = await fetch(`${API_BASE}/api/list-sessions`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to load sessions');
      }

      const sessions = data.sessions;

      if (sessions.length === 0) {
        container.innerHTML = `
          <div style="text-align: center; padding: 2rem; color: #64748B;">
            <i class="fas fa-info-circle" style="font-size: 2rem; margin-bottom: 1rem;"></i>
            <p>No active sessions found</p>
          </div>
        `;
        return;
      }

      // Render sessions
      container.innerHTML = sessions.map(session => renderSession(session)).join('');

      console.log('[SESSIONS] Loaded', sessions.length, 'sessions');

    } catch (error) {
      console.error('[SESSIONS] Error loading sessions:', error);
      container.innerHTML = `
        <div style="text-align: center; padding: 2rem; color: #ef4444;">
          <i class="fas fa-exclamation-circle" style="font-size: 2rem; margin-bottom: 1rem;"></i>
          <p>Failed to load sessions</p>
          <p style="font-size: 0.875rem; margin-top: 0.5rem;">${error.message}</p>
        </div>
      `;
    }
  }

  // ==========================================
  // RENDER SINGLE SESSION CARD
  // ==========================================
  function renderSession(session) {
    const isCurrentSession = session.isCurrent;
    const lastActive = formatTimestamp(session.lastActive);
    const createdAt = formatTimestamp(session.createdAt);

    return `
      <div class="session-card ${isCurrentSession ? 'current-session' : ''}" data-session-id="${session.id}">
        <div class="session-info">
          <div class="session-device">
            <i class="fas fa-${getDeviceIcon(session.deviceName)}"></i>
            <div>
              <strong>${session.deviceName}</strong>
              ${isCurrentSession ? '<span class="current-badge">Current Device</span>' : ''}
            </div>
          </div>
          <div class="session-details">
            <div class="session-detail">
              <i class="fas fa-map-marker-alt"></i>
              <span>${session.ipAddress}</span>
            </div>
            <div class="session-detail">
              <i class="fas fa-clock"></i>
              <span>Last active: ${lastActive}</span>
            </div>
            <div class="session-detail">
              <i class="fas fa-calendar"></i>
              <span>Signed in: ${createdAt}</span>
            </div>
          </div>
        </div>
        <div class="session-actions">
          ${isCurrentSession 
            ? '<button class="session-btn current-btn" disabled><i class="fas fa-check-circle"></i> This Device</button>'
            : `<button class="session-btn revoke-btn" onclick="window.SessionManager.revokeSession(${session.id})"><i class="fas fa-sign-out-alt"></i> Sign Out</button>`
          }
        </div>
      </div>
    `;
  }

  // ==========================================
  // REVOKE SPECIFIC SESSION
  // ==========================================
  async function revokeSession(sessionId) {
    if (!confirm('Are you sure you want to sign out this device?')) {
      return;
    }

    try {
      const token = localStorage.getItem('biztrack-auth-token');
      
      const response = await fetch(`${API_BASE}/api/revoke-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ sessionId })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to sign out session');
      }

      console.log('[SESSIONS] Session revoked:', sessionId);
      
      // Remove the session card from UI
      const sessionCard = document.querySelector(`[data-session-id="${sessionId}"]`);
      if (sessionCard) {
        sessionCard.style.opacity = '0';
        sessionCard.style.transform = 'scale(0.95)';
        setTimeout(() => sessionCard.remove(), 300);
      }

      showSessionMessage('Device signed out successfully', 'success');

    } catch (error) {
      console.error('[SESSIONS] Error revoking session:', error);
      showSessionMessage(error.message, 'error');
    }
  }

  // ==========================================
  // REVOKE ALL OTHER SESSIONS
  // ==========================================
  async function revokeAllSessions(containerId) {
    if (!confirm('Sign out all other devices? You will remain signed in on this device.')) {
      return;
    }

    try {
      const token = localStorage.getItem('biztrack-auth-token');
      
      const response = await fetch(`${API_BASE}/api/revoke-all-sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to sign out sessions');
      }

      console.log('[SESSIONS] All other sessions revoked');
      
      showSessionMessage(`${data.revokedCount} device(s) signed out successfully`, 'success');

      // Reload sessions
      setTimeout(() => loadSessions(containerId), 1000);

    } catch (error) {
      console.error('[SESSIONS] Error revoking all sessions:', error);
      showSessionMessage(error.message, 'error');
    }
  }

  // ==========================================
  // HELPER FUNCTIONS
  // ==========================================

  function getDeviceIcon(deviceName) {
    if (!deviceName) return 'laptop';
    const name = deviceName.toLowerCase();
    
    if (name.includes('iphone') || name.includes('android')) return 'mobile-alt';
    if (name.includes('ipad')) return 'tablet-alt';
    if (name.includes('mac') || name.includes('windows') || name.includes('linux')) return 'laptop';
    return 'desktop';
  }

  function formatTimestamp(timestamp) {
    if (!timestamp) return 'Unknown';
    
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined 
    });
  }

  function showSessionMessage(message, type) {
    const messageDiv = document.getElementById('session-message');
    if (!messageDiv) {
      alert(message);
      return;
    }

    messageDiv.className = `message message-${type} show`;
    messageDiv.innerHTML = `
      <i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-circle'}"></i>
      ${message}
    `;

    setTimeout(() => {
      messageDiv.classList.remove('show');
    }, 5000);
  }

  // ==========================================
  // EXPORT TO GLOBAL SCOPE
  // ==========================================
  window.SessionManager = {
    loadSessions: loadSessions,
    revokeSession: revokeSession,
    revokeAllSessions: revokeAllSessions
  };

  console.log('[SESSIONS] ✅ Session manager loaded');

})();
