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


// ── profile.routes.js structural & unit tests ──────────────────────────────

test('profile.routes.js requires without errors', () => {
  assert.doesNotThrow(() => {
    require('../server/routes/profile.routes');
  }, 'profile.routes.js must load without throwing');
});

test('profile.routes.js exports an array of 3 routes', () => {
  const routes = require('../server/routes/profile.routes');
  assert.ok(Array.isArray(routes), 'must export an array');
  assert.equal(routes.length, 3, 'must export exactly 3 route objects');
});

test('GET /api/profile requires all authenticated roles', () => {
  const routes = require('../server/routes/profile.routes');
  const route = routes.find(r => r.method === 'GET' && r.path === '/api/profile');
  assert.ok(route, 'GET /api/profile route must exist');
  assert.equal(typeof route.handler, 'function');
  assert.ok(Array.isArray(route.roles));
  for (const role of ['CUSTOMER', 'PROVIDER', 'ADMIN', 'SUPER_ADMIN']) {
    assert.ok(route.roles.includes(role), `GET /api/profile must allow ${role}`);
  }
});

test('PUT /api/profile requires all authenticated roles', () => {
  const routes = require('../server/routes/profile.routes');
  const route = routes.find(r => r.method === 'PUT' && r.path === '/api/profile');
  assert.ok(route, 'PUT /api/profile route must exist');
  assert.equal(typeof route.handler, 'function');
  assert.ok(Array.isArray(route.roles));
  for (const role of ['CUSTOMER', 'PROVIDER', 'ADMIN', 'SUPER_ADMIN']) {
    assert.ok(route.roles.includes(role), `PUT /api/profile must allow ${role}`);
  }
});

test('PUT /api/profile/password requires all authenticated roles', () => {
  const routes = require('../server/routes/profile.routes');
  const route = routes.find(r => r.method === 'PUT' && r.path === '/api/profile/password');
  assert.ok(route, 'PUT /api/profile/password route must exist');
  assert.equal(typeof route.handler, 'function');
  assert.ok(Array.isArray(route.roles));
  for (const role of ['CUSTOMER', 'PROVIDER', 'ADMIN', 'SUPER_ADMIN']) {
    assert.ok(route.roles.includes(role), `PUT /api/profile/password must allow ${role}`);
  }
});

test('GET /api/profile returns user profile and formatted address', async () => {
  const routes = require('../server/routes/profile.routes');
  const route = routes.find(r => r.method === 'GET' && r.path === '/api/profile');

  const ctx = {
    user: { user_id: 5, email: 'user5@test.com', permissions: [] },
    db: {
      query: async (sql, params) => {
        if (sql.includes('FROM users')) {
          return [{
            user_id: 5, name: 'Meena Iyer', email: 'user5@test.com',
            mobile: '9876543210', role: 'PROVIDER', status: 'ACTIVE'
          }];
        }
        if (sql.includes('FROM addresses')) {
          return [{
            address_id: 12, user_id: 5, address_line: 'MG Road',
            city: 'Madikeri', state: 'Karnataka', pincode: '571201'
          }];
        }
        return [];
      }
    }
  };

  const result = await route.handler(ctx);
  assert.ok(result.data && result.data.user, 'must return user');
  assert.equal(result.data.user.user_id, 5);
  assert.equal(result.data.user.name, 'Meena Iyer');
  assert.equal(result.data.user.password, undefined, 'never expose password hash');
  assert.ok(result.data.address, 'must return address');
  assert.equal(result.data.address.address_id, 12);
  assert.equal(result.data.address.city, 'Madikeri');
});

test('GET /api/profile returns address: null when user has no address row', async () => {
  const routes = require('../server/routes/profile.routes');
  const route = routes.find(r => r.method === 'GET' && r.path === '/api/profile');

  const ctx = {
    user: { user_id: 7, email: 'anita@test.com', permissions: [] },
    db: {
      query: async (sql) => {
        if (sql.includes('FROM users')) {
          return [{
            user_id: 7, name: 'Anita Sharma', email: 'anita@test.com',
            mobile: '9876543211', role: 'CUSTOMER', status: 'ACTIVE'
          }];
        }
        if (sql.includes('FROM addresses')) {
          return []; // no address record
        }
        return [];
      }
    }
  };

  const result = await route.handler(ctx);
  assert.ok(result.data && result.data.user);
  assert.equal(result.data.address, null, 'address must be null when no record exists');
});

