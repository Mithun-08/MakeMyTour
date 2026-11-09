/**
 * my-bookings.js — Customer Bookings List Page Controller
 * Owner: M2
 *
 * Requirements:
 *  - Enforces authenticated CUSTOMER role via Auth.requireRole(['CUSTOMER']).
 *  - Interacts with GET /api/bookings/mine supporting page, pageSize, and status.
 *  - Search: searches across booking ID and package title.
 *    - Because backend GET /api/bookings/mine only filters by status and pagination,
 *      when a search query is active, the controller fetches all pages via the pagination API
 *      (pageSize: 50 + parallel fetch if total > 50), performs an exhaustive search across
 *      all records, and paginates through the matched results.
 *  - Status Filters: ALL, PENDING, CONFIRMED, COMPLETED, CANCELLED.
 *    - Updates active visual styling.
 *    - Resets pagination to page 1.
 *    - Preserves selected status filter during pagination.
 *  - Contextual Actions:
 *    - View Details: links to /booking-detail.html?id=ID
 *    - Pay Now: visible only when payment_status is UNPAID and booking_status is not CANCELLED
 *    - Cancel: visible only when can_cancel is true (computed by backend)
 *    - Leave Review: visible when can_review is true and has_review is false
 *  - UI States: Loading, Empty (with Explore Packages link), Error (with retry button).
 *  - Stale request drops: tracks activeRequestId to ignore superseded network responses.
 *  - Idempotent event attachment: guards against duplicate event listeners.
 *  - Exported as window.MyBookings for automated testability.
 */

