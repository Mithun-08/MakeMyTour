/**
 * tests/customer-bookings.frontend.test.js
 *
 * Comprehensive frontend tests for public/js/pages/my-bookings.js in a VM environment.
 * Tests:
 *   1. Authentication & Role Protection (Auth.requireRole(['CUSTOMER'])).
 *   2. Status Filtering (ALL, PENDING, CONFIRMED, COMPLETED, CANCELLED) with active classes & page 1 reset.
 *   3. Cross-page search behavior across booking ID and package title.
 *   4. Pagination controls & preservation of active status filters across page changes.
 *   5. Contextual Actions visibility (View, Pay Now, Cancel) based on backend fields & can_cancel.
 *   6. Stale network response dropping (activeRequestId).
 *   7. Empty & Error states handling and retry functionality.
 */

'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SCRIPT_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'pages', 'my-bookings.js'), 'utf8');

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
    if (sel.startsWith('.')) {
      const cls = sel.slice(1);
      return this.children.find(c => c.classList.contains(cls)) || null;
    }
    return null;
  }

  closest(sel) {
    if (sel === '[data-status]' && this.attributes['data-status'] !== undefined) {
      return this;
    }
    return null;
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

  querySelectorAll(sel) {
    if (sel.includes('[data-status]')) {
      const filters = this.elements.get('bookings-filters');
      if (filters) {
        return filters.children.filter(c => c.attributes['data-status'] !== undefined);
      }
    }
    return [];
  }

  addEventListener(type, fn) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(fn);
  }
}

function createTestEnvironment(apiHandler, role = 'CUSTOMER', options = {}) {
  const doc = new MockDocument();

  // Create standard elements corresponding to public/customer-bookings.html
  const filterContainer = doc.createElement('div');
  filterContainer.id = 'bookings-filters';

  ['ALL', 'PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED'].forEach(st => {
    const btn = doc.createElement('button');
    btn.setAttribute('data-status', st === 'ALL' ? '' : st);
    if (st === 'ALL') {
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
    }
    filterContainer.appendChild(btn);
  });

  const searchInput = doc.createElement('input');
  searchInput.id = 'bookings-search';

  const countEl = doc.createElement('span');
  countEl.id = 'bookings-count';

  const listContainer = doc.createElement('div');
  listContainer.id = 'bookings-list';

  const loadingEl = doc.createElement('div');
  loadingEl.id = 'bookings-loading';
  loadingEl.hidden = true;

  const emptyEl = doc.createElement('div');
  emptyEl.id = 'bookings-empty';
  emptyEl.hidden = true;
  const emptyBody = doc.createElement('div');
  emptyBody.className = 'state-box-body';
  emptyEl.appendChild(emptyBody);

  const errorEl = doc.createElement('div');
  errorEl.id = 'bookings-error';
  errorEl.hidden = true;

  const errorMsgEl = doc.createElement('div');
  errorMsgEl.id = 'bookings-error-msg';

  const btnRetry = doc.createElement('button');
  btnRetry.id = 'btn-retry-bookings';

  const tableWrapper = doc.createElement('div');
  tableWrapper.id = 'bookings-table-wrapper';
  tableWrapper.hidden = true;

  const table = doc.createElement('table');
  table.id = 'bookings-table';

  const tbody = doc.createElement('tbody');
  tbody.id = 'bookings-tbody';
  table.appendChild(tbody);
  tableWrapper.appendChild(table);

  const paginationEl = doc.createElement('div');
  paginationEl.id = 'bookings-pagination';

  listContainer.appendChild(loadingEl);
  listContainer.appendChild(emptyEl);
  listContainer.appendChild(errorEl);
  listContainer.appendChild(errorMsgEl);
  listContainer.appendChild(btnRetry);
  listContainer.appendChild(tableWrapper);

  const calls = [];
  const api = {
    get: (url, params) => {
      calls.push({ url, params: Object.assign({}, params) });
      try {
        const result = apiHandler ? apiHandler(url, params) : { data: [], meta: { page: 1, pageSize: 10, total: 0 } };
        return Promise.resolve(result);
      } catch (err) {
        return Promise.reject(err);
      }
    }
  };

  let requiredRolePassed = null;
  const Auth = {
    requireRole: (roles) => {
      requiredRolePassed = roles;
      if (role !== 'CUSTOMER') {
        return Promise.reject(new Error('Unauthorized'));
      }
      return Promise.resolve({ user_id: 42, role: 'CUSTOMER', name: 'Test Customer' });
    }
  };

  const UI = {
    escapeHtml: (s) => String(s || '').replace(/</g, '&lt;'),
    money: (n) => `₹${Number(n).toFixed(2)}`,
    date: (d) => `FormattedDate(${d})`,
    statusBadge: (st) => ({ outerHTML: `<span class="badge badge-${String(st).toLowerCase()}">${st}</span>` }),
    pager: (el, meta, onPage) => {
      el.meta = meta;
      el.onPage = onPage;
      el.hidden = false;
    },
    toast: (msg, type) => {
      UI.lastToast = { msg, type };
    }
  };

  const sandbox = {
    window: {
      location: {
        search: options.query || '',
        href: 'http://localhost/customer-bookings.html' + (options.query || '')
      },
      history: {
        replaceState: () => {},
        pushState: () => {}
      }
    },
    document: doc,
    api,
    Auth,
    UI,
    console,
    URLSearchParams,
    URL,
    setTimeout: (fn) => { fn(); return 1; },
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
    calls,
    Auth,
    UI,
    getRoleChecked: () => requiredRolePassed,
    controller: sandbox.window.MyBookings
  };
}

