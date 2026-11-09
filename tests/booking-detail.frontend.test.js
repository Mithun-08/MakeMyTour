/**
 * tests/booking-detail.frontend.test.js
 *
 * Persistent frontend test suite for public/js/pages/booking-detail.js.
 * Covers:
 *   Payment Workflow:
 *     1. Valid payment submission
 *     2. Missing payment method
 *     3. Duplicate submission prevention
 *     4. API failure and recovery
 *     5. Successful payment refreshes booking details
 *   Cancellation Workflow:
 *     6. Modal open and close
 *     7. Confirmation required
 *     8. Successful cancellation refreshes booking details
 *     9. Backend rejection and error display
 *     10. Duplicate submission prevention
 *   Review Workflow:
 *     11. Modal open and close
 *     12. Rating validation
 *     13. Optional comment handling
 *     14. Successful review refreshes booking details
 *     15. Backend rejection and error display
 *     16. Duplicate submission prevention
 *   Integration & Contextual Visibility:
 *     17. Payment controls hidden after payment
 *     18. Cancellation controls follow can_cancel
 *     19. Review controls follow can_review and has_review
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SCRIPT_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'pages', 'booking-detail.js'), 'utf8');

class MockClassList {
  constructor(el) {
    this._el = el;
    this._classes = new Set();
  }
  add(...names) {
    names.forEach(n => this._classes.add(n));
    this._sync();
  }
  remove(...names) {
    names.forEach(n => this._classes.delete(n));
    this._sync();
  }
  contains(name) {
    return this._classes.has(name);
  }
  _sync() {
    this._el._className = Array.from(this._classes).join(' ');
  }
}

class MockElement {
  constructor(tagName = 'div', doc = null) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.style = {};
    this.hidden = false;
    this.disabled = false;
    this._textContent = '';
    this._innerHTML = '';
    this.value = '';
    this.checked = false;
    this._className = '';
    this.classList = new MockClassList(this);
    this._id = '';
    this._doc = doc;
    this.parentNode = null;
    this.src = '';
    this.alt = '';
    this.href = '';
  }

  get id() { return this._id; }
  set id(val) {
    this._id = String(val);
    if (this._doc && this._id) {
      this._doc.elements.set(this._id, this);
    }
  }

  get className() { return this._className; }
  set className(val) {
    this._className = String(val || '');
    this.classList._classes = new Set(this._className.split(/\s+/).filter(Boolean));
  }

  get textContent() {
    if (this.children.length > 0) {
      return this.children.map(c => c.textContent).join('');
    }
    return this._textContent;
  }
  set textContent(val) {
    this.children = [];
    this._textContent = val === null || val === undefined ? '' : String(val);
  }

  get innerHTML() {
    return this._innerHTML;
  }
  set innerHTML(val) {
    this._innerHTML = String(val || '');
    this.children = [];
  }

  getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  removeAttribute(k) { delete this.attributes[k]; }

  addEventListener(type, fn) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(fn);
  }

  dispatchEvent(event) {
    const handlers = this.listeners[event.type] || [];
    handlers.forEach(h => h(event));
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  focus() {
    if (this._doc) this._doc.activeElement = this;
  }

  reset() {
    this.children.forEach(c => {
      if (c.tagName === 'INPUT' && (c.attributes.type === 'radio' || c.attributes.type === 'checkbox')) {
        c.checked = false;
      } else if (c.tagName === 'TEXTAREA' || c.tagName === 'INPUT') {
        c.value = '';
      }
      if (c.reset) c.reset();
    });
  }

  querySelector(sel) {
    const all = this.querySelectorAll(sel);
    return all.length > 0 ? all[0] : null;
  }

  querySelectorAll(sel) {
    const results = [];
    const traverse = (node) => {
      node.children.forEach(c => {
        let match = true;
        if (sel.startsWith('.')) {
          match = c.classList.contains(sel.slice(1));
        } else {
          const tagMatch = sel.match(/^([a-zA-Z0-9]+)/);
          if (tagMatch && c.tagName !== tagMatch[1].toUpperCase()) {
            match = false;
          }
          if (sel.includes(':checked') && !c.checked) {
            match = false;
          }
          const attrMatches = [...sel.matchAll(/\[([a-zA-Z0-9_-]+)(?:=["']?([^"']*)["']?)?\]/g)];
          for (const m of attrMatches) {
            const attrName = m[1];
            const attrVal = m[2];
            if (attrVal !== undefined) {
              if (c.getAttribute(attrName) !== attrVal && c.attributes[attrName] !== attrVal && String(c[attrName]) !== attrVal) {
                match = false;
                break;
              }
            } else {
              if (c.getAttribute(attrName) === null && c.attributes[attrName] === undefined) {
                match = false;
                break;
              }
            }
          }
        }
        if (match) results.push(c);
        traverse(c);
      });
    };
    traverse(this);
    return results;
  }
}

class MockDocument {
  constructor() {
    this.elements = new Map();
    this.readyState = 'loading';
    this.listeners = {};
    this.body = new MockElement('body', this);
    this.activeElement = null;
  }

  createElement(tagName) {
    return new MockElement(tagName, this);
  }

  getElementById(id) {
    return this.elements.get(id) || null;
  }

  addEventListener(type, fn) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(fn);
  }

  dispatchEvent(event) {
    const handlers = this.listeners[event.type] || [];
    handlers.forEach(h => h(event));
  }
}

function createEnvironment(apiConfig = {}, options = {}) {
  const doc = new MockDocument();

  // Standard elements from public/booking-detail.html
  const elementIds = [
    'detail-loading', 'detail-error', 'detail-error-msg', 'btn-retry-detail', 'detail-content',
    'breadcrumb-booking-id', 'detail-booking-heading', 'detail-booking-id-text',
    'detail-booking-status-badge', 'detail-payment-status-badge', 'btn-print-booking',
    'detail-package-image', 'detail-package-title', 'detail-package-link',
    'detail-package-duration', 'detail-package-price', 'detail-package-description',
    'detail-available-date', 'detail-travelers', 'detail-booked-at', 'detail-seats-info',
    'detail-customer-name', 'detail-customer-email', 'detail-customer-mobile',
    'detail-provider-name', 'detail-provider-email', 'detail-provider-mobile',
    'detail-rate-breakdown', 'detail-travelers-breakdown', 'detail-total-amount',
    'detail-sidebar-payment-badge', 'detail-paid-info', 'detail-payment-id',
    'detail-paid-at', 'detail-paid-method',
    'payment-section', 'payment-form', 'payment-error-alert', 'payment-error-text',
    'btn-pay-now', 'pay-amount-display',
    'btn-open-cancel-modal', 'btn-open-review-modal',
    'existing-review-section', 'detail-review-rating', 'detail-review-comment', 'detail-review-date',
    'cancel-modal', 'btn-close-cancel-modal', 'btn-dismiss-cancel-modal', 'btn-confirm-cancel',
    'cancel-error-alert', 'cancel-error-text', 'cancel-modal-booking-id', 'cancel-modal-package-title',
    'review-modal', 'review-form', 'btn-close-review-modal', 'btn-dismiss-review-modal',
    'btn-submit-review', 'review-error-alert', 'review-error-text',
    'review-rating-feedback', 'review-comment'
  ];

  elementIds.forEach(id => {
    let tag = 'div';
    if (id === 'payment-form' || id === 'review-form') tag = 'form';
    else if (id.startsWith('btn-')) tag = 'button';
    else if (id === 'review-comment') tag = 'textarea';
    const el = doc.createElement(tag);
    el.id = id;
    if (id.includes('modal') || id.includes('error-alert') || id.includes('paid-info') || id.includes('loading') || id.includes('section')) {
      el.hidden = true;
    }
  });

  // Populate payment radio options in payment-form
  const paymentForm = doc.getElementById('payment-form');
  ['UPI', 'CARD', 'NETBANKING', 'CASH'].forEach(m => {
    const radio = doc.createElement('input');
    radio.attributes.type = 'radio';
    radio.attributes.name = 'payment_method';
    radio.attributes.value = m;
    radio.value = m;
    paymentForm.appendChild(radio);
  });

  // Populate rating radios in review-modal
  const reviewModal = doc.getElementById('review-modal');
  const reviewForm = doc.getElementById('review-form');
  reviewModal.appendChild(reviewForm);
  for (let s = 1; s <= 5; s++) {
    const radio = doc.createElement('input');
    radio.attributes.type = 'radio';
    radio.attributes.name = 'rating';
    radio.attributes.value = String(s);
    radio.value = String(s);
    radio.id = 'star-' + s;
    reviewForm.appendChild(radio);
  }
  const reviewComment = doc.getElementById('review-comment');
  reviewForm.appendChild(reviewComment);

  const getCalls = [];
  const postCalls = [];

  const api = {
    get: (url, params) => {
      getCalls.push({ url, params });
      try {
        const handler = apiConfig.get;
        const res = handler ? handler(url, params) : { data: {} };
        return Promise.resolve(res);
      } catch (err) {
        return Promise.reject(err);
      }
    },
    post: (url, body) => {
      postCalls.push({ url, body });
      try {
        const handler = apiConfig.post;
        const res = handler ? handler(url, body) : { data: {} };
        return Promise.resolve(res);
      } catch (err) {
        return Promise.reject(err);
      }
    }
  };

  const Auth = {
    requireRole: (roles) => {
      if (options.role && options.role !== 'CUSTOMER') {
        return Promise.reject(new Error('Unauthorized'));
      }
      return Promise.resolve({ user_id: 10, role: 'CUSTOMER', name: 'Test User' });
    }
  };

  const UI = {
    escapeHtml: (s) => String(s || ''),
    money: (n) => `₹${Number(n).toFixed(2)}`,
    date: (d) => `Date(${d})`,
    statusBadge: (st) => {
      const s = doc.createElement('span');
      s.className = `badge badge-${String(st).toLowerCase()}`;
      s.textContent = st;
      return s;
    },
    toast: (msg, type) => {
      UI.lastToast = { msg, type };
    },
    setLoading: (btn, isLoading) => {
      btn.isLoading = isLoading;
    }
  };

  const sandbox = {
    window: {
      location: { search: options.query !== undefined ? options.query : '?id=101' },
      print: () => { sandbox.printed = true; }
    },
    document: doc,
    api,
    Auth,
    UI,
    console,
    URLSearchParams,
    setTimeout: (fn) => fn(),
    clearTimeout: () => {}
  };
  sandbox.window.window = sandbox.window;
  sandbox.window.document = doc;
  sandbox.window.api = api;
  sandbox.window.Auth = Auth;
  sandbox.window.UI = UI;

  const ctx = vm.createContext(sandbox);
  vm.runInContext(SCRIPT_SRC, ctx);

  return {
    doc,
    api,
    getCalls,
    postCalls,
    UI,
    sandbox,
    controller: sandbox.window.BookingDetail
  };
}

describe('Booking Detail — M2 Task 6 Verification', () => {

  /* ─────────────────────────────────────────────────────────────
   * PAYMENT WORKFLOW
   * ───────────────────────────────────────────────────────────── */

  it('1. Payment: valid payment submission sends POST /api/bookings/:id/pay with selected method', async () => {
    let currentBooking = {
      booking_id: 101,
      total_amount: 15000,
      booking_status: 'PENDING',
      payment_status: 'UNPAID',
      can_cancel: true,
      can_review: false,
      has_review: false
    };

    const env = createEnvironment({
      get: (url) => ({ data: currentBooking }),
      post: (url, body) => {
        assert.equal(url, '/api/bookings/101/pay');
        assert.equal(body.payment_method, 'CARD');
        // Update booking state to simulate DB change
        currentBooking.payment_status = 'PAID';
        currentBooking.payment = { payment_id: 777, payment_method: 'CARD', paid_at: '2026-11-04' };
        return { data: { payment_id: 777, payment_status: 'PAID' } };
      }
    });

    await env.controller.init();
    assert.equal(env.doc.getElementById('payment-section').hidden, false);

    // Select CARD
    const cardRadio = env.doc.getElementById('payment-form').querySelector('input[name="payment_method"][value="CARD"]');
    cardRadio.checked = true;

    await env.controller.submitPayment({ preventDefault: () => {} });

    assert.equal(env.postCalls.length, 1);
    assert.equal(env.postCalls[0].url, '/api/bookings/101/pay');
    assert.equal(env.postCalls[0].body.payment_method, 'CARD');
    assert.equal(env.UI.lastToast.type, 'success');

    // Refreshed booking detail is now PAID, so payment section is hidden
    assert.equal(env.doc.getElementById('payment-section').hidden, true);
    assert.equal(env.doc.getElementById('detail-paid-info').hidden, false);
    assert.equal(env.doc.getElementById('detail-payment-id').textContent, '#777');
  });

  it('2. Payment: missing payment method selection displays validation error and prevents submission', async () => {
    const env = createEnvironment({
      get: () => ({
        data: { booking_id: 101, total_amount: 12000, payment_status: 'UNPAID', booking_status: 'PENDING' }
      })
    });

    await env.controller.init();

    // Ensure no radio is checked
    env.doc.getElementById('payment-form').querySelectorAll('input[name="payment_method"]').forEach(r => r.checked = false);

    await env.controller.submitPayment({ preventDefault: () => {} });

    assert.equal(env.postCalls.length, 0, 'Must NOT send POST request when no method is selected');
    assert.equal(env.doc.getElementById('payment-error-alert').hidden, false);
    assert.ok(env.doc.getElementById('payment-error-text').textContent.includes('Please select a valid payment method'));
  });

  it('3. Payment: prevents duplicate concurrent submissions', async () => {
    let resolvePost;
    const env = createEnvironment({
      get: () => ({
        data: { booking_id: 101, total_amount: 10000, payment_status: 'UNPAID', booking_status: 'PENDING' }
      }),
      post: () => new Promise(res => { resolvePost = res; })
    });

    await env.controller.init();
    const upiRadio = env.doc.getElementById('payment-form').querySelector('input[name="payment_method"][value="UPI"]');
    upiRadio.checked = true;

    // First submit triggers request
    const p1 = env.controller.submitPayment({ preventDefault: () => {} });
    assert.equal(env.controller.state.isSubmittingPayment, true);
    assert.equal(env.doc.getElementById('btn-pay-now').disabled, true);

    // Second concurrent submit must be ignored
    const p2 = env.controller.submitPayment({ preventDefault: () => {} });

    assert.equal(env.postCalls.length, 1, 'Only one payment POST call should be made');

    resolvePost({ data: { payment_id: 99 } });
    await Promise.all([p1, p2]);
    assert.equal(env.controller.state.isSubmittingPayment, false);
  });

  it('4. Payment: API failure displays error and restores Pay Now button state', async () => {
    const env = createEnvironment({
      get: () => ({
        data: { booking_id: 101, total_amount: 10000, payment_status: 'UNPAID', booking_status: 'PENDING' }
      }),
      post: () => {
        const err = new Error('Payment gateway timeout');
        err.status = 504;
        throw err;
      }
    });

    await env.controller.init();
    const cashRadio = env.doc.getElementById('payment-form').querySelector('input[name="payment_method"][value="CASH"]');
    cashRadio.checked = true;

    await env.controller.submitPayment({ preventDefault: () => {} });

    assert.equal(env.doc.getElementById('payment-error-alert').hidden, false);
    assert.equal(env.doc.getElementById('payment-error-text').textContent, 'Payment gateway timeout');
    assert.equal(env.doc.getElementById('btn-pay-now').disabled, false, 'Button must recover and be re-enabled');
  });

  it('5. Payment: successful payment refreshes booking details and updates badges', async () => {
    let bookingState = {
      booking_id: 101,
      total_amount: 5000,
      payment_status: 'UNPAID',
      booking_status: 'PENDING',
      can_cancel: true
    };

    const env = createEnvironment({
      get: () => ({ data: bookingState }),
      post: () => {
        bookingState = {
          booking_id: 101,
          total_amount: 5000,
          payment_status: 'PAID',
          booking_status: 'CONFIRMED',
          can_cancel: false,
          payment: { payment_id: 321, payment_method: 'NETBANKING', paid_at: '2026-11-04' }
        };
        return { data: { payment_id: 321 } };
      }
    });

    await env.controller.init();
    const nbRadio = env.doc.getElementById('payment-form').querySelector('input[name="payment_method"][value="NETBANKING"]');
    nbRadio.checked = true;

    await env.controller.submitPayment({ preventDefault: () => {} });

    assert.equal(env.controller.state.booking.payment_status, 'PAID');
    assert.equal(env.controller.state.booking.booking_status, 'CONFIRMED');
    assert.equal(env.doc.getElementById('payment-section').hidden, true);
  });

  /* ─────────────────────────────────────────────────────────────
   * CANCELLATION WORKFLOW
   * ───────────────────────────────────────────────────────────── */

  it('6. Cancellation: modal opens through trigger and closes without cancelling', async () => {
    const env = createEnvironment({
      get: () => ({
        data: { booking_id: 101, can_cancel: true, package_title: 'Kerala Tour' }
      })
    });

    await env.controller.init();
    assert.equal(env.doc.getElementById('btn-open-cancel-modal').hidden, false);
    assert.equal(env.doc.getElementById('cancel-modal').hidden, true);

    // Open modal
    env.controller.openCancelModal();
    assert.equal(env.doc.getElementById('cancel-modal').hidden, false);
    assert.equal(env.doc.getElementById('cancel-modal-booking-id').textContent, '#101');
    assert.equal(env.doc.getElementById('cancel-modal-package-title').textContent, 'Kerala Tour');

    // Close via dismiss button
    env.controller.closeCancelModal();
    assert.equal(env.doc.getElementById('cancel-modal').hidden, true);
    assert.equal(env.postCalls.length, 0, 'No cancel request sent on dismiss');
  });

  it('7. Cancellation: requires explicit confirmation click before submitting', async () => {
    const env = createEnvironment({
      get: () => ({ data: { booking_id: 101, can_cancel: true } })
    });

    await env.controller.init();
    env.controller.openCancelModal();

    assert.equal(env.postCalls.length, 0);

    // Confirm button triggers cancellation
    await env.controller.submitCancellation();
    assert.equal(env.postCalls.length, 1);
    assert.equal(env.postCalls[0].url, '/api/bookings/101/cancel');
  });

  it('8. Cancellation: successful cancellation closes modal, shows toast, and refreshes booking details', async () => {
    let bookingData = {
      booking_id: 101,
      booking_status: 'PENDING',
      payment_status: 'UNPAID',
      can_cancel: true
    };

    const env = createEnvironment({
      get: () => ({ data: bookingData }),
      post: () => {
        bookingData = {
          booking_id: 101,
          booking_status: 'CANCELLED',
          payment_status: 'UNPAID',
          can_cancel: false
        };
        return { data: { booking_id: 101, booking_status: 'CANCELLED' } };
      }
    });

    await env.controller.init();
    env.controller.openCancelModal();

    await env.controller.submitCancellation();

    assert.equal(env.doc.getElementById('cancel-modal').hidden, true, 'Modal must close on success');
    assert.equal(env.UI.lastToast.type, 'success');
    assert.equal(env.controller.state.booking.booking_status, 'CANCELLED');
    assert.equal(env.doc.getElementById('btn-open-cancel-modal').hidden, true, 'can_cancel=false hides cancel button');
    assert.equal(env.doc.getElementById('payment-section').hidden, true, 'Cancelled booking hides payment section');
  });

  it('9. Cancellation: backend rejection displays error inside modal and keeps modal open', async () => {
    const env = createEnvironment({
      get: () => ({ data: { booking_id: 101, can_cancel: true } }),
      post: () => {
        const err = new Error('Cancellation window has closed');
        err.status = 409;
        throw err;
      }
    });

    await env.controller.init();
    env.controller.openCancelModal();

    await env.controller.submitCancellation();

    assert.equal(env.doc.getElementById('cancel-modal').hidden, false, 'Modal remains open on error');
    assert.equal(env.doc.getElementById('cancel-error-alert').hidden, false);
    assert.equal(env.doc.getElementById('cancel-error-text').textContent, 'Cancellation window has closed');
    assert.equal(env.doc.getElementById('btn-confirm-cancel').disabled, false, 'Button re-enabled for retry');
  });

  it('10. Cancellation: prevents duplicate concurrent cancellation requests', async () => {
    let resolveCancel;
    const env = createEnvironment({
      get: () => ({ data: { booking_id: 101, can_cancel: true } }),
      post: () => new Promise(res => { resolveCancel = res; })
    });

    await env.controller.init();
    env.controller.openCancelModal();

    const p1 = env.controller.submitCancellation();
    assert.equal(env.controller.state.isSubmittingCancel, true);

    const p2 = env.controller.submitCancellation();
    assert.equal(env.postCalls.length, 1);

    resolveCancel({ data: { booking_id: 101 } });
    await Promise.all([p1, p2]);
  });

  /* ─────────────────────────────────────────────────────────────
   * REVIEWS WORKFLOW
   * ───────────────────────────────────────────────────────────── */

  it('11. Reviews: modal opens only when can_review === true and no review exists', async () => {
    const env = createEnvironment({
      get: () => ({
        data: { booking_id: 101, can_review: true, has_review: false }
      })
    });

    await env.controller.init();
    assert.equal(env.doc.getElementById('btn-open-review-modal').hidden, false);

    env.controller.openReviewModal();
    assert.equal(env.doc.getElementById('review-modal').hidden, false);

    env.controller.closeReviewModal();
    assert.equal(env.doc.getElementById('review-modal').hidden, true);
  });

  it('12. Reviews: requires rating validation (1 to 5 stars) before submission', async () => {
    const env = createEnvironment({
      get: () => ({ data: { booking_id: 101, can_review: true, has_review: false } })
    });

    await env.controller.init();
    env.controller.openReviewModal();

    // No star radio checked
    await env.controller.submitReview({ preventDefault: () => {} });

    assert.equal(env.postCalls.length, 0, 'Must NOT post review without rating');
    assert.equal(env.doc.getElementById('review-error-alert').hidden, false);
    assert.ok(env.doc.getElementById('review-error-text').textContent.includes('Please select a rating between 1 and 5 stars'));
  });

  it('13. Reviews: optional comment handling submits clean payload when comment is empty or present', async () => {
    const env = createEnvironment({
      get: () => ({ data: { booking_id: 101, can_review: true, has_review: false } }),
      post: () => ({ data: { review_id: 55 } })
    });

    await env.controller.init();
    env.controller.openReviewModal();

    // Select star 5
    const star5 = env.doc.getElementById('review-form').querySelector('input[name="rating"][value="5"]');
    star5.checked = true;
    env.doc.getElementById('review-comment').value = '';

    await env.controller.submitReview({ preventDefault: () => {} });

    assert.equal(env.postCalls[0].url, '/api/reviews');
    assert.equal(env.postCalls[0].body.rating, 5);
    assert.equal(env.postCalls[0].body.comment, undefined, 'Empty comment should be omitted or null');
  });

  it('14. Reviews: successful review closes modal, shows toast, and refreshes booking details', async () => {
    let bookingData = {
      booking_id: 101,
      can_review: true,
      has_review: false,
      review: null
    };

    const env = createEnvironment({
      get: () => ({ data: bookingData }),
      post: (url, body) => {
        bookingData = {
          booking_id: 101,
          can_review: false,
          has_review: true,
          review: { rating: 5, comment: 'Exceptional trip!', created_at: '2026-11-04' }
        };
        return { data: { review_id: 12 } };
      }
    });

    await env.controller.init();
    env.controller.openReviewModal();

    const star5 = env.doc.getElementById('review-form').querySelector('input[name="rating"][value="5"]');
    star5.checked = true;
    env.doc.getElementById('review-comment').value = 'Exceptional trip!';

    await env.controller.submitReview({ preventDefault: () => {} });

    assert.equal(env.doc.getElementById('review-modal').hidden, true);
    assert.equal(env.UI.lastToast.type, 'success');
    assert.equal(env.doc.getElementById('btn-open-review-modal').hidden, true);
    assert.equal(env.doc.getElementById('existing-review-section').hidden, false);
    assert.equal(env.doc.getElementById('detail-review-rating').textContent, '★★★★★');
    assert.equal(env.doc.getElementById('detail-review-comment').textContent, '"Exceptional trip!"');
  });

  it('15. Reviews: backend rejection displays error inside modal and keeps modal open', async () => {
    const env = createEnvironment({
      get: () => ({ data: { booking_id: 101, can_review: true, has_review: false } }),
      post: () => {
        const err = new Error('A review has already been submitted for this booking');
        err.status = 409;
        throw err;
      }
    });

    await env.controller.init();
    env.controller.openReviewModal();

    const star4 = env.doc.getElementById('review-form').querySelector('input[name="rating"][value="4"]');
    star4.checked = true;

    await env.controller.submitReview({ preventDefault: () => {} });

    assert.equal(env.doc.getElementById('review-modal').hidden, false);
    assert.equal(env.doc.getElementById('review-error-alert').hidden, false);
    assert.equal(env.doc.getElementById('review-error-text').textContent, 'A review has already been submitted for this booking');
  });

  it('16. Reviews: prevents duplicate review submissions', async () => {
    let resolveReview;
    const env = createEnvironment({
      get: () => ({ data: { booking_id: 101, can_review: true, has_review: false } }),
      post: () => new Promise(res => { resolveReview = res; })
    });

    await env.controller.init();
    env.controller.openReviewModal();

    const star5 = env.doc.getElementById('review-form').querySelector('input[name="rating"][value="5"]');
    star5.checked = true;

    const p1 = env.controller.submitReview({ preventDefault: () => {} });
    assert.equal(env.controller.state.isSubmittingReview, true);

    const p2 = env.controller.submitReview({ preventDefault: () => {} });
    assert.equal(env.postCalls.length, 1);

    resolveReview({ data: { review_id: 99 } });
    await Promise.all([p1, p2]);
  });

  /* ─────────────────────────────────────────────────────────────
   * INTEGRATION & CONTEXTUAL VISIBILITY
   * ───────────────────────────────────────────────────────────── */

  it('17. Integration: payment controls strictly hidden after payment', async () => {
    const env = createEnvironment({
      get: () => ({
        data: { booking_id: 101, payment_status: 'PAID', booking_status: 'CONFIRMED' }
      })
    });

    await env.controller.init();
    assert.equal(env.doc.getElementById('payment-section').hidden, true);
  });

  it('18. Integration: cancellation controls follow backend can_cancel flag', async () => {
    const env = createEnvironment({
      get: () => ({
        data: { booking_id: 101, can_cancel: false }
      })
    });

    await env.controller.init();
    assert.equal(env.doc.getElementById('btn-open-cancel-modal').hidden, true);
  });

  it('19. Integration: review controls follow can_review and has_review', async () => {
    const env = createEnvironment({
      get: () => ({
        data: {
          booking_id: 101,
          can_review: false,
          has_review: true,
          review: { rating: 5, comment: 'Nice', created_at: '2026-11-04' }
        }
      })
    });

    await env.controller.init();
    assert.equal(env.doc.getElementById('btn-open-review-modal').hidden, true);
    assert.equal(env.doc.getElementById('existing-review-section').hidden, false);
  });

  it('20. Reviews: clicking #btn-open-review-modal and #btn-submit-review or ?action=review triggers full review flow', async () => {
    let bookingData = {
      booking_id: 101,
      booking_status: 'COMPLETED',
      payment_status: 'PAID',
      can_review: true,
      has_review: false
    };

    const env = createEnvironment({
      get: () => ({ data: bookingData }),
      post: (url, body) => {
        // Simulate M3 GET /api/bookings/:id which returns has_review: true, can_review: false without inline review object
        bookingData = {
          booking_id: 101,
          booking_status: 'COMPLETED',
          payment_status: 'PAID',
          can_review: false,
          has_review: true
        };
        return { data: { review_id: 77, booking_id: 101, rating: body.rating, comment: body.comment } };
      }
    }, { query: '?id=101&action=review' });

    await env.controller.init();
    // ?action=review automatically opens the review modal
    assert.equal(env.doc.getElementById('review-modal').hidden, false);

    // Close and re-open via button click handler
    env.doc.getElementById('btn-close-review-modal').dispatchEvent({ type: 'click' });
    assert.equal(env.doc.getElementById('review-modal').hidden, true);
    env.doc.getElementById('btn-open-review-modal').dispatchEvent({ type: 'click' });
    assert.equal(env.doc.getElementById('review-modal').hidden, false);

    const star4 = env.doc.getElementById('review-form').querySelector('input[name="rating"][value="4"]');
    star4.checked = true;
    env.doc.getElementById('review-comment').value = 'Great local guide and smooth itinerary.';

    // Click submit button directly
    env.doc.getElementById('btn-submit-review').dispatchEvent({ type: 'click', preventDefault: () => {} });
    await new Promise((r) => setImmediate(r));

    assert.equal(env.postCalls.length, 1);
    assert.equal(env.postCalls[0].url, '/api/reviews');
    assert.equal(env.postCalls[0].body.rating, 4);
    assert.equal(env.doc.getElementById('existing-review-section').hidden, false);
    assert.equal(env.doc.getElementById('detail-review-rating').textContent, '★★★★☆');
    assert.ok(env.doc.getElementById('detail-review-comment').textContent.includes('Great local guide'));
  });

  it('21. Reviews: missing review API (404 / 503) communicates temporary unavailability and never falsely reports success', async () => {
    const env = createEnvironment({
      get: () => ({ data: { booking_id: 101, can_review: true, has_review: false } }),
      post: () => {
        const err = new Error('Route not found');
        err.status = 404;
        throw err;
      }
    });

    await env.controller.init();
    env.controller.openReviewModal();

    const star5 = env.doc.getElementById('review-form').querySelector('input[name="rating"][value="5"]');
    star5.checked = true;

    await env.controller.submitReview({ preventDefault: () => {} });

    assert.equal(env.doc.getElementById('review-modal').hidden, false, 'Modal must stay open');
    assert.equal(env.doc.getElementById('review-error-alert').hidden, false);
    assert.match(env.doc.getElementById('review-error-text').textContent, /temporarily unavailable/i);
    assert.notEqual(env.UI.lastToast && env.UI.lastToast.type, 'success');
  });

  it('22. Image fallback & URL normalization: formatImageUrl normalizes relative and seeded image paths', async () => {
    const env = createEnvironment({
      get: () => ({
        data: {
          booking_id: 101,
          package: { title: 'Munnar Escape', image: 'images/munnar-leisure.jpg' }
        }
      })
    });

    await env.controller.init();
    assert.equal(env.controller.formatImageUrl('images/munnar-leisure.jpg'), '/images/munnar-leisure.jpg');
    assert.equal(env.controller.formatImageUrl('munnar-leisure.jpg'), '/images/munnar-leisure.jpg');
    assert.equal(env.controller.formatImageUrl('/assets/images/dest-munnar.jpg'), '/assets/images/dest-munnar.jpg');
    assert.equal(env.controller.formatImageUrl(null), '/images/placeholder.jpg');
    assert.equal(env.doc.getElementById('detail-package-image').src, '/images/munnar-leisure.jpg');
  });
});
