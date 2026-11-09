'use strict';
/**
 * tests/reviews.routes.test.js — Owner: M3
 *
 * Comprehensive offline unit tests for:
 *   POST /api/reviews
 *   GET  /api/packages/:id/reviews
 *   GET  /api/reviews/mine
 *
 * Uses Node's built-in node:test + node:assert/strict.
 * Sourced strictly from docs/CONTRACT.md and database/schema.sql.
 *
 * Run: node --test tests/reviews.routes.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const routes = require('../server/routes/reviews.routes');

const createReviewRoute = routes.find(
  r => r.method === 'POST' && r.path === '/api/reviews'
);
const myReviewsRoute = routes.find(
  r => r.method === 'GET' && r.path === '/api/reviews/mine'
);
const packageReviewsRoute = routes.find(
  r => r.method === 'GET' && r.path === '/api/packages/:id/reviews'
);

// ─────────────────────────────────────────────────────────────────────────────
// Test Helpers & Mock Database for Review Submission
// ─────────────────────────────────────────────────────────────────────────────

function makeReviewSubmitDb(opts = {}) {
  const calls = [];

  const booking = opts.booking || {
    booking_id: 7,
    customer_id: opts.customerId !== undefined ? opts.customerId : 7,
    package_id: 1,
    booking_status: opts.bookingStatus || 'COMPLETED'
  };

  const existingReviews = opts.existingReviews || [];

  const tx = {
    async query(sql, params = []) {
      calls.push({ sql: sql.trim(), params });

      // Lock booking
      if (sql.includes('FROM bookings') && sql.includes('FOR UPDATE')) {
        if (opts.noBooking) return [];
        return [booking];
      }

      // Check existing review
      if (sql.includes('FROM reviews') && sql.includes('FOR UPDATE')) {
        return existingReviews;
      }

      // Insert review
      if (sql.includes('INSERT INTO reviews')) {
        if (opts.insertFailsDuplicate) {
          const err = new Error('Duplicate entry for key reviews.booking_id');
          err.code = 'ER_DUP_ENTRY';
          throw err;
        }
        if (opts.insertFailsGeneral) {
          throw new Error('Database connection lost');
        }
        return { insertId: 42, affectedRows: 1 };
      }

      throw new Error('Unexpected SQL in tx: ' + sql);
    }
  };

  const db = {
    calls,
    async transaction(cb) {
      return cb(tx);
    },
    async query(sql, params = []) {
      calls.push({ sql: sql.trim(), params });
      return { affectedRows: 0, insertId: 0 };
    }
  };

  return db;
}

function makeReviewSubmitCtx(opts = {}) {
  const db = opts.db || makeReviewSubmitDb(opts.dbOpts);
  return {
    ctx: {
      body: opts.body !== undefined ? opts.body : { booking_id: 7, rating: 5, comment: 'Amazing tour!' },
      user: opts.user !== undefined ? opts.user : { user_id: 7, role: 'CUSTOMER' },
      db
    },
    db
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1: Route Registration
// ─────────────────────────────────────────────────────────────────────────────
describe('Reviews Route Registration', () => {
  it('registers all 3 review routes', () => {
    assert.equal(routes.length, 3);
    assert.ok(createReviewRoute, 'POST /api/reviews must be registered');
    assert.deepEqual(createReviewRoute.roles, ['CUSTOMER']);

    assert.ok(myReviewsRoute, 'GET /api/reviews/mine must be registered');
    assert.deepEqual(myReviewsRoute.roles, ['CUSTOMER']);

    assert.ok(packageReviewsRoute, 'GET /api/packages/:id/reviews must be registered');
    assert.equal(packageReviewsRoute.roles, undefined, 'Package reviews must be public');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2: POST /api/reviews — Submission & Validation
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/reviews — Review Submission', () => {
  it('allows customer to submit a valid review for their own COMPLETED booking', async () => {
    const db = makeReviewSubmitDb({
      bookingStatus: 'COMPLETED',
      customerId: 7
    });
    const { ctx } = makeReviewSubmitCtx({ db });

    const result = await createReviewRoute.handler(ctx);
    assert.equal(result.status, 201);
    assert.equal(result.data.review_id, 42);
    assert.equal(result.data.booking_id, 7);
    assert.equal(result.data.customer_id, 7);
    assert.equal(result.data.package_id, 1);
    assert.equal(result.data.rating, 5);
    assert.equal(result.data.comment, 'Amazing tour!');

    const insertCall = db.calls.find(c => c.sql.startsWith('INSERT INTO reviews'));
    assert.ok(insertCall);
    assert.deepEqual(insertCall.params, [7, 7, 1, 5, 'Amazing tour!']);
  });

  it('allows customer to submit review without optional comment (null)', async () => {
    const db = makeReviewSubmitDb({
      bookingStatus: 'COMPLETED',
      customerId: 7
    });
    const { ctx } = makeReviewSubmitCtx({
      db,
      body: { booking_id: 7, rating: 4 }
    });

    const result = await createReviewRoute.handler(ctx);
    assert.equal(result.status, 201);
    assert.equal(result.data.rating, 4);
    assert.equal(result.data.comment, null);

    const insertCall = db.calls.find(c => c.sql.startsWith('INSERT INTO reviews'));
    assert.ok(insertCall);
    assert.equal(insertCall.params[4], null);
  });

  it('rejects non-customer role with 403 FORBIDDEN', async () => {
    for (const role of ['PROVIDER', 'ADMIN', 'SUPER_ADMIN']) {
      const { ctx } = makeReviewSubmitCtx({ user: { user_id: 4, role } });
      await assert.rejects(
        createReviewRoute.handler(ctx),
        err => err.status === 403 && err.code === 'FORBIDDEN'
      );
    }
  });

  it('rejects invalid or missing booking ID with 400 VALIDATION_ERROR', async () => {
    for (const badBookingId of [0, -1, 'abc', null, undefined]) {
      const { ctx } = makeReviewSubmitCtx({
        body: { booking_id: badBookingId, rating: 5, comment: 'Nice' }
      });
      await assert.rejects(
        createReviewRoute.handler(ctx),
        err => err.status === 400 && err.code === 'VALIDATION_ERROR'
      );
    }
  });

  it('throws 404 NOT_FOUND if booking does not exist', async () => {
    const db = makeReviewSubmitDb({ noBooking: true });
    const { ctx } = makeReviewSubmitCtx({ db });

    await assert.rejects(
      createReviewRoute.handler(ctx),
      err => err.status === 404 && err.code === 'NOT_FOUND'
    );
  });

  it('throws 403 FORBIDDEN if customer attempts to review another customer\'s booking', async () => {
    // booking belongs to customer 9, caller is customer 7
    const db = makeReviewSubmitDb({ customerId: 9 });
    const { ctx } = makeReviewSubmitCtx({ db, user: { user_id: 7, role: 'CUSTOMER' } });

    await assert.rejects(
      createReviewRoute.handler(ctx),
      err => err.status === 403 && err.code === 'FORBIDDEN'
    );
  });

  it('rejects review on PENDING booking with 409 CONFLICT', async () => {
    const db = makeReviewSubmitDb({ bookingStatus: 'PENDING' });
    const { ctx } = makeReviewSubmitCtx({ db });

    await assert.rejects(
      createReviewRoute.handler(ctx),
      err => err.status === 409 && err.code === 'CONFLICT' && err.message.includes('COMPLETED')
    );
  });

  it('rejects review on CONFIRMED booking with 409 CONFLICT', async () => {
    const db = makeReviewSubmitDb({ bookingStatus: 'CONFIRMED' });
    const { ctx } = makeReviewSubmitCtx({ db });

    await assert.rejects(
      createReviewRoute.handler(ctx),
      err => err.status === 409 && err.code === 'CONFLICT' && err.message.includes('COMPLETED')
    );
  });

  it('rejects review on CANCELLED booking with 409 CONFLICT', async () => {
    const db = makeReviewSubmitDb({ bookingStatus: 'CANCELLED' });
    const { ctx } = makeReviewSubmitCtx({ db });

    await assert.rejects(
      createReviewRoute.handler(ctx),
      err => err.status === 409 && err.code === 'CONFLICT' && err.message.includes('COMPLETED')
    );
  });

  it('rejects rating below 1 with 400 VALIDATION_ERROR', async () => {
    for (const badRating of [0, -1, -5]) {
      const { ctx } = makeReviewSubmitCtx({
        body: { booking_id: 7, rating: badRating }
      });
      await assert.rejects(
        createReviewRoute.handler(ctx),
        err => err.status === 400 && err.code === 'VALIDATION_ERROR'
      );
    }
  });

  it('rejects rating above 5 with 400 VALIDATION_ERROR', async () => {
    for (const badRating of [6, 10, 100]) {
      const { ctx } = makeReviewSubmitCtx({
        body: { booking_id: 7, rating: badRating }
      });
      await assert.rejects(
        createReviewRoute.handler(ctx),
        err => err.status === 400 && err.code === 'VALIDATION_ERROR'
      );
    }
  });

  it('rejects non-integer rating format with 400 VALIDATION_ERROR', async () => {
    for (const badRating of ['five', 4.5, '4.5', true, null]) {
      const { ctx } = makeReviewSubmitCtx({
        body: { booking_id: 7, rating: badRating }
      });
      await assert.rejects(
        createReviewRoute.handler(ctx),
        err => err.status === 400 && err.code === 'VALIDATION_ERROR'
      );
    }
  });

  it('rejects duplicate review submission (existing review found) with 409 CONFLICT', async () => {
    const db = makeReviewSubmitDb({
      bookingStatus: 'COMPLETED',
      existingReviews: [{ review_id: 10 }]
    });
    const { ctx } = makeReviewSubmitCtx({ db });

    await assert.rejects(
      createReviewRoute.handler(ctx),
      err => err.status === 409 && err.code === 'CONFLICT' && err.message.includes('already been submitted')
    );
  });

  it('rejects duplicate review submission (ER_DUP_ENTRY from DB) with 409 CONFLICT', async () => {
    const db = makeReviewSubmitDb({
      bookingStatus: 'COMPLETED',
      insertFailsDuplicate: true
    });
    const { ctx } = makeReviewSubmitCtx({ db });

    await assert.rejects(
      createReviewRoute.handler(ctx),
      err => err.status === 409 && err.code === 'CONFLICT' && err.message.includes('already been submitted')
    );
  });

  it('propagates general database failures cleanly', async () => {
    const db = makeReviewSubmitDb({
      bookingStatus: 'COMPLETED',
      insertFailsGeneral: true
    });
    const { ctx } = makeReviewSubmitCtx({ db });

    await assert.rejects(
      createReviewRoute.handler(ctx),
      err => err.message === 'Database connection lost'
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3: GET /api/packages/:id/reviews — Public Package Reviews
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/packages/:id/reviews — Public Package Reviews', () => {
  function makePackageReviewsDb(opts = {}) {
    const calls = [];

    const db = {
      calls,
      async query(sql, params = []) {
        calls.push({ sql: sql.trim(), params });

        // Package lookup
        if (sql.includes('FROM tour_packages WHERE package_id = ?')) {
          if (opts.noPackage) return [];
          return [{ package_id: params[0] }];
        }

        // Count reviews
        if (sql.includes('COUNT(*) AS total FROM reviews')) {
          return [{ total: opts.total !== undefined ? opts.total : 2 }];
        }

        // Fetch reviews
        if (sql.includes('FROM reviews r') && sql.includes('JOIN users u')) {
          return opts.rows || [
            {
              review_id: 1,
              rating: 5,
              comment: 'Superb tour of Munnar!',
              created_at: new Date('2026-10-26T12:00:00Z'),
              customer_name: 'Anita Sharma'
            },
            {
              review_id: 2,
              rating: 4,
              comment: 'Great scenery and guide.',
              created_at: new Date('2026-10-25T14:30:00Z'),
              customer_name: 'Vikram Singh'
            }
          ];
        }

        throw new Error('Unexpected SQL in packageReviewsDb: ' + sql);
      }
    };

    return db;
  }

  it('returns reviews associated with the requested package', async () => {
    const db = makePackageReviewsDb();
    const ctx = {
      params: { id: '1' },
      query: {},
      db
    };

    const result = await packageReviewsRoute.handler(ctx);
    assert.equal(Array.isArray(result.data), true);
    assert.equal(result.data.length, 2);
    assert.equal(result.data[0].review_id, 1);
    assert.equal(result.data[0].customer_name, 'Anita Sharma');
    assert.equal(result.data[0].rating, 5);
    assert.equal(result.data[0].comment, 'Superb tour of Munnar!');
    assert.equal(result.meta.total, 2);
    assert.equal(result.meta.page, 1);
    assert.equal(result.meta.pageSize, 10);
  });

  it('restricts reviews to the requested package ID parameter in SQL', async () => {
    const db = makePackageReviewsDb();
    const ctx = {
      params: { id: '3' },
      query: {},
      db
    };

    await packageReviewsRoute.handler(ctx);

    const dataCall = db.calls.find(c => c.sql.includes('WHERE r.package_id = ?'));
    assert.ok(dataCall);
    assert.equal(dataCall.params[0], 3);

    const countCall = db.calls.find(c => c.sql.includes('WHERE package_id = ?'));
    assert.ok(countCall);
    assert.equal(countCall.params[0], 3);
  });

  it('rejects invalid or non-numeric package ID with 400 BAD_REQUEST', async () => {
    const db = makePackageReviewsDb();
    for (const badId of ['abc', '0', '-2', '1.5', ' ']) {
      const ctx = { params: { id: badId }, query: {}, db };
      await assert.rejects(
        packageReviewsRoute.handler(ctx),
        err => err.status === 400 && err.code === 'BAD_REQUEST'
      );
    }
  });

  it('throws 404 NOT_FOUND if package does not exist', async () => {
    const db = makePackageReviewsDb({ noPackage: true });
    const ctx = { params: { id: '999' }, query: {}, db };

    await assert.rejects(
      packageReviewsRoute.handler(ctx),
      err => err.status === 404 && err.code === 'NOT_FOUND'
    );
  });

  it('does NOT expose private customer information (email, mobile, password)', async () => {
    const db = makePackageReviewsDb({
      rows: [
        {
          review_id: 1,
          rating: 5,
          comment: 'Great!',
          created_at: new Date('2026-10-26T12:00:00Z'),
          customer_name: 'Anita Sharma'
        }
      ]
    });
    const ctx = { params: { id: '1' }, query: {}, db };

    const result = await packageReviewsRoute.handler(ctx);
    const row = result.data[0];

    assert.equal(row.customer_email, undefined);
    assert.equal(row.customer_mobile, undefined);
    assert.equal(row.password_hash, undefined);
    assert.equal(row.customer_id, undefined);
  });

  it('supports pagination with page and pageSize query parameters', async () => {
    const db = makePackageReviewsDb({ total: 25 });
    const ctx = {
      params: { id: '1' },
      query: { page: '2', pageSize: '10' },
      db
    };

    const result = await packageReviewsRoute.handler(ctx);
    assert.equal(result.meta.page, 2);
    assert.equal(result.meta.pageSize, 10);
    assert.equal(result.meta.total, 25);

    const dataCall = db.calls.find(c => c.sql.includes('LIMIT ? OFFSET ?'));
    assert.ok(dataCall);
    assert.equal(dataCall.params[1], 10); // pageSize
    assert.equal(dataCall.params[2], 10); // offset = (2-1)*10 = 10
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4: GET /api/reviews/mine — Customer Review History
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/reviews/mine — Customer Review History', () => {
  function makeMyReviewsDb(opts = {}) {
    const calls = [];

    const db = {
      calls,
      async query(sql, params = []) {
        calls.push({ sql: sql.trim(), params });

        // Count customer reviews
        if (sql.includes('COUNT(*) AS total FROM reviews WHERE customer_id = ?')) {
          return [{ total: opts.total !== undefined ? opts.total : 1 }];
        }

        // Fetch customer reviews
        if (sql.includes('FROM reviews r') && sql.includes('JOIN tour_packages p')) {
          return opts.rows || [
            {
              review_id: 1,
              booking_id: 7,
              package_id: 1,
              package_title: 'Munnar Tea Hills',
              package_image: '/images/munnar.jpg',
              rating: 5,
              comment: 'Outstanding vacation!',
              created_at: new Date('2026-10-26T12:00:00Z')
            }
          ];
        }

        throw new Error('Unexpected SQL in myReviewsDb: ' + sql);
      }
    };

    return db;
  }

  it('allows authenticated customer to view their own review history', async () => {
    const db = makeMyReviewsDb();
    const ctx = {
      query: {},
      user: { user_id: 7, role: 'CUSTOMER' },
      db
    };

    const result = await myReviewsRoute.handler(ctx);
    assert.equal(Array.isArray(result.data), true);
    assert.equal(result.data.length, 1);
    assert.equal(result.data[0].review_id, 1);
    assert.equal(result.data[0].booking_id, 7);
    assert.equal(result.data[0].package_id, 1);
    assert.equal(result.data[0].package_title, 'Munnar Tea Hills');
    assert.equal(result.data[0].package_image, '/images/munnar.jpg');
    assert.equal(result.data[0].rating, 5);
    assert.equal(result.data[0].comment, 'Outstanding vacation!');
  });

  it('uses ctx.user.user_id to prevent viewing another customer\'s reviews', async () => {
    const db = makeMyReviewsDb();
    const ctx = {
      query: { customer_id: '99' }, // untrusted query param should be ignored
      user: { user_id: 8, role: 'CUSTOMER' },
      db
    };

    await myReviewsRoute.handler(ctx);

    const countCall = db.calls.find(c => c.sql.includes('WHERE customer_id = ?'));
    assert.ok(countCall);
    assert.equal(countCall.params[0], 8, 'must filter by authenticated user_id');

    const dataCall = db.calls.find(c => c.sql.includes('WHERE r.customer_id = ?'));
    assert.ok(dataCall);
    assert.equal(dataCall.params[0], 8, 'must filter by authenticated user_id');
  });

  it('rejects non-customer role with 403 FORBIDDEN', async () => {
    const db = makeMyReviewsDb();
    for (const role of ['PROVIDER', 'ADMIN', 'SUPER_ADMIN']) {
      const ctx = { query: {}, user: { user_id: 4, role }, db };
      await assert.rejects(
        myReviewsRoute.handler(ctx),
        err => err.status === 403 && err.code === 'FORBIDDEN'
      );
    }
  });

  it('supports pagination with page and pageSize', async () => {
    const db = makeMyReviewsDb({ total: 12 });
    const ctx = {
      query: { page: '2', pageSize: '5' },
      user: { user_id: 7, role: 'CUSTOMER' },
      db
    };

    const result = await myReviewsRoute.handler(ctx);
    assert.equal(result.meta.page, 2);
    assert.equal(result.meta.pageSize, 5);
    assert.equal(result.meta.total, 12);

    const dataCall = db.calls.find(c => c.sql.includes('LIMIT ? OFFSET ?'));
    assert.ok(dataCall);
    assert.equal(dataCall.params[1], 5); // pageSize
    assert.equal(dataCall.params[2], 5); // offset = (2-1)*5 = 5
  });
});
