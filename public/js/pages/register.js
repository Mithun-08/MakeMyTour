/**
 * pages/register.js — Registration page controller
 * Owner: M2
 *
 * Handles customer and provider registration, client-side input validation,
 * API submission, error display, and post-registration redirection.
 */
(function () {
  'use strict';

  var form                 = document.getElementById('register-form');
  var roleSelect           = document.getElementById('register-role');
  var nameInput            = document.getElementById('register-name');
  var emailInput           = document.getElementById('register-email');
  var mobileInput          = document.getElementById('register-mobile');
  var passwordInput        = document.getElementById('register-password');
  var confirmPasswordInput = document.getElementById('register-confirm-password');
  var cityInput            = document.getElementById('register-city');
  var stateInput           = document.getElementById('register-state');
  var submitBtn            = document.getElementById('register-submit-btn');
  var alertBox             = document.getElementById('register-alert');
  var alertMsg             = document.getElementById('register-alert-msg');

  function showAlert(msg) {
    if (!alertBox) return;
    if (alertMsg) alertMsg.textContent = msg;
    else alertBox.textContent = msg;
    alertBox.style.display = 'flex';
  }

  function hideAlert() {
    if (alertBox) alertBox.style.display = 'none';
  }

  function checkExistingSession() {
    if (window.Auth && typeof window.Auth.getUser === 'function') {
      window.Auth.getUser().then(function (user) {
        if (user && user.role) {
          window.location.href = '/' + window.Auth.dashboardFor(user.role);
        }
      }).catch(function () {});
    }
  }

  function checkUrlParams() {
    try {
      var params = new URLSearchParams(window.location.search);
      var role = params.get('role');
      if (role && roleSelect) {
        var upper = role.toUpperCase();
        if (upper === 'PROVIDER' || upper === 'CUSTOMER') {
          roleSelect.value = upper;
        }
      }
    } catch (e) {}
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

    var role = roleSelect ? roleSelect.value : 'CUSTOMER';
    var name = nameInput ? nameInput.value.trim() : '';
    var email = emailInput ? emailInput.value.trim() : '';
    var mobile = mobileInput ? mobileInput.value.trim() : '';
    var password = passwordInput ? passwordInput.value : '';
    var confirmPassword = confirmPasswordInput ? confirmPasswordInput.value : '';
    var city = cityInput ? cityInput.value.trim() : '';
    var state = stateInput ? stateInput.value.trim() : '';

    var errors = {};
    if (!name) {
      errors.name = 'Full name is required';
    }
    if (!email) {
      errors.email = 'Email address is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = 'Please enter a valid email address';
    }
    if (!mobile) {
      errors.mobile = 'Mobile number is required';
    } else if (!/^\d{10}$/.test(mobile)) {
      errors.mobile = 'Mobile number must be exactly 10 digits';
    }
    if (!password) {
      errors.password = 'Password is required';
    } else if (password.length < 8) {
      errors.password = 'Password must be at least 8 characters long';
    }
    if (password && confirmPassword !== password) {
      errors.confirm_password = 'Passwords do not match';
    }

    if (Object.keys(errors).length > 0) {
      if (window.UI && typeof window.UI.showErrors === 'function') {
        window.UI.showErrors(form, errors);
      }
      return;
    }

    var payload = {
      name: name,
      email: email,
      password: password,
      mobile: mobile,
      role: role
    };
    if (city) payload.city = city;
    if (state) payload.state = state;

    if (window.UI && typeof window.UI.setLoading === 'function') {
      window.UI.setLoading(submitBtn, true);
    } else if (submitBtn) {
      submitBtn.disabled = true;
    }

    window.Auth.register(payload)
      .then(function () {
        if (role === 'CUSTOMER') {
          // Attempt automatic login for ACTIVE customer account
          return window.Auth.login(email, password)
            .then(function (user) {
              if (window.UI && typeof window.UI.toast === 'function') {
                window.UI.toast('Account created! Welcome to MakeMyTour.', 'success');
              }
              window.location.href = '/' + window.Auth.dashboardFor(user.role);
            })
            .catch(function () {
              // Fallback if auto-login rejected
              window.location.href = '/login.html?registered=1';
            });
        } else {
          // PROVIDER account is PENDING approval
          if (window.UI && typeof window.UI.toast === 'function') {
            window.UI.toast('Registration submitted! Your provider account is pending approval.', 'info');
          }
          window.location.href = '/login.html?pending=1';
        }
      })
      .catch(function (err) {
        if (window.UI && typeof window.UI.setLoading === 'function') {
          window.UI.setLoading(submitBtn, false);
        } else if (submitBtn) {
          submitBtn.disabled = false;
        }

        if (err && err.details) {
          if (window.UI && typeof window.UI.showErrors === 'function') {
            window.UI.showErrors(form, err.details);
          }
        }

        var msg = (err && err.message) || 'Registration failed. Please try again.';
        if (err && err.code === 'CONFLICT') {
          msg = 'An account with this email already exists. Please log in or use a different email.';
        } else if (err && err.code === 'VALIDATION_ERROR') {
          msg = 'Please correct the highlighted errors and try again.';
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
