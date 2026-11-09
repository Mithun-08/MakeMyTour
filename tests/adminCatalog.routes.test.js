/**
 * tests/adminCatalog.routes.test.js
 * Focused tests for Admin Catalog Management APIs:
 *   - Destination CRUD & permissions (MANAGE_DESTINATIONS)
 *   - Category CRUD & permissions (MANAGE_CATEGORIES)
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const routes = require('../server/routes/adminCatalog.routes');
const { HttpError } = require('../server/utils/http');

const getDestRoute = routes.find(r => r.method === 'GET' && r.path === '/api/admin/destinations');
const postDestRoute = routes.find(r => r.method === 'POST' && r.path === '/api/admin/destinations');
const putDestRoute = routes.find(r => r.method === 'PUT' && r.path === '/api/admin/destinations/:id');
const delDestRoute = routes.find(r => r.method === 'DELETE' && r.path === '/api/admin/destinations/:id');

const getCatRoute = routes.find(r => r.method === 'GET' && r.path === '/api/admin/categories');
const postCatRoute = routes.find(r => r.method === 'POST' && r.path === '/api/admin/categories');
const putCatRoute = routes.find(r => r.method === 'PUT' && r.path === '/api/admin/categories/:id');
const delCatRoute = routes.find(r => r.method === 'DELETE' && r.path === '/api/admin/categories/:id');

describe('Admin Catalog Routes — Registration & RBAC Definitions', () => {
  it('exports an array of 8 admin routes', () => {
    assert.ok(Array.isArray(routes));
    assert.equal(routes.length, 8);
  });

  it('destination endpoints require ADMIN role and MANAGE_DESTINATIONS permission', () => {
    const destRoutes = [getDestRoute, postDestRoute, putDestRoute, delDestRoute];
    for (const r of destRoutes) {
      assert.ok(r, `Route must exist`);
      assert.deepEqual(r.roles, ['ADMIN']);
      assert.equal(r.permission, 'MANAGE_DESTINATIONS');
      assert.equal(typeof r.handler, 'function');
    }
  });

  it('category endpoints require ADMIN role and MANAGE_CATEGORIES permission', () => {
    const catRoutes = [getCatRoute, postCatRoute, putCatRoute, delCatRoute];
    for (const r of catRoutes) {
      assert.ok(r, `Route must exist`);
      assert.deepEqual(r.roles, ['ADMIN']);
      assert.equal(r.permission, 'MANAGE_CATEGORIES');
      assert.equal(typeof r.handler, 'function');
    }
  });
});

describe('Admin Catalog — RBAC Enforcement Simulation', () => {
  function simulateRbac(route, user) {
    if (route.roles) {
      if (!user) {
        throw new HttpError(401, 'UNAUTHENTICATED', 'Authentication required');
      }
      const effectiveRole = user.role === 'SUPER_ADMIN' ? 'ADMIN' : user.role;
      if (!route.roles.includes(user.role) && !route.roles.includes(effectiveRole)) {
        throw new HttpError(403, 'FORBIDDEN', 'Insufficient role');
      }
    }
    if (route.permission && user) {
      if (user.role !== 'SUPER_ADMIN') {
        const perms = Array.isArray(user.permissions) ? user.permissions : [];
        if (!perms.includes(route.permission)) {
          throw new HttpError(403, 'FORBIDDEN', `Permission required: ${route.permission}`);
        }
      }
    }
    return true;
  }

  it('rejects unauthenticated request with 401 UNAUTHENTICATED', () => {
    assert.throws(() => simulateRbac(getDestRoute, null), (err) => {
      return err.status === 401 && err.code === 'UNAUTHENTICATED';
    });
    assert.throws(() => simulateRbac(getCatRoute, null), (err) => {
      return err.status === 401 && err.code === 'UNAUTHENTICATED';
    });
  });

  it('rejects non-ADMIN roles (CUSTOMER, PROVIDER) with 403 FORBIDDEN', () => {
    const customer = { user_id: 7, role: 'CUSTOMER', permissions: [] };
    const provider = { user_id: 4, role: 'PROVIDER', permissions: [] };

    assert.throws(() => simulateRbac(getDestRoute, customer), (err) => err.status === 403);
    assert.throws(() => simulateRbac(postCatRoute, provider), (err) => err.status === 403);
  });

  it('rejects ADMIN without MANAGE_DESTINATIONS permission with 403 FORBIDDEN', () => {
    const adminWithoutPerm = {
      user_id: 3,
      role: 'ADMIN',
      permissions: ['MANAGE_USERS', 'MANAGE_CATEGORIES']
    };

    assert.throws(() => simulateRbac(getDestRoute, adminWithoutPerm), (err) => {
      return err.status === 403 && err.message.includes('MANAGE_DESTINATIONS');
    });
  });

  it('rejects ADMIN without MANAGE_CATEGORIES permission with 403 FORBIDDEN', () => {
    const adminWithoutPerm = {
      user_id: 3,
      role: 'ADMIN',
      permissions: ['MANAGE_DESTINATIONS']
    };

    assert.throws(() => simulateRbac(getCatRoute, adminWithoutPerm), (err) => {
      return err.status === 403 && err.message.includes('MANAGE_CATEGORIES');
    });
  });

  it('allows ADMIN with proper permission to access endpoints', () => {
    const destAdmin = { user_id: 2, role: 'ADMIN', permissions: ['MANAGE_DESTINATIONS'] };
    const catAdmin = { user_id: 2, role: 'ADMIN', permissions: ['MANAGE_CATEGORIES'] };

    assert.equal(simulateRbac(getDestRoute, destAdmin), true);
    assert.equal(simulateRbac(postDestRoute, destAdmin), true);
    assert.equal(simulateRbac(getCatRoute, catAdmin), true);
    assert.equal(simulateRbac(postCatRoute, catAdmin), true);
  });

  it('allows SUPER_ADMIN without explicit permission to access all endpoints', () => {
    const superAdmin = { user_id: 1, role: 'SUPER_ADMIN', permissions: ['*'] };

    assert.equal(simulateRbac(getDestRoute, superAdmin), true);
    assert.equal(simulateRbac(delDestRoute, superAdmin), true);
    assert.equal(simulateRbac(getCatRoute, superAdmin), true);
    assert.equal(simulateRbac(delCatRoute, superAdmin), true);
  });
});

describe('Admin Destinations — GET /api/admin/destinations', () => {
  it('returns destinations including INACTIVE with numeric package_count and meta', async () => {
    let executedSql = '';
    const mockRows = [
      {
        destination_id: 1,
        name: 'Munnar',
        city: 'Munnar',
        state: 'Kerala',
        country: 'India',
        description: 'Hills',
        status: 'ACTIVE',
        package_count: '5'
      },
      {
        destination_id: 2,
        name: 'Old Port',
        city: 'Kochi',
        state: 'Kerala',
        country: 'India',
        description: 'Historic',
        status: 'INACTIVE',
        package_count: 0
      }
    ];

    const ctx = {
      query: {},
      db: {
        query: async (sql) => {
          executedSql = sql;
          return mockRows;
        }
      }
    };

    const res = await getDestRoute.handler(ctx);
    assert.ok(Array.isArray(res.data));
    assert.equal(res.data.length, 2);
    assert.equal(res.data[0].status, 'ACTIVE');
    assert.equal(res.data[0].package_count, 5);
    assert.equal(res.data[1].status, 'INACTIVE');
    assert.equal(res.data[1].package_count, 0);
    assert.equal(res.meta.total, 2);
    // Verified INACTIVE is included (no hardcoded status = ACTIVE filter)
    assert.ok(!executedSql.includes("d.status = 'ACTIVE'"));
  });

  it('applies search q, status filters, and pagination', async () => {
    let capturedParams = [];
    const ctx = {
      query: {
        q: 'Munnar',
        status: 'ACTIVE',
        page: '2',
        pageSize: '5'
      },
      db: {
        query: async (sql, params) => {
          capturedParams = params;
          if (sql.includes('COUNT(*) AS total')) {
            return [{ total: 12 }];
          }
          return [];
        }
      }
    };

    const res = await getDestRoute.handler(ctx);
    assert.equal(res.meta.page, 2);
    assert.equal(res.meta.pageSize, 5);
    assert.equal(res.meta.total, 12);
    assert.equal(res.meta.totalPages, 3);
    assert.ok(capturedParams.includes('%Munnar%'));
    assert.ok(capturedParams.includes('ACTIVE'));
    assert.ok(capturedParams.includes(5)); // pageSize
    assert.ok(capturedParams.includes(5)); // offset (page 2 - 1) * 5
  });

  it('rejects oversized search string with 400 VALIDATION_ERROR', async () => {
    const ctx = {
      query: { q: 'a'.repeat(101) },
      db: { query: async () => [] }
    };
    await assert.rejects(getDestRoute.handler(ctx), (err) => {
      return err.status === 400 && err.code === 'VALIDATION_ERROR';
    });
  });
});

describe('Admin Destinations — POST /api/admin/destinations', () => {
  it('creates a destination with valid fields, defaults and returns 201', async () => {
    let loggedAction = null;
    let loggedDesc = null;
    let insertedParams = [];

    const ctx = {
      body: {
        name: 'Ooty Hills',
        city: 'Ooty',
        state: 'Tamil Nadu',
        description: 'Queen of hill stations'
      },
      user: { user_id: 1, role: 'SUPER_ADMIN' },
      db: {
        query: async (sql, params) => {
          if (sql.includes('SELECT destination_id FROM destinations')) {
            return []; // No duplicate
          }
          if (sql.includes('INSERT INTO destinations')) {
            insertedParams = params;
            return { insertId: 25 };
          }
          if (sql.includes('INSERT INTO system_logs')) {
            loggedAction = params[1];
            loggedDesc = params[2];
            return { insertId: 100 };
          }
          return [];
        }
      }
    };

    const res = await postDestRoute.handler(ctx);
    assert.equal(res.status, 201);
    assert.equal(res.data.destination_id, 25);
    assert.equal(res.data.name, 'Ooty Hills');
    assert.equal(res.data.country, 'India'); // Default country
    assert.equal(res.data.status, 'ACTIVE'); // Default status
    assert.equal(loggedAction, 'DESTINATION_CREATED');
    assert.ok(loggedDesc.includes('Ooty Hills'));
  });

  it('validates required fields (name, city, state)', async () => {
    const ctx = {
      body: { name: 'Only Name' },
      db: { query: async () => [] }
    };
    await assert.rejects(postDestRoute.handler(ctx), (err) => {
      return err.status === 400 && err.code === 'VALIDATION_ERROR';
    });
  });

  it('rejects duplicate destination name and city with 409 CONFLICT', async () => {
    const ctx = {
      body: {
        name: 'Munnar',
        city: 'Munnar',
        state: 'Kerala'
      },
      db: {
        query: async (sql) => {
          if (sql.includes('SELECT destination_id FROM destinations')) {
            return [{ destination_id: 1 }]; // Existing row
          }
          return [];
        }
      }
    };
    await assert.rejects(postDestRoute.handler(ctx), (err) => {
      return err.status === 409 && err.code === 'CONFLICT';
    });
  });

  it('handles database ER_DUP_ENTRY error and returns 409 CONFLICT', async () => {
    const ctx = {
      body: {
        name: 'Unique Test',
        city: 'City Test',
        state: 'State Test'
      },
      db: {
        query: async (sql) => {
          if (sql.includes('SELECT destination_id FROM destinations')) return [];
          const dupErr = new Error('Duplicate entry');
          dupErr.code = 'ER_DUP_ENTRY';
          throw dupErr;
        }
      }
    };
    await assert.rejects(postDestRoute.handler(ctx), (err) => {
      return err.status === 409 && err.code === 'CONFLICT';
    });
  });
});

describe('Admin Destinations — PUT /api/admin/destinations/:id', () => {
  it('updates destination fields successfully and logs DESTINATION_UPDATED', async () => {
    let loggedAction = null;
    let updatedParams = [];

    const ctx = {
      params: { id: '5' },
      body: {
        name: 'Coorg Updated',
        status: 'INACTIVE'
      },
      user: { user_id: 1, role: 'SUPER_ADMIN' },
      db: {
        query: async (sql, params) => {
          if (sql.includes('SELECT * FROM destinations WHERE destination_id = ?')) {
            return [{
              destination_id: 5,
              name: 'Coorg',
              city: 'Madikeri',
              state: 'Karnataka',
              country: 'India',
              description: 'Old desc',
              status: 'ACTIVE'
            }];
          }
          if (sql.includes('SELECT destination_id FROM destinations WHERE LOWER(name)')) {
            return []; // No collision
          }
          if (sql.includes('UPDATE destinations')) {
            updatedParams = params;
            return { affectedRows: 1 };
          }
          if (sql.includes('INSERT INTO system_logs')) {
            loggedAction = params[1];
            return { insertId: 101 };
          }
          return [];
        }
      }
    };

    const res = await putDestRoute.handler(ctx);
    assert.equal(res.data.destination_id, 5);
    assert.equal(res.data.name, 'Coorg Updated');
    assert.equal(res.data.status, 'INACTIVE');
    assert.equal(res.data.city, 'Madikeri'); // Preserved existing city
    assert.equal(loggedAction, 'DESTINATION_UPDATED');
  });

  it('rejects invalid destination ID with 400 BAD_REQUEST', async () => {
    const ctx = {
      params: { id: 'abc' },
      body: { name: 'New' },
      db: { query: async () => [] }
    };
    await assert.rejects(putDestRoute.handler(ctx), (err) => {
      return err.status === 400 && err.code === 'BAD_REQUEST';
    });
  });

  it('returns 404 NOT_FOUND for non-existent destination', async () => {
    const ctx = {
      params: { id: '999' },
      body: { name: 'Non Existent' },
      db: {
        query: async () => []
      }
    };
    await assert.rejects(putDestRoute.handler(ctx), (err) => {
      return err.status === 404 && err.code === 'NOT_FOUND';
    });
  });

  it('rejects update creating duplicate name and city with 409 CONFLICT', async () => {
    const ctx = {
      params: { id: '5' },
      body: { name: 'Munnar', city: 'Munnar' },
      db: {
        query: async (sql) => {
          if (sql.includes('SELECT * FROM destinations')) {
            return [{ destination_id: 5, name: 'Coorg', city: 'Madikeri' }];
          }
          if (sql.includes('SELECT destination_id FROM destinations')) {
            return [{ destination_id: 1 }]; // Conflict with ID 1
          }
          return [];
        }
      }
    };
    await assert.rejects(putDestRoute.handler(ctx), (err) => {
      return err.status === 409 && err.code === 'CONFLICT';
    });
  });
});

describe('Admin Destinations — DELETE /api/admin/destinations/:id', () => {
  it('prevents deletion and returns 409 CONFLICT when destination has tour packages', async () => {
    const ctx = {
      params: { id: '1' },
      db: {
        query: async (sql) => {
          if (sql.includes('SELECT destination_id, name FROM destinations')) {
            return [{ destination_id: 1, name: 'Munnar' }];
          }
          if (sql.includes('SELECT COUNT(*) AS count FROM tour_packages')) {
            return [{ count: 3 }]; // Has 3 packages
          }
          return [];
        }
      }
    };

    await assert.rejects(delDestRoute.handler(ctx), (err) => {
      return err.status === 409 && err.code === 'CONFLICT' && err.message.includes('tour package(s)');
    });
  });

  it('successfully deletes unreferenced destination and logs DESTINATION_DELETED', async () => {
    let deleted = false;
    let loggedAction = null;

    const ctx = {
      params: { id: '99' },
      user: { user_id: 1, role: 'SUPER_ADMIN' },
      db: {
        query: async (sql, params) => {
          if (sql.includes('SELECT destination_id, name FROM destinations')) {
            return [{ destination_id: 99, name: 'Empty Destination' }];
          }
          if (sql.includes('SELECT COUNT(*) AS count FROM tour_packages')) {
            return [{ count: 0 }]; // No packages
          }
          if (sql.includes('DELETE FROM destinations')) {
            deleted = true;
            return { affectedRows: 1 };
          }
          if (sql.includes('INSERT INTO system_logs')) {
            loggedAction = params[1];
            return { insertId: 102 };
          }
          return [];
        }
      }
    };

    const res = await delDestRoute.handler(ctx);
    assert.equal(deleted, true);
    assert.equal(res.data.destination_id, 99);
    assert.equal(loggedAction, 'DESTINATION_DELETED');
  });

  it('returns 404 NOT_FOUND when deleting nonexistent destination', async () => {
    const ctx = {
      params: { id: '9999' },
      db: { query: async () => [] }
    };
    await assert.rejects(delDestRoute.handler(ctx), (err) => {
      return err.status === 404 && err.code === 'NOT_FOUND';
    });
  });
});

describe('Admin Categories — GET /api/admin/categories', () => {
  it('returns all categories including INACTIVE with numeric package_count and meta', async () => {
    const mockRows = [
      { category_id: 1, category_name: 'Adventure', description: 'Trekking', status: 'ACTIVE', package_count: '4' },
      { category_id: 2, category_name: 'Seasonal', description: 'Winter', status: 'INACTIVE', package_count: 0 }
    ];

    const ctx = {
      query: {},
      db: { query: async () => mockRows }
    };

    const res = await getCatRoute.handler(ctx);
    assert.ok(Array.isArray(res.data));
    assert.equal(res.data.length, 2);
    assert.equal(res.data[0].category_name, 'Adventure');
    assert.equal(res.data[0].package_count, 4);
    assert.equal(res.data[1].status, 'INACTIVE');
    assert.equal(res.meta.total, 2);
  });

  it('supports category search and pagination', async () => {
    let capturedParams = [];
    const ctx = {
      query: { q: 'Adv', page: '1', pageSize: '2' },
      db: {
        query: async (sql, params) => {
          capturedParams = params;
          if (sql.includes('COUNT(*) AS total')) return [{ total: 5 }];
          return [];
        }
      }
    };

    const res = await getCatRoute.handler(ctx);
    assert.equal(res.meta.page, 1);
    assert.equal(res.meta.pageSize, 2);
    assert.equal(res.meta.total, 5);
    assert.equal(res.meta.totalPages, 3);
    assert.ok(capturedParams.includes('%Adv%'));
  });
});

describe('Admin Categories — POST /api/admin/categories', () => {
  it('creates category with valid fields and returns 201', async () => {
    let loggedAction = null;
    const ctx = {
      body: {
        category_name: 'Eco Tourism',
        description: 'Sustainable travel'
      },
      user: { user_id: 1, role: 'SUPER_ADMIN' },
      db: {
        query: async (sql, params) => {
          if (sql.includes('SELECT category_id FROM categories')) return [];
          if (sql.includes('INSERT INTO categories')) return { insertId: 10 };
          if (sql.includes('INSERT INTO system_logs')) {
            loggedAction = params[1];
            return { insertId: 103 };
          }
          return [];
        }
      }
    };

    const res = await postCatRoute.handler(ctx);
    assert.equal(res.status, 201);
    assert.equal(res.data.category_id, 10);
    assert.equal(res.data.category_name, 'Eco Tourism');
    assert.equal(res.data.status, 'ACTIVE');
    assert.equal(loggedAction, 'CATEGORY_CREATED');
  });

  it('rejects duplicate category name with 409 CONFLICT', async () => {
    const ctx = {
      body: { category_name: 'Adventure' },
      db: {
        query: async (sql) => {
          if (sql.includes('SELECT category_id FROM categories')) {
            return [{ category_id: 1 }];
          }
          return [];
        }
      }
    };
    await assert.rejects(postCatRoute.handler(ctx), (err) => {
      return err.status === 409 && err.code === 'CONFLICT';
    });
  });

  it('rejects missing category_name with 400 VALIDATION_ERROR', async () => {
    const ctx = {
      body: { description: 'Missing name' },
      db: { query: async () => [] }
    };
    await assert.rejects(postCatRoute.handler(ctx), (err) => {
      return err.status === 400 && err.code === 'VALIDATION_ERROR';
    });
  });
});

describe('Admin Categories — PUT /api/admin/categories/:id', () => {
  it('updates category details and logs CATEGORY_UPDATED', async () => {
    let loggedAction = null;
    const ctx = {
      params: { id: '3' },
      body: {
        category_name: 'Beach & Coastal',
        status: 'ACTIVE'
      },
      user: { user_id: 1, role: 'SUPER_ADMIN' },
      db: {
        query: async (sql, params) => {
          if (sql.includes('SELECT * FROM categories WHERE category_id = ?')) {
            return [{ category_id: 3, category_name: 'Beach & Island', description: 'Sea and sand', status: 'ACTIVE' }];
          }
          if (sql.includes('SELECT category_id FROM categories WHERE LOWER(category_name)')) return [];
          if (sql.includes('UPDATE categories')) return { affectedRows: 1 };
          if (sql.includes('INSERT INTO system_logs')) {
            loggedAction = params[1];
            return { insertId: 104 };
          }
          return [];
        }
      }
    };

    const res = await putCatRoute.handler(ctx);
    assert.equal(res.data.category_id, 3);
    assert.equal(res.data.category_name, 'Beach & Coastal');
    assert.equal(loggedAction, 'CATEGORY_UPDATED');
  });

  it('rejects invalid category ID with 400 BAD_REQUEST', async () => {
    const ctx = {
      params: { id: '-2' },
      body: { category_name: 'New' },
      db: { query: async () => [] }
    };
    await assert.rejects(putCatRoute.handler(ctx), (err) => {
      return err.status === 400 && err.code === 'BAD_REQUEST';
    });
  });

  it('rejects duplicate name on update with 409 CONFLICT', async () => {
    const ctx = {
      params: { id: '3' },
      body: { category_name: 'Adventure' },
      db: {
        query: async (sql) => {
          if (sql.includes('SELECT * FROM categories')) {
            return [{ category_id: 3, category_name: 'Beach', status: 'ACTIVE' }];
          }
          if (sql.includes('SELECT category_id FROM categories')) {
            return [{ category_id: 1 }]; // Conflict with ID 1
          }
          return [];
        }
      }
    };
    await assert.rejects(putCatRoute.handler(ctx), (err) => {
      return err.status === 409 && err.code === 'CONFLICT';
    });
  });
});

describe('Admin Categories — DELETE /api/admin/categories/:id', () => {
  it('prevents deletion and returns 409 CONFLICT when category has tour packages', async () => {
    const ctx = {
      params: { id: '1' },
      db: {
        query: async (sql) => {
          if (sql.includes('SELECT category_id, category_name FROM categories')) {
            return [{ category_id: 1, category_name: 'Adventure' }];
          }
          if (sql.includes('SELECT COUNT(*) AS count FROM tour_packages')) {
            return [{ count: 2 }]; // Has 2 packages
          }
          return [];
        }
      }
    };

    await assert.rejects(delCatRoute.handler(ctx), (err) => {
      return err.status === 409 && err.code === 'CONFLICT' && err.message.includes('tour package(s)');
    });
  });

  it('successfully deletes unreferenced category and logs CATEGORY_DELETED', async () => {
    let deleted = false;
    let loggedAction = null;

    const ctx = {
      params: { id: '88' },
      user: { user_id: 1, role: 'SUPER_ADMIN' },
      db: {
        query: async (sql, params) => {
          if (sql.includes('SELECT category_id, category_name FROM categories')) {
            return [{ category_id: 88, category_name: 'Obsolete Category' }];
          }
          if (sql.includes('SELECT COUNT(*) AS count FROM tour_packages')) {
            return [{ count: 0 }];
          }
          if (sql.includes('DELETE FROM categories')) {
            deleted = true;
            return { affectedRows: 1 };
          }
          if (sql.includes('INSERT INTO system_logs')) {
            loggedAction = params[1];
            return { insertId: 105 };
          }
          return [];
        }
      }
    };

    const res = await delCatRoute.handler(ctx);
    assert.equal(deleted, true);
    assert.equal(res.data.category_id, 88);
    assert.equal(loggedAction, 'CATEGORY_DELETED');
  });

  it('returns 404 NOT_FOUND when deleting nonexistent category', async () => {
    const ctx = {
      params: { id: '9999' },
      db: { query: async () => [] }
    };
    await assert.rejects(delCatRoute.handler(ctx), (err) => {
      return err.status === 404 && err.code === 'NOT_FOUND';
    });
  });
});
