/**
 * tests/provider-dashboard.frontend.test.js
 * Focused frontend tests for public/js/pages/provider-dashboard.js in a VM environment.
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const API_SRC       = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'api.js'), 'utf8');
const AUTH_SRC      = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'auth.js'), 'utf8');
const DASHBOARD_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'pages', 'provider-dashboard.js'), 'utf8');

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
  toggle(name, force) {
    if (force !== undefined) {
      if (force) this._classes.add(name);
      else this._classes.delete(name);
    } else {
      if (this._classes.has(name)) this._classes.delete(name);
      else this._classes.add(name);
    }
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
    this._value = '';
    this.options = [];
    this.selectedIndex = 0;
    this.src = '';
    this.alt = '';
    this.type = 'text';
    this.dataset = {};
    this._id = '';
    this._className = '';
    this.classList = new MockClassList(this);
    this._doc = doc;
    this.parentNode = null;
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

  get className() {
    return this._className;
  }

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
    return this.children.map(c => `<${c.tagName.toLowerCase()}>${c.textContent}</${c.tagName.toLowerCase()}>`).join('');
  }

  set innerHTML(html) {
    const unregister = (el) => {
      if (el._id && this._doc) this._doc.elements.delete(el._id);
      for (const c of el.children) unregister(c);
    };
    for (const c of this.children) unregister(c);

    this.children = [];
    this.options = [];
    this._innerHTML = String(html || '');
    this._textContent = this._innerHTML.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
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
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentNode = null;
    }
    if (child._id && this._doc) {
      this._doc.elements.delete(child._id);
    }
    if (this.tagName === 'SELECT' && child.tagName === 'OPTION') {
      const oIdx = this.options.indexOf(child);
      if (oIdx !== -1) this.options.splice(oIdx, 1);
    }
    return child;
  }

  setAttribute(k, v) {
    this.attributes[k] = String(v);
    if (k.startsWith('data-')) {
      const prop = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      this.dataset[prop] = String(v);
    }
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
    const e = typeof event === 'string' ? { type: event, preventDefault: () => {}, target: this } : event;
    if (!e.preventDefault) e.preventDefault = () => {};
    if (!e.target) e.target = this;
    const handlers = this.listeners[e.type] || [];
    for (const h of handlers) h(e);
  }

  focus() {}

  querySelector(sel) {
    const matches = this.querySelectorAll(sel);
    return matches.length > 0 ? matches[0] : null;
  }

  querySelectorAll(sel) {
    const results = [];
    const walk = (node) => {
      for (const c of node.children) {
        if (matchesSelector(c, sel)) results.push(c);
        walk(c);
      }
    };
    walk(this);
    return results;
  }
}

function matchesSelector(el, sel) {
  if (!sel) return false;
  if (sel.startsWith('#')) return el._id === sel.slice(1);
  if (sel.startsWith('.')) return el.classList.contains(sel.slice(1));
  if (sel.includes('.')) {
    const [tag, cls] = sel.split('.');
    return (!tag || el.tagName.toLowerCase() === tag.toLowerCase()) && el.classList.contains(cls);
  }
  if (sel.startsWith('[') && sel.endsWith(']')) {
    const inside = sel.slice(1, -1);
    if (inside.includes('=')) {
      const [k, v] = inside.split('=').map(s => s.replace(/["']/g, '').trim());
      return el.getAttribute(k) === v;
    }
    return el.getAttribute(inside) !== null;
  }
  return el.tagName.toLowerCase() === sel.toLowerCase();
}

class MockDocument {
  constructor() {
    this.elements = new Map();
    this.listeners = {};
    this.readyState = 'loading';

    const standardIds = [
      'dashboard-title', 'btn-open-create-modal',
      'stat-total', 'stat-approved', 'stat-pending', 'stat-disabled', 'stat-rejected',
      'card-stat-all', 'card-stat-approved', 'card-stat-pending', 'card-stat-disabled', 'card-stat-rejected',
      'provider-filter-form', 'pkg-search-input', 'pkg-status-filter', 'btn-filter-apply', 'btn-filter-reset', 'pkg-result-count',
      'pkg-table-container', 'pkg-table', 'pkg-tbody', 'pkg-pagination',
      'pkg-modal', 'modal-pkg-heading', 'btn-close-modal', 'btn-cancel-modal',
      'package-form', 'form-error-alert', 'form-error-text', 'form-pkg-id',
      'form-title', 'form-destination', 'form-category', 'form-price', 'form-duration', 'form-capacity',
      'form-image', 'form-description', 'form-inclusions', 'form-exclusions',
      'itinerary-list', 'btn-add-day', 'section-availability', 'availability-list', 'btn-add-avail-date', 'btn-save-package',
      'view-modal', 'view-modal-title', 'view-modal-body', 'btn-close-view-modal', 'btn-dismiss-view-modal',
      'site-header', 'site-footer'
    ];

    for (const id of standardIds) {
      const tag = id === 'form-destination' || id === 'form-category' || id === 'pkg-status-filter' ? 'select'
        : id.includes('form') && !id.includes('alert') && !id.includes('id') && !id.includes('text') && !id.includes('title') ? 'form'
        : id.includes('input') || id.includes('price') || id.includes('duration') || id.includes('capacity') || id.includes('image') || id === 'form-title' || id === 'form-pkg-id' ? 'input'
        : id.includes('filter') && !id.includes('form') && !id.includes('reset') && !id.includes('apply') || id.includes('destination') || id.includes('category') ? 'select'
        : id.includes('description') || id.includes('inclusions') || id.includes('exclusions') ? 'textarea'
        : id.includes('btn') ? 'button'
        : id.includes('table') ? 'table'
        : id.includes('tbody') ? 'tbody'
        : 'div';
      const el = new MockElement(tag, this);
      el.id = id;
      this.elements.set(id, el);
    }

    // Set stat-card status attributes & class
    ['card-stat-all', 'card-stat-approved', 'card-stat-pending', 'card-stat-disabled', 'card-stat-rejected'].forEach(cid => {
      const card = this.getElementById(cid);
      if (card) card.className = 'stat-card';
    });
    this.getElementById('card-stat-all').setAttribute('data-status', '');
    this.getElementById('card-stat-approved').setAttribute('data-status', 'APPROVED');
    this.getElementById('card-stat-pending').setAttribute('data-status', 'PENDING');
    this.getElementById('card-stat-disabled').setAttribute('data-status', 'DISABLED');
    this.getElementById('card-stat-rejected').setAttribute('data-status', 'REJECTED');
  }

  getElementById(id) {
    return this.elements.get(id) || null;
  }

  createElement(tag) {
    return new MockElement(tag, this);
  }

  querySelector(sel) {
    if (sel.startsWith('#')) return this.getElementById(sel.slice(1));
    for (const el of this.elements.values()) {
      if (matchesSelector(el, sel)) return el;
    }
    return null;
  }

  querySelectorAll(sel) {
    const list = [];
    for (const el of this.elements.values()) {
      if (matchesSelector(el, sel)) list.push(el);
    }
    return list;
  }

  addEventListener(event, fn) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }

  dispatchEvent(event) {
    const e = typeof event === 'string' ? { type: event, preventDefault: () => {}, target: this } : event;
    if (!e.preventDefault) e.preventDefault = () => {};
    if (!e.target) e.target = this;
    const handlers = this.listeners[e.type] || [];
    for (const h of handlers) h(e);
  }
}

function makeEnv(routes = {}) {
  const calls = [];
  const events = [];
  const toasts = [];
  const location = {
    pathname: '/provider-dashboard.html',
    search: '',
    href: 'http://localhost/provider-dashboard.html'
  };

  function fetch(url, opts = {}) {
    const method = opts.method || 'GET';
    const parsedUrl = new URL(url, 'http://localhost');
    const pathOnly = parsedUrl.pathname;
    const queryParams = Object.fromEntries(parsedUrl.searchParams.entries());
    const key = method + ' ' + pathOnly;

    const callRecord = {
      key,
      fullUrl: url,
      method,
      path: pathOnly,
      query: queryParams,
      body: opts.body ? JSON.parse(opts.body) : null
    };
    calls.push(callRecord);

    let handler = routes[key];
    if (typeof handler === 'function') {
      handler = handler(callRecord);
    }
    if (handler === undefined) {
      handler = [404, { success: false, error: { code: 'NOT_FOUND', message: 'Not found: ' + key } }];
    }
    if (handler instanceof Error) {
      return Promise.reject(handler);
    }

    const [status, json] = handler;
    return Promise.resolve({
      status,
      json: () => Promise.resolve(json)
    });
  }

  const document = new MockDocument();
  const window = {
    location,
    document,
    confirm: () => true,
    dispatchEvent: (e) => events.push(e),
    addEventListener: (t, fn) => {
      if (!window._listeners) window._listeners = {};
      if (!window._listeners[t]) window._listeners[t] = [];
      window._listeners[t].push(fn);
    },
    UI: {
      toast: (m, t) => toasts.push({ message: m, type: t }),
      confirm: (msg) => Promise.resolve(true),
      money: (n) => '₹' + Number(n).toFixed(2),
      date: (d) => String(d).slice(0, 10),
      escapeHtml: (s) => String(s),
      statusBadge: (st) => {
        const span = document.createElement('span');
        span.className = 'badge badge-' + String(st).toLowerCase();
        span.textContent = st;
        return span;
      },
      showLoading: (el, msg) => {
        el.innerHTML = '';
        const p = document.createElement('p');
        p.className = 'state-loading';
        p.textContent = msg || 'Loading...';
        el.appendChild(p);
      },
      showError: (el, msg) => {
        el.innerHTML = '';
        const p = document.createElement('p');
        p.className = 'state-error';
        p.textContent = msg || 'Error';
        el.appendChild(p);
      },
      empty: (el, msg) => {
        el.innerHTML = '';
        const p = document.createElement('p');
        p.className = 'state-empty';
        p.textContent = msg || 'Empty';
        el.appendChild(p);
      },
      setLoading: (btn, busy) => {
        btn.disabled = !!busy;
      },
      clearErrors: () => {},
      showErrors: () => {}
    }
  };

  const sandbox = {
    window,
    document,
    fetch,
    URL,
    URLSearchParams,
    location,
    console,
    setTimeout,
    clearTimeout,
    Promise,
    CustomEvent: class { constructor(t, i) { this.type = t; this.detail = i && i.detail; } }
  };
  sandbox.window.window = sandbox.window;

  vm.createContext(sandbox);

  // Execute api.js, auth.js, provider-dashboard.js
  vm.runInContext(API_SRC, sandbox);
  sandbox.api = window.api;
  sandbox.ApiError = window.ApiError;

  vm.runInContext(AUTH_SRC, sandbox);
  sandbox.Auth = window.Auth;

  vm.runInContext(DASHBOARD_SRC, sandbox);

  return {
    sandbox,
    window,
    document,
    calls,
    events,
    toasts,
    location,
    dashboard: sandbox.window.ProviderDashboard
  };
}

describe('T6: Provider Package Management UI', () => {

  const demoProvider = {
    user_id: 10,
    name: 'Himalayan Expeditions',
    email: 'himalaya@provider.com',
    role: 'PROVIDER',
    status: 'ACTIVE',
    permissions: []
  };

  const mockDestinations = [
    { destination_id: 1, name: 'Srinagar', state: 'Jammu & Kashmir', status: 'ACTIVE' },
    { destination_id: 2, name: 'Manali', state: 'Himachal Pradesh', status: 'ACTIVE' }
  ];

  const mockCategories = [
    { category_id: 1, category_name: 'Adventure', status: 'ACTIVE' },
    { category_id: 2, category_name: 'Honeymoon', status: 'ACTIVE' }
  ];

  const mockPackages = [
    {
      package_id: 101,
      provider_id: 10,
      destination_id: 1,
      destination_name: 'Srinagar',
      city: 'Srinagar',
      state: 'Jammu & Kashmir',
      category_id: 1,
      category_name: 'Adventure',
      title: 'Kashmir Great Lakes Trek',
      description: 'High altitude alpine lakes trek',
      duration_days: 7,
      price: 18500,
      capacity: 15,
      image: '/images/kashmir.jpg',
      status: 'APPROVED',
      created_at: '2026-10-01T10:00:00Z',
      booking_count: 5,
      avg_rating: 4.9,
      review_count: 12
    },
    {
      package_id: 102,
      provider_id: 10,
      destination_id: 2,
      destination_name: 'Manali',
      city: 'Manali',
      state: 'Himachal Pradesh',
      category_id: 2,
      category_name: 'Honeymoon',
      title: 'Manali Romantic Getaway',
      description: 'Cozy apple orchards and mountain views',
      duration_days: 4,
      price: 12000,
      capacity: 10,
      image: null,
      status: 'PENDING',
      created_at: '2026-10-15T12:00:00Z',
      booking_count: 0,
      avg_rating: null,
      review_count: 0
    },
    {
      package_id: 103,
      provider_id: 10,
      destination_id: 1,
      destination_name: 'Srinagar',
      city: 'Srinagar',
      state: 'Jammu & Kashmir',
      category_id: 1,
      category_name: 'Adventure',
      title: 'Gulmarg Ski Adventure',
      description: 'Winter powdery slopes',
      duration_days: 5,
      price: 22000,
      capacity: 12,
      image: null,
      status: 'DISABLED',
      created_at: '2026-09-20T10:00:00Z',
      booking_count: 3,
      avg_rating: 4.5,
      review_count: 4
    },
    {
      package_id: 104,
      provider_id: 10,
      destination_id: 2,
      destination_name: 'Manali',
      city: 'Manali',
      state: 'Himachal Pradesh',
      category_id: 1,
      category_name: 'Adventure',
      title: 'Hampta Pass Trek',
      description: 'Crossover pass trek',
      duration_days: 5,
      price: 9500,
      capacity: 20,
      image: null,
      status: 'REJECTED',
      created_at: '2026-08-10T10:00:00Z',
      booking_count: 0,
      avg_rating: null,
      review_count: 0
    }
  ];

  function defaultRoutes() {
    return {
      'GET /api/auth/me': [200, { success: true, data: { user: demoProvider } }],
      'GET /api/destinations': [200, { success: true, data: mockDestinations }],
      'GET /api/categories': [200, { success: true, data: mockCategories }],
      'GET /api/provider/packages': (call) => {
        // Handle filtered or paginated requests
        let filtered = [...mockPackages];
        if (call.query.status) {
          filtered = filtered.filter(p => p.status === call.query.status);
        }
        if (call.query.q) {
          const q = call.query.q.toLowerCase();
          filtered = filtered.filter(p => p.title.toLowerCase().includes(q) || p.destination_name.toLowerCase().includes(q));
        }

        if (call.query.page || call.query.pageSize) {
          const page = parseInt(call.query.page || '1', 10);
          const pageSize = parseInt(call.query.pageSize || '10', 10);
          const start = (page - 1) * pageSize;
          const rows = filtered.slice(start, start + pageSize);
          return [200, {
            success: true,
            data: rows,
            meta: { page, pageSize, total: filtered.length, totalPages: Math.ceil(filtered.length / pageSize) }
          }];
        }
        return [200, { success: true, data: filtered, meta: { total: filtered.length } }];
      },
      'GET /api/provider/packages/101': [200, {
        success: true,
        data: {
          ...mockPackages[0],
          inclusions: ['Breakfast & Dinner', 'Camp Stay', 'Trek Guide'],
          exclusions: ['Personal porter', 'Insurance'],
          itinerary: [
            { day_no: 1, title: 'Arrival in Sonamarg', description: 'Acclimatize at base camp' },
            { day_no: 2, title: 'Trek to Nichnai', description: 'Steep climb through silver birch forest' }
          ],
          availability: [
            { availability_id: 1, available_date: '2026-11-15', seats_available: 10, status: 'OPEN' }
          ]
        }
      }]
    };
  }

  it('1. Role protection: redirects unauthenticated users to /login.html?next=...', async () => {
    const env = makeEnv({
      'GET /api/auth/me': [401, { success: false, error: { code: 'UNAUTHENTICATED', message: 'No session' } }]
    });

    env.dashboard.init();
    await new Promise(r => setTimeout(r, 20));
    assert.match(env.location.href, /\/login\.html\?next=/);
  });

  it('2. Role protection: rejects non-PROVIDER roles (CUSTOMER redirected to customer-dashboard.html)', async () => {
    const env = makeEnv({
      'GET /api/auth/me': [200, {
        success: true,
        data: { user: { user_id: 7, name: 'Alice Customer', role: 'CUSTOMER', status: 'ACTIVE' } }
      }]
    });

    env.dashboard.init();
    await new Promise(r => setTimeout(r, 20));
    assert.equal(env.location.href, '/customer-dashboard.html');
  });

  it('3. Role protection: rejects ADMIN users (redirected to admin-dashboard.html)', async () => {
    const env = makeEnv({
      'GET /api/auth/me': [200, {
        success: true,
        data: { user: { user_id: 1, name: 'Admin User', role: 'ADMIN', status: 'ACTIVE', permissions: ['*'] } }
      }]
    });

    env.dashboard.init();
    await new Promise(r => setTimeout(r, 20));
    assert.equal(env.location.href, '/admin-dashboard.html');
  });

  it('4. Metadata loading: populates destination and category dropdowns with active records', async () => {
    const env = makeEnv(defaultRoutes());
    await env.dashboard.init();

    const destSelect = env.document.getElementById('form-destination');
    const catSelect = env.document.getElementById('form-category');

    // Destinations: 1 placeholder + 2 loaded
    assert.equal(destSelect.options.length, 3);
    assert.equal(destSelect.options[1].value, '1');
    assert.match(destSelect.options[1].textContent, /Srinagar/);
    assert.equal(destSelect.options[2].value, '2');
    assert.match(destSelect.options[2].textContent, /Manali/);

    // Categories: 1 placeholder + 2 loaded
    assert.equal(catSelect.options.length, 3);
    assert.equal(catSelect.options[1].value, '1');
    assert.equal(catSelect.options[1].textContent, 'Adventure');
    assert.equal(catSelect.options[2].value, '2');
    assert.equal(catSelect.options[2].textContent, 'Honeymoon');
  });

  it('5. Stats calculation: correctly computes total, approved, pending, disabled, rejected counts', async () => {
    const env = makeEnv(defaultRoutes());
    await env.dashboard.init();

    assert.equal(env.document.getElementById('stat-total').textContent, '4');
    assert.equal(env.document.getElementById('stat-approved').textContent, '1');
    assert.equal(env.document.getElementById('stat-pending').textContent, '1');
    assert.equal(env.document.getElementById('stat-disabled').textContent, '1');
    assert.equal(env.document.getElementById('stat-rejected').textContent, '1');
  });

  it('6. Package table: renders package rows with title, destination, price, status badge and action buttons', async () => {
    const env = makeEnv(defaultRoutes());
    await env.dashboard.init();

    const tableContainer = env.document.getElementById('pkg-table-container');
    const table = tableContainer.querySelector('#pkg-table');
    assert.ok(table, 'Table must be rendered');

    // Check row for package 101
    const row101 = table.querySelector('#pkg-row-101');
    assert.ok(row101, 'Row for package 101 must exist');
    assert.match(row101.textContent, /Kashmir Great Lakes Trek/);
    assert.match(row101.textContent, /Srinagar/);
    assert.match(row101.textContent, /Adventure/);
    assert.match(row101.textContent, /₹18500\.00/);
    assert.match(row101.textContent, /APPROVED/);

    // Action buttons
    const btnView = row101.querySelector('#btn-view-pkg-101');
    const btnEdit = row101.querySelector('#btn-edit-pkg-101');
    const btnToggle = row101.querySelector('#btn-status-toggle-101');

    assert.ok(btnView, 'View button must exist');
    assert.ok(btnEdit, 'Edit button must exist');
    assert.ok(btnToggle, 'Toggle button must exist');
    assert.equal(btnToggle.textContent, 'Disable', 'Approved package should show Disable toggle');
  });

  it('7. Empty state: shows empty message when provider has 0 packages', async () => {
    const routes = defaultRoutes();
    routes['GET /api/provider/packages'] = [200, { success: true, data: [], meta: { total: 0 } }];

    const env = makeEnv(routes);
    await env.dashboard.init();

    const tableContainer = env.document.getElementById('pkg-table-container');
    const emptyBox = tableContainer.querySelector('.state-empty');
    assert.ok(emptyBox, 'Empty state container should be displayed');
    assert.match(emptyBox.textContent, /No packages found/);
  });

  it('8. Error state: displays error message when API call fails with 500', async () => {
    const routes = defaultRoutes();
    routes['GET /api/provider/packages'] = [500, { success: false, error: { message: 'Database connection failed' } }];

    const env = makeEnv(routes);
    await env.dashboard.init();

    const tableContainer = env.document.getElementById('pkg-table-container');
    const errorBox = tableContainer.querySelector('.state-error');
    assert.ok(errorBox, 'Error state must be displayed on API failure');
    assert.match(errorBox.textContent, /Database connection failed/);
  });

  it('9. Search and Status Filtering: filters packages by query and status', async () => {
    const env = makeEnv(defaultRoutes());
    await env.dashboard.init();

    // Trigger status filter change to APPROVED
    const statusSelect = env.document.getElementById('pkg-status-filter');
    statusSelect.value = 'APPROVED';
    statusSelect.dispatchEvent('change');

    await new Promise(r => setTimeout(r, 50));

    const lastCall = env.calls[env.calls.length - 1];
    assert.equal(lastCall.key, 'GET /api/provider/packages');
    assert.equal(lastCall.query.status, 'APPROVED');

    // Trigger keyword search
    const searchInput = env.document.getElementById('pkg-search-input');
    searchInput.value = 'Kashmir';
    const filterForm = env.document.getElementById('provider-filter-form');
    filterForm.dispatchEvent('submit');

    await new Promise(r => setTimeout(r, 50));

    const searchCall = env.calls[env.calls.length - 1];
    assert.equal(searchCall.query.q, 'Kashmir');
    assert.equal(searchCall.query.status, 'APPROVED');
  });

  it('10. Stat card click: clicking on Pending Review stat card sets filter to PENDING', async () => {
    const env = makeEnv(defaultRoutes());
    await env.dashboard.init();

    const pendingCard = env.document.getElementById('card-stat-pending');
    pendingCard.dispatchEvent('click');

    await new Promise(r => setTimeout(r, 50));

    assert.equal(env.dashboard.state.filters.status, 'PENDING');
    assert.equal(env.document.getElementById('pkg-status-filter').value, 'PENDING');
    const lastCall = env.calls[env.calls.length - 1];
    assert.equal(lastCall.query.status, 'PENDING');
  });

  it('11. Create Package: client validation rejects missing required fields', async () => {
    const env = makeEnv(defaultRoutes());
    await env.dashboard.init();

    env.dashboard.openCreateModal();
    assert.equal(env.document.getElementById('pkg-modal').hidden, false);

    // Empty title submit
    await assert.rejects(
      async () => env.dashboard.handleFormSubmit(),
      /Validation error: title/
    );

    const alertText = env.document.getElementById('form-error-text');
    assert.match(alertText.textContent, /Package title is required/);
  });

  it('12. Create Package: successfully constructs payload without status and submits POST /api/provider/packages', async () => {
    let postBody = null;
    const routes = defaultRoutes();
    routes['POST /api/provider/packages'] = (call) => {
      postBody = call.body;
      return [201, {
        success: true,
        data: { package_id: 105, ...call.body, status: 'PENDING' },
        message: 'Package created successfully as PENDING moderation'
      }];
    };

    const env = makeEnv(routes);
    await env.dashboard.init();

    env.dashboard.openCreateModal();

    // Populate valid create fields
    env.document.getElementById('form-title').value = 'Spiti Valley Stargazing & Camping';
    env.document.getElementById('form-destination').value = '2';
    env.document.getElementById('form-category').value = '1';
    env.document.getElementById('form-price').value = '21000';
    env.document.getElementById('form-duration').value = '6';
    env.document.getElementById('form-capacity').value = '14';
    env.document.getElementById('form-description').value = 'Stargaze under pristine high Himalayan skies';
    env.document.getElementById('form-inclusions').value = 'Camps\nMeals\nOxygen Cylinder';
    env.document.getElementById('form-exclusions').value = 'Flights\nTips';

    // Add Itinerary day
    env.dashboard.addItineraryDay({ day_no: 2, title: 'Drive to Kaza via Rohtang', description: 'Scenic high altitude drive' });

    // Add initial departure date
    env.dashboard.addAvailabilityDate({ available_date: '2026-11-20', seats_available: 14 });

    await env.dashboard.handleFormSubmit();

    assert.ok(postBody, 'POST body must have been submitted');
    assert.equal(postBody.title, 'Spiti Valley Stargazing & Camping');
    assert.equal(postBody.destination_id, 2);
    assert.equal(postBody.category_id, 1);
    assert.equal(postBody.price, 21000);
    assert.equal(postBody.duration_days, 6);
    assert.equal(postBody.capacity, 14);
    assert.deepEqual(postBody.inclusions, ['Camps', 'Meals', 'Oxygen Cylinder']);
    assert.deepEqual(postBody.exclusions, ['Flights', 'Tips']);

    // Critical requirement: status MUST NOT be submitted by provider
    assert.equal(postBody.status, undefined, 'Provider must not submit status');

    // Itinerary items
    assert.equal(postBody.itinerary.length, 2);
    assert.equal(postBody.itinerary[0].day_no, 1);
    assert.equal(postBody.itinerary[1].day_no, 2);
    assert.equal(postBody.itinerary[1].title, 'Drive to Kaza via Rohtang');

    // Availability items
    assert.equal(postBody.availability.length, 1);
    assert.equal(postBody.availability[0].available_date, '2026-11-20');
    assert.equal(postBody.availability[0].seats_available, 14);

    // Modal closed and toast displayed
    assert.equal(env.document.getElementById('pkg-modal').hidden, true);
    assert.ok(env.toasts.some(t => t.type === 'success' && t.message.includes('PENDING')));
  });

  it('13. Edit Package: loads package data and submits PUT /api/provider/packages/:id preserving departures', async () => {
    let putBody = null;
    const routes = defaultRoutes();
    routes['PUT /api/provider/packages/101'] = (call) => {
      putBody = call.body;
      return [200, { success: true, data: { package_id: 101, ...call.body }, message: 'Package updated successfully' }];
    };

    const env = makeEnv(routes);
    await env.dashboard.init();

    await env.dashboard.editPackage(101);

    // Modal opened in edit mode
    assert.equal(env.document.getElementById('pkg-modal').hidden, false);
    assert.match(env.document.getElementById('modal-pkg-heading').textContent, /Edit Package #101/);
    assert.equal(env.document.getElementById('form-title').value, 'Kashmir Great Lakes Trek');
    assert.equal(env.document.getElementById('form-price').value, '18500');

    // Availability section is hidden for editing
    assert.equal(env.document.getElementById('section-availability').hidden, true);

    // Modify price
    env.document.getElementById('form-price').value = '19500';

    await env.dashboard.handleFormSubmit();

    assert.ok(putBody, 'PUT body must have been submitted');
    assert.equal(putBody.price, 19500);
    assert.equal(putBody.status, undefined, 'Status must not be submitted in edit');
    assert.equal(putBody.provider_id, undefined, 'Provider ID must not be submitted in edit');
    assert.equal(putBody.availability, undefined, 'Availability must not be touched via package PUT');

    assert.ok(env.toasts.some(t => t.type === 'success' && t.message.includes('updated')));
  });

  it('14. Status toggle: allows toggling APPROVED to DISABLED', async () => {
    let patchBody = null;
    const routes = defaultRoutes();
    routes['PATCH /api/provider/packages/101/status'] = (call) => {
      patchBody = call.body;
      return [200, { success: true, data: { package_id: 101, status: 'DISABLED' } }];
    };

    const env = makeEnv(routes);
    await env.dashboard.init();

    await env.dashboard.togglePackageStatus(101, 'DISABLED');

    assert.ok(patchBody, 'PATCH request should be sent');
    assert.equal(patchBody.status, 'DISABLED');
    assert.ok(env.toasts.some(t => t.type === 'success' && t.message.includes('DISABLED')));
  });

  it('15. Status toggle: allows toggling DISABLED to APPROVED', async () => {
    let patchBody = null;
    const routes = defaultRoutes();
    routes['PATCH /api/provider/packages/103/status'] = (call) => {
      patchBody = call.body;
      return [200, { success: true, data: { package_id: 103, status: 'APPROVED' } }];
    };

    const env = makeEnv(routes);
    await env.dashboard.init();

    await env.dashboard.togglePackageStatus(103, 'APPROVED');

    assert.ok(patchBody, 'PATCH request should be sent');
    assert.equal(patchBody.status, 'APPROVED');
    assert.ok(env.toasts.some(t => t.type === 'success' && t.message.includes('APPROVED')));
  });

  it('16. Status toggle: rejects invalid status transitions client-side', async () => {
    const env = makeEnv(defaultRoutes());
    await env.dashboard.init();

    await assert.rejects(
      async () => env.dashboard.togglePackageStatus(102, 'PENDING'),
      /Invalid status transition/
    );

    assert.ok(env.toasts.some(t => t.type === 'error'));
  });

  it('17. Status moderation badges: PENDING and REJECTED packages show disabled buttons with explanation', async () => {
    const env = makeEnv(defaultRoutes());
    await env.dashboard.init();

    const pendingRow = env.document.getElementById('pkg-row-102');
    const btnPending = pendingRow.querySelector('#btn-status-toggle-102');
    assert.equal(btnPending.disabled, true);
    assert.equal(btnPending.textContent, 'In Review');
    assert.match(btnPending.title, /moderation/);

    const rejectedRow = env.document.getElementById('pkg-row-104');
    const btnRejected = rejectedRow.querySelector('#btn-status-toggle-104');
    assert.equal(btnRejected.disabled, true);
    assert.equal(btnRejected.textContent, 'Rejected');
    assert.match(btnRejected.title, /administrator/);
  });

  it('18. View Package: opens view modal and renders details, itinerary and departures', async () => {
    const env = makeEnv(defaultRoutes());
    await env.dashboard.init();

    await env.dashboard.viewPackage(101);

    const viewModal = env.document.getElementById('view-modal');
    assert.equal(viewModal.hidden, false);
    const body = env.document.getElementById('view-modal-body');
    assert.match(body.textContent, /Kashmir Great Lakes Trek/);
    assert.match(body.textContent, /Day 1: Arrival in Sonamarg/);
    assert.match(body.textContent, /Day 2: Trek to Nichnai/);
    assert.match(body.textContent, /2026-11-15/);
  });

});
