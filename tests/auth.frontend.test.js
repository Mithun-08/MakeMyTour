/**
 * tests/auth.frontend.test.js — Owner: M2
 * Focused tests for public/js/auth.js, public/js/api.js, and authentication page controllers
 * (public/js/pages/login.js and public/js/pages/register.js) in a sandbox environment.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const API_SRC      = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'api.js'), 'utf8');
const AUTH_SRC     = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'auth.js'), 'utf8');
const UI_SRC       = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'ui.js'), 'utf8');
const LOGIN_SRC    = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'pages', 'login.js'), 'utf8');
const REGISTER_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'pages', 'register.js'), 'utf8');

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
    this._value = '';
    this._className = '';
    this.classList = new MockClassList(this);
    this._id = '';
    this._doc = doc;
    this.parentNode = null;
    this.dataset = {};
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

  get value() { return this._value; }
  set value(val) { this._value = String(val); }

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
    if (child._id && this._doc) {
      this._doc.elements.set(child._id, child);
    }
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentNode = null;
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
        let match = true;
        if (sel.startsWith('.')) {
          match = c.classList.contains(sel.slice(1));
        } else {
          const tagMatch = sel.match(/^([a-zA-Z0-9]+)/);
          if (tagMatch && c.tagName !== tagMatch[1].toUpperCase()) {
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
            } else if (!c.getAttribute(attrName) && !(attrName in c.attributes)) {
              match = false;
              break;
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
    this.readyState = 'complete';
    this.listeners = {};
    this.body = new MockElement('body', this);
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

/** routes: { 'GET /api/auth/me': [status, json] | Error } — values may be arrays (consumed in order) */
function makeEnv(routes, pathname = '/index.html', search = '') {
  const calls = [];
  const events = [];
  const toasts = [];
  const location = {
    pathname,
    search,
    get href() {
      return 'http://localhost' + this.pathname + (this.search || '');
    },
    set href(val) {
      if (val.startsWith('http://localhost')) {
        val = val.replace('http://localhost', '');
      }
      const [p, s] = val.split('?');
      this.pathname = p;
      this.search = s ? '?' + s : '';
    }
  };

  function fetch(url, opts) {
    const key = (opts.method || 'GET') + ' ' + url.split('?')[0];
    calls.push({ key, url, body: opts.body ? JSON.parse(opts.body) : null });
    let r = routes[key];
    if (Array.isArray(r) && (Array.isArray(r[0]) || r[0] instanceof Error)) r = r.length > 1 ? r.shift() : r[0];
    if (r === undefined) r = [404, { success: false, error: { code: 'NOT_FOUND', message: 'nf' } }];
    if (r instanceof Error) return Promise.reject(r);
    const [status, json] = r;
    return Promise.resolve({ status, json: () => Promise.resolve(json) });
  }

  const document = new MockDocument();

  const window = {
    location,
    document,
    dispatchEvent: (e) => events.push(e),
    UI: {
      toast: (m, t) => toasts.push([m, t]),
      setLoading: (el, bool) => {
        if (!el) return;
        if (bool) {
          el.setAttribute('aria-busy', 'true');
          el.disabled = true;
        } else {
          el.removeAttribute('aria-busy');
          el.disabled = false;
        }
      },
      clearErrors: (f) => {
        if (!f) return;
        f.querySelectorAll('.field-error').forEach(e => { e.textContent = ''; e.style.display = 'none'; });
        f.querySelectorAll('.is-error').forEach(e => e.classList.remove('is-error'));
      },
      showErrors: (f, details) => {
        if (!f || !details) return;
        Object.keys(details).forEach(k => {
          const inp = f.querySelector(`[name="${k}"]`);
          if (inp) {
            inp.classList.add('is-error');
            const errEl = inp.parentNode ? inp.parentNode.querySelector('.field-error') : null;
            if (errEl) {
              errEl.textContent = details[k];
              errEl.style.display = 'block';
            }
          }
        });
      }
    }
  };

  const sandbox = {
    window,
    document,
    fetch,
    Promise,
    encodeURIComponent,
    decodeURIComponent,
    URLSearchParams,
    TypeError,
    Error,
    Object,
    Array,
    String,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } }
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);

  vm.runInContext(API_SRC, sandbox);
  sandbox.api = window.api;
  sandbox.ApiError = window.ApiError;
  vm.runInContext(AUTH_SRC, sandbox);

  return { Auth: window.Auth, api: window.api, window, document, location, calls, events, toasts, sandbox };
}

