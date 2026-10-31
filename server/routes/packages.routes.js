/**
 * server/routes/packages.routes.js — Owner: M2
 *
 * Public Package APIs per CONTRACT §2:
 *
 *   GET /api/packages — Public
 *     Search and filter packages with pagination and sorting.
 *     Returns APPROVED packages only.
 *     Supports query params:
 *       - q: keyword search in title, description, destination, category
 *       - destination_id: filter by destination ID
 *       - category_id: filter by category ID
 *       - min_price, max_price: price range
 *       - min_days, max_days: duration range
 *       - date: packages with OPEN availability on or after date
 *       - sort: price_asc, price_desc, newest, rating, duration
 *       - page, pageSize: pagination
 *     Returns rows with package_id, title, image, price, duration_days,
 *     destination info, category info, provider info, avg_rating, review_count,
 *     next_available_date.
 *
 *   GET /api/packages/:id — Public
 *     Detailed view of a single package.
 *     Public sees APPROVED packages only (returns 404 for nonexistent or non-approved).
 *     Returns package fields, inclusions[], exclusions[], provider { user_id, name, city, state },
 *     destination, category, itinerary[], availability[] (future OPEN dates), rating { avg, count }.
 */

'use strict';

const { HttpError } = require('../utils/http');

const ALLOWED_SORTS = {
  price_asc:  'p.price ASC, p.package_id ASC',
  price_desc: 'p.price DESC, p.package_id ASC',
  newest:     'p.created_at DESC, p.package_id DESC',
  rating:     'avg_rating DESC, review_count DESC, p.package_id ASC',
  duration:   'p.duration_days ASC, p.package_id ASC'
};

function formatDate(val) {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  return String(val).slice(0, 10);
}

/**
 * GET /api/packages
 * Public package search, filter, and pagination.
 */
