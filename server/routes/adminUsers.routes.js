/**
 * server/routes/adminUsers.routes.js — Owner: M1
 *
 * Admin User Management endpoints per CONTRACT §1.5, §1.6, §1.7:
 *
 *   GET   /api/admin/customers        — ADMIN + MANAGE_USERS (or SUPER_ADMIN)
 *   GET   /api/admin/providers        — ADMIN + MANAGE_PROVIDERS (or SUPER_ADMIN)
 *   PATCH /api/admin/users/:id/status — ADMIN (MANAGE_USERS for customer, MANAGE_PROVIDERS for provider)
 *
 * Constraints:
 *   - Target with role ADMIN or SUPER_ADMIN yields 403 FORBIDDEN.
 *   - Status transitions:
 *       PENDING -> ACTIVE   (Approve)
 *       PENDING -> REJECTED (Reject)
 *       ACTIVE  -> BLOCKED  (Block)
 *       BLOCKED -> ACTIVE   (Unblock)
 *     All other transitions yield 409 CONFLICT.
 *   - Password hashes are never selected or returned.
 *   - Audit logged with USER_STATUS_CHANGED.
 */

'use strict';

const { HttpError } = require('../utils/http');
const validate = require('../utils/validate');
const { logAction } = require('../utils/logger');

const VALID_USER_STATUSES = ['ACTIVE', 'PENDING', 'BLOCKED', 'REJECTED', 'INACTIVE'];

/**
 * Parses and bounds pagination parameters.
 */
