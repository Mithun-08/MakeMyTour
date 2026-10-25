/**
 * server/router.js  — Owner: M1
 *
 * Auto-loads every *.routes.js file found in server/routes/ and builds a
 * route table. On each request it matches method + path, resolves URL params,
 * checks roles and permissions, and dispatches to the handler.
 *
 * Route file shape (each file exports an array of route objects):
 *   {
 *     method:     'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
 *     path:       '/api/...'  — segments starting with ':' are params
 *     roles:      optional string[]  — required roles (SUPER_ADMIN passes ADMIN routes)
 *     permission: optional string    — required admin permission name
 *     handler:    async (ctx) => { data, meta?, message?, status? }
 *   }
 *
 * ctx shape:
 *   { req, res, params, query, body, user, ip, db }
 *
 * Handler return value: { data, meta?, message?, status? }
 *   status defaults to 200; use 201 for resource creation.
 *   The router wraps it in { success: true, data, meta?, message? }.
 */

const fs = require('fs');
const path = require('path');
const { HttpError, sendJson, sendError, parseJsonBody, parseCookies } = require('./utils/http');
const { getSession, SESSION_COOKIE_NAME } = require('./utils/session');
const db = require('./db');

const ROUTES_DIR = path.join(__dirname, 'routes');

/** @type {Array<{method,path,segments,roles,permission,handler}>} */
const routes = [];

// Auto-load all *.routes.js files
function loadRoutes() {
  if (!fs.existsSync(ROUTES_DIR)) {
    fs.mkdirSync(ROUTES_DIR, { recursive: true });
    return;
  }
  const files = fs.readdirSync(ROUTES_DIR)
    .filter(f => f.endsWith('.routes.js'))
    .sort(); // predictable load order

  for (const file of files) {
    const filePath = path.join(ROUTES_DIR, file);
    try {
      const routeList = require(filePath);
      if (!Array.isArray(routeList)) {
        console.warn(`[router] ${file} does not export an array — skipped`);
        continue;
      }
      for (const route of routeList) {
        if (!route.method || !route.path || typeof route.handler !== 'function') {
          console.warn(`[router] Skipping invalid route in ${file}:`, route);
          continue;
        }
        routes.push({
          method: route.method.toUpperCase(),
          path: route.path,
          segments: route.path.split('/').filter(Boolean),
          roles: route.roles || null,
          permission: route.permission || null,
          handler: route.handler
        });
      }
      console.log(`[router] Loaded ${routeList.length} route(s) from ${file}`);
    } catch (err) {
      console.error(`[router] Failed to load ${file}:`, err.message);
    }
  }
  console.log(`[router] Total routes registered: ${routes.length}`);
}

/**
 * Tries to match the incoming path segments against a registered route.
 * Returns { route, params } or null.
 */
function matchRoute(method, urlPath) {
  const inSegs = urlPath.split('/').filter(Boolean);

  for (const route of routes) {
    if (route.method !== method) continue;
    if (route.segments.length !== inSegs.length) continue;

    const params = {};
    let matched = true;

    for (let i = 0; i < route.segments.length; i++) {
      const seg = route.segments[i];
      if (seg.startsWith(':')) {
        params[seg.slice(1)] = decodeURIComponent(inSegs[i]);
      } else if (seg !== inSegs[i]) {
        matched = false;
        break;
      }
    }

    if (matched) return { route, params };
  }
  return null;
}

/**
 * Resolves the current user from the session cookie and loads their fresh
 * row + permissions from the database. Sets ctx.user or null.
 */
async function resolveUser(cookies) {
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) return null;

  const session = getSession(token);
  if (!session) return null;

  const rows = await db.query(
    'SELECT user_id, name, email, mobile, role, status FROM users WHERE user_id = ?',
    [session.user_id]
  );
  if (!rows.length) return null;

  const user = rows[0];
  if (user.status !== 'ACTIVE') return null; // Blocked/inactive takes effect immediately

  let permissions = [];
  if (user.role === 'SUPER_ADMIN') {
    permissions = ['*'];
  } else if (user.role === 'ADMIN') {
    const permRows = await db.query(
      'SELECT permission_name FROM admin_permissions WHERE admin_id = ?',
      [user.user_id]
    );
    permissions = permRows.map(r => r.permission_name);
  }

  return { ...user, permissions };
}

/**
 * Main HTTP request handler. Passed to http.createServer().
 */
async function dispatch(req, res) {
  const parsedUrl = new URL(req.url, `http://localhost`);
  const pathname = parsedUrl.pathname.replace(/\/+$/, '') || '/';
  const method = req.method.toUpperCase();

  // Derive client IP
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

  // Only handle /api routes here; static files are handled by server.js
  if (!pathname.startsWith('/api')) {
    throw new HttpError(404, 'NOT_FOUND', 'API route not found');
  }

  const cookies = parseCookies(req);

  // Parse body for methods that may carry one
  let body = {};
  if (['POST', 'PUT', 'PATCH'].includes(method)) {
    body = await parseJsonBody(req);
  }

  // Resolve user (loads fresh from DB on every request)
  let user = null;
  try {
    user = await resolveUser(cookies);
  } catch (err) {
    console.error('[router] resolveUser error:', err.message);
  }

  // Build query params object
  const queryParams = {};
  for (const [k, v] of parsedUrl.searchParams.entries()) {
    queryParams[k] = v;
  }

  // Match route
  const match = matchRoute(method, pathname);

  if (!match) {
    // Check if any route exists for this path with a different method
    const pathMatch = routes.some(r => {
      const inSegs = pathname.split('/').filter(Boolean);
      if (r.segments.length !== inSegs.length) return false;
      for (let i = 0; i < r.segments.length; i++) {
        const seg = r.segments[i];
        if (!seg.startsWith(':') && seg !== inSegs[i]) return false;
      }
      return true;
    });
    if (pathMatch) {
      throw new HttpError(405, 'METHOD_NOT_ALLOWED', `Method ${method} not allowed on this endpoint`);
    }
    throw new HttpError(404, 'NOT_FOUND', 'API endpoint not found');
  }

  const { route, params } = match;

  // Auth checks
  if (route.roles) {
    if (!user) {
      throw new HttpError(401, 'UNAUTHENTICATED', 'Authentication required');
    }
    const allowedRoles = route.roles;
    // SUPER_ADMIN implicitly passes any ADMIN-gated route
    const effectiveRole = user.role === 'SUPER_ADMIN' ? 'ADMIN' : user.role;
    if (!allowedRoles.includes(user.role) && !allowedRoles.includes(effectiveRole)) {
      throw new HttpError(403, 'FORBIDDEN', 'Insufficient role');
    }
  }

  // Permission check (SUPER_ADMIN always passes)
  if (route.permission && user) {
    if (user.role !== 'SUPER_ADMIN') {
      if (!user.permissions.includes(route.permission)) {
        throw new HttpError(403, 'FORBIDDEN', `Permission required: ${route.permission}`);
      }
    }
  }

  // Build ctx and call handler
  const ctx = {
    req,
    res,
    params,
    query: queryParams,
    body,
    user,
    ip,
    db,
    cookies
  };

  const result = await route.handler(ctx);

  // Build response envelope
  const httpStatus = result.status || 200;
  const envelope = { success: true };
  if (result.data !== undefined) envelope.data = result.data;
  if (result.meta !== undefined) envelope.meta = result.meta;
  if (result.message !== undefined) envelope.message = result.message;

  sendJson(res, httpStatus, envelope);
}

module.exports = { loadRoutes, dispatch };
