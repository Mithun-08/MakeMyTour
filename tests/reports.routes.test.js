'use strict';
/**
 * tests/reports.routes.test.js — Owner: M3
 *
 * Comprehensive offline unit tests for:
 *   GET /api/admin/stats
 *   GET /api/admin/reports/revenue
 *   GET /api/admin/reports/bookings
 *   GET /api/customer/reports
 *
 * Uses Node's built-in node:test + node:assert/strict.
 * Sourced strictly from docs/CONTRACT.md and database/schema.sql.
 *
 * Run: node --test tests/reports.routes.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const routes = require('../server/routes/reports.routes');

const adminStatsRoute = routes.find(
  r => r.method === 'GET' && r.path === '/api/admin/stats'
);
const adminRevenueRoute = routes.find(
  r => r.method === 'GET' && r.path === '/api/admin/reports/revenue'
);
const adminBookingsRoute = routes.find(
  r => r.method === 'GET' && r.path === '/api/admin/reports/bookings'
);
const customerReportsRoute = routes.find(
  r => r.method === 'GET' && r.path === '/api/customer/reports'
);

describe('M3 Day 6: Reports & Revenue Routes — Registration', () => {
  it('exports an array containing all 4 required reporting routes', () => {
    assert.ok(Array.isArray(routes), 'Route module must export an array');
    assert.equal(routes.length, 4, 'Route module must export exactly 4 routes');
  });

  it('declares GET /api/admin/stats with ADMIN role and VIEW_REPORTS permission', () => {
    assert.ok(adminStatsRoute, 'Route must exist');
    assert.deepEqual(adminStatsRoute.roles, ['ADMIN']);
    assert.equal(adminStatsRoute.permission, 'VIEW_REPORTS');
    assert.equal(typeof adminStatsRoute.handler, 'function');
  });

  it('declares GET /api/admin/reports/revenue with ADMIN role and VIEW_REPORTS permission', () => {
    assert.ok(adminRevenueRoute, 'Route must exist');
    assert.deepEqual(adminRevenueRoute.roles, ['ADMIN']);
    assert.equal(adminRevenueRoute.permission, 'VIEW_REPORTS');
    assert.equal(typeof adminRevenueRoute.handler, 'function');
  });

  it('declares GET /api/admin/reports/bookings with ADMIN role and VIEW_REPORTS permission', () => {
    assert.ok(adminBookingsRoute, 'Route must exist');
    assert.deepEqual(adminBookingsRoute.roles, ['ADMIN']);
    assert.equal(adminBookingsRoute.permission, 'VIEW_REPORTS');
    assert.equal(typeof adminBookingsRoute.handler, 'function');
  });

  it('declares GET /api/customer/reports with CUSTOMER role', () => {
    assert.ok(customerReportsRoute, 'Route must exist');
    assert.deepEqual(customerReportsRoute.roles, ['CUSTOMER']);
    assert.equal(typeof customerReportsRoute.handler, 'function');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. GET /api/admin/stats Tests
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/admin/stats', () => {
  it('rejects unauthenticated caller with 403 FORBIDDEN', async () => {
    const ctx = {
      user: null,
      db: { query: async () => [] }
    };
    await assert.rejects(
      async () => adminStatsRoute.handler(ctx),
      (err) => {
        assert.equal(err.status, 403);
        assert.equal(err.code, 'FORBIDDEN');
        return true;
      }
    );
  });

  it('rejects CUSTOMER role with 403 FORBIDDEN', async () => {
    const ctx = {
      user: { user_id: 10, role: 'CUSTOMER', permissions: [] },
      db: { query: async () => [] }
    };
    await assert.rejects(
      async () => adminStatsRoute.handler(ctx),
      (err) => {
        assert.equal(err.status, 403);
        assert.equal(err.code, 'FORBIDDEN');
        return true;
      }
    );
  });

  it('rejects PROVIDER role with 403 FORBIDDEN', async () => {
    const ctx = {
      user: { user_id: 5, role: 'PROVIDER', permissions: [] },
      db: { query: async () => [] }
    };
    await assert.rejects(
      async () => adminStatsRoute.handler(ctx),
      (err) => {
        assert.equal(err.status, 403);
        assert.equal(err.code, 'FORBIDDEN');
        return true;
      }
    );
  });

  it('rejects ADMIN without VIEW_REPORTS permission with 403 FORBIDDEN', async () => {
    const ctx = {
      user: { user_id: 2, role: 'ADMIN', permissions: ['MANAGE_BOOKINGS', 'MODERATE_PACKAGES'] },
      db: { query: async () => [] }
    };
    await assert.rejects(
      async () => adminStatsRoute.handler(ctx),
      (err) => {
        assert.equal(err.status, 403);
        assert.equal(err.code, 'FORBIDDEN');
        assert.ok(err.message.includes('VIEW_REPORTS'));
        return true;
      }
    );
  });

  it('allows ADMIN with VIEW_REPORTS permission', async () => {
    const ctx = {
      user: { user_id: 2, role: 'ADMIN', permissions: ['VIEW_REPORTS'] },
      db: {
        query: async (sql) => {
          if (sql.includes('FROM users')) {
            return [{ total_customers: 20, total_providers: 5, pending_providers: 2 }];
          }
          if (sql.includes('FROM tour_packages')) {
            return [{ total_packages: 12, pending_packages: 3 }];
          }
          if (sql.includes('FROM bookings')) {
            return [{ total_bookings: 35, total_revenue: 157500, bookings_today: 4 }];
          }
          return [];
        }
      }
    };

    const res = await adminStatsRoute.handler(ctx);
    assert.ok(res.data);
    assert.deepEqual(res.data, {
      total_customers: 20,
      total_providers: 5,
      pending_providers: 2,
      total_packages: 12,
      pending_packages: 3,
      total_bookings: 35,
      total_revenue: 157500,
      bookings_today: 4
    });
  });

  it('allows ADMIN with wildcard permission (*)', async () => {
    const ctx = {
      user: { user_id: 2, role: 'ADMIN', permissions: ['*'] },
      db: {
        query: async () => [{}]
      }
    };
    const res = await adminStatsRoute.handler(ctx);
    assert.ok(res.data);
    assert.equal(typeof res.data.total_customers, 'number');
  });

  it('allows SUPER_ADMIN even without explicit permissions', async () => {
    const ctx = {
      user: { user_id: 1, role: 'SUPER_ADMIN', permissions: [] },
      db: {
        query: async (sql) => {
          if (sql.includes('FROM users')) {
            return [{ total_customers: 100, total_providers: 10, pending_providers: 1 }];
          }
          if (sql.includes('FROM tour_packages')) {
            return [{ total_packages: 50, pending_packages: 5 }];
          }
          if (sql.includes('FROM bookings')) {
            return [{ total_bookings: 80, total_revenue: 450000, bookings_today: 8 }];
          }
          return [];
        }
      }
    };

    const res = await adminStatsRoute.handler(ctx);
    assert.equal(res.data.total_customers, 100);
    assert.equal(res.data.total_providers, 10);
    assert.equal(res.data.pending_providers, 1);
    assert.equal(res.data.total_packages, 50);
    assert.equal(res.data.pending_packages, 5);
    assert.equal(res.data.total_bookings, 80);
    assert.equal(res.data.total_revenue, 450000);
    assert.equal(res.data.bookings_today, 8);
  });

  it('handles empty database tables gracefully with 0 defaults', async () => {
    const ctx = {
      user: { user_id: 1, role: 'SUPER_ADMIN' },
      db: {
        query: async () => []
      }
    };

    const res = await adminStatsRoute.handler(ctx);
    assert.deepEqual(res.data, {
      total_customers: 0,
      total_providers: 0,
      pending_providers: 0,
      total_packages: 0,
      pending_packages: 0,
      total_bookings: 0,
      total_revenue: 0,
      bookings_today: 0
    });
  });

  it('coerces string or null database aggregate returns to numbers', async () => {
    const ctx = {
      user: { user_id: 2, role: 'ADMIN', permissions: ['VIEW_REPORTS'] },
      db: {
        query: async (sql) => {
          if (sql.includes('FROM users')) {
            return [{ total_customers: '15', total_providers: '4', pending_providers: null }];
          }
          if (sql.includes('FROM tour_packages')) {
            return [{ total_packages: '8', pending_packages: '0' }];
          }
          if (sql.includes('FROM bookings')) {
            return [{ total_bookings: '25', total_revenue: '120000.00', bookings_today: '3' }];
          }
          return [];
        }
      }
    };

    const res = await adminStatsRoute.handler(ctx);
    assert.strictEqual(res.data.total_customers, 15);
    assert.strictEqual(res.data.total_providers, 4);
    assert.strictEqual(res.data.pending_providers, 0);
    assert.strictEqual(res.data.total_packages, 8);
    assert.strictEqual(res.data.pending_packages, 0);
    assert.strictEqual(res.data.total_bookings, 25);
    assert.strictEqual(res.data.total_revenue, 120000);
    assert.strictEqual(res.data.bookings_today, 3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. GET /api/admin/reports/revenue Tests
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/admin/reports/revenue', () => {
  it('rejects caller without VIEW_REPORTS permission with 403', async () => {
    const ctx = {
      user: { user_id: 2, role: 'ADMIN', permissions: ['MANAGE_USERS'] },
      query: {},
      db: { query: async () => [] }
    };
    await assert.rejects(
      async () => adminRevenueRoute.handler(ctx),
      (err) => {
        assert.equal(err.status, 403);
        assert.equal(err.code, 'FORBIDDEN');
        return true;
      }
    );
  });

  it('rejects invalid "from" date format with 400 VALIDATION_ERROR', async () => {
    const ctx = {
      user: { user_id: 1, role: 'SUPER_ADMIN' },
      query: { from: '2026/10/01' },
      db: { query: async () => [] }
    };
    await assert.rejects(
      async () => adminRevenueRoute.handler(ctx),
      (err) => {
        assert.equal(err.status, 400);
        assert.equal(err.code, 'VALIDATION_ERROR');
        assert.ok(err.details?.from);
        return true;
      }
    );
  });

  it('rejects invalid "to" date format with 400 VALIDATION_ERROR', async () => {
    const ctx = {
      user: { user_id: 1, role: 'SUPER_ADMIN' },
      query: { to: 'invalid-date' },
      db: { query: async () => [] }
    };
    await assert.rejects(
      async () => adminRevenueRoute.handler(ctx),
      (err) => {
        assert.equal(err.status, 400);
        assert.equal(err.code, 'VALIDATION_ERROR');
        assert.ok(err.details?.to);
        return true;
      }
    );
  });

  it('rejects invalid "group" parameter with 400 VALIDATION_ERROR', async () => {
    const ctx = {
      user: { user_id: 1, role: 'SUPER_ADMIN' },
      query: { group: 'yearly' },
      db: { query: async () => [] }
    };
    await assert.rejects(
      async () => adminRevenueRoute.handler(ctx),
      (err) => {
        assert.equal(err.status, 400);
        assert.equal(err.code, 'VALIDATION_ERROR');
        assert.ok(err.details?.group);
        return true;
      }
    );
  });

  it('defaults to daily grouping and only counts PAID bookings', async () => {
    let capturedSql = null;
    let capturedParams = null;

    const ctx = {
      user: { user_id: 2, role: 'ADMIN', permissions: ['VIEW_REPORTS'] },
      query: {},
      db: {
        query: async (sql, params) => {
          capturedSql = sql;
          capturedParams = params;
          return [
            { period: '2026-10-25', bookings: 2, revenue: 12000 },
            { period: '2026-10-26', bookings: 5, revenue: 35000 }
          ];
        }
      }
    };

    const res = await adminRevenueRoute.handler(ctx);
    assert.ok(capturedSql.includes("b.payment_status = 'PAID'"), 'Must filter by payment_status = PAID');
    assert.ok(capturedSql.includes("DATE_FORMAT(b.booked_at, '%Y-%m-%d')"), 'Default must be day format');
    assert.deepEqual(capturedParams, []);
    assert.deepEqual(res.data, [
      { period: '2026-10-25', bookings: 2, revenue: 12000 },
      { period: '2026-10-26', bookings: 5, revenue: 35000 }
    ]);
  });

  it('supports monthly grouping when group=month is passed', async () => {
    let capturedSql = null;

    const ctx = {
      user: { user_id: 1, role: 'SUPER_ADMIN' },
      query: { group: 'month' },
      db: {
        query: async (sql) => {
          capturedSql = sql;
          return [
            { period: '2026-09', bookings: 14, revenue: 110000 },
            { period: '2026-10', bookings: 22, revenue: 185000 }
          ];
        }
      }
    };

    const res = await adminRevenueRoute.handler(ctx);
    assert.ok(capturedSql.includes("DATE_FORMAT(b.booked_at, '%Y-%m')"), 'Month grouping must format as %Y-%m');
    assert.deepEqual(res.data, [
      { period: '2026-09', bookings: 14, revenue: 110000 },
      { period: '2026-10', bookings: 22, revenue: 185000 }
    ]);
  });

  it('filters by date range with parameterized queries', async () => {
    let capturedSql = null;
    let capturedParams = null;

    const ctx = {
      user: { user_id: 1, role: 'SUPER_ADMIN' },
      query: { from: '2026-10-01', to: '2026-10-31', group: 'day' },
      db: {
        query: async (sql, params) => {
          capturedSql = sql;
          capturedParams = params;
          return [];
        }
      }
    };

    const res = await adminRevenueRoute.handler(ctx);
    assert.ok(capturedSql.includes('DATE(b.booked_at) >= ?'));
    assert.ok(capturedSql.includes('DATE(b.booked_at) <= ?'));
    assert.deepEqual(capturedParams, ['2026-10-01', '2026-10-31']);
    assert.deepEqual(res.data, []);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. GET /api/admin/reports/bookings Tests
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/admin/reports/bookings', () => {
  it('rejects caller without VIEW_REPORTS permission with 403', async () => {
    const ctx = {
      user: { user_id: 2, role: 'ADMIN', permissions: [] },
      db: { query: async () => [] }
    };
    await assert.rejects(
      async () => adminBookingsRoute.handler(ctx),
      (err) => {
        assert.equal(err.status, 403);
        assert.equal(err.code, 'FORBIDDEN');
        return true;
      }
    );
  });

  it('returns by_status, top_packages, top_destinations, and by_category', async () => {
    const ctx = {
      user: { user_id: 2, role: 'ADMIN', permissions: ['VIEW_REPORTS'] },
      db: {
        query: async (sql) => {
          if (sql.includes('GROUP BY booking_status')) {
            return [
              { status: 'CONFIRMED', count: '15' },
              { status: 'PENDING', count: '5' },
              { status: 'CANCELLED', count: '2' }
            ];
          }
          if (sql.includes('GROUP BY p.package_id, p.title')) {
            return [
              { package_id: '1', title: 'Manali Snow Trek', booking_count: '10', total_revenue: '75000' },
              { package_id: '2', title: 'Goa Beach Party', booking_count: '8', total_revenue: '48000' }
            ];
          }
          if (sql.includes('JOIN destinations d')) {
            return [
              { destination_id: '3', name: 'Manali', city: 'Kullu', state: 'Himachal Pradesh', booking_count: '10' },
              { destination_id: '4', name: 'Goa', city: 'Panaji', state: 'Goa', booking_count: '8' }
            ];
          }
          if (sql.includes('JOIN categories c')) {
            return [
              { category_id: '1', category_name: 'Adventure', booking_count: '12' },
              { category_id: '2', category_name: 'Beach', booking_count: '8' }
            ];
          }
          return [];
        }
      }
    };

    const res = await adminBookingsRoute.handler(ctx);
    assert.ok(res.data);
    assert.deepEqual(res.data.by_status, [
      { status: 'CONFIRMED', count: 15 },
      { status: 'PENDING', count: 5 },
      { status: 'CANCELLED', count: 2 }
    ]);
    assert.deepEqual(res.data.top_packages, [
      { package_id: 1, title: 'Manali Snow Trek', booking_count: 10, total_revenue: 75000 },
      { package_id: 2, title: 'Goa Beach Party', booking_count: 8, total_revenue: 48000 }
    ]);
    assert.deepEqual(res.data.top_destinations, [
      { destination_id: 3, name: 'Manali', city: 'Kullu', state: 'Himachal Pradesh', booking_count: 8 },
      { destination_id: 4, name: 'Goa', city: 'Panaji', state: 'Goa', booking_count: 8 }
    ].map((item, idx) => idx === 0 ? { ...item, booking_count: 10 } : item));
    assert.deepEqual(res.data.by_category, [
      { category_id: 1, category_name: 'Adventure', booking_count: 12 },
      { category_id: 2, category_name: 'Beach', booking_count: 8 }
    ]);
  });

  it('limits top packages and top destinations to maximum 5 items', async () => {
    let packagesLimitSql = false;
    let destinationsLimitSql = false;

    const ctx = {
      user: { user_id: 1, role: 'SUPER_ADMIN' },
      db: {
        query: async (sql) => {
          if (sql.includes('GROUP BY p.package_id, p.title')) {
            if (sql.includes('LIMIT 5')) packagesLimitSql = true;
            return [];
          }
          if (sql.includes('JOIN destinations d')) {
            if (sql.includes('LIMIT 5')) destinationsLimitSql = true;
            return [];
          }
          return [];
        }
      }
    };

    await adminBookingsRoute.handler(ctx);
    assert.ok(packagesLimitSql, 'top_packages query must have LIMIT 5');
    assert.ok(destinationsLimitSql, 'top_destinations query must have LIMIT 5');
  });

  it('handles empty database gracefully with empty arrays', async () => {
    const ctx = {
      user: { user_id: 1, role: 'SUPER_ADMIN' },
      db: { query: async () => [] }
    };

    const res = await adminBookingsRoute.handler(ctx);
    assert.deepEqual(res.data, {
      by_status: [],
      top_packages: [],
      top_destinations: [],
      by_category: []
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. GET /api/customer/reports Tests
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/customer/reports', () => {
  it('rejects unauthenticated caller with 403 FORBIDDEN', async () => {
    const ctx = {
      user: null,
      db: { query: async () => [] }
    };
    await assert.rejects(
      async () => customerReportsRoute.handler(ctx),
      (err) => {
        assert.equal(err.status, 403);
        assert.equal(err.code, 'FORBIDDEN');
        return true;
      }
    );
  });

  it('rejects non-CUSTOMER roles (ADMIN, PROVIDER) with 403 FORBIDDEN', async () => {
    for (const role of ['ADMIN', 'SUPER_ADMIN', 'PROVIDER']) {
      const ctx = {
        user: { user_id: 1, role },
        db: { query: async () => [] }
      };
      await assert.rejects(
        async () => customerReportsRoute.handler(ctx),
        (err) => {
          assert.equal(err.status, 403);
          assert.equal(err.code, 'FORBIDDEN');
          return true;
        }
      );
    }
  });

  it('isolates queries exclusively to authenticated ctx.user.user_id', async () => {
    const customerId = 42;
    const customerIdParams = [];

    const ctx = {
      user: { user_id: customerId, role: 'CUSTOMER' },
      db: {
        query: async (sql, params = []) => {
          customerIdParams.push(...params);
          if (sql.includes('COUNT(*) AS total_bookings')) {
            return [{ total_bookings: 3, total_spent: 24000 }];
          }
          if (sql.includes('GROUP BY booking_status')) {
            return [
              { status: 'CONFIRMED', count: 2 },
              { status: 'COMPLETED', count: 1 }
            ];
          }
          if (sql.includes('a.available_date >= CURDATE()')) {
            return [
              {
                booking_id: 101,
                package_id: 5,
                travelers: 2,
                total_amount: 16000,
                booking_status: 'CONFIRMED',
                payment_status: 'PAID',
                package_title: 'Ooty Tea Garden Tour',
                package_image: '/images/ooty.jpg',
                available_date: '2026-11-20'
              }
            ];
          }
          return [];
        }
      }
    };

    const res = await customerReportsRoute.handler(ctx);
    // Verify customerId was used in all 3 queries
    assert.equal(customerIdParams.length, 3);
    assert.ok(customerIdParams.every(id => id === customerId), 'Every query must filter strictly by customer_id');

    assert.deepEqual(res.data, {
      total_bookings: 3,
      total_spent: 24000,
      by_status: [
        { status: 'CONFIRMED', count: 2 },
        { status: 'COMPLETED', count: 1 }
      ],
      upcoming: [
        {
          booking_id: 101,
          package_id: 5,
          package_title: 'Ooty Tea Garden Tour',
          package_image: '/images/ooty.jpg',
          available_date: '2026-11-20',
          travelers: 2,
          total_amount: 16000,
          booking_status: 'CONFIRMED',
          payment_status: 'PAID'
        }
      ]
    });
  });

  it('correctly handles Date object for available_date in upcoming bookings', async () => {
    const ctx = {
      user: { user_id: 7, role: 'CUSTOMER' },
      db: {
        query: async (sql) => {
          if (sql.includes('a.available_date >= CURDATE()')) {
            return [
              {
                booking_id: 202,
                package_id: 9,
                travelers: 1,
                total_amount: 5000,
                booking_status: 'PENDING',
                payment_status: 'UNPAID',
                package_title: 'Munnar Hills',
                package_image: null,
                available_date: new Date('2026-12-05T00:00:00.000Z')
              }
            ];
          }
          return [];
        }
      }
    };

    const res = await customerReportsRoute.handler(ctx);
    assert.equal(res.data.upcoming.length, 1);
    assert.equal(res.data.upcoming[0].available_date, '2026-12-05');
    assert.equal(res.data.upcoming[0].package_image, null);
  });

  it('handles empty customer history gracefully with 0 totals and empty arrays', async () => {
    const ctx = {
      user: { user_id: 99, role: 'CUSTOMER' },
      db: {
        query: async () => []
      }
    };

    const res = await customerReportsRoute.handler(ctx);
    assert.deepEqual(res.data, {
      total_bookings: 0,
      total_spent: 0,
      by_status: [],
      upcoming: []
    });
  });
});