test('GET /api/profile throws 404 NOT_FOUND if user is missing in DB', async () => {
  const { HttpError } = require('../server/utils/http');
  const routes = require('../server/routes/profile.routes');
  const route = routes.find(r => r.method === 'GET' && r.path === '/api/profile');

  const ctx = {
    user: { user_id: 999, email: 'ghost@test.com', permissions: [] },
    db: {
      query: async () => [] // user not found
    }
  };

  await assert.rejects(
    () => route.handler(ctx),
    (err) => err instanceof HttpError && err.status === 404 && err.code === 'NOT_FOUND'
  );
});

test('PUT /api/profile rejects missing required name/mobile with VALIDATION_ERROR', async () => {
  const { HttpError } = require('../server/utils/http');
  const routes = require('../server/routes/profile.routes');
  const route = routes.find(r => r.method === 'PUT' && r.path === '/api/profile');

  const ctx = {
    user: { user_id: 7, email: 'anita@test.com' },
    body: { address_line: 'Only address supplied' },
    db: {}
  };

  await assert.rejects(
    () => route.handler(ctx),
    (err) => {
      assert.ok(err instanceof HttpError && err.code === 'VALIDATION_ERROR');
      assert.ok(err.details && err.details.name, 'name error required');
      assert.ok(err.details && err.details.mobile, 'mobile error required');
      return true;
    }
  );
});

test('PUT /api/profile rejects invalid mobile format (not 10 digits)', async () => {
  const { HttpError } = require('../server/utils/http');
  const routes = require('../server/routes/profile.routes');
  const route = routes.find(r => r.method === 'PUT' && r.path === '/api/profile');

  const ctx = {
    user: { user_id: 7, email: 'anita@test.com' },
    body: { name: 'Anita', mobile: '123' },
    db: {}
  };

  await assert.rejects(
    () => route.handler(ctx),
    (err) => {
      assert.ok(err instanceof HttpError && err.code === 'VALIDATION_ERROR');
      assert.ok(err.details && err.details.mobile);
      return true;
    }
  );
});

test('PUT /api/profile updates user and updates existing address within transaction', async () => {
  const routes = require('../server/routes/profile.routes');
  const route = routes.find(r => r.method === 'PUT' && r.path === '/api/profile');

  const executedQueries = [];

  const ctx = {
    user: { user_id: 5, email: 'meena@test.com', permissions: [] },
    body: {
      name: 'Meena Updated',
      mobile: '9876543299',
      address_line: 'New Villa 42',
      city: 'Coorg',
      state: 'Karnataka',
      pincode: '571202'
    },
    db: {
      transaction: async (fn) => {
        const tx = {
          query: async (sql, params) => {
            executedQueries.push({ sql, params });
            if (sql.includes('SELECT address_id')) {
              const hasUpdated = executedQueries.some(q => q.sql.includes('UPDATE addresses'));
              if (hasUpdated) {
                return [{
                  address_id: 101, address_line: 'New Villa 42',
                  city: 'Coorg', state: 'Karnataka', pincode: '571202'
                }];
              }
              return [{
                address_id: 101, address_line: 'Old Villa',
                city: 'Madikeri', state: 'Karnataka', pincode: '571201'
              }]; // existing address
            }
            if (sql.includes('SELECT user_id, name, email')) {
              return [{
                user_id: 5, name: 'Meena Updated', email: 'meena@test.com',
                mobile: '9876543299', role: 'PROVIDER', status: 'ACTIVE'
              }];
            }
            return { affectedRows: 1 };
          }
        };
        return fn(tx);
      },
      query: async () => ({ insertId: 1, affectedRows: 1 })
    }
  };

  const result = await route.handler(ctx);
  assert.equal(result.message, 'Profile updated successfully');
  assert.equal(result.data.user.name, 'Meena Updated');
  assert.equal(result.data.address.city, 'Coorg');

  const updateAddrQuery = executedQueries.find(q => q.sql.includes('UPDATE addresses'));
  assert.ok(updateAddrQuery, 'must execute UPDATE on existing address');
  assert.equal(updateAddrQuery.params[4], 101, 'must update address_id 101');
});

