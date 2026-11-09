'use strict';
/**
 * bookings.cancel.pay.test.js — Extended Day 3 tests for:
 *   POST /api/bookings/:id/cancel
 *   POST /api/bookings/:id/pay
 *
 * Uses Node's built-in node:test + node:assert/strict.
 * All tests are fully offline (mocked db, no MySQL connection).
 *
 * Rules sourced from docs/CONTRACT.md and database/schema.sql.
 * M3-owned. Do not modify M1/M2 files.
 *
 * Run: node --test tests/bookings.cancel.pay.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const routes = require('../server/routes/bookings.routes');

const cancelRoute = routes.find(
  r => r.method === 'POST' && r.path === '/api/bookings/:id/cancel'
);
const payRoute = routes.find(
  r => r.method === 'POST' && r.path === '/api/bookings/:id/pay'
);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a mock db whose .transaction(cb) passes a tx object to cb.
 * The tx object's .query() routes responses by SQL fragment so we can
 * inspect every call without a real DB.
 *
 * cancelBooking and processBookingPayment call ctx.db.transaction() directly —
 * the mock must provide that method to satisfy production requirements.
 */
function makeCancelDb(opts = {}) {
  const calls = [];

  const booking = opts.booking || {
    booking_id: 1,
    customer_id: 7,
    package_id: 1,
    availability_id: 10,
    travelers: 2,
    total_amount: '17000.00',
    booking_status: 'PENDING',
    payment_status: 'UNPAID'
  };

  const avail = opts.avail || {
    availability_id: 10,
    package_id: 1,
    available_date: opts.availDate || '2099-12-31', // far future — eligible by default
    seats_available: 8,
    status: opts.availStatus || 'OPEN'
  };

  // tx object: handles all SQL inside the transaction
  const tx = {
    async query(sql, params = []) {
      calls.push({ sql: sql.trim(), params });

      // Booking lock (FOR UPDATE)
      if (sql.includes('FROM bookings') && sql.includes('FOR UPDATE')) {
        if (opts.noBooking) return [];
        return [booking];
      }

      // Availability lock (FOR UPDATE)
      if (sql.includes('FROM package_availability') && sql.includes('FOR UPDATE')) {
        if (opts.noAvail) return [];
        return [avail];
      }

      // cancellation_window_days setting
      if (sql.includes('system_settings')) {
        const w = opts.windowDays !== undefined ? opts.windowDays : 2;
        return [{ setting_value: String(w) }];
      }

      // Today's date
      if (sql.includes('CURDATE()')) {
        return [{ today: opts.today || '2026-10-31' }];
      }

      // UPDATE package_availability (seat restore)
      if (sql.includes('UPDATE package_availability')) {
        if (opts.updateAvailFails) throw new Error('simulated availability update failure');
        return { affectedRows: 1 };
      }

      // UPDATE payments (refund)
      if (sql.includes('UPDATE payments')) {
        return { affectedRows: 1 };
      }

      // UPDATE bookings (cancel)
      if (sql.includes('UPDATE bookings')) {
        if (opts.updateBookingFails) throw new Error('simulated booking update failure');
        return { affectedRows: 1 };
      }

      throw new Error('Unexpected SQL in cancelDb tx: ' + sql);
    }
  };

  // db: exposes .transaction() (required by production handlers)
  // and .query() for logAction (called outside the transaction)
  const db = {
    calls,
    async transaction(cb) {
      return cb(tx);
    },
    async query(sql, params = []) {
      // logAction writes to system_logs outside the transaction — silently ignore it.
      calls.push({ sql: sql.trim(), params });
      return { affectedRows: 0, insertId: 0 };
    }
  };

  return db;
}

function makeCancelCtx(opts = {}) {
  const db = opts.db || makeCancelDb(opts.dbOpts);
  return {
    ctx: {
      params: opts.params || { id: '1' },
      user: opts.user || { user_id: 7, role: 'CUSTOMER' },
      db
    },
    db
  };
}

