'use strict';
/**
 * bookings.status.test.js — Tests for:
 *   PATCH /api/bookings/:id/status (Provider & Admin status moderation)
 *   GET /api/provider/bookings (Provider booking management)
 *
 * Sourced strictly from docs/CONTRACT.md and database/schema.sql.
 * M3-owned test suite.
 * Runs completely offline (mock database).
 *
 * Run: node --test tests/bookings.status.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const routes = require('../server/routes/bookings.routes');

const statusRoute = routes.find(
  r => r.method === 'PATCH' && r.path === '/api/bookings/:id/status'
);
const providerBookingsRoute = routes.find(
  r => r.method === 'GET' && r.path === '/api/provider/bookings'
);

// ─────────────────────────────────────────────────────────────────────────────
// Test Helpers & Mock Database for PATCH status
// ─────────────────────────────────────────────────────────────────────────────

function makeStatusDb(opts = {}) {
  const calls = [];

  const booking = opts.booking || {
    booking_id: 1,
    customer_id: 7,
    package_id: 1,
    availability_id: 10,
    travelers: 2,
    total_amount: '17000.00',
    booking_status: opts.bookingStatus || 'PENDING',
    payment_status: opts.paymentStatus || 'UNPAID',
    provider_id: opts.providerId !== undefined ? opts.providerId : 4
  };

  const avail = opts.avail || {
    availability_id: 10,
    package_id: 1,
    available_date: opts.availDate || '2026-11-05',
    seats_available: opts.seatsAvailable !== undefined ? opts.seatsAvailable : 8,
    status: opts.availStatus || 'OPEN'
  };

  const tx = {
    async query(sql, params = []) {
      calls.push({ sql: sql.trim(), params });

      // Booking lock with tour_packages join
      if (sql.includes('FROM bookings b') && sql.includes('JOIN tour_packages p') && sql.includes('FOR UPDATE')) {
        if (opts.noBooking) return [];
        return [booking];
      }

      // Package availability lock
      if (sql.includes('FROM package_availability') && sql.includes('FOR UPDATE')) {
        if (opts.noAvail) return [];
        return [avail];
      }

      // Current date
      if (sql.includes('CURDATE()')) {
        return [{ today: opts.today || '2026-10-31' }];
      }

      // UPDATE package_availability
      if (sql.includes('UPDATE package_availability')) {
        if (opts.updateAvailFails) throw new Error('simulated availability update failure');
        return { affectedRows: 1 };
      }

      // UPDATE payments
      if (sql.includes('UPDATE payments')) {
        if (opts.updatePaymentsFails) throw new Error('simulated payments update failure');
        return { affectedRows: 1 };
      }

      // UPDATE bookings
      if (sql.includes('UPDATE bookings')) {
        if (opts.updateBookingsFails) throw new Error('simulated bookings update failure');
        return { affectedRows: 1 };
      }

      throw new Error('Unexpected SQL in status tx: ' + sql);
    }
  };

  const db = {
    calls,
    async transaction(cb) {
      return cb(tx);
    },
    async query(sql, params = []) {
      // logAction calls outside transaction
      calls.push({ sql: sql.trim(), params });
      return { affectedRows: 0, insertId: 0 };
    }
  };

  return db;
}

function makeStatusCtx(opts = {}) {
  const db = opts.db || makeStatusDb(opts.dbOpts);
  return {
    ctx: {
      params: opts.params || { id: '1' },
      body: opts.body || { status: 'CONFIRMED' },
      user: opts.user || { user_id: 4, role: 'PROVIDER' },
      db
    },
    db
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 5 Test Suite A: Route Registration & Input Validation
// ─────────────────────────────────────────────────────────────────────────────
describe('PATCH /api/bookings/:id/status — Registration & Input Validation', () => {
  it('registers route with PROVIDER and ADMIN roles', () => {
    assert.ok(statusRoute, 'PATCH /api/bookings/:id/status must be registered');
    assert.deepEqual(statusRoute.roles, ['PROVIDER', 'ADMIN']);
  });

  it('rejects invalid booking ID with 400 BAD_REQUEST', async () => {
    for (const badId of ['abc', '0', '-1', '1.5', '  ']) {
      const { ctx } = makeStatusCtx({ params: { id: badId } });
      await assert.rejects(
        statusRoute.handler(ctx),
        err => err.status === 400 && err.code === 'BAD_REQUEST'
      );
    }
  });

  it('rejects missing or empty status in body with 400 VALIDATION_ERROR', async () => {
    const { ctx } = makeStatusCtx({ body: {} });
    await assert.rejects(
      statusRoute.handler(ctx),
      err => err.status === 400 && err.code === 'VALIDATION_ERROR'
    );
  });

  it('rejects invalid status values (not in valid booking statuses) with 400 VALIDATION_ERROR', async () => {
    for (const badStatus of ['APPROVED', 'REJECTED', 'UNKNOWN', '123', 'active']) {
      const { ctx } = makeStatusCtx({ body: { status: badStatus } });
      await assert.rejects(
        statusRoute.handler(ctx),
        err => err.status === 400 && err.code === 'VALIDATION_ERROR'
      );
    }
  });

  it('throws 404 NOT_FOUND if booking does not exist', async () => {
    const db = makeStatusDb({ noBooking: true });
    const { ctx } = makeStatusCtx({ db });
    await assert.rejects(
      statusRoute.handler(ctx),
      err => err.status === 404 && err.code === 'NOT_FOUND'
    );
  });

  it('throws 404 NOT_FOUND if package availability does not exist', async () => {
    const db = makeStatusDb({ noAvail: true });
    const { ctx } = makeStatusCtx({ db });
    await assert.rejects(
      statusRoute.handler(ctx),
      err => err.status === 404 && err.code === 'NOT_FOUND'
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Step 5 Test Suite B: Role-Based Authorization
// ─────────────────────────────────────────────────────────────────────────────
describe('PATCH /api/bookings/:id/status — Authorization Checks', () => {
  it('allows provider who owns the package to update booking status', async () => {
    // booking belongs to provider 4, user is provider 4
    const db = makeStatusDb({ providerId: 4, bookingStatus: 'PENDING' });
    const { ctx } = makeStatusCtx({
      db,
      user: { user_id: 4, role: 'PROVIDER' },
      body: { status: 'CONFIRMED' }
    });

    const result = await statusRoute.handler(ctx);
    assert.equal(result.status, 200);
    assert.equal(result.data.booking_status, 'CONFIRMED');
  });

  it('rejects provider who does not own the package with 403 FORBIDDEN', async () => {
    // booking belongs to provider 4, caller is provider 5
    const db = makeStatusDb({ providerId: 4 });
    const { ctx } = makeStatusCtx({
      db,
      user: { user_id: 5, role: 'PROVIDER' },
      body: { status: 'CONFIRMED' }
    });

    await assert.rejects(
      statusRoute.handler(ctx),
      err => err.status === 403 && err.code === 'FORBIDDEN'
    );
  });

  it('rejects customer caller with 403 FORBIDDEN', async () => {
    const db = makeStatusDb();
    const { ctx } = makeStatusCtx({
      db,
      user: { user_id: 7, role: 'CUSTOMER' },
      body: { status: 'CONFIRMED' }
    });

    await assert.rejects(
      statusRoute.handler(ctx),
      err => err.status === 403 && err.code === 'FORBIDDEN'
    );
  });

  it('allows admin with MANAGE_BOOKINGS permission to update booking status', async () => {
    const db = makeStatusDb({ providerId: 4, bookingStatus: 'PENDING' });
    const { ctx } = makeStatusCtx({
      db,
      user: { user_id: 2, role: 'ADMIN', permissions: ['MANAGE_BOOKINGS'] },
      body: { status: 'CONFIRMED' }
    });

    const result = await statusRoute.handler(ctx);
    assert.equal(result.status, 200);
    assert.equal(result.data.booking_status, 'CONFIRMED');
  });

  it('rejects admin WITHOUT MANAGE_BOOKINGS permission with 403 FORBIDDEN', async () => {
    const db = makeStatusDb();
    const { ctx } = makeStatusCtx({
      db,
      user: { user_id: 3, role: 'ADMIN', permissions: ['MANAGE_USERS'] },
      body: { status: 'CONFIRMED' }
    });

    await assert.rejects(
      statusRoute.handler(ctx),
      err => err.status === 403 && err.code === 'FORBIDDEN'
    );
  });

  it('allows SUPER_ADMIN unconditionally to update booking status', async () => {
    const db = makeStatusDb({ providerId: 4, bookingStatus: 'PENDING' });
    const { ctx } = makeStatusCtx({
      db,
      user: { user_id: 1, role: 'SUPER_ADMIN', permissions: ['*'] },
      body: { status: 'CONFIRMED' }
    });

    const result = await statusRoute.handler(ctx);
    assert.equal(result.status, 200);
    assert.equal(result.data.booking_status, 'CONFIRMED');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Step 5 Test Suite C: Status Transitions & Contract Rules
// ─────────────────────────────────────────────────────────────────────────────
describe('PATCH /api/bookings/:id/status — Status Transitions', () => {
  it('PENDING → CONFIRMED succeeds without touching seats or payment', async () => {
    const db = makeStatusDb({ bookingStatus: 'PENDING', paymentStatus: 'UNPAID' });
    const { ctx } = makeStatusCtx({ db, body: { status: 'CONFIRMED' } });

    const result = await statusRoute.handler(ctx);
    assert.equal(result.status, 200);
    assert.equal(result.data.booking_status, 'CONFIRMED');
    assert.equal(result.data.payment_status, 'UNPAID');

    // Must update bookings
    const updateBooking = db.calls.find(c => c.sql.startsWith('UPDATE bookings'));
    assert.ok(updateBooking);
    assert.ok(updateBooking.sql.includes("booking_status = 'CONFIRMED'"));

    // Must NOT touch package_availability or payments
    const updateAvail = db.calls.find(c => c.sql.startsWith('UPDATE package_availability'));
    assert.equal(updateAvail, undefined, 'must not update availability on confirmation');
    const updatePay = db.calls.find(c => c.sql.startsWith('UPDATE payments'));
    assert.equal(updatePay, undefined, 'must not update payments on confirmation');
  });

  it('PENDING → CANCELLED succeeds and restores seats', async () => {
    const db = makeStatusDb({
      bookingStatus: 'PENDING',
      paymentStatus: 'UNPAID',
      seatsAvailable: 6
    });
    const { ctx } = makeStatusCtx({ db, body: { status: 'CANCELLED' } });

    const result = await statusRoute.handler(ctx);
    assert.equal(result.status, 200);
    assert.equal(result.data.booking_status, 'CANCELLED');
    assert.equal(result.data.seats_restored, 2);

    const updateAvail = db.calls.find(c => c.sql.startsWith('UPDATE package_availability'));
    assert.ok(updateAvail);
    assert.equal(updateAvail.params[0], 8); // 6 + 2 = 8
  });

  it('CONFIRMED → COMPLETED succeeds when travel date is today', async () => {
    const db = makeStatusDb({
      bookingStatus: 'CONFIRMED',
      paymentStatus: 'PAID',
      today: '2026-11-05',
      availDate: '2026-11-05' // exactly today
    });
    const { ctx } = makeStatusCtx({ db, body: { status: 'COMPLETED' } });

    const result = await statusRoute.handler(ctx);
    assert.equal(result.status, 200);
    assert.equal(result.data.booking_status, 'COMPLETED');
    assert.equal(result.data.payment_status, 'PAID');

    // No seat restore
    const updateAvail = db.calls.find(c => c.sql.startsWith('UPDATE package_availability'));
    assert.equal(updateAvail, undefined);
  });

  it('CONFIRMED → COMPLETED succeeds when travel date is in the past', async () => {
    const db = makeStatusDb({
      bookingStatus: 'CONFIRMED',
      today: '2026-11-10',
      availDate: '2026-11-05' // 5 days in the past
    });
    const { ctx } = makeStatusCtx({ db, body: { status: 'COMPLETED' } });

    const result = await statusRoute.handler(ctx);
    assert.equal(result.status, 200);
    assert.equal(result.data.booking_status, 'COMPLETED');
  });

  it('CONFIRMED → COMPLETED rejected with 409 CONFLICT when travel date is in the future', async () => {
    const db = makeStatusDb({
      bookingStatus: 'CONFIRMED',
      today: '2026-11-01',
      availDate: '2026-11-05' // 4 days in future
    });
    const { ctx } = makeStatusCtx({ db, body: { status: 'COMPLETED' } });

    await assert.rejects(
      statusRoute.handler(ctx),
      err => err.status === 409 && err.code === 'CONFLICT' && err.message.includes('travel date')
    );
  });

  it('CONFIRMED → CANCELLED succeeds and restores seats', async () => {
    const db = makeStatusDb({
      bookingStatus: 'CONFIRMED',
      paymentStatus: 'PAID',
      seatsAvailable: 5
    });
    const { ctx } = makeStatusCtx({ db, body: { status: 'CANCELLED' } });

    const result = await statusRoute.handler(ctx);
    assert.equal(result.status, 200);
    assert.equal(result.data.booking_status, 'CANCELLED');
    assert.equal(result.data.payment_status, 'REFUNDED');
    assert.equal(result.data.seats_restored, 2);
  });

  it('PENDING → COMPLETED is rejected with 409 CONFLICT', async () => {
    const db = makeStatusDb({ bookingStatus: 'PENDING', today: '2026-11-10', availDate: '2026-11-05' });
    const { ctx } = makeStatusCtx({ db, body: { status: 'COMPLETED' } });

    await assert.rejects(
      statusRoute.handler(ctx),
      err => err.status === 409 && err.code === 'CONFLICT'
    );
  });

  it('COMPLETED booking is terminal — any transition rejected with 409 CONFLICT', async () => {
    for (const targetStatus of ['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED']) {
      const db = makeStatusDb({ bookingStatus: 'COMPLETED' });
      const { ctx } = makeStatusCtx({ db, body: { status: targetStatus } });

      await assert.rejects(
        statusRoute.handler(ctx),
        err => err.status === 409 && err.code === 'CONFLICT' && err.message.includes('COMPLETED')
      );
    }
  });

  it('CANCELLED booking is terminal — any transition rejected with 409 CONFLICT', async () => {
    for (const targetStatus of ['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED']) {
      const db = makeStatusDb({ bookingStatus: 'CANCELLED' });
      const { ctx } = makeStatusCtx({ db, body: { status: targetStatus } });

      await assert.rejects(
        statusRoute.handler(ctx),
        err => err.status === 409 && err.code === 'CONFLICT' && err.message.includes('CANCELLED')
      );
    }
  });

  it('PENDING → PENDING or CONFIRMED → CONFIRMED rejected with 409 CONFLICT', async () => {
    const dbPending = makeStatusDb({ bookingStatus: 'PENDING' });
    const { ctx: ctxPending } = makeStatusCtx({ db: dbPending, body: { status: 'PENDING' } });
    await assert.rejects(
      statusRoute.handler(ctxPending),
      err => err.status === 409 && err.code === 'CONFLICT'
    );

    const dbConfirmed = makeStatusDb({ bookingStatus: 'CONFIRMED' });
    const { ctx: ctxConfirmed } = makeStatusCtx({ db: dbConfirmed, body: { status: 'CONFIRMED' } });
    await assert.rejects(
      statusRoute.handler(ctxConfirmed),
      err => err.status === 409 && err.code === 'CONFLICT'
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Step 5 Test Suite D: Cancellation Side Effects (Seats, Refunds, Atomicity)
// ─────────────────────────────────────────────────────────────────────────────
describe('PATCH /api/bookings/:id/status — Cancellation Side Effects', () => {
  it('FULL availability becomes OPEN after provider cancellation', async () => {
    const db = makeStatusDb({
      bookingStatus: 'CONFIRMED',
      availStatus: 'FULL',
      seatsAvailable: 0
    });
    const { ctx } = makeStatusCtx({ db, body: { status: 'CANCELLED' } });

    await statusRoute.handler(ctx);

    const updateAvail = db.calls.find(c => c.sql.startsWith('UPDATE package_availability'));
    assert.ok(updateAvail);
    assert.equal(updateAvail.params[0], 2); // 0 + 2 = 2
    assert.equal(updateAvail.params[1], 'OPEN'); // FULL becomes OPEN
  });

  it('CLOSED availability remains CLOSED after provider cancellation', async () => {
    const db = makeStatusDb({
      bookingStatus: 'PENDING',
      availStatus: 'CLOSED',
      seatsAvailable: 3
    });
    const { ctx } = makeStatusCtx({ db, body: { status: 'CANCELLED' } });

    await statusRoute.handler(ctx);

    const updateAvail = db.calls.find(c => c.sql.startsWith('UPDATE package_availability'));
    assert.ok(updateAvail);
    assert.equal(updateAvail.params[0], 5); // 3 + 2 = 5
    assert.equal(updateAvail.params[1], 'CLOSED'); // remains CLOSED
  });

  it('PAID booking cancellation updates payments table to REFUNDED', async () => {
    const db = makeStatusDb({
      bookingStatus: 'CONFIRMED',
      paymentStatus: 'PAID'
    });
    const { ctx } = makeStatusCtx({ db, body: { status: 'CANCELLED' } });

    const result = await statusRoute.handler(ctx);
    assert.equal(result.data.payment_status, 'REFUNDED');

    const updatePayments = db.calls.find(c => c.sql.startsWith('UPDATE payments'));
    assert.ok(updatePayments, 'must update payments table for PAID booking');
    assert.equal(updatePayments.params[0], 1); // booking_id
  });

  it('UNPAID booking cancellation does NOT update payments table', async () => {
    const db = makeStatusDb({
      bookingStatus: 'PENDING',
      paymentStatus: 'UNPAID'
    });
    const { ctx } = makeStatusCtx({ db, body: { status: 'CANCELLED' } });

    const result = await statusRoute.handler(ctx);
    assert.equal(result.data.payment_status, 'UNPAID');

    const updatePayments = db.calls.find(c => c.sql.startsWith('UPDATE payments'));
    assert.equal(updatePayments, undefined, 'must not touch payments table for UNPAID booking');
  });

  it('repeated cancellation cannot restore seats twice (terminal status guard)', async () => {
    // If booking is already CANCELLED, second attempt is blocked before any UPDATE
    const db = makeStatusDb({
      bookingStatus: 'CANCELLED',
      seatsAvailable: 10
    });
    const { ctx } = makeStatusCtx({ db, body: { status: 'CANCELLED' } });

    await assert.rejects(
      statusRoute.handler(ctx),
      err => err.status === 409 && err.code === 'CONFLICT'
    );

    const updateAvail = db.calls.find(c => c.sql.startsWith('UPDATE package_availability'));
    assert.equal(updateAvail, undefined, 'must not update availability on second cancel');
  });

  it('transaction rollback: error in UPDATE bookings rolls back all changes', async () => {
    const db = makeStatusDb({
      bookingStatus: 'CONFIRMED',
      updateBookingsFails: true
    });
    const { ctx } = makeStatusCtx({ db, body: { status: 'CANCELLED' } });

    await assert.rejects(
      statusRoute.handler(ctx),
      err => err.message === 'simulated bookings update failure'
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Step 5 Test Suite E: Provider Booking Listing Verification
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/provider/bookings — Provider Booking Listing Verification', () => {
  function makeProviderListContext(opts = {}) {
    const calls = [];
    const db = {
      calls,
      async query(sql, params = []) {
        calls.push({ sql: sql.trim(), params });
        if (sql.includes('COUNT(*)')) {
          return [{ total: opts.total !== undefined ? opts.total : 1 }];
        }
        if (sql.includes('FROM bookings b') && sql.includes('JOIN tour_packages p')) {
          return opts.rows || [
            {
              booking_id: 1,
              customer_id: 7,
              customer_name: 'Anita Sharma',
              customer_mobile: '9876543210',
              package_id: 1,
              package_title: 'Munnar Tea Hills',
              availability_id: 10,
              available_date: '2026-11-05',
              travelers: 2,
              total_amount: '17000.00',
              booking_status: 'PENDING',
              payment_status: 'UNPAID',
              booked_at: new Date('2026-10-25T10:00:00Z')
            }
          ];
        }
        return [];
      }
    };

    const ctx = {
      query: opts.query || {},
      user: opts.user || { user_id: 4, role: 'PROVIDER' },
      db
    };

    return { ctx, calls };
  }

  it('provider sees only their own package bookings (provider isolation)', async () => {
    const { ctx, calls } = makeProviderListContext({ user: { user_id: 4, role: 'PROVIDER' } });
    const result = await providerBookingsRoute.handler(ctx);

    const countCall = calls.find(c => c.sql.includes('COUNT(*)'));
    assert.ok(countCall.sql.includes('p.provider_id = ?'));
    assert.equal(countCall.params[0], 4);

    const dataCall = calls.find(c => c.sql.includes('FROM bookings b') && c.sql.includes('LIMIT'));
    assert.ok(dataCall.sql.includes('p.provider_id = ?'));
    assert.equal(dataCall.params[0], 4);

    assert.equal(result.data.length, 1);
    assert.equal(result.data[0].customer_name, 'Anita Sharma');
    assert.equal(result.data[0].customer_mobile, '9876543210');
  });

  it('pagination works correctly with page and pageSize', async () => {
    const { ctx, calls } = makeProviderListContext({
      query: { page: '2', pageSize: '15' }
    });
    const result = await providerBookingsRoute.handler(ctx);

    assert.equal(result.meta.page, 2);
    assert.equal(result.meta.pageSize, 15);

    const dataCall = calls.find(c => c.sql.includes('LIMIT ? OFFSET ?'));
    assert.ok(dataCall);
    // params: [provider_id, pageSize, offset] -> offset for page 2, pageSize 15 is 15
    assert.equal(dataCall.params[1], 15);
    assert.equal(dataCall.params[2], 15);
  });

  it('status filter filters bookings by status', async () => {
    const { ctx, calls } = makeProviderListContext({
      query: { status: 'CONFIRMED' }
    });
    await providerBookingsRoute.handler(ctx);

    const dataCall = calls.find(c => c.sql.includes('FROM bookings b') && c.sql.includes('LIMIT'));
    assert.ok(dataCall.sql.includes('b.booking_status = ?'));
    assert.ok(dataCall.params.includes('CONFIRMED'));
  });

  it('package_id filter filters bookings by package', async () => {
    const { ctx, calls } = makeProviderListContext({
      query: { package_id: '3' }
    });
    await providerBookingsRoute.handler(ctx);

    const dataCall = calls.find(c => c.sql.includes('FROM bookings b') && c.sql.includes('LIMIT'));
    assert.ok(dataCall.sql.includes('b.package_id = ?'));
    assert.ok(dataCall.params.includes(3));
  });

  it('customer information (name and mobile) follows the contract', async () => {
    const { ctx } = makeProviderListContext();
    const result = await providerBookingsRoute.handler(ctx);

    const row = result.data[0];
    assert.equal(row.customer_name, 'Anita Sharma');
    assert.equal(row.customer_mobile, '9876543210');
    // Ensure customer email/password is NOT leaked in provider listing
    assert.equal(row.customer_email, undefined);
    assert.equal(row.password_hash, undefined);
  });
});
