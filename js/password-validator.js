// js/password-validator.js
// Comprehensive password validation with real-time feedback
// Used in: Registration, Password Reset, Settings

(function() {
  'use strict';

  // ==========================================
  // PASSWORD VALIDATION RULES
  // ==========================================

  const PASSWORD_RULES = {
    minLength: 8,
    requireUppercase: true,
    requireLowercase: true,
    requireNumber: true,
    requireSpecial: true,
    allowedSpecialChars: '!@#$%^&*-_=+',
    disallowSpaces: true
  };

  // ==========================================
  // VALIDATION FUNCTIONS
  // ==========================================

  /**
   * Validate password against all rules
   * @param {string} password - Password to validate
   * @returns {object} - { valid: boolean, errors: string[], strength: number }
   */
  function validatePassword(password) {
    const errors = [];
    let strength = 0;

    // Check length
    if (password.length < PASSWORD_RULES.minLength) {
      errors.push(`Must be at least ${PASSWORD_RULES.minLength} characters`);
    } else {
      strength += 20;
      if (password.length >= 12) strength += 10;
      if (password.length >= 16) strength += 10;
    }

    // Check uppercase
    if (PASSWORD_RULES.requireUppercase && !/[A-Z]/.test(password)) {
      errors.push('Must contain at least 1 uppercase letter');
    } else {
      strength += 20;
    }

    // Check lowercase
    if (PASSWORD_RULES.requireLowercase && !/[a-z]/.test(password)) {
      errors.push('Must contain at least 1 lowercase letter');
    } else {
      strength += 20;
    }

    // Check number
    if (PASSWORD_RULES.requireNumber && !/[0-9]/.test(password)) {
      errors.push('Must contain at least 1 number');
    } else {
      strength += 20;
    }

    // Check special character
    const specialCharRegex = new RegExp(`[${PASSWORD_RULES.allowedSpecialChars.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')}]`);
    if (PASSWORD_RULES.requireSpecial && !specialCharRegex.test(password)) {
      errors.push(`Must contain at least 1 special character (${PASSWORD_RULES.allowedSpecialChars})`);
    } else {
      strength += 20;
    }

    // Check for spaces
    if (PASSWORD_RULES.disallowSpaces && /\s/.test(password)) {
      errors.push('Cannot contain spaces');
    }

    // Check for invalid special characters
    const invalidChars = password.replace(/[a-zA-Z0-9]/g, '').replace(new RegExp(`[${PASSWORD_RULES.allowedSpecialChars.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')}]`, 'g'), '');
    if (invalidChars.length > 0) {
      errors.push(`Invalid characters: ${invalidChars.split('').join(', ')}`);
    }

    // Bonus strength for variety
    const hasUpperAndLower = /[A-Z]/.test(password) && /[a-z]/.test(password);
    const hasLettersAndNumbers = /[a-zA-Z]/.test(password) && /[0-9]/.test(password);
    const hasSpecialChars = specialCharRegex.test(password);
    
    if (hasUpperAndLower && hasLettersAndNumbers && hasSpecialChars) {
      strength = Math.min(100, strength + 10);
    }

    return {
      valid: errors.length === 0,
      errors: errors,
      strength: Math.min(100, strength)
    };
  }

  /**
   * Get strength label and color
   * @param {number} strength - Strength score (0-100)
   * @returns {object} - { label: string, color: string }
   */
  function getStrengthInfo(strength) {
    if (strength < 40) {
      return { label: 'Weak', color: '#ef4444' };
    } else if (strength < 70) {
      return { label: 'Fair', color: '#f59e0b' };
    } else if (strength < 90) {
      return { label: 'Good', color: '#10b981' };
    } else {
      return { label: 'Strong', color: '#059669' };
    }
  }

  // ==========================================
  // UI FEEDBACK FUNCTIONS
  // ==========================================

  /**
   * Initialize real-time password validation on an input field
   * @param {string} inputId - ID of password input field
   * @param {string} feedbackContainerId - ID of container for feedback UI
   */
  function initPasswordValidation(inputId, feedbackContainerId) {
    const input = document.getElementById(inputId);
    const feedbackContainer = document.getElementById(feedbackContainerId);

    if (!input) {
      console.error(`[PASSWORD-VALIDATOR] Input field #${inputId} not found`);
      return;
    }

    console.log(`[PASSWORD-VALIDATOR] Initializing validation for #${inputId}`);

    // Create feedback UI if container exists
    if (feedbackContainer) {
      feedbackContainer.innerHTML = `
        <div class="password-strength-container" style="margin-top: 0.5rem;">
          <div class="strength-bar" style="height: 4px; background: #e2e8f0; border-radius: 2px; overflow: hidden; margin-bottom: 0.5rem;">
            <div class="strength-fill" style="height: 100%; width: 0%; background: #64748b; transition: all 0.3s;"></div>
          </div>
          <div class="strength-label" style="font-size: 0.875rem; font-weight: 600; color: #64748b; margin-bottom: 0.5rem;"></div>
          <div class="password-requirements" style="font-size: 0.875rem; color: #64748b;">
            <div class="requirement" data-rule="length">
              <span class="icon">○</span> At least ${PASSWORD_RULES.minLength} characters
            </div>
            <div class="requirement" data-rule="uppercase">
              <span class="icon">○</span> One uppercase letter
            </div>
            <div class="requirement" data-rule="lowercase">
              <span class="icon">○</span> One lowercase letter
            </div>
            <div class="requirement" data-rule="number">
              <span class="icon">○</span> One number
            </div>
            <div class="requirement" data-rule="special">
              <span class="icon">○</span> One special character (${PASSWORD_RULES.allowedSpecialChars})
            </div>
          </div>
        </div>
      `;
    }

    // Real-time validation on input
    input.addEventListener('input', () => {
      const password = input.value;
      
      if (password.length === 0) {
        resetFeedbackUI(feedbackContainer);
        return;
      }

      const result = validatePassword(password);
      updateFeedbackUI(feedbackContainer, password, result);
    });

    // Also validate on blur
    input.addEventListener('blur', () => {
      const password = input.value;
      if (password.length > 0) {
        const result = validatePassword(password);
        // Store validation result on input for form submission
        input.dataset.passwordValid = result.valid;
      }
    });
  }

  /**
   * Update feedback UI with validation results
   */
  function updateFeedbackUI(container, password, result) {
    if (!container) return;

    const strengthFill = container.querySelector('.strength-fill');
    const strengthLabel = container.querySelector('.strength-label');
    const requirements = container.querySelectorAll('.requirement');

    // Update strength bar
    if (strengthFill) {
      const strengthInfo = getStrengthInfo(result.strength);
      strengthFill.style.width = `${result.strength}%`;
      strengthFill.style.background = strengthInfo.color;
    }

    // Update strength label
    if (strengthLabel) {
      const strengthInfo = getStrengthInfo(result.strength);
      strengthLabel.textContent = `Password Strength: ${strengthInfo.label}`;
      strengthLabel.style.color = strengthInfo.color;
    }

    // Update requirements checklist
    requirements.forEach(req => {
      const rule = req.dataset.rule;
      const icon = req.querySelector('.icon');
      let passed = false;

      switch(rule) {
        case 'length':
          passed = password.length >= PASSWORD_RULES.minLength;
          break;
        case 'uppercase':
          passed = /[A-Z]/.test(password);
          break;
        case 'lowercase':
          passed = /[a-z]/.test(password);
          break;
        case 'number':
          passed = /[0-9]/.test(password);
          break;
        case 'special':
          const specialCharRegex = new RegExp(`[${PASSWORD_RULES.allowedSpecialChars.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')}]`);
          passed = specialCharRegex.test(password);
          break;
      }

      if (passed) {
        icon.textContent = '✓';
        icon.style.color = '#10b981';
        req.style.color = '#10b981';
      } else {
        icon.textContent = '○';
        icon.style.color = '#64748b';
        req.style.color = '#64748b';
      }
    });
  }

  /**
   * Reset feedback UI to initial state
   */
  function resetFeedbackUI(container) {
    if (!container) return;

    const strengthFill = container.querySelector('.strength-fill');
    const strengthLabel = container.querySelector('.strength-label');
    const requirements = container.querySelectorAll('.requirement');

    if (strengthFill) {
      strengthFill.style.width = '0%';
    }

    if (strengthLabel) {
      strengthLabel.textContent = '';
    }

    requirements.forEach(req => {
      const icon = req.querySelector('.icon');
      icon.textContent = '○';
      icon.style.color = '#64748b';
      req.style.color = '#64748b';
    });
  }

  /**
   * Initialize confirm password matching feedback
   * @param {string} passwordInputId - ID of password input
   * @param {string} confirmInputId - ID of confirm password input
   * @param {string} feedbackId - ID of feedback element
   */
  function initPasswordMatch(passwordInputId, confirmInputId, feedbackId) {
    const passwordInput = document.getElementById(passwordInputId);
    const confirmInput = document.getElementById(confirmInputId);
    const feedback = document.getElementById(feedbackId);

    if (!passwordInput || !confirmInput) {
      console.error('[PASSWORD-VALIDATOR] Password match inputs not found');
      return;
    }

    console.log('[PASSWORD-VALIDATOR] Initializing password match validation');

    const checkMatch = () => {
      if (confirmInput.value.length === 0) {
        if (feedback) {
          feedback.textContent = '';
        }
        return;
      }

      const match = confirmInput.value === passwordInput.value;
      
      if (feedback) {
        if (match) {
          feedback.textContent = '✓ Passwords match';
          feedback.style.color = '#10b981';
        } else {
          feedback.textContent = '✗ Passwords do not match';
          feedback.style.color = '#ef4444';
        }
      }

      // Store match result on input for form submission
      confirmInput.dataset.passwordMatch = match;
    };

    confirmInput.addEventListener('input', checkMatch);
    passwordInput.addEventListener('input', checkMatch);
  }

  // ==========================================
  // EXPORT TO GLOBAL SCOPE
  // ==========================================

  window.PasswordValidator = {
    validate: validatePassword,
    initValidation: initPasswordValidation,
    initPasswordMatch: initPasswordMatch,
    rules: PASSWORD_RULES
  };

  console.log('[PASSWORD-VALIDATOR] ✅ Password validator loaded');

})();
