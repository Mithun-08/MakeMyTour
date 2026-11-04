/**
 * booking-detail.js — Customer Booking Detail Page Controller
 * Owner: M2 takeover
 * Phase 2, Task 5 & 6: Data Loading, Rendering, Actions, and Modal Workflows
 *
 * Scope:
 *  - Enforces authenticated CUSTOMER role via Auth.requireRole(['CUSTOMER']).
 *  - Reads booking ID from URL query parameter `id`.
 *  - Handles missing or invalid booking IDs.
 *  - Fetches booking detail from GET /api/bookings/:id using api.js.
 *  - Renders all booking, package, schedule, contact, pricing, payment, and review info.
 *  - Enforces contextual visibility for payment controls (unpaid, non-cancelled only).
 *  - Respects backend `can_cancel` and `can_review` flags directly.
 *  - Displays existing review when present instead of review trigger.
 *  - Manages UI states: loading, error (with in-page retry), and success.
 *  - Protects against stale out-of-order network responses (activeRequestId).
 *  - Payment Workflow: POST /api/bookings/:id/pay with { payment_method }.
 *  - Cancellation Workflow: Accessible modal dialog & POST /api/bookings/:id/cancel.
 *  - Review Workflow: Accessible modal dialog with 1-5 star ratings & POST /api/reviews.
 *  - Modal Accessibility: Escape to close, backdrop dismiss, focus restoration, body scroll locking.
 *  - Prevents duplicate submissions and manages button loading states.
 *  - Exported as window.BookingDetail for automated testability.
 */

