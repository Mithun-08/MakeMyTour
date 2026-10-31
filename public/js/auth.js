/**
 * auth.js — Frontend authentication helpers
 * Owner: M2 (Meharnaz)  |  Frozen after Day 1
 * Contract: docs/CONTRACT.md §1.8
 *
 * Depends on: api.js (must be loaded first)
 *
 * Exports a global `Auth` object:
 *   Auth.getUser()           → Promise<user|null>  (cached per page load)
 *   Auth.requireRole(roles)  → Promise<user>  redirects if not logged in or wrong role
 *   Auth.logout()            → Promise<void>
 *   Auth.dashboardFor(role)  → string  (HTML filename)
 *   Auth.hasPermission(name) → boolean  (uses cached user; false if not loaded yet)
 *   Auth.safeNext(url)       → string  (only allows paths starting with /)
 */

(function () {
  'use strict';

  /* Cache per page load */
  var _userPromise = null;

  /* ── getUser ──────────────────────────────────────────────── */

  /**
   * Fetch the current user from the server, caching the result.
   * Returns null if not logged in (401 is caught and treated as null).
   * @returns {Promise<object|null>}
   */
  function getUser() {
    if (_userPromise) return _userPromise;

    _userPromise = api.get('/api/auth/me').then(function (res) {
      return res.data && res.data.user ? res.data.user : (res.data || null);
    }).catch(function (err) {
      // 401 = not logged in — return null instead of throwing
      if (err && err.status === 401) return null;
      // Other errors: re-throw so callers know something went wrong
      throw err;
    });

    return _userPromise;
  }

  /* ── requireRole ──────────────────────────────────────────── */

  /**
   * Resolve with the current user if they are logged in and have one of
   * the allowed roles.  Otherwise:
   *   - Not logged in → redirect to /login.html?next=<current page>
   *   - Wrong role    → redirect to the user's own dashboard
   * @param {string[]} roles  e.g. ['PROVIDER']
   * @returns {Promise<object>}
   */
  function requireRole(roles) {
    return getUser().then(function (user) {
      if (!user) {
        var next = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = '/login.html?next=' + next;
        return new Promise(function () {});
      }
      if (roles && roles.length && roles.indexOf(user.role) === -1) {
        window.location.href = '/' + dashboardFor(user.role);
        return new Promise(function () {});
      }
      return user;
    });
  }

  /* ── logout ───────────────────────────────────────────────── */

  /**
   * Log the current user out.
   * Clears the local cache and redirects to the home page on success.
   * @returns {Promise<void>}
   */
  function logout() {
    return api.post('/api/auth/logout').then(function () {
      _userPromise = null;
      window.location.href = '/index.html';
    }).catch(function (err) {
      // Show error but do not leave the user stranded
      if (window.UI) window.UI.toast('Logout failed: ' + (err.message || 'Unknown error'), 'error');
    });
  }

  /* ── dashboardFor ─────────────────────────────────────────── */

  /**
   * Map a role string to its dashboard HTML filename.
   * @param {string} role
   * @returns {string}
   */
  function dashboardFor(role) {
    var map = {
      CUSTOMER:    'customer-dashboard.html',
      PROVIDER:    'provider-dashboard.html',
      ADMIN:       'admin-dashboard.html',
      SUPER_ADMIN: 'superadmin-dashboard.html'
    };
    return map[role] || 'index.html';
  }

  /* ── hasPermission ────────────────────────────────────────── */

  /**
   * Check whether the cached user has a specific admin permission.
   * Returns false if the user is not yet loaded, not logged in, or lacks the permission.
   * NOTE: The server enforces permissions; this is a convenience for hiding UI elements.
   * @param {string} name  e.g. 'MANAGE_USERS'
   * @returns {boolean}
   */
  function hasPermission(name) {
    // _userPromise has already resolved if this is called after page load
    if (!_userPromise) return false;
    var user = null;
    // Synchronous peek — works because we only call this after getUser() has resolved
    _userPromise.then(function (u) { user = u; });
    if (!user) return false;
    if (!user.permissions) return false;
    if (user.permissions[0] === '*') return true;  // SUPER_ADMIN
    return user.permissions.indexOf(name) !== -1;
  }

  /* ── safeNext ─────────────────────────────────────────────── */

  /**
   * Validate a `next` redirect URL from the query string.
   * Only allows paths starting with a single forward slash to prevent
   * open-redirect attacks.
   * @param {string} url
   * @returns {string}  safe URL or '/index.html' as fallback
   */
  function safeNext(url) {
    if (typeof url !== 'string') return '/index.html';
    // Must start with exactly one slash (not // which could be protocol-relative)
    if (/^\/(?!\/)/.test(url)) return url;
    return '/index.html';
  }

  /* ── Public object ────────────────────────────────────────── */
  window.Auth = {
    getUser:       getUser,
    requireRole:   requireRole,
    logout:        logout,
    dashboardFor:  dashboardFor,
    hasPermission: hasPermission,
    safeNext:      safeNext
  };

}());
