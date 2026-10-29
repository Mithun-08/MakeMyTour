/**
 * tests/smoke.test.js  — Owner: M1
 *
 * Minimal smoke tests using Node.js built-in test runner (`node --test`).
 * These tests do NOT require a running server or database connection.
 * They verify that the core utility modules load and behave correctly.
 *
 * Run: npm test
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

// ── config.js ──────────────────────────────────────────────────────────────

test('config loads without throwing and has required keys', () => {
  const config = require('../server/config');
  assert.ok(typeof config.PORT === 'number',              'PORT must be a number');
  assert.ok(config.PORT > 0 && config.PORT < 65536,      'PORT must be in valid range');
  assert.ok(typeof config.DB_HOST === 'string',           'DB_HOST must be a string');
  assert.ok(typeof config.DB_NAME === 'string',           'DB_NAME must be a string');
  assert.ok(typeof config.SESSION_TTL_MINUTES === 'number', 'SESSION_TTL_MINUTES must be a number');
  assert.ok(config.SESSION_TTL_MINUTES > 0,               'SESSION_TTL_MINUTES must be positive');
});

// ── utils/http.js ──────────────────────────────────────────────────────────

test('HttpError stores status, code and message', () => {
  const { HttpError } = require('../server/utils/http');
  const err = new HttpError(404, 'NOT_FOUND', 'Resource missing');
  assert.equal(err.status, 404);
  assert.equal(err.code, 'NOT_FOUND');
  assert.equal(err.message, 'Resource missing');
  assert.ok(err instanceof Error);
});

test('HttpError stores details when provided', () => {
  const { HttpError } = require('../server/utils/http');
  const details = { email: 'email is required' };
  const err = new HttpError(400, 'VALIDATION_ERROR', 'Validation failed', details);
  assert.deepEqual(err.details, details);
});

test('parseCookies parses a standard Cookie header', () => {
  const { parseCookies } = require('../server/utils/http');
  const fakeReq = { headers: { cookie: 'mmt_sid=abc123; theme=dark' } };
  const cookies = parseCookies(fakeReq);
  assert.equal(cookies.mmt_sid, 'abc123');
  assert.equal(cookies.theme, 'dark');
});

test('parseCookies returns empty object when no Cookie header', () => {
  const { parseCookies } = require('../server/utils/http');
  const fakeReq = { headers: {} };
  const cookies = parseCookies(fakeReq);
  assert.deepEqual(cookies, {});
});

test('serializeCookie includes HttpOnly and SameSite=Lax by default', () => {
  const { serializeCookie } = require('../server/utils/http');
  const header = serializeCookie('mmt_sid', 'tokenabc', { maxAge: 7200 });
  assert.ok(header.includes('mmt_sid=tokenabc'),  'has name=value');
  assert.ok(header.includes('Max-Age=7200'),       'has Max-Age');
  assert.ok(header.includes('HttpOnly'),           'has HttpOnly');
  assert.ok(header.includes('SameSite=Lax'),       'has SameSite=Lax');
  assert.ok(header.includes('Path=/'),             'has Path=/');
});

// ── utils/validate.js ──────────────────────────────────────────────────────

test('validate returns cleaned object for valid input', () => {
  const validate = require('../server/utils/validate');
  const result = validate(
    { name: '  Alice  ', age: '25', role: 'CUSTOMER' },
    {
      name: { required: true, type: 'string', min: 1, max: 100 },
      age:  { required: true, type: 'int', min: 1 },
      role: { required: true, type: 'enum', values: ['CUSTOMER', 'PROVIDER'] }
    }
  );
  assert.equal(result.name, 'Alice');   // trimmed
  assert.equal(result.age, 25);         // coerced to int
  assert.equal(result.role, 'CUSTOMER');
});

test('validate strips unknown fields', () => {
  const validate = require('../server/utils/validate');
  const result = validate(
    { name: 'Bob', injected: 'evil' },
    { name: { required: true, type: 'string' } }
  );
  assert.equal(result.name, 'Bob');
  assert.equal(result.injected, undefined);
});

test('validate throws VALIDATION_ERROR for missing required field', () => {
  const validate = require('../server/utils/validate');
  const { HttpError } = require('../server/utils/http');
  assert.throws(
    () => validate({}, { email: { required: true, type: 'email' } }),
    (err) => {
      assert.ok(err instanceof HttpError);
      assert.equal(err.code, 'VALIDATION_ERROR');
      assert.ok(err.details && err.details.email);
      return true;
    }
  );
});

test('validate throws VALIDATION_ERROR for invalid email', () => {
  const validate = require('../server/utils/validate');
  const { HttpError } = require('../server/utils/http');
  assert.throws(
    () => validate({ email: 'notanemail' }, { email: { required: true, type: 'email' } }),
    (err) => err instanceof HttpError && err.code === 'VALIDATION_ERROR'
  );
});

test('validate throws VALIDATION_ERROR for invalid mobile (not 10 digits)', () => {
  const validate = require('../server/utils/validate');
  const { HttpError } = require('../server/utils/http');
  assert.throws(
    () => validate({ mobile: '12345' }, { mobile: { required: true, type: 'mobile' } }),
    (err) => err instanceof HttpError && err.code === 'VALIDATION_ERROR'
  );
});

test('validate accepts a valid mobile (exactly 10 digits)', () => {
  const validate = require('../server/utils/validate');
  const result = validate({ mobile: '9876543210' }, { mobile: { required: true, type: 'mobile' } });
  assert.equal(result.mobile, '9876543210');
});

test('validate throws for enum value not in allowed list', () => {
  const validate = require('../server/utils/validate');
  const { HttpError } = require('../server/utils/http');
  assert.throws(
    () => validate({ status: 'UNKNOWN' }, { status: { required: true, type: 'enum', values: ['ACTIVE', 'INACTIVE'] } }),
    (err) => err instanceof HttpError && err.code === 'VALIDATION_ERROR'
  );
});

// ── utils/password.js ──────────────────────────────────────────────────────

test('hashPassword produces a salt:key string', async () => {
  const { hashPassword } = require('../server/utils/password');
  const hash = await hashPassword('testpassword');
  assert.ok(typeof hash === 'string',      'hash must be a string');
  const parts = hash.split(':');
  assert.equal(parts.length, 2,           'hash must have two colon-separated parts');
  assert.ok(parts[0].length > 0,          'salt part must be non-empty');
  assert.ok(parts[1].length > 0,          'key part must be non-empty');
});

test('verifyPassword returns true for correct password', async () => {
  const { hashPassword, verifyPassword } = require('../server/utils/password');
  const hash = await hashPassword('Secret@123');
  const match = await verifyPassword('Secret@123', hash);
  assert.equal(match, true);
});

test('verifyPassword returns false for wrong password', async () => {
  const { hashPassword, verifyPassword } = require('../server/utils/password');
  const hash = await hashPassword('Secret@123');
  const match = await verifyPassword('WrongPassword', hash);
  assert.equal(match, false);
});

test('verifyPassword returns false for malformed hash', async () => {
  const { verifyPassword } = require('../server/utils/password');
  const match = await verifyPassword('anypassword', 'notavalidhash');
  assert.equal(match, false);
});

// ── utils/session.js ───────────────────────────────────────────────────────

test('createSession returns a 64-char hex token', () => {
  const { createSession } = require('../server/utils/session');
  const token = createSession(99);
  assert.ok(typeof token === 'string',       'token must be a string');
  assert.equal(token.length, 64,             'token must be 64 chars (32 bytes hex)');
  assert.ok(/^[0-9a-f]+$/.test(token),      'token must be lowercase hex');
});

test('getSession returns user_id for a valid token', () => {
  const { createSession, getSession } = require('../server/utils/session');
  const token = createSession(42);
  const session = getSession(token);
  assert.ok(session !== null,                'session must not be null');
  assert.equal(session.user_id, 42,          'user_id must match');
});

test('getSession returns null for unknown token', () => {
  const { getSession } = require('../server/utils/session');
  assert.equal(getSession('deadbeefdeadbeefdeadbeef'), null);
});

test('deleteSession makes token invalid', () => {
  const { createSession, getSession, deleteSession } = require('../server/utils/session');
  const token = createSession(7);
  deleteSession(token);
  assert.equal(getSession(token), null);
});

test('each createSession call produces a unique token', () => {
  const { createSession } = require('../server/utils/session');
  const tokens = new Set();
  for (let i = 0; i < 20; i++) tokens.add(createSession(i));
  assert.equal(tokens.size, 20, 'all 20 tokens must be unique');
});


// ── auth.routes.js structural tests ────────────────────────────────────────
// These tests do NOT connect to a database. They verify:
//   1. The module requires without errors.
//   2. The exported array has the four required route objects.
//   3. Each route has the correct method, path and handler type.
//   4. Restricted routes carry a non-empty `roles` array.

test('auth.routes.js requires without errors', () => {
  assert.doesNotThrow(() => {
    require('../server/routes/auth.routes');
  }, 'auth.routes.js must load without throwing');
});

test('auth.routes.js exports an array of 4 routes', () => {
  const routes = require('../server/routes/auth.routes');
  assert.ok(Array.isArray(routes), 'must export an array');
  assert.equal(routes.length, 4, 'must export exactly 4 route objects');
});

test('POST /api/auth/register route is public (no roles)', () => {
  const routes = require('../server/routes/auth.routes');
  const route = routes.find(r => r.method === 'POST' && r.path === '/api/auth/register');
  assert.ok(route, 'register route must exist');
  assert.equal(typeof route.handler, 'function', 'handler must be a function');
  assert.ok(!route.roles, 'register must be public (no roles property)');
});

test('POST /api/auth/login route is public (no roles)', () => {
  const routes = require('../server/routes/auth.routes');
  const route = routes.find(r => r.method === 'POST' && r.path === '/api/auth/login');
  assert.ok(route, 'login route must exist');
  assert.equal(typeof route.handler, 'function', 'handler must be a function');
  assert.ok(!route.roles, 'login must be public (no roles property)');
});

test('POST /api/auth/logout requires a role', () => {
  const routes = require('../server/routes/auth.routes');
  const route = routes.find(r => r.method === 'POST' && r.path === '/api/auth/logout');
  assert.ok(route, 'logout route must exist');
  assert.equal(typeof route.handler, 'function', 'handler must be a function');
  assert.ok(Array.isArray(route.roles) && route.roles.length > 0, 'logout must require a role');
  assert.ok(route.roles.includes('CUSTOMER'), 'CUSTOMER must be in logout roles');
  assert.ok(route.roles.includes('PROVIDER'), 'PROVIDER must be in logout roles');
  assert.ok(route.roles.includes('ADMIN'),    'ADMIN must be in logout roles');
  assert.ok(route.roles.includes('SUPER_ADMIN'), 'SUPER_ADMIN must be in logout roles');
});

test('GET /api/auth/me requires a role', () => {
  const routes = require('../server/routes/auth.routes');
  const route = routes.find(r => r.method === 'GET' && r.path === '/api/auth/me');
  assert.ok(route, 'me route must exist');
  assert.equal(typeof route.handler, 'function', 'handler must be a function');
  assert.ok(Array.isArray(route.roles) && route.roles.length > 0, 'me must require a role');
});

// ── auth handler unit tests (no DB) ─────────────────────────────────────────
// We test the handler logic by constructing minimal ctx objects.
// The DB calls in the handler are skipped by supplying mock ctx.db stubs.

test('register handler rejects ADMIN role even if validator were bypassed', async () => {
  // The validate() call in the handler uses enum: ['CUSTOMER','PROVIDER'],
  // so ADMIN is blocked at validation. Confirm the handler throws HttpError 400.
  const { HttpError } = require('../server/utils/http');
  // Load the module fresh to get the handler function
  delete require.cache[require.resolve('../server/routes/auth.routes')];
  const routes = require('../server/routes/auth.routes');
  const registerRoute = routes.find(r => r.path === '/api/auth/register');

  const ctx = {
    body: { name: 'Evil', email: 'evil@x.com', password: 'Passw0rd!', mobile: '9999999999', role: 'ADMIN' },
    ip: '127.0.0.1',
    db: {},
    res: { setHeader() {} },
    cookies: {}
  };
  await assert.rejects(
    () => registerRoute.handler(ctx),
    (err) => {
      assert.ok(err instanceof HttpError, 'must throw HttpError');
      assert.equal(err.code, 'VALIDATION_ERROR', 'must be VALIDATION_ERROR (enum rejects ADMIN)');
      return true;
    }
  );
});

test('register handler rejects missing required fields with VALIDATION_ERROR', async () => {
  const { HttpError } = require('../server/utils/http');
  const routes = require('../server/routes/auth.routes');
  const registerRoute = routes.find(r => r.path === '/api/auth/register');

  const ctx = {
    body: {}, // empty body
    ip: '127.0.0.1',
    db: {},
    res: { setHeader() {} },
    cookies: {}
  };
  await assert.rejects(
    () => registerRoute.handler(ctx),
    (err) => err instanceof HttpError && err.code === 'VALIDATION_ERROR'
  );
});

test('register handler rejects password shorter than 8 chars', async () => {
  const { HttpError } = require('../server/utils/http');
  const routes = require('../server/routes/auth.routes');
  const registerRoute = routes.find(r => r.path === '/api/auth/register');

  const ctx = {
    body: { name: 'Alice', email: 'alice@x.com', password: 'short', mobile: '9876543210', role: 'CUSTOMER' },
    ip: '127.0.0.1',
    db: {},
    res: { setHeader() {} },
    cookies: {}
  };
  await assert.rejects(
    () => registerRoute.handler(ctx),
    (err) => {
      assert.ok(err instanceof HttpError && err.code === 'VALIDATION_ERROR');
      assert.ok(err.details && err.details.password, 'details.password must be set');
      return true;
    }
  );
});

test('login handler rejects missing email/password with VALIDATION_ERROR', async () => {
  const { HttpError } = require('../server/utils/http');
  const routes = require('../server/routes/auth.routes');
  const loginRoute = routes.find(r => r.path === '/api/auth/login');

  const ctx = {
    body: {},
    ip: '127.0.0.1',
    db: {},
    res: { setHeader() {} },
    cookies: {}
  };
  await assert.rejects(
    () => loginRoute.handler(ctx),
    (err) => err instanceof HttpError && err.code === 'VALIDATION_ERROR'
  );
});

test('login handler returns INVALID_CREDENTIALS when user not found (mock DB)', async () => {
  const { HttpError } = require('../server/utils/http');
  const routes = require('../server/routes/auth.routes');
  const loginRoute = routes.find(r => r.path === '/api/auth/login');

  const ctx = {
    body: { email: 'nobody@x.com', password: 'Password@123' },
    ip: '127.0.0.1',
    db: {
      query: async () => [] // no rows returned — user not found
    },
    res: { setHeader() {} },
    cookies: {}
  };
  await assert.rejects(
    () => loginRoute.handler(ctx),
    (err) => {
      assert.ok(err instanceof HttpError, 'must throw HttpError');
      assert.equal(err.status, 401,                 'status must be 401');
      assert.equal(err.code, 'INVALID_CREDENTIALS', 'code must be INVALID_CREDENTIALS');
      return true;
    }
  );
});

test('login handler returns INVALID_CREDENTIALS for wrong password (mock DB)', async () => {
  const { HttpError } = require('../server/utils/http');
  const { hashPassword } = require('../server/utils/password');
  const routes = require('../server/routes/auth.routes');
  const loginRoute = routes.find(r => r.path === '/api/auth/login');

  const storedHash = await hashPassword('CorrectPassword@1');

  const ctx = {
    body: { email: 'test@x.com', password: 'WrongPassword@1' },
    ip: '127.0.0.1',
    db: {
      query: async () => [{
        user_id: 1, name: 'Test', email: 'test@x.com',
        password: storedHash, mobile: '9999999999',
        role: 'CUSTOMER', status: 'ACTIVE'
      }]
    },
    res: { setHeader() {} },
    cookies: {}
  };
  await assert.rejects(
    () => loginRoute.handler(ctx),
    (err) => err instanceof HttpError && err.status === 401 && err.code === 'INVALID_CREDENTIALS'
  );
});

test('login handler returns ACCOUNT_PENDING for pending user (mock DB)', async () => {
  const { HttpError } = require('../server/utils/http');
  const { hashPassword } = require('../server/utils/password');
  const routes = require('../server/routes/auth.routes');
  const loginRoute = routes.find(r => r.path === '/api/auth/login');

  const storedHash = await hashPassword('Password@123');

  const ctx = {
    body: { email: 'pending@x.com', password: 'Password@123' },
    ip: '127.0.0.1',
    db: {
      query: async () => [{
        user_id: 9, name: 'Pending User', email: 'pending@x.com',
        password: storedHash, mobile: '9999999998',
        role: 'PROVIDER', status: 'PENDING'
      }]
    },
    res: { setHeader() {} },
    cookies: {}
  };
  await assert.rejects(
    () => loginRoute.handler(ctx),
    (err) => err instanceof HttpError && err.status === 403 && err.code === 'ACCOUNT_PENDING'
  );
});

test('login handler returns ACCOUNT_BLOCKED for blocked user (mock DB)', async () => {
  const { HttpError } = require('../server/utils/http');
  const { hashPassword } = require('../server/utils/password');
  const routes = require('../server/routes/auth.routes');
  const loginRoute = routes.find(r => r.path === '/api/auth/login');

  const storedHash = await hashPassword('Password@123');

  const ctx = {
    body: { email: 'blocked@x.com', password: 'Password@123' },
    ip: '127.0.0.1',
    db: {
      query: async () => [{
        user_id: 10, name: 'Blocked', email: 'blocked@x.com',
        password: storedHash, mobile: '9999999997',
        role: 'CUSTOMER', status: 'BLOCKED'
      }]
    },
    res: { setHeader() {} },
    cookies: {}
  };
  await assert.rejects(
    () => loginRoute.handler(ctx),
    (err) => err instanceof HttpError && err.status === 403 && err.code === 'ACCOUNT_BLOCKED'
  );
});

test('login handler returns ACCOUNT_REJECTED for rejected user (mock DB)', async () => {
  const { HttpError } = require('../server/utils/http');
  const { hashPassword } = require('../server/utils/password');
  const routes = require('../server/routes/auth.routes');
  const loginRoute = routes.find(r => r.path === '/api/auth/login');

  const storedHash = await hashPassword('Password@123');

  const ctx = {
    body: { email: 'rejected@x.com', password: 'Password@123' },
    ip: '127.0.0.1',
    db: {
      query: async () => [{
        user_id: 11, name: 'Rejected', email: 'rejected@x.com',
        password: storedHash, mobile: '9999999996',
        role: 'PROVIDER', status: 'REJECTED'
      }]
    },
    res: { setHeader() {} },
    cookies: {}
  };
  await assert.rejects(
    () => loginRoute.handler(ctx),
    (err) => err instanceof HttpError && err.status === 403 && err.code === 'ACCOUNT_REJECTED'
  );
});

test('login handler returns ACCOUNT_INACTIVE for inactive user (mock DB)', async () => {
  const { HttpError } = require('../server/utils/http');
  const { hashPassword } = require('../server/utils/password');
  const routes = require('../server/routes/auth.routes');
  const loginRoute = routes.find(r => r.path === '/api/auth/login');

  const storedHash = await hashPassword('Password@123');

  const ctx = {
    body: { email: 'inactive@x.com', password: 'Password@123' },
    ip: '127.0.0.1',
    db: {
      query: async () => [{
        user_id: 12, name: 'Inactive', email: 'inactive@x.com',
        password: storedHash, mobile: '9999999995',
        role: 'CUSTOMER', status: 'INACTIVE'
      }]
    },
    res: { setHeader() {} },
    cookies: {}
  };
  await assert.rejects(
    () => loginRoute.handler(ctx),
    (err) => err instanceof HttpError && err.status === 403 && err.code === 'ACCOUNT_INACTIVE'
  );
});

test('login handler succeeds for ACTIVE CUSTOMER and returns safe user (mock DB)', async () => {
  const { hashPassword } = require('../server/utils/password');
  const routes = require('../server/routes/auth.routes');
  const loginRoute = routes.find(r => r.path === '/api/auth/login');

  const storedHash = await hashPassword('Password@123');
  const cookiesSet = [];

  const ctx = {
    body: { email: 'customer@x.com', password: 'Password@123' },
    ip: '127.0.0.1',
    db: {
      query: async (sql) => {
        if (sql.includes('FROM users')) {
          return [{
            user_id: 7, name: 'Customer One', email: 'customer@x.com',
            password: storedHash, mobile: '9123456789',
            role: 'CUSTOMER', status: 'ACTIVE'
          }];
        }
        // INSERT INTO system_logs
        return { insertId: 1, affectedRows: 1 };
      }
    },
    res: {
      setHeader(name, value) { cookiesSet.push({ name, value }); }
    },
    cookies: {}
  };

  const result = await loginRoute.handler(ctx);

  assert.ok(result.data && result.data.user,                      'result.data.user must exist');
  assert.equal(result.data.user.user_id, 7,                       'user_id must be 7');
  assert.equal(result.data.user.role, 'CUSTOMER',                 'role must be CUSTOMER');
  assert.equal(result.data.user.password, undefined,              'password hash must NOT be in response');
  assert.ok(cookiesSet.length > 0,                                'Set-Cookie header must have been called');
  const setCookie = cookiesSet.find(h => h.name === 'Set-Cookie');
  assert.ok(setCookie,                                            'Set-Cookie header must be present');
  assert.ok(setCookie.value.includes('mmt_sid='),                'cookie must contain mmt_sid');
  assert.ok(setCookie.value.includes('HttpOnly'),                'cookie must be HttpOnly');
  assert.ok(setCookie.value.includes('SameSite=Lax'),            'cookie must have SameSite=Lax');
});

test('logout handler deletes session and sets clear-cookie (mock ctx)', async () => {
  const { createSession, getSession } = require('../server/utils/session');
  const routes = require('../server/routes/auth.routes');
  const logoutRoute = routes.find(r => r.path === '/api/auth/logout');

  const token = createSession(99);
  // Confirm session exists before logout
  assert.ok(getSession(token) !== null, 'session must exist before logout');

  const cookiesSet = [];
  const ctx = {
    body: {},
    ip: '127.0.0.1',
    db: {
      query: async () => ({ insertId: 1, affectedRows: 1 })
    },
    res: {
      setHeader(name, value) { cookiesSet.push({ name, value }); }
    },
    cookies: { mmt_sid: token },
    user: { user_id: 99, email: 'test@x.com', role: 'CUSTOMER' }
  };

  const result = await logoutRoute.handler(ctx);

  assert.equal(getSession(token), null, 'session must be deleted after logout');
  assert.ok(cookiesSet.length > 0, 'Set-Cookie must be called');
  const setCookie = cookiesSet.find(h => h.name === 'Set-Cookie');
  assert.ok(setCookie.value.includes('Max-Age=0'), 'clear-cookie must have Max-Age=0');
  assert.equal(result.message, 'Logged out successfully');
});

test('me handler returns ctx.user without DB call', async () => {
  const routes = require('../server/routes/auth.routes');
  const meRoute = routes.find(r => r.path === '/api/auth/me');

  const fakeUser = {
    user_id: 7, name: 'Alice', email: 'alice@x.com',
    mobile: '9876543210', role: 'CUSTOMER', status: 'ACTIVE',
    permissions: []
  };
  const ctx = {
    body: {},
    ip: '127.0.0.1',
    db: {},
    res: { setHeader() {} },
    cookies: {},
    user: fakeUser
  };

  const result = await meRoute.handler(ctx);
  assert.deepEqual(result.data.user, fakeUser, 'me must return ctx.user as-is');
});
