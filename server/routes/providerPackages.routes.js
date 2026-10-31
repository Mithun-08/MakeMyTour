/**
 * server/routes/providerPackages.routes.js — Owner: M2
 *
 * Provider Package Management endpoints per CONTRACT §1.6 and §1.7:
 *
 *   GET   /api/provider/packages           — own packages, any status, with booking counts & ratings
 *   GET   /api/provider/packages/:id       — full package detail incl. all availability and itinerary
 *   POST  /api/provider/packages           — create package (PENDING status, one transaction)
 *   PUT   /api/provider/packages/:id       — update package (itinerary replaced, availability untouched, status unchanged)
 *   PATCH /api/provider/packages/:id/status— toggle APPROVED and DISABLED only (cannot approve from PENDING)
 */

'use strict';

const { HttpError } = require('../utils/http');
const validate = require('../utils/validate');
const { logAction } = require('../utils/logger');

const VALID_PACKAGE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'DISABLED'];
const VALID_AVAILABILITY_STATUSES = ['OPEN', 'CLOSED', 'FULL'];

function parseId(idParam, entityName = 'Record') {
  if (idParam === undefined || idParam === null) {
    throw new HttpError(400, 'BAD_REQUEST', `Missing ${entityName} ID`);
  }
  const str = String(idParam).trim();
  if (!/^\d+$/.test(str)) {
    throw new HttpError(400, 'BAD_REQUEST', `Invalid ${entityName} ID in request parameter`);
  }
  const id = Number(str);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new HttpError(400, 'BAD_REQUEST', `Invalid ${entityName} ID in request parameter`);
  }
  return id;
}

function parsePagination(query) {
  const hasPagination = query?.page !== undefined || query?.pageSize !== undefined;
  let page = parseInt(query?.page, 10);
  if (isNaN(page) || page < 1) page = 1;

  let pageSize = parseInt(query?.pageSize, 10);
  if (isNaN(pageSize) || pageSize < 1) pageSize = 10;
  if (pageSize > 50) pageSize = 50;

  const offset = (page - 1) * pageSize;
  return { hasPagination, page, pageSize, offset };
}

function formatDate(val) {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  return String(val).slice(0, 10);
}

function parseTextList(val) {
  if (Array.isArray(val)) {
    return val.map(s => String(s).trim()).filter(Boolean).join('\n');
  }
  if (typeof val === 'string') {
    return val.trim();
  }
  return '';
}

function splitTextList(val) {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    return val.split('\n').map(s => s.trim()).filter(Boolean);
  }
  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. GET /api/provider/packages
// ─────────────────────────────────────────────────────────────────────────────