function setupLoginDom(doc) {
  const form = doc.createElement('form');
  form.id = 'login-form';

  const alertBox = doc.createElement('div');
  alertBox.id = 'login-alert';
  alertBox.style.display = 'none';
  const alertMsg = doc.createElement('div');
  alertMsg.id = 'login-alert-msg';
  alertBox.appendChild(alertMsg);

  const infoBox = doc.createElement('div');
  infoBox.id = 'login-info';
  infoBox.style.display = 'none';
  const infoMsg = doc.createElement('div');
  infoMsg.id = 'login-info-msg';
  infoBox.appendChild(infoMsg);

  const emailField = doc.createElement('div');
  emailField.className = 'field';
  const emailInput = doc.createElement('input');
  emailInput.id = 'login-email';
  emailInput.setAttribute('name', 'email');
  const emailError = doc.createElement('span');
  emailError.className = 'field-error';
  emailField.appendChild(emailInput);
  emailField.appendChild(emailError);

  const passField = doc.createElement('div');
  passField.className = 'field';
  const passInput = doc.createElement('input');
  passInput.id = 'login-password';
  passInput.setAttribute('name', 'password');
  const passError = doc.createElement('span');
  passError.className = 'field-error';
  passField.appendChild(passInput);
  passField.appendChild(passError);

  const submitBtn = doc.createElement('button');
  submitBtn.id = 'login-submit-btn';
  submitBtn.setAttribute('type', 'submit');

  form.appendChild(alertBox);
  form.appendChild(infoBox);
  form.appendChild(emailField);
  form.appendChild(passField);
  form.appendChild(submitBtn);

  doc.body.appendChild(form);

  return { form, emailInput, passInput, submitBtn, alertBox, alertMsg, infoBox, infoMsg };
}

