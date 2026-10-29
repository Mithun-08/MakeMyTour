/**
 * server/routes/auth.routes.js  — Owner: M1
 *
 * Authentication endpoints per CONTRACT §1.5 and §1.7:
 *
 *   POST /api/auth/register   — public
 *   POST /api/auth/login      — public
 *   POST /api/auth/logout     — any logged-in user
 *   GET  /api/auth/me         — any logged-in user
 *
 * Cookie: mmt_sid; HttpOnly; SameSite=Lax; Path=/; Max-Age=7200
 * Password: crypto.scrypt via utils/password.js (never returned in responses)
 * Sessions: in-memory Map via utils/session.js
 * Audit log: logAction() for REGISTER, LOGIN, LOGOUT
 */

'use strict';

const { HttpError, serializeCookie } = require('../utils/http');
const validate                        = require('../utils/validate');
const { hashPassword, verifyPassword } = require('../utils/password');
const {
  createSession,
  deleteSession,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS
} = require('../utils/session');
const { logAction } = require('../utils/logger');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds the Set-Cookie header value for the session cookie.
 * CONTRACT §1.5: HttpOnly; SameSite=Lax; Path=/; Max-Age=7200
 */
function makeSessionCookie(token) {
  return serializeCookie(SESSION_COOKIE_NAME, token, {
    maxAge: SESSION_MAX_AGE_SECONDS,
    httpOnly: true,
    sameSite: 'Lax',
    path: '/'
  });
}

/**
 * Builds the clear-cookie header (Max-Age=0, same attributes).
 */
function makeClearCookie() {
  return serializeCookie(SESSION_COOKIE_NAME, '', {
    maxAge: 0,
    httpOnly: true,
    sameSite: 'Lax',
    path: '/'
  });
}

/**
 * Strips the password field and returns a safe user object.
 * CONTRACT §1.5 ctx.user shape: { user_id, name, email, mobile, role, status, permissions }
 * Permissions are [] for CUSTOMER/PROVIDER; loaded by the router on session resolves.
 * Here we return the subset safe to send in a response body.
 */
