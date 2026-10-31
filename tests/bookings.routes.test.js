
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const routes = require('../server/routes/bookings.routes');

const createRoute = routes.find(
  route => route.method === 'POST' && route.path === '/api/bookings'
);

const mineRoute = routes.find(
  route => route.method === 'GET' && route.path === '/api/bookings/mine'
);

const idRoute = routes.find(
  route => route.method === 'GET' && route.path === '/api/bookings/:id'
);

const providerBookingsRoute = routes.find(
  route => route.method === 'GET' && route.path === '/api/provider/bookings'
);

const cancelRoute = routes.find(
  route => route.method === 'POST' && route.path === '/api/bookings/:id/cancel'
);

const payRoute = routes.find(
  route => route.method === 'POST' && route.path === '/api/bookings/:id/pay'
);

const statusRoute = routes.find(
  route => route.method === 'PATCH' && route.path === '/api/bookings/:id/status'
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

function makeMineContext(options = {}) {
  const calls = [];
  const db = {
    async query(sql, params = []) {
      calls.push({ sql, params });

      if (sql.includes('COUNT(*)')) {
        return [{ total: options.total !== undefined ? options.total : 1 }];
      }
      if (sql.includes('system_settings')) {
        return [{ setting_value: options.windowDays !== undefined ? String(options.windowDays) : '2' }];
      }
      if (sql.includes('CURDATE()')) {
        return [{ today: options.today || '2026-10-31' }];
      }
      if (sql.includes('FROM bookings b')) {
        return options.rows || [
          {
            booking_id: 1,
            customer_id: 7,
            package_id: 1,
            availability_id: 1,
            travelers: 2,
            total_amount: '17000.00',
            booking_status: 'PENDING',
            payment_status: 'UNPAID',
            booked_at: new Date('2026-10-25T10:00:00Z'),
            package_title: 'Munnar Tea Hills',
            image: '/images/munnar.jpg',
            available_date: '2026-11-07',
            has_review: 0
          }
        ];
      }
      return [];
    }
  };

  const ctx = {
    query: options.query || {},
    user: options.user || { user_id: 7, role: 'CUSTOMER' },
    db
  };

  return { ctx, calls };
}

function makeIdContext(options = {}) {
  const calls = [];
  const defaultBooking = {
    booking_id: 1,
    customer_id: 7,
    package_id: 1,
    availability_id: 1,
    travelers: 2,
    total_amount: '17000.00',
    booking_status: 'PENDING',
    payment_status: 'UNPAID',
    booked_at: new Date('2026-10-25T10:00:00Z'),
    package_title: 'Munnar Tea Hills',
    package_description: 'Scenic hills tour',
    package_price: '8500.00',
    duration_days: 4,
    package_image: '/images/munnar.jpg',
    package_status: 'APPROVED',
    provider_id: 4,
    available_date: '2026-11-07',
    seats_available: 18,
    availability_status: 'OPEN',
    customer_name: 'Anita Sharma',
    customer_email: 'customer1@makemytour.test',
    customer_mobile: '9876543210',
    provider_name: 'Ravi Kumar',
    provider_email: 'provider1@makemytour.test',
    provider_mobile: '9876543211'
  };

  const db = {
    async query(sql, params = []) {
      calls.push({ sql, params });

      if (sql.includes('FROM bookings b')) {
        return options.noBooking ? [] : [options.booking || defaultBooking];
      }
      if (sql.includes('FROM payments')) {
        return options.payments || [];
      }
      if (sql.includes('FROM reviews')) {
        return options.reviews || [];
      }
      if (sql.includes('system_settings')) {
        return [{ setting_value: options.windowDays !== undefined ? String(options.windowDays) : '2' }];
      }
      if (sql.includes('CURDATE()')) {
        return [{ today: options.today || '2026-10-31' }];
      }
      return [];
    }
  };

  const ctx = {
    params: options.params || { id: '1' },
    user: options.user || { user_id: 7, role: 'CUSTOMER' },
    db
  };

  return { ctx, calls };
}

describe('GET /api/bookings/mine', () => {
  it('is restricted to CUSTOMER role', () => {
    assert.deepEqual(mineRoute.roles, ['CUSTOMER']);
  });

  it('returns paginated booking history with total count and meta', async () => {
    const { ctx } = makeMineContext();
    const result = await mineRoute.handler(ctx);

    assert.equal(Array.isArray(result.data), true);
    assert.equal(result.data.length, 1);
    assert.equal(result.data[0].booking_id, 1);
    assert.equal(result.data[0].customer_id, 7);
    assert.equal(result.data[0].package_id, 1);
    assert.equal(result.data[0].total_amount, 17000);
    assert.equal(result.data[0].package_title, 'Munnar Tea Hills');
    assert.equal(result.data[0].available_date, '2026-11-07');
    assert.equal(result.data[0].can_cancel, true);
    assert.equal(result.data[0].can_review, false);
    assert.equal(result.data[0].has_review, false);
    assert.deepEqual(result.meta, { page: 1, pageSize: 10, total: 1 });
  });

  it('filters bookings by status when query parameter is provided', async () => {
    const { ctx, calls } = makeMineContext({ query: { status: 'CONFIRMED' } });
    await mineRoute.handler(ctx);

    const countCall = calls.find(c => c.sql.includes('COUNT(*)'));
    assert.equal(countCall.sql.includes('b.booking_status = ?'), true);
    assert.equal(countCall.params.includes('CONFIRMED'), true);

    const dataCall = calls.find(c => c.sql.includes('FROM bookings b') && c.sql.includes('LIMIT'));
    assert.equal(dataCall.sql.includes('b.booking_status = ?'), true);
    assert.equal(dataCall.params.includes('CONFIRMED'), true);
  });

  it('returns can_review=true and can_cancel=false for COMPLETED booking without review', async () => {
    const { ctx } = makeMineContext({
      rows: [
        {
          booking_id: 7,
          customer_id: 7,
          package_id: 7,
          availability_id: 31,
          travelers: 2,
          total_amount: '44000.00',
          booking_status: 'COMPLETED',
          payment_status: 'PAID',
          booked_at: new Date('2026-10-20T10:00:00Z'),
          package_title: 'Kovalam Beach Retreat',
          image: '/images/kovalam.jpg',
          available_date: '2026-10-22',
          has_review: 0
        }
      ]
    });
    const result = await mineRoute.handler(ctx);

    assert.equal(result.data[0].can_review, true);
    assert.equal(result.data[0].can_cancel, false);
    assert.equal(result.data[0].has_review, false);
  });

  it('returns can_review=false when review already exists on COMPLETED booking', async () => {
    const { ctx } = makeMineContext({
      rows: [
        {
          booking_id: 7,
          customer_id: 7,
          package_id: 7,
          availability_id: 31,
          travelers: 2,
          total_amount: '44000.00',
          booking_status: 'COMPLETED',
          payment_status: 'PAID',
          booked_at: new Date('2026-10-20T10:00:00Z'),
          package_title: 'Kovalam Beach Retreat',
          image: '/images/kovalam.jpg',
          available_date: '2026-10-22',
          has_review: 1
        }
      ]
    });
    const result = await mineRoute.handler(ctx);

    assert.equal(result.data[0].can_review, false);
    assert.equal(result.data[0].has_review, true);
  });

  it('rejects unsupported booking status filter with 400 VALIDATION_ERROR', async () => {
    const { ctx } = makeMineContext({ query: { status: 'INVALID_STATUS' } });
    await assert.rejects(
      mineRoute.handler(ctx),
      err => err.status === 400 && err.code === 'VALIDATION_ERROR'
    );
  });

  it('rejects unapproved status enum values like APPROVED or UNKNOWN with 400 VALIDATION_ERROR', async () => {
    for (const badStatus of ['APPROVED', 'UNKNOWN', '123']) {
      const { ctx } = makeMineContext({ query: { status: badStatus } });
      await assert.rejects(
        mineRoute.handler(ctx),
        err => err.status === 400 && err.code === 'VALIDATION_ERROR'
      );
    }
  });

  it('handles safe default pagination when query params are invalid', async () => {
    const { ctx } = makeMineContext({ query: { page: 'invalid', pageSize: '-5' } });
    const result = await mineRoute.handler(ctx);

    assert.equal(result.meta.page, 1);
    assert.equal(result.meta.pageSize, 10);
  });

  it('strictly rejects partially numeric pagination values such as "2abc" using safe defaults', async () => {
    const { ctx } = makeMineContext({ query: { page: '2abc', pageSize: '15xyz' } });
    const result = await mineRoute.handler(ctx);

    assert.equal(result.meta.page, 1);
    assert.equal(result.meta.pageSize, 10);
  });

  it('handles decimal and zero pagination with safe defaults', async () => {
    const { ctx } = makeMineContext({ query: { page: '1.5', pageSize: '0' } });
    const result = await mineRoute.handler(ctx);

    assert.equal(result.meta.page, 1);
    assert.equal(result.meta.pageSize, 10);
  });

  it('caps pageSize to 50 when a larger number is requested', async () => {
    const { ctx } = makeMineContext({ query: { page: '2', pageSize: '100' } });
    const result = await mineRoute.handler(ctx);

    assert.equal(result.meta.page, 2);
    assert.equal(result.meta.pageSize, 50);
  });
});

describe('GET /api/bookings/:id', () => {
  it('is restricted to CUSTOMER, PROVIDER, and ADMIN roles', () => {
    assert.deepEqual(idRoute.roles, ['CUSTOMER', 'PROVIDER', 'ADMIN']);
  });

  it('rejects invalid or non-numeric booking ID with 400 BAD_REQUEST', async () => {
    const { ctx } = makeIdContext({ params: { id: 'invalid' } });
    await assert.rejects(
      idRoute.handler(ctx),
      err => err.status === 400 && err.code === 'BAD_REQUEST'
    );
  });

  it('strictly rejects partially numeric booking IDs such as "12abc" with 400 BAD_REQUEST', async () => {
    const { ctx } = makeIdContext({ params: { id: '12abc' } });
    await assert.rejects(
      idRoute.handler(ctx),
      err => err.status === 400 && err.code === 'BAD_REQUEST'
    );
  });

  it('strictly rejects decimal booking IDs such as "1.5" with 400 BAD_REQUEST', async () => {
    const { ctx } = makeIdContext({ params: { id: '1.5' } });
    await assert.rejects(
      idRoute.handler(ctx),
      err => err.status === 400 && err.code === 'BAD_REQUEST'
    );
  });

  it('rejects non-positive and negative booking IDs with 400 BAD_REQUEST', async () => {
    for (const badId of ['0', '-1', '-100']) {
      const { ctx } = makeIdContext({ params: { id: badId } });
      await assert.rejects(
        idRoute.handler(ctx),
        err => err.status === 400 && err.code === 'BAD_REQUEST'
      );
    }
  });

  it('throws 404 NOT_FOUND when booking does not exist', async () => {
    const { ctx } = makeIdContext({ noBooking: true });
    await assert.rejects(
      idRoute.handler(ctx),
      err => err.status === 404 && err.code === 'NOT_FOUND'
    );
  });

  it('allows customer owner to view booking and returns payment object (PAY-05)', async () => {
    const { ctx } = makeIdContext({
      params: { id: '3' },
      user: { user_id: 7, role: 'CUSTOMER' },
      booking: {
        booking_id: 3,
        customer_id: 7,
        package_id: 4,
        availability_id: 16,
        travelers: 2,
        total_amount: '15600.00',
        booking_status: 'CONFIRMED',
        payment_status: 'PAID',
        booked_at: new Date('2026-10-26T10:00:00Z'),
        package_title: 'Wayanad Adventure Trek',
        package_description: 'Trekking tour',
        package_price: '7800.00',
        duration_days: 3,
        package_image: '/images/wayanad.jpg',
        package_status: 'APPROVED',
        provider_id: 4,
        available_date: '2026-11-08',
        seats_available: 14,
        availability_status: 'OPEN',
        customer_name: 'Anita Sharma',
        customer_email: 'customer1@makemytour.test',
        customer_mobile: '9876543210',
        provider_name: 'Ravi Kumar',
        provider_email: 'provider1@makemytour.test',
        provider_mobile: '9876543211'
      },
      payments: [
        {
          payment_id: 1,
          booking_id: 3,
          customer_id: 7,
          amount: '15600.00',
          payment_method: 'UPI',
          payment_status: 'SUCCESS',
          paid_at: new Date('2026-10-26T10:05:00Z')
        }
      ]
    });

    const result = await idRoute.handler(ctx);
    assert.equal(result.data.booking_id, 3);
    assert.equal(result.data.payment !== null, true);
    assert.equal(result.data.payment.payment_method, 'UPI');
    assert.equal(result.data.payment.payment_status, 'SUCCESS');
    assert.equal(result.data.payment.amount, 15600);
  });

  it('rejects customer who does not own the booking with 403 FORBIDDEN (RBAC-01)', async () => {
    const { ctx } = makeIdContext({
      params: { id: '1' },
      user: { user_id: 8, role: 'CUSTOMER' }
    });

    await assert.rejects(
      idRoute.handler(ctx),
      err => err.status === 403 && err.code === 'FORBIDDEN'
    );
  });

  it('allows provider who owns the package to view booking (RBAC-02)', async () => {
    const { ctx } = makeIdContext({
      params: { id: '1' },
      user: { user_id: 4, role: 'PROVIDER' }
    });

    const result = await idRoute.handler(ctx);
    assert.equal(result.data.booking_id, 1);
    assert.equal(result.data.provider_name, 'Ravi Kumar');
  });

  it('rejects provider who does not own the package with 403 FORBIDDEN', async () => {
    const { ctx } = makeIdContext({
      params: { id: '1' },
      user: { user_id: 5, role: 'PROVIDER' }
    });

    await assert.rejects(
      idRoute.handler(ctx),
      err => err.status === 403 && err.code === 'FORBIDDEN'
    );
  });

  it('allows admin with MANAGE_BOOKINGS permission to view any booking', async () => {
    const { ctx } = makeIdContext({
      params: { id: '1' },
      user: { user_id: 2, role: 'ADMIN', permissions: ['MANAGE_BOOKINGS'] }
    });

    const result = await idRoute.handler(ctx);
    assert.equal(result.data.booking_id, 1);
  });

  it('rejects admin WITHOUT MANAGE_BOOKINGS permission with 403 FORBIDDEN', async () => {
    const { ctx } = makeIdContext({
      params: { id: '1' },
      user: { user_id: 3, role: 'ADMIN', permissions: ['MANAGE_DESTINATIONS'] }
    });

    await assert.rejects(
      idRoute.handler(ctx),
      err => err.status === 403 && err.code === 'FORBIDDEN'
    );
  });

  it('allows SUPER_ADMIN role unconditionally to view any booking', async () => {
    const { ctx } = makeIdContext({
      params: { id: '1' },
      user: { user_id: 1, role: 'SUPER_ADMIN', permissions: ['*'] }
    });

    const result = await idRoute.handler(ctx);
    assert.equal(result.data.booking_id, 1);
  });

  it('returns payment=null for UNPAID booking without payment record', async () => {
    const { ctx } = makeIdContext({
      params: { id: '1' },
      user: { user_id: 7, role: 'CUSTOMER' },
      payments: []
    });

    const result = await idRoute.handler(ctx);
    assert.equal(result.data.payment, null);
  });
});

function makeProviderContext(options = {}) {
  const calls = [];
  const db = {
    async query(sql, params = []) {
      calls.push({ sql, params });

      if (sql.includes('COUNT(*)')) {
        return [{ total: options.total !== undefined ? options.total : 1 }];
      }
      if (sql.includes('FROM bookings b')) {
        return options.rows || [
          {
            booking_id: 1,
            customer_id: 7,
            package_id: 1,
            availability_id: 1,
            travelers: 2,
            total_amount: '17000.00',
            booking_status: 'PENDING',
            payment_status: 'UNPAID',
            booked_at: new Date('2026-10-25T10:00:00Z'),
            package_title: 'Munnar Tea Hills',
            available_date: '2026-11-07',
            customer_name: 'Anita Sharma',
            customer_mobile: '9876543210'
          }
        ];
      }
      return [];
    }
  };

  const ctx = {
    query: options.query || {},
    user: options.user || { user_id: 4, role: 'PROVIDER' },
    db
  };

  return { ctx, calls };
}

describe('Booking Route Foundation & Registration', () => {
  it('registers all 7 booking foundation routes', () => {
    assert.equal(routes.length, 7);
    assert.equal(createRoute !== undefined, true);
    assert.equal(mineRoute !== undefined, true);
    assert.equal(idRoute !== undefined, true);
    assert.equal(providerBookingsRoute !== undefined, true);
    assert.equal(cancelRoute !== undefined, true);
    assert.equal(payRoute !== undefined, true);
    assert.equal(statusRoute !== undefined, true);
    assert.deepEqual(statusRoute.roles, ['PROVIDER', 'ADMIN']);
  });
});

describe('GET /api/provider/bookings', () => {
  it('is restricted to PROVIDER role', () => {
    assert.deepEqual(providerBookingsRoute.roles, ['PROVIDER']);
  });

  it('filters by provider_id ensuring provider only views own package bookings', async () => {
    const { ctx, calls } = makeProviderContext({ user: { user_id: 4, role: 'PROVIDER' } });
    const result = await providerBookingsRoute.handler(ctx);

    const countCall = calls.find(c => c.sql.includes('COUNT(*)'));
    assert.equal(countCall.sql.includes('p.provider_id = ?'), true);
    assert.equal(countCall.params[0], 4);

    const dataCall = calls.find(c => c.sql.includes('FROM bookings b') && c.sql.includes('LIMIT'));
    assert.equal(dataCall.sql.includes('p.provider_id = ?'), true);
    assert.equal(dataCall.params[0], 4);

    assert.equal(result.data.length, 1);
    assert.equal(result.data[0].customer_name, 'Anita Sharma');
    assert.equal(result.data[0].customer_mobile, '9876543210');
    assert.equal(result.data[0].package_title, 'Munnar Tea Hills');
  });

  it('filters by status and package_id when valid', async () => {
    const { ctx, calls } = makeProviderContext({
      query: { status: 'CONFIRMED', package_id: '1' }
    });
    await providerBookingsRoute.handler(ctx);

    const dataCall = calls.find(c => c.sql.includes('FROM bookings b') && c.sql.includes('LIMIT'));
    assert.equal(dataCall.sql.includes('b.booking_status = ?'), true);
    assert.equal(dataCall.sql.includes('b.package_id = ?'), true);
    assert.equal(dataCall.params.includes('CONFIRMED'), true);
    assert.equal(dataCall.params.includes(1), true);
  });

  it('rejects unsupported status filter with 400 VALIDATION_ERROR', async () => {
    const { ctx } = makeProviderContext({ query: { status: 'INVALID_STATUS' } });
    await assert.rejects(
      providerBookingsRoute.handler(ctx),
      err => err.status === 400 && err.code === 'VALIDATION_ERROR'
    );
  });

  it('rejects invalid package_id with 400 BAD_REQUEST', async () => {
    const { ctx } = makeProviderContext({ query: { package_id: 'xyz' } });
    await assert.rejects(
      providerBookingsRoute.handler(ctx),
      err => err.status === 400 && err.code === 'BAD_REQUEST'
    );
  });
});

describe('POST /api/bookings/:id/cancel foundation', () => {
  it('is restricted to CUSTOMER role', () => {
    assert.deepEqual(cancelRoute.roles, ['CUSTOMER']);
  });

  it('rejects invalid booking ID with 400 BAD_REQUEST', async () => {
    const { ctx } = makeIdContext({ params: { id: 'invalid' } });
    await assert.rejects(
      cancelRoute.handler(ctx),
      err => err.status === 400 && err.code === 'BAD_REQUEST'
    );
  });

  it('throws 404 NOT_FOUND if booking does not exist', async () => {
    const tx = { async query() { return []; } };
    const db = {
      async transaction(cb) { return cb(tx); },
      async query() { return []; }
    };
    const ctx = { params: { id: '999' }, user: { user_id: 7, role: 'CUSTOMER' }, db };

    await assert.rejects(
      cancelRoute.handler(ctx),
      err => err.status === 404 && err.code === 'NOT_FOUND'
    );
  });

  it('throws 403 FORBIDDEN if customer does not own the booking (CAN-04)', async () => {
    const tx = {
      async query() {
        return [{ booking_id: 1, customer_id: 7, booking_status: 'PENDING' }];
      }
    };
    const db = {
      async transaction(cb) { return cb(tx); },
      async query() { return []; }
    };
    const ctx = { params: { id: '1' }, user: { user_id: 8, role: 'CUSTOMER' }, db };

    await assert.rejects(
      cancelRoute.handler(ctx),
      err => err.status === 403 && err.code === 'FORBIDDEN'
    );
  });

  it('throws 409 CONFLICT if booking is COMPLETED (CAN-03)', async () => {
    const tx = {
      async query() {
        return [{ booking_id: 7, customer_id: 7, booking_status: 'COMPLETED' }];
      }
    };
    const db = {
      async transaction(cb) { return cb(tx); },
      async query() { return []; }
    };
    const ctx = { params: { id: '7' }, user: { user_id: 7, role: 'CUSTOMER' }, db };

    await assert.rejects(
      cancelRoute.handler(ctx),
      err => err.status === 409 && err.code === 'CONFLICT'
    );
  });

  it('throws 409 CONFLICT if booking is already CANCELLED', async () => {
    const tx = {
      async query() {
        return [{ booking_id: 5, customer_id: 7, booking_status: 'CANCELLED' }];
      }
    };
    const db = {
      async transaction(cb) { return cb(tx); },
      async query() { return []; }
    };
    const ctx = { params: { id: '5' }, user: { user_id: 7, role: 'CUSTOMER' }, db };

    await assert.rejects(
      cancelRoute.handler(ctx),
      err => err.status === 409 && err.code === 'CONFLICT'
    );
  });
});

describe('POST /api/bookings/:id/pay foundation', () => {
  it('is restricted to CUSTOMER role', () => {
    assert.deepEqual(payRoute.roles, ['CUSTOMER']);
  });

  it('rejects invalid booking ID with 400 BAD_REQUEST', async () => {
    const ctx = { params: { id: 'abc' }, body: { payment_method: 'UPI' }, user: { user_id: 7, role: 'CUSTOMER' } };
    await assert.rejects(
      payRoute.handler(ctx),
      err => err.status === 400 && err.code === 'BAD_REQUEST'
    );
  });

  it('rejects invalid payment method with 400 VALIDATION_ERROR', async () => {
    const ctx = { params: { id: '1' }, body: { payment_method: 'BITCOIN' }, user: { user_id: 7, role: 'CUSTOMER' } };
    await assert.rejects(
      payRoute.handler(ctx),
      err => err.status === 400 && err.code === 'VALIDATION_ERROR'
    );
  });

  it('throws 403 FORBIDDEN if customer does not own the booking (PAY-04)', async () => {
    const tx = {
      async query() {
        return [{ booking_id: 1, customer_id: 7, booking_status: 'PENDING', payment_status: 'UNPAID' }];
      }
    };
    const db = {
      async transaction(cb) { return cb(tx); },
      async query() { return []; }
    };
    const ctx = {
      params: { id: '1' },
      body: { payment_method: 'UPI' },
      user: { user_id: 8, role: 'CUSTOMER' },
      db
    };

    await assert.rejects(
      payRoute.handler(ctx),
      err => err.status === 403 && err.code === 'FORBIDDEN'
    );
  });

  it('throws 409 CONFLICT if booking is already PAID (PAY-02)', async () => {
    const tx = {
      async query() {
        return [{ booking_id: 3, customer_id: 7, booking_status: 'CONFIRMED', payment_status: 'PAID' }];
      }
    };
    const db = {
      async transaction(cb) { return cb(tx); },
      async query() { return []; }
    };
    const ctx = {
      params: { id: '3' },
      body: { payment_method: 'CARD' },
      user: { user_id: 7, role: 'CUSTOMER' },
      db
    };

    await assert.rejects(
      payRoute.handler(ctx),
      err => err.status === 409 && err.code === 'CONFLICT'
    );
  });

  it('throws 409 CONFLICT if booking is CANCELLED (PAY-03)', async () => {
    const tx = {
      async query() {
        return [{ booking_id: 5, customer_id: 7, booking_status: 'CANCELLED', payment_status: 'REFUNDED' }];
      }
    };
    const db = {
      async transaction(cb) { return cb(tx); },
      async query() { return []; }
    };
    const ctx = {
      params: { id: '5' },
      body: { payment_method: 'UPI' },
      user: { user_id: 7, role: 'CUSTOMER' },
      db
    };

    await assert.rejects(
      payRoute.handler(ctx),
      err => err.status === 409 && err.code === 'CONFLICT'
    );
  });
});