function setupRegisterDom(doc) {
  const form = doc.createElement('form');
  form.id = 'register-form';

  const alertBox = doc.createElement('div');
  alertBox.id = 'register-alert';
  alertBox.style.display = 'none';
  const alertMsg = doc.createElement('div');
  alertMsg.id = 'register-alert-msg';
  alertBox.appendChild(alertMsg);

  const roleField = doc.createElement('div');
  roleField.className = 'field';
  const roleSelect = doc.createElement('select');
  roleSelect.id = 'register-role';
  roleSelect.setAttribute('name', 'role');
  roleSelect.value = 'CUSTOMER';
  const roleError = doc.createElement('span');
  roleError.className = 'field-error';
  roleField.appendChild(roleSelect);
  roleField.appendChild(roleError);

  const nameField = doc.createElement('div');
  nameField.className = 'field';
  const nameInput = doc.createElement('input');
  nameInput.id = 'register-name';
  nameInput.setAttribute('name', 'name');
  const nameError = doc.createElement('span');
  nameError.className = 'field-error';
  nameField.appendChild(nameInput);
  nameField.appendChild(nameError);

  const emailField = doc.createElement('div');
  emailField.className = 'field';
  const emailInput = doc.createElement('input');
  emailInput.id = 'register-email';
  emailInput.setAttribute('name', 'email');
  const emailError = doc.createElement('span');
  emailError.className = 'field-error';
  emailField.appendChild(emailInput);
  emailField.appendChild(emailError);

  const mobileField = doc.createElement('div');
  mobileField.className = 'field';
  const mobileInput = doc.createElement('input');
  mobileInput.id = 'register-mobile';
  mobileInput.setAttribute('name', 'mobile');
  const mobileError = doc.createElement('span');
  mobileError.className = 'field-error';
  mobileField.appendChild(mobileInput);
  mobileField.appendChild(mobileError);

  const passField = doc.createElement('div');
  passField.className = 'field';
  const passInput = doc.createElement('input');
  passInput.id = 'register-password';
  passInput.setAttribute('name', 'password');
  const passError = doc.createElement('span');
  passError.className = 'field-error';
  passField.appendChild(passInput);
  passField.appendChild(passError);

  const confirmPassField = doc.createElement('div');
  confirmPassField.className = 'field';
  const confirmPassInput = doc.createElement('input');
  confirmPassInput.id = 'register-confirm-password';
  confirmPassInput.setAttribute('name', 'confirm_password');
  const confirmPassError = doc.createElement('span');
  confirmPassError.className = 'field-error';
  confirmPassField.appendChild(confirmPassInput);
  confirmPassField.appendChild(confirmPassError);

  const cityInput = doc.createElement('input');
  cityInput.id = 'register-city';
  cityInput.setAttribute('name', 'city');

  const stateInput = doc.createElement('input');
  stateInput.id = 'register-state';
  stateInput.setAttribute('name', 'state');

  const submitBtn = doc.createElement('button');
  submitBtn.id = 'register-submit-btn';
  submitBtn.setAttribute('type', 'submit');

  form.appendChild(alertBox);
  form.appendChild(roleField);
  form.appendChild(nameField);
  form.appendChild(emailField);
  form.appendChild(mobileField);
  form.appendChild(passField);
  form.appendChild(confirmPassField);
  form.appendChild(cityInput);
  form.appendChild(stateInput);
  form.appendChild(submitBtn);

  doc.body.appendChild(form);

  return { form, roleSelect, nameInput, emailInput, mobileInput, passInput, confirmPassInput, cityInput, stateInput, submitBtn, alertBox, alertMsg };
}

const ok = (data) => [200, { success: true, data }];
const err = (status, code, message) => [status, { success: false, error: { code, message: message || code } }];
const CUSTOMER = { user_id: 7, name: 'Customer User', email: 'c@x.com', role: 'CUSTOMER', status: 'ACTIVE', permissions: [] };
const PROVIDER = { user_id: 8, name: 'Provider User', email: 'p@x.com', role: 'PROVIDER', status: 'ACTIVE', permissions: [] };
const ADMIN    = { user_id: 2, name: 'Admin User', email: 'a@x.com', role: 'ADMIN', status: 'ACTIVE', permissions: ['MANAGE_USERS'] };
const SUPERADMIN = { user_id: 1, name: 'Super Admin', email: 'sa@x.com', role: 'SUPER_ADMIN', status: 'ACTIVE', permissions: ['*'] };

const flush = () => new Promise((r) => setImmediate(r));

// ─────────────────────────────────────────────────────────────────────────────
// Part 1: auth.js Core Unit Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('auth.js — session state', () => {
  it('getUser resolves null on 401 and does NOT redirect a public page', async () => {
    const env = makeEnv({ 'GET /api/auth/me': err(401, 'UNAUTHENTICATED') });
    assert.equal(await env.Auth.getUser(), null);
    assert.equal(env.location.pathname, '/index.html');
    assert.equal(env.Auth.isLoaded(), true);
    assert.equal(await env.Auth.isAuthenticated(), false);
  });

  it('getUser returns data.user and caches it per page load', async () => {
    const env = makeEnv({ 'GET /api/auth/me': ok({ user: CUSTOMER }) });
    assert.equal((await env.Auth.getUser()).user_id, 7);
    await env.Auth.getUser();
    assert.equal(env.calls.filter((c) => c.key === 'GET /api/auth/me').length, 1);
    assert.equal(env.Auth.getCachedUser().email, 'c@x.com');
    assert.equal(await env.Auth.isAuthenticated(), true);
  });

  it('network failure rejects, is not cached, and a retry can succeed', async () => {
    const env = makeEnv({ 'GET /api/auth/me': [new TypeError('down'), ok({ user: CUSTOMER })] });
    await assert.rejects(env.Auth.getUser(), (e) => e.code === 'NETWORK_ERROR');
    assert.equal((await env.Auth.getUser()).user_id, 7);
  });

  it('getUser({refresh:true}) re-fetches', async () => {
    const env = makeEnv({ 'GET /api/auth/me': ok({ user: CUSTOMER }) });
    await env.Auth.getUser();
    await env.Auth.getUser({ refresh: true });
    assert.equal(env.calls.length, 2);
  });
});

