'use strict';
/**
 * server/routes/reviews.routes.js — Owner: M3
 *
 * Implements review and rating endpoints per docs/CONTRACT.md:
 *   POST /api/reviews               — CUSTOMER submits a review for their own COMPLETED booking
 *   GET  /api/reviews/mine          — CUSTOMER views their own reviews
 *   GET  /api/packages/:id/reviews  — Public listing of reviews for a tour package
 *
 * Uses existing validate.js, http.js HttpError, logger.js logAction,
 * and bookingRules.js canReview.
 */

const { HttpError } = require('../utils/http');
const validate = require('../utils/validate');
const { logAction } = require('../utils/logger');
const { canReview } = require('../utils/bookingRules');

function parseStrictPositiveInt(value) {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  if (!/^\d+$/.test(str)) return null;
  const num = Number(str);
  if (!Number.isSafeInteger(num) || num <= 0) return null;
  return num;
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

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/reviews  (CUSTOMER only)
// ─────────────────────────────────────────────────────────────────────────────
async function createReview(ctx) {
  if (ctx.user?.role !== 'CUSTOMER') {
    throw new HttpError(403, 'FORBIDDEN', 'Access denied: only customers can submit reviews');
  }

  const body = validate(ctx.body, {
    booking_id: {
      required: true,
      type: 'int',
      min: 1
    },
    rating: {
      required: true,
      type: 'int',
      min: 1,
      max: 5
    },
    comment: {
      required: false,
      type: 'string'
    }
  });

  const result = await ctx.db.transaction(async (tx) => {
    // 1. Lock and verify booking
    const bookingRows = await tx.query(
      `SELECT booking_id, customer_id, package_id, booking_status
       FROM bookings
       WHERE booking_id = ?
       FOR UPDATE`,
      [body.booking_id]
    );

    if (!bookingRows.length) {
      throw new HttpError(404, 'NOT_FOUND', 'Booking not found');
    }

    const booking = bookingRows[0];

    // 2. Ownership check
    if (Number(booking.customer_id) !== Number(ctx.user.user_id)) {
      throw new HttpError(403, 'FORBIDDEN', 'Access denied: you can only review your own bookings');
    }

    // 3. Status check: Only COMPLETED bookings can be reviewed
    if (booking.booking_status !== 'COMPLETED') {
      throw new HttpError(409, 'CONFLICT', 'Only COMPLETED bookings can be reviewed');
    }

    // 4. Duplicate check: One review per booking
    const existingReviewRows = await tx.query(
      `SELECT review_id FROM reviews WHERE booking_id = ? FOR UPDATE`,
      [body.booking_id]
    );

    const hasExistingReview = existingReviewRows.length > 0;
    if (!canReview({ booking_status: booking.booking_status }, hasExistingReview)) {
      throw new HttpError(409, 'CONFLICT', 'A review has already been submitted for this booking');
    }

    // 5. Insert review record
    const comment = body.comment !== undefined && body.comment !== null && body.comment !== ''
      ? body.comment
      : null;

    let insertResult;
    try {
      insertResult = await tx.query(
        `INSERT INTO reviews (booking_id, customer_id, package_id, rating, comment)
         VALUES (?, ?, ?, ?, ?)`,
        [booking.booking_id, ctx.user.user_id, booking.package_id, body.rating, comment]
      );
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY' || err.message?.includes('Duplicate entry')) {
        throw new HttpError(409, 'CONFLICT', 'A review has already been submitted for this booking');
      }
      throw err;
    }

    return {
      review_id: insertResult.insertId,
      booking_id: Number(booking.booking_id),
      customer_id: Number(ctx.user.user_id),
      package_id: Number(booking.package_id),
      rating: Number(body.rating),
      comment
    };
  });

  await logAction(ctx, 'REVIEW_CREATED', `Review ${result.review_id} submitted for booking ${result.booking_id}`);

  return {
    status: 201,
    data: result,
    message: 'Review submitted successfully'
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/packages/:id/reviews  (Public)
// ─────────────────────────────────────────────────────────────────────────────
async function getPackageReviews(ctx) {
  const packageId = parseStrictPositiveInt(ctx.params?.id);
  if (!packageId) {
    throw new HttpError(400, 'BAD_REQUEST', 'Invalid package ID in request parameter');
  }

  // 1. Verify package exists
  const pkgRows = await ctx.db.query(
    `SELECT package_id FROM tour_packages WHERE package_id = ?`,
    [packageId]
  );
  if (!pkgRows.length) {
    throw new HttpError(404, 'NOT_FOUND', 'Package not found');
  }

  // 2. Count total reviews for pagination
  const countRows = await ctx.db.query(
    `SELECT COUNT(*) AS total FROM reviews WHERE package_id = ?`,
    [packageId]
  );
  const total = Number(countRows[0]?.total || 0);

  // 3. Query reviews with pagination
  const { page, pageSize, offset } = parsePagination(ctx.query);

  const rows = await ctx.db.query(
    `SELECT r.review_id, r.rating, r.comment, r.created_at,
            u.name AS customer_name
     FROM reviews r
     JOIN users u ON u.user_id = r.customer_id
     WHERE r.package_id = ?
     ORDER BY r.created_at DESC, r.review_id DESC
     LIMIT ? OFFSET ?`,
    [packageId, pageSize, offset]
  );

  const data = rows.map((r) => ({
    review_id: Number(r.review_id),
    customer_name: r.customer_name,
    rating: Number(r.rating),
    comment: r.comment || null,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at)
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
// GET /api/reviews/mine  (CUSTOMER only)
// ─────────────────────────────────────────────────────────────────────────────
async function getMyReviews(ctx) {
  if (ctx.user?.role !== 'CUSTOMER') {
    throw new HttpError(403, 'FORBIDDEN', 'Access denied: only customers can view their reviews');
  }

  const { page, pageSize, offset } = parsePagination(ctx.query);

  // 1. Count customer reviews
  const countRows = await ctx.db.query(
    `SELECT COUNT(*) AS total FROM reviews WHERE customer_id = ?`,
    [ctx.user.user_id]
  );
  const total = Number(countRows[0]?.total || 0);

  // 2. Fetch customer reviews joined with package info
  const rows = await ctx.db.query(
    `SELECT r.review_id, r.booking_id, r.package_id, r.rating, r.comment, r.created_at,
            p.title AS package_title, p.image AS package_image
     FROM reviews r
     JOIN tour_packages p ON p.package_id = r.package_id
     WHERE r.customer_id = ?
     ORDER BY r.created_at DESC, r.review_id DESC
     LIMIT ? OFFSET ?`,
    [ctx.user.user_id, pageSize, offset]
  );

  const data = rows.map((r) => ({
    review_id: Number(r.review_id),
    booking_id: Number(r.booking_id),
    package_id: Number(r.package_id),
    package_title: r.package_title,
    package_image: r.package_image || null,
    rating: Number(r.rating),
    comment: r.comment || null,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at)
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

module.exports = [
  {
    method: 'POST',
    path: '/api/reviews',
    roles: ['CUSTOMER'],
    handler: createReview
  },
  {
    method: 'GET',
    path: '/api/reviews/mine',
    roles: ['CUSTOMER'],
    handler: getMyReviews
  },
  {
    method: 'GET',
    path: '/api/packages/:id/reviews',
    handler: getPackageReviews
  }
];
