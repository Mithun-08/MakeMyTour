'use strict';
/**
 * server/routes/reports.routes.js — Owner: M3
 *
 * Implements report and revenue endpoints per docs/CONTRACT.md:
 *   GET /api/admin/stats            — Platform booking & revenue overview (ADMIN + VIEW_REPORTS)
 *   GET /api/admin/reports/revenue  — Chronological revenue series (ADMIN + VIEW_REPORTS)
 *   GET /api/admin/reports/bookings — Booking breakdowns and rankings (ADMIN + VIEW_REPORTS)
 *   GET /api/customer/reports       — Authenticated customer summary & upcoming trips (CUSTOMER)
 *
 * Revenue definition (CONTRACT line 442):
 *   SUM(bookings.total_amount) WHERE payment_status = 'PAID'.
 */

const { HttpError } = require('../utils/http');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function formatIsoDate(dateVal) {
  if (!dateVal) return '';
  if (typeof dateVal === 'string') return dateVal.slice(0, 10);
  if (dateVal instanceof Date) return dateVal.toISOString().slice(0, 10);
  return String(dateVal).slice(0, 10);
}

function verifyAdminReportsPermission(ctx) {
  if (ctx.user?.role === 'SUPER_ADMIN') {
    return; // SUPER_ADMIN always has permission bypass
  }

  const permissions = Array.isArray(ctx.user?.permissions) ? ctx.user.permissions : [];
  if (ctx.user?.role !== 'ADMIN' || (!permissions.includes('VIEW_REPORTS') && !permissions.includes('*'))) {
    throw new HttpError(403, 'FORBIDDEN', 'Permission required: VIEW_REPORTS');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. GET /api/admin/stats  (ADMIN + VIEW_REPORTS, SUPER_ADMIN)
// ─────────────────────────────────────────────────────────────────────────────
async function getAdminStats(ctx) {
  verifyAdminReportsPermission(ctx);

  const [usersRows, packagesRows, bookingsRows] = await Promise.all([
    ctx.db.query(`
      SELECT
        COUNT(CASE WHEN role = 'CUSTOMER' THEN 1 END) AS total_customers,
        COUNT(CASE WHEN role = 'PROVIDER' THEN 1 END) AS total_providers,
        COUNT(CASE WHEN role = 'PROVIDER' AND status = 'PENDING' THEN 1 END) AS pending_providers
      FROM users
    `),
    ctx.db.query(`
      SELECT
        COUNT(*) AS total_packages,
        COUNT(CASE WHEN status = 'PENDING' THEN 1 END) AS pending_packages
      FROM tour_packages
    `),
    ctx.db.query(`
      SELECT
        COUNT(*) AS total_bookings,
        COALESCE(SUM(CASE WHEN payment_status = 'PAID' THEN total_amount ELSE 0 END), 0) AS total_revenue,
        COUNT(CASE WHEN DATE(booked_at) = CURDATE() THEN 1 END) AS bookings_today
      FROM bookings
    `)
  ]);

  const userStats = usersRows[0] || {};
  const packageStats = packagesRows[0] || {};
  const bookingStats = bookingsRows[0] || {};

  return {
    data: {
      total_customers: Number(userStats.total_customers || 0),
      total_providers: Number(userStats.total_providers || 0),
      pending_providers: Number(userStats.pending_providers || 0),
      total_packages: Number(packageStats.total_packages || 0),
      pending_packages: Number(packageStats.pending_packages || 0),
      total_bookings: Number(bookingStats.total_bookings || 0),
      total_revenue: Number(bookingStats.total_revenue || 0),
      bookings_today: Number(bookingStats.bookings_today || 0)
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. GET /api/admin/reports/revenue  (ADMIN + VIEW_REPORTS, SUPER_ADMIN)
// ─────────────────────────────────────────────────────────────────────────────
async function getRevenueReport(ctx) {
  verifyAdminReportsPermission(ctx);

  const whereConditions = ["b.payment_status = 'PAID'"];
  const params = [];

  // Date filtering validation
  if (ctx.query?.from !== undefined && ctx.query?.from !== null && String(ctx.query.from).trim() !== '') {
    const fromStr = String(ctx.query.from).trim();
    if (!DATE_RE.test(fromStr) || isNaN(new Date(fromStr).getTime())) {
      throw new HttpError(400, 'VALIDATION_ERROR', "Invalid 'from' date format. Must be YYYY-MM-DD", { from: 'Must be YYYY-MM-DD' });
    }
    whereConditions.push('DATE(b.booked_at) >= ?');
    params.push(fromStr);
  }

  if (ctx.query?.to !== undefined && ctx.query?.to !== null && String(ctx.query.to).trim() !== '') {
    const toStr = String(ctx.query.to).trim();
    if (!DATE_RE.test(toStr) || isNaN(new Date(toStr).getTime())) {
      throw new HttpError(400, 'VALIDATION_ERROR', "Invalid 'to' date format. Must be YYYY-MM-DD", { to: 'Must be YYYY-MM-DD' });
    }
    whereConditions.push('DATE(b.booked_at) <= ?');
    params.push(toStr);
  }

  // Group validation: 'day' or 'month' (default: 'day')
  let group = 'day';
  if (ctx.query?.group !== undefined && ctx.query?.group !== null && String(ctx.query.group).trim() !== '') {
    const rawGroup = String(ctx.query.group).trim().toLowerCase();
    if (rawGroup !== 'day' && rawGroup !== 'month') {
      throw new HttpError(400, 'VALIDATION_ERROR', "Invalid 'group' parameter. Must be 'day' or 'month'", { group: "Must be 'day' or 'month'" });
    }
    group = rawGroup;
  }

  const periodFormat = group === 'month' ? '%Y-%m' : '%Y-%m-%d';
  const whereClause = whereConditions.join(' AND ');

  const sql = `
    SELECT
      DATE_FORMAT(b.booked_at, '${periodFormat}') AS period,
      COUNT(b.booking_id) AS bookings,
      COALESCE(SUM(b.total_amount), 0) AS revenue
    FROM bookings b
    WHERE ${whereClause}
    GROUP BY DATE_FORMAT(b.booked_at, '${periodFormat}')
    ORDER BY period ASC
  `;

  const rows = await ctx.db.query(sql, params);

  const data = rows.map((r) => ({
    period: r.period,
    bookings: Number(r.bookings || 0),
    revenue: Number(r.revenue || 0)
  }));

  return { data };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. GET /api/admin/reports/bookings  (ADMIN + VIEW_REPORTS, SUPER_ADMIN)
// ─────────────────────────────────────────────────────────────────────────────
async function getBookingsReport(ctx) {
  verifyAdminReportsPermission(ctx);

  const [statusRows, packagesRows, destinationsRows, categoriesRows] = await Promise.all([
    // by_status[]
    ctx.db.query(`
      SELECT
        booking_status AS status,
        COUNT(*) AS count
      FROM bookings
      GROUP BY booking_status
      ORDER BY count DESC
    `),
    // top_packages[5]
    ctx.db.query(`
      SELECT
        p.package_id,
        p.title,
        COUNT(b.booking_id) AS booking_count,
        COALESCE(SUM(CASE WHEN b.payment_status = 'PAID' THEN b.total_amount ELSE 0 END), 0) AS total_revenue
      FROM bookings b
      JOIN tour_packages p ON p.package_id = b.package_id
      GROUP BY p.package_id, p.title
      ORDER BY booking_count DESC, p.package_id ASC
      LIMIT 5
    `),
    // top_destinations[5]
    ctx.db.query(`
      SELECT
        d.destination_id,
        d.name,
        d.city,
        d.state,
        COUNT(b.booking_id) AS booking_count
      FROM bookings b
      JOIN tour_packages p ON p.package_id = b.package_id
      JOIN destinations d ON d.destination_id = p.destination_id
      GROUP BY d.destination_id, d.name, d.city, d.state
      ORDER BY booking_count DESC, d.destination_id ASC
      LIMIT 5
    `),
    // by_category[]
    ctx.db.query(`
      SELECT
        c.category_id,
        c.category_name,
        COUNT(b.booking_id) AS booking_count
      FROM bookings b
      JOIN tour_packages p ON p.package_id = b.package_id
      JOIN categories c ON c.category_id = p.category_id
      GROUP BY c.category_id, c.category_name
      ORDER BY booking_count DESC, c.category_id ASC
    `)
  ]);

  const by_status = statusRows.map((r) => ({
    status: r.status,
    count: Number(r.count || 0)
  }));

  const top_packages = packagesRows.map((r) => ({
    package_id: Number(r.package_id),
    title: r.title,
    booking_count: Number(r.booking_count || 0),
    total_revenue: Number(r.total_revenue || 0)
  }));

  const top_destinations = destinationsRows.map((r) => ({
    destination_id: Number(r.destination_id),
    name: r.name,
    city: r.city,
    state: r.state,
    booking_count: Number(r.booking_count || 0)
  }));

  const by_category = categoriesRows.map((r) => ({
    category_id: Number(r.category_id),
    category_name: r.category_name,
    booking_count: Number(r.booking_count || 0)
  }));

  return {
    data: {
      by_status,
      top_packages,
      top_destinations,
      by_category
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. GET /api/customer/reports  (CUSTOMER only)
// ─────────────────────────────────────────────────────────────────────────────
async function getCustomerReports(ctx) {
  if (ctx.user?.role !== 'CUSTOMER') {
    throw new HttpError(403, 'FORBIDDEN', 'Access denied: only customers can view customer reports');
  }

  const customerId = ctx.user.user_id;

  const [summaryRows, statusRows, upcomingRows] = await Promise.all([
    // total_bookings and total_spent
    ctx.db.query(`
      SELECT
        COUNT(*) AS total_bookings,
        COALESCE(SUM(CASE WHEN payment_status = 'PAID' THEN total_amount ELSE 0 END), 0) AS total_spent
      FROM bookings
      WHERE customer_id = ?
    `, [customerId]),
    // by_status[]
    ctx.db.query(`
      SELECT
        booking_status AS status,
        COUNT(*) AS count
      FROM bookings
      WHERE customer_id = ?
      GROUP BY booking_status
      ORDER BY count DESC
    `, [customerId]),
    // upcoming[]: available_date >= CURDATE() and status PENDING or CONFIRMED
    ctx.db.query(`
      SELECT
        b.booking_id,
        b.package_id,
        b.travelers,
        b.total_amount,
        b.booking_status,
        b.payment_status,
        p.title AS package_title,
        p.image AS package_image,
        a.available_date
      FROM bookings b
      JOIN tour_packages p ON p.package_id = b.package_id
      JOIN package_availability a ON a.availability_id = b.availability_id
      WHERE b.customer_id = ?
        AND a.available_date >= CURDATE()
        AND b.booking_status IN ('PENDING', 'CONFIRMED')
      ORDER BY a.available_date ASC, b.booking_id ASC
    `, [customerId])
  ]);

  const summary = summaryRows[0] || {};

  const by_status = statusRows.map((r) => ({
    status: r.status,
    count: Number(r.count || 0)
  }));

  const upcoming = upcomingRows.map((r) => ({
    booking_id: Number(r.booking_id),
    package_id: Number(r.package_id),
    package_title: r.package_title,
    package_image: r.package_image || null,
    available_date: formatIsoDate(r.available_date),
    travelers: Number(r.travelers),
    total_amount: Number(r.total_amount),
    booking_status: r.booking_status,
    payment_status: r.payment_status
  }));

  return {
    data: {
      total_bookings: Number(summary.total_bookings || 0),
      total_spent: Number(summary.total_spent || 0),
      by_status,
      upcoming
    }
  };
}

module.exports = [
  {
    method: 'GET',
    path: '/api/admin/stats',
    roles: ['ADMIN'],
    permission: 'VIEW_REPORTS',
    handler: getAdminStats
  },
  {
    method: 'GET',
    path: '/api/admin/reports/revenue',
    roles: ['ADMIN'],
    permission: 'VIEW_REPORTS',
    handler: getRevenueReport
  },
  {
    method: 'GET',
    path: '/api/admin/reports/bookings',
    roles: ['ADMIN'],
    permission: 'VIEW_REPORTS',
    handler: getBookingsReport
  },
  {
    method: 'GET',
    path: '/api/customer/reports',
    roles: ['CUSTOMER'],
    handler: getCustomerReports
  }
];