test('PUT /api/profile preserves existing address fields when omitted from request, but updates supplied ones', async () => {
  const routes = require('../server/routes/profile.routes');
  const route = routes.find(r => r.method === 'PUT' && r.path === '/api/profile');

  let updateParams = null;
  const initialAddress = {
    address_id: 303,
    address_line: '123 Tea Estate Road',
    city: 'Munnar',
    state: 'Kerala',
    pincode: '685612'
  };

  // Case 1: Updating only name and mobile (omitting all address fields)
  const ctx1 = {
    user: { user_id: 4, email: 'ravi@test.com', permissions: [] },
    body: {
      name: 'Ravi Kumar Jr',
      mobile: '9876500000'
    },
    db: {
      transaction: async (fn) => {
        const tx = {
          query: async (sql, params) => {
            if (sql.includes('SELECT address_id')) {
              return [initialAddress];
            }
            if (sql.includes('UPDATE addresses')) {
              updateParams = params;
            }
            if (sql.includes('SELECT user_id, name, email')) {
              return [{
                user_id: 4, name: 'Ravi Kumar Jr', email: 'ravi@test.com',
                mobile: '9876500000', role: 'PROVIDER', status: 'ACTIVE'
              }];
            }
            return { affectedRows: 1 };
          }
        };
        return fn(tx);
      },
      query: async () => ({ insertId: 1, affectedRows: 1 })
    }
  };

  const result1 = await route.handler(ctx1);
  assert.equal(result1.data.user.name, 'Ravi Kumar Jr');
  // Address fields must be preserved, NOT set to null
  assert.deepEqual(updateParams, [
    '123 Tea Estate Road',
    'Munnar',
    'Kerala',
    '685612',
    303
  ], 'omitted address fields must preserve existing values in the UPDATE query');

  // Case 2: Explicitly supplying a single address field (e.g. new pincode) preserves the others
  let partialUpdateParams = null;
  const ctx2 = {
    user: { user_id: 4, email: 'ravi@test.com', permissions: [] },
    body: {
      name: 'Ravi Kumar Jr',
      mobile: '9876500000',
      pincode: '685999' // explicitly supplied
    },
    db: {
      transaction: async (fn) => {
        const tx = {
          query: async (sql, params) => {
            if (sql.includes('SELECT address_id')) {
              return [initialAddress];
            }
            if (sql.includes('UPDATE addresses')) {
              partialUpdateParams = params;
            }
            if (sql.includes('SELECT user_id, name, email')) {
              return [{
                user_id: 4, name: 'Ravi Kumar Jr', email: 'ravi@test.com',
                mobile: '9876500000', role: 'PROVIDER', status: 'ACTIVE'
              }];
            }
            return { affectedRows: 1 };
          }
        };
        return fn(tx);
      },
      query: async () => ({ insertId: 1, affectedRows: 1 })
    }
  };

  const result2 = await route.handler(ctx2);
  assert.deepEqual(partialUpdateParams, [
    '123 Tea Estate Road', // preserved
    'Munnar',              // preserved
    'Kerala',              // preserved
    '685999',              // updated
    303
  ], 'explicitly supplied address field must update while others are preserved');
});

