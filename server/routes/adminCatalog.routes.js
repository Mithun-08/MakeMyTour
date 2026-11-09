/**
 * server/routes/adminCatalog.routes.js — Owner: M2
 *
 * Admin Catalog Management APIs per CONTRACT §1.6 and §1.7:
 *
 * Destinations (ADMIN + MANAGE_DESTINATIONS, or SUPER_ADMIN):
 *   GET    /api/admin/destinations      — list all, including INACTIVE, with package_count & search/pagination
 *   POST   /api/admin/destinations      — create destination (name, city, state, country, description, status)
 *   PUT    /api/admin/destinations/:id  — update destination details
 *   DELETE /api/admin/destinations/:id  — delete destination (409 if referenced by tour_packages)
 *
 * Categories (ADMIN + MANAGE_CATEGORIES, or SUPER_ADMIN):
 *   GET    /api/admin/categories        — list all, including INACTIVE, with package_count & search/pagination
 *   POST   /api/admin/categories        — create category (category_name, description, status)
 *   PUT    /api/admin/categories/:id    — update category details
 *   DELETE /api/admin/categories/:id    — delete category (409 if referenced by tour_packages)
 */

'use strict';

const { HttpError } = require('../utils/http');
const validate = require('../utils/validate');
const { logAction } = require('../utils/logger');

const VALID_STATUSES = ['ACTIVE', 'INACTIVE'];

/**
 * Validates integer ID parameter.
 */
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

/**
 * Parses pagination query parameters.
 */
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

// ─────────────────────────────────────────────────────────────────────────────
// DESTINATIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/destinations
 * Returns all destinations (including INACTIVE) with package_count.
 * Supports q/search, status, and pagination query parameters.
 */
async function getAdminDestinations(ctx) {
  const whereClauses = [];
  const params = [];

  const rawQ = ctx.query?.q ?? ctx.query?.search;
  if (rawQ !== undefined && rawQ !== null) {
    if (typeof rawQ !== 'string' || rawQ.length > 100) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Search parameter must be a string up to 100 characters');
    }
    const q = rawQ.trim();
    if (q) {
      whereClauses.push('(d.name LIKE ? OR d.city LIKE ? OR d.state LIKE ? OR d.country LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
  }

  if (ctx.query?.status !== undefined && ctx.query?.status !== null) {
    const statusVal = String(ctx.query.status).trim().toUpperCase();
    if (VALID_STATUSES.includes(statusVal)) {
      whereClauses.push('d.status = ?');
      params.push(statusVal);
    }
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const { hasPagination, page, pageSize, offset } = parsePagination(ctx.query);

  let total = 0;
  if (hasPagination) {
    const countSql = `SELECT COUNT(*) AS total FROM destinations d ${whereSql}`;
    const countRows = await ctx.db.query(countSql, params);
    total = Number(countRows[0]?.total || 0);
  }

  let dataSql = `
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
    LEFT JOIN tour_packages p ON p.destination_id = d.destination_id
    ${whereSql}
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

  let rows;
  if (hasPagination) {
    dataSql += ' LIMIT ? OFFSET ?';
    rows = await ctx.db.query(dataSql, [...params, pageSize, offset]);
  } else {
    rows = await ctx.db.query(dataSql, params);
  }

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

/**
 * POST /api/admin/destinations
 * Creates a new destination.
 */
async function createAdminDestination(ctx) {
  const body = validate(ctx.body, {
    name: {
      required: true,
      type: 'string',
      min: 1,
      max: 120
    },
    city: {
      required: true,
      type: 'string',
      min: 1,
      max: 100
    },
    state: {
      required: true,
      type: 'string',
      min: 1,
      max: 100
    },
    country: {
      type: 'string',
      min: 1,
      max: 100
    },
    description: {
      type: 'string'
    },
    status: {
      type: 'enum',
      values: VALID_STATUSES
    }
  });

  const country = body.country || 'India';
  const description = body.description || null;
  const status = body.status || 'ACTIVE';

  // Check duplicate (name, city)
  const existing = await ctx.db.query(
    'SELECT destination_id FROM destinations WHERE LOWER(name) = LOWER(?) AND LOWER(city) = LOWER(?)',
    [body.name, body.city]
  );

  if (existing && existing.length > 0) {
    throw new HttpError(409, 'CONFLICT', 'A destination with this name and city already exists');
  }

  let result;
  try {
    result = await ctx.db.query(
      `INSERT INTO destinations (name, city, state, country, description, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [body.name, body.city, body.state, country, description, status]
    );
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY' || err.errno === 1062) {
      throw new HttpError(409, 'CONFLICT', 'A destination with this name and city already exists');
    }
    throw err;
  }

  const destinationId = Number(result.insertId);

  await logAction(
    ctx,
    'DESTINATION_CREATED',
    `Destination '${body.name}' (${body.city}, ${body.state}) created with ID ${destinationId}`
  );

  return {
    status: 201,
    data: {
      destination_id: destinationId,
      name: body.name,
      city: body.city,
      state: body.state,
      country,
      description,
      status
    },
    message: 'Destination created successfully'
  };
}