function parsePagination(query) {
  let page = parseInt(query.page, 10);
  if (isNaN(page) || page < 1) page = 1;

  let pageSize = parseInt(query.pageSize, 10);
  if (isNaN(pageSize) || pageSize < 1) pageSize = 10;
  if (pageSize > 50) pageSize = 50;

  const offset = (page - 1) * pageSize;
  return { page, pageSize, offset };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/customers
// ─────────────────────────────────────────────────────────────────────────────

async function getCustomers(ctx) {
  const { page, pageSize, offset } = parsePagination(ctx.query);
  const search = typeof ctx.query.search === 'string'
    ? ctx.query.search.trim()
    : (typeof ctx.query.q === 'string' ? ctx.query.q.trim() : '');
  const statusFilter = typeof ctx.query.status === 'string' ? ctx.query.status.trim().toUpperCase() : '';

  const whereConditions = ["u.role = 'CUSTOMER'"];
  const filterParams = [];

  if (statusFilter && VALID_USER_STATUSES.includes(statusFilter)) {
    whereConditions.push('u.status = ?');
    filterParams.push(statusFilter);
  }

  if (search) {
    whereConditions.push('(u.name LIKE ? OR u.email LIKE ? OR u.mobile LIKE ?)');
    const term = `%${search}%`;
    filterParams.push(term, term, term);
  }

  const whereClause = whereConditions.join(' AND ');

  // 1. Total count
  const countSql = `SELECT COUNT(*) AS total FROM users u WHERE ${whereClause}`;
  const countRows = await ctx.db.query(countSql, filterParams);
  const total = Number(countRows[0]?.total || 0);

  // 2. Data rows
  const dataSql = `
    SELECT
      u.user_id,
      u.name,
      u.email,
      u.mobile,
      u.status,
      u.created_at,
      COALESCE(b.total_bookings, 0) AS total_bookings
    FROM users u
    LEFT JOIN (
      SELECT customer_id, COUNT(*) AS total_bookings
      FROM bookings
      GROUP BY customer_id
    ) b ON b.customer_id = u.user_id
    WHERE ${whereClause}
    ORDER BY u.user_id DESC
    LIMIT ? OFFSET ?
  `;

  const rows = await ctx.db.query(dataSql, [...filterParams, pageSize, offset]);

  const data = rows.map((r) => ({
    user_id:        Number(r.user_id),
    name:           r.name,
    email:          r.email,
    mobile:         r.mobile,
    status:         r.status,
    created_at:     r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    total_bookings: Number(r.total_bookings)
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
// GET /api/admin/providers
// ─────────────────────────────────────────────────────────────────────────────

async function getProviders(ctx) {
  const { page, pageSize, offset } = parsePagination(ctx.query);
  const search = typeof ctx.query.search === 'string'
    ? ctx.query.search.trim()
    : (typeof ctx.query.q === 'string' ? ctx.query.q.trim() : '');
  const statusFilter = typeof ctx.query.status === 'string' ? ctx.query.status.trim().toUpperCase() : '';

  const whereConditions = ["u.role = 'PROVIDER'"];
  const filterParams = [];

  if (statusFilter && VALID_USER_STATUSES.includes(statusFilter)) {
    whereConditions.push('u.status = ?');
    filterParams.push(statusFilter);
  }

  if (search) {
    whereConditions.push('(u.name LIKE ? OR u.email LIKE ? OR u.mobile LIKE ?)');
    const term = `%${search}%`;
    filterParams.push(term, term, term);
  }

  const whereClause = whereConditions.join(' AND ');

  // 1. Total count
  const countSql = `SELECT COUNT(*) AS total FROM users u WHERE ${whereClause}`;
  const countRows = await ctx.db.query(countSql, filterParams);
  const total = Number(countRows[0]?.total || 0);

  // 2. Data rows (package_count and primary address city/state)
  const dataSql = `
    SELECT
      u.user_id,
      u.name,
      u.email,
      u.mobile,
      u.status,
      u.created_at,
      COALESCE(p.package_count, 0) AS package_count,
      a.city,
      a.state
    FROM users u
    LEFT JOIN (
      SELECT provider_id, COUNT(*) AS package_count
      FROM tour_packages
      GROUP BY provider_id
    ) p ON p.provider_id = u.user_id
    LEFT JOIN (
      SELECT user_id, city, state
      FROM addresses
      WHERE (user_id, address_id) IN (
        SELECT user_id, MIN(address_id)
        FROM addresses
        GROUP BY user_id
      )
    ) a ON a.user_id = u.user_id
    WHERE ${whereClause}
    ORDER BY u.user_id DESC
    LIMIT ? OFFSET ?
  `;

  const rows = await ctx.db.query(dataSql, [...filterParams, pageSize, offset]);

  const data = rows.map((r) => ({
    user_id:       Number(r.user_id),
    name:          r.name,
    email:         r.email,
    mobile:        r.mobile,
    status:        r.status,
    created_at:    r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    package_count: Number(r.package_count),
    city:          r.city !== undefined ? r.city : null,
    state:         r.state !== undefined ? r.state : null
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
// PATCH /api/admin/users/:id/status
// ─────────────────────────────────────────────────────────────────────────────

async function updateUserStatus(ctx) {
  const targetId = parseInt(ctx.params.id, 10);
  if (isNaN(targetId) || targetId <= 0) {
    throw new HttpError(400, 'BAD_REQUEST', 'Invalid user ID in request parameter');
  }

  const body = validate(ctx.body, {
    status: { required: true, type: 'enum', values: ['ACTIVE', 'BLOCKED', 'REJECTED'] }
  });

  // Query target user
  const rows = await ctx.db.query(
    'SELECT user_id, name, email, role, status FROM users WHERE user_id = ?',
    [targetId]
  );
  if (!rows.length) {
    throw new HttpError(404, 'NOT_FOUND', 'User not found');
  }

  const target = rows[0];

  // CONTRACT §1.7: Targets with role ADMIN or SUPER_ADMIN give 403
  if (target.role === 'ADMIN' || target.role === 'SUPER_ADMIN') {
    throw new HttpError(403, 'FORBIDDEN', 'Cannot modify status of administrative accounts');
  }

  // Permission check based on target role (SUPER_ADMIN always passes)
  const callerRole = ctx.user.role;
  const callerPermissions = Array.isArray(ctx.user.permissions) ? ctx.user.permissions : [];

  if (callerRole !== 'SUPER_ADMIN') {
    if (target.role === 'CUSTOMER' && !callerPermissions.includes('MANAGE_USERS')) {
      throw new HttpError(403, 'FORBIDDEN', 'Permission required: MANAGE_USERS');
    }
    if (target.role === 'PROVIDER' && !callerPermissions.includes('MANAGE_PROVIDERS')) {
      throw new HttpError(403, 'FORBIDDEN', 'Permission required: MANAGE_PROVIDERS');
    }
  }

  // CONTRACT §1.7 Status transition rules:
  //   Approve = PENDING to ACTIVE
  //   Reject  = PENDING to REJECTED
  //   Block   = ACTIVE to BLOCKED
  //   Unblock = BLOCKED to ACTIVE
  const currentStatus = target.status;
  const newStatus = body.status;

  const isValidTransition =
    (currentStatus === 'PENDING' && (newStatus === 'ACTIVE' || newStatus === 'REJECTED')) ||
    (currentStatus === 'ACTIVE' && newStatus === 'BLOCKED') ||
    (currentStatus === 'BLOCKED' && newStatus === 'ACTIVE');

  if (!isValidTransition) {
    throw new HttpError(
      409,
      'CONFLICT',
      `Cannot change status from ${currentStatus} to ${newStatus}`
    );
  }

  await ctx.db.query(
    'UPDATE users SET status = ? WHERE user_id = ?',
    [newStatus, targetId]
  );

  await logAction(
    ctx,
    'USER_STATUS_CHANGED',
    `User ${target.email} (${target.role}) status changed from ${currentStatus} to ${newStatus}`
  );

  return {
    data: {
      user_id:         Number(targetId),
      status:          newStatus,
      previous_status: currentStatus
    },
    message: `User status changed to ${newStatus}`
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Route table (auto-loaded by router.js)
// ─────────────────────────────────────────────────────────────────────────────

module.exports = [
  {
    method:     'GET',
    path:       '/api/admin/customers',
    roles:      ['ADMIN'], // SUPER_ADMIN passes automatically via router
    permission: 'MANAGE_USERS',
    handler:    getCustomers
  },
  {
    method:     'GET',
    path:       '/api/admin/providers',
    roles:      ['ADMIN'],
    permission: 'MANAGE_PROVIDERS',
    handler:    getProviders
  },
  {
    method:     'PATCH',
    path:       '/api/admin/users/:id/status',
    roles:      ['ADMIN'],
    handler:    updateUserStatus
  }
];