test('PUT /api/profile updates user and inserts new address when none existed', async () => {
  const routes = require('../server/routes/profile.routes');
  const route = routes.find(r => r.method === 'PUT' && r.path === '/api/profile');

  const executedQueries = [];

  const ctx = {
    user: { user_id: 7, email: 'anita@test.com', permissions: [] },
    body: {
      name: 'Anita Sharma',
      mobile: '9876543210',
      city: 'Kochi',
      state: 'Kerala'
    },
    db: {
      transaction: async (fn) => {
        const tx = {
          query: async (sql, params) => {
            executedQueries.push({ sql, params });
            if (sql.includes('SELECT address_id')) {
              const hasInserted = executedQueries.some(q => q.sql.includes('INSERT INTO addresses'));
              if (hasInserted) {
                return [{
                  address_id: 202, address_line: null,
                  city: 'Kochi', state: 'Kerala', pincode: null
                }];
              }
              return []; // no existing address initially
            }
            if (sql.includes('SELECT user_id, name, email')) {
              return [{
                user_id: 7, name: 'Anita Sharma', email: 'anita@test.com',
                mobile: '9876543210', role: 'CUSTOMER', status: 'ACTIVE'
              }];
            }
            return { insertId: 202, affectedRows: 1 };
          }
        };
        return fn(tx);
      },
      query: async () => ({ insertId: 1, affectedRows: 1 })
    }
  };

  const result = await route.handler(ctx);
  assert.equal(result.data.address.city, 'Kochi');

  const insertAddrQuery = executedQueries.find(q => q.sql.includes('INSERT INTO addresses'));
  assert.ok(insertAddrQuery, 'must execute INSERT INTO addresses');
  assert.equal(insertAddrQuery.params[0], 7, 'user_id must match');
});

test('PUT /api/profile strips email, role, status tampering attempts', async () => {
  const routes = require('../server/routes/profile.routes');
  const route = routes.find(r => r.method === 'PUT' && r.path === '/api/profile');

  let userUpdateParams = null;

  const ctx = {
    user: { user_id: 7, email: 'anita@test.com', permissions: [] },
    body: {
      name: 'Anita S',
      mobile: '9876543210',
      email: 'hacked@test.com', // attempted tamper
      role: 'SUPER_ADMIN',      // attempted tamper
      status: 'BLOCKED'         // attempted tamper
    },
    db: {
      transaction: async (fn) => {
        const tx = {
          query: async (sql, params) => {
            if (sql.includes('UPDATE users')) {
              userUpdateParams = params;
            }
            if (sql.includes('SELECT address_id')) return [];
            if (sql.includes('SELECT user_id, name')) {
              return [{
                user_id: 7, name: 'Anita S', email: 'anita@test.com',
                mobile: '9876543210', role: 'CUSTOMER', status: 'ACTIVE'
              }];
            }
            return { affectedRows: 1 };
          }
        };
        return fn(tx);
      },
      query: async () => ({ insertId: 1, affectedRows: 1 })
    }
  };

  const result = await route.handler(ctx);
  assert.equal(result.data.user.email, 'anita@test.com');
  assert.equal(result.data.user.role, 'CUSTOMER');
  assert.deepEqual(userUpdateParams, ['Anita S', '9876543210', 7]);
});

test('PUT /api/profile/password rejects new_password shorter than 8 chars', async () => {
  const { HttpError } = require('../server/utils/http');
  const routes = require('../server/routes/profile.routes');
  const route = routes.find(r => r.method === 'PUT' && r.path === '/api/profile/password');

  const ctx = {
    user: { user_id: 7, email: 'anita@test.com' },
    body: { current_password: 'Password@123', new_password: 'short' },
    db: {}
  };

  await assert.rejects(
    () => route.handler(ctx),
    (err) => {
      assert.ok(err instanceof HttpError && err.code === 'VALIDATION_ERROR');
      assert.ok(err.details && err.details.new_password);
      return true;
    }
  );
});

test('PUT /api/profile/password rejects missing current_password', async () => {
  const { HttpError } = require('../server/utils/http');
  const routes = require('../server/routes/profile.routes');
  const route = routes.find(r => r.method === 'PUT' && r.path === '/api/profile/password');

  const ctx = {
    user: { user_id: 7, email: 'anita@test.com' },
    body: { new_password: 'NewPassword@123' },
    db: {}
  };

  await assert.rejects(
    () => route.handler(ctx),
    (err) => {
      assert.ok(err instanceof HttpError && err.code === 'VALIDATION_ERROR');
      assert.ok(err.details && err.details.current_password);
      return true;
    }
  );
});