describe('auth.js — login / logout / register', () => {
  it('login stores the user and fires auth:change', async () => {
    const env = makeEnv({ 'POST /api/auth/login': ok({ user: CUSTOMER }) }, '/login.html');
    const u = await env.Auth.login('  c@x.com ', 'secret123');
    assert.equal(u.role, 'CUSTOMER');
    assert.equal(env.Auth.getCachedUser().user_id, 7);
    assert.equal(env.events[0].type, 'auth:change');
  });

  it('login with bad credentials rejects with INVALID_CREDENTIALS and does not redirect', async () => {
    const env = makeEnv({ 'POST /api/auth/login': err(401, 'INVALID_CREDENTIALS') }, '/somewhere.html');
    await assert.rejects(env.Auth.login('a@b.c', 'bad'), (e) => e.status === 401 && e.code === 'INVALID_CREDENTIALS');
    assert.equal(env.location.pathname, '/somewhere.html');
    assert.equal(env.Auth.getCachedUser(), null);
  });

  it('login surfaces 403 account-status errors', async () => {
    const env = makeEnv({ 'POST /api/auth/login': err(403, 'ACCOUNT_PENDING') }, '/login.html');
    await assert.rejects(env.Auth.login('p@x.com', 'secret123'), (e) => e.code === 'ACCOUNT_PENDING');
  });

  it('logout clears state and redirects home', async () => {
    const env = makeEnv({ 'GET /api/auth/me': ok({ user: CUSTOMER }), 'POST /api/auth/logout': ok(null) });
    await env.Auth.getUser();
    await env.Auth.logout();
    assert.equal(env.Auth.getCachedUser(), null);
    assert.equal(env.location.pathname, '/index.html');
  });

  it('logout with an already-expired session (401) is treated as logged out', async () => {
    const env = makeEnv({ 'POST /api/auth/logout': err(401, 'UNAUTHENTICATED') }, '/customer-dashboard.html');
    await env.Auth.logout();
    assert.equal(env.location.pathname, '/index.html');
  });

  it('logout server error shows a toast and stays on the page', async () => {
    const env = makeEnv({ 'POST /api/auth/logout': err(500, 'INTERNAL_ERROR') }, '/x.html');
    await env.Auth.logout();
    assert.equal(env.location.pathname, '/x.html');
    assert.equal(env.toasts[0][1], 'error');
  });

  it('register calls the existing endpoint and does not log in', async () => {
    const env = makeEnv({ 'POST /api/auth/register': [201, { success: true, data: { user_id: 9, role: 'PROVIDER', status: 'PENDING' } }] });
    const res = await env.Auth.register({ name: 'P', email: 'p@x.com', password: 'secret123', mobile: '9999999999', role: 'PROVIDER' });
    assert.equal(res.data.status, 'PENDING');
    assert.equal(env.Auth.getCachedUser(), null);
  });
});