async function getProviderPackages(ctx) {
  const providerId = ctx.user.user_id;
  const whereClauses = ['p.provider_id = ?'];
  const params = [providerId];

  // Optional status filter
  if (ctx.query?.status !== undefined && ctx.query?.status !== null && ctx.query.status !== '') {
    const st = String(ctx.query.status).trim().toUpperCase();
    if (VALID_PACKAGE_STATUSES.includes(st)) {
      whereClauses.push('p.status = ?');
      params.push(st);
    }
  }

  // Optional keyword search
  const rawQ = ctx.query?.q ?? ctx.query?.search;
  if (rawQ !== undefined && rawQ !== null) {
    if (typeof rawQ !== 'string' || rawQ.length > 100) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Search parameter must be a string up to 100 characters');
    }
    const q = rawQ.trim();
    if (q) {
      whereClauses.push('(p.title LIKE ? OR p.description LIKE ? OR d.name LIKE ? OR c.category_name LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
  }

  const whereSql = whereClauses.join(' AND ');
  const { hasPagination, page, pageSize, offset } = parsePagination(ctx.query);

  let total = 0;
  if (hasPagination) {
    const countSql = `
      SELECT COUNT(*) AS total
      FROM tour_packages p
      JOIN destinations d ON d.destination_id = p.destination_id
      JOIN categories c ON c.category_id = p.category_id
      WHERE ${whereSql}
    `;
    const countRows = await ctx.db.query(countSql, params);
    total = Number(countRows[0]?.total || 0);
  }

  let dataSql = `
    SELECT
      p.package_id,
      p.provider_id,
      p.destination_id,
      d.name AS destination_name,
      d.city AS destination_city,
      d.state AS destination_state,
      p.category_id,
      c.category_name,
      p.title,
      p.description,
      p.duration_days,
      p.price,
      p.capacity,
      p.image,
      p.status,
      p.created_at,
      COALESCE(b.booking_count, 0) AS booking_count,
      r.avg_rating,
      COALESCE(r.review_count, 0) AS review_count
    FROM tour_packages p
    JOIN destinations d ON d.destination_id = p.destination_id
    JOIN categories c ON c.category_id = p.category_id
    LEFT JOIN (
      SELECT package_id, COUNT(*) AS booking_count
      FROM bookings
      GROUP BY package_id
    ) b ON b.package_id = p.package_id
    LEFT JOIN (
      SELECT
        package_id,
        ROUND(AVG(rating), 1) AS avg_rating,
        COUNT(review_id) AS review_count
      FROM reviews
      GROUP BY package_id
    ) r ON r.package_id = p.package_id
    WHERE ${whereSql}
    ORDER BY p.package_id DESC
  `;

  let rows;
  if (hasPagination) {
    dataSql += ' LIMIT ? OFFSET ?';
    rows = await ctx.db.query(dataSql, [...params, pageSize, offset]);
  } else {
    rows = await ctx.db.query(dataSql, params);
  }

  const data = (rows || []).map((r) => ({
    package_id:       Number(r.package_id),
    provider_id:      Number(r.provider_id),
    destination_id:   Number(r.destination_id),
    destination_name: r.destination_name,
    city:             r.destination_city,
    state:            r.destination_state,
    category_id:      Number(r.category_id),
    category_name:    r.category_name,
    title:            r.title,
    description:      r.description,
    duration_days:    Number(r.duration_days),
    price:            Number(r.price),
    capacity:         Number(r.capacity),
    image:            r.image || null,
    status:           r.status,
    created_at:       r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    booking_count:    Number(r.booking_count || 0),
    avg_rating:       r.avg_rating !== null && r.avg_rating !== undefined ? Number(r.avg_rating) : null,
    review_count:     Number(r.review_count || 0)
  }));

  if (hasPagination) {
    return {
      data,
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize)
      }
    };
  }

  return {
    data,
    meta: {
      total: data.length
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. GET /api/provider/packages/:id
// ─────────────────────────────────────────────────────────────────────────────

async function getProviderPackageById(ctx) {
  const packageId = parseId(ctx.params.id, 'package');
  const providerId = ctx.user.user_id;

  const pkgSql = `
    SELECT
      p.package_id,
      p.provider_id,
      p.destination_id,
      d.name AS destination_name,
      d.city AS destination_city,
      d.state AS destination_state,
      d.country AS destination_country,
      d.description AS destination_description,
      p.category_id,
      c.category_name,
      c.description AS category_description,
      p.title,
      p.description,
      p.inclusions,
      p.exclusions,
      p.duration_days,
      p.price,
      p.capacity,
      p.image,
      p.status,
      p.created_at
    FROM tour_packages p
    JOIN destinations d ON d.destination_id = p.destination_id
    JOIN categories c ON c.category_id = p.category_id
    WHERE p.package_id = ?
  `;

  const rows = await ctx.db.query(pkgSql, [packageId]);
  if (!rows || rows.length === 0) {
    throw new HttpError(404, 'NOT_FOUND', 'Package not found');
  }

  const pkg = rows[0];

  // Ownership verification: return 404 to avoid leaking existence of foreign packages
  if (Number(pkg.provider_id) !== Number(providerId)) {
    throw new HttpError(404, 'NOT_FOUND', 'Package not found');
  }

  // Itinerary
  const itineraryRows = await ctx.db.query(
    'SELECT day_no, title, description FROM package_itinerary WHERE package_id = ? ORDER BY day_no ASC',
    [packageId]
  );

  // All availability dates for provider owner
  const availRows = await ctx.db.query(
    'SELECT availability_id, available_date, seats_available, status FROM package_availability WHERE package_id = ? ORDER BY available_date ASC',
    [packageId]
  );

  // Ratings
  const ratingRows = await ctx.db.query(
    'SELECT ROUND(AVG(rating), 1) AS avg_rating, COUNT(review_id) AS review_count FROM reviews WHERE package_id = ?',
    [packageId]
  );
  const ratingRow = ratingRows && ratingRows.length ? ratingRows[0] : null;

  // Bookings
  const bookingRows = await ctx.db.query(
    'SELECT COUNT(*) AS booking_count FROM bookings WHERE package_id = ?',
    [packageId]
  );
  const bookingCount = Number(bookingRows[0]?.booking_count || 0);

  const data = {
    package_id:       Number(pkg.package_id),
    provider_id:      Number(pkg.provider_id),
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
    title:            pkg.title,
    description:      pkg.description,
    duration_days:    Number(pkg.duration_days),
    price:            Number(pkg.price),
    capacity:         Number(pkg.capacity),
    image:            pkg.image || null,
    status:           pkg.status,
    created_at:       pkg.created_at instanceof Date ? pkg.created_at.toISOString() : String(pkg.created_at),
    inclusions:       splitTextList(pkg.inclusions),
    exclusions:       splitTextList(pkg.exclusions),
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
      avg:   ratingRow?.avg_rating !== null && ratingRow?.avg_rating !== undefined ? Number(ratingRow.avg_rating) : null,
      count: Number(ratingRow?.review_count || 0)
    },
    booking_count: bookingCount
  };

  return { data };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. POST /api/provider/packages
// ─────────────────────────────────────────────────────────────────────────────

async function createProviderPackage(ctx) {
  const providerId = ctx.user.user_id;

  const body = validate(ctx.body, {
    title:          { required: true, type: 'string', min: 1, max: 200 },
    destination_id: { required: true, type: 'int', min: 1 },
    category_id:    { required: true, type: 'int', min: 1 },
    duration_days:  { required: true, type: 'int', min: 1 },
    price:          { required: true, type: 'number', min: 0 },
    capacity:       { required: true, type: 'int', min: 1 },
    description:    { type: 'string' },
    image:          { type: 'string', max: 255 }
  });

  // Verify destination existence and active status
  const destRows = await ctx.db.query(
    'SELECT destination_id, status FROM destinations WHERE destination_id = ?',
    [body.destination_id]
  );
  if (!destRows || destRows.length === 0) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Destination not found', {
      destination_id: 'Destination not found'
    });
  }
  if (destRows[0].status !== 'ACTIVE') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Destination is not active', {
      destination_id: 'Destination is not active'
    });
  }

  // Verify category existence and active status
  const catRows = await ctx.db.query(
    'SELECT category_id, status FROM categories WHERE category_id = ?',
    [body.category_id]
  );
  if (!catRows || catRows.length === 0) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Category not found', {
      category_id: 'Category not found'
    });
  }
  if (catRows[0].status !== 'ACTIVE') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Category is not active', {
      category_id: 'Category is not active'
    });
  }

  const inclusionsStr = parseTextList(ctx.body.inclusions);
  const exclusionsStr = parseTextList(ctx.body.exclusions);

  // Validate itinerary array if provided
  const rawItinerary = ctx.body.itinerary;
  const cleanItinerary = [];
  if (rawItinerary !== undefined && rawItinerary !== null) {
    if (!Array.isArray(rawItinerary)) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Itinerary must be an array', {
        itinerary: 'Itinerary must be an array'
      });
    }
    const seenDays = new Set();
    for (let idx = 0; idx < rawItinerary.length; idx++) {
      const item = rawItinerary[idx];
      if (!item || typeof item !== 'object') {
        throw new HttpError(400, 'VALIDATION_ERROR', `Itinerary item at index ${idx} is invalid`);
      }
      const dayNo = parseInt(item.day_no, 10);
      if (isNaN(dayNo) || dayNo <= 0) {
        throw new HttpError(400, 'VALIDATION_ERROR', `Itinerary item at index ${idx} must have positive day_no`);
      }
      if (seenDays.has(dayNo)) {
        throw new HttpError(400, 'VALIDATION_ERROR', `Duplicate day_no ${dayNo} in itinerary`);
      }
      seenDays.add(dayNo);

      const title = typeof item.title === 'string' ? item.title.trim() : '';
      if (!title || title.length > 200) {
        throw new HttpError(400, 'VALIDATION_ERROR', `Itinerary day ${dayNo} must have title up to 200 characters`);
      }

      const desc = item.description !== undefined && item.description !== null
        ? String(item.description).trim()
        : null;

      cleanItinerary.push({ day_no: dayNo, title, description: desc });
    }
  }

  // Validate availability array if provided
  const rawAvailability = ctx.body.availability;
  const cleanAvailability = [];
  if (rawAvailability !== undefined && rawAvailability !== null) {
    if (!Array.isArray(rawAvailability)) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Availability must be an array', {
        availability: 'Availability must be an array'
      });
    }
    const seenDates = new Set();
    for (let idx = 0; idx < rawAvailability.length; idx++) {
      const item = rawAvailability[idx];
      if (!item || typeof item !== 'object') {
        throw new HttpError(400, 'VALIDATION_ERROR', `Availability item at index ${idx} is invalid`);
      }
      const dateStr = String(item.available_date || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || isNaN(new Date(dateStr).getTime())) {
        throw new HttpError(400, 'VALIDATION_ERROR', `Availability date at index ${idx} must be in YYYY-MM-DD format`);
      }
      if (seenDates.has(dateStr)) {
        throw new HttpError(400, 'VALIDATION_ERROR', `Duplicate available_date ${dateStr} in availability`);
      }
      seenDates.add(dateStr);

      let seats = body.capacity;
      if (item.seats_available !== undefined && item.seats_available !== null && item.seats_available !== '') {
        const parsedSeats = parseInt(item.seats_available, 10);
        if (isNaN(parsedSeats) || parsedSeats < 0) {
          throw new HttpError(400, 'VALIDATION_ERROR', `seats_available for date ${dateStr} must be a non-negative integer`);
        }
        seats = parsedSeats;
      }

      cleanAvailability.push({ available_date: dateStr, seats_available: seats });
    }
  }

  // Transaction: Package + Itinerary + Availability
  const createdResult = await ctx.db.transaction(async (tx) => {
    const pkgRes = await tx.query(
      `INSERT INTO tour_packages
         (provider_id, destination_id, category_id, title, description,
          inclusions, exclusions, duration_days, price, capacity, image, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        providerId,
        body.destination_id,
        body.category_id,
        body.title,
        body.description || null,
        inclusionsStr || null,
        exclusionsStr || null,
        body.duration_days,
        body.price,
        body.capacity,
        body.image || null,
        'PENDING'
      ]
    );

    const packageId = Number(pkgRes.insertId);

    // Itinerary rows
    for (const item of cleanItinerary) {
      await tx.query(
        'INSERT INTO package_itinerary (package_id, day_no, title, description) VALUES (?, ?, ?, ?)',
        [packageId, item.day_no, item.title, item.description]
      );
    }

    // Availability rows
    for (const item of cleanAvailability) {
      await tx.query(
        'INSERT INTO package_availability (package_id, available_date, seats_available, status) VALUES (?, ?, ?, ?)',
        [packageId, item.available_date, item.seats_available, 'OPEN']
      );
    }

    return {
      package_id:     packageId,
      provider_id:    providerId,
      destination_id: body.destination_id,
      category_id:    body.category_id,
      title:          body.title,
      description:    body.description || null,
      duration_days:  body.duration_days,
      price:          body.price,
      capacity:       body.capacity,
      image:          body.image || null,
      status:         'PENDING',
      inclusions:     splitTextList(inclusionsStr),
      exclusions:     splitTextList(exclusionsStr),
      itinerary:      cleanItinerary,
      availability:   cleanAvailability.map(a => ({ ...a, status: 'OPEN' }))
    };
  });

  await logAction(
    ctx,
    'PACKAGE_CREATED',
    `Provider ${providerId} created package '${body.title}' as PENDING (ID ${createdResult.package_id})`
  );

  return {
    status: 201,
    data: createdResult,
    message: 'Package created successfully as PENDING moderation'
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. PUT /api/provider/packages/:id
// ─────────────────────────────────────────────────────────────────────────────

async function updateProviderPackage(ctx) {
  const packageId = parseId(ctx.params.id, 'package');
  const providerId = ctx.user.user_id;

  const existingRows = await ctx.db.query(
    'SELECT * FROM tour_packages WHERE package_id = ?',
    [packageId]
  );

  if (!existingRows || existingRows.length === 0) {
    throw new HttpError(404, 'NOT_FOUND', 'Package not found');
  }

  const existing = existingRows[0];

  // Ownership verification
  if (Number(existing.provider_id) !== Number(providerId)) {
    throw new HttpError(404, 'NOT_FOUND', 'Package not found');
  }

  const body = validate(ctx.body, {
    title:          { type: 'string', min: 1, max: 200 },
    destination_id: { type: 'int', min: 1 },
    category_id:    { type: 'int', min: 1 },
    duration_days:  { type: 'int', min: 1 },
    price:          { type: 'number', min: 0 },
    capacity:       { type: 'int', min: 1 },
    description:    { type: 'string' },
    image:          { type: 'string', max: 255 }
  });

  const updatedDestId = body.destination_id !== undefined ? body.destination_id : existing.destination_id;
  const updatedCatId  = body.category_id !== undefined ? body.category_id : existing.category_id;
  const updatedTitle  = body.title !== undefined ? body.title : existing.title;
  const updatedDesc   = body.description !== undefined ? body.description : existing.description;
  const updatedDays   = body.duration_days !== undefined ? body.duration_days : existing.duration_days;
  const updatedPrice  = body.price !== undefined ? body.price : existing.price;
  const updatedCap    = body.capacity !== undefined ? body.capacity : existing.capacity;
  const updatedImage  = body.image !== undefined ? body.image : existing.image;

  // Validate destination if changed
  if (body.destination_id !== undefined) {
    const destRows = await ctx.db.query(
      'SELECT destination_id, status FROM destinations WHERE destination_id = ?',
      [updatedDestId]
    );
    if (!destRows || destRows.length === 0) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Destination not found', { destination_id: 'Destination not found' });
    }
    if (destRows[0].status !== 'ACTIVE') {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Destination is not active', { destination_id: 'Destination is not active' });
    }
  }

  // Validate category if changed
  if (body.category_id !== undefined) {
    const catRows = await ctx.db.query(
      'SELECT category_id, status FROM categories WHERE category_id = ?',
      [updatedCatId]
    );
    if (!catRows || catRows.length === 0) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Category not found', { category_id: 'Category not found' });
    }
    if (catRows[0].status !== 'ACTIVE') {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Category is not active', { category_id: 'Category is not active' });
    }
  }

  const inclusionsStr = ctx.body.inclusions !== undefined ? parseTextList(ctx.body.inclusions) : existing.inclusions;
  const exclusionsStr = ctx.body.exclusions !== undefined ? parseTextList(ctx.body.exclusions) : existing.exclusions;

  // Validate itinerary array if provided in update
  const rawItinerary = ctx.body.itinerary;
  let cleanItinerary = null;
  if (rawItinerary !== undefined && rawItinerary !== null) {
    if (!Array.isArray(rawItinerary)) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Itinerary must be an array');
    }
    cleanItinerary = [];
    const seenDays = new Set();
    for (let idx = 0; idx < rawItinerary.length; idx++) {
      const item = rawItinerary[idx];
      if (!item || typeof item !== 'object') {
        throw new HttpError(400, 'VALIDATION_ERROR', `Itinerary item at index ${idx} is invalid`);
      }
      const dayNo = parseInt(item.day_no, 10);
      if (isNaN(dayNo) || dayNo <= 0) {
        throw new HttpError(400, 'VALIDATION_ERROR', `Itinerary item at index ${idx} must have positive day_no`);
      }
      if (seenDays.has(dayNo)) {
        throw new HttpError(400, 'VALIDATION_ERROR', `Duplicate day_no ${dayNo} in itinerary`);
      }
      seenDays.add(dayNo);

      const title = typeof item.title === 'string' ? item.title.trim() : '';
      if (!title || title.length > 200) {
        throw new HttpError(400, 'VALIDATION_ERROR', `Itinerary day ${dayNo} must have title up to 200 characters`);
      }

      const desc = item.description !== undefined && item.description !== null
        ? String(item.description).trim()
        : null;

      cleanItinerary.push({ day_no: dayNo, title, description: desc });
    }
  }

  // Transaction: Update package fields (status unchanged per contract) + replace itinerary if provided
  await ctx.db.transaction(async (tx) => {
    await tx.query(
      `UPDATE tour_packages
       SET destination_id = ?, category_id = ?, title = ?, description = ?,
           inclusions = ?, exclusions = ?, duration_days = ?, price = ?,
           capacity = ?, image = ?
       WHERE package_id = ? AND provider_id = ?`,
      [
        updatedDestId,
        updatedCatId,
        updatedTitle,
        updatedDesc,
        inclusionsStr,
        exclusionsStr,
        updatedDays,
        updatedPrice,
        updatedCap,
        updatedImage,
        packageId,
        providerId
      ]
    );

    if (cleanItinerary !== null) {
      await tx.query('DELETE FROM package_itinerary WHERE package_id = ?', [packageId]);
      for (const item of cleanItinerary) {
        await tx.query(
          'INSERT INTO package_itinerary (package_id, day_no, title, description) VALUES (?, ?, ?, ?)',
          [packageId, item.day_no, item.title, item.description]
        );
      }
    }
  });

  await logAction(
    ctx,
    'PACKAGE_UPDATED',
    `Provider ${providerId} updated package ${packageId} ('${updatedTitle}')`
  );

  return {
    data: {
      package_id:     packageId,
      provider_id:    providerId,
      destination_id: Number(updatedDestId),
      category_id:    Number(updatedCatId),
      title:          updatedTitle,
      description:    updatedDesc,
      duration_days:  Number(updatedDays),
      price:          Number(updatedPrice),
      capacity:       Number(updatedCap),
      image:          updatedImage,
      status:         existing.status, // Protected field: unchanged
      inclusions:     splitTextList(inclusionsStr),
      exclusions:     splitTextList(exclusionsStr)
    },
    message: 'Package updated successfully'
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. PATCH /api/provider/packages/:id/status
// ─────────────────────────────────────────────────────────────────────────────

async function updateProviderPackageStatus(ctx) {
  const packageId = parseId(ctx.params.id, 'package');
  const providerId = ctx.user.user_id;

  const existingRows = await ctx.db.query(
    'SELECT package_id, provider_id, status, title FROM tour_packages WHERE package_id = ?',
    [packageId]
  );

  if (!existingRows || existingRows.length === 0) {
    throw new HttpError(404, 'NOT_FOUND', 'Package not found');
  }

  const pkg = existingRows[0];

  // Ownership check
  if (Number(pkg.provider_id) !== Number(providerId)) {
    throw new HttpError(404, 'NOT_FOUND', 'Package not found');
  }

  const body = validate(ctx.body, {
    status: {
      required: true,
      type: 'enum',
      values: ['APPROVED', 'DISABLED']
    }
  });

  const currentStatus = pkg.status;
  const targetStatus  = body.status;

  // Status transition restrictions per CONTRACT §1.7:
  // "toggle APPROVED and DISABLED only"
  if (currentStatus === 'PENDING') {
    throw new HttpError(
      409,
      'CONFLICT',
      'Cannot change status of a package awaiting admin moderation. Providers cannot approve their own packages.'
    );
  }

  if (currentStatus === 'REJECTED') {
    throw new HttpError(
      409,
      'CONFLICT',
      'Cannot change status of a rejected package. Only an administrator can re-evaluate rejected packages.'
    );
  }

  if (targetStatus === currentStatus) {
    throw new HttpError(
      409,
      'CONFLICT',
      `Package is already in ${targetStatus} status.`
    );
  }

  // Allowed transitions: APPROVED -> DISABLED, and DISABLED -> APPROVED
  await ctx.db.query(
    'UPDATE tour_packages SET status = ? WHERE package_id = ? AND provider_id = ?',
    [targetStatus, packageId, providerId]
  );

  await logAction(
    ctx,
    'PACKAGE_MODERATED',
    `Provider ${providerId} toggled package ${packageId} status from ${currentStatus} to ${targetStatus}`
  );

  return {
    data: {
      package_id: packageId,
      status:     targetStatus
    },
    message: `Package status updated to ${targetStatus}`
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE REGISTRATION TABLE
// ─────────────────────────────────────────────────────────────────────────────

module.exports = [
  {
    method:  'GET',
    path:    '/api/provider/packages',
    roles:   ['PROVIDER'],
    handler: getProviderPackages
  },
  {
    method:  'GET',
    path:    '/api/provider/packages/:id',
    roles:   ['PROVIDER'],
    handler: getProviderPackageById
  },
  {
    method:  'POST',
    path:    '/api/provider/packages',
    roles:   ['PROVIDER'],
    handler: createProviderPackage
  },
  {
    method:  'PUT',
    path:    '/api/provider/packages/:id',
    roles:   ['PROVIDER'],
    handler: updateProviderPackage
  },
  {
    method:  'PATCH',
    path:    '/api/provider/packages/:id/status',
    roles:   ['PROVIDER'],
    handler: updateProviderPackageStatus
  }
];
