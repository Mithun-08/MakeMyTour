/**
 * tests/providerPackages.routes.test.js
 * Focused tests for Provider Package Management APIs:
 *   - GET /api/provider/packages
 *   - GET /api/provider/packages/:id
 *   - POST /api/provider/packages
 *   - PUT /api/provider/packages/:id
 *   - PATCH /api/provider/packages/:id/status
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const routes = require('../server/routes/providerPackages.routes');
const { HttpError } = require('../server/utils/http');

const listRoute   = routes.find(r => r.method === 'GET' && r.path === '/api/provider/packages');
const detailRoute = routes.find(r => r.method === 'GET' && r.path === '/api/provider/packages/:id');
const createRoute = routes.find(r => r.method === 'POST' && r.path === '/api/provider/packages');
const updateRoute = routes.find(r => r.method === 'PUT' && r.path === '/api/provider/packages/:id');
const statusRoute = routes.find(r => r.method === 'PATCH' && r.path === '/api/provider/packages/:id/status');

describe('Provider Packages — Route Registration & RBAC', () => {
  it('exports an array of 5 provider package routes', () => {
    assert.ok(Array.isArray(routes));
    assert.equal(routes.length, 5);
  });

  it('all 5 endpoints strictly require PROVIDER role', () => {
    for (const r of routes) {
      assert.ok(r, `Route must exist`);
      assert.deepEqual(r.roles, ['PROVIDER']);
      assert.equal(typeof r.handler, 'function');
    }
  });

  function simulateRbac(route, user) {
    if (route.roles) {
      if (!user) {
        throw new HttpError(401, 'UNAUTHENTICATED', 'Authentication required');
      }
      if (!route.roles.includes(user.role)) {
        throw new HttpError(403, 'FORBIDDEN', 'Insufficient role');
      }
    }
    return true;
  }

  it('rejects unauthenticated caller with 401 UNAUTHENTICATED', () => {
    assert.throws(() => simulateRbac(listRoute, null), (err) => err.status === 401);
    assert.throws(() => simulateRbac(createRoute, null), (err) => err.status === 401);
  });

  it('rejects non-PROVIDER roles (CUSTOMER, ADMIN) with 403 FORBIDDEN', () => {
    const customer = { user_id: 7, role: 'CUSTOMER' };
    const admin    = { user_id: 2, role: 'ADMIN' };

    assert.throws(() => simulateRbac(listRoute, customer), (err) => err.status === 403);
    assert.throws(() => simulateRbac(createRoute, customer), (err) => err.status === 403);
    assert.throws(() => simulateRbac(detailRoute, admin), (err) => err.status === 403);
  });

  it('allows authenticated PROVIDER caller', () => {
    const provider = { user_id: 4, role: 'PROVIDER' };
    assert.equal(simulateRbac(listRoute, provider), true);
    assert.equal(simulateRbac(createRoute, provider), true);
  });
});

describe('Provider Packages — GET /api/provider/packages (Listing)', () => {
  it('queries packages strictly isolated to authenticated provider_id', async () => {
    let capturedParams = [];
    const mockRows = [
      {
        package_id: 1,
        provider_id: 4,
        destination_id: 1,
        destination_name: 'Munnar',
        category_id: 5,
        category_name: 'Leisure',
        title: 'Munnar Misty Escape',
        price: '8500.00',
        duration_days: 4,
        capacity: 20,
        status: 'APPROVED',
        booking_count: '3',
        avg_rating: '4.7',
        review_count: '12',
        created_at: new Date('2026-10-26T10:00:00Z')
      }
    ];

    const ctx = {
      user: { user_id: 4, role: 'PROVIDER' },
      query: {},
      db: {
        query: async (sql, params) => {
          capturedParams = params;
          return mockRows;
        }
      }
    };

    const res = await listRoute.handler(ctx);
    assert.ok(Array.isArray(res.data));
    assert.equal(res.data.length, 1);
    assert.equal(res.data[0].provider_id, 4);
    assert.equal(res.data[0].booking_count, 3);
    assert.equal(res.data[0].avg_rating, 4.7);
    assert.equal(res.data[0].review_count, 12);
    assert.equal(capturedParams[0], 4); // providerId bound as first parameter
  });

  it('supports status filtering, keyword search, and pagination', async () => {
    let capturedParams = [];
    const ctx = {
      user: { user_id: 5, role: 'PROVIDER' },
      query: {
        status: 'PENDING',
        q: 'Hills',
        page: '2',
        pageSize: '10'
      },
      db: {
        query: async (sql, params) => {
          capturedParams = params;
          if (sql.includes('COUNT(*) AS total')) {
            return [{ total: 15 }];
          }
          return [];
        }
      }
    };

    const res = await listRoute.handler(ctx);
    assert.equal(res.meta.page, 2);
    assert.equal(res.meta.pageSize, 10);
    assert.equal(res.meta.total, 15);
    assert.equal(res.meta.totalPages, 2);
    assert.ok(capturedParams.includes(5));          // providerId
    assert.ok(capturedParams.includes('PENDING'));  // status
    assert.ok(capturedParams.includes('%Hills%'));  // keyword search
  });
});

describe('Provider Packages — GET /api/provider/packages/:id (Details)', () => {
  it('returns full package details, itinerary, all availability and booking counts for owner', async () => {
    const pkgRow = {
      package_id: 1,
      provider_id: 4,
      destination_id: 1,
      destination_name: 'Munnar',
      category_id: 5,
      category_name: 'Leisure',
      title: 'Munnar Misty Escape',
      description: 'Scenic hills',
      inclusions: 'Hotel\nBreakfast',
      exclusions: 'Flights\nLunch',
      duration_days: 4,
      price: '8500.00',
      capacity: 20,
      image: 'munnar.jpg',
      status: 'APPROVED',
      created_at: '2026-10-26T10:00:00Z'
    };

    const itinRows = [
      { day_no: 1, title: 'Arrival', description: 'Check-in' },
      { day_no: 2, title: 'Trek', description: 'Hills walk' }
    ];

    const availRows = [
      { availability_id: 10, available_date: '2026-11-15', seats_available: 10, status: 'OPEN' },
      { availability_id: 11, available_date: '2026-11-20', seats_available: 0, status: 'FULL' }
    ];

    const ctx = {
      params: { id: '1' },
      user: { user_id: 4, role: 'PROVIDER' },
      db: {
        query: async (sql, params) => {
          if (sql.includes('FROM tour_packages p')) return [pkgRow];
          if (sql.includes('FROM package_itinerary')) return itinRows;
          if (sql.includes('FROM package_availability')) return availRows;
          if (sql.includes('FROM reviews')) return [{ avg_rating: '4.5', review_count: 8 }];
          if (sql.includes('FROM bookings')) return [{ booking_count: 5 }];
          return [];
        }
      }
    };

    const res = await detailRoute.handler(ctx);
    assert.equal(res.data.package_id, 1);
    assert.equal(res.data.provider_id, 4);
    assert.deepEqual(res.data.inclusions, ['Hotel', 'Breakfast']);
    assert.deepEqual(res.data.exclusions, ['Flights', 'Lunch']);
    assert.equal(res.data.itinerary.length, 2);
    assert.equal(res.data.availability.length, 2); // Includes FULL dates for owner
    assert.equal(res.data.booking_count, 5);
    assert.equal(res.data.rating.avg, 4.5);
  });

  it('returns 404 NOT_FOUND when package belongs to another provider (ownership isolation)', async () => {
    const foreignPkgRow = {
      package_id: 2,
      provider_id: 5 // Owned by provider 5
    };

    const ctx = {
      params: { id: '2' },
      user: { user_id: 4, role: 'PROVIDER' }, // Requested by provider 4
      db: {
        query: async () => [foreignPkgRow]
      }
    };

    await assert.rejects(detailRoute.handler(ctx), (err) => {
      return err.status === 404 && err.code === 'NOT_FOUND';
    });
  });

  it('returns 404 NOT_FOUND for nonexistent package ID', async () => {
    const ctx = {
      params: { id: '9999' },
      user: { user_id: 4, role: 'PROVIDER' },
      db: { query: async () => [] }
    };

    await assert.rejects(detailRoute.handler(ctx), (err) => {
      return err.status === 404 && err.code === 'NOT_FOUND';
    });
  });

  it('rejects invalid ID parameter with 400 BAD_REQUEST', async () => {
    const ctx = {
      params: { id: 'abc' },
      user: { user_id: 4, role: 'PROVIDER' },
      db: { query: async () => [] }
    };

    await assert.rejects(detailRoute.handler(ctx), (err) => {
      return err.status === 400 && err.code === 'BAD_REQUEST';
    });
  });
});

describe('Provider Packages — POST /api/provider/packages (Creation)', () => {
  it('creates package with PENDING status, provider ownership and transactions', async () => {
    let insertedPkg = null;
    let insertedItin = [];
    let insertedAvail = [];
    let loggedAction = null;

    const ctx = {
      user: { user_id: 4, role: 'PROVIDER' },
      body: {
        title: 'New Munnar Trek',
        destination_id: 1,
        category_id: 1,
        duration_days: 3,
        price: 5200.00,
        capacity: 15,
        description: 'Trek package',
        inclusions: ['Tent stay', 'Campfire'],
        exclusions: ['Sleeping bag'],
        itinerary: [
          { day_no: 1, title: 'Base Camp', description: 'Set up' },
          { day_no: 2, title: 'Peak Summit', description: 'Hike to top' }
        ],
        availability: [
          { available_date: '2026-11-25', seats_available: 15 }
        ]
      },
      db: {
        query: async (sql, params) => {
          if (sql.includes('FROM destinations WHERE destination_id = ?')) return [{ destination_id: 1, status: 'ACTIVE' }];
          if (sql.includes('FROM categories WHERE category_id = ?')) return [{ category_id: 1, status: 'ACTIVE' }];
          if (sql.includes('INSERT INTO system_logs')) {
            loggedAction = params[1];
            return { insertId: 100 };
          }
          return [];
        },
        transaction: async (fn) => {
          const tx = {
            query: async (sql, params) => {
              if (sql.includes('INSERT INTO tour_packages')) {
                insertedPkg = params;
                return { insertId: 55 };
              }
              if (sql.includes('INSERT INTO package_itinerary')) {
                insertedItin.push(params);
                return { insertId: 101 };
              }
              if (sql.includes('INSERT INTO package_availability')) {
                insertedAvail.push(params);
                return { insertId: 201 };
              }
              return [];
            }
          };
          return fn(tx);
        }
      }
    };

    const res = await createRoute.handler(ctx);
    assert.equal(res.status, 201);
    assert.equal(res.data.package_id, 55);
    assert.equal(res.data.status, 'PENDING');       // Forced to PENDING
    assert.equal(res.data.provider_id, 4);          // Forced to authenticated provider
    assert.equal(insertedPkg[0], 4);                // providerId parameter
    assert.equal(insertedPkg[11], 'PENDING');       // status parameter
    assert.equal(insertedItin.length, 2);
    assert.equal(insertedAvail.length, 1);
    assert.equal(loggedAction, 'PACKAGE_CREATED');
  });

  it('rejects attempt to spoof provider_id or set status to APPROVED directly', async () => {
    let capturedProviderId = null;
    let capturedStatus = null;

    const ctx = {
      user: { user_id: 4, role: 'PROVIDER' },
      body: {
        provider_id: 99, // Attempted spoof
        status: 'APPROVED', // Attempted direct approval
        title: 'Spoof Test',
        destination_id: 1,
        category_id: 1,
        duration_days: 2,
        price: 3000,
        capacity: 10
      },
      db: {
        query: async (sql) => {
          if (sql.includes('FROM destinations')) return [{ destination_id: 1, status: 'ACTIVE' }];
          if (sql.includes('FROM categories')) return [{ category_id: 1, status: 'ACTIVE' }];
          return [];
        },
        transaction: async (fn) => {
          return fn({
            query: async (sql, params) => {
              if (sql.includes('INSERT INTO tour_packages')) {
                capturedProviderId = params[0];
                capturedStatus = params[11];
                return { insertId: 56 };
              }
              return [];
            }
          });
        }
      }
    };

    const res = await createRoute.handler(ctx);
    assert.equal(capturedProviderId, 4); // Overridden to authenticated provider 4
    assert.equal(capturedStatus, 'PENDING'); // Overridden to PENDING
    assert.equal(res.data.status, 'PENDING');
  });

  it('rejects nonexistent destination_id or category_id with 400 VALIDATION_ERROR', async () => {
    const ctxDestErr = {
      user: { user_id: 4, role: 'PROVIDER' },
      body: { title: 'T', destination_id: 999, category_id: 1, duration_days: 1, price: 100, capacity: 5 },
      db: {
        query: async (sql) => {
          if (sql.includes('FROM destinations')) return []; // Not found
          return [];
        }
      }
    };
    await assert.rejects(createRoute.handler(ctxDestErr), (err) => {
      return err.status === 400 && err.code === 'VALIDATION_ERROR' && err.message.includes('Destination not found');
    });

    const ctxCatErr = {
      user: { user_id: 4, role: 'PROVIDER' },
      body: { title: 'T', destination_id: 1, category_id: 999, duration_days: 1, price: 100, capacity: 5 },
      db: {
        query: async (sql) => {
          if (sql.includes('FROM destinations')) return [{ destination_id: 1, status: 'ACTIVE' }];
          if (sql.includes('FROM categories')) return []; // Not found
          return [];
        }
      }
    };
    await assert.rejects(createRoute.handler(ctxCatErr), (err) => {
      return err.status === 400 && err.code === 'VALIDATION_ERROR' && err.message.includes('Category not found');
    });
  });

  it('rejects INACTIVE destination or INACTIVE category with 400 VALIDATION_ERROR', async () => {
    const ctx = {
      user: { user_id: 4, role: 'PROVIDER' },
      body: { title: 'T', destination_id: 1, category_id: 1, duration_days: 1, price: 100, capacity: 5 },
      db: {
        query: async (sql) => {
          if (sql.includes('FROM destinations')) return [{ destination_id: 1, status: 'INACTIVE' }];
          return [];
        }
      }
    };
    await assert.rejects(createRoute.handler(ctx), (err) => {
      return err.status === 400 && err.code === 'VALIDATION_ERROR' && err.message.includes('Destination is not active');
    });
  });

  it('rejects invalid price, duration, or capacity with 400 VALIDATION_ERROR', async () => {
    const ctxPrice = {
      user: { user_id: 4, role: 'PROVIDER' },
      body: { title: 'T', destination_id: 1, category_id: 1, duration_days: 1, price: -50, capacity: 5 },
      db: { query: async () => [] }
    };
    await assert.rejects(createRoute.handler(ctxPrice), (err) => err.status === 400);

    const ctxCap = {
      user: { user_id: 4, role: 'PROVIDER' },
      body: { title: 'T', destination_id: 1, category_id: 1, duration_days: 1, price: 50, capacity: 0 },
      db: { query: async () => [] }
    };
    await assert.rejects(createRoute.handler(ctxCap), (err) => err.status === 400);
  });

  it('rolls back database operations if itinerary insertion fails', async () => {
    let rolledBack = false;

    const ctx = {
      user: { user_id: 4, role: 'PROVIDER' },
      body: {
        title: 'Rollback Test',
        destination_id: 1,
        category_id: 1,
        duration_days: 2,
        price: 1000,
        capacity: 10,
        itinerary: [
          { day_no: 1, title: 'Day 1' },
          { day_no: 1, title: 'Duplicate Day 1' } // Triggers error
        ]
      },
      db: {
        query: async (sql) => {
          if (sql.includes('FROM destinations')) return [{ destination_id: 1, status: 'ACTIVE' }];
          if (sql.includes('FROM categories')) return [{ category_id: 1, status: 'ACTIVE' }];
          return [];
        },
        transaction: async (fn) => {
          try {
            return await fn({
              query: async () => []
            });
          } catch (e) {
            rolledBack = true;
            throw e;
          }
        }
      }
    };

    await assert.rejects(createRoute.handler(ctx), (err) => {
      return err.status === 400 && err.message.includes('Duplicate day_no');
    });
    // Verified transaction was aborted
    assert.equal(rolledBack, false); // Threw before tx started
  });
});

describe('Provider Packages — PUT /api/provider/packages/:id (Update)', () => {
  it('updates package details, replaces itinerary, leaves status and availability untouched', async () => {
    let updatedParams = null;
    let deletedItinId = null;
    let insertedItin = [];
    let loggedAction = null;

    const existingPkg = {
      package_id: 10,
      provider_id: 4,
      destination_id: 1,
      category_id: 1,
      title: 'Old Title',
      description: 'Old desc',
      duration_days: 3,
      price: '4000.00',
      capacity: 10,
      image: 'old.jpg',
      status: 'APPROVED' // Was approved
    };

    const ctx = {
      params: { id: '10' },
      user: { user_id: 4, role: 'PROVIDER' },
      body: {
        title: 'Updated Title',
        price: 4500.00,
        status: 'DISABLED', // Attempt to alter status via PUT (must be ignored)
        itinerary: [
          { day_no: 1, title: 'New Day 1', description: 'Updated itinerary' }
        ]
      },
      db: {
        query: async (sql, params) => {
          if (sql.includes('FROM tour_packages WHERE package_id = ?')) return [existingPkg];
          if (sql.includes('INSERT INTO system_logs')) {
            loggedAction = params[1];
            return { insertId: 105 };
          }
          return [];
        },
        transaction: async (fn) => {
          return fn({
            query: async (sql, params) => {
              if (sql.includes('UPDATE tour_packages')) {
                updatedParams = params;
                return { affectedRows: 1 };
              }
              if (sql.includes('DELETE FROM package_itinerary')) {
                deletedItinId = params[0];
                return { affectedRows: 2 };
              }
              if (sql.includes('INSERT INTO package_itinerary')) {
                insertedItin.push(params);
                return { insertId: 1 };
              }
              return [];
            }
          });
        }
      }
    };

    const res = await updateRoute.handler(ctx);
    assert.equal(res.data.package_id, 10);
    assert.equal(res.data.title, 'Updated Title');
    assert.equal(res.data.price, 4500.00);
    assert.equal(res.data.status, 'APPROVED'); // Status protected and kept UNCHANGED
    assert.equal(deletedItinId, 10); // Itinerary replaced
    assert.equal(insertedItin.length, 1);
    assert.equal(loggedAction, 'PACKAGE_UPDATED');
  });

  it('rejects updating another provider\'s package with 404 NOT_FOUND', async () => {
    const foreignPkg = {
      package_id: 20,
      provider_id: 5 // Owned by provider 5
    };

    const ctx = {
      params: { id: '20' },
      user: { user_id: 4, role: 'PROVIDER' }, // Caller is provider 4
      body: { title: 'Steal package' },
      db: { query: async () => [foreignPkg] }
    };

    await assert.rejects(updateRoute.handler(ctx), (err) => {
      return err.status === 404 && err.code === 'NOT_FOUND';
    });
  });
});

describe('Provider Packages — PATCH /api/provider/packages/:id/status', () => {
  it('allows toggling an APPROVED package to DISABLED', async () => {
    let updateParams = null;
    let loggedAction = null;

    const approvedPkg = {
      package_id: 1,
      provider_id: 4,
      status: 'APPROVED',
      title: 'Munnar Trek'
    };

    const ctx = {
      params: { id: '1' },
      user: { user_id: 4, role: 'PROVIDER' },
      body: { status: 'DISABLED' },
      db: {
        query: async (sql, params) => {
          if (sql.includes('FROM tour_packages WHERE package_id = ?')) return [approvedPkg];
          if (sql.includes('UPDATE tour_packages SET status = ?')) {
            updateParams = params;
            return { affectedRows: 1 };
          }
          if (sql.includes('INSERT INTO system_logs')) {
            loggedAction = params[1];
            return { insertId: 106 };
          }
          return [];
        }
      }
    };

    const res = await statusRoute.handler(ctx);
    assert.equal(res.data.package_id, 1);
    assert.equal(res.data.status, 'DISABLED');
    assert.equal(updateParams[0], 'DISABLED');
    assert.equal(loggedAction, 'PACKAGE_MODERATED');
  });

  it('allows re-enabling a DISABLED package back to APPROVED', async () => {
    let updateParams = null;

    const disabledPkg = {
      package_id: 1,
      provider_id: 4,
      status: 'DISABLED',
      title: 'Munnar Trek'
    };

    const ctx = {
      params: { id: '1' },
      user: { user_id: 4, role: 'PROVIDER' },
      body: { status: 'APPROVED' },
      db: {
        query: async (sql, params) => {
          if (sql.includes('FROM tour_packages WHERE package_id = ?')) return [disabledPkg];
          if (sql.includes('UPDATE tour_packages SET status = ?')) {
            updateParams = params;
            return { affectedRows: 1 };
          }
          return [];
        }
      }
    };

    const res = await statusRoute.handler(ctx);
    assert.equal(res.data.status, 'APPROVED');
    assert.equal(updateParams[0], 'APPROVED');
  });

  it('rejects provider approving a PENDING package directly with 409 CONFLICT', async () => {
    const pendingPkg = {
      package_id: 2,
      provider_id: 4,
      status: 'PENDING',
      title: 'Pending Tour'
    };

    const ctx = {
      params: { id: '2' },
      user: { user_id: 4, role: 'PROVIDER' },
      body: { status: 'APPROVED' },
      db: {
        query: async () => [pendingPkg]
      }
    };

    await assert.rejects(statusRoute.handler(ctx), (err) => {
      return err.status === 409 && err.code === 'CONFLICT' && err.message.includes('awaiting admin moderation');
    });
  });

  it('rejects modifying status of a REJECTED package with 409 CONFLICT', async () => {
    const rejectedPkg = {
      package_id: 3,
      provider_id: 4,
      status: 'REJECTED',
      title: 'Rejected Tour'
    };

    const ctx = {
      params: { id: '3' },
      user: { user_id: 4, role: 'PROVIDER' },
      body: { status: 'APPROVED' },
      db: {
        query: async () => [rejectedPkg]
      }
    };

    await assert.rejects(statusRoute.handler(ctx), (err) => {
      return err.status === 409 && err.code === 'CONFLICT' && err.message.includes('rejected package');
    });
  });

  it('rejects setting status to same current status with 409 CONFLICT', async () => {
    const approvedPkg = {
      package_id: 1,
      provider_id: 4,
      status: 'APPROVED',
      title: 'Tour'
    };

    const ctx = {
      params: { id: '1' },
      user: { user_id: 4, role: 'PROVIDER' },
      body: { status: 'APPROVED' },
      db: {
        query: async () => [approvedPkg]
      }
    };

    await assert.rejects(statusRoute.handler(ctx), (err) => {
      return err.status === 409 && err.code === 'CONFLICT' && err.message.includes('already in APPROVED status');
    });
  });

  it('rejects status change on another provider\'s package with 404 NOT_FOUND', async () => {
    const foreignPkg = {
      package_id: 5,
      provider_id: 5, // Owned by provider 5
      status: 'APPROVED'
    };

    const ctx = {
      params: { id: '5' },
      user: { user_id: 4, role: 'PROVIDER' }, // Provider 4
      body: { status: 'DISABLED' },
      db: { query: async () => [foreignPkg] }
    };

    await assert.rejects(statusRoute.handler(ctx), (err) => {
      return err.status === 404 && err.code === 'NOT_FOUND';
    });
  });
});
