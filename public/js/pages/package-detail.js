/**
 * pages/package-detail.js — Customer package detail and booking handoff
 * Owner: M2 (Meharnaz)
 * Contract: docs/CONTRACT.md — GET /api/packages/:id, POST /api/bookings
 *
 * Depends on: api.js, ui.js, auth.js, layout.js
 */

(function () {
  'use strict';

  /* ── Helper Functions (Pure & Testable) ───────────────────────── */

  /**
   * Extract positive integer package ID from query string.
   * @param {string} [search] URL query string (defaults to window.location.search)
   * @returns {number|null}
   */
  function extractPackageId(search) {
    var qs = typeof search === 'string' ? search : (typeof window !== 'undefined' ? window.location.search : '');
    var params = new URLSearchParams(qs);
    var raw = params.get('id');
    if (!raw) return null;
    var trimmed = String(raw).trim();
    if (!/^\d+$/.test(trimmed)) return null;
    var num = Number(trimmed);
    if (!Number.isSafeInteger(num) || num <= 0) return null;
    return num;
  }

  /**
   * Format image URL to handle absolute, relative, or seeded paths.
   * @param {string|null} image
   * @returns {string|null}
   */
  function formatImageUrl(image) {
    if (!image || typeof image !== 'string') return null;
    var trimmed = image.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('/')) {
      return trimmed;
    }
    if (trimmed.startsWith('images/')) {
      return '/' + trimmed;
    }
    return '/images/' + trimmed;
  }

  /**
   * Calculate total booking price.
   * @param {number} price Unit price per person
   * @param {number} travelers Number of travelers
   * @returns {number}
   */
  function calculateTotal(price, travelers) {
    var p = Number(price);
    var t = Number(travelers);
    if (!Number.isFinite(p) || p < 0 || !Number.isInteger(t) || t <= 0) {
      return 0;
    }
    return Math.round(p * t * 100) / 100;
  }

  /**
   * Validate booking input before submitting.
   * @param {number|string} availabilityId
   * @param {number|string} travelers
   * @param {number} availableSeats Seats left on chosen date
   * @param {number} [maxCapacity] Package max capacity
   * @returns {{ valid: boolean, error?: string, field?: string }}
   */
  function validateBooking(availabilityId, travelers, availableSeats, maxCapacity) {
    var aId = Number(availabilityId);
    if (!availabilityId || !Number.isInteger(aId) || aId <= 0) {
      return { valid: false, error: 'Please select a departure date.', field: 'availability_id' };
    }

    var t = Number(travelers);
    if (!travelers || !Number.isInteger(t) || t < 1) {
      return { valid: false, error: 'Please enter at least 1 traveler.', field: 'travelers' };
    }

    if (availableSeats !== undefined && availableSeats !== null) {
      var seats = Number(availableSeats);
      if (t > seats) {
        return {
          valid: false,
          error: 'Only ' + seats + ' seat' + (seats !== 1 ? 's are' : ' is') + ' available for this date.',
          field: 'travelers'
        };
      }
    }

    if (maxCapacity && Number.isInteger(Number(maxCapacity)) && Number(maxCapacity) > 0) {
      if (t > Number(maxCapacity)) {
        return {
          valid: false,
          error: 'Travelers cannot exceed package capacity (' + maxCapacity + ').',
          field: 'travelers'
        };
      }
    }

    if (t > 10) {
      return {
        valid: false,
        error: 'Travelers cannot exceed 10 per booking.',
        field: 'travelers'
      };
    }

    return { valid: true };
  }

  /**
   * Construct POST /api/bookings request payload.
   * @param {number|string} packageId
   * @param {number|string} availabilityId
   * @param {number|string} travelers
   * @returns {{ package_id: number, availability_id: number, travelers: number }}
   */
  function buildBookingPayload(packageId, availabilityId, travelers) {
    return {
      package_id: Number(packageId),
      availability_id: Number(availabilityId),
      travelers: Number(travelers)
    };
  }

  /* ── DOM Population & Rendering ────────────────────────────────── */

  var currentPackage = null;
  var currentUser = null;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function showLoadingState() {
    var loadingEl = document.getElementById('detail-loading');
    var errorEl   = document.getElementById('detail-error');
    var contentEl = document.getElementById('detail-content');
    if (loadingEl) loadingEl.hidden = false;
    if (errorEl)   errorEl.hidden = true;
    if (contentEl) contentEl.hidden = true;
  }

  function showErrorState(title, message) {
    var loadingEl = document.getElementById('detail-loading');
    var errorEl   = document.getElementById('detail-error');
    var contentEl = document.getElementById('detail-content');
    if (loadingEl) loadingEl.hidden = true;
    if (contentEl) contentEl.hidden = true;
    if (errorEl) {
      errorEl.hidden = false;
      var titleEl = document.getElementById('detail-error-title');
      var msgEl   = document.getElementById('detail-error-message');
      if (titleEl && title) titleEl.textContent = title;
      if (msgEl && message) msgEl.textContent = message;
    }
  }

  function showContentState() {
    var loadingEl = document.getElementById('detail-loading');
    var errorEl   = document.getElementById('detail-error');
    var contentEl = document.getElementById('detail-content');
    if (loadingEl) loadingEl.hidden = true;
    if (errorEl)   errorEl.hidden = true;
    if (contentEl) contentEl.hidden = false;
  }

  /**
   * Render package data into DOM elements.
   * @param {object} pkg Package data object from GET /api/packages/:id
   * @param {object|null} user Current user from Auth.getUser()
   */
  function renderPackage(pkg, user) {
    currentPackage = pkg;
    currentUser = user || null;

    // Breadcrumb title
    var bcTitle = document.getElementById('breadcrumb-title');
    if (bcTitle) bcTitle.textContent = pkg.title || 'Package Details';

    // Header elements
    var catBadge = document.getElementById('pkg-category-badge');
    if (catBadge) {
      catBadge.textContent = pkg.category_name || (pkg.category && pkg.category.name) || 'General';
    }

    var statusBadge = document.getElementById('pkg-status-badge');
    if (statusBadge) {
      if (pkg.status && pkg.status !== 'APPROVED') {
        statusBadge.hidden = false;
        statusBadge.textContent = pkg.status;
        statusBadge.className = 'badge badge-' + pkg.status.toLowerCase();
      } else {
        statusBadge.hidden = true;
      }
    }

    var titleEl = document.getElementById('pkg-title');
    if (titleEl) titleEl.textContent = pkg.title;

    var destPlace = [
      pkg.destination_name || (pkg.destination && pkg.destination.name),
      pkg.state || (pkg.destination && pkg.destination.state)
    ].filter(Boolean).join(', ');

    var destEl = document.getElementById('pkg-destination');
    if (destEl) destEl.textContent = destPlace ? '📍 ' + destPlace : '';

    var durationEl = document.getElementById('pkg-duration');
    if (durationEl) {
      var days = Number(pkg.duration_days) || 1;
      durationEl.textContent = '🗓 ' + days + ' day' + (days !== 1 ? 's' : '');
    }

    var ratingEl = document.getElementById('pkg-rating');
    if (ratingEl) {
      if (pkg.rating && typeof pkg.rating.avg === 'number' && pkg.rating.avg > 0) {
        var count = pkg.rating.count || 0;
        ratingEl.textContent = '⭐ ' + pkg.rating.avg.toFixed(1) + ' (' + count + ' review' + (count !== 1 ? 's' : '') + ')';
      } else {
        ratingEl.textContent = '⭐ New (No reviews yet)';
      }
    }

    // Image handling
    var imgEl = document.getElementById('pkg-image');
    var phEl  = document.getElementById('pkg-image-placeholder');
    var imgUrl = formatImageUrl(pkg.image);

    if (imgUrl && imgEl) {
      imgEl.src = imgUrl;
      imgEl.alt = pkg.title || 'Package banner';
      imgEl.hidden = false;
      if (phEl) phEl.hidden = true;

      imgEl.onerror = function () {
        imgEl.hidden = true;
        if (phEl) phEl.hidden = false;
      };
    } else {
      if (imgEl) imgEl.hidden = true;
      if (phEl) phEl.hidden = false;
    }

    // Overview & Description
    var descEl = document.getElementById('pkg-description');
    if (descEl) descEl.textContent = pkg.description || 'No description provided.';

    var specDur = document.getElementById('spec-duration');
    if (specDur) {
      var d = Number(pkg.duration_days) || 1;
      specDur.textContent = d + ' Day' + (d !== 1 ? 's' : '');
    }

    var specCap = document.getElementById('spec-capacity');
    if (specCap) {
      specCap.textContent = pkg.capacity ? 'Up to ' + pkg.capacity + ' people' : 'Standard group';
    }

    var specProv = document.getElementById('spec-provider');
    if (specProv) {
      var pName = pkg.provider_name || (pkg.provider && pkg.provider.name) || 'Verified Provider';
      var pLoc = [pkg.provider && pkg.provider.city, pkg.provider && pkg.provider.state].filter(Boolean).join(', ');
      specProv.textContent = pLoc ? pName + ' (' + pLoc + ')' : pName;
    }

    // Destination Section
    var destSec = document.getElementById('pkg-dest-section');
    var destNameEl = document.getElementById('pkg-dest-name');
    var destDescEl = document.getElementById('pkg-dest-desc');
    if (destSec) {
      var dName = pkg.destination_name || (pkg.destination && pkg.destination.name);
      var dDesc = pkg.destination && pkg.destination.description;
      if (dDesc) {
        destSec.hidden = false;
        if (destNameEl) destNameEl.textContent = dName || 'Destination Highlights';
        if (destDescEl) destDescEl.textContent = dDesc;
      } else {
        destSec.hidden = true;
      }
    }

    // Day-wise Itinerary
    var itinList = document.getElementById('pkg-itinerary-list');
    if (itinList) {
      itinList.innerHTML = '';
      var items = pkg.itinerary || [];
      if (items.length > 0) {
        items.slice().sort(function (a, b) { return a.day_no - b.day_no; }).forEach(function (day) {
          var dayDiv = el('div', 'itinerary-day');
          dayDiv.appendChild(el('div', 'itinerary-day-num', 'Day ' + day.day_no));
          dayDiv.appendChild(el('h4', 'itinerary-day-title', day.title || 'Day ' + day.day_no));
          if (day.description) {
            dayDiv.appendChild(el('p', 'itinerary-day-desc', day.description));
          }
          itinList.appendChild(dayDiv);
        });
      } else {
        var emptyItin = el('p', 'text-muted', 'Detailed daily itinerary will be provided upon booking.');
        itinList.appendChild(emptyItin);
      }
    }

    // Inclusions
    var incList = document.getElementById('pkg-inclusions-list');
    if (incList) {
      incList.innerHTML = '';
      var incs = Array.isArray(pkg.inclusions) ? pkg.inclusions : [];
      if (incs.length > 0) {
        incs.forEach(function (inc) {
          var li = el('li', 'check-item');
          var icon = el('span', 'check-icon-success', '✓');
          icon.setAttribute('aria-hidden', 'true');
          li.appendChild(icon);
          li.appendChild(el('span', null, inc));
          incList.appendChild(li);
        });
      } else {
        incList.appendChild(el('li', 'text-muted text-sm', 'No specific inclusions listed.'));
      }
    }

    // Exclusions
    var excList = document.getElementById('pkg-exclusions-list');
    if (excList) {
      excList.innerHTML = '';
      var excs = Array.isArray(pkg.exclusions) ? pkg.exclusions : [];
      if (excs.length > 0) {
        excs.forEach(function (exc) {
          var li = el('li', 'check-item');
          var icon = el('span', 'check-icon-danger', '✕');
          icon.setAttribute('aria-hidden', 'true');
          li.appendChild(icon);
          li.appendChild(el('span', null, exc));
          excList.appendChild(li);
        });
      } else {
        excList.appendChild(el('li', 'text-muted text-sm', 'No specific exclusions listed.'));
      }
    }

    // Available Dates Table
    var datesContainer = document.getElementById('pkg-dates-container');
    var dateSelect = document.getElementById('booking-date');
    var dates = (pkg.availability || []).filter(function (a) {
      return a.status === 'OPEN' && Number(a.seats_available) > 0;
    });

    if (datesContainer) {
      datesContainer.innerHTML = '';
      if (dates.length > 0) {
        var tableWrap = el('div', 'table-wrapper');
        var table = el('table', 'table');
        var thead = el('thead');
        var trHead = el('tr');
        trHead.appendChild(el('th', null, 'Departure Date'));
        trHead.appendChild(el('th', null, 'Seats Available'));
        trHead.appendChild(el('th', null, 'Status'));
        thead.appendChild(trHead);
        table.appendChild(thead);

        var tbody = el('tbody');
        dates.forEach(function (a) {
          var tr = el('tr');
          var formattedDate = window.UI && typeof window.UI.date === 'function'
            ? window.UI.date(a.available_date)
            : a.available_date;
          tr.appendChild(el('td', 'font-medium', formattedDate));
          tr.appendChild(el('td', null, a.seats_available + ' seat' + (a.seats_available !== 1 ? 's' : '')));
          var tdStatus = el('td');
          var badge = el('span', 'badge badge-active', 'OPEN');
          tdStatus.appendChild(badge);
          tr.appendChild(tdStatus);
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        tableWrap.appendChild(table);
        datesContainer.appendChild(tableWrap);
      } else {
        datesContainer.appendChild(
          el('p', 'text-muted mb-0', 'No upcoming departures are currently scheduled for this package.')
        );
      }
    }

    // Populate Booking Sidebar Form
    renderBookingSidebar(pkg, dates, user);

    // Show ready content state
    showContentState();
  }

  /**
   * Render and bind booking sidebar inputs and auth status.
   */
  function renderBookingSidebar(pkg, dates, user) {
    var cardPrice = document.getElementById('booking-card-price');
    var unitPrice = document.getElementById('summary-unit-price');
    var moneyStr = window.UI && typeof window.UI.money === 'function' ? window.UI.money(pkg.price) : '₹' + pkg.price;
    if (cardPrice) cardPrice.textContent = moneyStr;
    if (unitPrice) unitPrice.textContent = moneyStr;

    var dateSelect = document.getElementById('booking-date');
    if (dateSelect) {
      while (dateSelect.options.length > 0) dateSelect.remove(0);

      if (dates && dates.length > 0) {
        dateSelect.disabled = false;
        var defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.textContent = 'Select departure date';
        dateSelect.appendChild(defaultOpt);

        dates.forEach(function (a) {
          var opt = document.createElement('option');
          opt.value = String(a.availability_id);
          var formatted = window.UI && typeof window.UI.date === 'function'
            ? window.UI.date(a.available_date)
            : a.available_date;
          opt.textContent = formatted + ' (' + a.seats_available + ' seat' + (a.seats_available !== 1 ? 's' : '') + ' left)';
          opt.setAttribute('data-seats', String(a.seats_available));
          dateSelect.appendChild(opt);
        });
      } else {
        dateSelect.disabled = true;
        var noOpt = document.createElement('option');
        noOpt.value = '';
        noOpt.textContent = 'No dates available';
        dateSelect.appendChild(noOpt);
      }
    }

    var travelersInput = document.getElementById('booking-travelers');
    if (travelersInput) {
      travelersInput.value = '1';
      travelersInput.disabled = !dates || dates.length === 0;
    }

    updatePriceSummary();
    renderBookingAction(dates, user);
  }

  /**
   * Update the live price summary card based on form values.
   */
  function updatePriceSummary() {
    if (!currentPackage) return;
    var travelersInput = document.getElementById('booking-travelers');
    var count = travelersInput ? parseInt(travelersInput.value, 10) : 1;
    if (isNaN(count) || count < 1) count = 1;

    var summaryCount = document.getElementById('summary-count');
    if (summaryCount) summaryCount.textContent = String(count);

    var total = calculateTotal(currentPackage.price, count);
    var summaryTotal = document.getElementById('summary-total');
    if (summaryTotal) {
      summaryTotal.textContent = window.UI && typeof window.UI.money === 'function'
        ? window.UI.money(total)
        : '₹' + total.toFixed(2);
    }
  }

  /**
   * Render the booking button or authentication prompt.
   */
  function renderBookingAction(dates, user) {
    var container = document.getElementById('booking-action-container');
    if (!container) return;
    container.innerHTML = '';

    // If no open dates exist
    if (!dates || dates.length === 0) {
      var noDateAlert = el('div', 'alert alert-warning', null);
      noDateAlert.style.marginBottom = 'var(--sp-4)';
      var body = el('div', 'alert-body', 'No departure dates currently open for booking.');
      noDateAlert.appendChild(body);
      container.appendChild(noDateAlert);

      var disabledBtn = el('button', 'btn btn-secondary btn-block btn-lg', 'No Dates Available');
      disabledBtn.type = 'button';
      disabledBtn.disabled = true;
      container.appendChild(disabledBtn);
      return;
    }

    // Not logged in
    if (!user) {
      var authPrompt = el('div', 'alert alert-info', null);
      authPrompt.style.marginBottom = 'var(--sp-4)';
      authPrompt.appendChild(el('div', 'alert-body text-sm', 'Please log in as a customer to book this package.'));
      container.appendChild(authPrompt);

      var loginBtn = el('button', 'btn btn-primary btn-block btn-lg', 'Sign In to Book');
      loginBtn.type = 'button';
      loginBtn.id = 'btn-login-to-book';
      loginBtn.addEventListener('click', function () {
        if (window.Auth && typeof window.Auth.redirectToLogin === 'function') {
          window.Auth.redirectToLogin();
        } else {
          var next = encodeURIComponent(window.location.pathname + window.location.search);
          window.location.href = '/login.html?next=' + next;
        }
      });
      container.appendChild(loginBtn);
      return;
    }

    // Logged in as non-CUSTOMER (PROVIDER or ADMIN or SUPER_ADMIN)
    if (user.role !== 'CUSTOMER') {
      var roleAlert = el('div', 'alert alert-warning', null);
      roleAlert.style.marginBottom = 'var(--sp-4)';
      roleAlert.appendChild(
        el('div', 'alert-body text-sm', 'You are signed in as ' + user.role + '. Only customer accounts can book packages.')
      );
      container.appendChild(roleAlert);

      var noCustBtn = el('button', 'btn btn-secondary btn-block btn-lg', 'Booking Unavailable for ' + user.role);
      noCustBtn.type = 'button';
      noCustBtn.disabled = true;
      container.appendChild(noCustBtn);
      return;
    }

    // Logged in as CUSTOMER
    var custNote = el('p', 'text-muted text-xs text-center', 'Booking as ' + (user.name || user.email));
    custNote.style.marginBottom = 'var(--sp-2)';
    container.appendChild(custNote);

    var submitBtn = el('button', 'btn btn-primary btn-block btn-lg', 'Confirm Booking');
    submitBtn.type = 'submit';
    submitBtn.id = 'btn-submit-booking';
    container.appendChild(submitBtn);
  }

  /**
   * Submit booking to backend API.
   * @param {object} payload { package_id, availability_id, travelers }
   * @returns {Promise<object>}
   */
  function submitBooking(payload) {
    var formError = document.getElementById('booking-form-error');
    var errText = document.getElementById('booking-error-text');
    var submitBtn = document.getElementById('btn-submit-booking');

    if (formError) formError.hidden = true;
    if (submitBtn) {
      submitBtn.setAttribute('aria-busy', 'true');
      submitBtn.disabled = true;
    }

    return window.api.post('/api/bookings', payload, { skipAuthRedirect: true })
      .then(function (res) {
        if (submitBtn) {
          submitBtn.removeAttribute('aria-busy');
          submitBtn.disabled = false;
        }

        var booking = res && res.data ? res.data : res;
        handleBookingSuccess(booking, payload);
        return booking;
      })
      .catch(function (err) {
        if (submitBtn) {
          submitBtn.removeAttribute('aria-busy');
          submitBtn.disabled = false;
        }

        if (err && err.status === 401) {
          if (window.Auth && typeof window.Auth.redirectToLogin === 'function') {
            window.Auth.redirectToLogin();
            return;
          }
        }

        var message = (err && err.message) || 'Booking could not be created. Please try again.';
        if (formError && errText) {
          errText.textContent = message;
          formError.hidden = false;
        }
        if (window.UI && typeof window.UI.toast === 'function') {
          window.UI.toast(message, 'error');
        }
        throw err;
      });
  }

  /**
   * Display booking confirmation view on success.
   */
  function handleBookingSuccess(booking, payload) {
    var form = document.getElementById('booking-form');
    var successCard = document.getElementById('booking-success');
    if (form) form.hidden = true;
    if (successCard) successCard.hidden = false;

    var dateSelect = document.getElementById('booking-date');
    var selectedOpt = dateSelect && dateSelect.selectedIndex >= 0 ? dateSelect.options[dateSelect.selectedIndex] : null;
    var dateLabel = selectedOpt ? selectedOpt.textContent.split(' (')[0] : 'Scheduled date';

    var idEl = document.getElementById('success-booking-id');
    if (idEl) idEl.textContent = '#' + (booking.booking_id || '-');

    var pkgEl = document.getElementById('success-pkg-title');
    if (pkgEl && currentPackage) pkgEl.textContent = currentPackage.title || 'Tour Package';

    var dateEl = document.getElementById('success-date');
    if (dateEl) dateEl.textContent = dateLabel;

    var travEl = document.getElementById('success-travelers');
    if (travEl) travEl.textContent = String(payload.travelers);

    var amtEl = document.getElementById('success-amount');
    if (amtEl) {
      var total = booking.total_amount !== undefined ? booking.total_amount : calculateTotal(currentPackage.price, payload.travelers);
      amtEl.textContent = window.UI && typeof window.UI.money === 'function' ? window.UI.money(total) : '₹' + total;
    }

    var statusEl = document.getElementById('success-status');
    if (statusEl) statusEl.textContent = booking.booking_status || 'PENDING';

    var payEl = document.getElementById('success-payment');
    if (payEl) payEl.textContent = booking.payment_status || 'UNPAID';

    if (window.UI && typeof window.UI.toast === 'function') {
      window.UI.toast('Booking created successfully! Reference #' + booking.booking_id, 'success');
    }
  }

  /* ── Initialization ────────────────────────────────────────────── */

  function init() {
    var packageId = extractPackageId();
    if (!packageId) {
      showErrorState('Invalid Package ID', 'Please select a valid package from our catalog.');
      return;
    }

    showLoadingState();

    var userPromise = window.Auth && typeof window.Auth.getUser === 'function'
      ? window.Auth.getUser()
      : Promise.resolve(null);

    var packagePromise = window.api.get('/api/packages/' + encodeURIComponent(packageId));

    Promise.all([packagePromise, userPromise])
      .then(function (results) {
        var pkgRes = results[0];
        var user = results[1];
        var pkg = pkgRes && pkgRes.data ? pkgRes.data : pkgRes;

        if (!pkg || !pkg.package_id) {
          showErrorState('Package Not Found', 'This tour package is not available or does not exist.');
          return;
        }

        renderPackage(pkg, user);
        bindEvents();
      })
      .catch(function (err) {
        if (err && err.status === 404) {
          showErrorState('Package Not Available', 'This tour package was not found or is no longer listed.');
        } else {
          showErrorState('Connection Error', (err && err.message) || 'Unable to load tour package details.');
        }
      });
  }

  function bindEvents() {
    var dateSelect = document.getElementById('booking-date');
    var travelersInput = document.getElementById('booking-travelers');
    var travelersHint = document.getElementById('booking-travelers-hint');
    var bookingForm = document.getElementById('booking-form');

    if (dateSelect) {
      dateSelect.addEventListener('change', function () {
        var opt = dateSelect.options[dateSelect.selectedIndex];
        var seats = opt ? opt.getAttribute('data-seats') : null;
        if (seats && travelersInput) {
          var seatNum = parseInt(seats, 10);
          var cap = currentPackage && currentPackage.capacity ? Number(currentPackage.capacity) : 10;
          var maxAllowed = Math.min(seatNum, cap, 10);
          travelersInput.max = String(maxAllowed);
          if (travelersHint) {
            travelersHint.textContent = seatNum + ' seat' + (seatNum !== 1 ? 's' : '') + ' remaining (Max: ' + maxAllowed + ')';
          }
          if (parseInt(travelersInput.value, 10) > maxAllowed) {
            travelersInput.value = String(maxAllowed);
          }
        }
        updatePriceSummary();
      });
    }

    if (travelersInput) {
      travelersInput.addEventListener('input', function () {
        updatePriceSummary();
      });
    }

    if (bookingForm) {
      bookingForm.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!currentPackage) return;

        var aId = dateSelect ? dateSelect.value : '';
        var tVal = travelersInput ? travelersInput.value : '';

        var opt = dateSelect && dateSelect.selectedIndex >= 0 ? dateSelect.options[dateSelect.selectedIndex] : null;
        var seats = opt ? parseInt(opt.getAttribute('data-seats'), 10) : null;

        var validation = validateBooking(aId, tVal, seats, currentPackage.capacity);
        if (!validation.valid) {
          var formError = document.getElementById('booking-form-error');
          var errText = document.getElementById('booking-error-text');
          if (formError && errText) {
            errText.textContent = validation.error;
            formError.hidden = false;
          }
          if (window.UI && typeof window.UI.toast === 'function') {
            window.UI.toast(validation.error, 'error');
          }
          return;
        }

        var payload = buildBookingPayload(currentPackage.package_id, aId, tVal);
        submitBooking(payload);
      });
    }

    // Re-render auth action if session changes
    if (typeof window !== 'undefined') {
      window.addEventListener('auth:change', function (e) {
        currentUser = e.detail || null;
        if (currentPackage) {
          var dates = (currentPackage.availability || []).filter(function (a) {
            return a.status === 'OPEN' && Number(a.seats_available) > 0;
          });
          renderBookingAction(dates, currentUser);
        }
      });
    }
  }

  // Auto-init on page load if running in browser
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }

  // Expose module functions for unit & integration testing
  if (typeof window !== 'undefined') {
    window.PackageDetailPage = {
      extractPackageId:      extractPackageId,
      formatImageUrl:        formatImageUrl,
      calculateTotal:        calculateTotal,
      validateBooking:       validateBooking,
      buildBookingPayload:   buildBookingPayload,
      renderPackage:         renderPackage,
      submitBooking:         submitBooking,
      init:                  init
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      extractPackageId:      extractPackageId,
      formatImageUrl:        formatImageUrl,
      calculateTotal:        calculateTotal,
      validateBooking:       validateBooking,
      buildBookingPayload:   buildBookingPayload
    };
  }

}());
