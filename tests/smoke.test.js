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
