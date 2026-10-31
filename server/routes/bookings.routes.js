'use strict';

const { HttpError } = require('../utils/http');
const validate = require('../utils/validate');
const { logAction } = require('../utils/logger');
const {
  canCancel,
  canReview,
  canCustomerCancel,
  seatStatusAfterRestore,
  validateProviderStatusTransition
} = require('../utils/bookingRules');

const VALID_BOOKING_STATUSES = ['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED'];

function parseStrictPositiveInt(value) {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  if (!/^\d+$/.test(str)) return null;
  const num = Number(str);
  if (!Number.isSafeInteger(num) || num <= 0) return null;
  return num;
}

function formatIsoDate(dateVal) {
  if (!dateVal) return '';
  if (typeof dateVal === 'string') return dateVal.slice(0, 10);
  if (dateVal instanceof Date) return dateVal.toISOString().slice(0, 10);
  return String(dateVal).slice(0, 10);
}

function parsePagination(query) {
  let page = 1;
  if (query?.page !== undefined && query?.page !== null && query?.page !== '') {
    const rawPage = String(query.page).trim();
    if (/^\d+$/.test(rawPage)) {
      const parsed = Number(rawPage);
      if (Number.isSafeInteger(parsed) && parsed >= 1) {
        page = parsed;
      }
    }
  }

  let pageSize = 10;
  if (query?.pageSize !== undefined && query?.pageSize !== null && query?.pageSize !== '') {
    const rawPageSize = String(query.pageSize).trim();
    if (/^\d+$/.test(rawPageSize)) {
      const parsed = Number(rawPageSize);
      if (Number.isSafeInteger(parsed) && parsed >= 1) {
        pageSize = parsed > 50 ? 50 : parsed;
      }
    }
  }

  const offset = (page - 1) * pageSize;
  return { page, pageSize, offset };
}

async function createBooking(ctx) {
  const body = validate(ctx.body, {
    package_id: {
      required: true,
      type: 'int',
      min: 1
    },
    availability_id: {
      required: true,
      type: 'int',
      min: 1
    },
    travelers: {
      required: true,
      type: 'int',
      min: 1
    }
  });

  const result = await ctx.db.transaction(async (tx) => {
    // Check package approval and provider account status.
    const packages = await tx.query(
      `SELECT p.package_id, p.price, p.status, p.provider_id,
              u.status AS provider_status
       FROM tour_packages p
       JOIN users u ON u.user_id = p.provider_id
       WHERE p.package_id = ?`,
      [body.package_id]
    );

    if (!packages.length) {
      throw new HttpError(404, 'NOT_FOUND', 'Package not found');
    }

    const tourPackage = packages[0];

    if (
      tourPackage.status !== 'APPROVED' ||
      tourPackage.provider_status !== 'ACTIVE'
    ) {
      throw new HttpError(409, 'CONFLICT',
        'This package is not available for booking');
    }

    // Read the maximum travelers setting.
    const settings = await tx.query(
      `SELECT setting_value
       FROM system_settings
       WHERE setting_key = 'max_travelers_per_booking'`
    );

    const maxTravelers = settings.length
      ? Number(settings[0].setting_value)
      : 10;

    if (
      !Number.isInteger(maxTravelers) ||
      body.travelers > maxTravelers
    ) {
      throw new HttpError(400, 'VALIDATION_ERROR',
        `Travelers cannot exceed ${maxTravelers}`);
    }

    // Lock the availability row to prevent simultaneous overbooking.
    // Matching both IDs also verifies that this date belongs to this package.
    const dates = await tx.query(
      `SELECT availability_id, package_id, available_date,
              seats_available, status
       FROM package_availability
       WHERE availability_id = ?
         AND package_id = ?
       FOR UPDATE`,
      [body.availability_id, body.package_id]
    );

    if (!dates.length) {
      throw new HttpError(409, 'CONFLICT',
        'This availability date does not belong to the selected package');
    }

    const date = dates[0];

    if (date.status !== 'OPEN') {
      throw new HttpError(409, 'CONFLICT',
        'This travel date is not open for booking');
    }

    // Compare against the database's current date.
    const todayRows = await tx.query(
      'SELECT CURDATE() AS today'
    );

    const today = todayRows[0].today.toISOString
      ? todayRows[0].today.toISOString().slice(0, 10)
      : String(todayRows[0].today).slice(0, 10);

    const availableDate = String(date.available_date).slice(0, 10);

    if (availableDate < today) {
      throw new HttpError(409, 'CONFLICT',
        'Cannot book a date in the past');
    }

    if (date.seats_available < body.travelers) {
      throw new HttpError(409, 'CONFLICT',
        'Not enough seats available');
    }

    const remainingSeats = date.seats_available - body.travelers;
    const availabilityStatus = remainingSeats === 0 ? 'FULL' : 'OPEN';

    await tx.query(
      `UPDATE package_availability
       SET seats_available = ?, status = ?
       WHERE availability_id = ?`,
      [remainingSeats, availabilityStatus, body.availability_id]
    );

    const totalAmount = Math.round(
      Number(tourPackage.price) * body.travelers * 100
    ) / 100;

    const booking = await tx.query(
      `INSERT INTO bookings
       (customer_id, package_id, availability_id, travelers,
        total_amount, booking_status, payment_status)
       VALUES (?, ?, ?, ?, ?, 'PENDING', 'UNPAID')`,
      [
        ctx.user.user_id,
        body.package_id,
        body.availability_id,
        body.travelers,
        totalAmount
      ]
    );

    return {
      booking_id: booking.insertId,
      total_amount: totalAmount,
      booking_status: 'PENDING',
      payment_status: 'UNPAID'
    };
  });

  await logAction(
    ctx,
    'BOOKING_CREATED',
    `Booking ${result.booking_id} created`
  );

  return {
    status: 201,
    data: result,
    message: 'Booking created successfully'
  };
}

