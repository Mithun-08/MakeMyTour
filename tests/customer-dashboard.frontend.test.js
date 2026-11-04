/**
 * tests/customer-dashboard.frontend.test.js
 *
 * Persistent frontend test suite for public/js/pages/customer-dashboard.js.
 * Covers:
 *   1. CUSTOMER role authorization.
 *   2. Successful reports API request (GET /api/customer/reports).
 *   3. Welcome greeting and missing-name fallback.
 *   4. Total bookings and total spent rendering.
 *   5. All four status counts, including missing statuses.
 *   6. Upcoming trip card rendering.
 *   7. Booking detail links.
 *   8. Empty upcoming trips state.
 *   9. Image fallback.
 *   10. Loading state.
 *   11. API error state.
 *   12. Retry behavior.
 *   13. Stale response handling.
 *   14. Escaping API-provided text.
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SCRIPT_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'pages', 'customer-dashboard.js'), 'utf8');

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
    if (child.tagName === 'FRAGMENT') {
      child.children.forEach(c => {
        c.parentNode = this;
        this.children.push(c);
      });
    } else {
      child.parentNode = this;
      this.children.push(child);
    }
    return child;
  }

  querySelector(sel) {
    const all = this.querySelectorAll(sel);
    return all.length > 0 ? all[0] : null;
  }

  querySelectorAll(sel) {
    const results = [];
    const traverse = (node) => {
      node.children.forEach(c => {
        let match = false;
        if (sel.startsWith('.')) {
          if (c.classList.contains(sel.slice(1))) match = true;
        } else if (sel.toLowerCase() === c.tagName.toLowerCase()) {
          match = true;
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
  }

  createElement(tagName) {
    return new MockElement(tagName, this);
  }

  createDocumentFragment() {
    return new MockElement('fragment', this);
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

function createDashboardEnvironment(apiHandler, options = {}) {
  const doc = new MockDocument();

  // All 16 element IDs used by customer-dashboard.js
  const elementIds = [
    'dashboard-loading',
    'dashboard-error',
    'dashboard-error-msg',
    'btn-retry-dashboard',
    'dashboard-content',
    'customer-welcome-heading',
    'customer-welcome-sub',
    'kpi-total-bookings',
    'kpi-total-spent',
    'status-count-pending',
    'status-count-confirmed',
    'status-count-completed',
    'status-count-cancelled',
    'upcoming-trips-count',
    'upcoming-trips-container',
    'upcoming-empty'
  ];

  elementIds.forEach(id => {
    let tag = 'div';
    if (id.startsWith('btn-')) tag = 'button';
    const el = doc.createElement(tag);
    el.id = id;
    if (id.includes('loading') || id.includes('error') || id.includes('content') || id.includes('empty')) {
      el.hidden = true;
    }
  });

  const getCalls = [];
  const api = {
    get: (url, params) => {
      getCalls.push({ url, params });
      try {
        const res = apiHandler ? apiHandler(url, params) : { data: {} };
        return Promise.resolve(res);
      } catch (err) {
        return Promise.reject(err);
      }
    }
  };

  let requiredRoleChecked = null;
  const Auth = {
    requireRole: (roles) => {
      requiredRoleChecked = roles;
      if (options.role && options.role !== 'CUSTOMER') {
        return Promise.reject(new Error('Unauthorized'));
      }
      const user = options.user !== undefined
        ? options.user
        : { user_id: 10, role: 'CUSTOMER', name: 'Aarav Sharma' };
      return Promise.resolve(user);
    }
  };

  const UI = {
    escapeHtml: (s) => String(s || '').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    money: (n) => `₹${Number(n).toFixed(2)}`,
    date: (d) => `Date(${d})`,
    statusBadge: (st) => ({ outerHTML: `<span class="badge badge-${String(st).toLowerCase()}">${st}</span>` }),
    toast: (msg, type) => {
      UI.lastToast = { msg, type };
    }
  };

  const sandbox = {
    window: {},
    document: doc,
    api,
    Auth,
    UI,
    console,
    setTimeout: (fn) => fn(),
    clearTimeout: () => {}
  };
  sandbox.window = sandbox;

  const ctx = vm.createContext(sandbox);
  vm.runInContext(SCRIPT_SRC, ctx);

  return {
    doc,
    api,
    getCalls,
    UI,
    getRoleChecked: () => requiredRoleChecked,
    controller: sandbox.window.CustomerDashboard
  };
}

describe('Customer Dashboard — M2 Task 8 Verification', () => {

  it('1. Authorization: strictly enforces CUSTOMER role guard', async () => {
    const env = createDashboardEnvironment(() => ({ data: {} }), { role: 'CUSTOMER' });
    await env.controller.init();

    assert.equal(env.getRoleChecked()[0], 'CUSTOMER', 'Must verify CUSTOMER role');
    assert.equal(env.controller.state.user.role, 'CUSTOMER');
  });

  it('2. API Integration: dispatches GET /api/customer/reports and sets report state', async () => {
    const mockReport = {
      total_bookings: 8,
      total_spent: 45000,
      by_status: [{ status: 'CONFIRMED', count: 5 }],
      upcoming: []
    };

    const env = createDashboardEnvironment((url) => {
      assert.equal(url, '/api/customer/reports');
      return { data: mockReport };
    });

    await env.controller.init();

    assert.equal(env.getCalls.length, 1);
    assert.equal(env.getCalls[0].url, '/api/customer/reports');
    assert.equal(env.controller.state.reports.total_bookings, 8);
  });

  it('3. Welcome Greeting: personalized name rendering and missing-name fallback', async () => {
    // 3a. Customer with name
    const env1 = createDashboardEnvironment(() => ({ data: {} }), {
      user: { user_id: 1, role: 'CUSTOMER', name: 'Rohit Verma' }
    });
    await env1.controller.init();
    assert.equal(env1.doc.getElementById('customer-welcome-heading').textContent, 'Welcome back, Rohit Verma!');

    // 3b. Customer with missing name (null/empty)
    const env2 = createDashboardEnvironment(() => ({ data: {} }), {
      user: { user_id: 2, role: 'CUSTOMER', name: null, email: '' }
    });
    await env2.controller.init();
    assert.equal(env2.doc.getElementById('customer-welcome-heading').textContent, 'Welcome back!');
  });

  it('4. KPI Cards: renders total bookings and total spent using UI.money()', async () => {
    const env = createDashboardEnvironment(() => ({
      data: {
        total_bookings: 14,
        total_spent: 128500
      }
    }));

    await env.controller.init();

    assert.equal(env.doc.getElementById('kpi-total-bookings').textContent, '14');
    assert.equal(env.doc.getElementById('kpi-total-spent').textContent, '₹128500.00');
  });

  it('5. Status Counts: renders all 4 status counts and handles missing statuses as 0', async () => {
    // Partial status response from backend (only CONFIRMED and CANCELLED present)
    const env = createDashboardEnvironment(() => ({
      data: {
        by_status: [
          { status: 'CONFIRMED', count: 6 },
          { status: 'CANCELLED', count: 2 }
        ]
      }
    }));

    await env.controller.init();

    assert.equal(env.doc.getElementById('status-count-confirmed').textContent, '6');
    assert.equal(env.doc.getElementById('status-count-cancelled').textContent, '2');
    assert.equal(env.doc.getElementById('status-count-pending').textContent, '0', 'Missing PENDING must default to 0');
    assert.equal(env.doc.getElementById('status-count-completed').textContent, '0', 'Missing COMPLETED must default to 0');
  });

  it('6. Upcoming Trips: renders trip card with all metadata when upcoming array has items', async () => {
    const mockUpcoming = [
      {
        booking_id: 501,
        package_id: 20,
        package_title: 'Majestic Manali Getaway',
        package_image: '/images/manali.jpg',
        available_date: '2026-12-10',
        travelers: 3,
        total_amount: 36000,
        booking_status: 'CONFIRMED',
        payment_status: 'PAID'
      }
    ];

    const env = createDashboardEnvironment(() => ({
      data: { upcoming: mockUpcoming }
    }));

    await env.controller.init();

    assert.equal(env.doc.getElementById('upcoming-empty').hidden, true);
    assert.equal(env.doc.getElementById('upcoming-trips-container').hidden, false);
    assert.equal(env.doc.getElementById('upcoming-trips-count').textContent, '1 upcoming tour');

    const container = env.doc.getElementById('upcoming-trips-container');
    assert.equal(container.children.length, 1);

    const cardHtml = container.children[0].innerHTML;
    assert.ok(cardHtml.includes('Majestic Manali Getaway'), 'Must include package title');
    assert.ok(cardHtml.includes('#501'), 'Must include booking reference');
    assert.ok(cardHtml.includes('Date(2026-12-10)'), 'Must include travel date');
    assert.ok(cardHtml.includes('3'), 'Must include traveler count');
    assert.ok(cardHtml.includes('₹36000.00'), 'Must include formatted total amount');
    assert.ok(cardHtml.includes('badge-confirmed'), 'Must include booking status badge');
    assert.ok(cardHtml.includes('badge-paid'), 'Must include payment status badge');
  });

  it('7. Booking Detail Links: upcoming card link points to /booking-detail.html?id=:id', async () => {
    const env = createDashboardEnvironment(() => ({
      data: {
        upcoming: [{ booking_id: 888, package_title: 'Goa Holiday', total_amount: 8000 }]
      }
    }));

    await env.controller.init();

    const container = env.doc.getElementById('upcoming-trips-container');
    const cardHtml = container.children[0].innerHTML;
    assert.ok(cardHtml.includes('/booking-detail.html?id=888'), 'Must link to booking detail with encoded id');
  });

  it('8. Empty State: displays #upcoming-empty when upcoming trips array is empty', async () => {
    const env = createDashboardEnvironment(() => ({
      data: { upcoming: [] }
    }));

    await env.controller.init();

    assert.equal(env.doc.getElementById('upcoming-empty').hidden, false);
    assert.equal(env.doc.getElementById('upcoming-trips-container').hidden, true);
    assert.equal(env.doc.getElementById('upcoming-trips-count').textContent, '0 upcoming tours');
  });

  it('9. Image Fallback: uses placeholder image when package_image is null or empty', async () => {
    const env = createDashboardEnvironment(() => ({
      data: {
        upcoming: [{ booking_id: 101, package_title: 'No Image Tour', package_image: null }]
      }
    }));

    await env.controller.init();

    const container = env.doc.getElementById('upcoming-trips-container');
    const cardHtml = container.children[0].innerHTML;
    assert.ok(cardHtml.includes('src="/images/placeholder.jpg"'), 'Must fallback to placeholder image');
    assert.ok(cardHtml.includes('onerror="this.onerror=null;this.src=\'/images/placeholder.jpg\';"'), 'Must include onerror fallback handler');
  });

  it('10. Loading State: displays loading block and hides content while fetching', async () => {
    let resolveApi;
    const env = createDashboardEnvironment(() => new Promise(res => { resolveApi = res; }));

    // Trigger load
    const promise = env.controller.loadDashboard();

    assert.equal(env.doc.getElementById('dashboard-loading').hidden, false);
    assert.equal(env.doc.getElementById('dashboard-content').hidden, true);
    assert.equal(env.doc.getElementById('dashboard-error').hidden, true);

    resolveApi({ data: { total_bookings: 1 } });
    await promise;

    assert.equal(env.doc.getElementById('dashboard-loading').hidden, true);
    assert.equal(env.doc.getElementById('dashboard-content').hidden, false);
  });

  it('11. API Error State: surfaces error message and displays error view on failure', async () => {
    const env = createDashboardEnvironment(() => {
      const err = new Error('Service Temporarily Unavailable');
      err.status = 503;
      throw err;
    });

    await env.controller.init();

    assert.equal(env.doc.getElementById('dashboard-loading').hidden, true);
    assert.equal(env.doc.getElementById('dashboard-content').hidden, true);
    const errorEl = env.doc.getElementById('dashboard-error');
    assert.equal(errorEl.hidden, false);
    assert.equal(env.doc.getElementById('dashboard-error-msg').textContent, 'Service Temporarily Unavailable');
  });

  it('12. Retry Behavior: #btn-retry-dashboard recovers cleanly without page reload', async () => {
    let shouldFail = true;
    const env = createDashboardEnvironment(() => {
      if (shouldFail) {
        throw new Error('Network failure');
      }
      return { data: { total_bookings: 99, total_spent: 99000 } };
    });

    await env.controller.init();
    assert.equal(env.doc.getElementById('dashboard-error').hidden, false);

    // Simulate clicking retry
    shouldFail = false;
    const retryBtn = env.doc.getElementById('btn-retry-dashboard');
    retryBtn.dispatchEvent({ type: 'click' });
    await new Promise(r => setTimeout(r, 10));

    assert.equal(env.doc.getElementById('dashboard-error').hidden, true);
    assert.equal(env.doc.getElementById('dashboard-content').hidden, false);
    assert.equal(env.doc.getElementById('kpi-total-bookings').textContent, '99');
  });

  it('13. Stale Response Handling: drops out-of-order async responses cleanly', async () => {
    let callCount = 0;
    let slowResolve;
    let fastResolve;

    const env = createDashboardEnvironment(() => {
      callCount++;
      if (callCount === 1) {
        return new Promise(res => { slowResolve = res; });
      }
      if (callCount === 2) {
        return new Promise(res => { fastResolve = res; });
      }
      return { data: { total_bookings: 0 } };
    });

    // Call 1: slow
    const p1 = env.controller.loadDashboard();
    // Call 2: fast
    const p2 = env.controller.loadDashboard();

    // Fast resolves first with newer data
    fastResolve({ data: { total_bookings: 555 } });
    await p2;

    assert.equal(env.controller.state.reports.total_bookings, 555);

    // Slow resolves later with outdated data
    slowResolve({ data: { total_bookings: 111 } });
    await p1;

    // Must preserve the newer data!
    assert.equal(env.controller.state.reports.total_bookings, 555, 'Stale slow response must be dropped');
  });

  it('14. Escaping Text: escapes XSS characters in package title and user name', async () => {
    const maliciousTitle = '<script>alert("xss")</script>Paradise Tour';
    const env = createDashboardEnvironment(() => ({
      data: {
        upcoming: [{ booking_id: 77, package_title: maliciousTitle, total_amount: 1000 }]
      }
    }), {
      user: { user_id: 1, role: 'CUSTOMER', name: '<b>Hacker</b>' }
    });

    await env.controller.init();

    // 14a. User name in welcome heading
    const headingText = env.doc.getElementById('customer-welcome-heading').textContent;
    assert.equal(headingText, 'Welcome back, <b>Hacker</b>!');

    // 14b. Package title in card innerHTML must be escaped
    const container = env.doc.getElementById('upcoming-trips-container');
    const cardHtml = container.children[0].innerHTML;
    assert.ok(!cardHtml.includes('<script>'), 'Raw script tags must NOT be present in card HTML');
    assert.ok(cardHtml.includes('&lt;script&gt;alert("xss")&lt;/script&gt;Paradise Tour'));
  });
});