describe('auth.js — guards and checks', () => {
  it('requireRole redirects logged-out users to login with next', async () => {
    const env = makeEnv({ 'GET /api/auth/me': err(401, 'UNAUTHENTICATED') }, '/provider-dashboard.html');
    env.Auth.requireRole(['PROVIDER']);
    await flush(); await flush();
    assert.equal(env.location.pathname, '/login.html');
    assert.equal(env.location.search, '?next=%2Fprovider-dashboard.html');
  });

  it('requireRole sends a wrong role to their own dashboard', async () => {
    const env = makeEnv({ 'GET /api/auth/me': ok({ user: CUSTOMER }) }, '/provider-dashboard.html');
    env.Auth.requireRole(['PROVIDER']);
    await flush(); await flush();
    assert.equal(env.location.pathname, '/customer-dashboard.html');
  });

  it('requireRole resolves the user for an allowed role', async () => {
    const env = makeEnv({ 'GET /api/auth/me': ok({ user: CUSTOMER }) });
    assert.equal((await env.Auth.requireRole(['CUSTOMER'])).user_id, 7);
  });

  it('hasRole / hasPermission (incl. SUPER_ADMIN wildcard)', async () => {
    const env = makeEnv({});
    const admin = { role: 'ADMIN', permissions: ['MANAGE_USERS'] };
    const sa = { role: 'SUPER_ADMIN', permissions: ['*'] };
    assert.equal(env.Auth.hasRole(['ADMIN', 'SUPER_ADMIN'], admin), true);
    assert.equal(env.Auth.hasRole('CUSTOMER', admin), false);
    assert.equal(env.Auth.hasRole(['CUSTOMER']), false);
    assert.equal(env.Auth.hasPermission('MANAGE_USERS', admin), true);
    assert.equal(env.Auth.hasPermission('VIEW_LOGS', admin), false);
    assert.equal(env.Auth.hasPermission('VIEW_LOGS', sa), true);
  });

  it('hasPermission works synchronously after getUser resolves', async () => {
    const admin = { user_id: 2, role: 'ADMIN', permissions: ['VIEW_REPORTS'] };
    const env = makeEnv({ 'GET /api/auth/me': ok({ user: admin }) });
    await env.Auth.getUser();
    assert.equal(env.Auth.hasPermission('VIEW_REPORTS'), true);
  });

  it('safeNext blocks open redirects', () => {
    const { Auth } = makeEnv({});
    assert.equal(Auth.safeNext('/packages.html?q=goa'), '/packages.html?q=goa');
    assert.equal(Auth.safeNext('//evil.com'), '/index.html');
    assert.equal(Auth.safeNext('/\\evil.com'), '/index.html');
    assert.equal(Auth.safeNext('https://evil.com'), '/index.html');
    assert.equal(Auth.safeNext(null), '/index.html');
  });

  it('dashboardFor maps every role', () => {
    const { Auth } = makeEnv({});
    assert.equal(Auth.dashboardFor('CUSTOMER'), 'customer-dashboard.html');
    assert.equal(Auth.dashboardFor('PROVIDER'), 'provider-dashboard.html');
    assert.equal(Auth.dashboardFor('ADMIN'), 'admin-dashboard.html');
    assert.equal(Auth.dashboardFor('SUPER_ADMIN'), 'superadmin-dashboard.html');
    assert.equal(Auth.dashboardFor('unknown'), 'index.html');
  });
});

