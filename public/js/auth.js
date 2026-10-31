/**
 * auth.js — Frontend authentication helpers
 * Owner: M2 (Meharnaz)
 * Contract: docs/CONTRACT.md §1.5 (sessions) and §1.8 (frontend foundation)
 *
 * Depends on: api.js (must be loaded first). ui.js is optional (toasts).
 *
 * Backend integration (server/routes/auth.routes.js):
 *   POST /api/auth/login     { email, password }  → data.user   (sets HttpOnly cookie mmt_sid)
 *   POST /api/auth/logout                           → clears session + cookie
 *   GET  /api/auth/me                               → data.user or 401 UNAUTHENTICATED
 *   POST /api/auth/register  { name, email, password, mobile, role, city?, state? }
 *                                                   → data { user_id, role, status }
 *
 * The session token lives in an HttpOnly cookie, so JavaScript never sees or
 * stores it. This file only caches the *user object* for the current page load.
 * User shape: { user_id, name, email, mobile, role, status, permissions[] }
 * Roles: CUSTOMER | PROVIDER | ADMIN | SUPER_ADMIN.  SUPER_ADMIN permissions = ['*'].
 *
 * Global `Auth` object:
 *   Auth.getUser([{ refresh }]) → Promise<user|null>  (cached per page load)
 *   Auth.getCachedUser()        → user|null           (sync; null until getUser resolves)
 *   Auth.isAuthenticated()      → Promise<boolean>
 *   Auth.login(email, password) → Promise<user>       rejects ApiError (e.g. 401 INVALID_CREDENTIALS)
 *   Auth.register(payload)      → Promise<{data,message}>  does NOT log the user in
 *   Auth.logout([{ redirect }]) → Promise<void>
 *   Auth.requireRole(roles)     → Promise<user>       redirects if logged out or wrong role
 *   Auth.hasRole(roles[, user]) → boolean
 *   Auth.hasPermission(name[, user]) → boolean        UI hint only — server enforces
 *   Auth.dashboardFor(role)     → string  (HTML filename)
 *   Auth.redirectToLogin()      → void    (keeps ?next=current page)
 *   Auth.safeNext(url)          → string  (only same-site paths)
 *   Auth.clear()                → void    (forget cached user)
 *
 * Fires `auth:change` on window (detail = user|null) after login/logout.
 */