describe('Customer Bookings — M2 Task 3 Verification', () => {

  it('1. Authentication: strictly enforces CUSTOMER role guard', async () => {
    const env = createTestEnvironment(null, 'CUSTOMER');
    await env.controller.init();
    assert.equal(env.getRoleChecked()[0], 'CUSTOMER');
    assert.equal(env.controller.state.user.role, 'CUSTOMER');
  });

  it('2. Status filtering: sends status parameter, updates active button, and resets to page 1', async () => {
    const mockBookings = [
      {
        booking_id: 1,
        package_id: 10,
        package_title: 'Goa Tour',
        available_date: '2026-11-20',
        travelers: 2,
        total_amount: 12000,
        booking_status: 'CONFIRMED',
        payment_status: 'PAID',
        can_cancel: false
      }
    ];

    const env = createTestEnvironment((url, params) => {
      assert.equal(url, '/api/bookings/mine');
      return { data: mockBookings, meta: { page: params.page || 1, pageSize: 10, total: 1 } };
    });

    await env.controller.init();

    // Initial load requested status: ''
    assert.equal(env.calls[0].params.status, undefined);
    assert.equal(env.controller.state.filters.status, '');

    // Now set filter to CONFIRMED
    await env.controller.setStatusFilter('CONFIRMED');

    assert.equal(env.controller.state.filters.status, 'CONFIRMED');
    assert.equal(env.controller.state.filters.page, 1);
    assert.equal(env.calls[1].params.status, 'CONFIRMED');

    // Verify active button class
    const buttons = env.doc.querySelectorAll('#bookings-filters [data-status]');
    const confirmedBtn = buttons.find(b => b.getAttribute('data-status') === 'CONFIRMED');
    const allBtn = buttons.find(b => b.getAttribute('data-status') === '');

    assert.ok(confirmedBtn.classList.contains('active'), 'CONFIRMED button must have active class');
    assert.equal(confirmedBtn.getAttribute('aria-selected'), 'true');
    assert.ok(!allBtn.classList.contains('active'), 'All button must NOT have active class');
  });

  it('3. Search behaviour: performs cross-page search across multiple records', async () => {
    // Simulate 20 total bookings across pages
    const allRecords = [];
    for (let i = 1; i <= 20; i++) {
      allRecords.push({
        booking_id: i,
        package_id: 100 + i,
        package_title: i === 15 ? 'Unique Mountain Adventure' : `Standard Tour #${i}`,
        available_date: '2026-12-01',
        travelers: 1,
        total_amount: 5000,
        booking_status: 'CONFIRMED',
        payment_status: 'PAID',
        can_cancel: false
      });
    }

    const env = createTestEnvironment((url, params) => {
      return { data: allRecords, meta: { page: 1, pageSize: 50, total: 20 } };
    });

    await env.controller.init();
    assert.equal(env.controller.state.bookings.length, 20);

    // Search by title keyword that is located on record #15
    await env.controller.setSearchQuery('Mountain');

    assert.equal(env.controller.state.bookings.length, 1);
    assert.equal(env.controller.state.bookings[0].booking_id, 15);
    assert.equal(env.controller.state.bookings[0].package_title, 'Unique Mountain Adventure');

    // Search by booking ID
    await env.controller.setSearchQuery('15');
    assert.equal(env.controller.state.bookings.length, 1);
    assert.equal(env.controller.state.bookings[0].booking_id, 15);

    // Search for non-existent term shows empty state
    await env.controller.setSearchQuery('NonExistentPlace');
    assert.equal(env.controller.state.bookings.length, 0);
    assert.equal(env.doc.getElementById('bookings-empty').hidden, false);
    assert.equal(env.doc.getElementById('bookings-table-wrapper').hidden, true);
  });

  it('4. Pagination: changing pages preserves the selected status filter', async () => {
    const env = createTestEnvironment((url, params) => {
      return {
        data: [{ booking_id: params.page, package_title: `Tour P${params.page}`, total_amount: 5000 }],
        meta: { page: params.page, pageSize: 1, total: 3 }
      };
    });

    await env.controller.init();
    await env.controller.setStatusFilter('PENDING');

    // Trigger pagination callback for page 2
    const paginationEl = env.doc.getElementById('bookings-pagination');
    assert.ok(paginationEl.onPage, 'UI.pager callback must be set');

    paginationEl.onPage(2);
    // Wait tick
    await new Promise(r => setTimeout(r, 10));

    const lastCall = env.calls[env.calls.length - 1];
    assert.equal(lastCall.params.page, 2);
    assert.equal(lastCall.params.status, 'PENDING', 'Changing pages must preserve active status filter');
  });

  it('5. Contextual actions visibility: View, Pay Now, and Cancel buttons strictly adhere to rules', async () => {
    const testCases = [
      {
        booking_id: 101,
        package_title: 'Unpaid Pending Booking (Cancellable)',
        total_amount: 8000,
        booking_status: 'PENDING',
        payment_status: 'UNPAID',
        can_cancel: true,
        expectPayNow: true,
        expectCancel: true
      },
      {
        booking_id: 102,
        package_title: 'Paid Confirmed Booking (Non-cancellable)',
        total_amount: 14000,
        booking_status: 'CONFIRMED',
        payment_status: 'PAID',
        can_cancel: false,
        expectPayNow: false,
        expectCancel: false
      },
      {
        booking_id: 103,
        package_title: 'Cancelled Booking (No Pay, No Cancel)',
        total_amount: 9000,
        booking_status: 'CANCELLED',
        payment_status: 'UNPAID',
        can_cancel: false,
        expectPayNow: false,
        expectCancel: false
      }
    ];

    const env = createTestEnvironment(() => ({
      data: testCases,
      meta: { page: 1, pageSize: 10, total: 3 }
    }));

    await env.controller.init();

    const tbody = env.doc.getElementById('bookings-tbody');
    assert.equal(tbody.children.length, 3);

    // Row 1: Unpaid + Cancellable
    const row1Html = tbody.children[0].innerHTML;
    assert.ok(row1Html.includes('>View</a>'));
    assert.ok(row1Html.includes('>Pay Now</a>'), 'Unpaid booking must have Pay Now');
    assert.ok(row1Html.includes('>Cancel</a>'), 'can_cancel=true must have Cancel');

    // Row 2: Paid + Not cancellable
    const row2Html = tbody.children[1].innerHTML;
    assert.ok(row2Html.includes('>View</a>'));
    assert.ok(!row2Html.includes('>Pay Now</a>'), 'Paid booking must NOT have Pay Now');
    assert.ok(!row2Html.includes('>Cancel</a>'), 'can_cancel=false must NOT have Cancel');

    // Row 3: Cancelled
    const row3Html = tbody.children[2].innerHTML;
    assert.ok(row3Html.includes('>View</a>'));
    assert.ok(!row3Html.includes('>Pay Now</a>'), 'Cancelled booking must NOT have Pay Now');
    assert.ok(!row3Html.includes('>Cancel</a>'), 'Cancelled booking must NOT have Cancel');
  });

  it('6. Stale response handling: drops out-of-order responses cleanly', async () => {
    let slowResolve;
    let fastResolve;

    const env = createTestEnvironment((url, params) => {
      if (params.status === 'SLOW') {
        return new Promise(res => { slowResolve = res; });
      }
      if (params.status === 'FAST') {
        return new Promise(res => { fastResolve = res; });
      }
      return { data: [{ booking_id: 1, package_title: 'Initial' }], meta: { page: 1, pageSize: 10, total: 1 } };
    });

    await env.controller.init();

    // Trigger slow request
    env.controller.setStatusFilter('SLOW');

    // Trigger faster request immediately after
    env.controller.setStatusFilter('FAST');

    // Fast resolves first with newer data
    fastResolve({
      data: [{ booking_id: 999, package_title: 'Fast Tour' }],
      meta: { page: 1, pageSize: 10, total: 1 }
    });
    await new Promise(r => setTimeout(r, 10));

    assert.equal(env.controller.state.bookings[0].booking_id, 999);

    // Slow resolves later with outdated data
    slowResolve({
      data: [{ booking_id: 111, package_title: 'Outdated Slow Tour' }],
      meta: { page: 1, pageSize: 10, total: 1 }
    });
    await new Promise(r => setTimeout(r, 10));

    // Must still retain the fast (newer) result!
    assert.equal(env.controller.state.bookings[0].booking_id, 999, 'Stale slow response must be discarded');
  });

  it('7. Empty and Error states: handles errors and allows retry', async () => {
    let shouldFail = true;
    const env = createTestEnvironment(() => {
      if (shouldFail) {
        throw new Error('Database temporary connection failure');
      }
      return { data: [{ booking_id: 1, package_title: 'Recovered Tour' }], meta: { page: 1, pageSize: 10, total: 1 } };
    });

    await env.controller.init();

    const errorEl = env.doc.getElementById('bookings-error');
    const tableWrapper = env.doc.getElementById('bookings-table-wrapper');
    assert.equal(errorEl.hidden, false, 'Error state must be visible on API error');
    assert.equal(tableWrapper.hidden, true, 'Table must be hidden on API error');

    // Retry
    shouldFail = false;
    const retryBtn = env.doc.getElementById('btn-retry-bookings');
    retryBtn.dispatchEvent({ type: 'click' });
    await new Promise(r => setTimeout(r, 10));

    assert.equal(errorEl.hidden, true, 'Error state must be hidden after successful retry');
    assert.equal(tableWrapper.hidden, false, 'Table must be shown after successful retry');
    assert.equal(env.controller.state.bookings[0].booking_id, 1);
  });

  it('8. Query Parameters: parses ?status=CONFIRMED on page load and sets active filter', async () => {
    const env = createTestEnvironment((url, params) => {
      return { data: [{ booking_id: 1, booking_status: 'CONFIRMED' }], meta: { page: 1, pageSize: 10, total: 1 } };
    }, 'CUSTOMER', { query: '?status=CONFIRMED' });

    await env.controller.init();

    assert.equal(env.controller.state.filters.status, 'CONFIRMED');
    assert.equal(env.calls[0].params.status, 'CONFIRMED');

    const buttons = env.doc.querySelectorAll('#bookings-filters [data-status]');
    const confirmedBtn = buttons.find(b => b.getAttribute('data-status') === 'CONFIRMED');
    const allBtn = buttons.find(b => b.getAttribute('data-status') === '');

    assert.ok(confirmedBtn.classList.contains('active'), 'CONFIRMED button must be active when opened with ?status=CONFIRMED');
    assert.equal(confirmedBtn.getAttribute('aria-selected'), 'true');
    assert.ok(!allBtn.classList.contains('active'), 'All button must NOT be active');
  });
});