test('PUT /api/profile/password returns 400 INVALID_CREDENTIALS for incorrect current password', async () => {
  const { HttpError } = require('../server/utils/http');
  const { hashPassword } = require('../server/utils/password');
  const routes = require('../server/routes/profile.routes');
  const route = routes.find(r => r.method === 'PUT' && r.path === '/api/profile/password');

  const storedHash = await hashPassword('CorrectPassword@123');

  const ctx = {
    user: { user_id: 7, email: 'anita@test.com' },
    body: { current_password: 'WrongPassword@999', new_password: 'NewPassword@123' },
    db: {
      query: async (sql) => {
        if (sql.includes('SELECT password FROM users')) {
          return [{ password: storedHash }];
        }
        return [];
      }
    }
  };

  await assert.rejects(
    () => route.handler(ctx),
    (err) => {
      assert.ok(err instanceof HttpError, 'must be HttpError');
      assert.equal(err.status, 400, 'must return status 400 to prevent login redirect loop');
      assert.equal(err.code, 'INVALID_CREDENTIALS');
      assert.equal(err.message, 'Current password is incorrect');
      return true;
    }
  );
});

test('PUT /api/profile/password verifies current password and updates hash on match', async () => {
  const { hashPassword, verifyPassword } = require('../server/utils/password');
  const routes = require('../server/routes/profile.routes');
  const route = routes.find(r => r.method === 'PUT' && r.path === '/api/profile/password');

  const storedHash = await hashPassword('CurrentPassword@123');
  let updatedPasswordHash = null;

  const ctx = {
    user: { user_id: 7, email: 'anita@test.com' },
    body: { current_password: 'CurrentPassword@123', new_password: 'BrandNewPassword@456' },
    db: {
      query: async (sql, params) => {
        if (sql.includes('SELECT password FROM users')) {
          return [{ password: storedHash }];
        }
        if (sql.includes('UPDATE users SET password = ?')) {
          updatedPasswordHash = params[0];
          return { affectedRows: 1 };
        }
        // logAction insert
        return { insertId: 1, affectedRows: 1 };
      }
    }
  };

  const result = await route.handler(ctx);
  assert.equal(result.message, 'Password updated successfully');
  assert.equal(result.data, null);
  assert.ok(updatedPasswordHash, 'password must have been updated in DB');
  const verifiesNew = await verifyPassword('BrandNewPassword@456', updatedPasswordHash);
  assert.ok(verifiesNew, 'stored hash must match new password');
});


// ── adminUsers.routes.js structural & unit tests ───────────────────────────

test('adminUsers.routes.js requires without errors', () => {
  assert.doesNotThrow(() => {
    require('../server/routes/adminUsers.routes');
  }, 'adminUsers.routes.js must load without throwing');
});

test('adminUsers.routes.js exports an array of 3 routes', () => {
  const routes = require('../server/routes/adminUsers.routes');
  assert.ok(Array.isArray(routes), 'must export an array');
  assert.equal(routes.length, 3, 'must export exactly 3 route objects');
});

test('GET /api/admin/customers requires ADMIN and MANAGE_USERS permission', () => {
  const routes = require('../server/routes/adminUsers.routes');
  const route = routes.find(r => r.method === 'GET' && r.path === '/api/admin/customers');
  assert.ok(route, 'GET /api/admin/customers must exist');
  assert.deepEqual(route.roles, ['ADMIN']);
  assert.equal(route.permission, 'MANAGE_USERS');
  assert.equal(typeof route.handler, 'function');
});

test('GET /api/admin/providers requires ADMIN and MANAGE_PROVIDERS permission', () => {
  const routes = require('../server/routes/adminUsers.routes');
  const route = routes.find(r => r.method === 'GET' && r.path === '/api/admin/providers');
  assert.ok(route, 'GET /api/admin/providers must exist');
  assert.deepEqual(route.roles, ['ADMIN']);
  assert.equal(route.permission, 'MANAGE_PROVIDERS');
  assert.equal(typeof route.handler, 'function');
});