(function () {
  'use strict';

  /* ── State (per page load) ─────────────────────────────────── */
  var _userPromise = null;   // in-flight or settled GET /api/auth/me
  var _user        = null;   // last known user (sync access)
  var _loaded      = false;  // true once we know logged-in-or-not

  // Auth calls handle 401 themselves instead of api.js redirecting.
  var NO_REDIRECT = { skipAuthRedirect: true };

  function setUser(user) {
    _user = user || null;
    _loaded = true;
    _userPromise = Promise.resolve(_user);
  }

  function emitChange() {
    try {
      window.dispatchEvent(new CustomEvent('auth:change', { detail: _user }));
    } catch (e) { /* very old browsers: ignore */ }
  }

  function toast(msg, type) {
    if (window.UI && typeof window.UI.toast === 'function') window.UI.toast(msg, type);
  }

  function extractUser(res) {
    return res && res.data && res.data.user ? res.data.user : null;
  }

  /* ── getUser / getCachedUser / isAuthenticated ─────────────── */

  /**
   * Current user from the server, cached for this page load.
   * Resolves null when not logged in or the session expired (401).
   * Rejects with ApiError for other failures (e.g. server down) and does NOT
   * cache the failure, so a later call can retry.
   */
  function getUser(opts) {
    if (opts && opts.refresh) _userPromise = null;
    if (_userPromise) return _userPromise;

    _userPromise = api.get('/api/auth/me', null, NO_REDIRECT).then(function (res) {
      setUser(extractUser(res));
      return _user;
    }).catch(function (err) {
      if (err && err.status === 401) {   // UNAUTHENTICATED: no/expired session
        setUser(null);
        return null;
      }
      _userPromise = null;               // allow retry
      throw err;
    });

    return _userPromise;
  }

  function getCachedUser() {
    return _user;
  }

  function isAuthenticated() {
    return getUser().then(function (u) { return !!u; }, function () { return false; });
  }

  /* ── login / register / logout ─────────────────────────────── */

  /**
   * Log in with email + password. On success the server sets the session
   * cookie and returns the user. Rejects with the ApiError from the server
   * (401 INVALID_CREDENTIALS, 403 account-status codes, 400 VALIDATION_ERROR)
   * so the login form can show the message.
   */
  function login(email, password) {
    return api.post('/api/auth/login', {
      email: typeof email === 'string' ? email.trim() : email,
      password: password
    }, NO_REDIRECT).then(function (res) {
      var user = extractUser(res);
      if (!user) {
        throw new window.ApiError(0, 'UNEXPECTED_RESPONSE', 'Login response did not include a user.');
      }
      setUser(user);
      emitChange();
      return user;
    });
  }

  /**
   * Thin wrapper over the existing POST /api/auth/register.
   * Registration does not create a session (providers start PENDING),
   * so the cached user is left untouched.
   */
  function register(payload) {
    return api.post('/api/auth/register', payload || {}, NO_REDIRECT);
  }

  /**
   * Log out. A 401 means the session had already expired, which is treated as
   * success. Other failures show a toast and keep the user on the page.
   * @param {{ redirect?: string|false }} [opts]  default '/index.html'; false = stay
   */
  function logout(opts) {
    var target = opts && opts.redirect !== undefined ? opts.redirect : '/index.html';

    function done() {
      setUser(null);
      emitChange();
      if (target) window.location.href = safeNext(target);
    }

    return api.post('/api/auth/logout', null, NO_REDIRECT).then(done, function (err) {
      if (err && err.status === 401) { done(); return; }
      toast('Logout failed: ' + ((err && err.message) || 'Unknown error'), 'error');
    });
  }

  /* ── Guards & role checks ──────────────────────────────────── */

  function redirectToLogin() {
    var next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = '/login.html?next=' + next;
  }

  /**
   * Resolve with the user if logged in with an allowed role.
   *   Logged out / expired → /login.html?next=<this page>
   *   Wrong role           → the user's own dashboard
   * Rejects (no redirect) if the server could not be reached, so the page
   * can show an error state instead of looping.
   */
  function requireRole(roles) {
    return getUser().then(function (user) {
      if (!user) {
        redirectToLogin();
        return new Promise(function () {});
      }
      if (!hasRole(roles, user)) {
        window.location.href = '/' + dashboardFor(user.role);
        return new Promise(function () {});
      }
      return user;
    });
  }

  /**
   * @param {string|string[]} roles  empty/undefined = any logged-in user
   * @param {object} [user]          defaults to the cached user
   */
  function hasRole(roles, user) {
    var u = user || _user;
    if (!u || !u.role) return false;
    if (!roles || (Array.isArray(roles) && roles.length === 0)) return true;
    var list = Array.isArray(roles) ? roles : [roles];
    return list.indexOf(u.role) !== -1;
  }

  /**
   * Admin permission check for hiding UI. SUPER_ADMIN has ['*'].
   * Uses the cached user, so call after getUser() has resolved.
   */
  function hasPermission(name, user) {
    var u = user || _user;
    if (!u || !Array.isArray(u.permissions)) return false;
    if (u.permissions.indexOf('*') !== -1) return true;
    return u.permissions.indexOf(name) !== -1;
  }

  function dashboardFor(role) {
    var map = {
      CUSTOMER:    'customer-dashboard.html',
      PROVIDER:    'provider-dashboard.html',
      ADMIN:       'admin-dashboard.html',
      SUPER_ADMIN: 'superadmin-dashboard.html'
    };
    return map[role] || 'index.html';
  }

  /**
   * Only same-site paths: must start with one "/" and not "//" or "/\"
   * (both can be treated as another host). Prevents open redirects.
   */
  function safeNext(url) {
    if (typeof url !== 'string') return '/index.html';
    if (/^\/(?![\/\\])/.test(url)) return url;
    return '/index.html';
  }

  function clear() {
    _user = null;
    _loaded = false;
    _userPromise = null;
  }

  /* ── Public object ─────────────────────────────────────────── */
  window.Auth = {
    getUser:         getUser,
    getCachedUser:   getCachedUser,
    isAuthenticated: isAuthenticated,
    isLoaded:        function () { return _loaded; },
    login:           login,
    register:        register,
    logout:          logout,
    requireRole:     requireRole,
    hasRole:         hasRole,
    hasPermission:   hasPermission,
    dashboardFor:    dashboardFor,
    redirectToLogin: redirectToLogin,
    safeNext:        safeNext,
    clear:           clear
  };

}());
