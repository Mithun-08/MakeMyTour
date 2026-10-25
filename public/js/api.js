/**
 * api.js — Shared Fetch helper
 * Owner: M2 (Meharnaz)  |  Frozen after Day 1
 * Contract: docs/CONTRACT.md §1.6 and §1.8
 *
 * Exports a global `api` object with five methods:
 *   api.get(url, params?)  → resolves { data, meta?, message? }
 *   api.post(url, body?)   → resolves { data, meta?, message? }
 *   api.put(url, body?)    → resolves { data, meta?, message? }
 *   api.patch(url, body?)  → resolves { data, meta?, message? }
 *   api.del(url)           → resolves { data, meta?, message? }
 *
 * On error, every method rejects with an ApiError instance:
 *   { status:number, code:string, message:string, details:object|undefined }
 *
 * A 401 response on a page that requires auth redirects to
 *   /login.html?next=<encoded current path>
 * unless the current page IS the login page (prevents redirect loops).
 *
 * Rules:
 *  - Never silently swallow errors or return fake data.
 *  - Never assumes an endpoint is available before M1/M3 implements it.
 *  - Works entirely with the contract's snake_case JSON envelope.
 */

(function () {
  'use strict';

  /* ── ApiError ────────────────────────────────────────────── */
  function ApiError(status, code, message, details) {
    this.name    = 'ApiError';
    this.status  = status;
    this.code    = code;
    this.message = message;
    this.details = details || undefined;
  }
  ApiError.prototype = Object.create(Error.prototype);

  /* ── Internal fetch wrapper ──────────────────────────────── */

  /**
   * Build a query string from a plain object.
   * Values that are null / undefined are omitted.
   */
  function buildQueryString(params) {
    if (!params || typeof params !== 'object') return '';
    var parts = [];
    Object.keys(params).forEach(function (key) {
      var val = params[key];
      if (val !== null && val !== undefined && val !== '') {
        parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(val));
      }
    });
    return parts.length ? '?' + parts.join('&') : '';
  }

  /**
   * Core request function.
   * @param {string} method  HTTP verb
   * @param {string} url     Absolute path like /api/packages
   * @param {object|null} body   Request body (omit for GET/DELETE)
   * @param {object|null} params Query params object (used by GET)
   * @returns {Promise<{data, meta?, message?}>}
   */
  function request(method, url, body, params) {
    var fullUrl = url + buildQueryString(params);

    var opts = {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin'   // sends mmt_sid cookie
    };

    if (body !== null && body !== undefined) {
      opts.body = JSON.stringify(body);
    }

    return fetch(fullUrl, opts).then(function (res) {
      var status = res.status;

      // Parse body regardless of status (error responses also carry JSON)
      return res.json().then(
        function (json) { return { status: status, json: json }; },
        function ()     { return { status: status, json: null  }; }
      );

    }).then(function (result) {
      var status = result.status;
      var json   = result.json;

      /* ── 401 handling ─────────────────────────────────── */
      if (status === 401) {
        var currentPage = window.location.pathname;
        if (currentPage !== '/login.html') {
          var next = encodeURIComponent(currentPage + window.location.search);
          window.location.href = '/login.html?next=' + next;
          // Return a never-resolving promise; navigation is happening
          return new Promise(function () {});
        }
        // On the login page itself, fall through and reject normally
      }

      /* ── Success ──────────────────────────────────────── */
      if (json && json.success === true) {
        return {
          data:    json.data,
          meta:    json.meta    || undefined,
          message: json.message || undefined
        };
      }

      /* ── API-level error (well-formed error envelope) ──── */
      if (json && json.success === false && json.error) {
        throw new ApiError(
          status,
          json.error.code    || 'UNKNOWN_ERROR',
          json.error.message || 'An unexpected error occurred.',
          json.error.details || undefined
        );
      }

      /* ── Unexpected / non-JSON response ───────────────── */
      throw new ApiError(
        status,
        'UNEXPECTED_RESPONSE',
        'The server returned an unexpected response (HTTP ' + status + ').'
      );

    }).catch(function (err) {
      /* Re-throw ApiErrors as-is */
      if (err instanceof ApiError || err.name === 'ApiError') throw err;

      /* Network / CORS / parse failures */
      if (err instanceof TypeError) {
        throw new ApiError(
          0,
          'NETWORK_ERROR',
          'Could not reach the server. Please check your connection.'
        );
      }

      /* Any other unexpected JS error */
      throw new ApiError(
        0,
        'CLIENT_ERROR',
        err.message || 'An unexpected client-side error occurred.'
      );
    });
  }

  /* ── Public API object ───────────────────────────────────── */
  var api = {
    /**
     * GET /api/path?key=val
     * @param {string} url
     * @param {object} [params]  key/value pairs for query string
     */
    get: function (url, params) {
      return request('GET', url, null, params);
    },

    /**
     * POST /api/path  with JSON body
     * @param {string} url
     * @param {object} [body]
     */
    post: function (url, body) {
      return request('POST', url, body || {}, null);
    },

    /**
     * PUT /api/path  with JSON body
     * @param {string} url
     * @param {object} [body]
     */
    put: function (url, body) {
      return request('PUT', url, body || {}, null);
    },

    /**
     * PATCH /api/path  with JSON body
     * @param {string} url
     * @param {object} [body]
     */
    patch: function (url, body) {
      return request('PATCH', url, body || {}, null);
    },

    /**
     * DELETE /api/path  (no body)
     * @param {string} url
     */
    del: function (url) {
      return request('DELETE', url, null, null);
    }
  };

  /* Expose to global scope for use by all page scripts */
  window.api      = api;
  window.ApiError = ApiError;

}());
