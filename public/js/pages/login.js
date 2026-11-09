/**
 * pages/login.js — Login page controller
 * Owner: M2
 *
 * Handles credential submission, field-level error handling,
 * loading states, error alerts, and role/return-URL navigation.
 */
(function () {
  'use strict';

  var form         = document.getElementById('login-form');
  var emailInput   = document.getElementById('login-email');
  var passwordInput= document.getElementById('login-password');
  var submitBtn    = document.getElementById('login-submit-btn');
  var alertBox     = document.getElementById('login-alert');
  var alertMsg     = document.getElementById('login-alert-msg');
  var infoBox      = document.getElementById('login-info');
  var infoMsg      = document.getElementById('login-info-msg');

  function showAlert(msg) {
    if (!alertBox) return;
    if (alertMsg) alertMsg.textContent = msg;
    else alertBox.textContent = msg;
    alertBox.style.display = 'flex';
  }

  function hideAlert() {
    if (alertBox) alertBox.style.display = 'none';
  }

  function showInfo(msg) {
    if (!infoBox) return;
    if (infoMsg) infoMsg.textContent = msg;
    else infoBox.textContent = msg;
    infoBox.style.display = 'flex';
  }

  function checkUrlParams() {
    try {
      var params = new URLSearchParams(window.location.search);
      if (params.get('registered') === '1' || params.get('registered') === 'true') {
        showInfo('Registration successful! Please log in with your credentials.');
      } else if (params.get('pending') === '1' || params.get('pending') === 'true') {
        showInfo('Your provider registration was received and is pending admin approval.');
      }
    } catch (e) {}
  }

  // If already authenticated, redirect to appropriate dashboard
  function checkExistingSession() {
    if (window.Auth && typeof window.Auth.getUser === 'function') {
      window.Auth.getUser().then(function (user) {
        if (user && user.role) {
          window.location.href = '/' + window.Auth.dashboardFor(user.role);
        }
      }).catch(function () {
        // Proceed with login page
      });
    }
  }

  function handleSubmit(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();

    if (submitBtn && submitBtn.getAttribute('aria-busy') === 'true') {
      return;
    }

    hideAlert();
    if (window.UI && typeof window.UI.clearErrors === 'function') {
      window.UI.clearErrors(form);
    }

    var email = emailInput ? emailInput.value.trim() : '';
    var password = passwordInput ? passwordInput.value : '';

    var errors = {};
    if (!email) {
      errors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = 'Please enter a valid email address';
    }
    if (!password) {
      errors.password = 'Password is required';
    }

    if (Object.keys(errors).length > 0) {
      if (window.UI && typeof window.UI.showErrors === 'function') {
        window.UI.showErrors(form, errors);
      }
      return;
    }

    if (window.UI && typeof window.UI.setLoading === 'function') {
      window.UI.setLoading(submitBtn, true);
    } else if (submitBtn) {
      submitBtn.disabled = true;
    }

    window.Auth.login(email, password)
      .then(function (user) {
        if (window.UI && typeof window.UI.toast === 'function') {
          window.UI.toast('Login successful! Redirecting…', 'success');
        }

        var redirectUrl = '/' + window.Auth.dashboardFor(user.role);
        try {
          var params = new URLSearchParams(window.location.search);
          var next = params.get('next');
          if (next) {
            var safe = window.Auth.safeNext(next);
            if (safe && safe !== '/login.html' && safe !== '/register.html' && safe !== '/index.html' && safe !== '/') {
              redirectUrl = safe;
            }
          }
        } catch (err) {}

        window.location.href = redirectUrl;
      })
      .catch(function (err) {
        if (window.UI && typeof window.UI.setLoading === 'function') {
          window.UI.setLoading(submitBtn, false);
        } else if (submitBtn) {
          submitBtn.disabled = false;
        }

        if (err && err.status === 400 && err.details) {
          if (window.UI && typeof window.UI.showErrors === 'function') {
            window.UI.showErrors(form, err.details);
          }
        }

        var msg = (err && err.message) || 'Invalid email or password';
        if (err && err.code === 'INVALID_CREDENTIALS') {
          msg = 'Invalid email or password. Please try again.';
        } else if (err && err.code === 'ACCOUNT_PENDING') {
          msg = err.message || 'Your account is pending approval by an administrator.';
        } else if (err && err.code === 'ACCOUNT_BLOCKED') {
          msg = err.message || 'Your account has been blocked. Please contact support.';
        } else if (err && (err.code === 'ACCOUNT_INACTIVE' || err.code === 'ACCOUNT_REJECTED')) {
          msg = err.message || 'Your account is not active. Please contact support.';
        } else if (err && err.code === 'NETWORK_ERROR') {
          msg = 'Could not reach server. Please check your connection and try again.';
        }

        showAlert(msg);
      });
  }

  function init() {
    checkExistingSession();
    checkUrlParams();
    if (form) {
      form.addEventListener('submit', handleSubmit);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
