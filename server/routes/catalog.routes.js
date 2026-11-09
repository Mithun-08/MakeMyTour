/**
 * server/routes/catalog.routes.js — Owner: M2
 *
 * Public Catalog APIs per CONTRACT §2:
 *
 *   GET /api/destinations — Public
 *     Returns ACTIVE destinations only.
 *     Supports query parameters:
 *       - q: keyword search matching name, city, or state
 *       - state: filter by state
 *     Includes package_count counting APPROVED packages.
 *
 *   GET /api/categories — Public
 *     Returns ACTIVE categories only.
 */

'use strict';

const { HttpError } = require('../utils/http');

/**
 * GET /api/destinations
 * Public endpoint.
 * Returns ACTIVE destinations with package_count (count of APPROVED packages).
 * Supports q and state query filters.
 */
async function getDestinations(ctx) {
  const whereClauses = ["d.status = 'ACTIVE'"];
  const params = [];

  const rawQ = ctx.query?.q ?? ctx.query?.search;
  if (rawQ !== undefined && rawQ !== null) {
    if (typeof rawQ !== 'string' || rawQ.length > 100) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'q parameter must be a string up to 100 characters', {
        q: 'q parameter must be a string up to 100 characters'
      });
    }
    const q = rawQ.trim();
    if (q) {
      whereClauses.push('(d.name LIKE ? OR d.city LIKE ? OR d.state LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
  }

  if (ctx.query?.state !== undefined && ctx.query?.state !== null) {
    if (typeof ctx.query.state !== 'string' || ctx.query.state.length > 100) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'state parameter must be a string up to 100 characters', {
        state: 'state parameter must be a string up to 100 characters'
      });
    }
    const state = ctx.query.state.trim();
    if (state) {
      whereClauses.push('d.state = ?');
      params.push(state);
    }
  }

  const sql = `
    SELECT
      d.destination_id,
      d.name,
      d.city,
      d.state,
      d.country,
      d.description,
      d.status,
      COUNT(p.package_id) AS package_count
    FROM destinations d
    LEFT JOIN tour_packages p
      ON p.destination_id = d.destination_id
      AND p.status = 'APPROVED'
    WHERE ${whereClauses.join(' AND ')}
    GROUP BY
      d.destination_id,
      d.name,
      d.city,
      d.state,
      d.country,
      d.description,
      d.status
    ORDER BY d.destination_id ASC
  `;

  const rows = await ctx.db.query(sql, params);

  const data = (rows || []).map((r) => ({
    destination_id: Number(r.destination_id),
    name:           r.name,
    city:           r.city,
    state:          r.state,
    country:        r.country,
    description:    r.description,
    status:         r.status,
    package_count:  Number(r.package_count || 0)
  }));

  return { data };
}

/**
 * GET /api/categories
 * Public endpoint.
 * Returns ACTIVE categories only.
 */
async function getCategories(ctx) {
  const sql = `
    SELECT
      category_id,
      category_name,
      description,
      status
    FROM categories
    WHERE status = 'ACTIVE'
    ORDER BY category_id ASC
  `;

  const rows = await ctx.db.query(sql);

  const data = (rows || []).map((r) => ({
    category_id:   Number(r.category_id),
    category_name: r.category_name,
    description:   r.description,
    status:        r.status
  }));

  return { data };
}

module.exports = [
  {
    method:  'GET',
    path:    '/api/destinations',
    handler: getDestinations
  },
  {
    method:  'GET',
    path:    '/api/categories',
    handler: getCategories
  }
];