function makePayDb(opts = {}) {
  const calls = [];

  const booking = opts.booking || {
    booking_id: 1,
    customer_id: 7,
    total_amount: '17000.00',
    booking_status: 'PENDING',
    payment_status: 'UNPAID'
  };

  let insertIdCounter = 55;

  // tx object: handles all SQL inside the transaction
  const tx = {
    async query(sql, params = []) {
      calls.push({ sql: sql.trim(), params });

      // Booking lock
      if (sql.includes('FROM bookings') && sql.includes('FOR UPDATE')) {
        if (opts.noBooking) return [];
        return [booking];
      }

      // INSERT INTO payments
      if (sql.includes('INSERT INTO payments')) {
        if (opts.insertFails) {
          const err = new Error('Duplicate entry');
          err.code = 'ER_DUP_ENTRY';
          throw err;
        }
        return { insertId: ++insertIdCounter, affectedRows: 1 };
      }

      // UPDATE bookings (set PAID)
      if (sql.includes('UPDATE bookings')) {
        if (opts.updateFails) throw new Error('simulated update failure');
        return { affectedRows: 1 };
      }

      throw new Error('Unexpected SQL in payDb tx: ' + sql);
    }
  };

  // db: exposes .transaction() (required by production handlers)
  // and .query() for logAction (called outside the transaction)
  const db = {
    calls,
    async transaction(cb) {
      return cb(tx);
    },
    async query(sql, params = []) {
      // logAction writes to system_logs outside the transaction — silently ignore it.
      calls.push({ sql: sql.trim(), params });
      return { affectedRows: 0, insertId: 0 };
    }
  };

  return db;
}