test('PATCH /api/admin/users/:id/status requires ADMIN role', () => {
  const routes = require('../server/routes/adminUsers.routes');
  const route = routes.find(r => r.method === 'PATCH' && r.path === '/api/admin/users/:id/status');
  assert.ok(route, 'PATCH /api/admin/users/:id/status must exist');
  assert.deepEqual(route.roles, ['ADMIN']);
  assert.equal(typeof route.handler, 'function');
});

test('GET /api/admin/customers returns paginated customer rows with total_bookings', async () => {
  const routes = require('../server/routes/adminUsers.routes');
  const route = routes.find(r => r.method === 'GET' && r.path === '/api/admin/customers');

  const ctx = {
    query: { page: '1', pageSize: '10' },
    db: {
      query: async (sql) => {
        if (sql.includes('SELECT COUNT(*) AS total FROM users')) {
          return [{ total: 2 }];
        }
        return [
          {
            user_id: 7, name: 'Anita Sharma', email: 'anita@test.com',
            mobile: '9876543210', status: 'ACTIVE', created_at: new Date('2026-10-25T10:00:00Z'),
            total_bookings: 3
          },
          {
            user_id: 8, name: 'Karthik R', email: 'karthik@test.com',
            mobile: '9876543211', status: 'ACTIVE', created_at: new Date('2026-10-25T10:05:00Z'),
            total_bookings: 0
          }
        ];
      }
    }
  };

  const result = await route.handler(ctx);
  assert.ok(Array.isArray(result.data));
  assert.equal(result.data.length, 2);
  assert.equal(result.meta.total, 2);
  assert.equal(result.meta.page, 1);
  assert.equal(result.meta.pageSize, 10);
  assert.equal(result.data[0].total_bookings, 3);
  assert.equal(result.data[0].password, undefined, 'never expose password hash');
});

test('GET /api/admin/customers applies search and status filters to SQL query parameters', async () => {
  const routes = require('../server/routes/adminUsers.routes');
  const route = routes.find(r => r.method === 'GET' && r.path === '/api/admin/customers');

  let countParams = null;
  let dataParams = null;

  const ctx = {
    query: { search: 'Anita', status: 'active', page: '2', pageSize: '5' },
    db: {
      query: async (sql, params) => {
        if (sql.includes('SELECT COUNT(*) AS total FROM users')) {
          countParams = params;
          return [{ total: 1 }];
        }
        dataParams = params;
        return [{
          user_id: 7, name: 'Anita Sharma', email: 'anita@test.com',
          mobile: '9876543210', status: 'ACTIVE', created_at: '2026-10-25T10:00:00Z',
          total_bookings: 3
        }];
      }
    }
  };

  const result = await route.handler(ctx);
  assert.equal(result.meta.page, 2);
  assert.equal(result.meta.pageSize, 5);
  // Status filter normalized to upper-case
  assert.ok(countParams.includes('ACTIVE'));
  assert.ok(countParams.includes('%Anita%'));
  // Data query includes limit and offset at the end
  assert.equal(dataParams[dataParams.length - 2], 5, 'limit is pageSize 5');
  assert.equal(dataParams[dataParams.length - 1], 5, 'offset is (2-1)*5 = 5');
});

test('GET /api/admin/providers returns paginated provider rows with package_count, city, state', async () => {
  const routes = require('../server/routes/adminUsers.routes');
  const route = routes.find(r => r.method === 'GET' && r.path === '/api/admin/providers');

  const ctx = {
    query: { page: '1', pageSize: '10' },
    db: {
      query: async (sql) => {
        if (sql.includes('SELECT COUNT(*) AS total FROM users')) {
          return [{ total: 1 }];
        }
        return [{
          user_id: 4, name: 'Ravi Kumar', email: 'ravi@test.com',
          mobile: '9876500000', status: 'ACTIVE', created_at: new Date('2026-10-25T10:00:00Z'),
          package_count: 5, city: 'Munnar', state: 'Kerala'
        }];
      }
    }
  };

  const result = await route.handler(ctx);
  assert.ok(Array.isArray(result.data));
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].package_count, 5);
  assert.equal(result.data[0].city, 'Munnar');
  assert.equal(result.data[0].state, 'Kerala');
  assert.equal(result.data[0].password, undefined, 'never expose password hash');
});

