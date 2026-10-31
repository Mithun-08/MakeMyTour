'use strict';
/**
 * tests/bookings.admin.test.js — Owner: M3
 *
 * Comprehensive offline unit tests for:
 *   GET /api/admin/bookings
 *
 * Sourced strictly from docs/CONTRACT.md, database/schema.sql,
 * and docs/BOOKING_TEST_CHECKLIST.md (ADM-02).
 *
 * Run: node --test tests/bookings.admin.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const routes = require('../server/routes/bookings.routes');

const adminBookingsRoute = routes.find(
  r => r.method === 'GET' && r.path === '/api/admin/bookings'
);

function makeAdminBookingsContext(opts = {}) {
  const calls = [];
  const countReturn = opts.count !== undefined ? opts.count : 1;
  const rowsReturn = opts.rows !== undefined ? opts.rows : [
    {
      booking_id: 1,
      customer_id: 7,
      package_id: 1,
      availability_id: 10,
      travelers: 2,
      total_amount: '2000.00',
      booking_status: 'CONFIRMED',
      payment_status: 'PAID',
      booked_at: '2026-10-25 10:30:00',
      package_title: 'Munnar Tea Hills',
      provider_id: 4,
      provider_name: 'Rajesh Travels',
      available_date: '2026-11-15',
      customer_name: 'Aarav Sharma',
      customer_email: 'aarav@example.com',
      customer_mobile: '9876543210'
    }
  ];

  const db = {
    async query(sql, params = []) {
      calls.push({ sql: sql.trim(), params });
      if (sql.includes('COUNT(*) AS total')) {
        return [{ total: countReturn }];
      }
      return rowsReturn;
    }
  };

  const ctx = {
    user: opts.user !== undefined ? opts.user : { user_id: 2, role: 'ADMIN', permissions: ['MANAGE_BOOKINGS'] },
    query: opts.query || {},
    db
  };

  return { ctx, calls };
}

describe('GET /api/admin/bookings — Route Registration', () => {
  it('registers GET /api/admin/bookings route with ADMIN role and MANAGE_BOOKINGS permission', () => {
    assert.ok(adminBookingsRoute, 'Route must exist in exported route table');
    assert.equal(adminBookingsRoute.method, 'GET');
    assert.equal(adminBookingsRoute.path, '/api/admin/bookings');
    assert.deepEqual(adminBookingsRoute.roles, ['ADMIN']);
    assert.equal(adminBookingsRoute.permission, 'MANAGE_BOOKINGS');
    assert.equal(typeof adminBookingsRoute.handler, 'function');
  });
});

describe('GET /api/admin/bookings — Role & Permission Guard', () => {
  it('rejects unauthenticated caller with 401 UNAUTHENTICATED', async () => {
    const { ctx } = makeAdminBookingsContext({ user: null });
    await assert.rejects(
      async () => adminBookingsRoute.handler(ctx),
      (err) => {
        assert.equal(err.status, 401);
        assert.equal(err.code, 'UNAUTHENTICATED');
        return true;
      }
    );
  });

  it('rejects CUSTOMER role with 403 FORBIDDEN', async () => {
    const { ctx } = makeAdminBookingsContext({
      user: { user_id: 7, role: 'CUSTOMER', permissions: [] }
    });
    await assert.rejects(
      async () => adminBookingsRoute.handler(ctx),
      (err) => {
        assert.equal(err.status, 403);
        assert.equal(err.code, 'FORBIDDEN');
        return true;
      }
    );
  });

  it('rejects PROVIDER role with 403 FORBIDDEN', async () => {
    const { ctx } = makeAdminBookingsContext({
      user: { user_id: 4, role: 'PROVIDER', permissions: [] }
    });
    await assert.rejects(
      async () => adminBookingsRoute.handler(ctx),
      (err) => {
        assert.equal(err.status, 403);
        assert.equal(err.code, 'FORBIDDEN');
        return true;
      }
    );
  });

  it('rejects ADMIN without MANAGE_BOOKINGS permission with 403 FORBIDDEN', async () => {
    const { ctx } = makeAdminBookingsContext({
      user: { user_id: 3, role: 'ADMIN', permissions: ['VIEW_REPORTS', 'VIEW_LOGS'] }
    });
    await assert.rejects(
      async () => adminBookingsRoute.handler(ctx),
      (err) => {
        assert.equal(err.status, 403);
        assert.equal(err.code, 'FORBIDDEN');
        assert.ok(err.message.includes('MANAGE_BOOKINGS'));
        return true;
      }
    );
  });

  it('allows ADMIN with MANAGE_BOOKINGS permission', async () => {
    const { ctx } = makeAdminBookingsContext({
      user: { user_id: 2, role: 'ADMIN', permissions: ['MANAGE_BOOKINGS'] }
    });
    const res = await adminBookingsRoute.handler(ctx);
    assert.ok(res.data);
    assert.equal(res.data.length, 1);
  });

  it('allows ADMIN with wildcard permission (*)', async () => {
    const { ctx } = makeAdminBookingsContext({
      user: { user_id: 2, role: 'ADMIN', permissions: ['*'] }
    });
    const res = await adminBookingsRoute.handler(ctx);
    assert.ok(res.data);
  });

  it('allows SUPER_ADMIN role unconditionally (permission bypass)', async () => {
    const { ctx } = makeAdminBookingsContext({
      user: { user_id: 1, role: 'SUPER_ADMIN', permissions: [] }
    });
    const res = await adminBookingsRoute.handler(ctx);
    assert.ok(res.data);
  });
});

describe('GET /api/admin/bookings — Query Parameters & Filtering', () => {
  it('filters by status when valid status is passed (ADM-02: status=COMPLETED)', async () => {
    const { ctx, calls } = makeAdminBookingsContext({
      query: { status: 'COMPLETED' }
    });

    const res = await adminBookingsRoute.handler(ctx);
    assert.ok(res.data);

    // Verify both count query and data query have b.booking_status = ? with parameter COMPLETED
    const countCall = calls.find(c => c.sql.includes('COUNT(*) AS total'));
    const dataCall = calls.find(c => c.sql.includes('LIMIT ? OFFSET ?'));

    assert.ok(countCall.sql.includes('b.booking_status = ?'));
    assert.equal(countCall.params[0], 'COMPLETED');

    assert.ok(dataCall.sql.includes('b.booking_status = ?'));
    assert.equal(dataCall.params[0], 'COMPLETED');
  });

  it('handles case-insensitive status query (status=pending)', async () => {
    const { ctx, calls } = makeAdminBookingsContext({
      query: { status: 'pending' }
    });

    await adminBookingsRoute.handler(ctx);
    const countCall = calls.find(c => c.sql.includes('COUNT(*) AS total'));
    assert.equal(countCall.params[0], 'PENDING');
  });

  it('rejects unsupported status with 400 VALIDATION_ERROR', async () => {
    const { ctx } = makeAdminBookingsContext({
      query: { status: 'INVALID_STATUS' }
    });

    await assert.rejects(
      async () => adminBookingsRoute.handler(ctx),
      (err) => {
        assert.equal(err.status, 400);
        assert.equal(err.code, 'VALIDATION_ERROR');
        assert.ok(err.details?.status);
        return true;
      }
    );
  });

  it('filters by search across customer name, email, mobile, and package title', async () => {
    const { ctx, calls } = makeAdminBookingsContext({
      query: { search: 'Sharma' }
    });

    await adminBookingsRoute.handler(ctx);
    const countCall = calls.find(c => c.sql.includes('COUNT(*) AS total'));
    const dataCall = calls.find(c => c.sql.includes('LIMIT ? OFFSET ?'));

    const expectedCondition = '(cu.name LIKE ? OR cu.email LIKE ? OR cu.mobile LIKE ? OR p.title LIKE ?)';
    assert.ok(countCall.sql.includes(expectedCondition));
    assert.ok(dataCall.sql.includes(expectedCondition));

    assert.deepEqual(countCall.params, ['%Sharma%', '%Sharma%', '%Sharma%', '%Sharma%']);
    assert.equal(dataCall.params[0], '%Sharma%');
    assert.equal(dataCall.params[1], '%Sharma%');
    assert.equal(dataCall.params[2], '%Sharma%');
    assert.equal(dataCall.params[3], '%Sharma%');
  });

  it('supports alias "q" for search parameter', async () => {
    const { ctx, calls } = makeAdminBookingsContext({
      query: { q: 'Munnar' }
    });

    await adminBookingsRoute.handler(ctx);
    const countCall = calls.find(c => c.sql.includes('COUNT(*) AS total'));
    assert.deepEqual(countCall.params, ['%Munnar%', '%Munnar%', '%Munnar%', '%Munnar%']);
  });

  it('filters by date range with "from" and "to"', async () => {
    const { ctx, calls } = makeAdminBookingsContext({
      query: { from: '2026-10-01', to: '2026-10-31' }
    });

    await adminBookingsRoute.handler(ctx);
    const countCall = calls.find(c => c.sql.includes('COUNT(*) AS total'));
    const dataCall = calls.find(c => c.sql.includes('LIMIT ? OFFSET ?'));

    assert.ok(countCall.sql.includes('DATE(b.booked_at) >= ?'));
    assert.ok(countCall.sql.includes('DATE(b.booked_at) <= ?'));
    assert.deepEqual(countCall.params, ['2026-10-01', '2026-10-31']);

    assert.ok(dataCall.sql.includes('DATE(b.booked_at) >= ?'));
    assert.ok(dataCall.sql.includes('DATE(b.booked_at) <= ?'));
  });

  it('rejects invalid "from" date format with 400 VALIDATION_ERROR', async () => {
    const { ctx } = makeAdminBookingsContext({
      query: { from: '2026/10/01' }
    });

    await assert.rejects(
      async () => adminBookingsRoute.handler(ctx),
      (err) => {
        assert.equal(err.status, 400);
        assert.equal(err.code, 'VALIDATION_ERROR');
        assert.ok(err.details?.from);
        return true;
      }
    );
  });

  it('rejects invalid "to" date format with 400 VALIDATION_ERROR', async () => {
    const { ctx } = makeAdminBookingsContext({
      query: { to: 'invalid-date' }
    });

    await assert.rejects(
      async () => adminBookingsRoute.handler(ctx),
      (err) => {
        assert.equal(err.status, 400);
        assert.equal(err.code, 'VALIDATION_ERROR');
        assert.ok(err.details?.to);
        return true;
      }
    );
  });

  it('combines all filters (status, search, from, to) with consistent parameterized SQL', async () => {
    const { ctx, calls } = makeAdminBookingsContext({
      query: {
        status: 'CONFIRMED',
        search: 'Goa',
        from: '2026-10-01',
        to: '2026-10-31'
      }
    });

    await adminBookingsRoute.handler(ctx);
    const countCall = calls.find(c => c.sql.includes('COUNT(*) AS total'));
    const dataCall = calls.find(c => c.sql.includes('LIMIT ? OFFSET ?'));

    const expectedFilterParams = [
      'CONFIRMED',
      '%Goa%', '%Goa%', '%Goa%', '%Goa%',
      '2026-10-01',
      '2026-10-31'
    ];

    assert.deepEqual(countCall.params, expectedFilterParams);
    assert.deepEqual(dataCall.params.slice(0, -2), expectedFilterParams);
  });
});

describe('GET /api/admin/bookings — Pagination & Response Formatting', () => {
  it('applies default pagination: page=1, pageSize=10', async () => {
    const { ctx, calls } = makeAdminBookingsContext({ query: {} });

    const res = await adminBookingsRoute.handler(ctx);
    const dataCall = calls.find(c => c.sql.includes('LIMIT ? OFFSET ?'));

    assert.equal(dataCall.params.at(-2), 10); // pageSize
    assert.equal(dataCall.params.at(-1), 0);  // offset = (1 - 1) * 10 = 0

    assert.deepEqual(res.meta, {
      page: 1,
      pageSize: 10,
      total: 1
    });
  });

  it('applies custom pagination: page=3, pageSize=15', async () => {
    const { ctx, calls } = makeAdminBookingsContext({
      query: { page: '3', pageSize: '15' }
    });

    const res = await adminBookingsRoute.handler(ctx);
    const dataCall = calls.find(c => c.sql.includes('LIMIT ? OFFSET ?'));

    assert.equal(dataCall.params.at(-2), 15); // pageSize
    assert.equal(dataCall.params.at(-1), 30); // offset = (3 - 1) * 15 = 30

    assert.equal(res.meta.page, 3);
    assert.equal(res.meta.pageSize, 15);
  });

  it('caps pageSize to maximum 50 when larger value is requested', async () => {
    const { ctx, calls } = makeAdminBookingsContext({
      query: { pageSize: '100' }
    });

    const res = await adminBookingsRoute.handler(ctx);
    const dataCall = calls.find(c => c.sql.includes('LIMIT ? OFFSET ?'));

    assert.equal(dataCall.params.at(-2), 50);
    assert.equal(res.meta.pageSize, 50);
  });

  it('falls back to safe defaults on invalid/negative pagination parameters', async () => {
    const { ctx, calls } = makeAdminBookingsContext({
      query: { page: '-5', pageSize: 'abc' }
    });

    const res = await adminBookingsRoute.handler(ctx);
    const dataCall = calls.find(c => c.sql.includes('LIMIT ? OFFSET ?'));

    assert.equal(dataCall.params.at(-2), 10);
    assert.equal(dataCall.params.at(-1), 0);
    assert.equal(res.meta.page, 1);
    assert.equal(res.meta.pageSize, 10);
  });

  it('formats row fields accurately with numeric types and ISO dates', async () => {
    const rawRows = [
      {
        booking_id: '42',
        customer_id: '7',
        customer_name: 'Priya Patel',
        customer_email: 'priya@example.com',
        customer_mobile: '9123456789',
        package_id: '3',
        package_title: 'Ooty Hills',
        provider_id: '5',
        provider_name: 'Western Tours',
        availability_id: '12',
        available_date: new Date('2026-11-20T00:00:00.000Z'),
        travelers: '3',
        total_amount: '24000.00',
        booking_status: 'CONFIRMED',
        payment_status: 'PAID',
        booked_at: new Date('2026-10-26T08:15:00.000Z')
      }
    ];

    const { ctx } = makeAdminBookingsContext({
      count: 1,
      rows: rawRows
    });

    const res = await adminBookingsRoute.handler(ctx);
    assert.equal(res.data.length, 1);
    const item = res.data[0];

    assert.strictEqual(item.booking_id, 42);
    assert.strictEqual(item.customer_id, 7);
    assert.strictEqual(item.customer_name, 'Priya Patel');
    assert.strictEqual(item.customer_email, 'priya@example.com');
    assert.strictEqual(item.customer_mobile, '9123456789');
    assert.strictEqual(item.package_id, 3);
    assert.strictEqual(item.package_title, 'Ooty Hills');
    assert.strictEqual(item.provider_id, 5);
    assert.strictEqual(item.provider_name, 'Western Tours');
    assert.strictEqual(item.availability_id, 12);
    assert.strictEqual(item.available_date, '2026-11-20');
    assert.strictEqual(item.travelers, 3);
    assert.strictEqual(item.total_amount, 24000);
    assert.strictEqual(item.booking_status, 'CONFIRMED');
    assert.strictEqual(item.payment_status, 'PAID');
    assert.strictEqual(typeof item.booked_at, 'string');
  });

  it('handles empty database results gracefully', async () => {
    const { ctx } = makeAdminBookingsContext({
      count: 0,
      rows: []
    });

    const res = await adminBookingsRoute.handler(ctx);
    assert.deepEqual(res.data, []);
    assert.deepEqual(res.meta, {
      page: 1,
      pageSize: 10,
      total: 0
    });
  });
});
