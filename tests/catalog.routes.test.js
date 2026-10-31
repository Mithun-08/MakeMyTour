/**
 * tests/catalog.routes.test.js — Owner: M2
 * Focused tests for Public Catalog APIs:
 *   - GET /api/destinations
 *   - GET /api/categories
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const routes = require('../server/routes/catalog.routes');
const { HttpError } = require('../server/utils/http');

const destinationsRoute = routes.find(
  r => r.method === 'GET' && r.path === '/api/destinations'
);
const categoriesRoute = routes.find(
  r => r.method === 'GET' && r.path === '/api/categories'
);

describe('Catalog Routes — Registration & Public Access', () => {
  it('catalog.routes.js exports an array of 2 public routes', () => {
    assert.ok(Array.isArray(routes));
    assert.equal(routes.length, 2);
  });

  it('GET /api/destinations is public (no roles or permissions required)', () => {
    assert.ok(destinationsRoute);
    assert.equal(destinationsRoute.roles, undefined);
    assert.equal(destinationsRoute.permission, undefined);
    assert.equal(typeof destinationsRoute.handler, 'function');
  });

  it('GET /api/categories is public (no roles or permissions required)', () => {
    assert.ok(categoriesRoute);
    assert.equal(categoriesRoute.roles, undefined);
    assert.equal(categoriesRoute.permission, undefined);
    assert.equal(typeof categoriesRoute.handler, 'function');
  });
});

describe('GET /api/destinations', () => {
  it('returns active destinations with numeric package_count', async () => {
    let capturedSql = '';
    let capturedParams = [];

    const mockRows = [
      {
        destination_id: 1,
        name: 'Munnar Hill Station',
        city: 'Munnar',
        state: 'Kerala',
        country: 'India',
        description: 'Scenic hill station',
        status: 'ACTIVE',
        package_count: '2'
      },
      {
        destination_id: 2,
        name: 'Hampi Ruins',
        city: 'Hampi',
        state: 'Karnataka',
        country: 'India',
        description: 'Ancient ruins',
        status: 'ACTIVE',
        package_count: 0
      }
    ];

    const ctx = {
      query: {},
      db: {
        query: async (sql, params) => {
          capturedSql = sql;
          capturedParams = params;
          return mockRows;
        }
      }
    };

    const result = await destinationsRoute.handler(ctx);

    assert.ok(Array.isArray(result.data));
    assert.equal(result.data.length, 2);

    assert.equal(result.data[0].destination_id, 1);
    assert.equal(result.data[0].name, 'Munnar Hill Station');
    assert.equal(result.data[0].city, 'Munnar');
    assert.equal(result.data[0].state, 'Kerala');
    assert.equal(result.data[0].status, 'ACTIVE');
    assert.strictEqual(typeof result.data[0].package_count, 'number');
    assert.equal(result.data[0].package_count, 2);

    assert.strictEqual(typeof result.data[1].package_count, 'number');
    assert.equal(result.data[1].package_count, 0);

    assert.ok(capturedSql.includes("d.status = 'ACTIVE'"));
    assert.ok(capturedSql.includes("p.status = 'APPROVED'"));
    assert.deepEqual(capturedParams, []);
  });

  it('applies parameterized search filter (q)', async () => {
    let capturedSql = '';
    let capturedParams = [];

    const ctx = {
      query: { q: 'Munnar' },
      db: {
        query: async (sql, params) => {
          capturedSql = sql;
          capturedParams = params;
          return [];
        }
      }
    };

    const result = await destinationsRoute.handler(ctx);
    assert.deepEqual(result.data, []);

    assert.ok(capturedSql.includes('d.name LIKE ?'));
    assert.ok(capturedSql.includes('d.city LIKE ?'));
    assert.ok(capturedSql.includes('d.state LIKE ?'));
    assert.equal(capturedParams.length, 3);
    assert.equal(capturedParams[0], '%Munnar%');
    assert.equal(capturedParams[1], '%Munnar%');
    assert.equal(capturedParams[2], '%Munnar%');
  });

  it('applies parameterized state filter', async () => {
    let capturedSql = '';
    let capturedParams = [];

    const ctx = {
      query: { state: 'Karnataka' },
      db: {
        query: async (sql, params) => {
          capturedSql = sql;
          capturedParams = params;
          return [];
        }
      }
    };

    const result = await destinationsRoute.handler(ctx);
    assert.deepEqual(result.data, []);

    assert.ok(capturedSql.includes('d.state = ?'));
    assert.deepEqual(capturedParams, ['Karnataka']);
  });

  it('applies both q and state filters simultaneously with parameterization', async () => {
    let capturedSql = '';
    let capturedParams = [];

    const ctx = {
      query: { q: 'Ruins', state: 'Karnataka' },
      db: {
        query: async (sql, params) => {
          capturedSql = sql;
          capturedParams = params;
          return [];
        }
      }
    };

    await destinationsRoute.handler(ctx);

    assert.ok(capturedSql.includes('d.name LIKE ?'));
    assert.ok(capturedSql.includes('d.state = ?'));
    assert.equal(capturedParams.length, 4);
    assert.equal(capturedParams[0], '%Ruins%');
    assert.equal(capturedParams[1], '%Ruins%');
    assert.equal(capturedParams[2], '%Ruins%');
    assert.equal(capturedParams[3], 'Karnataka');
  });

  it('handles empty results gracefully without throwing', async () => {
    const ctx = {
      query: { q: 'NonExistentPlace' },
      db: {
        query: async () => []
      }
    };

    const result = await destinationsRoute.handler(ctx);
    assert.ok(Array.isArray(result.data));
    assert.equal(result.data.length, 0);
  });

  it('handles null/undefined database result safely', async () => {
    const ctx = {
      query: {},
      db: {
        query: async () => null
      }
    };

    const result = await destinationsRoute.handler(ctx);
    assert.deepEqual(result.data, []);
  });

  it('rejects invalid q parameter (length > 100) with 400 VALIDATION_ERROR', async () => {
    const ctx = {
      query: { q: 'x'.repeat(101) },
      db: {}
    };

    await assert.rejects(
      () => destinationsRoute.handler(ctx),
      (err) => err instanceof HttpError && err.status === 400 && err.code === 'VALIDATION_ERROR'
    );
  });

  it('rejects invalid q parameter (non-string) with 400 VALIDATION_ERROR', async () => {
    const ctx = {
      query: { q: 12345 },
      db: {}
    };

    await assert.rejects(
      () => destinationsRoute.handler(ctx),
      (err) => err instanceof HttpError && err.status === 400 && err.code === 'VALIDATION_ERROR'
    );
  });

  it('rejects invalid state parameter (length > 100) with 400 VALIDATION_ERROR', async () => {
    const ctx = {
      query: { state: 's'.repeat(101) },
      db: {}
    };

    await assert.rejects(
      () => destinationsRoute.handler(ctx),
      (err) => err instanceof HttpError && err.status === 400 && err.code === 'VALIDATION_ERROR'
    );
  });

  it('rejects invalid state parameter (non-string) with 400 VALIDATION_ERROR', async () => {
    const ctx = {
      query: { state: ['Kerala'] },
      db: {}
    };

    await assert.rejects(
      () => destinationsRoute.handler(ctx),
      (err) => err instanceof HttpError && err.status === 400 && err.code === 'VALIDATION_ERROR'
    );
  });
});

describe('GET /api/categories', () => {
  it('returns active categories only and maps category_id to number', async () => {
    let capturedSql = '';

    const mockCategories = [
      {
        category_id: 1,
        category_name: 'Adventure',
        description: 'Trekking and outdoor thrills',
        status: 'ACTIVE'
      },
      {
        category_id: 2,
        category_name: 'Cultural',
        description: 'Heritage and temples',
        status: 'ACTIVE'
      }
    ];

    const ctx = {
      db: {
        query: async (sql) => {
          capturedSql = sql;
          return mockCategories;
        }
      }
    };

    const result = await categoriesRoute.handler(ctx);

    assert.ok(Array.isArray(result.data));
    assert.equal(result.data.length, 2);
    assert.equal(result.data[0].category_id, 1);
    assert.strictEqual(typeof result.data[0].category_id, 'number');
    assert.equal(result.data[0].category_name, 'Adventure');
    assert.equal(result.data[0].status, 'ACTIVE');

    assert.equal(result.data[1].category_id, 2);
    assert.strictEqual(typeof result.data[1].category_id, 'number');
    assert.equal(result.data[1].category_name, 'Cultural');

    assert.ok(capturedSql.includes("status = 'ACTIVE'"));
  });

  it('handles empty categories gracefully', async () => {
    const ctx = {
      db: {
        query: async () => []
      }
    };

    const result = await categoriesRoute.handler(ctx);
    assert.ok(Array.isArray(result.data));
    assert.equal(result.data.length, 0);
  });
});
