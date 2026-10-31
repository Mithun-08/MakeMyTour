
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const routes = require('../server/routes/bookings.routes');

const createRoute = routes.find(
  route => route.method === 'POST' && route.path === '/api/bookings'
);

function makeContext(options = {}) {
  const calls = [];

  const packageRow = options.package || {
    package_id: 1,
    price: '1000.00',
    status: 'APPROVED',
    provider_id: 4,
    provider_status: 'ACTIVE'
  };

  const availabilityRow = options.availability || {
    availability_id: 10,
    package_id: 1,
    available_date: '2026-11-05',
    seats_available: 5,
    status: 'OPEN'
  };

  const tx = {
    async query(sql, params = []) {
      calls.push({ sql, params });

      if (sql.includes('FROM tour_packages')) {
        return options.noPackage ? [] : [packageRow];
      }

      if (sql.includes('FROM system_settings')) {
        return [{ setting_value: '10' }];
      }

      if (sql.includes('FROM package_availability')) {
        if (options.noAvailability) return [];

        const requestedPackageId = params[1];

        if (availabilityRow.package_id !== requestedPackageId) {
          return [];
        }

        return [availabilityRow];
      }

      if (sql.includes('CURDATE()')) {
        return [{ today: '2026-10-30' }];
      }

      if (sql.includes('UPDATE package_availability')) {
        return { affectedRows: 1 };
      }

      if (sql.includes('INSERT INTO bookings')) {
        return { insertId: 123, affectedRows: 1 };
      }

      throw new Error('Unexpected SQL: ' + sql);
    }
  };

  const ctx = {
    body: {
      package_id: 1,
      availability_id: 10,
      travelers: 2
    },
    user: { user_id: 7, role: 'CUSTOMER' },
    db: {
      async transaction(callback) {
        return callback(tx);
      },
      async query() {
        return { affectedRows: 1 };
      }
    }
  };

  return { ctx, calls };
}

describe('POST /api/bookings', () => {
  it('is restricted to CUSTOMER role', () => {
    assert.deepEqual(createRoute.roles, ['CUSTOMER']);
  });

  it('creates a booking and reduces available seats', async () => {
    const { ctx, calls } = makeContext();

    const result = await createRoute.handler(ctx);

    assert.equal(result.status, 201);
    assert.equal(result.data.booking_id, 123);
    assert.equal(result.data.total_amount, 2000);
    assert.equal(result.data.booking_status, 'PENDING');
    assert.equal(result.data.payment_status, 'UNPAID');

    const update = calls.find(call =>
      call.sql.includes('UPDATE package_availability')
    );

    assert.deepEqual(update.params, [3, 'OPEN', 10]);
  });

  it('rejects an unapproved package', async () => {
    const { ctx } = makeContext({
      package: {
        package_id: 1,
        price: '1000.00',
        status: 'PENDING',
        provider_id: 4,
        provider_status: 'ACTIVE'
      }
    });

    await assert.rejects(
      createRoute.handler(ctx),
      error => error.status === 409
    );
  });

  it('rejects an inactive provider', async () => {
    const { ctx } = makeContext({
      package: {
        package_id: 1,
        price: '1000.00',
        status: 'APPROVED',
        provider_id: 4,
        provider_status: 'PENDING'
      }
    });

    await assert.rejects(
      createRoute.handler(ctx),
      error => error.status === 409
    );
  });

  it('rejects a mismatched package and availability pair', async () => {
    const { ctx } = makeContext({
      availability: {
        availability_id: 10,
        package_id: 99,
        available_date: '2026-11-05',
        seats_available: 5,
        status: 'OPEN'
      }
    });

    await assert.rejects(
      createRoute.handler(ctx),
      error => error.status === 409
    );
  });

  it('rejects insufficient seats', async () => {
    const { ctx } = makeContext({
      availability: {
        availability_id: 10,
        package_id: 1,
        available_date: '2026-11-05',
        seats_available: 1,
        status: 'OPEN'
      }
    });

    await assert.rejects(
      createRoute.handler(ctx),
      error => error.status === 409
    );
  });

  it('rejects closed availability', async () => {
    const { ctx } = makeContext({
      availability: {
        availability_id: 10,
        package_id: 1,
        available_date: '2026-11-05',
        seats_available: 5,
        status: 'CLOSED'
      }
    });

    await assert.rejects(
      createRoute.handler(ctx),
      error => error.status === 409
    );
  });

  it('rejects a date in the past', async () => {
    const { ctx } = makeContext({
      availability: {
        availability_id: 10,
        package_id: 1,
        available_date: '2026-10-29',
        seats_available: 5,
        status: 'OPEN'
      }
    });

    await assert.rejects(
      createRoute.handler(ctx),
      error => error.status === 409
    );
  });

  it('rejects missing required fields', async () => {
    const { ctx } = makeContext();
    ctx.body = {};

    await assert.rejects(
      createRoute.handler(ctx),
      error => error.status === 400
    );
  });
});