/**
 * PUT /api/admin/destinations/:id
 * Updates destination details.
 */
async function updateAdminDestination(ctx) {
  const id = parseId(ctx.params.id, 'destination');

  const existingRows = await ctx.db.query(
    'SELECT * FROM destinations WHERE destination_id = ?',
    [id]
  );

  if (!existingRows || existingRows.length === 0) {
    throw new HttpError(404, 'NOT_FOUND', 'Destination not found');
  }

  const existing = existingRows[0];

  const body = validate(ctx.body, {
    name: {
      type: 'string',
      min: 1,
      max: 120
    },
    city: {
      type: 'string',
      min: 1,
      max: 100
    },
    state: {
      type: 'string',
      min: 1,
      max: 100
    },
    country: {
      type: 'string',
      min: 1,
      max: 100
    },
    description: {
      type: 'string'
    },
    status: {
      type: 'enum',
      values: VALID_STATUSES
    }
  });

  const updatedName = body.name !== undefined ? body.name : existing.name;
  const updatedCity = body.city !== undefined ? body.city : existing.city;
  const updatedState = body.state !== undefined ? body.state : existing.state;
  const updatedCountry = body.country !== undefined ? body.country : existing.country;
  const updatedDesc = body.description !== undefined ? body.description : existing.description;
  const updatedStatus = body.status !== undefined ? body.status : existing.status;

  // If name or city changed, check uniqueness
  if (body.name !== undefined || body.city !== undefined) {
    const dupCheck = await ctx.db.query(
      'SELECT destination_id FROM destinations WHERE LOWER(name) = LOWER(?) AND LOWER(city) = LOWER(?) AND destination_id != ?',
      [updatedName, updatedCity, id]
    );

    if (dupCheck && dupCheck.length > 0) {
      throw new HttpError(409, 'CONFLICT', 'A destination with this name and city already exists');
    }
  }

  try {
    await ctx.db.query(
      `UPDATE destinations
       SET name = ?, city = ?, state = ?, country = ?, description = ?, status = ?
       WHERE destination_id = ?`,
      [updatedName, updatedCity, updatedState, updatedCountry, updatedDesc, updatedStatus, id]
    );
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY' || err.errno === 1062) {
      throw new HttpError(409, 'CONFLICT', 'A destination with this name and city already exists');
    }
    throw err;
  }

  await logAction(
    ctx,
    'DESTINATION_UPDATED',
    `Destination ${id} ('${updatedName}') updated`
  );

  return {
    data: {
      destination_id: id,
      name: updatedName,
      city: updatedCity,
      state: updatedState,
      country: updatedCountry,
      description: updatedDesc,
      status: updatedStatus
    },
    message: 'Destination updated successfully'
  };
}

/**
 * DELETE /api/admin/destinations/:id
 * Deletes destination. Fails with 409 if referenced by tour_packages.
 */
