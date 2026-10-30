'use strict';

const { HttpError } = require('../utils/http');
const validate = require('../utils/validate');
const { logAction } = require('../utils/logger');

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
  }
];