test('PATCH /api/admin/users/:id/status rejects invalid target ID with 400 BAD_REQUEST', async () => {
  const { HttpError } = require('../server/utils/http');
  const routes = require('../server/routes/adminUsers.routes');
  const route = routes.find(r => r.method === 'PATCH' && r.path === '/api/admin/users/:id/status');

  const ctx = {
    params: { id: 'abc' },
    body: { status: 'ACTIVE' },
    user: { role: 'SUPER_ADMIN' },
    db: {}
  };

  await assert.rejects(
    () => route.handler(ctx),
    (err) => err instanceof HttpError && err.status === 400 && err.code === 'BAD_REQUEST'
  );
});

test('PATCH /api/admin/users/:id/status rejects invalid status enum with 400 VALIDATION_ERROR', async () => {
  const { HttpError } = require('../server/utils/http');
  const routes = require('../server/routes/adminUsers.routes');
  const route = routes.find(r => r.method === 'PATCH' && r.path === '/api/admin/users/:id/status');

  const ctx = {
    params: { id: '6' },
    body: { status: 'UNKNOWN_STATUS' },
    user: { role: 'SUPER_ADMIN' },
    db: {}
  };

  await assert.rejects(
    () => route.handler(ctx),
    (err) => {
      assert.ok(err instanceof HttpError && err.code === 'VALIDATION_ERROR');
      assert.ok(err.details && err.details.status);
      return true;
    }
  );
});

test('PATCH /api/admin/users/:id/status throws 404 NOT_FOUND for non-existent user', async () => {
  const { HttpError } = require('../server/utils/http');
  const routes = require('../server/routes/adminUsers.routes');
  const route = routes.find(r => r.method === 'PATCH' && r.path === '/api/admin/users/:id/status');

  const ctx = {
    params: { id: '999' },
    body: { status: 'ACTIVE' },
    user: { role: 'SUPER_ADMIN' },
    db: {
      query: async () => [] // no user found
    }
  };

  await assert.rejects(
    () => route.handler(ctx),
    (err) => err instanceof HttpError && err.status === 404 && err.code === 'NOT_FOUND'
  );
});

test('PATCH /api/admin/users/:id/status rejects modification of ADMIN or SUPER_ADMIN with 403 FORBIDDEN', async () => {
  const { HttpError } = require('../server/utils/http');
  const routes = require('../server/routes/adminUsers.routes');
  const route = routes.find(r => r.method === 'PATCH' && r.path === '/api/admin/users/:id/status');

  const ctx = {
    params: { id: '2' },
    body: { status: 'BLOCKED' },
    user: { role: 'SUPER_ADMIN' },
    db: {
      query: async () => [{ user_id: 2, name: 'Admin', email: 'admin@test.com', role: 'ADMIN', status: 'ACTIVE' }]
    }
  };

  await assert.rejects(
    () => route.handler(ctx),
    (err) => err instanceof HttpError && err.status === 403 && err.code === 'FORBIDDEN'
  );
});

test('PATCH /api/admin/users/:id/status checks MANAGE_USERS when target is CUSTOMER', async () => {
  const { HttpError } = require('../server/utils/http');
  const routes = require('../server/routes/adminUsers.routes');
  const route = routes.find(r => r.method === 'PATCH' && r.path === '/api/admin/users/:id/status');

  // Caller is ADMIN but lacks MANAGE_USERS (only has MANAGE_DESTINATIONS)
  const ctx = {
    params: { id: '7' },
    body: { status: 'BLOCKED' },
    user: { role: 'ADMIN', permissions: ['MANAGE_DESTINATIONS'] },
    db: {
      query: async () => [{ user_id: 7, name: 'Customer', email: 'c@test.com', role: 'CUSTOMER', status: 'ACTIVE' }]
    }
  };

  await assert.rejects(
    () => route.handler(ctx),
    (err) => err instanceof HttpError && err.status === 403 && err.message.includes('MANAGE_USERS')
  );
});

