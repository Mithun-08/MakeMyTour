/**
 * tests/package-detail.frontend.test.js
 * Focused tests for public/js/pages/package-detail.js in a VM environment.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const API_SRC    = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'api.js'), 'utf8');
const AUTH_SRC   = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'auth.js'), 'utf8');
const DETAIL_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'pages', 'package-detail.js'), 'utf8');

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
    this._value = '';
    this.options = [];
    this.selectedIndex = 0;
    this.src = '';
    this.alt = '';
    this.max = '';
    this.min = '';
    this.type = 'text';
    this._id = '';
    this._doc = doc;
  }

  get id() {
    return this._id;
  }

  set id(val) {
    this._id = String(val);
    if (this._doc && this._id) {
      this._doc.elements.set(this._id, this);
    }
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

  get value() {
    return this._value;
  }

  set value(val) {
    this._value = String(val);
    if (this.options && this.options.length) {
      const idx = this.options.findIndex(o => o.value === String(val));
      if (idx !== -1) this.selectedIndex = idx;
    }
  }

  get innerHTML() {
    return '';
  }

  set innerHTML(html) {
    // Unregister any child elements with IDs
    const unregister = (el) => {
      if (el._id && this._doc) this._doc.elements.delete(el._id);
      for (const c of el.children) unregister(c);
    };
    for (const c of this.children) unregister(c);

    this.children = [];
    this.options = [];
    this._textContent = '';
  }

  appendChild(child) {
    this.children.push(child);
    child.parentNode = this;
    if (child._id && this._doc) {
      this._doc.elements.set(child._id, child);
    }
    if (this.tagName === 'SELECT' && child.tagName === 'OPTION') {
      this.options.push(child);
    }
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) this.children.splice(idx, 1);
    if (child._id && this._doc) {
      this._doc.elements.delete(child._id);
    }
    if (this.tagName === 'SELECT' && child.tagName === 'OPTION') {
      const oIdx = this.options.indexOf(child);
      if (oIdx !== -1) this.options.splice(oIdx, 1);
    }
    return child;
  }

  remove(idx) {
    if (this.tagName === 'SELECT' && typeof idx === 'number') {
      const removed = this.options.splice(idx, 1)[0];
      if (removed) {
        const cIdx = this.children.indexOf(removed);
        if (cIdx !== -1) this.children.splice(cIdx, 1);
        if (removed._id && this._doc) this._doc.elements.delete(removed._id);
      }
    }
  }

  setAttribute(k, v) {
    this.attributes[k] = String(v);
  }

  getAttribute(k) {
    return this.attributes[k] !== undefined ? this.attributes[k] : null;
  }

  removeAttribute(k) {
    delete this.attributes[k];
  }

  addEventListener(event, fn) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }

  dispatchEvent(event) {
    const type = typeof event === 'string' ? event : event.type;
    const handlers = this.listeners[type] || [];
    for (const h of handlers) h(event);
  }
}

class MockDocument {
  constructor() {
    this.elements = new Map();
    this.listeners = {};
    this.readyState = 'complete';

    // Pre-create standard IDs present in package-detail.html
    const standardIds = [
      'detail-loading', 'detail-error', 'detail-error-title', 'detail-error-message',
      'detail-content', 'breadcrumb-title', 'pkg-category-badge', 'pkg-status-badge',
      'pkg-title', 'pkg-destination', 'pkg-duration', 'pkg-rating', 'pkg-image',
      'pkg-image-placeholder', 'pkg-description', 'spec-duration', 'spec-capacity',
      'spec-provider', 'pkg-dest-section', 'pkg-dest-name', 'pkg-dest-desc',
      'pkg-itinerary-section', 'pkg-itinerary-list', 'pkg-inclusions-list',
      'pkg-exclusions-list', 'pkg-dates-container', 'booking-card-price',
      'summary-unit-price', 'booking-date', 'booking-date-hint', 'booking-date-error',
      'booking-travelers', 'booking-travelers-hint', 'booking-travelers-error',
      'summary-count', 'summary-total', 'booking-action-container', 'booking-form',
      'booking-form-error', 'booking-error-text', 'booking-success', 'success-booking-id',
      'success-pkg-title', 'success-date', 'success-travelers', 'success-amount',
      'success-status', 'success-payment'
    ];

    for (const id of standardIds) {
      const tag = id.includes('date') && !id.includes('container') && !id.includes('hint') && !id.includes('error') && !id.includes('success') ? 'select'
        : id === 'booking-travelers' ? 'input'
        : id.includes('form') && !id.includes('error') ? 'form'
        : id === 'pkg-image' ? 'img'
        : 'div';
      const el = new MockElement(tag, this);
      el.id = id;
      this.elements.set(id, el);
    }
  }

  getElementById(id) {
    return this.elements.get(id) || null;
  }

  createElement(tag) {
    return new MockElement(tag, this);
  }

  addEventListener(event, fn) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }
}

function makeEnv(routes = {}, search = '?id=1') {
  const calls = [];
  const events = [];
  const toasts = [];
  const location = {
    pathname: '/package-detail.html',
    search,
    href: 'http://localhost/package-detail.html' + search
  };

  function fetch(url, opts = {}) {
    const key = (opts.method || 'GET') + ' ' + url.split('?')[0];
    calls.push({ key, body: opts.body ? JSON.parse(opts.body) : null });
    let r = routes[key];
    if (typeof r === 'function') r = r(opts);
    if (r === undefined) r = [404, { success: false, error: { code: 'NOT_FOUND', message: 'Not found' } }];
    if (r instanceof Error) return Promise.reject(r);
    const [status, json] = r;
    return Promise.resolve({
      status,
      json: () => Promise.resolve(json)
    });
  }

  const document = new MockDocument();
  const window = {
    location,
    document,
    dispatchEvent: (e) => events.push(e),
    addEventListener: (t, fn) => {
      if (!window._listeners) window._listeners = {};
      if (!window._listeners[t]) window._listeners[t] = [];
      window._listeners[t].push(fn);
    },
    UI: {
      toast: (m, t) => toasts.push([m, t]),
      money: (n) => '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      date: (d) => String(d).slice(0, 10),
      escapeHtml: (s) => String(s)
    }
  };

  const sandbox = {
    window,
    document,
    fetch,
    Promise,
    URLSearchParams,
    encodeURIComponent,
    parseInt,
    parseFloat,
    isNaN,
    Number,
    String,
    Math,
    Array,
    Object,
    TypeError,
    Error,
    CustomEvent: class { constructor(t, i) { this.type = t; this.detail = i && i.detail; } }
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);

  vm.runInContext(API_SRC, sandbox);
  sandbox.api = window.api;
  sandbox.ApiError = window.ApiError;

  vm.runInContext(AUTH_SRC, sandbox);
  sandbox.Auth = window.Auth;

  vm.runInContext(DETAIL_SRC, sandbox);

  return {
    window,
    document,
    api: window.api,
    Auth: window.Auth,
    Page: window.PackageDetailPage,
    calls,
    toasts
  };
}

const SAMPLE_PACKAGE = {
  package_id: 1,
  title: 'Munnar Misty Escape',
  description: 'A 4-day scenic tea gardens escape.',
  price: 8500.00,
  duration_days: 4,
  capacity: 20,
  image: 'images/munnar.jpg',
  status: 'APPROVED',
  destination_id: 1,
  destination_name: 'Munnar Hill Station',
  state: 'Kerala',
  destination: {
    destination_id: 1,
    name: 'Munnar Hill Station',
    state: 'Kerala',
    country: 'India',
    description: 'Scenic hill station with tea gardens.'
  },
  category_id: 5,
  category_name: 'Leisure',
  provider_id: 4,
  provider_name: 'Ravi Kumar',
  provider: {
    user_id: 4,
    name: 'Ravi Kumar',
    city: 'Kochi',
    state: 'Kerala'
  },
  rating: {
    avg: 4.8,
    count: 15
  },
  inclusions: ['Hotel stay 3 nights', 'Daily breakfast and dinner', 'Tea estate tour'],
  exclusions: ['Flights', 'Lunch', 'Personal expenses'],
  itinerary: [
    { day_no: 1, title: 'Arrival & Tea Museum', description: 'Check-in and visit museum' },
    { day_no: 2, title: 'Eravikulam National Park', description: 'Safari to see Nilgiri Tahr' },
    { day_no: 3, title: 'Mattupetty Dam', description: 'Boating and viewpoints' },
    { day_no: 4, title: 'Departure', description: 'Souvenir shopping and checkout' }
  ],
  availability: [
    { availability_id: 101, available_date: '2026-11-15', seats_available: 12, status: 'OPEN' },
    { availability_id: 102, available_date: '2026-11-22', seats_available: 5, status: 'OPEN' }
  ]
};

const CUSTOMER_USER = {
  user_id: 7,
  name: 'Anita Sharma',
  email: 'customer1@makemytour.test',
  role: 'CUSTOMER',
  status: 'ACTIVE'
};

const PROVIDER_USER = {
  user_id: 4,
  name: 'Ravi Kumar',
  email: 'provider1@makemytour.test',
  role: 'PROVIDER',
  status: 'ACTIVE'
};

describe('Package Detail — Package ID extraction', () => {
  it('extracts positive integer package ID correctly', () => {
    const { Page } = makeEnv();
    assert.equal(Page.extractPackageId('?id=1'), 1);
    assert.equal(Page.extractPackageId('?id=42'), 42);
    assert.equal(Page.extractPackageId('?foo=bar&id=108&other=val'), 108);
  });

  it('returns null for missing, non-numeric, zero or negative package ID', () => {
    const { Page } = makeEnv();
    assert.equal(Page.extractPackageId(''), null);
    assert.equal(Page.extractPackageId('?id='), null);
    assert.equal(Page.extractPackageId('?id=abc'), null);
    assert.equal(Page.extractPackageId('?id=0'), null);
    assert.equal(Page.extractPackageId('?id=-5'), null);
    assert.equal(Page.extractPackageId('?id=1.5'), null);
  });
});

describe('Package Detail — Calculations & Image URL formatting', () => {
  it('calculateTotal calculates unit price × travelers with 2-decimal rounding', () => {
    const { Page } = makeEnv();
    assert.equal(Page.calculateTotal(8500, 1), 8500);
    assert.equal(Page.calculateTotal(8500, 3), 25500);
    assert.equal(Page.calculateTotal(4999.50, 2), 9999);
    assert.equal(Page.calculateTotal(4999.333, 3), 14998);
  });

  it('calculateTotal returns 0 for invalid inputs', () => {
    const { Page } = makeEnv();
    assert.equal(Page.calculateTotal(8500, 0), 0);
    assert.equal(Page.calculateTotal(8500, -1), 0);
    assert.equal(Page.calculateTotal(8500, 1.5), 0);
    assert.equal(Page.calculateTotal(null, 2), 0);
    assert.equal(Page.calculateTotal('foo', 2), 0);
  });

  it('formatImageUrl formats relative, seeded, and absolute image paths', () => {
    const { Page } = makeEnv();
    assert.equal(Page.formatImageUrl('munnar.jpg'), '/images/munnar.jpg');
    assert.equal(Page.formatImageUrl('images/munnar.jpg'), '/images/munnar.jpg');
    assert.equal(Page.formatImageUrl('/uploads/pic.jpg'), '/uploads/pic.jpg');
    assert.equal(Page.formatImageUrl('https://example.com/img.jpg'), 'https://example.com/img.jpg');
    assert.equal(Page.formatImageUrl(''), null);
    assert.equal(Page.formatImageUrl(null), null);
  });
});

describe('Package Detail — Booking validation', () => {
  it('validates required availability date', () => {
    const { Page } = makeEnv();
    const res = Page.validateBooking('', 1, 10, 20);
    assert.equal(res.valid, false);
    assert.equal(res.field, 'availability_id');
  });

  it('validates traveler count >= 1', () => {
    const { Page } = makeEnv();
    const res0 = Page.validateBooking(101, 0, 10, 20);
    assert.equal(res0.valid, false);
    assert.equal(res0.field, 'travelers');

    const resNeg = Page.validateBooking(101, -2, 10, 20);
    assert.equal(resNeg.valid, false);
  });

  it('rejects traveler count exceeding available seats on chosen date', () => {
    const { Page } = makeEnv();
    const res = Page.validateBooking(101, 8, 5, 20);
    assert.equal(res.valid, false);
    assert.match(res.error, /Only 5 seats are available/);
  });

  it('rejects traveler count exceeding package capacity', () => {
    const { Page } = makeEnv();
    const res = Page.validateBooking(101, 15, 20, 12);
    assert.equal(res.valid, false);
    assert.match(res.error, /exceed package capacity \(12\)/);
  });

  it('rejects traveler count exceeding system maximum of 10', () => {
    const { Page } = makeEnv();
    const res = Page.validateBooking(101, 12, 50, 50);
    assert.equal(res.valid, false);
    assert.match(res.error, /cannot exceed 10/);
  });

  it('accepts valid booking inputs within seats and capacity', () => {
    const { Page } = makeEnv();
    const res = Page.validateBooking(101, 4, 10, 20);
    assert.equal(res.valid, true);
  });
});

describe('Package Detail — Booking request payload construction', () => {
  it('builds payload matching M3 POST /api/bookings contract', () => {
    const { Page } = makeEnv();
    const payload = Page.buildBookingPayload('1', '101', '3');
    assert.equal(payload.package_id, 1);
    assert.equal(payload.availability_id, 101);
    assert.equal(payload.travelers, 3);
    assert.equal(typeof payload.package_id, 'number');
    assert.equal(typeof payload.availability_id, 'number');
    assert.equal(typeof payload.travelers, 'number');
  });
});

describe('Package Detail — DOM rendering', () => {
  it('renders package title, description, price, specs, rating and provider info', () => {
    const env = makeEnv();
    const { Page, document } = env;

    Page.renderPackage(SAMPLE_PACKAGE, CUSTOMER_USER);

    assert.equal(document.getElementById('pkg-title').textContent, 'Munnar Misty Escape');
    assert.equal(document.getElementById('pkg-description').textContent, 'A 4-day scenic tea gardens escape.');
    assert.equal(document.getElementById('pkg-destination').textContent, '📍 Munnar Hill Station, Kerala');
    assert.equal(document.getElementById('pkg-duration').textContent, '🗓 4 days');
    assert.match(document.getElementById('pkg-rating').textContent, /⭐ 4.8 \(15 reviews\)/);
    assert.match(document.getElementById('spec-provider').textContent, /Ravi Kumar \(Kochi, Kerala\)/);
    assert.equal(document.getElementById('spec-duration').textContent, '4 Days');
    assert.equal(document.getElementById('spec-capacity').textContent, 'Up to 20 people');
  });

  it('renders day-wise itinerary correctly', () => {
    const env = makeEnv();
    const { Page, document } = env;

    Page.renderPackage(SAMPLE_PACKAGE, CUSTOMER_USER);

    const list = document.getElementById('pkg-itinerary-list');
    assert.equal(list.children.length, 4);
    assert.match(list.children[0].textContent, /Day 1/);
    assert.match(list.children[0].textContent, /Arrival & Tea Museum/);
    assert.match(list.children[3].textContent, /Day 4/);
    assert.match(list.children[3].textContent, /Departure/);
  });

  it('renders inclusions and exclusions with appropriate badges', () => {
    const env = makeEnv();
    const { Page, document } = env;

    Page.renderPackage(SAMPLE_PACKAGE, CUSTOMER_USER);

    const incList = document.getElementById('pkg-inclusions-list');
    assert.equal(incList.children.length, 3);
    assert.match(incList.children[0].textContent, /✓Hotel stay 3 nights/);

    const excList = document.getElementById('pkg-exclusions-list');
    assert.equal(excList.children.length, 3);
    assert.match(excList.children[0].textContent, /✕Flights/);
  });

  it('renders availability departures and populates date select dropdown', () => {
    const env = makeEnv();
    const { Page, document } = env;

    Page.renderPackage(SAMPLE_PACKAGE, CUSTOMER_USER);

    const datesTable = document.getElementById('pkg-dates-container');
    assert.match(datesTable.textContent, /2026-11-15/);
    assert.match(datesTable.textContent, /12 seats/);

    const select = document.getElementById('booking-date');
    // Default option + 2 available dates
    assert.equal(select.options.length, 3);
    assert.equal(select.options[1].value, '101');
    assert.match(select.options[1].textContent, /2026-11-15/);
    assert.match(select.options[1].textContent, /12 seats left/);
  });

  it('handles empty availability gracefully', () => {
    const env = makeEnv();
    const { Page, document } = env;

    const noAvailPkg = { ...SAMPLE_PACKAGE, availability: [] };
    Page.renderPackage(noAvailPkg, CUSTOMER_USER);

    const datesContainer = document.getElementById('pkg-dates-container');
    assert.match(datesContainer.textContent, /No upcoming departures/);

    const actionContainer = document.getElementById('booking-action-container');
    assert.match(actionContainer.textContent, /No departure dates currently open/);
  });
});

describe('Package Detail — Authentication requirement', () => {
  it('renders "Sign In to Book" button when caller is not authenticated', () => {
    const env = makeEnv();
    const { Page, document } = env;

    Page.renderPackage(SAMPLE_PACKAGE, null);

    const actionContainer = document.getElementById('booking-action-container');
    assert.match(actionContainer.textContent, /Please log in as a customer/);
    const loginBtn = document.getElementById('btn-login-to-book');
    assert.ok(loginBtn);
    assert.equal(loginBtn.textContent, 'Sign In to Book');
  });

  it('disables booking and shows notice when logged in as non-CUSTOMER (PROVIDER or ADMIN)', () => {
    const env = makeEnv();
    const { Page, document } = env;

    Page.renderPackage(SAMPLE_PACKAGE, PROVIDER_USER);

    const actionContainer = document.getElementById('booking-action-container');
    assert.match(actionContainer.textContent, /signed in as PROVIDER/);
    assert.match(actionContainer.textContent, /Only customer accounts can book/);
    assert.equal(document.getElementById('btn-submit-booking'), null);
  });

  it('enables "Confirm Booking" button when logged in as CUSTOMER', () => {
    const env = makeEnv();
    const { Page, document } = env;

    Page.renderPackage(SAMPLE_PACKAGE, CUSTOMER_USER);

    const submitBtn = document.getElementById('btn-submit-booking');
    assert.ok(submitBtn);
    assert.equal(submitBtn.textContent, 'Confirm Booking');
    assert.match(document.getElementById('booking-action-container').textContent, /Anita Sharma/);
  });
});

describe('Package Detail — Booking submission & response handling', () => {
  it('submits valid booking payload to POST /api/bookings and renders confirmation on success', async () => {
    const env = makeEnv({
      'POST /api/bookings': () => {
        return [201, {
          success: true,
          data: {
            booking_id: 88,
            total_amount: 17000.00,
            booking_status: 'PENDING',
            payment_status: 'UNPAID'
          },
          message: 'Booking created successfully'
        }];
      }
    });

    const { Page, document, calls, toasts } = env;
    Page.renderPackage(SAMPLE_PACKAGE, CUSTOMER_USER);

    const bookingCallsBefore = calls.filter(c => c.key === 'POST /api/bookings').length;
    const payload = Page.buildBookingPayload(1, 101, 2);
    const res = await Page.submitBooking(payload);

    assert.equal(res.booking_id, 88);
    const bookingCallsAfter = calls.filter(c => c.key === 'POST /api/bookings');
    assert.equal(bookingCallsAfter.length - bookingCallsBefore, 1);
    const lastCall = bookingCallsAfter[bookingCallsAfter.length - 1];
    assert.equal(lastCall.key, 'POST /api/bookings');
    assert.equal(lastCall.body.package_id, 1);
    assert.equal(lastCall.body.availability_id, 101);
    assert.equal(lastCall.body.travelers, 2);

    // Success UI rendered
    assert.equal(document.getElementById('booking-form').hidden, true);
    assert.equal(document.getElementById('booking-success').hidden, false);
    assert.equal(document.getElementById('success-booking-id').textContent, '#88');
    assert.equal(document.getElementById('success-pkg-title').textContent, 'Munnar Misty Escape');
    assert.equal(document.getElementById('success-travelers').textContent, '2');
    assert.equal(document.getElementById('success-status').textContent, 'PENDING');
    assert.equal(document.getElementById('success-payment').textContent, 'UNPAID');

    // Success toast shown
    assert.ok(toasts.some(t => t[1] === 'success' && t[0].includes('88')));
  });

  it('handles 409 conflict error (seats unavailable) and displays error in form and toast', async () => {
    const env = makeEnv({
      'POST /api/bookings': [409, {
        success: false,
        error: { code: 'CONFLICT', message: 'Not enough seats available' }
      }]
    });

    const { Page, document, toasts } = env;
    Page.renderPackage(SAMPLE_PACKAGE, CUSTOMER_USER);

    const payload = Page.buildBookingPayload(1, 101, 10);
    await assert.rejects(Page.submitBooking(payload), (err) => {
      return err.status === 409 && err.message === 'Not enough seats available';
    });

    assert.equal(document.getElementById('booking-form-error').hidden, false);
    assert.equal(document.getElementById('booking-error-text').textContent, 'Not enough seats available');
    assert.ok(toasts.some(t => t[1] === 'error' && t[0].includes('Not enough seats')));
  });
});