async function getPackages(ctx) {
  const whereClauses = ["p.status = 'APPROVED'"];
  const params = [];

  // 1. Keyword search (q)
  const rawQ = ctx.query?.q ?? ctx.query?.search;
  if (rawQ !== undefined && rawQ !== null) {
    if (typeof rawQ !== 'string' || rawQ.length > 100) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'q parameter must be a string up to 100 characters', {
        q: 'q parameter must be a string up to 100 characters'
      });
    }
    const q = rawQ.trim();
    if (q) {
      whereClauses.push('(p.title LIKE ? OR p.description LIKE ? OR d.name LIKE ? OR d.city LIKE ? OR c.category_name LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
  }

  // 2. destination_id
  if (ctx.query?.destination_id !== undefined && ctx.query.destination_id !== null && ctx.query.destination_id !== '') {
    const destId = parseInt(ctx.query.destination_id, 10);
    if (isNaN(destId) || destId <= 0 || String(destId) !== String(ctx.query.destination_id).trim()) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'destination_id must be a positive integer', {
        destination_id: 'destination_id must be a positive integer'
      });
    }
    whereClauses.push('p.destination_id = ?');
    params.push(destId);
  }

  // 3. category_id
  if (ctx.query?.category_id !== undefined && ctx.query.category_id !== null && ctx.query.category_id !== '') {
    const catId = parseInt(ctx.query.category_id, 10);
    if (isNaN(catId) || catId <= 0 || String(catId) !== String(ctx.query.category_id).trim()) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'category_id must be a positive integer', {
        category_id: 'category_id must be a positive integer'
      });
    }
    whereClauses.push('p.category_id = ?');
    params.push(catId);
  }

  // 4. min_price & max_price
  let minP = null;
  if (ctx.query?.min_price !== undefined && ctx.query.min_price !== null && ctx.query.min_price !== '') {
    minP = Number(ctx.query.min_price);
    if (isNaN(minP) || minP < 0) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'min_price must be a non-negative number', {
        min_price: 'min_price must be a non-negative number'
      });
    }
    whereClauses.push('p.price >= ?');
    params.push(minP);
  }

  let maxP = null;
  if (ctx.query?.max_price !== undefined && ctx.query.max_price !== null && ctx.query.max_price !== '') {
    maxP = Number(ctx.query.max_price);
    if (isNaN(maxP) || maxP < 0) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'max_price must be a non-negative number', {
        max_price: 'max_price must be a non-negative number'
      });
    }
    whereClauses.push('p.price <= ?');
    params.push(maxP);
  }

  if (minP !== null && maxP !== null && minP > maxP) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'min_price cannot be greater than max_price', {
      price: 'min_price cannot be greater than max_price'
    });
  }

  // 5. min_days & max_days
  let minD = null;
  if (ctx.query?.min_days !== undefined && ctx.query.min_days !== null && ctx.query.min_days !== '') {
    minD = Number(ctx.query.min_days);
    if (!Number.isInteger(minD) || minD < 1) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'min_days must be a positive integer', {
        min_days: 'min_days must be a positive integer'
      });
    }
    whereClauses.push('p.duration_days >= ?');
    params.push(minD);
  }

  let maxD = null;
  if (ctx.query?.max_days !== undefined && ctx.query.max_days !== null && ctx.query.max_days !== '') {
    maxD = Number(ctx.query.max_days);
    if (!Number.isInteger(maxD) || maxD < 1) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'max_days must be a positive integer', {
        max_days: 'max_days must be a positive integer'
      });
    }
    whereClauses.push('p.duration_days <= ?');
    params.push(maxD);
  }

  if (minD !== null && maxD !== null && minD > maxD) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'min_days cannot be greater than max_days', {
      duration: 'min_days cannot be greater than max_days'
    });
  }

  // 6. date filter (has OPEN availability on or after date)
  if (ctx.query?.date !== undefined && ctx.query.date !== null && ctx.query.date !== '') {
    const dateStr = String(ctx.query.date).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || isNaN(new Date(dateStr).getTime())) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'date must be a valid date in YYYY-MM-DD format', {
        date: 'date must be a valid date in YYYY-MM-DD format'
      });
    }
    whereClauses.push("EXISTS (SELECT 1 FROM package_availability pa WHERE pa.package_id = p.package_id AND pa.status = 'OPEN' AND pa.seats_available > 0 AND pa.available_date >= ? AND pa.available_date >= CURDATE())");
    params.push(dateStr);
  }

  // 7. sort
  let orderByClause = 'p.package_id ASC';
  if (ctx.query?.sort !== undefined && ctx.query.sort !== null && ctx.query.sort !== '') {
    const sortKey = String(ctx.query.sort).trim();
    if (!ALLOWED_SORTS[sortKey]) {
      throw new HttpError(400, 'VALIDATION_ERROR', `Invalid sort option: ${sortKey}. Allowed: ${Object.keys(ALLOWED_SORTS).join(', ')}`, {
        sort: `Invalid sort option: ${sortKey}`
      });
    }
    orderByClause = ALLOWED_SORTS[sortKey];
  }

  // 8. Pagination
  let page = 1;
  if (ctx.query?.page !== undefined && ctx.query.page !== null && ctx.query.page !== '') {
    page = parseInt(ctx.query.page, 10);
    if (isNaN(page) || page < 1 || String(page) !== String(ctx.query.page).trim()) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'page must be a positive integer', {
        page: 'page must be a positive integer'
      });
    }
  }

  let pageSize = 10;
  if (ctx.query?.pageSize !== undefined && ctx.query.pageSize !== null && ctx.query.pageSize !== '') {
    pageSize = parseInt(ctx.query.pageSize, 10);
    if (isNaN(pageSize) || pageSize < 1 || String(pageSize) !== String(ctx.query.pageSize).trim()) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'pageSize must be a positive integer', {
        pageSize: 'pageSize must be a positive integer'
      });
    }
    if (pageSize > 50) pageSize = 50;
  }

  const offset = (page - 1) * pageSize;
  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  // 9. Count total matching packages
  const countSql = `
    SELECT COUNT(*) AS total
    FROM tour_packages p
    JOIN destinations d ON d.destination_id = p.destination_id
    JOIN categories c ON c.category_id = p.category_id
    JOIN users u ON u.user_id = p.provider_id
    ${whereSql}
  `;
  const countRows = await ctx.db.query(countSql, params);
  const total = Number(countRows[0]?.total || 0);

  // 10. Fetch paginated data
  const selectSql = `
    SELECT
      p.package_id,
      p.title,
      p.image,
      p.price,
      p.duration_days,
      p.destination_id,
      d.name AS destination_name,
      d.city,
      d.state,
      p.category_id,
      c.category_name,
      p.provider_id,
      u.name AS provider_name,
      (SELECT ROUND(AVG(rating), 1) FROM reviews WHERE package_id = p.package_id) AS avg_rating,
      (SELECT COUNT(*) FROM reviews WHERE package_id = p.package_id) AS review_count,
      (SELECT MIN(available_date) FROM package_availability WHERE package_id = p.package_id AND status = 'OPEN' AND seats_available > 0 AND available_date >= CURDATE()) AS next_available_date
    FROM tour_packages p
    JOIN destinations d ON d.destination_id = p.destination_id
    JOIN categories c ON c.category_id = p.category_id
    JOIN users u ON u.user_id = p.provider_id
    ${whereSql}
    ORDER BY ${orderByClause}
    LIMIT ? OFFSET ?
  `;

  const rows = await ctx.db.query(selectSql, [...params, pageSize, offset]);

  const data = (rows || []).map((r) => ({
    package_id:          Number(r.package_id),
    title:               r.title,
    image:               r.image || null,
    price:               Number(r.price),
    duration_days:       Number(r.duration_days),
    destination_id:      Number(r.destination_id),
    destination_name:    r.destination_name,
    city:                r.city,
    state:               r.state,
    category_id:         Number(r.category_id),
    category_name:       r.category_name,
    provider_id:         Number(r.provider_id),
    provider_name:       r.provider_name,
    avg_rating:          r.avg_rating !== null && r.avg_rating !== undefined ? Number(r.avg_rating) : null,
    review_count:        Number(r.review_count || 0),
    next_available_date: formatDate(r.next_available_date)
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

/**
 * GET /api/packages/:id
 * Public view of package details. Returns 404 for nonexistent or non-approved packages.
 */
async function getPackageById(ctx) {
  const id = parseInt(ctx.params.id, 10);
  if (isNaN(id) || id <= 0) {
    throw new HttpError(404, 'NOT_FOUND', 'Package not found');
  }

  const pkgSql = `
    SELECT
      p.package_id,
      p.title,
      p.description,
      p.inclusions,
      p.exclusions,
      p.duration_days,
      p.price,
      p.capacity,
      p.image,
      p.status,
      p.created_at,
      p.destination_id,
      d.name AS destination_name,
      d.city AS destination_city,
      d.state AS destination_state,
      d.country AS destination_country,
      d.description AS destination_description,
      p.category_id,
      c.category_name,
      c.description AS category_description,
      p.provider_id,
      u.name AS provider_name,
      u.email AS provider_email,
      u.mobile AS provider_mobile,
      a.city AS provider_city,
      a.state AS provider_state
    FROM tour_packages p
    JOIN destinations d ON d.destination_id = p.destination_id
    JOIN categories c ON c.category_id = p.category_id
    JOIN users u ON u.user_id = p.provider_id
    LEFT JOIN addresses a ON a.user_id = p.provider_id
    WHERE p.package_id = ?
  `;

  const rows = await ctx.db.query(pkgSql, [id]);
  if (!rows || !rows.length) {
    throw new HttpError(404, 'NOT_FOUND', 'Package not found');
  }

  const pkg = rows[0];

  // Non-APPROVED only visible to owner provider and ADMIN
  const user = ctx.user;
  const isOwner = user && user.role === 'PROVIDER' && Number(user.user_id) === Number(pkg.provider_id);
  const isAdmin = user && (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN');
  if (pkg.status !== 'APPROVED' && !isOwner && !isAdmin) {
    throw new HttpError(404, 'NOT_FOUND', 'Package not found');
  }

  // Itinerary
  const itineraryRows = await ctx.db.query(
    'SELECT day_no, title, description FROM package_itinerary WHERE package_id = ? ORDER BY day_no ASC',
    [id]
  );

  // Availability (public sees future OPEN dates with seats on or after today)
  const availSql = (isOwner || isAdmin)
    ? 'SELECT availability_id, available_date, seats_available, status FROM package_availability WHERE package_id = ? ORDER BY available_date ASC'
    : "SELECT availability_id, available_date, seats_available, status FROM package_availability WHERE package_id = ? AND status = 'OPEN' AND seats_available > 0 AND available_date >= CURDATE() ORDER BY available_date ASC";

  const availRows = await ctx.db.query(availSql, [id]);

  // Rating
  const ratingRows = await ctx.db.query(
    'SELECT ROUND(AVG(rating), 1) AS avg, COUNT(review_id) AS count FROM reviews WHERE package_id = ?',
    [id]
  );
  const ratingRow = ratingRows && ratingRows.length ? ratingRows[0] : null;

  const inclusions = typeof pkg.inclusions === 'string'
    ? pkg.inclusions.split('\n').map(s => s.trim()).filter(Boolean)
    : (Array.isArray(pkg.inclusions) ? pkg.inclusions : []);

  const exclusions = typeof pkg.exclusions === 'string'
    ? pkg.exclusions.split('\n').map(s => s.trim()).filter(Boolean)
    : (Array.isArray(pkg.exclusions) ? pkg.exclusions : []);

  const data = {
    package_id:       Number(pkg.package_id),
    title:            pkg.title,
    description:      pkg.description,
    duration_days:    Number(pkg.duration_days),
    price:            Number(pkg.price),
    capacity:         Number(pkg.capacity),
    image:            pkg.image || null,
    status:           pkg.status,
    created_at:       pkg.created_at instanceof Date ? pkg.created_at.toISOString() : String(pkg.created_at),
    inclusions,
    exclusions,
    destination_id:   Number(pkg.destination_id),
    destination_name: pkg.destination_name,
    city:             pkg.destination_city,
    state:            pkg.destination_state,
    destination: {
      destination_id: Number(pkg.destination_id),
      name:           pkg.destination_name,
      city:           pkg.destination_city,
      state:          pkg.destination_state,
      country:        pkg.destination_country,
      description:    pkg.destination_description
    },
    category_id:      Number(pkg.category_id),
    category_name:    pkg.category_name,
    category: {
      category_id:    Number(pkg.category_id),
      name:           pkg.category_name,
      description:    pkg.category_description
    },
    provider_id:      Number(pkg.provider_id),
    provider_name:    pkg.provider_name,
    provider: {
      user_id:        Number(pkg.provider_id),
      name:           pkg.provider_name,
      city:           pkg.provider_city || null,
      state:          pkg.provider_state || null
    },
    itinerary: (itineraryRows || []).map(i => ({
      day_no:      Number(i.day_no),
      title:       i.title,
      description: i.description
    })),
    availability: (availRows || []).map(a => ({
      availability_id: Number(a.availability_id),
      available_date:  formatDate(a.available_date),
      seats_available: Number(a.seats_available),
      status:          a.status
    })),
    rating: {
      avg:   ratingRow?.avg !== null && ratingRow?.avg !== undefined ? Number(ratingRow.avg) : null,
      count: Number(ratingRow?.count || 0)
    }
  };

  return { data };
}

module.exports = [
  {
    method:  'GET',
    path:    '/api/packages',
    handler: getPackages
  },
  {
    method:  'GET',
    path:    '/api/packages/:id',
    handler: getPackageById
  }
];