test('PATCH /api/admin/users/:id/status checks MANAGE_PROVIDERS when target is PROVIDER', async () => {
  const { HttpError } = require('../server/utils/http');
  const routes = require('../server/routes/adminUsers.routes');
  const route = routes.find(r => r.method === 'PATCH' && r.path === '/api/admin/users/:id/status');

  // Caller is ADMIN with MANAGE_USERS only (lacks MANAGE_PROVIDERS)
  const ctx = {
    params: { id: '6' },
    body: { status: 'ACTIVE' },
    user: { role: 'ADMIN', permissions: ['MANAGE_USERS'] },
    db: {
      query: async () => [{ user_id: 6, name: 'Provider', email: 'p@test.com', role: 'PROVIDER', status: 'PENDING' }]
    }
  };

  await assert.rejects(
    () => route.handler(ctx),
    (err) => err instanceof HttpError && err.status === 403 && err.message.includes('MANAGE_PROVIDERS')
  );
});

test('PATCH /api/admin/users/:id/status allows valid transitions and updates DB', async () => {
  const routes = require('../server/routes/adminUsers.routes');
  const route = routes.find(r => r.method === 'PATCH' && r.path === '/api/admin/users/:id/status');

  const transitionsToTest = [
    { from: 'PENDING', to: 'ACTIVE',   role: 'PROVIDER' }, // Approve
    { from: 'PENDING', to: 'REJECTED', role: 'PROVIDER' }, // Reject
    { from: 'ACTIVE',  to: 'BLOCKED',  role: 'CUSTOMER' }, // Block
    { from: 'BLOCKED', to: 'ACTIVE',   role: 'CUSTOMER' }  // Unblock
  ];

  for (const t of transitionsToTest) {
    let updatedStatusParam = null;
    const ctx = {
      params: { id: '10' },
      body: { status: t.to },
      user: { role: 'SUPER_ADMIN' },
      db: {
        query: async (sql, params) => {
          if (sql.includes('SELECT user_id, name')) {
            return [{ user_id: 10, name: 'User 10', email: 'u10@test.com', role: t.role, status: t.from }];
          }
          if (sql.includes('UPDATE users SET status = ?')) {
            updatedStatusParam = params[0];
            return { affectedRows: 1 };
          }
          // logAction insert
          return { insertId: 1, affectedRows: 1 };
        }
      }
    };

    const result = await route.handler(ctx);
    assert.equal(result.data.status, t.to);
    assert.equal(result.data.previous_status, t.from);
    assert.equal(updatedStatusParam, t.to);
  }
});

test('PATCH /api/admin/users/:id/status rejects invalid transitions with 409 CONFLICT', async () => {
  const { HttpError } = require('../server/utils/http');
  const routes = require('../server/routes/adminUsers.routes');
  const route = routes.find(r => r.method === 'PATCH' && r.path === '/api/admin/users/:id/status');

  const invalidTransitions = [
    { from: 'ACTIVE',   to: 'ACTIVE' },   // No-op / illegal
    { from: 'PENDING',  to: 'BLOCKED' },  // Cannot block directly from pending
    { from: 'REJECTED', to: 'ACTIVE' },   // Rejected is terminal per contract table
    { from: 'BLOCKED',  to: 'REJECTED' }  // Blocked can only be unblocked to ACTIVE
  ];

  for (const t of invalidTransitions) {
    const ctx = {
      params: { id: '11' },
      body: { status: t.to },
      user: { role: 'SUPER_ADMIN' },
      db: {
        query: async () => [{ user_id: 11, name: 'User 11', email: 'u11@test.com', role: 'PROVIDER', status: t.from }]
      }
    };

    await assert.rejects(
      () => route.handler(ctx),
      (err) => err instanceof HttpError && err.status === 409 && err.code === 'CONFLICT',
      `Transition ${t.from} -> ${t.to} must be rejected with 409`
    );
  }
});