(function () {
  'use strict';

  var PAGE_SIZE = 10;
  var FETCH_ALL_PAGE_SIZE = 50;

  /* ── State ─────────────────────────────────────────────────── */
  var state = {
    user: null,
    bookings: [],
    filters: {
      status: '', // '', 'PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED'
      q: '',
      page: 1,
      pageSize: PAGE_SIZE
    },
    pagination: {
      page: 1,
      pageSize: PAGE_SIZE,
      total: 0,
      totalPages: 1
    },
    isLoading: false,
    _eventsAttached: false
  };

  /* ── DOM References ────────────────────────────────────────── */
  var dom = {};

  function refreshDom() {
    dom.filtersContainer = document.getElementById('bookings-filters');
    dom.filterButtons    = document.querySelectorAll('#bookings-filters [data-status]');
    dom.searchInput      = document.getElementById('bookings-search');
    dom.countEl          = document.getElementById('bookings-count');
    dom.listContainer    = document.getElementById('bookings-list');
    dom.loadingEl        = document.getElementById('bookings-loading');
    dom.emptyEl          = document.getElementById('bookings-empty');
    dom.errorEl          = document.getElementById('bookings-error');
    dom.errorMsgEl       = document.getElementById('bookings-error-msg');
    dom.btnRetry         = document.getElementById('btn-retry-bookings');
    dom.tableWrapper     = document.getElementById('bookings-table-wrapper');
    dom.table            = document.getElementById('bookings-table');
    dom.tbody            = document.getElementById('bookings-tbody');
    dom.paginationEl     = document.getElementById('bookings-pagination');
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

  function formatImageUrl(image) {
    if (!image || typeof image !== 'string') return '/images/placeholder.jpg';
    var trimmed = image.trim();
    if (!trimmed) return '/images/placeholder.jpg';
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('/')) {
      return trimmed;
    }
    if (trimmed.startsWith('images/') || trimmed.startsWith('assets/')) {
      return '/' + trimmed;
    }
    return '/images/' + trimmed;
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
    if (dom.loadingEl) dom.loadingEl.hidden = false;
    if (dom.emptyEl) dom.emptyEl.hidden = true;
    if (dom.errorEl) dom.errorEl.hidden = true;
    if (dom.tableWrapper) dom.tableWrapper.hidden = true;
    if (dom.paginationEl) dom.paginationEl.hidden = true;
    if (dom.countEl) dom.countEl.textContent = 'Loading bookings…';
  }

  function showEmpty(customMessage) {
    if (dom.loadingEl) dom.loadingEl.hidden = true;
    if (dom.emptyEl) {
      dom.emptyEl.hidden = false;
      if (customMessage) {
        var bodyEl = dom.emptyEl.querySelector('.state-box-body');
        if (bodyEl) bodyEl.textContent = customMessage;
      }
    }
    if (dom.errorEl) dom.errorEl.hidden = true;
    if (dom.tableWrapper) dom.tableWrapper.hidden = true;
    if (dom.paginationEl) dom.paginationEl.hidden = true;
    if (dom.countEl) dom.countEl.textContent = 'Showing 0 bookings';
  }

  function showError(message) {
    if (dom.loadingEl) dom.loadingEl.hidden = true;
    if (dom.emptyEl) dom.emptyEl.hidden = true;
    if (dom.errorEl) dom.errorEl.hidden = false;
    if (dom.errorMsgEl) dom.errorMsgEl.textContent = message || 'Failed to load bookings. Please try again.';
    if (dom.tableWrapper) dom.tableWrapper.hidden = true;
    if (dom.paginationEl) dom.paginationEl.hidden = true;
    if (dom.countEl) dom.countEl.textContent = 'Error loading bookings';

    if (window.UI && typeof window.UI.toast === 'function') {
      window.UI.toast(message || 'Failed to load bookings', 'error');
    }
  }

  /* ── Core Data Fetching ────────────────────────────────────── */

  var activeRequestId = 0;

  /**
   * Loads customer bookings according to status filter, page, and search query.
   * If a search query is active, fetches all records across all pages using the
   * pagination API to guarantee an accurate cross-page search.
   */
  function loadBookings() {
    refreshDom();

    activeRequestId++;
    var currentId = activeRequestId;

    state.isLoading = true;
    showLoading();

    var query = (state.filters.q || '').trim();

    // ───────────────────────────────────────────────────────────
    // Path A: Standard Server-Paginated Fetch (No Search Query)
    // ───────────────────────────────────────────────────────────
    if (!query) {
      var params = {
        page: state.filters.page,
        pageSize: state.filters.pageSize
      };

      if (state.filters.status) {
        params.status = state.filters.status;
      }

      return window.api.get('/api/bookings/mine', params)
        .then(function (resp) {
          if (currentId !== activeRequestId) return; // Drop stale response

          state.isLoading = false;
          var rawBookings = (resp && resp.data) || [];
          var meta = (resp && resp.meta) || {
            page: state.filters.page,
            pageSize: state.filters.pageSize,
            total: rawBookings.length
          };

          state.bookings = rawBookings;
          state.pagination = {
            page: Number(meta.page || 1),
            pageSize: Number(meta.pageSize || PAGE_SIZE),
            total: Number(meta.total || rawBookings.length),
            totalPages: Math.ceil((Number(meta.total) || 1) / (Number(meta.pageSize) || PAGE_SIZE))
          };

          if (!rawBookings.length) {
            showEmpty();
          } else {
            renderList(rawBookings, state.pagination);
          }

          return rawBookings;
        })
        .catch(function (err) {
          if (currentId !== activeRequestId) return;

          state.isLoading = false;
          console.error('Failed to load customer bookings:', err);
          showError((err && err.message) || 'Unable to connect to the server');
        });
    }

    // ───────────────────────────────────────────────────────────
    // Path B: Cross-Page Search Using Available Pagination API
    // ───────────────────────────────────────────────────────────
    var searchParams = {
      page: 1,
      pageSize: FETCH_ALL_PAGE_SIZE
    };

    if (state.filters.status) {
      searchParams.status = state.filters.status;
    }

    return window.api.get('/api/bookings/mine', searchParams)
      .then(function (firstResp) {
        if (currentId !== activeRequestId) return;

        var firstPageBookings = (firstResp && firstResp.data) || [];
        var totalCount = (firstResp && firstResp.meta && Number(firstResp.meta.total)) || firstPageBookings.length;

        // If total records exceed 1 batch of 50, fetch remaining pages in parallel
        if (totalCount > FETCH_ALL_PAGE_SIZE) {
          var totalPages = Math.ceil(totalCount / FETCH_ALL_PAGE_SIZE);
          var fetchPromises = [];

          for (var p = 2; p <= totalPages; p++) {
            var pageParams = { page: p, pageSize: FETCH_ALL_PAGE_SIZE };
            if (state.filters.status) pageParams.status = state.filters.status;
            fetchPromises.push(window.api.get('/api/bookings/mine', pageParams));
          }

          return Promise.all(fetchPromises).then(function (subsequentResps) {
            if (currentId !== activeRequestId) return;

            var allBookings = firstPageBookings.slice();
            subsequentResps.forEach(function (r) {
              if (r && Array.isArray(r.data)) {
                allBookings = allBookings.concat(r.data);
              }
            });
            return processSearchResults(allBookings, query, currentId);
          });
        }

        return processSearchResults(firstPageBookings, query, currentId);
      })
      .catch(function (err) {
        if (currentId !== activeRequestId) return;

        state.isLoading = false;
        console.error('Failed to execute cross-page booking search:', err);
        showError((err && err.message) || 'Unable to connect to the server');
      });
  }

  /**
   * Helper to filter full booking set by query and paginate matched results.
   */
  function processSearchResults(allBookings, query, currentId) {
    if (currentId !== activeRequestId) return;

    state.isLoading = false;
    var qLower = query.toLowerCase();

    var matched = allBookings.filter(function (b) {
      var title = String(b.package_title || b.title || '').toLowerCase();
      var idStr = String(b.booking_id || '');
      return title.indexOf(qLower) !== -1 || idStr.indexOf(qLower) !== -1;
    });

    // Client-side pagination of search matches
    var page = state.filters.page;
    var pageSize = state.filters.pageSize;
    var startIndex = (page - 1) * pageSize;
    var pagedSlice = matched.slice(startIndex, startIndex + pageSize);

    state.bookings = pagedSlice;
    state.pagination = {
      page: page,
      pageSize: pageSize,
      total: matched.length,
      totalPages: Math.ceil(matched.length / pageSize) || 1
    };

    if (!matched.length) {
      showEmpty('No bookings match your search query: "' + escapeHtml(query) + '"');
    } else {
      renderList(pagedSlice, state.pagination);
    }

    return pagedSlice;
  }

  /* ── Table & Pagination Rendering ──────────────────────────── */

  function renderList(bookings, pagination) {
    if (!dom.tbody) refreshDom();

    if (dom.loadingEl) dom.loadingEl.hidden = true;
    if (dom.emptyEl) dom.emptyEl.hidden = true;
    if (dom.errorEl) dom.errorEl.hidden = true;
    if (dom.tableWrapper) dom.tableWrapper.hidden = false;

    // Update count indicator
    if (dom.countEl) {
      var total = pagination.total !== undefined ? pagination.total : bookings.length;
      var countText = 'Showing ' + bookings.length + ' of ' + total + ' booking' + (total === 1 ? '' : 's');
      if (state.filters.status) {
        countText += ' (' + state.filters.status + ')';
      }
      if (state.filters.q) {
        countText += ' matching "' + state.filters.q + '"';
      }
      dom.countEl.textContent = countText;
    }

    // Build table rows safely
    dom.tbody.innerHTML = '';
    var frag = document.createDocumentFragment();

    bookings.forEach(function (b) {
      var tr = document.createElement('tr');
      tr.setAttribute('data-booking-id', String(b.booking_id));

      var safeTitle = escapeHtml(b.package_title || b.title || 'Tour Package');
      var safeDate  = formatDate(b.available_date);
      var safeMoney = formatMoney(b.total_amount);
      var bookingStatusBadge = renderStatusBadge(b.booking_status);
      var paymentStatusBadge = renderStatusBadge(b.payment_status);

      // Package thumbnail
      var thumbHtml = '';
      if (b.image || b.package_image) {
        var imgSrc = escapeHtml(formatImageUrl(b.image || b.package_image));
        thumbHtml = '<img src="' + imgSrc + '" alt="' + safeTitle + '" class="package-thumb" onerror="this.onerror=null;this.src=\'/images/placeholder.jpg\';">';
      } else {
        thumbHtml = '<img src="/images/placeholder.jpg" alt="' + safeTitle + '" class="package-thumb" onerror="this.onerror=null;this.parentElement.innerHTML=\'<span class=\\\'package-thumb\\\' aria-hidden=\\\'true\\\'>🌴</span>\'">';
      }

      // Contextual Action Buttons
      // 1. View Details (always available)
      var actionsHtml = '<div class="action-group">';
      actionsHtml += '<a href="/booking-detail.html?id=' + encodeURIComponent(b.booking_id) + '" class="btn btn-sm btn-secondary" title="View booking details">View</a>';

      // 2. Pay Now (eligible if UNPAID and booking is not CANCELLED)
      var canPay = (b.payment_status === 'UNPAID' && b.booking_status !== 'CANCELLED');
      if (canPay) {
        actionsHtml += '<a href="/booking-detail.html?id=' + encodeURIComponent(b.booking_id) + '&action=pay" class="btn btn-sm btn-primary" title="Pay for this booking">Pay Now</a>';
      }

      // 3. Cancel (strictly determined by backend can_cancel flag)
      if (b.can_cancel) {
        actionsHtml += '<a href="/booking-detail.html?id=' + encodeURIComponent(b.booking_id) + '&action=cancel" class="btn btn-sm btn-ghost" style="color:var(--color-danger);" title="Cancel this booking">Cancel</a>';
      }

      // 4. Leave Review (when booking is COMPLETED and eligible for review)
      if (b.can_review && !b.has_review) {
        actionsHtml += '<a href="/booking-detail.html?id=' + encodeURIComponent(b.booking_id) + '&action=review" class="btn btn-sm btn-primary" title="Leave a review for this tour">Leave Review</a>';
      } else if (b.has_review) {
        actionsHtml += '<span class="badge badge-completed" title="Review submitted">Reviewed ✓</span>';
      }

      actionsHtml += '</div>';

      tr.innerHTML =
        '<td style="font-weight:var(--font-semi); color:var(--color-text-muted);">#' + escapeHtml(b.booking_id) + '</td>' +
        '<td>' +
          '<div class="package-cell">' +
            thumbHtml +
            '<div>' +
              '<a href="/booking-detail.html?id=' + encodeURIComponent(b.booking_id) + '" style="font-weight:var(--font-semi); color:var(--color-text); text-decoration:none;">' +
                safeTitle +
              '</a>' +
            '</div>' +
          '</div>' +
        '</td>' +
        '<td>' + safeDate + '</td>' +
        '<td>' + Number(b.travelers || 1) + '</td>' +
        '<td style="font-weight:var(--font-semi);">' + safeMoney + '</td>' +
        '<td>' + bookingStatusBadge + '</td>' +
        '<td>' + paymentStatusBadge + '</td>' +
        '<td style="text-align:right;">' + actionsHtml + '</td>';

      frag.appendChild(tr);
    });

    dom.tbody.appendChild(frag);

    renderPagination(pagination);
  }

  function renderPagination(pagination) {
    if (!dom.paginationEl) return;

    if (!pagination || pagination.total <= pagination.pageSize) {
      dom.paginationEl.innerHTML = '';
      dom.paginationEl.hidden = true;
      return;
    }

    dom.paginationEl.hidden = false;

    if (window.UI && typeof window.UI.pager === 'function') {
      window.UI.pager(dom.paginationEl, pagination, function (newPage) {
        state.filters.page = newPage;
        loadBookings();
      });
      return;
    }

    // Fallback accessible pagination controls
    var totalPages = Math.ceil(pagination.total / pagination.pageSize);
    var currentPage = pagination.page || 1;

    var nav = document.createElement('nav');
    nav.className = 'pager';
    nav.setAttribute('aria-label', 'Pagination');

    var prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'btn btn-sm btn-secondary';
    prevBtn.textContent = '« Prev';
    prevBtn.disabled = currentPage <= 1;
    prevBtn.addEventListener('click', function () {
      if (currentPage > 1) {
        state.filters.page = currentPage - 1;
        loadBookings();
      }
    });
    nav.appendChild(prevBtn);

    var info = document.createElement('span');
    info.className = 'text-sm text-muted';
    info.style.padding = '0 var(--sp-3)';
    info.textContent = 'Page ' + currentPage + ' of ' + totalPages;
    nav.appendChild(info);

    var nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'btn btn-sm btn-secondary';
    nextBtn.textContent = 'Next »';
    nextBtn.disabled = currentPage >= totalPages;
    nextBtn.addEventListener('click', function () {
      if (currentPage < totalPages) {
        state.filters.page = currentPage + 1;
        loadBookings();
      }
    });
    nav.appendChild(nextBtn);

    dom.paginationEl.innerHTML = '';
    dom.paginationEl.appendChild(nav);
  }

  /* ── Filter Actions & Events ───────────────────────────────── */

  function updateFilterButtonsUi() {
    if (dom.filterButtons && dom.filterButtons.length) {
      dom.filterButtons.forEach(function (btn) {
        var status = btn.getAttribute('data-status') || '';
        var isActive = (status === state.filters.status);
        if (isActive) {
          btn.classList.add('active');
          btn.setAttribute('aria-selected', 'true');
        } else {
          btn.classList.remove('active');
          btn.setAttribute('aria-selected', 'false');
        }
      });
    }
  }

  function readUrlParams() {
    try {
      if (typeof window === 'undefined' || !window.location) return;
      var params = new URLSearchParams(window.location.search);
      var rawStatus = params.get('status');
      if (rawStatus !== null && rawStatus !== undefined) {
        var cleanStatus = String(rawStatus).trim().toUpperCase();
        var validStatuses = ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED'];
        if (validStatuses.indexOf(cleanStatus) !== -1) {
          state.filters.status = cleanStatus;
        } else if (cleanStatus === '' || cleanStatus === 'ALL') {
          state.filters.status = '';
        }
      }
      var rawQ = params.get('q');
      if (rawQ !== null && rawQ !== undefined) {
        state.filters.q = String(rawQ).trim();
        if (dom.searchInput) dom.searchInput.value = state.filters.q;
      }
      var rawPage = params.get('page');
      if (rawPage && /^\d+$/.test(rawPage)) {
        var p = Number(rawPage);
        if (p >= 1) state.filters.page = p;
      }
      updateFilterButtonsUi();
    } catch (e) {}
  }

  function syncUrlParams() {
    try {
      if (typeof window === 'undefined' || !window.location || !window.history || typeof window.history.replaceState !== 'function') return;
      var url = new URL(window.location.href);
      if (state.filters.status) {
        url.searchParams.set('status', state.filters.status);
      } else {
        url.searchParams.delete('status');
      }
      if (state.filters.q) {
        url.searchParams.set('q', state.filters.q);
      } else {
        url.searchParams.delete('q');
      }
      if (state.filters.page > 1) {
        url.searchParams.set('page', state.filters.page);
      } else {
        url.searchParams.delete('page');
      }
      window.history.replaceState(null, '', url.pathname + (url.search ? url.search : ''));
    } catch (e) {}
  }

  function setStatusFilter(targetStatus) {
    state.filters.status = targetStatus || '';
    state.filters.page = 1; // Always reset to page 1 on filter change
    updateFilterButtonsUi();
    syncUrlParams();
    return loadBookings();
  }

  function setSearchQuery(q) {
    state.filters.q = (q || '').trim();
    state.filters.page = 1; // Always reset to page 1 on search change
    syncUrlParams();
    return loadBookings();
  }

  function setupEvents() {
    refreshDom();

    // Idempotency check: prevent duplicate event listeners
    if (state._eventsAttached) return;
    state._eventsAttached = true;

    // 1. Status Filter Buttons delegation
    if (dom.filtersContainer) {
      dom.filtersContainer.addEventListener('click', function (e) {
        var targetBtn = e.target.closest('[data-status]');
        if (!targetBtn) return;
        var status = targetBtn.getAttribute('data-status') || '';
        setStatusFilter(status);
      });
    }

    // 2. Search Input (debounced)
    if (dom.searchInput) {
      var debounceTimer = null;
      dom.searchInput.addEventListener('input', function () {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function () {
          setSearchQuery(dom.searchInput.value);
        }, 300);
      });
    }

    // 3. Retry button on error state
    if (dom.btnRetry) {
      dom.btnRetry.addEventListener('click', function () {
        loadBookings();
      });
    }

    // 4. Browser history popstate (back/forward navigation)
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('popstate', function () {
        readUrlParams();
        loadBookings();
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

    // Enforce role: authenticated CUSTOMER only
    return window.Auth.requireRole(['CUSTOMER']).then(function (user) {
      state.user = user;
      readUrlParams();
      return loadBookings();
    }).catch(function (err) {
      console.error('Customer authorization failed:', err);
    });
  }

  // Export for testability
  window.MyBookings = {
    state: state,
    dom: dom,
    init: init,
    loadBookings: loadBookings,
    renderList: renderList,
    renderPagination: renderPagination,
    setStatusFilter: setStatusFilter,
    setSearchQuery: setSearchQuery,
    formatImageUrl: formatImageUrl,
    setupEvents: setupEvents,
    refreshDom: refreshDom,
    showLoading: showLoading,
    showEmpty: showEmpty,
    showError: showError,
    readUrlParams: readUrlParams,
    updateFilterButtonsUi: updateFilterButtonsUi,
    syncUrlParams: syncUrlParams
  };

  // Run on page load if running in a browser environment
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }

})();
