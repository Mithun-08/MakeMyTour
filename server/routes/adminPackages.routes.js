// server/routes/adminPackages.routes.js — Owner: M2 (Meharnaz)
// Contract: docs/CONTRACT.md — Admin package moderation
'use strict';

const { HttpError } = require('../utils/http');
const validate = require('../utils/validate');
const { logAction } = require('../utils/logger');

/** Helper: base package SELECT with joins and computed fields */
function basePackageSelect() {
  return `
    p.package_id, p.title, p.image, p.price, p.duration_days, p.status,
    d.destination_id, d.name AS destination_name, d.city, d.state,
    c.category_id, c.category_name,
    u.user_id AS provider_id, u.name AS provider_name,
    (SELECT AVG(r.rating) FROM reviews r WHERE r.package_id = p.package_id) AS avg_rating,
    (SELECT COUNT(*) FROM reviews r WHERE r.package_id = p.package_id) AS review_count,
    (SELECT MIN(a.available_date)
       FROM package_availability a
       WHERE a.package_id = p.package_id
         AND a.status = 'OPEN'
         AND a.available_date >= CURDATE()) AS next_available_date
  `;
}

/** Parse pagination parameters */
function parsePagination(query) {
  let page = parseInt(query.page, 10);
  if (isNaN(page) || page < 1) page = 1;
  let pageSize = parseInt(query.pageSize, 10);
  if (isNaN(pageSize) || pageSize < 1) pageSize = 10;
  if (pageSize > 50) pageSize = 50;
  const offset = (page - 1) * pageSize;
  return { page, pageSize, offset };
}

/** ADMIN: GET /api/admin/packages
 * Query params: status (enum), q (search), page, pageSize
 */
async function adminListPackages(ctx) {
  const { page, pageSize, offset } = parsePagination(ctx.query);
  const query = validate(ctx.query || {}, {
    status: { type: 'enum', values: ['APPROVED', 'REJECTED', 'DISABLED', 'PENDING'] },
    q: { type: 'string', max: 200 }
  });

  const where = [];
  const params = [];
  if (query.status) { where.push('p.status = ?'); params.push(query.status); }
  if (query.q) { where.push('(p.title LIKE ? OR p.description LIKE ?)'); const like = `%${query.q}%`; params.push(like, like); }

  // total count
  const countSql = `SELECT COUNT(*) AS total FROM tour_packages p ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
  const countRows = await ctx.db.query(countSql, params);
  const total = Number(countRows[0]?.total || 0);

  const sql = `
    SELECT ${basePackageSelect()}, COUNT(*) OVER() AS total_count
    FROM tour_packages p
    JOIN destinations d ON p.destination_id = d.destination_id
    JOIN categories c ON p.category_id = c.category_id
    JOIN users u ON p.provider_id = u.user_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY p.created_at DESC
    LIMIT ? OFFSET ?`;
  params.push(pageSize, offset);
  const rows = await ctx.db.query(sql, params);
  const data = rows.map(r => ({
    package_id: r.package_id,
    title: r.title,
    image: r.image,
    price: Number(r.price),
    duration_days: Number(r.duration_days),
    status: r.status,
    destination_name: r.destination_name,
    category_name: r.category_name,
    provider_id: r.provider_id,
    provider_name: r.provider_name,
    avg_rating: r.avg_rating !== null ? Number(r.avg_rating) : null,
    review_count: Number(r.review_count),
    next_available_date: r.next_available_date ? r.next_available_date.toISOString().split('T')[0] : null
  }));
  return { data, meta: { total, page, pageSize } };
}

/** ADMIN: PATCH /api/admin/packages/:id/status */
async function adminPatchPackageStatus(ctx) {
  const id = Number(ctx.params.id);
  if (!id) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid package id');
  const body = validate(ctx.body || {}, {
    status: { required: true, type: 'enum', values: ['APPROVED', 'REJECTED', 'DISABLED'] }
  });
  const rows = await ctx.db.query('SELECT package_id FROM tour_packages WHERE package_id = ?', [id]);
  if (!rows.length) throw new HttpError(404, 'NOT_FOUND', 'Package not found');
  await ctx.db.query('UPDATE tour_packages SET status = ? WHERE package_id = ?', [body.status, id]);
  await logAction(ctx, 'PACKAGE_MODERATED', `Admin ${ctx.user.user_id} set package ${id} status to ${body.status}`);
  return { data: { package_id: id, status: body.status } };
}

/** ADMIN: DELETE /api/admin/packages/:id */
async function adminDeletePackage(ctx) {
  const id = Number(ctx.params.id);
  if (!id) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid package id');
  const rows = await ctx.db.query('SELECT package_id FROM tour_packages WHERE package_id = ?', [id]);
  if (!rows.length) throw new HttpError(404, 'NOT_FOUND', 'Package not found');
  const bookingRows = await ctx.db.query('SELECT booking_id FROM bookings WHERE package_id = ? AND booking_status != "CANCELLED" LIMIT 1', [id]);
  if (bookingRows.length) throw new HttpError(409, 'CONFLICT', 'Package has active bookings');
  await ctx.db.query('DELETE FROM tour_packages WHERE package_id = ?', [id]);
  await logAction(ctx, 'PACKAGE_DELETED', `Admin ${ctx.user.user_id} deleted package ${id}`);
  return { data: { package_id: id } };
}

module.exports = [
  { method: 'GET', path: '/api/admin/packages', handler: adminListPackages, roles: ['ADMIN'], permission: 'MODERATE_PACKAGES' },
  { method: 'PATCH', path: '/api/admin/packages/:id/status', handler: adminPatchPackageStatus, roles: ['ADMIN'], permission: 'MODERATE_PACKAGES' },
  { method: 'DELETE', path: '/api/admin/packages/:id', handler: adminDeletePackage, roles: ['ADMIN'], permission: 'MODERATE_PACKAGES' }
];
