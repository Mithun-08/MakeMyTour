/**
 * customer-dashboard.js — Customer Dashboard Page Controller
 * Owner: M2 takeover
 * Phase 3, Task 8: Data Loading, Summary Metrics, Statuses, and Upcoming Trips
 *
 * Scope:
 *  - Enforces authenticated CUSTOMER role via Auth.requireRole(['CUSTOMER']).
 *  - Fetches dashboard reporting data from GET /api/customer/reports.
 *  - Renders personalized welcome greeting using customer's available name.
 *  - Renders Summary KPI cards: Total Bookings and Total Spent.
 *  - Renders Bookings Status Summary breakdown (PENDING, CONFIRMED, COMPLETED, CANCELLED).
 *  - Renders Upcoming Trips cards or displays empty state (#upcoming-empty).
 *  - Manages UI states: Loading (#dashboard-loading), Error (#dashboard-error), and Content (#dashboard-content).
 *  - Implements in-page retry without full page reload.
 *  - Protects against stale responses via activeRequestId.
 *  - Safely escapes all API-provided text and uses UI formatting utilities.
 *  - Exported as window.CustomerDashboard for automated testability.
 */

(function () {
  'use strict';

  /* ── State ─────────────────────────────────────────────────── */
  var state = {
    user: null,
    reports: null,
    isLoading: false,
    _eventsAttached: false
  };

  /* ── DOM References ────────────────────────────────────────── */
  var dom = {};

  function refreshDom() {
    // UI State Containers
    dom.loadingEl = document.getElementById('dashboard-loading');
    dom.errorEl = document.getElementById('dashboard-error');
    dom.errorMsgEl = document.getElementById('dashboard-error-msg');
    dom.btnRetry = document.getElementById('btn-retry-dashboard');
    dom.contentEl = document.getElementById('dashboard-content');

    // Welcome Section
    dom.welcomeHeading = document.getElementById('customer-welcome-heading');
    dom.welcomeSub = document.getElementById('customer-welcome-sub');

    // KPI Summary Metrics
    dom.kpiTotalBookings = document.getElementById('kpi-total-bookings');
    dom.kpiTotalSpent = document.getElementById('kpi-total-spent');

    // Status Summary Counters
    dom.statusPending = document.getElementById('status-count-pending');
    dom.statusConfirmed = document.getElementById('status-count-confirmed');
    dom.statusCompleted = document.getElementById('status-count-completed');
    dom.statusCancelled = document.getElementById('status-count-cancelled');

    // Upcoming Trips
    dom.upcomingCount = document.getElementById('upcoming-trips-count');
    dom.upcomingContainer = document.getElementById('upcoming-trips-container');
    dom.upcomingEmpty = document.getElementById('upcoming-empty');
  }

  /* ── Helpers ───────────────────────────────────────────────── */

  function escapeHtml(str) {
    if (window.UI && typeof window.UI.escapeHtml === 'function') {
      return window.UI.escapeHtml(str);
    }
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatMoney(amount) {
    if (window.UI && typeof window.UI.money === 'function') {
      return window.UI.money(amount);
    }
    var n = Number(amount);
    return isNaN(n) ? '₹—' : '₹' + n.toFixed(2);
  }

  function formatDate(dateStr) {
    if (window.UI && typeof window.UI.date === 'function') {
      return window.UI.date(dateStr);
    }
    return dateStr ? String(dateStr).slice(0, 10) : '—';
  }

  function renderStatusBadge(status) {
    if (window.UI && typeof window.UI.statusBadge === 'function') {
      return window.UI.statusBadge(status).outerHTML;
    }
    var s = escapeHtml(status || 'UNKNOWN');
    var lower = s.toLowerCase();
    return '<span class="badge badge-' + lower + '">' + s + '</span>';
  }

  /* ── UI State Toggles ──────────────────────────────────────── */

  function showLoading() {
    refreshDom();
    if (dom.loadingEl) dom.loadingEl.hidden = false;
    if (dom.errorEl) dom.errorEl.hidden = true;
    if (dom.contentEl) dom.contentEl.hidden = true;
  }

  function showError(message) {
    refreshDom();
    if (dom.loadingEl) dom.loadingEl.hidden = true;
    if (dom.contentEl) dom.contentEl.hidden = true;
    if (dom.errorEl) {
      dom.errorEl.hidden = false;
      if (dom.errorMsgEl) {
        dom.errorMsgEl.textContent = message || 'Failed to load dashboard data. Please try again.';
      }
    }

    if (window.UI && typeof window.UI.toast === 'function' && message) {
      window.UI.toast(message, 'error');
    }
  }

  function showContent() {
    refreshDom();
    if (dom.loadingEl) dom.loadingEl.hidden = true;
    if (dom.errorEl) dom.errorEl.hidden = true;
    if (dom.contentEl) dom.contentEl.hidden = false;
  }

  /* ── Core Rendering ────────────────────────────────────────── */

  /**
   * Renders the personalized greeting in the welcome section.
   *
   * @param {Object} [user] Authenticated user object
   */
  function renderWelcome(user) {
    refreshDom();
    if (!dom.welcomeHeading) return;

    var name = user && (user.name || user.email);
    if (name && typeof name === 'string' && name.trim()) {
      dom.welcomeHeading.textContent = 'Welcome back, ' + name.trim() + '!';
    } else {
      dom.welcomeHeading.textContent = 'Welcome back!';
    }
  }

  /**
   * Renders the summary KPI metrics (Total Bookings & Total Spent).
   *
   * @param {Object} reportData Data from GET /api/customer/reports
   */
  function renderKpi(reportData) {
    refreshDom();
    var totalBookings = Number(reportData && reportData.total_bookings) || 0;
    var totalSpent = Number(reportData && reportData.total_spent) || 0;

    if (dom.kpiTotalBookings) {
      dom.kpiTotalBookings.textContent = String(totalBookings);
    }
    if (dom.kpiTotalSpent) {
      dom.kpiTotalSpent.textContent = formatMoney(totalSpent);
    }
  }

  /**
   * Renders the booking counts by status (PENDING, CONFIRMED, COMPLETED, CANCELLED).
   * Missing statuses default cleanly to 0.
   *
   * @param {Array} [byStatusArray] Array of { status, count } objects
   */
  function renderStatusSummary(byStatusArray) {
    refreshDom();

    var statusMap = {
      PENDING: 0,
      CONFIRMED: 0,
      COMPLETED: 0,
      CANCELLED: 0
    };

    if (Array.isArray(byStatusArray)) {
      byStatusArray.forEach(function (item) {
        if (item && item.status) {
          var st = String(item.status).toUpperCase();
          if (statusMap[st] !== undefined) {
            statusMap[st] = Number(item.count) || 0;
          }
        }
      });
    }

    if (dom.statusPending) dom.statusPending.textContent = String(statusMap.PENDING);
    if (dom.statusConfirmed) dom.statusConfirmed.textContent = String(statusMap.CONFIRMED);
    if (dom.statusCompleted) dom.statusCompleted.textContent = String(statusMap.COMPLETED);
    if (dom.statusCancelled) dom.statusCancelled.textContent = String(statusMap.CANCELLED);
  }

  /**
   * Renders upcoming trip cards or displays the empty state block.
   *
   * @param {Array} [upcomingTrips] Array of upcoming trip records
   */
  function renderUpcomingTrips(upcomingTrips) {
    refreshDom();

    var trips = Array.isArray(upcomingTrips) ? upcomingTrips : [];
    var count = trips.length;

    if (dom.upcomingCount) {
      dom.upcomingCount.textContent = count + ' upcoming tour' + (count === 1 ? '' : 's');
    }

    if (!dom.upcomingContainer) return;

    if (count === 0) {
      dom.upcomingContainer.innerHTML = '';
      dom.upcomingContainer.hidden = true;
      if (dom.upcomingEmpty) dom.upcomingEmpty.hidden = false;
      return;
    }

    if (dom.upcomingEmpty) dom.upcomingEmpty.hidden = true;
    dom.upcomingContainer.hidden = false;
    dom.upcomingContainer.innerHTML = '';

    var frag = document.createDocumentFragment();

    trips.forEach(function (t) {
      var card = document.createElement('article');
      card.className = 'upcoming-card';

      var bId = t.booking_id;
      var safeTitle = escapeHtml(t.package_title || 'Tour Package');
      var safeDate = escapeHtml(formatDate(t.available_date));
      var travelers = Number(t.travelers || 1);
      var safeMoney = escapeHtml(formatMoney(t.total_amount));
      var safeImg = t.package_image ? escapeHtml(t.package_image) : '/images/placeholder.jpg';
      var bookingBadgeHtml = renderStatusBadge(t.booking_status);
      var paymentBadgeHtml = renderStatusBadge(t.payment_status);
      var detailUrl = '/booking-detail.html?id=' + encodeURIComponent(bId);

      card.innerHTML =
        '<img src="' + safeImg + '" alt="' + safeTitle + '" class="upcoming-card-thumb" onerror="this.onerror=null;this.src=\'/images/placeholder.jpg\';">' +
        '<div class="upcoming-card-body">' +
          '<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:var(--sp-2);">' +
            '<h3 class="upcoming-card-title">' + safeTitle + '</h3>' +
            '<span class="text-xs text-muted">#' + escapeHtml(bId) + '</span>' +
          '</div>' +
          '<div class="upcoming-card-meta">' +
            '<div class="upcoming-card-meta-row">' +
              '<span>📅 Date: <strong>' + safeDate + '</strong></span>' +
              '<span>👥 Travelers: <strong>' + travelers + '</strong></span>' +
            '</div>' +
            '<div class="upcoming-card-meta-row" style="margin-top:var(--sp-1);">' +
              '<span>💰 Amount: <strong style="color:var(--color-primary);">' + safeMoney + '</strong></span>' +
            '</div>' +
            '<div class="upcoming-card-meta-row" style="margin-top:var(--sp-2); gap:var(--sp-2); flex-wrap:wrap;">' +
              bookingBadgeHtml +
              paymentBadgeHtml +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="upcoming-card-footer">' +
          '<a href="' + detailUrl + '" class="btn btn-sm btn-secondary" style="width:100%; justify-content:center;">' +
            'View Details →' +
          '</a>' +
        '</div>';

      frag.appendChild(card);
    });

    dom.upcomingContainer.appendChild(frag);
  }

  /**
   * Orchestrates the complete dashboard view rendering.
   *
   * @param {Object} reportData Data from GET /api/customer/reports
   */
  function renderDashboard(reportData) {
    refreshDom();

    renderWelcome(state.user);
    renderKpi(reportData);
    renderStatusSummary(reportData && reportData.by_status);
    renderUpcomingTrips(reportData && reportData.upcoming);

    showContent();
  }

  /* ── Core Data Fetching ────────────────────────────────────── */

  var activeRequestId = 0;

  /**
   * Fetches customer dashboard data from GET /api/customer/reports.
   * Tracks activeRequestId to discard stale responses from out-of-order calls.
   *
   * @returns {Promise<Object|void>}
   */
  function loadDashboard() {
    refreshDom();

    activeRequestId++;
    var currentId = activeRequestId;

    state.isLoading = true;
    showLoading();

    return window.api.get('/api/customer/reports')
      .then(function (resp) {
        if (currentId !== activeRequestId) return; // Drop stale response

        state.isLoading = false;
        var reportData = (resp && resp.data) || {};
        state.reports = reportData;

        renderDashboard(reportData);
        return reportData;
      })
      .catch(function (err) {
        if (currentId !== activeRequestId) return; // Drop stale response

        state.isLoading = false;
        console.error('Failed to load customer reports dashboard:', err);
        showError((err && err.message) || 'Unable to connect to the server.');
      });
  }

  /* ── Event Listeners ───────────────────────────────────────── */

  function setupEvents() {
    refreshDom();

    if (state._eventsAttached) return;
    state._eventsAttached = true;

    // Retry button on error state
    if (dom.btnRetry) {
      dom.btnRetry.addEventListener('click', function () {
        loadDashboard();
      });
    }
  }

  /* ── Initialization ────────────────────────────────────────── */

  function init() {
    refreshDom();
    setupEvents();

    if (!window.Auth || typeof window.Auth.requireRole !== 'function') {
      console.warn('Auth module not available');
      return Promise.resolve();
    }

    // 1. Enforce authenticated CUSTOMER role
    return window.Auth.requireRole(['CUSTOMER']).then(function (user) {
      state.user = user;

      // 2. Fetch and render dashboard metrics & upcoming trips
      return loadDashboard();
    }).catch(function (err) {
      console.error('Customer authorization or initialization failed:', err);
      // Auth.requireRole redirects to login for unauthenticated sessions
    });
  }

  // Export for testing
  window.CustomerDashboard = {
    state: state,
    dom: dom,
    init: init,
    loadDashboard: loadDashboard,
    renderDashboard: renderDashboard,
    renderWelcome: renderWelcome,
    renderKpi: renderKpi,
    renderStatusSummary: renderStatusSummary,
    renderUpcomingTrips: renderUpcomingTrips,
    showLoading: showLoading,
    showError: showError,
    showContent: showContent,
    refreshDom: refreshDom,
    setupEvents: setupEvents
  };

  // Run on page load if browser environment
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }

})();
