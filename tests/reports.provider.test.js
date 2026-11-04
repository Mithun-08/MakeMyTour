'use strict';
/**
 * tests/reports.provider.test.js
 *
 * Comprehensive unit and integration tests for:
 *   GET /api/provider/reports
 *
 * Requirements:
 *   - Access: strictly PROVIDER role only (CUSTOMER, ADMIN, unauthenticated rejected).
 *   - Provider-isolated: derived strictly from ctx.user.user_id.
 *   - Aggregates:
 *       total_earnings: sum of bookings.total_amount where payment_status = 'PAID'.
 *       total_bookings: sum of all bookings on provider packages.
 *       total_travelers: sum of all travelers on provider packages.
 *       packages[]: { package_id, title, bookings, travelers, earnings, avg_rating, review_count }
 *   - Handles 0 packages safely (empty array, 0 totals).
 *   - Handles 0 bookings safely (zeros for package metrics).
 *   - Handles 0 reviews safely (avg_rating: null, review_count: 0).
 *   - Avoids Cartesian product or double counting between bookings and reviews.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const routes = require('../server/routes/reports.routes');
const { HttpError } = require('../server/utils/http');

const providerReportsRoute = routes.find(
  r => r.method === 'GET' && r.path === '/api/provider/reports'
);

describe('GET /api/provider/reports — Registration & Structure', () => {
  it('route is properly registered in reports.routes.js', () => {
    assert.ok(providerReportsRoute, 'GET /api/provider/reports must be registered');
    assert.equal(providerReportsRoute.method, 'GET');
    assert.equal(providerReportsRoute.path, '/api/provider/reports');
    assert.deepEqual(providerReportsRoute.roles, ['PROVIDER']);
    assert.equal(typeof providerReportsRoute.handler, 'function');
  });
});

describe('GET /api/provider/reports — Authentication & RBAC', () => {
  it('rejects unauthenticated caller with 401 UNAUTHENTICATED', async () => {
    const ctx = {
      user: null,
      db: { query: async () => [] }
    };
    await assert.rejects(
      async () => providerReportsRoute.handler(ctx),
      (err) => {
        assert.equal(err.status, 401);
        assert.equal(err.code, 'UNAUTHENTICATED');
        return true;
      }
    );
  });

  it('rejects CUSTOMER role with 403 FORBIDDEN', async () => {
    const ctx = {
      user: { user_id: 10, role: 'CUSTOMER' },
      db: { query: async () => [] }
    };
    await assert.rejects(
      async () => providerReportsRoute.handler(ctx),
      (err) => {
        assert.equal(err.status, 403);
        assert.equal(err.code, 'FORBIDDEN');
        return true;
      }
    );
  });

  it('rejects ADMIN role with 403 FORBIDDEN', async () => {
    const ctx = {
      user: { user_id: 2, role: 'ADMIN', permissions: ['VIEW_REPORTS'] },
      db: { query: async () => [] }
    };
    await assert.rejects(
      async () => providerReportsRoute.handler(ctx),
      (err) => {
        assert.equal(err.status, 403);
        assert.equal(err.code, 'FORBIDDEN');
        return true;
      }
    );
  });

  it('rejects SUPER_ADMIN role with 403 FORBIDDEN (strictly PROVIDER only)', async () => {
    const ctx = {
      user: { user_id: 1, role: 'SUPER_ADMIN' },
      db: { query: async () => [] }
    };
    await assert.rejects(
      async () => providerReportsRoute.handler(ctx),
      (err) => {
        assert.equal(err.status, 403);
        assert.equal(err.code, 'FORBIDDEN');
        return true;
      }
    );
  });

  it('allows authenticated PROVIDER', async () => {
    const ctx = {
      user: { user_id: 5, role: 'PROVIDER' },
      db: { query: async () => [] }
    };
    const res = await providerReportsRoute.handler(ctx);
    assert.ok(res.data);
    assert.equal(res.data.total_earnings, 0);
    assert.equal(res.data.total_bookings, 0);
    assert.equal(res.data.total_travelers, 0);
    assert.deepEqual(res.data.packages, []);
  });
});

describe('GET /api/provider/reports — Data Aggregation & Logic', () => {
  it('isolates data strictly by ctx.user.user_id parameter in DB query', async () => {
    let capturedParams = null;
    let capturedSql = null;

    const ctx = {
      user: { user_id: 42, role: 'PROVIDER' },
      db: {
        query: async (sql, params) => {
          capturedSql = sql;
          capturedParams = params;
          return [];
        }
      }
    };

    await providerReportsRoute.handler(ctx);

    assert.ok(capturedSql.includes('WHERE p.provider_id = ?'));
    assert.deepEqual(capturedParams, [42], 'Query must be parameterized with ctx.user.user_id');
  });

  it('handles provider with 0 packages safely', async () => {
    const ctx = {
      user: { user_id: 99, role: 'PROVIDER' },
      db: { query: async () => [] }
    };

    const res = await providerReportsRoute.handler(ctx);

    assert.deepEqual(res, {
      data: {
        total_earnings: 0,
        total_bookings: 0,
        total_travelers: 0,
        packages: []
      }
    });
  });

  it('handles packages with 0 bookings and 0 reviews gracefully', async () => {
    const ctx = {
      user: { user_id: 5, role: 'PROVIDER' },
      db: {
        query: async () => [
          {
            package_id: 10,
            title: 'New Desert Safari',
            bookings: 0,
            travelers: 0,
            earnings: 0,
            avg_rating: null,
            review_count: 0
          }
        ]
      }
    };

    const res = await providerReportsRoute.handler(ctx);

    assert.equal(res.data.total_earnings, 0);
    assert.equal(res.data.total_bookings, 0);
    assert.equal(res.data.total_travelers, 0);
    assert.equal(res.data.packages.length, 1);

    const pkg = res.data.packages[0];
    assert.equal(pkg.package_id, 10);
    assert.equal(pkg.title, 'New Desert Safari');
    assert.equal(pkg.bookings, 0);
    assert.equal(pkg.travelers, 0);
    assert.equal(pkg.earnings, 0);
    assert.equal(pkg.avg_rating, null);
    assert.equal(pkg.review_count, 0);
  });

  it('accurately aggregates paid earnings, bookings, travelers, and reviews across multiple packages', async () => {
    const ctx = {
      user: { user_id: 5, role: 'PROVIDER' },
      db: {
        query: async () => [
          {
            package_id: 1,
            title: 'Goa Beach Party',
            bookings: 5,
            travelers: 12,
            earnings: 36000.00,
            avg_rating: 4.6,
            review_count: 3
          },
          {
            package_id: 2,
            title: 'Himalayan Trek',
            bookings: 3,
            travelers: 6,
            earnings: 45000.50,
            avg_rating: 4.9,
            review_count: 5
          },
          {
            package_id: 3,
            title: 'Kerala Backwaters',
            bookings: 0,
            travelers: 0,
            earnings: 0,
            avg_rating: null,
            review_count: 0
          }
        ]
      }
    };

    const res = await providerReportsRoute.handler(ctx);

    // total_earnings: 36000.00 + 45000.50 = 81000.5
    assert.equal(res.data.total_earnings, 81000.5);
    // total_bookings: 5 + 3 + 0 = 8
    assert.equal(res.data.total_bookings, 8);
    // total_travelers: 12 + 6 + 0 = 18
    assert.equal(res.data.total_travelers, 18);

    assert.equal(res.data.packages.length, 3);

    // Package 1
    assert.deepEqual(res.data.packages[0], {
      package_id: 1,
      title: 'Goa Beach Party',
      bookings: 5,
      travelers: 12,
      earnings: 36000,
      avg_rating: 4.6,
      review_count: 3
    });

    // Package 2
    assert.deepEqual(res.data.packages[1], {
      package_id: 2,
      title: 'Himalayan Trek',
      bookings: 3,
      travelers: 6,
      earnings: 45000.5,
      avg_rating: 4.9,
      review_count: 5
    });

    // Package 3 (unbooked & unreviewed)
    assert.deepEqual(res.data.packages[2], {
      package_id: 3,
      title: 'Kerala Backwaters',
      bookings: 0,
      travelers: 0,
      earnings: 0,
      avg_rating: null,
      review_count: 0
    });
  });

  it('coerces database string and null returns properly to numeric types', async () => {
    const ctx = {
      user: { user_id: 5, role: 'PROVIDER' },
      db: {
        query: async () => [
          {
            package_id: '7',
            title: 'Coorg Coffee Estates',
            bookings: '4',
            travelers: '8',
            earnings: '15400.00',
            avg_rating: '4.2',
            review_count: '2'
          }
        ]
      }
    };

    const res = await providerReportsRoute.handler(ctx);
    const pkg = res.data.packages[0];

    assert.strictEqual(pkg.package_id, 7);
    assert.strictEqual(pkg.bookings, 4);
    assert.strictEqual(pkg.travelers, 8);
    assert.strictEqual(pkg.earnings, 15400);
    assert.strictEqual(pkg.avg_rating, 4.2);
    assert.strictEqual(pkg.review_count, 2);

    assert.strictEqual(res.data.total_earnings, 15400);
    assert.strictEqual(res.data.total_bookings, 4);
    assert.strictEqual(res.data.total_travelers, 8);
  });

  it('verifies SQL query structure ensures revenue counts PAID only and prevents Cartesian product', async () => {
    let capturedSql = '';
    const ctx = {
      user: { user_id: 5, role: 'PROVIDER' },
      db: {
        query: async (sql) => {
          capturedSql = sql;
          return [];
        }
      }
    };

    await providerReportsRoute.handler(ctx);

    // Verify revenue definition: CASE WHEN payment_status = 'PAID' THEN total_amount ELSE 0 END
    assert.ok(
      capturedSql.includes("payment_status = 'PAID'"),
      'SQL must restrict earnings to payment_status = PAID'
    );

    // Verify subqueries prevent Cartesian explosion
    assert.ok(
      capturedSql.includes('LEFT JOIN (') && capturedSql.includes('GROUP BY package_id'),
      'SQL must pre-aggregate bookings and reviews in grouped subqueries'
    );
  });
});