async function deleteAdminDestination(ctx) {
  const id = parseId(ctx.params.id, 'destination');

  const existingRows = await ctx.db.query(
    'SELECT destination_id, name FROM destinations WHERE destination_id = ?',
    [id]
  );

  if (!existingRows || existingRows.length === 0) {
    throw new HttpError(404, 'NOT_FOUND', 'Destination not found');
  }

  const destName = existingRows[0].name;

  // Check referencing tour packages
  const pkgCountRows = await ctx.db.query(
    'SELECT COUNT(*) AS count FROM tour_packages WHERE destination_id = ?',
    [id]
  );

  const pkgCount = Number(pkgCountRows[0]?.count || 0);
  if (pkgCount > 0) {
    throw new HttpError(
      409,
      'CONFLICT',
      `Cannot delete destination '${destName}' because it is referenced by ${pkgCount} tour package(s). Set status to INACTIVE instead.`
    );
  }

  await ctx.db.query('DELETE FROM destinations WHERE destination_id = ?', [id]);

  await logAction(
    ctx,
    'DESTINATION_DELETED',
    `Destination ${id} ('${destName}') deleted`
  );

  return {
    data: {
      destination_id: id
    },
    message: 'Destination deleted successfully'
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/categories
 * Returns all categories (including INACTIVE) with package_count.
 * Supports q/search, status, and pagination query parameters.
 */
async function getAdminCategories(ctx) {
  const whereClauses = [];
  const params = [];

  const rawQ = ctx.query?.q ?? ctx.query?.search;
  if (rawQ !== undefined && rawQ !== null) {
    if (typeof rawQ !== 'string' || rawQ.length > 100) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Search parameter must be a string up to 100 characters');
    }
    const q = rawQ.trim();
    if (q) {
      whereClauses.push('(c.category_name LIKE ? OR c.description LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }
  }

  if (ctx.query?.status !== undefined && ctx.query?.status !== null) {
    const statusVal = String(ctx.query.status).trim().toUpperCase();
    if (VALID_STATUSES.includes(statusVal)) {
      whereClauses.push('c.status = ?');
      params.push(statusVal);
    }
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const { hasPagination, page, pageSize, offset } = parsePagination(ctx.query);

  let total = 0;
  if (hasPagination) {
    const countSql = `SELECT COUNT(*) AS total FROM categories c ${whereSql}`;
    const countRows = await ctx.db.query(countSql, params);
    total = Number(countRows[0]?.total || 0);
  }

  let dataSql = `
    SELECT
      c.category_id,
      c.category_name,
      c.description,
      c.status,
      COUNT(p.package_id) AS package_count
    FROM categories c
    LEFT JOIN tour_packages p ON p.category_id = c.category_id
    ${whereSql}
    GROUP BY
      c.category_id,
      c.category_name,
      c.description,
      c.status
    ORDER BY c.category_id ASC
  `;

  let rows;
  if (hasPagination) {
    dataSql += ' LIMIT ? OFFSET ?';
    rows = await ctx.db.query(dataSql, [...params, pageSize, offset]);
  } else {
    rows = await ctx.db.query(dataSql, params);
  }

  const data = (rows || []).map((r) => ({
    category_id:   Number(r.category_id),
    category_name: r.category_name,
    description:   r.description,
    status:        r.status,
    package_count: Number(r.package_count || 0)
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

/**
 * POST /api/admin/categories
 * Creates a new category.
 */
async function createAdminCategory(ctx) {
  const body = validate(ctx.body, {
    category_name: {
      required: true,
      type: 'string',
      min: 1,
      max: 80
    },
    description: {
      type: 'string'
    },
    status: {
      type: 'enum',
      values: VALID_STATUSES
    }
  });

  const description = body.description || null;
  const status = body.status || 'ACTIVE';

  // Check duplicate category_name
  const existing = await ctx.db.query(
    'SELECT category_id FROM categories WHERE LOWER(category_name) = LOWER(?)',
    [body.category_name]
  );

  if (existing && existing.length > 0) {
    throw new HttpError(409, 'CONFLICT', 'A category with this name already exists');
  }

  let result;
  try {
    result = await ctx.db.query(
      `INSERT INTO categories (category_name, description, status)
       VALUES (?, ?, ?)`,
      [body.category_name, description, status]
    );
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY' || err.errno === 1062) {
      throw new HttpError(409, 'CONFLICT', 'A category with this name already exists');
    }
    throw err;
  }

  const categoryId = Number(result.insertId);

  await logAction(
    ctx,
    'CATEGORY_CREATED',
    `Category '${body.category_name}' created with ID ${categoryId}`
  );

  return {
    status: 201,
    data: {
      category_id: categoryId,
      category_name: body.category_name,
      description,
      status
    },
    message: 'Category created successfully'
  };
}

/**
 * PUT /api/admin/categories/:id
 * Updates category details.
 */
async function updateAdminCategory(ctx) {
  const id = parseId(ctx.params.id, 'category');

  const existingRows = await ctx.db.query(
    'SELECT * FROM categories WHERE category_id = ?',
    [id]
  );

  if (!existingRows || existingRows.length === 0) {
    throw new HttpError(404, 'NOT_FOUND', 'Category not found');
  }

  const existing = existingRows[0];

  const body = validate(ctx.body, {
    category_name: {
      type: 'string',
      min: 1,
      max: 80
    },
    description: {
      type: 'string'
    },
    status: {
      type: 'enum',
      values: VALID_STATUSES
    }
  });

  const updatedName = body.category_name !== undefined ? body.category_name : existing.category_name;
  const updatedDesc = body.description !== undefined ? body.description : existing.description;
  const updatedStatus = body.status !== undefined ? body.status : existing.status;

  // If category_name changed, check uniqueness
  if (body.category_name !== undefined) {
    const dupCheck = await ctx.db.query(
      'SELECT category_id FROM categories WHERE LOWER(category_name) = LOWER(?) AND category_id != ?',
      [updatedName, id]
    );

    if (dupCheck && dupCheck.length > 0) {
      throw new HttpError(409, 'CONFLICT', 'A category with this name already exists');
    }
  }

  try {
    await ctx.db.query(
      `UPDATE categories
       SET category_name = ?, description = ?, status = ?
       WHERE category_id = ?`,
      [updatedName, updatedDesc, updatedStatus, id]
    );
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY' || err.errno === 1062) {
      throw new HttpError(409, 'CONFLICT', 'A category with this name already exists');
    }
    throw err;
  }

  await logAction(
    ctx,
    'CATEGORY_UPDATED',
    `Category ${id} ('${updatedName}') updated`
  );

  return {
    data: {
      category_id: id,
      category_name: updatedName,
      description: updatedDesc,
      status: updatedStatus
    },
    message: 'Category updated successfully'
  };
}

/**
 * DELETE /api/admin/categories/:id
 * Deletes category. Fails with 409 if referenced by tour_packages.
 */
async function deleteAdminCategory(ctx) {
  const id = parseId(ctx.params.id, 'category');

  const existingRows = await ctx.db.query(
    'SELECT category_id, category_name FROM categories WHERE category_id = ?',
    [id]
  );

  if (!existingRows || existingRows.length === 0) {
    throw new HttpError(404, 'NOT_FOUND', 'Category not found');
  }

  const categoryName = existingRows[0].category_name;

  // Check referencing tour packages
  const pkgCountRows = await ctx.db.query(
    'SELECT COUNT(*) AS count FROM tour_packages WHERE category_id = ?',
    [id]
  );

  const pkgCount = Number(pkgCountRows[0]?.count || 0);
  if (pkgCount > 0) {
    throw new HttpError(
      409,
      'CONFLICT',
      `Cannot delete category '${categoryName}' because it is referenced by ${pkgCount} tour package(s). Set status to INACTIVE instead.`
    );
  }

  await ctx.db.query('DELETE FROM categories WHERE category_id = ?', [id]);

  await logAction(
    ctx,
    'CATEGORY_DELETED',
    `Category ${id} ('${categoryName}') deleted`
  );

  return {
    data: {
      category_id: id
    },
    message: 'Category deleted successfully'
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE REGISTRATION TABLE
// ─────────────────────────────────────────────────────────────────────────────

module.exports = [
  // Destinations
  {
    method:     'GET',
    path:       '/api/admin/destinations',
    roles:      ['ADMIN'],
    permission: 'MANAGE_DESTINATIONS',
    handler:    getAdminDestinations
  },
  {
    method:     'POST',
    path:       '/api/admin/destinations',
    roles:      ['ADMIN'],
    permission: 'MANAGE_DESTINATIONS',
    handler:    createAdminDestination
  },
  {
    method:     'PUT',
    path:       '/api/admin/destinations/:id',
    roles:      ['ADMIN'],
    permission: 'MANAGE_DESTINATIONS',
    handler:    updateAdminDestination
  },
  {
    method:     'DELETE',
    path:       '/api/admin/destinations/:id',
    roles:      ['ADMIN'],
    permission: 'MANAGE_DESTINATIONS',
    handler:    deleteAdminDestination
  },

  // Categories
  {
    method:     'GET',
    path:       '/api/admin/categories',
    roles:      ['ADMIN'],
    permission: 'MANAGE_CATEGORIES',
    handler:    getAdminCategories
  },
  {
    method:     'POST',
    path:       '/api/admin/categories',
    roles:      ['ADMIN'],
    permission: 'MANAGE_CATEGORIES',
    handler:    createAdminCategory
  },
  {
    method:     'PUT',
    path:       '/api/admin/categories/:id',
    roles:      ['ADMIN'],
    permission: 'MANAGE_CATEGORIES',
    handler:    updateAdminCategory
  },
  {
    method:     'DELETE',
    path:       '/api/admin/categories/:id',
    roles:      ['ADMIN'],
    permission: 'MANAGE_CATEGORIES',
    handler:    deleteAdminCategory
  }
];
