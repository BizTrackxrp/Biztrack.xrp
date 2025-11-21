// js/password-reset.js
// Shared password reset functionality for both general and pharma settings pages

(function() {
  'use strict';

  // ==========================================
  // PASSWORD RESET FORM HANDLER
  // ==========================================
  
  function initPasswordReset() {
    const form = document.getElementById('password-reset-form');
    const currentPasswordInput = document.getElementById('current-password');
    const newPasswordInput = document.getElementById('new-password');
    const confirmPasswordInput = document.getElementById('confirm-password');
    const submitButton = document.getElementById('password-submit-btn');
    const messageDiv = document.getElementById('password-message');

    if (!form) {
      console.log('[PASSWORD-RESET] Form not found on this page');
      return;
    }

    console.log('[PASSWORD-RESET] Initializing password reset functionality');

    // Initialize password validator (requires password-validator.js)
    if (window.PasswordValidator) {
      PasswordValidator.initValidation('new-password', 'password-feedback');
      PasswordValidator.initPasswordMatch('new-password', 'confirm-password', 'password-match');
    } else {
      console.warn('[PASSWORD-RESET] PasswordValidator not loaded - validation UI disabled');
    }

    // Handle form submission
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const currentPassword = currentPasswordInput.value.trim();
      const newPassword = newPasswordInput.value.trim();
      const confirmPassword = confirmPasswordInput.value.trim();

      // Clear previous messages
      clearMessage();

      // Validation
      if (!currentPassword || !newPassword || !confirmPassword) {
        showMessage('All fields are required', 'error');
        return;
      }

      // Use password validator if available
      if (window.PasswordValidator) {
        const validation = PasswordValidator.validate(newPassword);
        
        if (!validation.valid) {
          showMessage(validation.errors.join('. '), 'error');
          return;
        }
      } else {
        // Fallback validation
        if (newPassword.length < 8) {
          showMessage('New password must be at least 8 characters', 'error');
          return;
        }
      }

      if (newPassword !== confirmPassword) {
        showMessage('New passwords do not match', 'error');
        return;
      }

      if (newPassword === currentPassword) {
        showMessage('New password must be different from current password', 'error');
        return;
      }

      // Disable button and show loading
      submitButton.disabled = true;
      submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Changing Password...';

      try {
        const token = localStorage.getItem('biztrack-auth-token');
        
        if (!token) {
          showMessage('You must be logged in to change your password', 'error');
          window.location.href = '/login.html';
          return;
        }

        console.log('[PASSWORD-RESET] Sending password change request...');

        const response = await fetch('/api/change-password', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            currentPassword: currentPassword,
            newPassword: newPassword
          })
        });

        const data = await response.json();

        if (response.ok && data.success) {
          console.log('[PASSWORD-RESET] ✅ Password changed successfully');
          showMessage('Password changed successfully! You will be logged out in 3 seconds...', 'success');
          
          // Clear form
          form.reset();
          
          // Log out user after 3 seconds (force re-login with new password)
          setTimeout(() => {
            localStorage.removeItem('biztrack-auth-token');
            window.location.href = '/login.html?message=password_changed';
          }, 3000);

        } else {
          // Handle errors
          console.error('[PASSWORD-RESET] ❌ Error:', data.error);
          
          if (response.status === 401) {
            showMessage('Current password is incorrect', 'error');
          } else if (response.status === 400) {
            showMessage(data.error || 'Invalid password format', 'error');
          } else {
            showMessage(data.error || 'Failed to change password. Please try again.', 'error');
          }
        }

      } catch (error) {
        console.error('[PASSWORD-RESET] ❌ Network error:', error);
        showMessage('Network error. Please check your connection and try again.', 'error');
      } finally {
        // Re-enable button
        submitButton.disabled = false;
        submitButton.innerHTML = '<i class="fas fa-key"></i> Change Password';
      }
    });
  }

  // ==========================================
  // MESSAGE DISPLAY HELPERS
  // ==========================================

  function showMessage(message, type) {
    const messageDiv = document.getElementById('password-message');
    
    if (!messageDiv) {
      alert(message);
      return;
    }

    messageDiv.textContent = message;
    messageDiv.className = `message message-${type}`;
    messageDiv.style.display = 'block';

    // Auto-hide success messages after 5 seconds
    if (type === 'success') {
      setTimeout(() => {
        clearMessage();
      }, 5000);
    }
  }

  function clearMessage() {
    const messageDiv = document.getElementById('password-message');
    if (messageDiv) {
      messageDiv.textContent = '';
      messageDiv.style.display = 'none';
      messageDiv.className = '';
    }
  }

  // ==========================================
  // INITIALIZE ON PAGE LOAD
  // ==========================================

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPasswordReset);
  } else {
    initPasswordReset();
  }

})();
