/**
 * tests/auth.frontend.test.js — Owner: M2
 * Focused tests for public/js/auth.js (+ api.js 401 handling) in a sandbox.
 * Runs the real browser scripts in node:vm with a stubbed fetch/window.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const API_SRC  = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'api.js'), 'utf8');
const AUTH_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'auth.js'), 'utf8');

/** routes: { 'GET /api/auth/me': [status, json] | Error } — values may be arrays (consumed in order) */
function makeEnv(routes, pathname = '/index.html') {
  const calls = [];
  const events = [];
  const toasts = [];
  const location = { pathname, search: '', href: 'http://localhost' + pathname };

  function fetch(url, opts) {
    const key = opts.method + ' ' + url.split('?')[0];
    calls.push(key);
    let r = routes[key];
    if (Array.isArray(r) && (Array.isArray(r[0]) || r[0] instanceof Error)) r = r.length > 1 ? r.shift() : r[0];
    if (r === undefined) r = [404, { success: false, error: { code: 'NOT_FOUND', message: 'nf' } }];
    if (r instanceof Error) return Promise.reject(r);
    const [status, json] = r;
    return Promise.resolve({ status, json: () => Promise.resolve(json) });
  }

  const window = {
    location,
    dispatchEvent: (e) => events.push(e),
    UI: { toast: (m, t) => toasts.push([m, t]) }
  };
  const sandbox = {
    window, fetch, Promise, encodeURIComponent, TypeError, Error, Object, Array, String,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } }
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  // Scripts reference bare `api`, `ApiError` after attaching to window: mirror globals.
  vm.runInContext(API_SRC, sandbox);
  sandbox.api = window.api;
  sandbox.ApiError = window.ApiError;
  vm.runInContext(AUTH_SRC, sandbox);
  return { Auth: window.Auth, api: window.api, location, calls, events, toasts };
}

const ok = (data) => [200, { success: true, data }];
const err = (status, code) => [status, { success: false, error: { code, message: code } }];
const CUSTOMER = { user_id: 7, name: 'C', email: 'c@x.com', role: 'CUSTOMER', status: 'ACTIVE', permissions: [] };
const flush = () => new Promise((r) => setImmediate(r));

describe('auth.js — session state', () => {
  it('getUser resolves null on 401 and does NOT redirect a public page', async () => {
    const env = makeEnv({ 'GET /api/auth/me': err(401, 'UNAUTHENTICATED') });
    assert.equal(await env.Auth.getUser(), null);
    assert.equal(env.location.href, 'http://localhost/index.html');
    assert.equal(env.Auth.isLoaded(), true);
    assert.equal(await env.Auth.isAuthenticated(), false);
  });

  it('getUser returns data.user and caches it per page load', async () => {
    const env = makeEnv({ 'GET /api/auth/me': ok({ user: CUSTOMER }) });
    assert.equal((await env.Auth.getUser()).user_id, 7);
    await env.Auth.getUser();
    assert.equal(env.calls.filter((c) => c === 'GET /api/auth/me').length, 1);
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
    assert.equal(env.location.href, 'http://localhost/somewhere.html');
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
    assert.equal(env.location.href, '/index.html');
  });

  it('logout with an already-expired session (401) is treated as logged out', async () => {
    const env = makeEnv({ 'POST /api/auth/logout': err(401, 'UNAUTHENTICATED') }, '/customer-dashboard.html');
    await env.Auth.logout();
    assert.equal(env.location.href, '/index.html');
  });

  it('logout server error shows a toast and stays on the page', async () => {
    const env = makeEnv({ 'POST /api/auth/logout': err(500, 'INTERNAL_ERROR') }, '/x.html');
    await env.Auth.logout();
    assert.equal(env.location.href, 'http://localhost/x.html');
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
    assert.equal(env.location.href, '/login.html?next=%2Fprovider-dashboard.html');
  });

  it('requireRole sends a wrong role to their own dashboard', async () => {
    const env = makeEnv({ 'GET /api/auth/me': ok({ user: CUSTOMER }) }, '/provider-dashboard.html');
    env.Auth.requireRole(['PROVIDER']);
    await flush(); await flush();
    assert.equal(env.location.href, '/customer-dashboard.html');
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
    assert.equal(env.Auth.hasRole(['CUSTOMER']), false); // nothing cached
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
    assert.equal(Auth.dashboardFor('SUPER_ADMIN'), 'superadmin-dashboard.html');
    assert.equal(Auth.dashboardFor('nope'), 'index.html');
  });
});

describe('api.js — 401 behaviour', () => {
  it('still redirects to login on 401 for normal protected calls', async () => {
    const env = makeEnv({ 'GET /api/bookings': err(401, 'UNAUTHENTICATED') }, '/my-bookings.html');
    env.api.get('/api/bookings');
    await flush(); await flush();
    assert.equal(env.location.href, '/login.html?next=%2Fmy-bookings.html');
  });
});
