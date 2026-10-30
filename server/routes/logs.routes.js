/**
 * server/routes/logs.routes.js — Owner: M1
 *
 * Admin Audit Logs API per CONTRACT §1.5, §1.6, §1.7:
 *
 *   GET /api/admin/logs — ADMIN + VIEW_LOGS (or SUPER_ADMIN)
 *
 * Query parameters:
 *   - user_id  : filter by user_id
 *   - action   : filter by action name (e.g. LOGIN, USER_STATUS_CHANGED)
 *   - from     : start date/time (inclusive)
 *   - to       : end date/time (inclusive)
 *   - page     : page number (default 1)
 *   - pageSize : page size (default 20, max 50)
 *
 * Returns rows containing:
 *   log_id, user_id, user_name, action, description, ip_address, created_at
 */

'use strict';

/**
 * Parses and bounds pagination parameters.
 * Default page: 1, default pageSize: 20, max pageSize: 50.
 */
function parsePagination(query) {
  let page = parseInt(query?.page, 10);
  if (isNaN(page) || page < 1) page = 1;

  let pageSize = parseInt(query?.pageSize, 10);
  if (isNaN(pageSize) || pageSize < 1) pageSize = 20;
  if (pageSize > 50) pageSize = 50;

  const offset = (page - 1) * pageSize;
  return { page, pageSize, offset };
}

/**
 * Normalizes 'from' date string to ensure inclusive boundary at start of day.
 */
function parseFromDate(val) {
  if (typeof val !== 'string') return null;
  const str = val.trim();
  if (!str) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return `${str} 00:00:00`;
  }
  return str;
}

/**
 * Normalizes 'to' date string to ensure inclusive boundary at end of day.
 */
function parseToDate(val) {
  if (typeof val !== 'string') return null;
  const str = val.trim();
  if (!str) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return `${str} 23:59:59`;
  }
  return str;
}

/**
 * GET /api/admin/logs
 */
async function getLogs(ctx) {
  const { page, pageSize, offset } = parsePagination(ctx.query);

  const whereConditions = [];
  const filterParams = [];

  // user_id filter
  if (ctx.query?.user_id !== undefined && ctx.query?.user_id !== null && String(ctx.query.user_id).trim() !== '') {
    const userId = parseInt(ctx.query.user_id, 10);
    if (!isNaN(userId) && userId > 0) {
      whereConditions.push('l.user_id = ?');
      filterParams.push(userId);
    }
  }

  // action filter (case-insensitive normalization)
  if (typeof ctx.query?.action === 'string' && ctx.query.action.trim() !== '') {
    whereConditions.push('l.action = ?');
    filterParams.push(ctx.query.action.trim().toUpperCase());
  }

  // from date filter (inclusive)
  const fromDate = parseFromDate(ctx.query?.from);
  if (fromDate) {
    whereConditions.push('l.created_at >= ?');
    filterParams.push(fromDate);
  }

  // to date filter (inclusive)
  const toDate = parseToDate(ctx.query?.to);
  if (toDate) {
    whereConditions.push('l.created_at <= ?');
    filterParams.push(toDate);
  }

  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

  // 1. Total count
  const countSql = `SELECT COUNT(*) AS total FROM system_logs l ${whereClause}`;
  const countRows = await ctx.db.query(countSql, filterParams);
  const total = Number(countRows[0]?.total || 0);

  // 2. Data rows with user_name joined from users table
  const dataSql = `
    SELECT
      l.log_id,
      l.user_id,
      u.name AS user_name,
      l.action,
      l.description,
      l.ip_address,
      l.created_at
    FROM system_logs l
    LEFT JOIN users u ON u.user_id = l.user_id
    ${whereClause}
    ORDER BY l.log_id DESC
    LIMIT ? OFFSET ?
  `;

  const rows = await ctx.db.query(dataSql, [...filterParams, pageSize, offset]);

  const data = rows.map((r) => ({
    log_id:      Number(r.log_id),
    user_id:     r.user_id !== null && r.user_id !== undefined ? Number(r.user_id) : null,
    user_name:   r.user_name !== undefined && r.user_name !== null ? r.user_name : null,
    action:      r.action,
    description: r.description !== undefined && r.description !== null ? r.description : null,
    ip_address:  r.ip_address !== undefined && r.ip_address !== null ? r.ip_address : null,
    created_at:  r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at)
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
    method:     'GET',
    path:       '/api/admin/logs',
    roles:      ['ADMIN'],
    permission: 'VIEW_LOGS',
    handler:    getLogs
  }
];