(function () {
  'use strict';

  /* ── State ─────────────────────────────────────────────────── */
  var state = {
    user: null,
    bookingId: null,
    booking: null,
    isLoading: false,
    isSubmittingPayment: false,
    isSubmittingCancel: false,
    isSubmittingReview: false,
    lastFocusedTrigger: null,
    _eventsAttached: false
  };

  /* ── DOM References ────────────────────────────────────────── */
  var dom = {};

  function refreshDom() {
    // UI States
    dom.loadingEl = document.getElementById('detail-loading');
    dom.errorEl = document.getElementById('detail-error');
    dom.errorMsgEl = document.getElementById('detail-error-msg');
    dom.btnRetry = document.getElementById('btn-retry-detail');
    dom.contentEl = document.getElementById('detail-content');

    // Breadcrumb & Header
    dom.breadcrumbId = document.getElementById('breadcrumb-booking-id');
    dom.heading = document.getElementById('detail-booking-heading');
    dom.bookingIdText = document.getElementById('detail-booking-id-text');
    dom.bookingStatusBadge = document.getElementById('detail-booking-status-badge');
    dom.paymentStatusBadge = document.getElementById('detail-payment-status-badge');
    dom.btnPrint = document.getElementById('btn-print-booking');

    // Package Section
    dom.packageImage = document.getElementById('detail-package-image');
    dom.packageTitle = document.getElementById('detail-package-title');
    dom.packageLink = document.getElementById('detail-package-link');
    dom.packageDuration = document.getElementById('detail-package-duration');
    dom.packagePrice = document.getElementById('detail-package-price');
    dom.packageDescription = document.getElementById('detail-package-description');

    // Travel & Schedule Section
    dom.availableDate = document.getElementById('detail-available-date');
    dom.travelers = document.getElementById('detail-travelers');
    dom.bookedAt = document.getElementById('detail-booked-at');
    dom.seatsInfo = document.getElementById('detail-seats-info');

    // Contacts (Parties)
    dom.customerName = document.getElementById('detail-customer-name');
    dom.customerEmail = document.getElementById('detail-customer-email');
    dom.customerMobile = document.getElementById('detail-customer-mobile');
    dom.providerName = document.getElementById('detail-provider-name');
    dom.providerEmail = document.getElementById('detail-provider-email');
    dom.providerMobile = document.getElementById('detail-provider-mobile');

    // Pricing & Sidebar Summary
    dom.rateBreakdown = document.getElementById('detail-rate-breakdown');
    dom.travelersBreakdown = document.getElementById('detail-travelers-breakdown');
    dom.totalAmount = document.getElementById('detail-total-amount');
    dom.sidebarPaymentBadge = document.getElementById('detail-sidebar-payment-badge');
    dom.paidInfo = document.getElementById('detail-paid-info');
    dom.paymentId = document.getElementById('detail-payment-id');
    dom.paidAt = document.getElementById('detail-paid-at');
    dom.paidMethod = document.getElementById('detail-paid-method');

    // Payment Section
    dom.paymentSection = document.getElementById('payment-section');
    dom.paymentForm = document.getElementById('payment-form');
    dom.paymentErrorAlert = document.getElementById('payment-error-alert');
    dom.paymentErrorText = document.getElementById('payment-error-text');
    dom.btnPayNow = document.getElementById('btn-pay-now');
    dom.payAmountDisplay = document.getElementById('pay-amount-display');

    // Contextual Action Triggers
    dom.btnOpenCancelModal = document.getElementById('btn-open-cancel-modal');
    dom.btnOpenReviewModal = document.getElementById('btn-open-review-modal');

    // Existing Review Display Section
    dom.existingReviewSection = document.getElementById('existing-review-section');
    dom.detailReviewRating = document.getElementById('detail-review-rating');
    dom.detailReviewComment = document.getElementById('detail-review-comment');
    dom.detailReviewDate = document.getElementById('detail-review-date');

    // Cancellation Modal Elements
    dom.cancelModal = document.getElementById('cancel-modal');
    dom.btnCloseCancelModal = document.getElementById('btn-close-cancel-modal');
    dom.btnDismissCancelModal = document.getElementById('btn-dismiss-cancel-modal');
    dom.btnConfirmCancel = document.getElementById('btn-confirm-cancel');
    dom.cancelErrorAlert = document.getElementById('cancel-error-alert');
    dom.cancelErrorText = document.getElementById('cancel-error-text');
    dom.cancelModalBookingId = document.getElementById('cancel-modal-booking-id');
    dom.cancelModalPackageTitle = document.getElementById('cancel-modal-package-title');

    // Review Modal Elements
    dom.reviewModal = document.getElementById('review-modal');
    dom.reviewForm = document.getElementById('review-form');
    dom.btnCloseReviewModal = document.getElementById('btn-close-review-modal');
    dom.btnDismissReviewModal = document.getElementById('btn-dismiss-review-modal');
    dom.btnSubmitReview = document.getElementById('btn-submit-review');
    dom.reviewErrorAlert = document.getElementById('review-error-alert');
    dom.reviewErrorText = document.getElementById('review-error-text');
    dom.reviewRatingFeedback = document.getElementById('review-rating-feedback');
    dom.reviewComment = document.getElementById('review-comment');
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

  function createBadge(status) {
    if (window.UI && typeof window.UI.statusBadge === 'function') {
      return window.UI.statusBadge(status);
    }
    var span = document.createElement('span');
    var s = status || 'UNKNOWN';
    span.className = 'badge badge-' + String(s).toLowerCase();
    span.textContent = s;
    return span;
  }

  function getBookingIdFromUrl() {
    try {
      if (typeof window === 'undefined' || !window.location) return null;
      var params = new URLSearchParams(window.location.search);
      var raw = params.get('id');
      if (!raw) return null;
      var clean = String(raw).trim();
      if (!/^\d+$/.test(clean)) return null;
      var num = Number(clean);
      return Number.isSafeInteger(num) && num > 0 ? num : null;
    } catch (e) {
      return null;
    }
  }

  /* ── UI State Toggles ──────────────────────────────────────── */

  function showLoading() {
    refreshDom();
    if (dom.loadingEl) dom.loadingEl.hidden = false;
    if (dom.errorEl) dom.errorEl.hidden = true;
    if (dom.contentEl) dom.contentEl.hidden = true;
  }

  function showError(message, status) {
    refreshDom();
    if (dom.loadingEl) dom.loadingEl.hidden = true;
    if (dom.contentEl) dom.contentEl.hidden = true;
    if (dom.errorEl) {
      dom.errorEl.hidden = false;

      var friendlyMsg = message;
      if (status === 404) {
        friendlyMsg = 'Booking not found. The requested reservation does not exist or has been removed.';
      } else if (status === 403) {
        friendlyMsg = 'Access denied. You do not have permission to view this booking.';
      } else if (status === 400 || !state.bookingId) {
        friendlyMsg = 'Invalid or missing booking ID. Please return to your bookings list and select a valid booking.';
      }

      if (dom.errorMsgEl) {
        dom.errorMsgEl.textContent = friendlyMsg || 'Unable to load booking details.';
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

  /* ── Form Error Alerts ─────────────────────────────────────── */

  function showPaymentError(msg) {
    refreshDom();
    if (dom.paymentErrorAlert) dom.paymentErrorAlert.hidden = false;
    if (dom.paymentErrorText) dom.paymentErrorText.textContent = msg || 'Payment error occurred.';
  }

  function hidePaymentError() {
    refreshDom();
    if (dom.paymentErrorAlert) dom.paymentErrorAlert.hidden = true;
  }

  function showCancelError(msg) {
    refreshDom();
    if (dom.cancelErrorAlert) dom.cancelErrorAlert.hidden = false;
    if (dom.cancelErrorText) dom.cancelErrorText.textContent = msg || 'Cancellation error occurred.';
  }

  function hideCancelError() {
    refreshDom();
    if (dom.cancelErrorAlert) dom.cancelErrorAlert.hidden = true;
  }

  function showReviewError(msg) {
    refreshDom();
    if (dom.reviewErrorAlert) dom.reviewErrorAlert.hidden = false;
    if (dom.reviewErrorText) dom.reviewErrorText.textContent = msg || 'Review submission error occurred.';
  }

  function hideReviewError() {
    refreshDom();
    if (dom.reviewErrorAlert) dom.reviewErrorAlert.hidden = true;
  }

  /* ── Core Rendering ────────────────────────────────────────── */

  /**
   * Populates the HTML structure with booking detail data from the backend.
   * Handles optional fields gracefully and sets contextual visibility.
   *
   * @param {Object} b Booking detail object from GET /api/bookings/:id
   */
  function renderDetail(b) {
    if (!b || typeof b !== 'object') {
      showError('Invalid booking data received from server.', 500);
      return;
    }

    refreshDom();

    var bookingId = b.booking_id || state.bookingId || '—';
    var travelersCount = Number(b.travelers || 1);
    var pkg = b.package || {};
    var customer = b.customer || {};
    var provider = b.provider || {};
    var payment = b.payment || null;
    var review = b.review || null;

    // 1. Breadcrumb and Header
    if (dom.breadcrumbId) dom.breadcrumbId.textContent = 'Booking #' + bookingId;
    if (dom.heading) dom.heading.textContent = 'Booking #' + bookingId;
    if (dom.bookingIdText) dom.bookingIdText.textContent = '#' + bookingId;

    if (dom.bookingStatusBadge) {
      dom.bookingStatusBadge.innerHTML = '';
      dom.bookingStatusBadge.appendChild(createBadge(b.booking_status));
    }
    if (dom.paymentStatusBadge) {
      dom.paymentStatusBadge.innerHTML = '';
      dom.paymentStatusBadge.appendChild(createBadge(b.payment_status));
    }

    // 2. Package Overview
    var pkgTitle = pkg.title || b.package_title || b.title || 'Tour Package';
    var pkgImg = pkg.image || b.package_image || b.image || '/images/placeholder.jpg';
    var pkgDesc = pkg.description || b.package_description || 'No description provided for this package.';
    var pkgDuration = pkg.duration_days || b.duration_days || null;
    var pkgPrice = (pkg.price !== undefined && pkg.price !== null)
      ? Number(pkg.price)
      : (b.total_amount && travelersCount ? (Number(b.total_amount) / travelersCount) : null);
    var pkgId = pkg.package_id || b.package_id;

    if (dom.packageTitle) dom.packageTitle.textContent = pkgTitle;
    if (dom.packageImage) {
      dom.packageImage.src = pkgImg;
      dom.packageImage.alt = pkgTitle;
    }
    if (dom.packageDescription) dom.packageDescription.textContent = pkgDesc;
    if (dom.packageDuration) dom.packageDuration.textContent = pkgDuration ? String(pkgDuration) : '—';
    if (dom.packagePrice) dom.packagePrice.textContent = pkgPrice !== null ? formatMoney(pkgPrice) : '—';
    if (dom.packageLink) {
      dom.packageLink.href = pkgId ? ('/package-detail.html?id=' + encodeURIComponent(pkgId)) : '/packages.html';
    }

    // 3. Travel & Schedule
    if (dom.availableDate) {
      dom.availableDate.innerHTML = '<strong>' + escapeHtml(formatDate(b.available_date)) + '</strong>';
    }
    if (dom.travelers) {
      dom.travelers.innerHTML = '<strong>' + travelersCount + ' traveler' + (travelersCount > 1 ? 's' : '') + '</strong>';
    }
    if (dom.bookedAt) {
      dom.bookedAt.textContent = b.booked_at ? formatDate(b.booked_at) : '—';
    }
    if (dom.seatsInfo) {
      dom.seatsInfo.textContent = 'Reserved (' + travelersCount + ' seats)';
    }

    // 4. Contacts (Customer & Provider)
    var custName = customer.name || b.customer_name || '—';
    var custEmail = customer.email || b.customer_email || '—';
    var custMobile = customer.mobile || b.customer_mobile || '—';

    var provName = provider.name || b.provider_name || '—';
    var provEmail = provider.email || b.provider_email || '—';
    var provMobile = provider.mobile || b.provider_mobile || '—';

    if (dom.customerName) dom.customerName.textContent = custName;
    if (dom.customerEmail) dom.customerEmail.textContent = custEmail;
    if (dom.customerMobile) dom.customerMobile.textContent = custMobile;

    if (dom.providerName) dom.providerName.textContent = provName;
    if (dom.providerEmail) dom.providerEmail.textContent = provEmail;
    if (dom.providerMobile) dom.providerMobile.textContent = provMobile;

    // 5. Pricing Breakdown & Sidebar Summary
    if (dom.rateBreakdown) {
      dom.rateBreakdown.textContent = pkgPrice !== null ? formatMoney(pkgPrice) : formatMoney(b.total_amount);
    }
    if (dom.travelersBreakdown) {
      dom.travelersBreakdown.textContent = '× ' + travelersCount;
    }
    if (dom.totalAmount) {
      dom.totalAmount.textContent = formatMoney(b.total_amount);
    }
    if (dom.sidebarPaymentBadge) {
      dom.sidebarPaymentBadge.innerHTML = '';
      dom.sidebarPaymentBadge.appendChild(createBadge(b.payment_status));
    }

    // Paid details info box
    if (dom.paidInfo) {
      var isPaid = (b.payment_status === 'PAID');
      dom.paidInfo.hidden = !isPaid;
      if (isPaid && payment) {
        if (dom.paymentId) dom.paymentId.textContent = payment.payment_id ? ('#' + payment.payment_id) : '—';
        if (dom.paidAt) dom.paidAt.textContent = payment.paid_at ? formatDate(payment.paid_at) : '—';
        if (dom.paidMethod) dom.paidMethod.textContent = payment.payment_method || '—';
      }
    }

    // 6. Contextual Visibility — Payment Section
    // Rule: Visible ONLY when payment_status === 'UNPAID' and booking_status !== 'CANCELLED'
    var canPay = (b.payment_status === 'UNPAID' && b.booking_status !== 'CANCELLED');
    if (dom.paymentSection) {
      dom.paymentSection.hidden = !canPay;
    }
    if (dom.payAmountDisplay) {
      dom.payAmountDisplay.textContent = formatMoney(b.total_amount);
    }
    hidePaymentError();

    // 7. Contextual Visibility — Cancellation Trigger
    // Rule: Respect backend b.can_cancel directly
    if (dom.btnOpenCancelModal) {
      dom.btnOpenCancelModal.hidden = !b.can_cancel;
    }
    if (dom.cancelModalBookingId) {
      dom.cancelModalBookingId.textContent = '#' + bookingId;
    }
    if (dom.cancelModalPackageTitle) {
      dom.cancelModalPackageTitle.textContent = pkgTitle;
    }

    // 8. Contextual Visibility — Review Action & Existing Review Block
    // Rule: Respect backend b.can_review and b.has_review
    var canLeaveReview = Boolean(b.can_review && !b.has_review);
    if (dom.btnOpenReviewModal) {
      dom.btnOpenReviewModal.hidden = !canLeaveReview;
    }

    var hasReview = Boolean(b.has_review && review);
    if (dom.existingReviewSection) {
      dom.existingReviewSection.hidden = !hasReview;
      if (hasReview && review) {
        var ratingNum = Math.max(1, Math.min(5, Number(review.rating) || 5));
        var starString = '★★★★★'.slice(0, ratingNum) + '☆☆☆☆☆'.slice(ratingNum);
        if (dom.detailReviewRating) dom.detailReviewRating.textContent = starString;
        if (dom.detailReviewComment) {
          dom.detailReviewComment.textContent = review.comment ? ('"' + review.comment + '"') : 'No written feedback provided.';
        }
        if (dom.detailReviewDate) {
          dom.detailReviewDate.textContent = 'Submitted on ' + (review.created_at ? formatDate(review.created_at) : '—');
        }
      }
    }

    showContent();
  }

  /* ── Core Data Fetching ────────────────────────────────────── */

  var activeRequestId = 0;

  /**
   * Fetches booking detail from GET /api/bookings/:id.
   * Tracks activeRequestId to discard stale responses from out-of-order calls.
   *
   * @param {number|string} [bookingId] ID of booking to fetch
   * @returns {Promise<Object|void>}
   */
  function loadBooking(bookingId) {
    refreshDom();

    activeRequestId++;
    var currentId = activeRequestId;

    state.isLoading = true;
    showLoading();

    var targetId = (bookingId !== undefined && bookingId !== null) ? bookingId : state.bookingId;
    if (!targetId) {
      state.isLoading = false;
      showError('Missing booking ID in URL query parameters.', 400);
      return Promise.resolve();
    }

    return window.api.get('/api/bookings/' + encodeURIComponent(targetId))
      .then(function (resp) {
        if (currentId !== activeRequestId) return; // Drop stale response

        state.isLoading = false;
        var bookingData = (resp && resp.data) || null;

        if (!bookingData) {
          showError('Booking not found.', 404);
          return;
        }

        state.booking = bookingData;
        renderDetail(bookingData);
        return bookingData;
      })
      .catch(function (err) {
        if (currentId !== activeRequestId) return; // Drop stale response

        state.isLoading = false;
        console.error('Failed to retrieve booking details:', err);

        var status = (err && err.status) || 500;
        var msg = (err && err.message) || 'Unable to connect to the server.';
        showError(msg, status);
      });
  }

  /* ── Modal Accessibility & Management ──────────────────────── */

  function checkRestoreBodyScroll() {
    var cancelOpen = dom.cancelModal && !dom.cancelModal.hidden;
    var reviewOpen = dom.reviewModal && !dom.reviewModal.hidden;
    if (!cancelOpen && !reviewOpen && typeof document !== 'undefined' && document.body) {
      document.body.style.overflow = '';
    }
  }

  function openCancelModal() {
    refreshDom();
    if (!state.booking || !state.booking.can_cancel) return;
    if (!dom.cancelModal) return;

    hideCancelError();
    state.lastFocusedTrigger = dom.btnOpenCancelModal;
    dom.cancelModal.hidden = false;
    if (typeof document !== 'undefined' && document.body) {
      document.body.style.overflow = 'hidden';
    }

    if (dom.btnDismissCancelModal && typeof dom.btnDismissCancelModal.focus === 'function') {
      dom.btnDismissCancelModal.focus();
    }
  }

  function closeCancelModal() {
    refreshDom();
    if (!dom.cancelModal) return;
    dom.cancelModal.hidden = true;
    hideCancelError();
    checkRestoreBodyScroll();

    if (state.lastFocusedTrigger && typeof state.lastFocusedTrigger.focus === 'function') {
      state.lastFocusedTrigger.focus();
      state.lastFocusedTrigger = null;
    }
  }

  function openReviewModal() {
    refreshDom();
    if (!state.booking || !state.booking.can_review || state.booking.has_review) return;
    if (!dom.reviewModal) return;

    hideReviewError();
    state.lastFocusedTrigger = dom.btnOpenReviewModal;
    dom.reviewModal.hidden = false;
    if (typeof document !== 'undefined' && document.body) {
      document.body.style.overflow = 'hidden';
    }

    if (dom.reviewForm && typeof dom.reviewForm.reset === 'function') {
      dom.reviewForm.reset();
    }
    if (dom.reviewRatingFeedback) {
      dom.reviewRatingFeedback.textContent = 'Select 1 to 5 stars';
    }

    var star5 = document.getElementById('star-5');
    if (star5 && typeof star5.focus === 'function') {
      star5.focus();
    }
  }

  function closeReviewModal() {
    refreshDom();
    if (!dom.reviewModal) return;
    dom.reviewModal.hidden = true;
    hideReviewError();
    checkRestoreBodyScroll();

    if (state.lastFocusedTrigger && typeof state.lastFocusedTrigger.focus === 'function') {
      state.lastFocusedTrigger.focus();
      state.lastFocusedTrigger = null;
    }
  }

  /* ── Payment Workflow (POST /api/bookings/:id/pay) ─────────── */

  function submitPayment(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    refreshDom();

    if (state.isSubmittingPayment) return Promise.resolve();
    if (!state.booking || !state.bookingId) return Promise.resolve();

    // 1. Get and validate selected payment method
    var selectedMethod = null;
    if (dom.paymentForm) {
      var checkedRadio = dom.paymentForm.querySelector('input[name="payment_method"]:checked');
      if (checkedRadio) selectedMethod = checkedRadio.value;
    }

    var validMethods = ['UPI', 'CARD', 'NETBANKING', 'CASH'];
    if (!selectedMethod || validMethods.indexOf(selectedMethod) === -1) {
      showPaymentError('Please select a valid payment method (UPI, CARD, NETBANKING, or CASH).');
      return Promise.resolve();
    }

    hidePaymentError();
    state.isSubmittingPayment = true;
    if (dom.btnPayNow) {
      dom.btnPayNow.disabled = true;
      if (window.UI && typeof window.UI.setLoading === 'function') {
        window.UI.setLoading(dom.btnPayNow, true);
      }
    }

    return window.api.post('/api/bookings/' + encodeURIComponent(state.bookingId) + '/pay', {
      payment_method: selectedMethod
    }).then(function (resp) {
      state.isSubmittingPayment = false;
      if (dom.btnPayNow) {
        dom.btnPayNow.disabled = false;
        if (window.UI && typeof window.UI.setLoading === 'function') {
          window.UI.setLoading(dom.btnPayNow, false);
        }
      }

      if (window.UI && typeof window.UI.toast === 'function') {
        window.UI.toast('Payment processed successfully.', 'success');
      }

      return loadBooking(state.bookingId);
    }).catch(function (err) {
      state.isSubmittingPayment = false;
      if (dom.btnPayNow) {
        dom.btnPayNow.disabled = false;
        if (window.UI && typeof window.UI.setLoading === 'function') {
          window.UI.setLoading(dom.btnPayNow, false);
        }
      }

      var msg = (err && err.message) || 'Payment processing failed. Please try again.';
      if (err && err.details && err.details.payment_method) {
        msg = err.details.payment_method;
      }
      showPaymentError(msg);
    });
  }

  /* ── Cancellation Workflow (POST /api/bookings/:id/cancel) ─── */

  function submitCancellation() {
    refreshDom();

    if (state.isSubmittingCancel) return Promise.resolve();
    if (!state.booking || !state.bookingId) return Promise.resolve();
    if (!state.booking.can_cancel) {
      showCancelError('This booking is not eligible for cancellation.');
      return Promise.resolve();
    }

    hideCancelError();
    state.isSubmittingCancel = true;
    if (dom.btnConfirmCancel) {
      dom.btnConfirmCancel.disabled = true;
      if (window.UI && typeof window.UI.setLoading === 'function') {
        window.UI.setLoading(dom.btnConfirmCancel, true);
      }
    }

    return window.api.post('/api/bookings/' + encodeURIComponent(state.bookingId) + '/cancel')
      .then(function (resp) {
        state.isSubmittingCancel = false;
        if (dom.btnConfirmCancel) {
          dom.btnConfirmCancel.disabled = false;
          if (window.UI && typeof window.UI.setLoading === 'function') {
            window.UI.setLoading(dom.btnConfirmCancel, false);
          }
        }

        closeCancelModal();

        if (window.UI && typeof window.UI.toast === 'function') {
          window.UI.toast('Booking cancelled successfully.', 'success');
        }

        return loadBooking(state.bookingId);
      })
      .catch(function (err) {
        state.isSubmittingCancel = false;
        if (dom.btnConfirmCancel) {
          dom.btnConfirmCancel.disabled = false;
          if (window.UI && typeof window.UI.setLoading === 'function') {
            window.UI.setLoading(dom.btnConfirmCancel, false);
          }
        }

        var msg = (err && err.message) || 'Failed to cancel booking. Please try again.';
        showCancelError(msg);
      });
  }

  /* ── Review Workflow (POST /api/reviews) ───────────────────── */

  function submitReview(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    refreshDom();

    if (state.isSubmittingReview) return Promise.resolve();
    if (!state.booking || !state.bookingId) return Promise.resolve();

    // 1. Get and validate rating (required, 1-5 integer)
    var selectedRating = null;
    if (dom.reviewForm) {
      var checkedRadio = dom.reviewForm.querySelector('input[name="rating"]:checked');
      if (checkedRadio) selectedRating = parseInt(checkedRadio.value, 10);
    }

    if (!selectedRating || isNaN(selectedRating) || selectedRating < 1 || selectedRating > 5) {
      showReviewError('Please select a rating between 1 and 5 stars.');
      return Promise.resolve();
    }

    // 2. Get and validate comment (optional, max 1000 characters)
    var commentVal = dom.reviewComment ? dom.reviewComment.value.trim() : '';
    if (commentVal.length > 1000) {
      showReviewError('Review comment cannot exceed 1000 characters.');
      return Promise.resolve();
    }

    var payload = {
      booking_id: Number(state.bookingId),
      rating: selectedRating
    };
    if (commentVal) {
      payload.comment = commentVal;
    }

    hideReviewError();
    state.isSubmittingReview = true;
    if (dom.btnSubmitReview) {
      dom.btnSubmitReview.disabled = true;
      if (window.UI && typeof window.UI.setLoading === 'function') {
        window.UI.setLoading(dom.btnSubmitReview, true);
      }
    }

    return window.api.post('/api/reviews', payload)
      .then(function (resp) {
        state.isSubmittingReview = false;
        if (dom.btnSubmitReview) {
          dom.btnSubmitReview.disabled = false;
          if (window.UI && typeof window.UI.setLoading === 'function') {
            window.UI.setLoading(dom.btnSubmitReview, false);
          }
        }

        closeReviewModal();

        if (window.UI && typeof window.UI.toast === 'function') {
          window.UI.toast('Review submitted successfully. Thank you for your feedback!', 'success');
        }

        return loadBooking(state.bookingId);
      })
      .catch(function (err) {
        state.isSubmittingReview = false;
        if (dom.btnSubmitReview) {
          dom.btnSubmitReview.disabled = false;
          if (window.UI && typeof window.UI.setLoading === 'function') {
            window.UI.setLoading(dom.btnSubmitReview, false);
          }
        }

        var msg = (err && err.message) || 'Failed to submit review. Please try again.';
        if (err && err.details) {
          if (err.details.rating) msg = err.details.rating;
          else if (err.details.comment) msg = err.details.comment;
        }
        showReviewError(msg);
      });
  }

  /* ── Event Listeners ───────────────────────────────────────── */

  function setupEvents() {
    refreshDom();

    if (state._eventsAttached) return;
    state._eventsAttached = true;

    // Retry button on error view
    if (dom.btnRetry) {
      dom.btnRetry.addEventListener('click', function () {
        loadBooking();
      });
    }

    // Print button
    if (dom.btnPrint) {
      dom.btnPrint.addEventListener('click', function () {
        if (typeof window !== 'undefined' && typeof window.print === 'function') {
          window.print();
        }
      });
    }

    // Payment Form Submit
    if (dom.paymentForm) {
      dom.paymentForm.addEventListener('submit', submitPayment);
    }

    // Cancellation Modal Triggers & Controls
    if (dom.btnOpenCancelModal) {
      dom.btnOpenCancelModal.addEventListener('click', openCancelModal);
    }
    if (dom.btnCloseCancelModal) {
      dom.btnCloseCancelModal.addEventListener('click', closeCancelModal);
    }
    if (dom.btnDismissCancelModal) {
      dom.btnDismissCancelModal.addEventListener('click', closeCancelModal);
    }
    if (dom.btnConfirmCancel) {
      dom.btnConfirmCancel.addEventListener('click', submitCancellation);
    }
    if (dom.cancelModal) {
      dom.cancelModal.addEventListener('click', function (e) {
        if (e.target === dom.cancelModal) closeCancelModal();
      });
    }

    // Review Modal Triggers & Controls
    if (dom.btnOpenReviewModal) {
      dom.btnOpenReviewModal.addEventListener('click', openReviewModal);
    }
    if (dom.btnCloseReviewModal) {
      dom.btnCloseReviewModal.addEventListener('click', closeReviewModal);
    }
    if (dom.btnDismissReviewModal) {
      dom.btnDismissReviewModal.addEventListener('click', closeReviewModal);
    }
    if (dom.reviewForm) {
      dom.reviewForm.addEventListener('submit', submitReview);
    }
    if (dom.reviewModal) {
      dom.reviewModal.addEventListener('click', function (e) {
        if (e.target === dom.reviewModal) closeReviewModal();
      });

      // Star rating feedback text change
      var starLabels = {
        '1': '1 star — Poor',
        '2': '2 stars — Fair',
        '3': '3 stars — Good',
        '4': '4 stars — Very Good',
        '5': '5 stars — Outstanding'
      };
      var ratingRadios = dom.reviewModal.querySelectorAll('input[name="rating"]');
      if (ratingRadios && ratingRadios.forEach) {
        ratingRadios.forEach(function (radio) {
          radio.addEventListener('change', function () {
            if (dom.reviewRatingFeedback && radio.checked) {
              dom.reviewRatingFeedback.textContent = starLabels[radio.value] || (radio.value + ' stars');
            }
          });
        });
      }
    }

    // Global Keydown: Escape closes open modal
    if (typeof document !== 'undefined') {
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' || e.keyCode === 27) {
          if (dom.cancelModal && !dom.cancelModal.hidden) closeCancelModal();
          else if (dom.reviewModal && !dom.reviewModal.hidden) closeReviewModal();
        }
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

      // 2. Parse booking ID from query parameter
      var parsedId = getBookingIdFromUrl();
      state.bookingId = parsedId;

      if (!parsedId) {
        showError('Invalid or missing booking ID in URL parameter (e.g. ?id=123).', 400);
        return;
      }

      // 3. Fetch and render booking detail
      return loadBooking(parsedId);
    }).catch(function (err) {
      console.error('Customer authorization or initialization failed:', err);
      // Auth.requireRole handles login redirection on unauthenticated sessions
    });
  }

  // Export for testing
  window.BookingDetail = {
    state: state,
    dom: dom,
    init: init,
    loadBooking: loadBooking,
    renderDetail: renderDetail,
    showLoading: showLoading,
    showError: showError,
    showContent: showContent,
    refreshDom: refreshDom,
    getBookingIdFromUrl: getBookingIdFromUrl,
    setupEvents: setupEvents,
    openCancelModal: openCancelModal,
    closeCancelModal: closeCancelModal,
    openReviewModal: openReviewModal,
    closeReviewModal: closeReviewModal,
    submitPayment: submitPayment,
    submitCancellation: submitCancellation,
    submitReview: submitReview,
    showPaymentError: showPaymentError,
    hidePaymentError: hidePaymentError,
    showCancelError: showCancelError,
    hideCancelError: hideCancelError,
    showReviewError: showReviewError,
    hideReviewError: hideReviewError
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