describe('api.js — 401 behaviour', () => {
  it('still redirects to login on 401 for normal protected calls', async () => {
    const env = makeEnv({ 'GET /api/bookings': err(401, 'UNAUTHENTICATED') }, '/my-bookings.html');
    env.api.get('/api/bookings');
    await flush(); await flush();
    assert.equal(env.location.pathname, '/login.html');
    assert.equal(env.location.search, '?next=%2Fmy-bookings.html');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Part 2: Phase 4 End-to-End Authentication Flow Tests (9 Scenarios)
// ─────────────────────────────────────────────────────────────────────────────

describe('Authentication Flow — Login and Registration Integration', () => {

  // Scenario 1: Successful customer login and redirect
  it('Scenario 1: Successful customer login redirects to customer dashboard (or ?next)', async () => {
    const env = makeEnv({
      'GET /api/auth/me': err(401, 'UNAUTHENTICATED'),
      'POST /api/auth/login': ok({ user: CUSTOMER })
    }, '/login.html');
    const dom = setupLoginDom(env.document);

    vm.runInContext(LOGIN_SRC, env.sandbox);
    await flush();

    dom.emailInput.value = 'c@x.com';
    dom.passInput.value = 'secret123';
    dom.form.dispatchEvent({ type: 'submit' });
    await flush(); await flush();

    assert.equal(env.location.pathname, '/customer-dashboard.html');
    assert.equal(env.Auth.getCachedUser().role, 'CUSTOMER');

    // Test with ?next query parameter
    const envNext = makeEnv({
      'GET /api/auth/me': err(401, 'UNAUTHENTICATED'),
      'POST /api/auth/login': ok({ user: CUSTOMER })
    }, '/login.html', '?next=%2Fbooking-detail.html%3Fid%3D5');
    const domNext = setupLoginDom(envNext.document);

    vm.runInContext(LOGIN_SRC, envNext.sandbox);
    await flush();

    domNext.emailInput.value = 'c@x.com';
    domNext.passInput.value = 'secret123';
    domNext.form.dispatchEvent({ type: 'submit' });
    await flush(); await flush();

    assert.equal(envNext.location.pathname, '/booking-detail.html');
    assert.equal(envNext.location.search, '?id=5');
  });

  // Scenario 2: Successful provider login and redirect
  it('Scenario 2: Successful provider login redirects to provider dashboard', async () => {
    const env = makeEnv({
      'GET /api/auth/me': err(401, 'UNAUTHENTICATED'),
      'POST /api/auth/login': ok({ user: PROVIDER })
    }, '/login.html');
    const dom = setupLoginDom(env.document);

    vm.runInContext(LOGIN_SRC, env.sandbox);
    await flush();

    dom.emailInput.value = 'p@x.com';
    dom.passInput.value = 'secret123';
    dom.form.dispatchEvent({ type: 'submit' });
    await flush(); await flush();

    assert.equal(env.location.pathname, '/provider-dashboard.html');
    assert.equal(env.Auth.getCachedUser().role, 'PROVIDER');
  });

  // Scenario 3: Successful admin login and redirect
  it('Scenario 3: Successful admin login redirects to admin dashboard', async () => {
    const env = makeEnv({
      'GET /api/auth/me': err(401, 'UNAUTHENTICATED'),
      'POST /api/auth/login': ok({ user: ADMIN })
    }, '/login.html');
    const dom = setupLoginDom(env.document);

    vm.runInContext(LOGIN_SRC, env.sandbox);
    await flush();

    dom.emailInput.value = 'a@x.com';
    dom.passInput.value = 'secret123';
    dom.form.dispatchEvent({ type: 'submit' });
    await flush(); await flush();

    assert.equal(env.location.pathname, '/admin-dashboard.html');
    assert.equal(env.Auth.getCachedUser().role, 'ADMIN');

    // Super Admin check
    const envSA = makeEnv({
      'GET /api/auth/me': err(401, 'UNAUTHENTICATED'),
      'POST /api/auth/login': ok({ user: SUPERADMIN })
    }, '/login.html');
    const domSA = setupLoginDom(envSA.document);

    vm.runInContext(LOGIN_SRC, envSA.sandbox);
    await flush();

    domSA.emailInput.value = 'sa@x.com';
    domSA.passInput.value = 'secret123';
    domSA.form.dispatchEvent({ type: 'submit' });
    await flush(); await flush();

    assert.equal(envSA.location.pathname, '/superadmin-dashboard.html');
    assert.equal(envSA.Auth.getCachedUser().role, 'SUPER_ADMIN');
  });

  // Scenario 4: Invalid credentials
  it('Scenario 4: Invalid credentials shows error alert, stays on login page and re-enables button', async () => {
    const env = makeEnv({
      'GET /api/auth/me': err(401, 'UNAUTHENTICATED'),
      'POST /api/auth/login': err(401, 'INVALID_CREDENTIALS', 'Invalid email or password')
    }, '/login.html');
    const dom = setupLoginDom(env.document);

    vm.runInContext(LOGIN_SRC, env.sandbox);
    await flush();

    dom.emailInput.value = 'c@x.com';
    dom.passInput.value = 'wrongpassword';
    dom.form.dispatchEvent({ type: 'submit' });
    await flush(); await flush();

    assert.equal(env.location.pathname, '/login.html');
    assert.equal(dom.alertBox.style.display, 'flex');
    assert.ok(dom.alertMsg.textContent.includes('Invalid email or password'));
    assert.equal(dom.submitBtn.disabled, false);
    assert.equal(dom.submitBtn.getAttribute('aria-busy'), null);
  });

  // Scenario 5: Successful registration
  it('Scenario 5: Successful registration handles customer auto-login and provider pending status', async () => {
    // 5A: Customer registration -> auto-logins and navigates to customer dashboard
    const envCust = makeEnv({
      'GET /api/auth/me': err(401, 'UNAUTHENTICATED'),
      'POST /api/auth/register': [201, { success: true, data: { user_id: 15, role: 'CUSTOMER', status: 'ACTIVE' } }],
      'POST /api/auth/login': ok({ user: { user_id: 15, name: 'Rahul', email: 'rahul@example.com', role: 'CUSTOMER', status: 'ACTIVE' } })
    }, '/register.html');
    const domCust = setupRegisterDom(envCust.document);

    vm.runInContext(REGISTER_SRC, envCust.sandbox);
    await flush();

    domCust.roleSelect.value = 'CUSTOMER';
    domCust.nameInput.value = 'Rahul';
    domCust.emailInput.value = 'rahul@example.com';
    domCust.mobileInput.value = '9876543210';
    domCust.passInput.value = 'password123';
    domCust.confirmPassInput.value = 'password123';

    domCust.form.dispatchEvent({ type: 'submit' });
    await flush(); await flush(); await flush();

    assert.equal(envCust.location.pathname, '/customer-dashboard.html');

    // 5B: Provider registration -> navigates to login with ?pending=1
    const envProv = makeEnv({
      'GET /api/auth/me': err(401, 'UNAUTHENTICATED'),
      'POST /api/auth/register': [201, { success: true, data: { user_id: 16, role: 'PROVIDER', status: 'PENDING' } }]
    }, '/register.html');
    const domProv = setupRegisterDom(envProv.document);

    vm.runInContext(REGISTER_SRC, envProv.sandbox);
    await flush();

    domProv.roleSelect.value = 'PROVIDER';
    domProv.nameInput.value = 'Goa Adventures';
    domProv.emailInput.value = 'goa@example.com';
    domProv.mobileInput.value = '9876543211';
    domProv.passInput.value = 'password123';
    domProv.confirmPassInput.value = 'password123';
    domProv.cityInput.value = 'Panaji';
    domProv.stateInput.value = 'Goa';

    domProv.form.dispatchEvent({ type: 'submit' });
    await flush(); await flush();

    assert.equal(envProv.location.pathname, '/login.html');
    assert.equal(envProv.location.search, '?pending=1');
  });

  // Scenario 6: Registration validation errors
  it('Scenario 6: Registration client validation blocks submit, server conflict shows error', async () => {
    // 6A: Client validation (password mismatch)
    const envClient = makeEnv({ 'GET /api/auth/me': err(401, 'UNAUTHENTICATED') }, '/register.html');
    const domClient = setupRegisterDom(envClient.document);

    vm.runInContext(REGISTER_SRC, envClient.sandbox);
    await flush();

    domClient.nameInput.value = 'Test';
    domClient.emailInput.value = 'test@example.com';
    domClient.mobileInput.value = '9876543210';
    domClient.passInput.value = 'password123';
    domClient.confirmPassInput.value = 'mismatch123';

    domClient.form.dispatchEvent({ type: 'submit' });
    await flush();

    assert.equal(envClient.calls.length, 1); // Only initial /me call, no register call
    assert.equal(envClient.location.pathname, '/register.html');

    // 6B: Server-side duplicate email conflict
    const envConflict = makeEnv({
      'GET /api/auth/me': err(401, 'UNAUTHENTICATED'),
      'POST /api/auth/register': err(409, 'CONFLICT', 'An account with this email already exists')
    }, '/register.html');
    const domConflict = setupRegisterDom(envConflict.document);

    vm.runInContext(REGISTER_SRC, envConflict.sandbox);
    await flush();

    domConflict.nameInput.value = 'Test';
    domConflict.emailInput.value = 'existing@example.com';
    domConflict.mobileInput.value = '9876543210';
    domConflict.passInput.value = 'password123';
    domConflict.confirmPassInput.value = 'password123';

    domConflict.form.dispatchEvent({ type: 'submit' });
    await flush(); await flush();

    assert.equal(envConflict.location.pathname, '/register.html');
    assert.equal(domConflict.alertBox.style.display, 'flex');
    assert.ok(domConflict.alertMsg.textContent.includes('already exists'));
    assert.equal(domConflict.submitBtn.disabled, false);
  });

  // Scenario 7: Authentication persistence after redirect
  it('Scenario 7: Authentication persistence after redirect verifies user session', async () => {
    const env = makeEnv({
      'GET /api/auth/me': ok({ user: CUSTOMER })
    }, '/customer-dashboard.html');

    const user = await env.Auth.getUser();
    assert.ok(user !== null);
    assert.equal(user.user_id, 7);
    assert.equal(user.email, 'c@x.com');
    assert.equal(await env.Auth.isAuthenticated(), true);
    assert.equal(env.Auth.getCachedUser().name, 'Customer User');
  });

  // Scenario 8: Unauthenticated access to protected pages
  it('Scenario 8: Unauthenticated access to protected page redirects to login with ?next', async () => {
    const envCust = makeEnv({ 'GET /api/auth/me': err(401, 'UNAUTHENTICATED') }, '/customer-dashboard.html');
    envCust.Auth.requireRole(['CUSTOMER']);
    await flush(); await flush();
    assert.equal(envCust.location.pathname, '/login.html');
    assert.equal(envCust.location.search, '?next=%2Fcustomer-dashboard.html');

    const envProv = makeEnv({ 'GET /api/auth/me': err(401, 'UNAUTHENTICATED') }, '/provider-dashboard.html');
    envProv.Auth.requireRole(['PROVIDER']);
    await flush(); await flush();
    assert.equal(envProv.location.pathname, '/login.html');
    assert.equal(envProv.location.search, '?next=%2Fprovider-dashboard.html');
  });

  // Scenario 9: Correct handling of failed API requests
  it('Scenario 9: Failed API requests handle account status and network errors gracefully', async () => {
    // 9A: Account pending approval (403)
    const envPending = makeEnv({
      'GET /api/auth/me': err(401, 'UNAUTHENTICATED'),
      'POST /api/auth/login': err(403, 'ACCOUNT_PENDING', 'Your account is pending approval.')
    }, '/login.html');
    const domPending = setupLoginDom(envPending.document);

    vm.runInContext(LOGIN_SRC, envPending.sandbox);
    await flush();

    domPending.emailInput.value = 'pending@example.com';
    domPending.passInput.value = 'secret123';
    domPending.form.dispatchEvent({ type: 'submit' });
    await flush(); await flush();

    assert.equal(envPending.location.pathname, '/login.html');
    assert.ok(domPending.alertMsg.textContent.includes('pending approval'));
    assert.equal(domPending.submitBtn.disabled, false);

    // 9B: Network failure on login
    const envNet = makeEnv({
      'GET /api/auth/me': err(401, 'UNAUTHENTICATED'),
      'POST /api/auth/login': new TypeError('Failed to fetch')
    }, '/login.html');
    const domNet = setupLoginDom(envNet.document);

    vm.runInContext(LOGIN_SRC, envNet.sandbox);
    await flush();

    domNet.emailInput.value = 'c@x.com';
    domNet.passInput.value = 'secret123';
    domNet.form.dispatchEvent({ type: 'submit' });
    await flush(); await flush();

    assert.equal(envNet.location.pathname, '/login.html');
    assert.ok(domNet.alertMsg.textContent.includes('Could not reach server'));
    assert.equal(domNet.submitBtn.disabled, false);
  });

});
