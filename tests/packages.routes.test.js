/**
 * tests/packages.routes.test.js — Owner: M2
 * Focused tests for Public Package APIs:
 *   - GET /api/packages
 *   - GET /api/packages/:id
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const routes = require('../server/routes/packages.routes');
const { HttpError } = require('../server/utils/http');

const listRoute = routes.find(r => r.method === 'GET' && r.path === '/api/packages');
const detailRoute = routes.find(r => r.method === 'GET' && r.path === '/api/packages/:id');

describe('Packages Routes — Registration & Public Access', () => {
  it('packages.routes.js exports an array of 2 public routes', () => {
    assert.ok(Array.isArray(routes));
    assert.equal(routes.length, 2);
  });

  it('GET /api/packages is public (no roles or permissions required)', () => {
    assert.ok(listRoute);
    assert.equal(listRoute.roles, undefined);
    assert.equal(listRoute.permission, undefined);
    assert.equal(typeof listRoute.handler, 'function');
  });

  it('GET /api/packages/:id is public (no roles or permissions required)', () => {
    assert.ok(detailRoute);
    assert.equal(detailRoute.roles, undefined);
    assert.equal(detailRoute.permission, undefined);
    assert.equal(typeof detailRoute.handler, 'function');
  });
});

describe('GET /api/packages — Listing & Filtering', () => {
  it('returns approved packages with expected row shape and pagination meta', async () => {
    let countSql = '';
    let selectSql = '';
    let selectParams = [];

    const mockPackageRows = [
      {
        package_id: 1,
        title: 'Munnar Misty Escape',
        image: 'munnar-leisure.jpg',
        price: '8500.00',
        duration_days: 4,
        destination_id: 1,
        destination_name: 'Munnar Hill Station',
        city: 'Munnar',
        state: 'Kerala',
        category_id: 5,
        category_name: 'Leisure',
        provider_id: 4,
        provider_name: 'Ravi Kumar',
        avg_rating: '4.5',
        review_count: '2',
        next_available_date: '2026-11-07'
      }
    ];

    const ctx = {
      query: {},
      db: {
        query: async (sql, params) => {
          if (sql.includes('COUNT(*) AS total')) {
            countSql = sql;
            return [{ total: 1 }];
          }
          selectSql = sql;
          selectParams = params;
          return mockPackageRows;
        }
      }
    };

    const result = await listRoute.handler(ctx);

    assert.ok(Array.isArray(result.data));
    assert.equal(result.data.length, 1);

    const pkg = result.data[0];
    assert.equal(pkg.package_id, 1);
    assert.equal(pkg.title, 'Munnar Misty Escape');
    assert.equal(pkg.image, 'munnar-leisure.jpg');
    assert.strictEqual(typeof pkg.price, 'number');
    assert.equal(pkg.price, 8500);
    assert.strictEqual(typeof pkg.duration_days, 'number');
    assert.equal(pkg.duration_days, 4);
    assert.equal(pkg.destination_id, 1);
    assert.equal(pkg.destination_name, 'Munnar Hill Station');
    assert.equal(pkg.city, 'Munnar');
    assert.equal(pkg.state, 'Kerala');
    assert.equal(pkg.category_id, 5);
    assert.equal(pkg.category_name, 'Leisure');
    assert.equal(pkg.provider_id, 4);
    assert.equal(pkg.provider_name, 'Ravi Kumar');
    assert.strictEqual(typeof pkg.avg_rating, 'number');
    assert.equal(pkg.avg_rating, 4.5);
    assert.strictEqual(typeof pkg.review_count, 'number');
    assert.equal(pkg.review_count, 2);
    assert.equal(pkg.next_available_date, '2026-11-07');

    assert.deepEqual(result.meta, { page: 1, pageSize: 10, total: 1 });
    assert.ok(countSql.includes("p.status = 'APPROVED'"));
    assert.ok(selectSql.includes("p.status = 'APPROVED'"));
    assert.deepEqual(selectParams, [10, 0]); // pageSize, offset
  });

  it('filters by keyword search (q) across title, destination, category', async () => {
    let capturedParams = [];

    const ctx = {
      query: { q: 'Trek' },
      db: {
        query: async (sql, params) => {
          if (sql.includes('COUNT(*) AS total')) return [{ total: 1 }];
          capturedParams = params;
          return [];
        }
      }
    };

    await listRoute.handler(ctx);

    assert.equal(capturedParams[0], '%Trek%');
    assert.equal(capturedParams[1], '%Trek%');
    assert.equal(capturedParams[2], '%Trek%');
    assert.equal(capturedParams[3], '%Trek%');
    assert.equal(capturedParams[4], '%Trek%');
  });

  it('filters by destination_id and category_id', async () => {
    let capturedSql = '';
    let capturedParams = [];

    const ctx = {
      query: { destination_id: '1', category_id: '5' },
      db: {
        query: async (sql, params) => {
          if (sql.includes('COUNT(*) AS total')) return [{ total: 1 }];
          capturedSql = sql;
          capturedParams = params;
          return [];
        }
      }
    };

    await listRoute.handler(ctx);

    assert.ok(capturedSql.includes('p.destination_id = ?'));
    assert.ok(capturedSql.includes('p.category_id = ?'));
    assert.equal(capturedParams[0], 1);
    assert.equal(capturedParams[1], 5);
  });

  it('filters by price range (min_price, max_price)', async () => {
    let capturedSql = '';
    let capturedParams = [];

    const ctx = {
      query: { min_price: '5000', max_price: '10000' },
      db: {
        query: async (sql, params) => {
          if (sql.includes('COUNT(*) AS total')) return [{ total: 1 }];
          capturedSql = sql;
          capturedParams = params;
          return [];
        }
      }
    };

    await listRoute.handler(ctx);

    assert.ok(capturedSql.includes('p.price >= ?'));
    assert.ok(capturedSql.includes('p.price <= ?'));
    assert.equal(capturedParams[0], 5000);
    assert.equal(capturedParams[1], 10000);
  });

  it('filters by duration range (min_days, max_days)', async () => {
    let capturedSql = '';
    let capturedParams = [];

    const ctx = {
      query: { min_days: '3', max_days: '5' },
      db: {
        query: async (sql, params) => {
          if (sql.includes('COUNT(*) AS total')) return [{ total: 1 }];
          capturedSql = sql;
          capturedParams = params;
          return [];
        }
      }
    };

    await listRoute.handler(ctx);

    assert.ok(capturedSql.includes('p.duration_days >= ?'));
    assert.ok(capturedSql.includes('p.duration_days <= ?'));
    assert.equal(capturedParams[0], 3);
    assert.equal(capturedParams[1], 5);
  });

  it('filters by date for packages with OPEN availability on or after date', async () => {
    let capturedSql = '';
    let capturedParams = [];

    const ctx = {
      query: { date: '2026-11-15' },
      db: {
        query: async (sql, params) => {
          if (sql.includes('COUNT(*) AS total')) return [{ total: 1 }];
          capturedSql = sql;
          capturedParams = params;
          return [];
        }
      }
    };

    await listRoute.handler(ctx);

    assert.ok(capturedSql.includes('package_availability'));
    assert.ok(capturedSql.includes("pa.status = 'OPEN'"));
    assert.ok(capturedSql.includes('pa.available_date >= ?'));
    assert.equal(capturedParams[0], '2026-11-15');
  });

  it('supports sorting by price_asc, price_desc, newest, rating, duration', async () => {
    const sortCases = [
      { sort: 'price_asc',  expected: 'p.price ASC' },
      { sort: 'price_desc', expected: 'p.price DESC' },
      { sort: 'newest',     expected: 'p.created_at DESC' },
      { sort: 'rating',     expected: 'avg_rating DESC' },
      { sort: 'duration',   expected: 'p.duration_days ASC' }
    ];

    for (const sc of sortCases) {
      let capturedSql = '';
      const ctx = {
        query: { sort: sc.sort },
        db: {
          query: async (sql) => {
            if (sql.includes('COUNT(*) AS total')) return [{ total: 0 }];
            capturedSql = sql;
            return [];
          }
        }
      };

      await listRoute.handler(ctx);
      assert.ok(capturedSql.includes(sc.expected), `SQL must order by ${sc.expected} for sort=${sc.sort}`);
    }
  });

  it('supports pagination with custom page and pageSize (max 50)', async () => {
    let capturedParams = [];

    const ctx = {
      query: { page: '2', pageSize: '60' },
      db: {
        query: async (sql, params) => {
          if (sql.includes('COUNT(*) AS total')) return [{ total: 100 }];
          capturedParams = params;
          return [];
        }
      }
    };

    const result = await listRoute.handler(ctx);

    assert.equal(result.meta.page, 2);
    assert.equal(result.meta.pageSize, 50);
    assert.equal(result.meta.total, 100);
    assert.deepEqual(capturedParams, [50, 50]);
  });

  it('rejects invalid query parameters with 400 VALIDATION_ERROR', async () => {
    const invalidCases = [
      { query: { q: 'x'.repeat(101) }, desc: 'q too long' },
      { query: { destination_id: '-1' }, desc: 'negative destination_id' },
      { query: { destination_id: 'abc' }, desc: 'non-numeric destination_id' },
      { query: { category_id: '0' }, desc: 'zero category_id' },
      { query: { min_price: '-50' }, desc: 'negative min_price' },
      { query: { min_price: '100', max_price: '50' }, desc: 'min_price > max_price' },
      { query: { min_days: '0' }, desc: 'min_days < 1' },
      { query: { min_days: '5', max_days: '2' }, desc: 'min_days > max_days' },
      { query: { date: 'invalid-date' }, desc: 'invalid date format' },
      { query: { sort: 'hack_injection' }, desc: 'disallowed sort option' },
      { query: { page: '0' }, desc: 'page < 1' },
      { query: { pageSize: '-10' }, desc: 'pageSize < 1' }
    ];

    for (const tc of invalidCases) {
      const ctx = { query: tc.query, db: {} };
      await assert.rejects(
        () => listRoute.handler(ctx),
        (err) => err instanceof HttpError && err.status === 400 && err.code === 'VALIDATION_ERROR',
        `Should reject: ${tc.desc}`
      );
    }
  });
});

describe('GET /api/packages/:id — Package Details', () => {
  it('returns full package details including itinerary, availability and rating', async () => {
    const mockPackage = {
      package_id: 1,
      title: 'Munnar Misty Escape',
      description: 'A rejuvenating 4-day break',
      inclusions: 'Hotel stay (3 nights)\nBreakfast and dinner\nAC transfers',
      exclusions: 'Airfare\nLunch\nAlcohol',
      duration_days: 4,
      price: '8500.00',
      capacity: 20,
      image: 'munnar-leisure.jpg',
      status: 'APPROVED',
      created_at: new Date('2026-10-25T10:00:00Z'),
      destination_id: 1,
      destination_name: 'Munnar Hill Station',
      destination_city: 'Munnar',
      destination_state: 'Kerala',
      destination_country: 'India',
      destination_description: 'Scenic hill station',
      category_id: 5,
      category_name: 'Leisure',
      category_description: 'Relaxed sightseeing',
      provider_id: 4,
      provider_name: 'Ravi Kumar',
      provider_email: 'ravi@test.com',
      provider_mobile: '9876543210',
      provider_city: 'Munnar',
      provider_state: 'Kerala'
    };

    const mockItinerary = [
      { day_no: 1, title: 'Arrival in Munnar', description: 'Check-in and evening walk' },
      { day_no: 2, title: 'Tea Gardens', description: 'Guided tea factory visit' }
    ];

    const mockAvailability = [
      { availability_id: 1, available_date: '2026-11-07', seats_available: 20, status: 'OPEN' },
      { availability_id: 2, available_date: '2026-11-14', seats_available: 15, status: 'OPEN' }
    ];

    const mockRating = [{ avg: '4.8', count: 12 }];

    const ctx = {
      params: { id: '1' },
      db: {
        query: async (sql) => {
          if (sql.includes('FROM tour_packages')) return [mockPackage];
          if (sql.includes('FROM package_itinerary')) return mockItinerary;
          if (sql.includes('FROM package_availability')) return mockAvailability;
          if (sql.includes('FROM reviews')) return mockRating;
          return [];
        }
      }
    };

    const result = await detailRoute.handler(ctx);
    const data = result.data;

    assert.equal(data.package_id, 1);
    assert.equal(data.title, 'Munnar Misty Escape');
    assert.equal(data.price, 8500);
    assert.equal(data.duration_days, 4);

    assert.deepEqual(data.inclusions, [
      'Hotel stay (3 nights)',
      'Breakfast and dinner',
      'AC transfers'
    ]);
    assert.deepEqual(data.exclusions, ['Airfare', 'Lunch', 'Alcohol']);

    assert.equal(data.destination.name, 'Munnar Hill Station');
    assert.equal(data.destination.state, 'Kerala');
    assert.equal(data.category.name, 'Leisure');
    assert.equal(data.provider.user_id, 4);
    assert.equal(data.provider.name, 'Ravi Kumar');
    assert.equal(data.provider.city, 'Munnar');

    assert.equal(data.itinerary.length, 2);
    assert.equal(data.itinerary[0].day_no, 1);
    assert.equal(data.itinerary[0].title, 'Arrival in Munnar');

    assert.equal(data.availability.length, 2);
    assert.equal(data.availability[0].availability_id, 1);
    assert.equal(data.availability[0].available_date, '2026-11-07');
    assert.equal(data.availability[0].seats_available, 20);
    assert.equal(data.availability[0].status, 'OPEN');

    assert.equal(data.rating.avg, 4.8);
    assert.equal(data.rating.count, 12);
  });

  it('returns 404 for nonexistent package', async () => {
    const ctx = {
      params: { id: '999' },
      db: {
        query: async () => []
      }
    };

    await assert.rejects(
      () => detailRoute.handler(ctx),
      (err) => err instanceof HttpError && err.status === 404 && err.code === 'NOT_FOUND'
    );
  });

  it('returns 404 for invalid ID parameter', async () => {
    const ctx = {
      params: { id: 'abc' },
      db: {}
    };

    await assert.rejects(
      () => detailRoute.handler(ctx),
      (err) => err instanceof HttpError && err.status === 404 && err.code === 'NOT_FOUND'
    );
  });

  it('returns 404 for non-approved package to public visitors', async () => {
    const mockDisabledPackage = {
      package_id: 10,
      title: 'Disabled Package',
      status: 'DISABLED',
      provider_id: 4
    };

    // Case 1: unauthenticated visitor
    const publicCtx = {
      params: { id: '10' },
      user: null,
      db: {
        query: async (sql) => {
          if (sql.includes('FROM tour_packages')) return [mockDisabledPackage];
          return [];
        }
      }
    };

    await assert.rejects(
      () => detailRoute.handler(publicCtx),
      (err) => err instanceof HttpError && err.status === 404 && err.code === 'NOT_FOUND'
    );

    // Case 2: customer (non-owner, non-admin)
    const customerCtx = {
      params: { id: '10' },
      user: { user_id: 7, role: 'CUSTOMER' },
      db: {
        query: async (sql) => {
          if (sql.includes('FROM tour_packages')) return [mockDisabledPackage];
          return [];
        }
      }
    };

    await assert.rejects(
      () => detailRoute.handler(customerCtx),
      (err) => err instanceof HttpError && err.status === 404 && err.code === 'NOT_FOUND'
    );

    // Case 3: different provider (non-owner)
    const otherProviderCtx = {
      params: { id: '10' },
      user: { user_id: 5, role: 'PROVIDER' },
      db: {
        query: async (sql) => {
          if (sql.includes('FROM tour_packages')) return [mockDisabledPackage];
          return [];
        }
      }
    };

    await assert.rejects(
      () => detailRoute.handler(otherProviderCtx),
      (err) => err instanceof HttpError && err.status === 404 && err.code === 'NOT_FOUND'
    );
  });

  it('allows owner provider and admin to view non-approved package', async () => {
    const mockPendingPackage = {
      package_id: 9,
      title: 'Pending Wildlife Safari',
      status: 'PENDING',
      duration_days: 2,
      price: '5800.00',
      capacity: 12,
      inclusions: 'Lodge stay',
      exclusions: 'Airfare',
      destination_id: 5,
      destination_name: 'Coorg',
      category_id: 4,
      category_name: 'Wildlife',
      provider_id: 5,
      provider_name: 'Meena Iyer'
    };

    // Owner provider (user_id: 5)
    const ownerCtx = {
      params: { id: '9' },
      user: { user_id: 5, role: 'PROVIDER' },
      db: {
        query: async (sql) => {
          if (sql.includes('FROM tour_packages')) return [mockPendingPackage];
          return [];
        }
      }
    };

    const ownerResult = await detailRoute.handler(ownerCtx);
    assert.equal(ownerResult.data.package_id, 9);
    assert.equal(ownerResult.data.status, 'PENDING');

    // Admin
    const adminCtx = {
      params: { id: '9' },
      user: { user_id: 2, role: 'ADMIN' },
      db: {
        query: async (sql) => {
          if (sql.includes('FROM tour_packages')) return [mockPendingPackage];
          return [];
        }
      }
    };

    const adminResult = await detailRoute.handler(adminCtx);
    assert.equal(adminResult.data.package_id, 9);
    assert.equal(adminResult.data.status, 'PENDING');
  });
});