function safeUser(row, permissions = []) {
  return {
    user_id:  row.user_id,
    name:     row.name,
    email:    row.email,
    mobile:   row.mobile,
    role:     row.role,
    status:   row.status,
    permissions
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/register
// ─────────────────────────────────────────────────────────────────────────────

async function register(ctx) {
  const body = validate(ctx.body, {
    name:     { required: true,  type: 'string', min: 1,  max: 100 },
    email:    { required: true,  type: 'email',  max: 150 },
    password: { required: true,  type: 'string', min: 8,  max: 255 },
    mobile:   { required: true,  type: 'mobile' },
    role:     { required: true,  type: 'enum',   values: ['CUSTOMER', 'PROVIDER'] },
    // Optional address fields
    city:     { required: false, type: 'string', max: 100 },
    state:    { required: false, type: 'string', max: 100 }
  });

  // CONTRACT §1.5: ADMIN and SUPER_ADMIN can never self-register
  // The enum above already prevents it, but be explicit for clarity.
  if (body.role === 'ADMIN' || body.role === 'SUPER_ADMIN') {
    throw new HttpError(403, 'FORBIDDEN', 'Self-registration as ADMIN or SUPER_ADMIN is not allowed');
  }

  // CONTRACT §1.5: CUSTOMER → ACTIVE at once; PROVIDER → PENDING (awaits admin approval)
  const status = body.role === 'CUSTOMER' ? 'ACTIVE' : 'PENDING';

  const hashedPassword = await hashPassword(body.password);

  let newUserId;
  try {
    const result = await ctx.db.query(
      'INSERT INTO users (name, email, password, mobile, role, status) VALUES (?, ?, ?, ?, ?, ?)',
      [body.name, body.email, hashedPassword, body.mobile, body.role, status]
    );
    newUserId = result.insertId;
  } catch (err) {
    // MySQL duplicate-entry error code
    if (err.code === 'ER_DUP_ENTRY') {
      throw new HttpError(409, 'CONFLICT', 'An account with this email already exists');
    }
    throw err;
  }

  // Insert optional provider address (city/state for local tourist context)
  if (body.role === 'PROVIDER' && (body.city || body.state)) {
    try {
      await ctx.db.query(
        'INSERT INTO addresses (user_id, city, state) VALUES (?, ?, ?)',
        [newUserId, body.city || null, body.state || null]
      );
    } catch (addrErr) {
      // Non-fatal: log and continue. User row already committed.
      console.error('[auth/register] Failed to insert provider address:', addrErr.message);
    }
  }

  // Build a minimal ctx-like object for logAction (user_id set to the new user)
  const logCtx = { ...ctx, user: { user_id: newUserId } };
  await logAction(logCtx, 'REGISTER', `New ${body.role} registered: ${body.email}`);

  return {
    status: 201,
    data: {
      user_id: newUserId,
      role:    body.role,
      status
    },
    message: body.role === 'PROVIDER'
      ? 'Registration successful. Your account is pending admin approval.'
      : 'Registration successful.'
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/login
// ─────────────────────────────────────────────────────────────────────────────

async function login(ctx) {
  const body = validate(ctx.body, {
    email:    { required: true, type: 'email' },
    password: { required: true, type: 'string', min: 1 }
  });

  // Load user — select password hash for verification, never return it
  const rows = await ctx.db.query(
    'SELECT user_id, name, email, password, mobile, role, status FROM users WHERE email = ?',
    [body.email]
  );

  // CONTRACT §1.5: "Wrong email or password → 401 INVALID_CREDENTIALS.
  //  Never reveal which of email or password was wrong."
  if (!rows.length) {
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  const user = rows[0];
  const passwordOk = await verifyPassword(body.password, user.password);
  if (!passwordOk) {
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  // CONTRACT §1.5: status checks return 403 with role-specific codes
  switch (user.status) {
    case 'PENDING':
      throw new HttpError(403, 'ACCOUNT_PENDING',
        'Your account is pending approval. Please wait for an administrator to review your registration.');
    case 'BLOCKED':
      throw new HttpError(403, 'ACCOUNT_BLOCKED',
        'Your account has been blocked. Please contact support.');
    case 'REJECTED':
      throw new HttpError(403, 'ACCOUNT_REJECTED',
        'Your registration was not approved. Please contact support.');
    case 'INACTIVE':
      throw new HttpError(403, 'ACCOUNT_INACTIVE',
        'Your account is inactive. Please contact support.');
    case 'ACTIVE':
      break; // proceed
    default:
      throw new HttpError(403, 'ACCOUNT_INACTIVE', 'Your account is not accessible.');
  }

  // Load permissions for the response (router also loads fresh on every request)
  let permissions = [];
  if (user.role === 'SUPER_ADMIN') {
    permissions = ['*'];
  } else if (user.role === 'ADMIN') {
    const permRows = await ctx.db.query(
      'SELECT permission_name FROM admin_permissions WHERE admin_id = ?',
      [user.user_id]
    );
    permissions = permRows.map(r => r.permission_name);
  }

  const token = createSession(user.user_id);
  const cookieHeader = makeSessionCookie(token);

  // Inject the Set-Cookie header. The router calls sendJson after returning;
  // we use ctx.res to set the header before the response is written.
  ctx.res.setHeader('Set-Cookie', cookieHeader);

  // Log before responding (non-blocking failure in logAction)
  const logCtx = { ...ctx, user: { user_id: user.user_id } };
  await logAction(logCtx, 'LOGIN', `Login: ${user.email} (${user.role})`);

  return {
    data: {
      user: safeUser(user, permissions)
    },
    message: 'Login successful'
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/logout
// ─────────────────────────────────────────────────────────────────────────────

async function logout(ctx) {
  // Route has roles: ['CUSTOMER','PROVIDER','ADMIN','SUPER_ADMIN'] so ctx.user is guaranteed
  const token = ctx.cookies[SESSION_COOKIE_NAME];
  if (token) {
    deleteSession(token);
  }

  ctx.res.setHeader('Set-Cookie', makeClearCookie());

  await logAction(ctx, 'LOGOUT', `Logout: ${ctx.user.email}`);

  return {
    data: null,
    message: 'Logged out successfully'
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/auth/me
// ─────────────────────────────────────────────────────────────────────────────

async function me(ctx) {
  // Router guarantees ctx.user is set (roles check)
  // ctx.user is already the fresh-from-DB + permissions object built by resolveUser()
  return {
    data: {
      user: ctx.user
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Route table (exported — auto-loaded by router.js)
// ─────────────────────────────────────────────────────────────────────────────

module.exports = [
  {
    method:  'POST',
    path:    '/api/auth/register',
    // public — no roles required
    handler: register
  },
  {
    method:  'POST',
    path:    '/api/auth/login',
    // public — no roles required
    handler: login
  },
  {
    method:  'POST',
    path:    '/api/auth/logout',
    // Must be logged in (any role)
    roles:   ['CUSTOMER', 'PROVIDER', 'ADMIN', 'SUPER_ADMIN'],
    handler: logout
  },
  {
    method:  'GET',
    path:    '/api/auth/me',
    // Must be logged in (any role)
    roles:   ['CUSTOMER', 'PROVIDER', 'ADMIN', 'SUPER_ADMIN'],
    handler: me
  }
];

