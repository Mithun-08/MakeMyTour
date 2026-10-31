'use strict';

/**
 * server/routes/catalog.routes.js — Owner: M2
 * Contract: docs/CONTRACT.md "Catalog (Owner M2)"
 *
 *   GET /api/destinations   public  ACTIVE only. query q, state.
 *                                   Rows include package_count (publicly visible APPROVED packages)
 *   GET /api/categories     public  ACTIVE only
 *
 * Admin destination/category CRUD (also M2 in the contract) is not part of this stage.
 */

const validate = require('../utils/validate');

async function listDestinations(ctx) {
  const query = validate(ctx.query || {}, {
    q:     { type: 'string', max: 100 },
    state: { type: 'string', max: 100 }
  });

  const where = ["d.status = 'ACTIVE'"];
  const params = [];

  if (query.q) {
    where.push('(d.name LIKE ? OR d.city LIKE ? OR d.state LIKE ?)');
    const like = `%${query.q}%`;
    params.push(like, like, like);
  }
  if (query.state) {
    where.push('d.state = ?');
    params.push(query.state);
  }

  // package_count only counts packages the public can actually see.
  const rows = await ctx.db.query(
    `SELECT d.destination_id, d.name, d.city, d.state, d.country, d.description,
            COALESCE(pc.package_count, 0) AS package_count
       FROM destinations d
       LEFT JOIN (
         SELECT p.destination_id, COUNT(*) AS package_count
           FROM tour_packages p
           JOIN users u ON u.user_id = p.provider_id
          WHERE p.status = 'APPROVED' AND u.status = 'ACTIVE'
          GROUP BY p.destination_id
       ) pc ON pc.destination_id = d.destination_id
      WHERE ${where.join(' AND ')}
      ORDER BY package_count DESC, d.name ASC`,
    params
  );

  return {
    data: rows.map((r) => ({ ...r, package_count: Number(r.package_count) || 0 }))
  };
}

async function listCategories(ctx) {
  const rows = await ctx.db.query(
    `SELECT category_id, category_name, description
       FROM categories
      WHERE status = 'ACTIVE'
      ORDER BY category_name ASC`
  );
  return { data: rows };
}

module.exports = [
  { method: 'GET', path: '/api/destinations', handler: listDestinations },
  { method: 'GET', path: '/api/categories',   handler: listCategories }
];
