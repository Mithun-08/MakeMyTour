// server/routes/packages.routes.js — Owner: M2 (Mehar­naz)
// Contract: docs/CONTRACT.md §1.8 Catalog (M2) – Packages API

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

/** PUBLIC: GET /api/packages */
async function listPackages(ctx) {
  const query = validate(ctx.query || {}, {
    q: { type: 'string', max: 200 },
    destination_id: { type: 'int' },
    category_id: { type: 'int' },
    min_price: { type: 'number' },
    max_price: { type: 'number' },
    sort: { type: 'enum', values: ['price_asc','price_desc','newest','rating','duration'] },
    page: { type: 'int', min: 1, default: 1 },
    pageSize: { type: 'int', min: 1, max: 50, default: 10 }
  });

  const where = [];
  const params = [];

  // Only approved packages from active providers
  where.push("p.status = 'APPROVED'", "u.status = 'ACTIVE'");

  if (query.q) {
    where.push('(p.title LIKE ? OR p.description LIKE ?)');
    const like = `%${query.q}%`;
    params.push(like, like);
  }
  if (query.destination_id) { where.push('p.destination_id = ?'); params.push(query.destination_id); }
  if (query.category_id) { where.push('p.category_id = ?'); params.push(query.category_id); }
  if (query.min_price !== undefined) { where.push('p.price >= ?'); params.push(query.min_price); }
  if (query.max_price !== undefined) { where.push('p.price <= ?'); params.push(query.max_price); }

  // Sorting
  let order = 'p.created_at DESC'; // default newest
  if (query.sort) {
    switch (query.sort) {
      case 'price_asc': order = 'p.price ASC'; break;
      case 'price_desc': order = 'p.price DESC'; break;
      case 'newest': order = 'p.created_at DESC'; break;
      case 'rating': order = 'avg_rating DESC'; break;
      case 'duration': order = 'p.duration_days DESC'; break;
    }
  }

  const limit = query.pageSize;
  const offset = (query.page - 1) * limit;

  const sql = `
    SELECT ${basePackageSelect()}, COUNT(*) OVER() AS total_count
    FROM tour_packages p
    JOIN destinations d ON p.destination_id = d.destination_id
    JOIN categories c ON p.category_id = c.category_id
    JOIN users u ON p.provider_id = u.user_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY ${order}
    LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const rows = await ctx.db.query(sql, params);
  const total = rows.length ? Number(rows[0].total_count) : 0;
  const data = rows.map(r => ({
    package_id: r.package_id,
    title: r.title,
    image: r.image,
    price: Number(r.price),
    duration_days: Number(r.duration_days),
    destination_id: r.destination_id,
    destination_name: r.destination_name,
    state: r.state,
    category_id: r.category_id,
    category_name: r.category_name,
    provider_id: r.provider_id,
    provider_name: r.provider_name,
    avg_rating: r.avg_rating !== null ? Number(r.avg_rating) : null,
    review_count: Number(r.review_count),
    next_available_date: r.next_available_date ? r.next_available_date.toISOString().split('T')[0] : null
  }));

  return { data, meta: { total, page: query.page, pageSize: limit } };
}

/** PUBLIC: GET /api/packages/:id */
async function getPackageDetail(ctx) {
  const id = Number(ctx.params.id);
  if (!id) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid package id');

  const rows = await ctx.db.query(`
    SELECT ${basePackageSelect()}, p.inclusions, p.exclusions, p.capacity
    FROM tour_packages p
    JOIN destinations d ON p.destination_id = d.destination_id
    JOIN categories c ON p.category_id = c.category_id
    JOIN users u ON p.provider_id = u.user_id
    WHERE p.package_id = ?
  `, [id]);

  if (!rows.length) throw new HttpError(404, 'NOT_FOUND', 'Package not found');
  const pkg = rows[0];

  // Public visibility check
  if (pkg.status !== 'APPROVED' || pkg.provider_status !== 'ACTIVE') {
    throw new HttpError(403, 'FORBIDDEN', 'Package not publicly visible');
  }

  const inclusions = pkg.inclusions ? pkg.inclusions.split('\n').filter(Boolean) : [];
  const exclusions = pkg.exclusions ? pkg.exclusions.split('\n').filter(Boolean) : [];

  const itineraryRows = await ctx.db.query(`
    SELECT day_no, title, description FROM package_itinerary
    WHERE package_id = ? ORDER BY day_no ASC
  `, [id]);

  const availRows = await ctx.db.query(`
    SELECT availability_id, available_date, seats_available, status
    FROM package_availability
    WHERE package_id = ?
      AND status = 'OPEN'
      AND available_date >= CURDATE()
    ORDER BY available_date ASC
  `, [id]);

  const data = {
    package_id: pkg.package_id,
    title: pkg.title,
    description: pkg.description,
    image: pkg.image,
    price: Number(pkg.price),
    duration_days: Number(pkg.duration_days),
    status: pkg.status,
    destination: {
      destination_id: pkg.destination_id,
      name: pkg.destination_name,
      city: pkg.city,
      state: pkg.state
    },
    category: { category_id: pkg.category_id, name: pkg.category_name },
    provider: { user_id: pkg.provider_id, name: pkg.provider_name },
    inclusions,
    exclusions,
    itinerary: itineraryRows.map(r => ({ day_no: r.day_no, title: r.title, description: r.description })),
    availability: availRows.map(r => ({ availability_id: r.availability_id, available_date: r.available_date.toISOString().split('T')[0], seats_available: r.seats_available, status: r.status })),
    avg_rating: pkg.avg_rating !== null ? Number(pkg.avg_rating) : null,
    review_count: Number(pkg.review_count)
  };

  return { data };
}

/** PROVIDER: GET /api/provider/packages */
async function listProviderPackages(ctx) {
  const user = ctx.user;
  if (!user || user.role !== 'PROVIDER') throw new HttpError(401, 'UNAUTHENTICATED');

  const rows = await ctx.db.query(`
    SELECT ${basePackageSelect()}
    FROM tour_packages p
    JOIN destinations d ON p.destination_id = d.destination_id
    JOIN categories c ON p.category_id = c.category_id
    JOIN users u ON p.provider_id = u.user_id
    WHERE p.provider_id = ?
    ORDER BY p.created_at DESC
  `, [user.user_id]);

  const data = rows.map(r => ({
    package_id: r.package_id,
    title: r.title,
    image: r.image,
    price: Number(r.price),
    duration_days: Number(r.duration_days),
    status: r.status,
    destination_name: r.destination_name,
    category_name: r.category_name,
    avg_rating: r.avg_rating !== null ? Number(r.avg_rating) : null,
    review_count: Number(r.review_count),
    next_available_date: r.next_available_date ? r.next_available_date.toISOString().split('T')[0] : null
  }));
  return { data };
}

/** PROVIDER: GET /api/provider/packages/:id */
async function getProviderPackage(ctx) {
  const user = ctx.user;
  if (!user || user.role !== 'PROVIDER') throw new HttpError(401, 'UNAUTHENTICATED');
  const id = Number(ctx.params.id);
  if (!id) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid package id');

  const rows = await ctx.db.query(`
    SELECT ${basePackageSelect()}, p.inclusions, p.exclusions, p.capacity
    FROM tour_packages p
    JOIN destinations d ON p.destination_id = d.destination_id
    JOIN categories c ON p.category_id = c.category_id
    JOIN users u ON p.provider_id = u.user_id
    WHERE p.package_id = ? AND p.provider_id = ?
  `, [id, user.user_id]);

  if (!rows.length) throw new HttpError(404, 'NOT_FOUND', 'Package not found');
  const pkg = rows[0];

  const inclusions = pkg.inclusions ? pkg.inclusions.split('\n').filter(Boolean) : [];
  const exclusions = pkg.exclusions ? pkg.exclusions.split('\n').filter(Boolean) : [];

  const itineraryRows = await ctx.db.query(`
    SELECT day_no, title, description FROM package_itinerary
    WHERE package_id = ? ORDER BY day_no ASC
  `, [id]);

  const availRows = await ctx.db.query(`
    SELECT availability_id, available_date, seats_available, status
    FROM package_availability
    WHERE package_id = ? ORDER BY available_date ASC
  `, [id]);

  const data = {
    package_id: pkg.package_id,
    title: pkg.title,
    description: pkg.description,
    image: pkg.image,
    price: Number(pkg.price),
    duration_days: Number(pkg.duration_days),
    status: pkg.status,
    capacity: Number(pkg.capacity),
    destination: {
      destination_id: pkg.destination_id,
      name: pkg.destination_name,
      city: pkg.city,
      state: pkg.state
    },
    category: { category_id: pkg.category_id, name: pkg.category_name },
    provider: { user_id: pkg.provider_id, name: pkg.provider_name },
    inclusions,
    exclusions,
    itinerary: itineraryRows.map(r => ({ day_no: r.day_no, title: r.title, description: r.description })),
    availability: availRows.map(r => ({ availability_id: r.availability_id, available_date: r.available_date.toISOString().split('T')[0], seats_available: r.seats_available, status: r.status })),
    avg_rating: pkg.avg_rating !== null ? Number(pkg.avg_rating) : null,
    review_count: Number(pkg.review_count)
  };
  return { data };
}

/** PROVIDER: POST /api/provider/packages */
async function createProviderPackage(ctx) {
  const user = ctx.user;
  if (!user || user.role !== 'PROVIDER') throw new HttpError(401, 'UNAUTHENTICATED');

  const body = validate(ctx.body || {}, {
    title: { required: true, type: 'string', max: 200 },
    description: { type: 'string' },
    destination_id: { required: true, type: 'int' },
    category_id: { required: true, type: 'int' },
    inclusions: { type: 'array' },
    exclusions: { type: 'array' },
    duration_days: { required: true, type: 'int', min: 1 },
    price: { required: true, type: 'number', min: 0 },
    capacity: { required: true, type: 'int', min: 1 },
    image: { type: 'string' },
    itinerary: { type: 'array' },
    availability: { type: 'array' }
  });

  const inclusionsStr = Array.isArray(body.inclusions) ? body.inclusions.join('\n') : null;
  const exclusionsStr = Array.isArray(body.exclusions) ? body.exclusions.join('\n') : null;

  const result = await ctx.db.transaction(async tx => {
    const insertPkg = await tx.query(`
      INSERT INTO tour_packages (provider_id, destination_id, category_id, title, description, inclusions, exclusions, duration_days, price, capacity, image, status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?, 'PENDING')
    `, [
      user.user_id,
      body.destination_id,
      body.category_id,
      body.title,
      body.description || null,
      inclusionsStr,
      exclusionsStr,
      body.duration_days,
      body.price,
      body.capacity,
      body.image || null
    ]);
    const packageId = insertPkg.insertId;

    if (Array.isArray(body.itinerary) && body.itinerary.length) {
      const itVals = body.itinerary.map(i => [packageId, i.day_no, i.title, i.description]);
      await tx.query('INSERT INTO package_itinerary (package_id, day_no, title, description) VALUES ?', [itVals]);
    }
    if (Array.isArray(body.availability) && body.availability.length) {
      const avVals = body.availability.map(a => [packageId, a.available_date, a.seats_available, 'OPEN']);
      await tx.query('INSERT INTO package_availability (package_id, available_date, seats_available, status) VALUES ?', [avVals]);
    }
    return { package_id: packageId };
  });

  await logAction(ctx, 'PACKAGE_CREATED', `Package ${result.package_id} created by provider ${user.user_id}`);
  ctx.res.statusCode = 201;
  return { data: result };
}

/** PROVIDER: PUT /api/provider/packages/:id */
async function updateProviderPackage(ctx) {
  const user = ctx.user;
  if (!user || user.role !== 'PROVIDER') throw new HttpError(401, 'UNAUTHENTICATED');
  const id = Number(ctx.params.id);
  if (!id) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid package id');

  const body = validate(ctx.body || {}, {
    title: { type: 'string', max: 200 },
    description: { type: 'string' },
    destination_id: { type: 'int' },
    category_id: { type: 'int' },
    inclusions: { type: 'array' },
    exclusions: { type: 'array' },
    duration_days: { type: 'int', min: 1 },
    price: { type: 'number', min: 0 },
    capacity: { type: 'int', min: 1 },
    image: { type: 'string' },
    itinerary: { type: 'array' }
  });

  const [ownerRows] = await ctx.db.query('SELECT provider_id FROM tour_packages WHERE package_id = ?', [id]);
  if (!ownerRows.length) throw new HttpError(404, 'NOT_FOUND', 'Package not found');
  if (ownerRows[0].provider_id !== user.user_id) throw new HttpError(403, 'FORBIDDEN', 'Not owner');

  const sets = [];
  const params = [];
  if (body.title !== undefined) { sets.push('title = ?'); params.push(body.title); }
  if (body.description !== undefined) { sets.push('description = ?'); params.push(body.description); }
  if (body.destination_id !== undefined) { sets.push('destination_id = ?'); params.push(body.destination_id); }
  if (body.category_id !== undefined) { sets.push('category_id = ?'); params.push(body.category_id); }
  if (body.duration_days !== undefined) { sets.push('duration_days = ?'); params.push(body.duration_days); }
  if (body.price !== undefined) { sets.push('price = ?'); params.push(body.price); }
  if (body.capacity !== undefined) { sets.push('capacity = ?'); params.push(body.capacity); }
  if (body.image !== undefined) { sets.push('image = ?'); params.push(body.image); }
  if (body.inclusions !== undefined) { sets.push('inclusions = ?'); params.push(Array.isArray(body.inclusions) ? body.inclusions.join('\n') : null); }
  if (body.exclusions !== undefined) { sets.push('exclusions = ?'); params.push(Array.isArray(body.exclusions) ? body.exclusions.join('\n') : null); }

  if (sets.length) {
    await ctx.db.query(`UPDATE tour_packages SET ${sets.join(', ')} WHERE package_id = ?`, [...params, id]);
  }

  if (Array.isArray(body.itinerary)) {
    await ctx.db.transaction(async tx => {
      await tx.query('DELETE FROM package_itinerary WHERE package_id = ?', [id]);
      if (body.itinerary.length) {
        const itVals = body.itinerary.map(i => [id, i.day_no, i.title, i.description]);
        await tx.query('INSERT INTO package_itinerary (package_id, day_no, title, description) VALUES ?', [itVals]);
      }
    });
  }

  await logAction(ctx, 'PACKAGE_UPDATED', `Package ${id} updated by provider ${user.user_id}`);
  return { data: { package_id: id } };
}

/** PROVIDER: PATCH /api/provider/packages/:id/status */
async function patchProviderPackageStatus(ctx) {
  const user = ctx.user;
  if (!user || user.role !== 'PROVIDER') throw new HttpError(401, 'UNAUTHENTICATED');
  const id = Number(ctx.params.id);
  if (!id) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid package id');
  const body = validate(ctx.body || {}, { status: { required: true, type: 'enum', values: ['APPROVED', 'DISABLED'] } });

  const [ownerRows] = await ctx.db.query('SELECT provider_id FROM tour_packages WHERE package_id = ?', [id]);
  if (!ownerRows.length) throw new HttpError(404, 'NOT_FOUND', 'Package not found');
  if (ownerRows[0].provider_id !== user.user_id) throw new HttpError(403, 'FORBIDDEN', 'Not owner');

  await ctx.db.query('UPDATE tour_packages SET status = ? WHERE package_id = ?', [body.status, id]);
  await logAction(ctx, 'PACKAGE_STATUS_CHANGED', `Provider ${user.user_id} set package ${id} to ${body.status}`);
  return { data: { package_id: id, status: body.status } };
}

/** PROVIDER: DELETE /api/provider/packages/:id */
async function deleteProviderPackage(ctx) {
  const user = ctx.user;
  if (!user || user.role !== 'PROVIDER') throw new HttpError(401, 'UNAUTHENTICATED');
  const id = Number(ctx.params.id);
  if (!id) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid package id');

  const [ownerRows] = await ctx.db.query('SELECT provider_id FROM tour_packages WHERE package_id = ?', [id]);
  if (!ownerRows.length) throw new HttpError(404, 'NOT_FOUND', 'Package not found');
  if (ownerRows[0].provider_id !== user.user_id) throw new HttpError(403, 'FORBIDDEN', 'Not owner');

  const [bookingRows] = await ctx.db.query('SELECT booking_id FROM bookings WHERE package_id = ? AND booking_status != "CANCELLED" LIMIT 1', [id]);
  if (bookingRows.length) throw new HttpError(409, 'CONFLICT', 'Package has active bookings');

  await ctx.db.query('DELETE FROM tour_packages WHERE package_id = ?', [id]);
  await logAction(ctx, 'PACKAGE_DELETED', `Provider ${user.user_id} deleted package ${id}`);
  return { data: { package_id: id } };
}

module.exports = [
  { method: 'GET', path: '/api/packages', handler: listPackages },
  { method: 'GET', path: '/api/packages/:id', handler: getPackageDetail },
  { method: 'GET', path: '/api/provider/packages', handler: listProviderPackages, roles: ['PROVIDER'] },
  { method: 'GET', path: '/api/provider/packages/:id', handler: getProviderPackage, roles: ['PROVIDER'] },
  { method: 'POST', path: '/api/provider/packages', handler: createProviderPackage, roles: ['PROVIDER'] },
  { method: 'PUT', path: '/api/provider/packages/:id', handler: updateProviderPackage, roles: ['PROVIDER'] },
  { method: 'PATCH', path: '/api/provider/packages/:id/status', handler: patchProviderPackageStatus, roles: ['PROVIDER'] },
  { method: 'DELETE', path: '/api/provider/packages/:id', handler: deleteProviderPackage, roles: ['PROVIDER'] }
];