function makePayCtx(opts = {}) {
  const db = opts.db || makePayDb(opts.dbOpts);
  return {
    ctx: {
      params: opts.params || { id: '1' },
      body: opts.body || { payment_method: 'UPI' },
      user: opts.user || { user_id: 7, role: 'CUSTOMER' },
      db
    },
    db
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/bookings/:id/cancel — extended tests
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/bookings/:id/cancel — cancellation logic', () => {

  it('CAN-01 successful cancellation of PENDING UNPAID booking restores seats', async () => {
    const db = makeCancelDb({
      booking: {
        booking_id: 1,
        customer_id: 7,
        package_id: 1,
        availability_id: 10,
        travelers: 2,
        total_amount: '17000.00',
        booking_status: 'PENDING',
        payment_status: 'UNPAID'
      },
      avail: {
        availability_id: 10,
        package_id: 1,
        available_date: '2099-12-31',
        seats_available: 8,
        status: 'OPEN'
      }
    });

    const { ctx } = makeCancelCtx({ db });
    const result = await cancelRoute.handler(ctx);

    assert.equal(result.status, 200);
    assert.equal(result.data.booking_status, 'CANCELLED');
    assert.equal(result.data.payment_status, 'UNPAID');
    assert.equal(result.data.seats_restored, 2);
    assert.equal(result.data.booking_id, 1);

    // Seat restore: 8 + 2 = 10, status remains OPEN (was OPEN)
    const updateAvail = db.calls.find(c =>
      c.sql.startsWith('UPDATE package_availability')
    );
    assert.ok(updateAvail, 'should UPDATE package_availability');
    assert.equal(updateAvail.params[0], 10); // newSeats
    assert.equal(updateAvail.params[1], 'OPEN'); // status stays OPEN
    assert.equal(updateAvail.params[2], 10); // availability_id

    // Booking UPDATE must set CANCELLED
    const updateBooking = db.calls.find(c =>
      c.sql.startsWith('UPDATE bookings')
    );
    assert.ok(updateBooking, 'should UPDATE bookings');
    assert.equal(updateBooking.params[0], 'UNPAID');
    assert.equal(updateBooking.params[1], 1);
  });

  it('CAN-02 successful cancellation of CONFIRMED PAID booking refunds payment', async () => {
    const db = makeCancelDb({
      booking: {
        booking_id: 3,
        customer_id: 7,
        package_id: 1,
        availability_id: 10,
        travelers: 3,
        total_amount: '25500.00',
        booking_status: 'CONFIRMED',
        payment_status: 'PAID'
      },
      avail: {
        availability_id: 10,
        package_id: 1,
        available_date: '2099-12-31',
        seats_available: 5,
        status: 'OPEN'
      }
    });

    const { ctx } = makeCancelCtx({ db, params: { id: '3' } });
    const result = await cancelRoute.handler(ctx);

    assert.equal(result.status, 200);
    assert.equal(result.data.booking_status, 'CANCELLED');
    assert.equal(result.data.payment_status, 'REFUNDED');
    assert.equal(result.data.seats_restored, 3);

    // payments table must be updated to REFUNDED
    const updatePayments = db.calls.find(c =>
      c.sql.startsWith('UPDATE payments')
    );
    assert.ok(updatePayments, 'should UPDATE payments to REFUNDED');

    // booking payment_status must also be REFUNDED
    const updateBooking = db.calls.find(c =>
      c.sql.startsWith('UPDATE bookings')
    );
    assert.equal(updateBooking.params[0], 'REFUNDED');
  });

  it('CAN-05 UNPAID booking cancellation does NOT touch payments table', async () => {
    const db = makeCancelDb();  // default: UNPAID PENDING
    const { ctx } = makeCancelCtx({ db });
    await cancelRoute.handler(ctx);

    const paymentUpdate = db.calls.find(c => c.sql.startsWith('UPDATE payments'));
    assert.equal(paymentUpdate, undefined, 'must not UPDATE payments for UNPAID booking');
  });

  it('CAN-06 FULL availability becomes OPEN after seat restoration', async () => {
    const db = makeCancelDb({
      avail: {
        availability_id: 10,
        package_id: 1,
        available_date: '2099-12-31',
        seats_available: 0,
        status: 'FULL'
      }
    });

    const { ctx } = makeCancelCtx({ db });
    await cancelRoute.handler(ctx);

    const updateAvail = db.calls.find(c =>
      c.sql.startsWith('UPDATE package_availability')
    );
    assert.equal(updateAvail.params[1], 'OPEN', 'FULL availability must become OPEN');
    assert.equal(updateAvail.params[0], 2, 'seats must be restored: 0 + 2 = 2');
  });

  it('CAN-07 CLOSED availability stays CLOSED after seat restoration', async () => {
    const db = makeCancelDb({
      avail: {
        availability_id: 10,
        package_id: 1,
        available_date: '2099-12-31',
        seats_available: 3,
        status: 'CLOSED'
      }
    });

    const { ctx } = makeCancelCtx({ db });
    await cancelRoute.handler(ctx);

    const updateAvail = db.calls.find(c =>
      c.sql.startsWith('UPDATE package_availability')
    );
    assert.equal(updateAvail.params[1], 'CLOSED', 'CLOSED availability must stay CLOSED');
  });

  it('CAN-08 cancellation inside window (1 day away, window=2) returns 409 CONFLICT', async () => {
    const db = makeCancelDb({
      today: '2026-11-10',
      availDate: '2026-11-11', // only 1 day away, window=2
      avail: {
        availability_id: 10,
        package_id: 1,
        available_date: '2026-11-11',
        seats_available: 8,
        status: 'OPEN'
      }
    });

    const { ctx } = makeCancelCtx({ db });
    await assert.rejects(
      cancelRoute.handler(ctx),
      err => err.status === 409 && err.code === 'CONFLICT'
    );
  });

  it('CAN-09 cancellation exactly at window boundary (2 days away) succeeds', async () => {
    const db = makeCancelDb({
      today: '2026-11-10',
      avail: {
        availability_id: 10,
        package_id: 1,
        available_date: '2026-11-12', // exactly 2 days away
        seats_available: 8,
        status: 'OPEN'
      }
    });

    const { ctx } = makeCancelCtx({ db });
    const result = await cancelRoute.handler(ctx);
    assert.equal(result.status, 200);
    assert.equal(result.data.booking_status, 'CANCELLED');
  });

  it('CAN-10 cancellation outside window (30 days away) succeeds', async () => {
    const db = makeCancelDb({
      today: '2026-11-01',
      avail: {
        availability_id: 10,
        package_id: 1,
        available_date: '2026-12-01', // 30 days away
        seats_available: 8,
        status: 'OPEN'
      }
    });

    const { ctx } = makeCancelCtx({ db });
    const result = await cancelRoute.handler(ctx);
    assert.equal(result.status, 200);
  });

  it('CAN-11 repeated cancellation attempt is rejected — already CANCELLED returns 409', async () => {
    // The first cancellation would have set booking_status = CANCELLED.
    // A second call fetches that CANCELLED booking and hits the status guard.
    const db = makeCancelDb({
      booking: {
        booking_id: 1,
        customer_id: 7,
        package_id: 1,
        availability_id: 10,
        travelers: 2,
        total_amount: '17000.00',
        booking_status: 'CANCELLED',
        payment_status: 'REFUNDED'
      }
    });

    const { ctx } = makeCancelCtx({ db });
    await assert.rejects(
      cancelRoute.handler(ctx),
      err => err.status === 409 && err.code === 'CONFLICT'
    );

    // Seat restore must NOT have been called
    const updateAvail = db.calls.find(c =>
      c.sql.startsWith('UPDATE package_availability')
    );
    assert.equal(updateAvail, undefined, 'must not restore seats for already-CANCELLED booking');
  });

  it('CAN-12 correct seat count: seats restored equals booking.travelers', async () => {
    const travelers = 5;
    const initialSeats = 3;

    const db = makeCancelDb({
      booking: {
        booking_id: 1,
        customer_id: 7,
        package_id: 1,
        availability_id: 10,
        travelers,
        total_amount: '25000.00',
        booking_status: 'PENDING',
        payment_status: 'UNPAID'
      },
      avail: {
        availability_id: 10,
        package_id: 1,
        available_date: '2099-12-31',
        seats_available: initialSeats,
        status: 'OPEN'
      }
    });

    const { ctx } = makeCancelCtx({ db });
    const result = await cancelRoute.handler(ctx);

    assert.equal(result.data.seats_restored, travelers);

    const updateAvail = db.calls.find(c =>
      c.sql.startsWith('UPDATE package_availability')
    );
    assert.equal(updateAvail.params[0], initialSeats + travelers); // 3 + 5 = 8
  });

  it('CAN-13 transaction rollback: error during UPDATE bookings propagates cleanly', async () => {
    const db = makeCancelDb({ updateBookingFails: true });
    const { ctx } = makeCancelCtx({ db });

    await assert.rejects(
      cancelRoute.handler(ctx),
      err => err.message === 'simulated booking update failure'
    );
  });

  it('CAN-14 custom cancellation_window_days from system_settings is respected', async () => {
    // window = 5 days; date is 4 days away → should fail
    const db = makeCancelDb({
      windowDays: 5,
      today: '2026-11-01',
      avail: {
        availability_id: 10,
        package_id: 1,
        available_date: '2026-11-05', // 4 days away
        seats_available: 8,
        status: 'OPEN'
      }
    });

    const { ctx } = makeCancelCtx({ db });
    await assert.rejects(
      cancelRoute.handler(ctx),
      err => err.status === 409 && err.code === 'CONFLICT'
    );
  });

  it('CAN-14b custom window respected: 5 days, date 5 days away → succeeds', async () => {
    const db = makeCancelDb({
      windowDays: 5,
      today: '2026-11-01',
      avail: {
        availability_id: 10,
        package_id: 1,
        available_date: '2026-11-06', // exactly 5 days away
        seats_available: 8,
        status: 'OPEN'
      }
    });

    const { ctx } = makeCancelCtx({ db });
    const result = await cancelRoute.handler(ctx);
    assert.equal(result.status, 200);
  });

  it('CAN-15 availability_id in availability UPDATE matches booking.availability_id', async () => {
    const db = makeCancelDb();
    const { ctx } = makeCancelCtx({ db });
    await cancelRoute.handler(ctx);

    const updateAvail = db.calls.find(c =>
      c.sql.startsWith('UPDATE package_availability')
    );
    // availability_id is the third param: [newSeats, newStatus, availability_id]
    assert.equal(updateAvail.params[2], 10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/bookings/:id/pay — extended tests
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/bookings/:id/pay — payment logic', () => {

  it('PAY-01 successful payment inserts payment record with correct columns', async () => {
    const db = makePayDb();
    const { ctx } = makePayCtx({ db });
    const result = await payRoute.handler(ctx);

    assert.equal(result.status, 200);
    assert.equal(result.data.booking_id, 1);
    assert.equal(result.data.customer_id, 7);
    assert.equal(result.data.amount, 17000);
    assert.equal(result.data.payment_method, 'UPI');
    assert.equal(result.data.payment_status, 'PAID');
    assert.ok(result.data.payment_id > 0);

    // Verify INSERT INTO payments contains the right columns and 'SUCCESS' status
    const insert = db.calls.find(c => c.sql.startsWith('INSERT INTO payments'));
    assert.ok(insert, 'must INSERT INTO payments');
    assert.ok(insert.sql.includes('booking_id'), 'must include booking_id');
    assert.ok(insert.sql.includes('customer_id'), 'must include customer_id');
    assert.ok(insert.sql.includes('amount'), 'must include amount');
    assert.ok(insert.sql.includes('payment_method'), 'must include payment_method');
    assert.ok(insert.sql.includes("'SUCCESS'"), "payment_status must be 'SUCCESS'");

    // Params: [bookingId, customerId, amount, paymentMethod]
    assert.equal(insert.params[0], 1);   // booking_id
    assert.equal(insert.params[1], 7);   // customer_id
    assert.equal(insert.params[3], 'UPI'); // payment_method
  });

  it('PAY-06 booking payment_status is updated to PAID after successful payment', async () => {
    const db = makePayDb();
    const { ctx } = makePayCtx({ db });
    await payRoute.handler(ctx);

    const updateBooking = db.calls.find(c =>
      c.sql.startsWith('UPDATE bookings') && c.sql.includes('payment_status')
    );
    assert.ok(updateBooking, 'must UPDATE bookings.payment_status');
    assert.ok(
      updateBooking.sql.includes("'PAID'"),
      "must set payment_status to 'PAID'"
    );
    assert.equal(updateBooking.params[0], 1); // booking_id
  });

  it('PAY-07 all valid payment methods are accepted: UPI, CARD, NETBANKING, CASH', async () => {
    for (const method of ['UPI', 'CARD', 'NETBANKING', 'CASH']) {
      const db = makePayDb();
      const { ctx } = makePayCtx({ db, body: { payment_method: method } });
      const result = await payRoute.handler(ctx);
      assert.equal(result.status, 200);
      assert.equal(result.data.payment_method, method);
    }
  });

  it('PAY-08 invalid payment methods are rejected with 400 VALIDATION_ERROR', async () => {
    for (const method of ['CRYPTO', 'PAYPAL', 'BITCOIN', '', 'upi']) {
      const ctx = {
        params: { id: '1' },
        body: { payment_method: method },
        user: { user_id: 7, role: 'CUSTOMER' }
      };
      await assert.rejects(
        payRoute.handler(ctx),
        err => err.status === 400 && err.code === 'VALIDATION_ERROR'
      );
    }
  });

  it('PAY-09 payment for nonexistent booking returns 404 NOT_FOUND', async () => {
    const db = makePayDb({ noBooking: true });
    const { ctx } = makePayCtx({ db });
    await assert.rejects(
      payRoute.handler(ctx),
      err => err.status === 404 && err.code === 'NOT_FOUND'
    );
  });

  it('PAY-10 duplicate payment (INSERT fails with ER_DUP_ENTRY) propagates as error', async () => {
    const db = makePayDb({ insertFails: true });
    const { ctx } = makePayCtx({ db });

    // The handler does not catch ER_DUP_ENTRY explicitly;
    // it bubbles up as an unhandled error (the DB's UNIQUE constraint enforces safety).
    await assert.rejects(
      payRoute.handler(ctx),
      err => err.code === 'ER_DUP_ENTRY' || err.message.includes('Duplicate')
    );
  });

  it('PAY-11 transaction rollback: UPDATE bookings failure propagates cleanly', async () => {
    const db = makePayDb({ updateFails: true });
    const { ctx } = makePayCtx({ db });

    await assert.rejects(
      payRoute.handler(ctx),
      err => err.message === 'simulated update failure'
    );
  });

  it('PAY-12 booking_id in SELECT uses FOR UPDATE to lock the row', async () => {
    const db = makePayDb();
    const { ctx } = makePayCtx({ db });
    await payRoute.handler(ctx);

    const lockCall = db.calls.find(c =>
      c.sql.includes('FROM bookings') && c.sql.includes('FOR UPDATE')
    );
    assert.ok(lockCall, 'must use SELECT ... FOR UPDATE to lock booking row');
    assert.deepEqual(lockCall.params, [1]);
  });

  it('PAY-13 response amount is a JS Number, not a string', async () => {
    const db = makePayDb({
      booking: {
        booking_id: 1,
        customer_id: 7,
        total_amount: '15600.00',  // arrives as string from MySQL DECIMAL
        booking_status: 'PENDING',
        payment_status: 'UNPAID'
      }
    });
    const { ctx } = makePayCtx({ db });
    const result = await payRoute.handler(ctx);

    assert.equal(typeof result.data.amount, 'number');
    assert.equal(result.data.amount, 15600);
  });

  it('PAY-14 payment message confirms success', async () => {
    const db = makePayDb();
    const { ctx } = makePayCtx({ db });
    const result = await payRoute.handler(ctx);
    assert.ok(
      typeof result.message === 'string' && result.message.length > 0,
      'must include a success message'
    );
  });

  it('PAY-15 INSERT params include correct booking_id, customer_id, amount, method', async () => {
    const db = makePayDb({
      booking: {
        booking_id: 42,
        customer_id: 9,
        total_amount: '5000.00',
        booking_status: 'CONFIRMED',
        payment_status: 'UNPAID'
      }
    });

    const { ctx } = makePayCtx({
      db,
      params: { id: '42' },
      user: { user_id: 9, role: 'CUSTOMER' },
      body: { payment_method: 'NETBANKING' }
    });

    await payRoute.handler(ctx);

    const insert = db.calls.find(c => c.sql.startsWith('INSERT INTO payments'));
    assert.equal(insert.params[0], 42);     // booking_id
    assert.equal(insert.params[1], 9);      // customer_id
    assert.equal(insert.params[2], '5000.00'); // amount (from booking.total_amount)
    assert.equal(insert.params[3], 'NETBANKING');
  });
});
