/**
 * server/db.js  — Owner: M1
 *
 * Creates and exports a MySQL2 promise-based connection pool.
 * Exposes two methods:
 *
 *   db.query(sql, params)
 *     For SELECT: returns an array of row objects.
 *     For INSERT/UPDATE/DELETE: returns { insertId, affectedRows }.
 *
 *   db.transaction(async (tx) => { ... })
 *     Acquires a connection, starts a transaction, runs the callback with
 *     a `tx` object that has the same `query` signature. Commits on success,
 *     rolls back if the callback throws. Use `SELECT ... FOR UPDATE` inside
 *     the callback to lock rows (e.g. availability seats).
 */

const mysql = require('mysql2/promise');
const config = require('./config');

const pool = mysql.createPool({
  host: config.DB_HOST,
  port: config.DB_PORT,
  user: config.DB_USER,
  password: config.DB_PASSWORD,
  database: config.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  // Return JS Date objects for DATE columns, not strings
  dateStrings: ['DATE'],
  // Ensure DECIMAL values come back as strings so we can control precision
  decimalNumbers: false
});

/**
 * Executes a parameterized SQL statement on the pool.
 * @param {string} sql
 * @param {Array} [params=[]]
 * @returns {Promise<Array|{insertId:number,affectedRows:number}>}
 */
async function query(sql, params = []) {
  const [result] = await pool.execute(sql, params);
  if (Array.isArray(result)) {
    return result;
  }
  // ResultSetHeader for INSERT/UPDATE/DELETE
  return {
    insertId: result.insertId,
    affectedRows: result.affectedRows
  };
}

/**
 * Runs `fn(tx)` inside a MySQL transaction. Rolls back on any thrown error.
 * @param {function} fn  receives { query } with the same signature as db.query
 * @returns {Promise<*>} whatever fn returns
 */
async function transaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const tx = {
      async query(sql, params = []) {
        const [result] = await conn.execute(sql, params);
        if (Array.isArray(result)) {
          return result;
        }
        return {
          insertId: result.insertId,
          affectedRows: result.affectedRows
        };
      }
    };

    const returnValue = await fn(tx);
    await conn.commit();
    return returnValue;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Verifies the pool can reach the database. Used at server startup.
 * @returns {Promise<void>} resolves on success, throws on failure
 */
async function testConnection() {
  const conn = await pool.getConnection();
  await conn.ping();
  conn.release();
}

module.exports = { query, transaction, testConnection };