module.exports = [
  {
    method: 'POST',
    path: '/api/bookings',
    roles: ['CUSTOMER'],
    handler: createBooking
  },
  {
    method: 'GET',
    path: '/api/bookings/mine',
    roles: ['CUSTOMER'],
    handler: getMyBookings
  },
  {
    method: 'GET',
    path: '/api/provider/bookings',
    roles: ['PROVIDER'],
    handler: getProviderBookings
  },
  {
    method: 'GET',
    path: '/api/bookings/:id',
    roles: ['CUSTOMER', 'PROVIDER', 'ADMIN'],
    handler: getBookingById
  },
  {
    method: 'POST',
    path: '/api/bookings/:id/cancel',
    roles: ['CUSTOMER'],
    handler: cancelBooking
  },
  {
    method: 'POST',
    path: '/api/bookings/:id/pay',
    roles: ['CUSTOMER'],
    handler: processBookingPayment
  },
  {
    method: 'PATCH',
    path: '/api/bookings/:id/status',
    roles: ['PROVIDER', 'ADMIN'],
    handler: updateBookingStatus
  }
];

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/bookings/mine  (CUSTOMER only)
// ─────────────────────────────────────────────────────────────────────────────
async function getMyBookings(ctx) {
  const { page, pageSize, offset } = parsePagination(ctx.query);

  const whereConditions = ['b.customer_id = ?'];
  const filterParams = [ctx.user.user_id];

  if (ctx.query?.status !== undefined && ctx.query?.status !== null && String(ctx.query.status).trim() !== '') {
    const rawStatus = String(ctx.query.status).trim();
    const statusParam = rawStatus.toUpperCase();

    if (!VALID_BOOKING_STATUSES.includes(statusParam)) {
      throw new HttpError(
        400,
        'VALIDATION_ERROR',
        `Unsupported booking status filter: '${rawStatus}'. Must be one of: ${VALID_BOOKING_STATUSES.join(', ')}`,
        { status: `Must be one of: ${VALID_BOOKING_STATUSES.join(', ')}` }
      );
    }

    whereConditions.push('b.booking_status = ?');
    filterParams.push(statusParam);
  }

  const whereClause = whereConditions.join(' AND ');

  // 1. Total count
  const countSql = `SELECT COUNT(*) AS total FROM bookings b WHERE ${whereClause}`;
  const countRows = await ctx.db.query(countSql, filterParams);
  const total = Number(countRows[0]?.total || 0);

  // 2. Fetch cancellation window setting
  const settingsRows = await ctx.db.query(
    `SELECT setting_value FROM system_settings WHERE setting_key = 'cancellation_window_days'`
  );
  const windowDays = settingsRows.length && !Number.isNaN(Number(settingsRows[0].setting_value))
    ? Number(settingsRows[0].setting_value)
    : 2;

  // 3. Current date for cancellation check
  let today = new Date();
  try {
    const todayRows = await ctx.db.query('SELECT CURDATE() AS today');
    if (todayRows.length && todayRows[0].today) {
      today = formatIsoDate(todayRows[0].today);
    }
  } catch (err) {}

  // 4. Fetch bookings page
  const dataSql = `
    SELECT
      b.booking_id,
      b.customer_id,
      b.package_id,
      b.availability_id,
      b.travelers,
      b.total_amount,
      b.booking_status,
      b.payment_status,
      b.booked_at,
      p.title AS package_title,
      p.image,
      a.available_date,
      (r.review_id IS NOT NULL) AS has_review
    FROM bookings b
    JOIN tour_packages p ON p.package_id = b.package_id
    JOIN package_availability a ON a.availability_id = b.availability_id
    LEFT JOIN reviews r ON r.booking_id = b.booking_id
    WHERE ${whereClause}
    ORDER BY b.booked_at DESC, b.booking_id DESC
    LIMIT ? OFFSET ?
  `;

  const rows = await ctx.db.query(dataSql, [...filterParams, pageSize, offset]);

  const data = rows.map((r) => {
    const hasReview = Boolean(r.has_review);
    const availableDate = typeof r.available_date === 'string'
      ? r.available_date.slice(0, 10)
      : (r.available_date instanceof Date ? r.available_date.toISOString().slice(0, 10) : String(r.available_date));

    const can_cancel = canCancel(
      { booking_status: r.booking_status },
      availableDate,
      windowDays,
      today
    );
    const can_review = canReview(
      { booking_status: r.booking_status },
      hasReview
    );

    return {
      booking_id: Number(r.booking_id),
      customer_id: Number(r.customer_id),
      package_id: Number(r.package_id),
      availability_id: Number(r.availability_id),
      travelers: Number(r.travelers),
      total_amount: Number(r.total_amount),
      booking_status: r.booking_status,
      payment_status: r.payment_status,
      booked_at: r.booked_at instanceof Date ? r.booked_at.toISOString() : String(r.booked_at),
      title: r.package_title,
      package_title: r.package_title,
      image: r.image || null,
      available_date: availableDate,
      can_cancel,
      can_review,
      has_review: hasReview
    };
  });

  return {
    data,
    meta: {
      page,
      pageSize,
      total
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/bookings/:id  (CUSTOMER owner, PROVIDER of package, ADMIN + MANAGE_BOOKINGS)
// ─────────────────────────────────────────────────────────────────────────────
async function getBookingById(ctx) {
  const bookingId = parseStrictPositiveInt(ctx.params?.id);
  if (!bookingId) {
    throw new HttpError(400, 'BAD_REQUEST', 'Invalid booking ID in request parameter');
  }

  // 1. Fetch booking with package, availability, customer, and provider info
  const sql = `
    SELECT
      b.booking_id,
      b.customer_id,
      b.package_id,
      b.availability_id,
      b.travelers,
      b.total_amount,
      b.booking_status,
      b.payment_status,
      b.booked_at,
      p.title AS package_title,
      p.description AS package_description,
      p.price AS package_price,
      p.duration_days,
      p.image AS package_image,
      p.status AS package_status,
      p.provider_id,
      a.available_date,
      a.seats_available,
      a.status AS availability_status,
      cu.name AS customer_name,
      cu.email AS customer_email,
      cu.mobile AS customer_mobile,
      pu.name AS provider_name,
      pu.email AS provider_email,
      pu.mobile AS provider_mobile
    FROM bookings b
    JOIN tour_packages p ON p.package_id = b.package_id
    JOIN package_availability a ON a.availability_id = b.availability_id
    JOIN users cu ON cu.user_id = b.customer_id
    JOIN users pu ON pu.user_id = p.provider_id
    WHERE b.booking_id = ?
  `;

  const rows = await ctx.db.query(sql, [bookingId]);
  if (!rows.length) {
    throw new HttpError(404, 'NOT_FOUND', 'Booking not found');
  }

  const booking = rows[0];

  // 2. Enforce customer ownership, provider ownership, and admin MANAGE_BOOKINGS permission
  if (ctx.user.role === 'CUSTOMER') {
    if (Number(booking.customer_id) !== Number(ctx.user.user_id)) {
      throw new HttpError(403, 'FORBIDDEN', 'Access denied to this booking');
    }
  } else if (ctx.user.role === 'PROVIDER') {
    if (Number(booking.provider_id) !== Number(ctx.user.user_id)) {
      throw new HttpError(403, 'FORBIDDEN', 'Access denied to this booking');
    }
  } else if (ctx.user.role === 'ADMIN') {
    const hasPermission = Array.isArray(ctx.user.permissions) && (
      ctx.user.permissions.includes('MANAGE_BOOKINGS') ||
      ctx.user.permissions.includes('*')
    );
    if (!hasPermission) {
      throw new HttpError(403, 'FORBIDDEN', 'Permission required: MANAGE_BOOKINGS');
    }
  } else if (ctx.user.role === 'SUPER_ADMIN') {
    // SUPER_ADMIN has full access
  } else {
    throw new HttpError(403, 'FORBIDDEN', 'Insufficient role');
  }

  // 3. Fetch payment row if any
  const paymentRows = await ctx.db.query(
    `SELECT payment_id, booking_id, customer_id, amount, payment_method, payment_status, paid_at
     FROM payments
     WHERE booking_id = ?`,
    [bookingId]
  );
  const paymentRow = paymentRows.length ? paymentRows[0] : null;

  // 4. Fetch review row if any
  const reviewRows = await ctx.db.query(
    `SELECT review_id, booking_id, customer_id, package_id, rating, comment, created_at
     FROM reviews
     WHERE booking_id = ?`,
    [bookingId]
  );
  const reviewRow = reviewRows.length ? reviewRows[0] : null;

  // 5. Compute cancellation and review eligibility
  const settingsRows = await ctx.db.query(
    `SELECT setting_value FROM system_settings WHERE setting_key = 'cancellation_window_days'`
  );
  const windowDays = settingsRows.length && !Number.isNaN(Number(settingsRows[0].setting_value))
    ? Number(settingsRows[0].setting_value)
    : 2;

  let today = new Date();
  try {
    const todayRows = await ctx.db.query('SELECT CURDATE() AS today');
    if (todayRows.length && todayRows[0].today) {
      today = formatIsoDate(todayRows[0].today);
    }
  } catch (err) {}

  const availableDate = typeof booking.available_date === 'string'
    ? booking.available_date.slice(0, 10)
    : (booking.available_date instanceof Date ? booking.available_date.toISOString().slice(0, 10) : String(booking.available_date));

  const can_cancel = canCancel(
    { booking_status: booking.booking_status },
    availableDate,
    windowDays,
    today
  );
  const can_review = canReview(
    { booking_status: booking.booking_status },
    Boolean(reviewRow)
  );

  const data = {
    booking_id: Number(booking.booking_id),
    customer_id: Number(booking.customer_id),
    package_id: Number(booking.package_id),
    availability_id: Number(booking.availability_id),
    travelers: Number(booking.travelers),
    total_amount: Number(booking.total_amount),
    booking_status: booking.booking_status,
    payment_status: booking.payment_status,
    booked_at: booking.booked_at instanceof Date ? booking.booked_at.toISOString() : String(booking.booked_at),
    can_cancel,
    can_review,
    has_review: Boolean(reviewRow),
    title: booking.package_title,
    package_title: booking.package_title,
    image: booking.package_image || null,
    package_image: booking.package_image || null,
    available_date: availableDate,
    package: {
      package_id: Number(booking.package_id),
      title: booking.package_title,
      description: booking.package_description,
      price: Number(booking.package_price),
      duration_days: Number(booking.duration_days),
      image: booking.package_image || null,
      status: booking.package_status,
      provider_id: Number(booking.provider_id)
    },
    customer: {
      user_id: Number(booking.customer_id),
      name: booking.customer_name,
      email: booking.customer_email,
      mobile: booking.customer_mobile
    },
    customer_name: booking.customer_name,
    customer_email: booking.customer_email,
    customer_mobile: booking.customer_mobile,
    provider: {
      user_id: Number(booking.provider_id),
      name: booking.provider_name,
      email: booking.provider_email,
      mobile: booking.provider_mobile
    },
    provider_name: booking.provider_name,
    provider_email: booking.provider_email,
    provider_mobile: booking.provider_mobile,
    payment: paymentRow ? {
      payment_id: Number(paymentRow.payment_id),
      booking_id: Number(paymentRow.booking_id),
      customer_id: Number(paymentRow.customer_id),
      amount: Number(paymentRow.amount),
      payment_method: paymentRow.payment_method,
      payment_status: paymentRow.payment_status,
      paid_at: paymentRow.paid_at instanceof Date ? paymentRow.paid_at.toISOString() : String(paymentRow.paid_at)
    } : null,
    review: reviewRow ? {
      review_id: Number(reviewRow.review_id),
      booking_id: Number(reviewRow.booking_id),
      customer_id: Number(reviewRow.customer_id),
      package_id: Number(reviewRow.package_id),
      rating: Number(reviewRow.rating),
      comment: reviewRow.comment,
      created_at: reviewRow.created_at instanceof Date ? reviewRow.created_at.toISOString() : String(reviewRow.created_at)
    } : null
  };

  return { data };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/provider/bookings  (PROVIDER only, own packages only)
// ─────────────────────────────────────────────────────────────────────────────
async function getProviderBookings(ctx) {
  const { page, pageSize, offset } = parsePagination(ctx.query);

  const whereConditions = ['p.provider_id = ?'];
  const filterParams = [ctx.user.user_id];

  if (ctx.query?.status !== undefined && ctx.query?.status !== null && String(ctx.query.status).trim() !== '') {
    const rawStatus = String(ctx.query.status).trim();
    const statusParam = rawStatus.toUpperCase();

    if (!VALID_BOOKING_STATUSES.includes(statusParam)) {
      throw new HttpError(
        400,
        'VALIDATION_ERROR',
        `Unsupported booking status filter: '${rawStatus}'. Must be one of: ${VALID_BOOKING_STATUSES.join(', ')}`,
        { status: `Must be one of: ${VALID_BOOKING_STATUSES.join(', ')}` }
      );
    }

    whereConditions.push('b.booking_status = ?');
    filterParams.push(statusParam);
  }

  if (ctx.query?.package_id !== undefined && ctx.query?.package_id !== null && String(ctx.query.package_id).trim() !== '') {
    const packageId = parseStrictPositiveInt(ctx.query.package_id);
    if (!packageId) {
      throw new HttpError(400, 'BAD_REQUEST', 'Invalid package_id parameter');
    }
    whereConditions.push('b.package_id = ?');
    filterParams.push(packageId);
  }

  const whereClause = whereConditions.join(' AND ');

  // 1. Total count
  const countSql = `
    SELECT COUNT(*) AS total
    FROM bookings b
    JOIN tour_packages p ON p.package_id = b.package_id
    WHERE ${whereClause}
  `;
  const countRows = await ctx.db.query(countSql, filterParams);
  const total = Number(countRows[0]?.total || 0);

  // 2. Data page
  const dataSql = `
    SELECT
      b.booking_id,
      b.customer_id,
      b.package_id,
      b.availability_id,
      b.travelers,
      b.total_amount,
      b.booking_status,
      b.payment_status,
      b.booked_at,
      p.title AS package_title,
      a.available_date,
      cu.name AS customer_name,
      cu.mobile AS customer_mobile
    FROM bookings b
    JOIN tour_packages p ON p.package_id = b.package_id
    JOIN package_availability a ON a.availability_id = b.availability_id
    JOIN users cu ON cu.user_id = b.customer_id
    WHERE ${whereClause}
    ORDER BY b.booked_at DESC, b.booking_id DESC
    LIMIT ? OFFSET ?
  `;

  const rows = await ctx.db.query(dataSql, [...filterParams, pageSize, offset]);

  const data = rows.map((r) => ({
    booking_id: Number(r.booking_id),
    customer_id: Number(r.customer_id),
    customer_name: r.customer_name,
    customer_mobile: r.customer_mobile,
    package_id: Number(r.package_id),
    package_title: r.package_title,
    availability_id: Number(r.availability_id),
    available_date: formatIsoDate(r.available_date),
    travelers: Number(r.travelers),
    total_amount: Number(r.total_amount),
    booking_status: r.booking_status,
    payment_status: r.payment_status,
    booked_at: r.booked_at instanceof Date ? r.booked_at.toISOString() : String(r.booked_at)
  }));

  return {
    data,
    meta: {
      page,
      pageSize,
      total
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/bookings/:id/cancel  (CUSTOMER owner)
// ─────────────────────────────────────────────────────────────────────────────
async function cancelBooking(ctx) {
  const bookingId = parseStrictPositiveInt(ctx.params?.id);
  if (!bookingId) {
    throw new HttpError(400, 'BAD_REQUEST', 'Invalid booking ID in request parameter');
  }

  const result = await ctx.db.transaction(async (tx) => {
    // 1. Lock booking row
    const bookingRows = await tx.query(
      `SELECT booking_id, customer_id, package_id, availability_id, travelers,
              total_amount, booking_status, payment_status
       FROM bookings
       WHERE booking_id = ?
       FOR UPDATE`,
      [bookingId]
    );

    if (!bookingRows.length) {
      throw new HttpError(404, 'NOT_FOUND', 'Booking not found');
    }

    const booking = bookingRows[0];

    // 2. Ownership check
    if (Number(booking.customer_id) !== Number(ctx.user.user_id)) {
      throw new HttpError(403, 'FORBIDDEN', 'Access denied: you can only cancel your own bookings');
    }

    // 3. Status checks
    if (booking.booking_status === 'COMPLETED') {
      throw new HttpError(409, 'CONFLICT', 'COMPLETED bookings cannot be cancelled');
    }
    if (booking.booking_status === 'CANCELLED') {
      throw new HttpError(409, 'CONFLICT', 'Booking is already cancelled');
    }
    if (booking.booking_status !== 'PENDING' && booking.booking_status !== 'CONFIRMED') {
      throw new HttpError(409, 'CONFLICT', `Booking status '${booking.booking_status}' cannot be cancelled`);
    }

    // 4. Lock availability row
    const availRows = await tx.query(
      `SELECT availability_id, package_id, available_date, seats_available, status
       FROM package_availability
       WHERE availability_id = ?
       FOR UPDATE`,
      [booking.availability_id]
    );

    if (!availRows.length) {
      throw new HttpError(404, 'NOT_FOUND', 'Package availability not found');
    }

    const avail = availRows[0];

    // 5. Fetch cancellation window setting
    const settingsRows = await tx.query(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'cancellation_window_days'`
    );
    const windowDays = settingsRows.length && !Number.isNaN(Number(settingsRows[0].setting_value))
      ? Number(settingsRows[0].setting_value)
      : 2;

    // 6. Fetch today's date from database (or fallback)
    let today = formatIsoDate(new Date());
    try {
      const todayRows = await tx.query('SELECT CURDATE() AS today');
      if (todayRows.length && todayRows[0].today) {
        today = formatIsoDate(todayRows[0].today);
      }
    } catch (_) {}

    const availableDate = formatIsoDate(avail.available_date);

    // 7. Check cancellation eligibility
    const eligibility = canCustomerCancel(
      { booking_status: booking.booking_status },
      availableDate,
      windowDays,
      today
    );

    if (!eligibility.ok) {
      throw new HttpError(409, 'CONFLICT', eligibility.reason || 'Cancellation window has passed');
    }

    // 8. Restore seats and update status
    const newSeats = Number(avail.seats_available) + Number(booking.travelers);
    const newStatus = seatStatusAfterRestore(avail.status);

    await tx.query(
      `UPDATE package_availability
       SET seats_available = ?, status = ?
       WHERE availability_id = ?`,
      [newSeats, newStatus, avail.availability_id]
    );

    // 9. If PAID, refund payment; if UNPAID, do not touch payments
    let newPaymentStatus = booking.payment_status;
    if (booking.payment_status === 'PAID') {
      newPaymentStatus = 'REFUNDED';
      await tx.query(
        `UPDATE payments
         SET payment_status = 'REFUNDED'
         WHERE booking_id = ?`,
        [bookingId]
      );
    }

    // 10. Update booking status to CANCELLED
    await tx.query(
      `UPDATE bookings
       SET booking_status = 'CANCELLED', payment_status = ?
       WHERE booking_id = ?`,
      [newPaymentStatus, bookingId]
    );

    return {
      booking_id: Number(bookingId),
      booking_status: 'CANCELLED',
      payment_status: newPaymentStatus,
      seats_restored: Number(booking.travelers)
    };
  });

  await logAction(ctx, 'BOOKING_CANCELLED', `Booking ${bookingId} cancelled`);

  return {
    status: 200,
    data: result,
    message: 'Booking cancelled successfully'
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/bookings/:id/pay  (CUSTOMER owner)
// ─────────────────────────────────────────────────────────────────────────────
async function processBookingPayment(ctx) {
  const bookingId = parseStrictPositiveInt(ctx.params?.id);
  if (!bookingId) {
    throw new HttpError(400, 'BAD_REQUEST', 'Invalid booking ID in request parameter');
  }

  const body = validate(ctx.body, {
    payment_method: {
      required: true,
      type: 'enum',
      values: ['UPI', 'CARD', 'NETBANKING', 'CASH']
    }
  });

  const result = await ctx.db.transaction(async (tx) => {
    // 1. Lock booking row
    const rows = await tx.query(
      `SELECT booking_id, customer_id, total_amount, booking_status, payment_status
       FROM bookings
       WHERE booking_id = ?
       FOR UPDATE`,
      [bookingId]
    );

    if (!rows.length) {
      throw new HttpError(404, 'NOT_FOUND', 'Booking not found');
    }

    const booking = rows[0];

    // 2. Ownership check
    if (Number(booking.customer_id) !== Number(ctx.user.user_id)) {
      throw new HttpError(403, 'FORBIDDEN', 'Access denied: you can only pay for your own bookings');
    }

    // 3. Status checks
    if (booking.payment_status === 'PAID') {
      throw new HttpError(409, 'CONFLICT', 'Booking is already paid');
    }
    if (booking.booking_status === 'CANCELLED') {
      throw new HttpError(409, 'CONFLICT', 'Cannot pay a cancelled booking');
    }

    const amount = Number(booking.total_amount);

    // 4. Insert payment record (SUCCESS)
    const paymentResult = await tx.query(
      `INSERT INTO payments (booking_id, customer_id, amount, payment_method, payment_status)
       VALUES (?, ?, ?, ?, 'SUCCESS')`,
      [bookingId, ctx.user.user_id, booking.total_amount, body.payment_method]
    );

    // 5. Update booking payment_status to PAID
    await tx.query(
      `UPDATE bookings
       SET payment_status = 'PAID'
       WHERE booking_id = ?`,
      [bookingId]
    );

    return {
      payment_id: paymentResult.insertId,
      booking_id: Number(bookingId),
      customer_id: Number(ctx.user.user_id),
      amount,
      payment_method: body.payment_method,
      payment_status: 'PAID'
    };
  });

  await logAction(ctx, 'PAYMENT_MADE', `Payment of ${result.amount} recorded for booking ${bookingId}`);

  return {
    status: 200,
    data: result,
    message: 'Payment processed successfully'
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/bookings/:id/status  (PROVIDER owner of package, ADMIN + MANAGE_BOOKINGS)
// ─────────────────────────────────────────────────────────────────────────────
async function updateBookingStatus(ctx) {
  const bookingId = parseStrictPositiveInt(ctx.params?.id);
  if (!bookingId) {
    throw new HttpError(400, 'BAD_REQUEST', 'Invalid booking ID in request parameter');
  }

  const body = validate(ctx.body, {
    status: {
      required: true,
      type: 'string'
    }
  });

  const newStatus = body.status.trim().toUpperCase();
  if (!VALID_BOOKING_STATUSES.includes(newStatus)) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      `Unsupported booking status: '${body.status}'. Must be one of: ${VALID_BOOKING_STATUSES.join(', ')}`,
      { status: `Must be one of: ${VALID_BOOKING_STATUSES.join(', ')}` }
    );
  }

  const result = await ctx.db.transaction(async (tx) => {
    // 1. Lock booking row and fetch associated provider_id
    const bookingRows = await tx.query(
      `SELECT b.booking_id, b.customer_id, b.package_id, b.availability_id, b.travelers,
              b.total_amount, b.booking_status, b.payment_status,
              p.provider_id
       FROM bookings b
       JOIN tour_packages p ON p.package_id = b.package_id
       WHERE b.booking_id = ?
       FOR UPDATE`,
      [bookingId]
    );

    if (!bookingRows.length) {
      throw new HttpError(404, 'NOT_FOUND', 'Booking not found');
    }

    const booking = bookingRows[0];

    // 2. Authorization check
    if (ctx.user.role === 'CUSTOMER') {
      throw new HttpError(403, 'FORBIDDEN', 'Access denied: customers cannot update booking status');
    } else if (ctx.user.role === 'PROVIDER') {
      if (Number(booking.provider_id) !== Number(ctx.user.user_id)) {
        throw new HttpError(403, 'FORBIDDEN', 'Access denied: you can only update bookings for your own packages');
      }
    } else if (ctx.user.role === 'ADMIN') {
      const hasPermission = Array.isArray(ctx.user.permissions) && (
        ctx.user.permissions.includes('MANAGE_BOOKINGS') ||
        ctx.user.permissions.includes('*')
      );
      if (!hasPermission) {
        throw new HttpError(403, 'FORBIDDEN', 'Permission required: MANAGE_BOOKINGS');
      }
    } else if (ctx.user.role === 'SUPER_ADMIN') {
      // SUPER_ADMIN has full access
    } else {
      throw new HttpError(403, 'FORBIDDEN', 'Insufficient role');
    }

    // 3. Lock availability row
    const availRows = await tx.query(
      `SELECT availability_id, package_id, available_date, seats_available, status
       FROM package_availability
       WHERE availability_id = ?
       FOR UPDATE`,
      [booking.availability_id]
    );

    if (!availRows.length) {
      throw new HttpError(404, 'NOT_FOUND', 'Package availability not found');
    }

    const avail = availRows[0];

    // 4. Determine current date
    let today = formatIsoDate(new Date());
    try {
      const todayRows = await tx.query('SELECT CURDATE() AS today');
      if (todayRows.length && todayRows[0].today) {
        today = formatIsoDate(todayRows[0].today);
      }
    } catch (_) {}

    const availableDate = formatIsoDate(avail.available_date);

    // 5. Validate status transition
    const transition = validateProviderStatusTransition(
      booking.booking_status,
      newStatus,
      availableDate,
      today
    );

    if (!transition.ok) {
      throw new HttpError(409, 'CONFLICT', transition.reason);
    }

    let newPaymentStatus = booking.payment_status;

    // 6. Apply state changes
    if (newStatus === 'CONFIRMED') {
      await tx.query(
        `UPDATE bookings
         SET booking_status = 'CONFIRMED'
         WHERE booking_id = ?`,
        [bookingId]
      );
    } else if (newStatus === 'COMPLETED') {
      await tx.query(
        `UPDATE bookings
         SET booking_status = 'COMPLETED'
         WHERE booking_id = ?`,
        [bookingId]
      );
    } else if (newStatus === 'CANCELLED') {
      // Restore seats
      const newSeats = Number(avail.seats_available) + Number(booking.travelers);
      const newStatusAvail = seatStatusAfterRestore(avail.status);

      await tx.query(
        `UPDATE package_availability
         SET seats_available = ?, status = ?
         WHERE availability_id = ?`,
        [newSeats, newStatusAvail, avail.availability_id]
      );

      // Refund if paid
      if (booking.payment_status === 'PAID') {
        newPaymentStatus = 'REFUNDED';
        await tx.query(
          `UPDATE payments
           SET payment_status = 'REFUNDED'
           WHERE booking_id = ?`,
          [bookingId]
        );
      }

      await tx.query(
        `UPDATE bookings
         SET booking_status = 'CANCELLED', payment_status = ?
         WHERE booking_id = ?`,
        [newPaymentStatus, bookingId]
      );
    }

    return {
      booking_id: Number(bookingId),
      booking_status: newStatus,
      payment_status: newPaymentStatus,
      ...(newStatus === 'CANCELLED' ? { seats_restored: Number(booking.travelers) } : {})
    };
  });

  await logAction(ctx, 'BOOKING_STATUS_CHANGED', `Booking ${bookingId} status updated to ${newStatus}`);

  return {
    status: 200,
    data: result,
    message: `Booking status updated to ${newStatus}`
  };
}
