/**
 * pages/provider-dashboard.js — Provider Package Management Frontend
 * Owner: M2 takeover
 * Contracts:
 *   - GET   /api/provider/packages           (own packages, search, status, pagination)
 *   - GET   /api/provider/packages/:id       (full detail incl. itinerary and departures)
 *   - POST  /api/provider/packages           (create package as PENDING)
 *   - PUT   /api/provider/packages/:id       (update package fields & replace itinerary)
 *   - PATCH /api/provider/packages/:id/status(toggle APPROVED and DISABLED only)
 *   - GET   /api/destinations                (active destinations for dropdowns)
 *   - GET   /api/categories                  (active categories for dropdowns)
 *
 * Requirements:
 *  - Authenticated PROVIDER role required (Auth.requireRole(['PROVIDER'])).
 *  - Safe rendering using textContent, createElement, or UI.escapeHtml.
 *  - Complete error, empty, loading states.
 */

(function () {
  'use strict';

  var PAGE_SIZE = 10;

  /* ── State ─────────────────────────────────────────────────── */
  var state = {
    user: null,
    destinations: [],
    categories: [],
    packages: [],
    stats: { total: 0, approved: 0, pending: 0, disabled: 0, rejected: 0 },
    filters: {
      q: '',
      status: '',
      page: 1,
      pageSize: PAGE_SIZE
    },
    pagination: {
      page: 1,
      pageSize: PAGE_SIZE,
      total: 0,
      totalPages: 1
    },
    editingPackageId: null
  };

  /* ── DOM References ────────────────────────────────────────── */
  var dom = {
    // Header & Actions
    btnOpenCreateModal: document.getElementById('btn-open-create-modal'),

    // Stats cards
    statTotal:    document.getElementById('stat-total'),
    statApproved: document.getElementById('stat-approved'),
    statPending:  document.getElementById('stat-pending'),
    statDisabled: document.getElementById('stat-disabled'),
    statRejected: document.getElementById('stat-rejected'),
    statCards:    document.querySelectorAll('.stat-card'),

    // Filters
    filterForm:     document.getElementById('provider-filter-form'),
    searchInput:    document.getElementById('pkg-search-input'),
    statusFilter:   document.getElementById('pkg-status-filter'),
    btnFilterReset: document.getElementById('btn-filter-reset'),
    resultCount:    document.getElementById('pkg-result-count'),

    // Table
    tableContainer: document.getElementById('pkg-table-container'),
    tbody:          document.getElementById('pkg-tbody'),
    paginationEl:   document.getElementById('pkg-pagination'),

    // Create/Edit Modal
    pkgModal:         document.getElementById('pkg-modal'),
    modalHeading:     document.getElementById('modal-pkg-heading'),
    btnCloseModal:    document.getElementById('btn-close-modal'),
    btnCancelModal:   document.getElementById('btn-cancel-modal'),
    pkgForm:          document.getElementById('package-form'),
    formErrorAlert:   document.getElementById('form-error-alert'),
    formErrorText:    document.getElementById('form-error-text'),
    formPkgId:        document.getElementById('form-pkg-id'),
    formTitle:        document.getElementById('form-title'),
    formDestination:  document.getElementById('form-destination'),
    formCategory:     document.getElementById('form-category'),
    formPrice:        document.getElementById('form-price'),
    formDuration:     document.getElementById('form-duration'),
    formCapacity:     document.getElementById('form-capacity'),
    formImage:        document.getElementById('form-image'),
    formDescription:  document.getElementById('form-description'),
    formInclusions:   document.getElementById('form-inclusions'),
    formExclusions:   document.getElementById('form-exclusions'),
    itineraryList:    document.getElementById('itinerary-list'),
    btnAddDay:        document.getElementById('btn-add-day'),
    sectionAvail:     document.getElementById('section-availability'),
    availabilityList: document.getElementById('availability-list'),
    btnAddAvailDate:  document.getElementById('btn-add-avail-date'),
    btnSavePackage:   document.getElementById('btn-save-package'),

    // View Modal
    viewModal:          document.getElementById('view-modal'),
    viewModalTitle:     document.getElementById('view-modal-title'),
    viewModalBody:      document.getElementById('view-modal-body'),
    btnCloseViewModal:  document.getElementById('btn-close-view-modal'),
    btnDismissViewModal:document.getElementById('btn-dismiss-view-modal')
  };

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
    var num = Number(amount);
    return isNaN(num) ? '₹—' : '₹' + num.toFixed(2);
  }

  function formatDate(val) {
    if (window.UI && typeof window.UI.date === 'function') {
      return window.UI.date(val);
    }
    if (!val) return '—';
    return String(val).slice(0, 10);
  }

  function makeBadge(status) {
    if (window.UI && typeof window.UI.statusBadge === 'function') {
      return window.UI.statusBadge(status);
    }
    var span = document.createElement('span');
    span.className = 'badge badge-' + String(status || '').toLowerCase();
    span.textContent = status || 'UNKNOWN';
    return span;
  }

  function showToast(msg, type) {
    if (window.UI && typeof window.UI.toast === 'function') {
      window.UI.toast(msg, type);
    } else {
      console.log('[' + (type || 'info') + '] ' + msg);
    }
  }

  function parseTextLines(text) {
    if (!text) return [];
    return String(text)
      .split('\n')
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  }

  /* ── Metadata Loading (Destinations & Categories) ─────────── */

  function loadMetadata() {
    var pDests = api.get('/api/destinations').then(function (res) {
      state.destinations = (res && res.data) || [];
      populateDestinationDropdown();
    }).catch(function (err) {
      console.error('Failed to load destinations:', err);
    });

    var pCats = api.get('/api/categories').then(function (res) {
      state.categories = (res && res.data) || [];
      populateCategoryDropdown();
    }).catch(function (err) {
      console.error('Failed to load categories:', err);
    });

    return Promise.all([pDests, pCats]);
  }

  function populateDestinationDropdown() {
    if (!dom.formDestination) return;
    var currentVal = dom.formDestination.value;
    dom.formDestination.innerHTML = '';
    var defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = 'Select destination...';
    dom.formDestination.appendChild(defaultOpt);
    state.destinations.forEach(function (d) {
      var opt = document.createElement('option');
      opt.value = d.destination_id;
      opt.textContent = d.name + (d.state ? ' (' + d.state + ')' : '');
      dom.formDestination.appendChild(opt);
    });
    if (currentVal) dom.formDestination.value = currentVal;
  }

  function populateCategoryDropdown() {
    if (!dom.formCategory) return;
    var currentVal = dom.formCategory.value;
    dom.formCategory.innerHTML = '';
    var defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = 'Select category...';
    dom.formCategory.appendChild(defaultOpt);
    state.categories.forEach(function (c) {
      var opt = document.createElement('option');
      opt.value = c.category_id;
      opt.textContent = c.category_name;
      dom.formCategory.appendChild(opt);
    });
    if (currentVal) dom.formCategory.value = currentVal;
  }

  /* ── Package Statistics Loading ────────────────────────────── */

  function loadStats() {
    // Calling unpaginated GET /api/provider/packages retrieves all own packages to compute totals
    return api.get('/api/provider/packages').then(function (res) {
      var list = (res && res.data) || [];
      var counts = { total: list.length, approved: 0, pending: 0, disabled: 0, rejected: 0 };
      list.forEach(function (p) {
        var st = (p.status || '').toUpperCase();
        if (st === 'APPROVED') counts.approved++;
        else if (st === 'PENDING') counts.pending++;
        else if (st === 'DISABLED') counts.disabled++;
        else if (st === 'REJECTED') counts.rejected++;
      });
      state.stats = counts;
      renderStats();
    }).catch(function (err) {
      console.error('Failed to compute stats:', err);
    });
  }

  function renderStats() {
    if (dom.statTotal)    dom.statTotal.textContent    = state.stats.total;
    if (dom.statApproved) dom.statApproved.textContent = state.stats.approved;
    if (dom.statPending)  dom.statPending.textContent  = state.stats.pending;
    if (dom.statDisabled) dom.statDisabled.textContent = state.stats.disabled;
    if (dom.statRejected) dom.statRejected.textContent = state.stats.rejected;

    // Highlight active stat card
    if (dom.statCards) {
      dom.statCards.forEach(function (card) {
        var cardStatus = card.getAttribute('data-status') || '';
        if (cardStatus === state.filters.status) {
          card.classList.add('active');
        } else {
          card.classList.remove('active');
        }
      });
    }
  }

  /* ── Package List Loading & Rendering ──────────────────────── */

  function loadPackages() {
    if (!dom.tableContainer) return Promise.resolve();

    var query = {
      page: state.filters.page,
      pageSize: state.filters.pageSize
    };
    if (state.filters.q) query.q = state.filters.q;
    if (state.filters.status) query.status = state.filters.status;

    // Show loading indicator
    if (window.UI && typeof window.UI.showLoading === 'function') {
      window.UI.showLoading(dom.tableContainer, 'Loading your packages...');
    } else {
      dom.tableContainer.innerHTML = '<div class="loading-row"><div class="spinner"></div><p>Loading...</p></div>';
    }

    return api.get('/api/provider/packages', query).then(function (res) {
      var rows = (res && res.data) || [];
      state.packages = rows;

      if (res && res.meta) {
        state.pagination = {
          page: res.meta.page || state.filters.page,
          pageSize: res.meta.pageSize || state.filters.pageSize,
          total: res.meta.total !== undefined ? res.meta.total : rows.length,
          totalPages: res.meta.totalPages || 1
        };
      } else {
        state.pagination = {
          page: 1,
          pageSize: rows.length || 10,
          total: rows.length,
          totalPages: 1
        };
      }

      renderPackageTable(rows);
      renderPagination();
      updateResultCount();
    }).catch(function (err) {
      console.error('Failed to load packages:', err);
      if (window.UI && typeof window.UI.showError === 'function') {
        window.UI.showError(dom.tableContainer, err.message || 'Unable to load packages. Please check connection and try again.');
      } else {
        dom.tableContainer.innerHTML = '<div class="alert alert-error"><p>' + escapeHtml(err.message || 'Error loading packages') + '</p></div>';
      }
      if (dom.resultCount) dom.resultCount.textContent = 'Failed to load packages';
    });
  }

  function updateResultCount() {
    if (!dom.resultCount) return;
    var total = state.pagination.total;
    var statusText = state.filters.status ? ' (' + state.filters.status.toLowerCase() + ')' : '';
    dom.resultCount.textContent = 'Showing ' + total + ' package' + (total === 1 ? '' : 's') + statusText;
  }

  function renderPackageTable(packages) {
    if (!dom.tableContainer) return;

    if (!packages || packages.length === 0) {
      if (window.UI && typeof window.UI.empty === 'function') {
        window.UI.empty(dom.tableContainer, 'No packages found matching your criteria.');
      } else {
        dom.tableContainer.innerHTML = '<div class="state-box state-empty"><p class="state-box-title">No packages found</p></div>';
      }
      return;
    }

    // Reconstruct table wrapper
    dom.tableContainer.innerHTML = '';
    var wrapper = document.createElement('div');
    wrapper.className = 'table-wrapper';

    var table = document.createElement('table');
    table.className = 'table';
    table.id = 'pkg-table';
    table.setAttribute('aria-label', 'Provider Packages');

    var thead = document.createElement('thead');
    thead.innerHTML =
      '<tr>' +
        '<th scope="col" style="min-width: 220px;">Package</th>' +
        '<th scope="col">Destination</th>' +
        '<th scope="col">Category</th>' +
        '<th scope="col">Duration</th>' +
        '<th scope="col">Price</th>' +
        '<th scope="col">Bookings & Rating</th>' +
        '<th scope="col">Status</th>' +
        '<th scope="col">Created</th>' +
        '<th scope="col" style="text-align: right; min-width: 170px;">Actions</th>' +
      '</tr>';
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    tbody.id = 'pkg-tbody';

    packages.forEach(function (pkg) {
      var tr = document.createElement('tr');
      tr.id = 'pkg-row-' + pkg.package_id;

      // Col 1: Package
      var tdPkg = document.createElement('td');
      var pkgWrap = document.createElement('div');
      pkgWrap.style.display = 'flex';
      pkgWrap.style.alignItems = 'center';
      pkgWrap.style.gap = 'var(--sp-3)';

      if (pkg.image) {
        var img = document.createElement('img');
        img.className = 'thumbnail-tiny';
        img.src = pkg.image;
        img.alt = pkg.title;
        img.onerror = function () {
          img.style.display = 'none';
        };
        pkgWrap.appendChild(img);
      } else {
        var thumb = document.createElement('div');
        thumb.className = 'thumbnail-tiny';
        thumb.textContent = '🌴';
        pkgWrap.appendChild(thumb);
      }

      var titleBox = document.createElement('div');
      var titleLink = document.createElement('a');
      titleLink.href = '#';
      titleLink.style.fontWeight = 'var(--font-semi)';
      titleLink.style.display = 'block';
      titleLink.textContent = pkg.title;
      titleLink.addEventListener('click', function (e) {
        e.preventDefault();
        viewPackage(pkg.package_id);
      });

      var idSub = document.createElement('span');
      idSub.className = 'text-xs text-muted';
      idSub.textContent = 'ID: #' + pkg.package_id;

      titleBox.appendChild(titleLink);
      titleBox.appendChild(idSub);
      pkgWrap.appendChild(titleBox);
      tdPkg.appendChild(pkgWrap);
      tr.appendChild(tdPkg);

      // Col 2: Destination
      var tdDest = document.createElement('td');
      var destText = pkg.destination_name || '—';
      if (pkg.city || pkg.state) {
        destText += ' (' + (pkg.city ? pkg.city + ', ' : '') + (pkg.state || '') + ')';
      }
      tdDest.textContent = destText;
      tr.appendChild(tdDest);

      // Col 3: Category
      var tdCat = document.createElement('td');
      tdCat.textContent = pkg.category_name || '—';
      tr.appendChild(tdCat);

      // Col 4: Duration & Capacity
      var tdDur = document.createElement('td');
      tdDur.textContent = pkg.duration_days + ' days · Max ' + pkg.capacity;
      tr.appendChild(tdDur);

      // Col 5: Price
      var tdPrice = document.createElement('td');
      tdPrice.style.fontWeight = 'var(--font-semi)';
      tdPrice.textContent = formatMoney(pkg.price);
      tr.appendChild(tdPrice);

      // Col 6: Bookings & Rating
      var tdStats = document.createElement('td');
      var statsParts = [];
      if (pkg.avg_rating !== null && pkg.avg_rating !== undefined) {
        statsParts.push('★ ' + pkg.avg_rating + ' (' + pkg.review_count + ')');
      }
      statsParts.push((pkg.booking_count || 0) + ' booking' + (pkg.booking_count === 1 ? '' : 's'));
      tdStats.textContent = statsParts.join(' · ');
      tr.appendChild(tdStats);

      // Col 7: Status
      var tdStatus = document.createElement('td');
      tdStatus.appendChild(makeBadge(pkg.status));
      tr.appendChild(tdStatus);

      // Col 8: Created
      var tdCreated = document.createElement('td');
      tdCreated.textContent = formatDate(pkg.created_at);
      tr.appendChild(tdCreated);

      // Col 9: Actions
      var tdActions = document.createElement('td');
      tdActions.style.textAlign = 'right';

      var btnGroup = document.createElement('div');
      btnGroup.className = 'action-btn-group';

      // View button
      var btnView = document.createElement('button');
      btnView.type = 'button';
      btnView.className = 'btn btn-ghost btn-sm';
      btnView.id = 'btn-view-pkg-' + pkg.package_id;
      btnView.textContent = 'View';
      btnView.addEventListener('click', function () {
        viewPackage(pkg.package_id);
      });
      btnGroup.appendChild(btnView);

      // Edit button
      var btnEdit = document.createElement('button');
      btnEdit.type = 'button';
      btnEdit.className = 'btn btn-secondary btn-sm';
      btnEdit.id = 'btn-edit-pkg-' + pkg.package_id;
      btnEdit.textContent = 'Edit';
      btnEdit.addEventListener('click', function () {
        editPackage(pkg.package_id);
      });
      btnGroup.appendChild(btnEdit);

      // Status management toggle button
      var pkgStatus = (pkg.status || '').toUpperCase();
      if (pkgStatus === 'APPROVED') {
        var btnDisable = document.createElement('button');
        btnDisable.type = 'button';
        btnDisable.className = 'btn btn-ghost btn-sm';
        btnDisable.id = 'btn-status-toggle-' + pkg.package_id;
        btnDisable.textContent = 'Disable';
        btnDisable.title = 'Take package offline';
        btnDisable.addEventListener('click', function () {
          togglePackageStatus(pkg.package_id, 'DISABLED');
        });
        btnGroup.appendChild(btnDisable);
      } else if (pkgStatus === 'DISABLED') {
        var btnEnable = document.createElement('button');
        btnEnable.type = 'button';
        btnEnable.className = 'btn btn-primary btn-sm';
        btnEnable.id = 'btn-status-toggle-' + pkg.package_id;
        btnEnable.textContent = 'Enable';
        btnEnable.title = 'Make package active and visible';
        btnEnable.addEventListener('click', function () {
          togglePackageStatus(pkg.package_id, 'APPROVED');
        });
        btnGroup.appendChild(btnEnable);
      } else if (pkgStatus === 'PENDING') {
        var btnPending = document.createElement('button');
        btnPending.type = 'button';
        btnPending.className = 'btn btn-ghost btn-sm';
        btnPending.id = 'btn-status-toggle-' + pkg.package_id;
        btnPending.disabled = true;
        btnPending.textContent = 'In Review';
        btnPending.title = 'Cannot change status while awaiting admin moderation';
        btnGroup.appendChild(btnPending);
      } else if (pkgStatus === 'REJECTED') {
        var btnRejected = document.createElement('button');
        btnRejected.type = 'button';
        btnRejected.className = 'btn btn-ghost btn-sm';
        btnRejected.id = 'btn-status-toggle-' + pkg.package_id;
        btnRejected.disabled = true;
        btnRejected.textContent = 'Rejected';
        btnRejected.title = 'Package was rejected by administrator';
        btnGroup.appendChild(btnRejected);
      }

      tdActions.appendChild(btnGroup);
      tr.appendChild(tdActions);

      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    wrapper.appendChild(table);
    dom.tableContainer.appendChild(wrapper);
  }

  function renderPagination() {
    if (!dom.paginationEl) return;
    if (window.UI && typeof window.UI.pager === 'function') {
      window.UI.pager(dom.paginationEl, state.pagination, function (newPage) {
        state.filters.page = newPage;
        loadPackages();
      });
    } else {
      dom.paginationEl.innerHTML = '';
      if (state.pagination.totalPages <= 1) return;

      var nav = document.createElement('nav');
      nav.className = 'pagination';
      for (var i = 1; i <= state.pagination.totalPages; i++) {
        (function (p) {
          var btn = document.createElement('button');
          btn.className = 'page-btn' + (p === state.pagination.page ? ' active' : '');
          btn.textContent = p;
          btn.addEventListener('click', function () {
            state.filters.page = p;
            loadPackages();
          });
          nav.appendChild(btn);
        })(i);
      }
      dom.paginationEl.appendChild(nav);
    }
  }

  /* ── Status Management (PATCH /api/provider/packages/:id/status) ─ */

  function togglePackageStatus(packageId, newStatus) {
    if (newStatus !== 'APPROVED' && newStatus !== 'DISABLED') {
      showToast('Providers can only toggle between APPROVED and DISABLED status.', 'error');
      return Promise.reject(new Error('Invalid status transition'));
    }

    var actionWord = newStatus === 'DISABLED' ? 'disable' : 'enable';
    var confirmPrompt = 'Are you sure you want to ' + actionWord + ' package #' + packageId + '?';
    if (newStatus === 'DISABLED') {
      confirmPrompt += ' It will no longer be visible to customers on MakeMyTour.';
    } else {
      confirmPrompt += ' It will become visible for customers to book.';
    }

    var confirmPromise = (window.UI && typeof window.UI.confirm === 'function')
      ? window.UI.confirm(confirmPrompt)
      : Promise.resolve(window.confirm(confirmPrompt));

    return confirmPromise.then(function (ok) {
      if (!ok) return;

      return api.patch('/api/provider/packages/' + packageId + '/status', {
        status: newStatus
      }).then(function (res) {
        showToast('Package #' + packageId + ' is now ' + newStatus, 'success');
        return Promise.all([loadStats(), loadPackages()]);
      }).catch(function (err) {
        var msg = (err && err.message) || 'Failed to update package status';
        showToast(msg, 'error');
        console.error('Status update failed:', err);
      });
    });
  }

  /* ── Dynamic Itinerary & Availability Form Handlers ───────── */

  function addItineraryDay(dayData) {
    if (!dom.itineraryList) return;
    var currentDays = dom.itineraryList.querySelectorAll('.itinerary-item');
    var nextDayNo = dayData && dayData.day_no ? Number(dayData.day_no) : (currentDays.length + 1);

    var item = document.createElement('div');
    item.className = 'itinerary-item';
    item.dataset.dayIndex = nextDayNo;

    var header = document.createElement('div');
    header.className = 'item-header';

    var dayTitle = document.createElement('strong');
    dayTitle.className = 'itinerary-day-label';
    dayTitle.textContent = 'Day ' + nextDayNo;

    var btnRemove = document.createElement('button');
    btnRemove.type = 'button';
    btnRemove.className = 'btn btn-ghost btn-sm';
    btnRemove.style.color = 'var(--color-danger)';
    btnRemove.textContent = 'Remove';
    btnRemove.addEventListener('click', function () {
      item.parentNode.removeChild(item);
      renumberItineraryDays();
    });

    header.appendChild(dayTitle);
    header.appendChild(btnRemove);
    item.appendChild(header);

    // Day title input
    var fieldTitle = document.createElement('div');
    fieldTitle.className = 'field';
    fieldTitle.style.marginBottom = 'var(--sp-2)';

    var lblTitle = document.createElement('label');
    lblTitle.className = 'field-label';
    lblTitle.textContent = 'Day Title *';

    var inputTitle = document.createElement('input');
    inputTitle.type = 'text';
    inputTitle.className = 'field-input itinerary-title-input';
    inputTitle.placeholder = 'e.g. Arrival in Srinagar & Shikara Ride';
    inputTitle.maxLength = 200;
    inputTitle.required = true;
    inputTitle.value = (dayData && dayData.title) || '';

    fieldTitle.appendChild(lblTitle);
    fieldTitle.appendChild(inputTitle);
    item.appendChild(fieldTitle);

    // Day description input
    var fieldDesc = document.createElement('div');
    fieldDesc.className = 'field';

    var lblDesc = document.createElement('label');
    lblDesc.className = 'field-label';
    lblDesc.textContent = 'Day Description';

    var textareaDesc = document.createElement('textarea');
    textareaDesc.className = 'field-textarea itinerary-desc-input';
    textareaDesc.rows = 2;
    textareaDesc.placeholder = 'Detailed itinerary and activities for this day...';
    textareaDesc.value = (dayData && dayData.description) || '';

    fieldDesc.appendChild(lblDesc);
    fieldDesc.appendChild(textareaDesc);
    item.appendChild(fieldDesc);

    dom.itineraryList.appendChild(item);
  }

  function renumberItineraryDays() {
    if (!dom.itineraryList) return;
    var items = dom.itineraryList.querySelectorAll('.itinerary-item');
    items.forEach(function (item, idx) {
      var num = idx + 1;
      item.dataset.dayIndex = num;
      var lbl = item.querySelector('.itinerary-day-label');
      if (lbl) lbl.textContent = 'Day ' + num;
    });
  }

  function addAvailabilityDate(dateData) {
    if (!dom.availabilityList) return;

    var item = document.createElement('div');
    item.className = 'availability-item';

    var row = document.createElement('div');
    row.className = 'form-row';
    row.style.alignItems = 'flex-end';

    // Date
    var fieldDate = document.createElement('div');
    fieldDate.className = 'field';
    var lblDate = document.createElement('label');
    lblDate.className = 'field-label';
    lblDate.textContent = 'Departure Date (YYYY-MM-DD) *';
    var inputDate = document.createElement('input');
    inputDate.type = 'date';
    inputDate.className = 'field-input avail-date-input';
    inputDate.required = true;
    inputDate.value = (dateData && dateData.available_date) || '';
    fieldDate.appendChild(lblDate);
    fieldDate.appendChild(inputDate);
    row.appendChild(fieldDate);

    // Seats
    var fieldSeats = document.createElement('div');
    fieldSeats.className = 'field';
    var lblSeats = document.createElement('label');
    lblSeats.className = 'field-label';
    lblSeats.textContent = 'Seats Available';
    var inputSeats = document.createElement('input');
    inputSeats.type = 'number';
    inputSeats.min = '0';
    inputSeats.step = '1';
    inputSeats.className = 'field-input avail-seats-input';
    inputSeats.placeholder = 'Defaults to capacity';
    inputSeats.value = (dateData && dateData.seats_available !== undefined) ? dateData.seats_available : '';
    fieldSeats.appendChild(lblSeats);
    fieldSeats.appendChild(inputSeats);
    row.appendChild(fieldSeats);

    // Remove
    var fieldAction = document.createElement('div');
    fieldAction.style.display = 'flex';
    fieldAction.style.paddingBottom = '2px';
    var btnRemove = document.createElement('button');
    btnRemove.type = 'button';
    btnRemove.className = 'btn btn-ghost btn-sm';
    btnRemove.style.color = 'var(--color-danger)';
    btnRemove.textContent = 'Remove Date';
    btnRemove.addEventListener('click', function () {
      item.parentNode.removeChild(item);
    });
    fieldAction.appendChild(btnRemove);
    row.appendChild(fieldAction);

    item.appendChild(row);
    dom.availabilityList.appendChild(item);
  }

  /* ── Modal Handling ────────────────────────────────────────── */

  function openCreateModal() {
    state.editingPackageId = null;
    if (dom.modalHeading) dom.modalHeading.textContent = 'Create Tour Package';
    if (dom.formPkgId) dom.formPkgId.value = '';
    if (dom.formTitle) dom.formTitle.value = '';
    if (dom.formDestination) dom.formDestination.value = '';
    if (dom.formCategory) dom.formCategory.value = '';
    if (dom.formPrice) dom.formPrice.value = '';
    if (dom.formDuration) dom.formDuration.value = '';
    if (dom.formCapacity) dom.formCapacity.value = '';
    if (dom.formImage) dom.formImage.value = '';
    if (dom.formDescription) dom.formDescription.value = '';
    if (dom.formInclusions) dom.formInclusions.value = '';
    if (dom.formExclusions) dom.formExclusions.value = '';

    // Show availability section for creation
    if (dom.sectionAvail) dom.sectionAvail.hidden = false;

    // Clear dynamic lists
    if (dom.itineraryList) dom.itineraryList.innerHTML = '';
    if (dom.availabilityList) dom.availabilityList.innerHTML = '';

    // Add default Day 1
    addItineraryDay({ day_no: 1, title: 'Day 1: Arrival & Welcome', description: '' });

    clearFormErrors();
    if (dom.pkgModal) dom.pkgModal.hidden = false;
  }

  function editPackage(packageId) {
    state.editingPackageId = packageId;
    if (dom.modalHeading) dom.modalHeading.textContent = 'Edit Package #' + packageId;
    clearFormErrors();

    // Availability is preserved and not edited in PUT per contract
    if (dom.sectionAvail) dom.sectionAvail.hidden = true;

    return api.get('/api/provider/packages/' + packageId).then(function (res) {
      var pkg = (res && res.data) || null;
      if (!pkg) throw new Error('Package data not found');

      if (dom.formPkgId) dom.formPkgId.value = pkg.package_id;
      if (dom.formTitle) dom.formTitle.value = pkg.title || '';
      if (dom.formDestination) dom.formDestination.value = pkg.destination_id || '';
      if (dom.formCategory) dom.formCategory.value = pkg.category_id || '';
      if (dom.formPrice) dom.formPrice.value = pkg.price !== undefined ? pkg.price : '';
      if (dom.formDuration) dom.formDuration.value = pkg.duration_days || '';
      if (dom.formCapacity) dom.formCapacity.value = pkg.capacity || '';
      if (dom.formImage) dom.formImage.value = pkg.image || '';
      if (dom.formDescription) dom.formDescription.value = pkg.description || '';

      if (dom.formInclusions) {
        dom.formInclusions.value = Array.isArray(pkg.inclusions)
          ? pkg.inclusions.join('\n')
          : (pkg.inclusions || '');
      }
      if (dom.formExclusions) {
        dom.formExclusions.value = Array.isArray(pkg.exclusions)
          ? pkg.exclusions.join('\n')
          : (pkg.exclusions || '');
      }

      // Populate itinerary
      if (dom.itineraryList) {
        dom.itineraryList.innerHTML = '';
        if (pkg.itinerary && pkg.itinerary.length > 0) {
          pkg.itinerary.forEach(function (day) {
            addItineraryDay(day);
          });
        } else {
          addItineraryDay({ day_no: 1, title: 'Day 1: Overview', description: '' });
        }
      }

      if (dom.pkgModal) dom.pkgModal.hidden = false;
    }).catch(function (err) {
      console.error('Failed to load package for editing:', err);
      showToast('Could not load package details: ' + (err.message || 'Not found'), 'error');
    });
  }

  function closeModal() {
    if (dom.pkgModal) dom.pkgModal.hidden = true;
    state.editingPackageId = null;
    clearFormErrors();
  }

  function clearFormErrors() {
    if (dom.formErrorAlert) dom.formErrorAlert.hidden = true;
    if (dom.formErrorText) dom.formErrorText.textContent = '';
    if (window.UI && typeof window.UI.clearErrors === 'function' && dom.pkgForm) {
      window.UI.clearErrors(dom.pkgForm);
    }
  }

  function showFormError(message, details) {
    if (dom.formErrorAlert) {
      dom.formErrorAlert.hidden = false;
      if (dom.formErrorText) dom.formErrorText.textContent = message;
    }
    if (details && window.UI && typeof window.UI.showErrors === 'function' && dom.pkgForm) {
      window.UI.showErrors(dom.pkgForm, details);
    }
  }

  /* ── Form Submission (POST Create / PUT Update) ─────────────── */

  function handleFormSubmit(e) {
    if (e) e.preventDefault();
    clearFormErrors();

    var title = (dom.formTitle ? dom.formTitle.value : '').trim();
    var destId = parseInt(dom.formDestination ? dom.formDestination.value : '', 10);
    var catId = parseInt(dom.formCategory ? dom.formCategory.value : '', 10);
    var price = parseFloat(dom.formPrice ? dom.formPrice.value : '');
    var duration = parseInt(dom.formDuration ? dom.formDuration.value : '', 10);
    var capacity = parseInt(dom.formCapacity ? dom.formCapacity.value : '', 10);
    var image = (dom.formImage ? dom.formImage.value : '').trim();
    var description = (dom.formDescription ? dom.formDescription.value : '').trim();

    // Client-side validations
    if (!title) {
      showFormError('Package title is required.', { title: 'Title is required' });
      return Promise.reject(new Error('Validation error: title'));
    }
    if (isNaN(destId) || destId <= 0) {
      showFormError('Please select a valid destination.', { destination_id: 'Destination is required' });
      return Promise.reject(new Error('Validation error: destination_id'));
    }
    if (isNaN(catId) || catId <= 0) {
      showFormError('Please select a valid category.', { category_id: 'Category is required' });
      return Promise.reject(new Error('Validation error: category_id'));
    }
    if (isNaN(price) || price < 0) {
      showFormError('Price must be a valid non-negative number.', { price: 'Valid price is required' });
      return Promise.reject(new Error('Validation error: price'));
    }
    if (isNaN(duration) || duration <= 0) {
      showFormError('Duration must be at least 1 day.', { duration_days: 'Valid duration is required' });
      return Promise.reject(new Error('Validation error: duration_days'));
    }
    if (isNaN(capacity) || capacity <= 0) {
      showFormError('Capacity must be at least 1 traveler.', { capacity: 'Valid capacity is required' });
      return Promise.reject(new Error('Validation error: capacity'));
    }

    var inclusions = parseTextLines(dom.formInclusions ? dom.formInclusions.value : '');
    var exclusions = parseTextLines(dom.formExclusions ? dom.formExclusions.value : '');

    // Itinerary items
    var itinerary = [];
    if (dom.itineraryList) {
      var dayItems = dom.itineraryList.querySelectorAll('.itinerary-item');
      var seenDays = {};
      for (var i = 0; i < dayItems.length; i++) {
        var dayNum = i + 1;
        var titleEl = dayItems[i].querySelector('.itinerary-title-input');
        var descEl = dayItems[i].querySelector('.itinerary-desc-input');
        var dayTitleVal = titleEl ? titleEl.value.trim() : '';
        var dayDescVal = descEl ? descEl.value.trim() : '';

        if (!dayTitleVal) {
          showFormError('Day ' + dayNum + ' itinerary title is required.');
          if (titleEl) titleEl.focus();
          return Promise.reject(new Error('Validation error: itinerary title'));
        }
        if (seenDays[dayNum]) {
          showFormError('Duplicate day ' + dayNum + ' in itinerary.');
          return Promise.reject(new Error('Validation error: duplicate day'));
        }
        seenDays[dayNum] = true;

        itinerary.push({
          day_no: dayNum,
          title: dayTitleVal,
          description: dayDescVal || null
        });
      }
    }

    // Availability items (only when creating)
    var availability = [];
    if (!state.editingPackageId && dom.availabilityList) {
      var dateItems = dom.availabilityList.querySelectorAll('.availability-item');
      var seenDates = {};
      for (var j = 0; j < dateItems.length; j++) {
        var dateEl = dateItems[j].querySelector('.avail-date-input');
        var seatsEl = dateItems[j].querySelector('.avail-seats-input');
        var dateVal = dateEl ? dateEl.value.trim() : '';
        var seatsVal = seatsEl && seatsEl.value.trim() !== '' ? parseInt(seatsEl.value, 10) : capacity;

        if (dateVal) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) {
            showFormError('Departure date must be in YYYY-MM-DD format.');
            if (dateEl) dateEl.focus();
            return Promise.reject(new Error('Validation error: date format'));
          }
          if (seenDates[dateVal]) {
            showFormError('Duplicate departure date ' + dateVal + '.');
            return Promise.reject(new Error('Validation error: duplicate date'));
          }
          seenDates[dateVal] = true;

          availability.push({
            available_date: dateVal,
            seats_available: isNaN(seatsVal) || seatsVal < 0 ? capacity : seatsVal
          });
        }
      }
    }

    // Build payload without provider ownership or status! (Protected fields)
    var payload = {
      title: title,
      destination_id: destId,
      category_id: catId,
      duration_days: duration,
      price: price,
      capacity: capacity,
      description: description || undefined,
      image: image || undefined,
      inclusions: inclusions,
      exclusions: exclusions,
      itinerary: itinerary
    };

    if (window.UI && typeof window.UI.setLoading === 'function') {
      window.UI.setLoading(dom.btnSavePackage, true);
    }

    var submitPromise;
    if (state.editingPackageId) {
      // PUT /api/provider/packages/:id
      submitPromise = api.put('/api/provider/packages/' + state.editingPackageId, payload);
    } else {
      // POST /api/provider/packages (include initial availability)
      if (availability.length > 0) {
        payload.availability = availability;
      }
      submitPromise = api.post('/api/provider/packages', payload);
    }

    return submitPromise.then(function (res) {
      if (window.UI && typeof window.UI.setLoading === 'function') {
        window.UI.setLoading(dom.btnSavePackage, false);
      }
      if (state.editingPackageId) {
        showToast('Package updated successfully.', 'success');
      } else {
        showToast('Package created successfully as PENDING moderation.', 'success');
      }
      closeModal();
      return Promise.all([loadStats(), loadPackages()]);
    }).catch(function (err) {
      if (window.UI && typeof window.UI.setLoading === 'function') {
        window.UI.setLoading(dom.btnSavePackage, false);
      }
      console.error('Package save failed:', err);
      var msg = (err && err.message) || 'Failed to save package.';
      showFormError(msg, err && err.details);
      throw err;
    });
  }

  /* ── View Package Modal ────────────────────────────────────── */

  function viewPackage(packageId) {
    if (!dom.viewModal) return Promise.resolve();

    if (dom.viewModalTitle) dom.viewModalTitle.textContent = 'Package Details #' + packageId;
    if (dom.viewModalBody) dom.viewModalBody.innerHTML = '<div class="loading-row"><div class="spinner"></div><p>Loading...</p></div>';
    dom.viewModal.hidden = false;

    return api.get('/api/provider/packages/' + packageId).then(function (res) {
      var pkg = (res && res.data) || null;
      if (!pkg) throw new Error('Package data not found');

      var html = [];

      html.push('<div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: var(--sp-4); flex-wrap: wrap; gap: var(--sp-2);">');
      html.push('  <div>');
      html.push('    <h3 style="font-size: var(--text-2xl);">' + escapeHtml(pkg.title) + '</h3>');
      html.push('    <p class="text-muted">' + escapeHtml(pkg.destination_name || '') + ' · ' + escapeHtml(pkg.category_name || '') + '</p>');
      html.push('  </div>');
      html.push('  <div>');
      html.push('    <span class="badge badge-' + escapeHtml((pkg.status || '').toLowerCase()) + '" style="font-size: var(--text-sm); padding: var(--sp-1) var(--sp-3);">' + escapeHtml(pkg.status) + '</span>');
      html.push('  </div>');
      html.push('</div>');

      if (pkg.image) {
        html.push('<div style="margin-bottom: var(--sp-4); border-radius: var(--radius-lg); overflow: hidden; max-height: 240px;">');
        html.push('  <img src="' + escapeHtml(pkg.image) + '" alt="' + escapeHtml(pkg.title) + '" style="width: 100%; height: 240px; object-fit: cover;">');
        html.push('</div>');
      }

      html.push('<div class="stats-grid" style="grid-template-columns: repeat(4, 1fr); margin-bottom: var(--sp-5);">');
      html.push('  <div class="stat-card" style="cursor: default;"><span class="stat-label">Price / Person</span><span class="stat-value" style="font-size: var(--text-xl);">' + formatMoney(pkg.price) + '</span></div>');
      html.push('  <div class="stat-card" style="cursor: default;"><span class="stat-label">Duration</span><span class="stat-value" style="font-size: var(--text-xl);">' + pkg.duration_days + ' Days</span></div>');
      html.push('  <div class="stat-card" style="cursor: default;"><span class="stat-label">Max Group</span><span class="stat-value" style="font-size: var(--text-xl);">' + pkg.capacity + ' Travelers</span></div>');
      html.push('  <div class="stat-card" style="cursor: default;"><span class="stat-label">Bookings</span><span class="stat-value" style="font-size: var(--text-xl);">' + (pkg.booking_count || 0) + '</span></div>');
      html.push('</div>');

      if (pkg.description) {
        html.push('<div style="margin-bottom: var(--sp-4);">');
        html.push('  <h4 style="font-size: var(--text-base); margin-bottom: var(--sp-2);">Description</h4>');
        html.push('  <p class="text-sm" style="line-height: var(--leading);">' + escapeHtml(pkg.description) + '</p>');
        html.push('</div>');
      }

      // Inclusions & Exclusions
      var inc = Array.isArray(pkg.inclusions) ? pkg.inclusions : [];
      var exc = Array.isArray(pkg.exclusions) ? pkg.exclusions : [];
      if (inc.length > 0 || exc.length > 0) {
        html.push('<div class="form-row" style="margin-bottom: var(--sp-4);">');
        if (inc.length > 0) {
          html.push('  <div>');
          html.push('    <h4 style="font-size: var(--text-base); margin-bottom: var(--sp-2); color: var(--color-success);">Inclusions</h4>');
          html.push('    <ul style="list-style: disc; padding-left: var(--sp-5); font-size: var(--text-sm);">');
          inc.forEach(function (item) {
            html.push('      <li>' + escapeHtml(item) + '</li>');
          });
          html.push('    </ul>');
          html.push('  </div>');
        }
        if (exc.length > 0) {
          html.push('  <div>');
          html.push('    <h4 style="font-size: var(--text-base); margin-bottom: var(--sp-2); color: var(--color-danger);">Exclusions</h4>');
          html.push('    <ul style="list-style: disc; padding-left: var(--sp-5); font-size: var(--text-sm);">');
          exc.forEach(function (item) {
            html.push('      <li>' + escapeHtml(item) + '</li>');
          });
          html.push('    </ul>');
          html.push('  </div>');
        }
        html.push('</div>');
      }

      // Itinerary
      if (pkg.itinerary && pkg.itinerary.length > 0) {
        html.push('<div style="margin-bottom: var(--sp-4);">');
        html.push('  <h4 style="font-size: var(--text-base); margin-bottom: var(--sp-2);">Day-by-Day Itinerary</h4>');
        pkg.itinerary.forEach(function (day) {
          html.push('  <div style="padding: var(--sp-3); border-left: 3px solid var(--color-primary); background: var(--color-bg); margin-bottom: var(--sp-2); border-radius: var(--radius-sm); font-size: var(--text-sm);">');
          html.push('    <strong style="color: var(--color-primary);">Day ' + day.day_no + ': ' + escapeHtml(day.title) + '</strong>');
          if (day.description) {
            html.push('    <p class="text-muted" style="margin-top: 4px;">' + escapeHtml(day.description) + '</p>');
          }
          html.push('  </div>');
        });
        html.push('</div>');
      }

      // Availability
      if (pkg.availability && pkg.availability.length > 0) {
        html.push('<div style="margin-bottom: var(--sp-4);">');
        html.push('  <h4 style="font-size: var(--text-base); margin-bottom: var(--sp-2);">Departure Dates</h4>');
        html.push('  <div class="table-wrapper"><table class="table" style="font-size: var(--text-sm);">');
        html.push('    <thead><tr><th>Departure Date</th><th>Available Seats</th><th>Status</th></tr></thead>');
        html.push('    <tbody>');
        pkg.availability.forEach(function (avail) {
          html.push('    <tr>');
          html.push('      <td>' + formatDate(avail.available_date) + '</td>');
          html.push('      <td>' + avail.seats_available + ' seats</td>');
          html.push('      <td><span class="badge badge-' + escapeHtml((avail.status || '').toLowerCase()) + '">' + escapeHtml(avail.status) + '</span></td>');
          html.push('    </tr>');
        });
        html.push('    </tbody></table></div>');
        html.push('</div>');
      }

      if (dom.viewModalBody) dom.viewModalBody.innerHTML = html.join('\n');
    }).catch(function (err) {
      console.error('Failed to load package for view:', err);
      if (dom.viewModalBody) {
        dom.viewModalBody.innerHTML = '<div class="alert alert-error"><p>' + escapeHtml(err.message || 'Error loading package details') + '</p></div>';
      }
    });
  }

  function closeViewModal() {
    if (dom.viewModal) dom.viewModal.hidden = true;
  }

  /* ── Event Listeners ───────────────────────────────────────── */

  function setupEvents() {
    // Open Create Modal
    if (dom.btnOpenCreateModal) {
      dom.btnOpenCreateModal.addEventListener('click', openCreateModal);
    }

    // Close Modal buttons
    if (dom.btnCloseModal) {
      dom.btnCloseModal.addEventListener('click', closeModal);
    }
    if (dom.btnCancelModal) {
      dom.btnCancelModal.addEventListener('click', closeModal);
    }

    // Modal background click dismiss
    if (dom.pkgModal) {
      dom.pkgModal.addEventListener('click', function (e) {
        if (e.target === dom.pkgModal) closeModal();
      });
    }

    // View Modal dismiss
    if (dom.btnCloseViewModal) {
      dom.btnCloseViewModal.addEventListener('click', closeViewModal);
    }
    if (dom.btnDismissViewModal) {
      dom.btnDismissViewModal.addEventListener('click', closeViewModal);
    }
    if (dom.viewModal) {
      dom.viewModal.addEventListener('click', function (e) {
        if (e.target === dom.viewModal) closeViewModal();
      });
    }

    // Form submit
    if (dom.pkgForm) {
      dom.pkgForm.addEventListener('submit', handleFormSubmit);
    }

    // Dynamic Itinerary Add Day
    if (dom.btnAddDay) {
      dom.btnAddDay.addEventListener('click', function () {
        addItineraryDay();
      });
    }

    // Dynamic Availability Add Date
    if (dom.btnAddAvailDate) {
      dom.btnAddAvailDate.addEventListener('click', function () {
        addAvailabilityDate();
      });
    }

    // Filter Form search
    if (dom.filterForm) {
      dom.filterForm.addEventListener('submit', function (e) {
        e.preventDefault();
        state.filters.q = (dom.searchInput ? dom.searchInput.value : '').trim();
        state.filters.status = dom.statusFilter ? dom.statusFilter.value : '';
        state.filters.page = 1;
        renderStats();
        loadPackages();
      });
    }

    // Status filter select dropdown change
    if (dom.statusFilter) {
      dom.statusFilter.addEventListener('change', function () {
        state.filters.status = dom.statusFilter.value;
        state.filters.page = 1;
        renderStats();
        loadPackages();
      });
    }

    // Reset filters
    if (dom.btnFilterReset) {
      dom.btnFilterReset.addEventListener('click', function () {
        if (dom.searchInput) dom.searchInput.value = '';
        if (dom.statusFilter) dom.statusFilter.value = '';
        state.filters.q = '';
        state.filters.status = '';
        state.filters.page = 1;
        renderStats();
        loadPackages();
      });
    }

    // Stat cards click to filter
    if (dom.statCards) {
      dom.statCards.forEach(function (card) {
        card.addEventListener('click', function () {
          var targetStatus = card.getAttribute('data-status') || '';
          state.filters.status = targetStatus;
          state.filters.page = 1;
          if (dom.statusFilter) dom.statusFilter.value = targetStatus;
          renderStats();
          loadPackages();
        });
      });
    }

    // Global Escape key to dismiss modals
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (dom.pkgModal && !dom.pkgModal.hidden) closeModal();
        if (dom.viewModal && !dom.viewModal.hidden) closeViewModal();
      }
    });
  }

  /* ── Initialization ────────────────────────────────────────── */

  function init() {
    setupEvents();

    if (!window.Auth || typeof window.Auth.requireRole !== 'function') {
      console.warn('Auth module not available');
      return Promise.resolve();
    }

    // Enforce role: authenticated PROVIDER only
    return window.Auth.requireRole(['PROVIDER']).then(function (user) {
      state.user = user;
      return Promise.all([
        loadMetadata(),
        loadStats(),
        loadPackages()
      ]);
    }).catch(function (err) {
      console.error('Provider authorization failed:', err);
    });
  }

  // Export for testability
  window.ProviderDashboard = {
    state: state,
    dom: dom,
    init: init,
    loadMetadata: loadMetadata,
    loadStats: loadStats,
    loadPackages: loadPackages,
    openCreateModal: openCreateModal,
    editPackage: editPackage,
    closeModal: closeModal,
    handleFormSubmit: handleFormSubmit,
    togglePackageStatus: togglePackageStatus,
    viewPackage: viewPackage,
    closeViewModal: closeViewModal,
    addItineraryDay: addItineraryDay,
    addAvailabilityDate: addAvailabilityDate
  };

  // Run on page load if in browser
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }

})();

