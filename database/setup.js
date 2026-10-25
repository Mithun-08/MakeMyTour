/**
 * database/setup.js  — Owner: M1
 *
 * Recreates the database, runs schema.sql, inserts demo accounts and default
 * settings, then runs seed files (in order) if they exist.
 *
 * DANGER: DROPS and recreates the configured database. Never run against a
 * shared, production, or data-bearing database.
 *
 * Usage: npm run db:setup
 *
 * Seeds run in filename order from database/seeds/:
 *   seeds/02_catalog.sql  (M2 owner — may not exist yet)
 *   seeds/03_bookings.sql (M3 owner — may not exist yet)
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

// Load .env before requiring config so env vars are present
const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  if (typeof process.loadEnvFile === 'function') {
    try { process.loadEnvFile(envPath); } catch { parseEnvFallback(envPath); }
  } else {
    parseEnvFallback(envPath);
  }
}

function parseEnvFallback(filePath) {
  try {
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq === -1) continue;
      const key = t.slice(0, eq).trim();
      let val = t.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {}
}

const config = {
  DB_HOST: process.env.DB_HOST || 'localhost',
  DB_PORT: parseInt(process.env.DB_PORT, 10) || 3306,
  DB_USER: process.env.DB_USER || 'root',
  DB_PASSWORD: process.env.DB_PASSWORD !== undefined ? process.env.DB_PASSWORD : '',
  DB_NAME: process.env.DB_NAME || 'makemytour'
};

const SCHEMA_FILE = path.join(__dirname, 'schema.sql');
const SEEDS_DIR   = path.join(__dirname, 'seeds');

const { hashPassword } = require('../server/utils/password');

// Demo accounts — password for all: Password@123
const DEMO_PASSWORD = 'Password@123';
const DEMO_USERS = [
  { user_id: 1, name: 'Super Admin',   email: 'superadmin@makemytour.test', role: 'SUPER_ADMIN', status: 'ACTIVE',  mobile: '9000000001', city: null,      state: null      },
  { user_id: 2, name: 'Admin User',    email: 'admin@makemytour.test',      role: 'ADMIN',       status: 'ACTIVE',  mobile: '9000000002', city: null,      state: null      },
  { user_id: 3, name: 'Limited Admin', email: 'limitedadmin@makemytour.test',role:'ADMIN',        status: 'ACTIVE',  mobile: '9000000003', city: null,      state: null      },
  { user_id: 4, name: 'Ravi Kumar',    email: 'provider1@makemytour.test',  role: 'PROVIDER',    status: 'ACTIVE',  mobile: '9000000004', city: 'Chennai', state: 'Tamil Nadu'  },
  { user_id: 5, name: 'Meena Iyer',   email: 'provider2@makemytour.test',  role: 'PROVIDER',    status: 'ACTIVE',  mobile: '9000000005', city: 'Bangalore',state: 'Karnataka'   },
  { user_id: 6, name: 'Raj Patel',    email: 'provider3@makemytour.test',  role: 'PROVIDER',    status: 'PENDING', mobile: '9000000006', city: 'Mumbai',  state: 'Maharashtra' },
  { user_id: 7, name: 'Anita Sharma', email: 'customer1@makemytour.test',  role: 'CUSTOMER',    status: 'ACTIVE',  mobile: '9000000007', city: null,      state: null          },
  { user_id: 8, name: 'Karthik R',    email: 'customer2@makemytour.test',  role: 'CUSTOMER',    status: 'ACTIVE',  mobile: '9000000008', city: null,      state: null          }
];

// Admin 2 (user_id 2): all 8 permissions
const ADMIN_ALL_PERMISSIONS = [
  'MANAGE_USERS', 'MANAGE_PROVIDERS', 'MANAGE_DESTINATIONS', 'MANAGE_CATEGORIES',
  'MODERATE_PACKAGES', 'MANAGE_BOOKINGS', 'VIEW_REPORTS', 'VIEW_LOGS'
];
// Admin 3 (user_id 3): limited permissions
const ADMIN_LIMITED_PERMISSIONS = ['MANAGE_DESTINATIONS', 'MANAGE_CATEGORIES'];

const DEFAULT_SETTINGS = [
  { setting_key: 'site_name',                  setting_value: 'MakeMyTour' },
  { setting_key: 'cancellation_window_days',   setting_value: '2'          },
  { setting_key: 'max_travelers_per_booking',  setting_value: '10'         }
];

/**
 * Split SQL file into individual statements, respecting multi-line bodies.
 * Handles inline comments (-- ...) and strips them safely.
 */
function splitStatements(sql) {
  // Remove line comments
  const cleaned = sql.replace(/--[^\n]*/g, '');
  // Split on semicolons
  return cleaned
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

async function runSqlFile(conn, filePath) {
  const sql = fs.readFileSync(filePath, 'utf8');
  const statements = splitStatements(sql);
  for (const stmt of statements) {
    await conn.query(stmt);
  }
}

async function setup() {
  console.log('\n=== MakeMyTour Database Setup ===');
  console.log(`Host: ${config.DB_HOST}:${config.DB_PORT}`);
  console.log(`Database: ${config.DB_NAME}`);
  console.log(`User: ${config.DB_USER}`);
  console.log('');

  // Connect without a database selected first, so we can DROP/CREATE
  let conn;
  try {
    conn = await mysql.createConnection({
      host: config.DB_HOST,
      port: config.DB_PORT,
      user: config.DB_USER,
      password: config.DB_PASSWORD,
      multipleStatements: false
    });
    console.log('✓ Connected to MySQL server');
  } catch (err) {
    console.error('✗ Cannot connect to MySQL:', err.message);
    console.error('\nEnsure:');
    console.error('  1. MySQL is running (port ' + config.DB_PORT + ')');
    console.error('  2. .env has the correct DB_USER and DB_PASSWORD');
    process.exit(1);
  }

  try {
    // Drop and recreate database
    await conn.query(`DROP DATABASE IF EXISTS \`${config.DB_NAME}\``);
    console.log(`✓ Dropped database "${config.DB_NAME}" (if it existed)`);

    await conn.query(`CREATE DATABASE \`${config.DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    console.log(`✓ Created database "${config.DB_NAME}"`);

    await conn.query(`USE \`${config.DB_NAME}\``);

    // Run schema
    if (!fs.existsSync(SCHEMA_FILE)) {
      throw new Error(`schema.sql not found at ${SCHEMA_FILE}`);
    }
    await runSqlFile(conn, SCHEMA_FILE);
    console.log('✓ Schema applied');

    // Hash the shared demo password once
    console.log('  Hashing demo password…');
    const hashedPw = await hashPassword(DEMO_PASSWORD);

    // Insert demo users with explicit IDs
    console.log('  Inserting demo users…');
    for (const u of DEMO_USERS) {
      await conn.execute(
        `INSERT INTO users (user_id, name, email, password, mobile, role, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [u.user_id, u.name, u.email, hashedPw, u.mobile, u.role, u.status]
      );
    }
    console.log(`  Inserted ${DEMO_USERS.length} demo users`);

    // Addresses for providers (city and state only)
    const providers = DEMO_USERS.filter(u => u.role === 'PROVIDER' && u.city);
    for (const p of providers) {
      await conn.execute(
        `INSERT INTO addresses (user_id, city, state) VALUES (?, ?, ?)`,
        [p.user_id, p.city, p.state]
      );
    }
    console.log(`  Inserted ${providers.length} provider addresses`);

    // Admin permissions
    for (const perm of ADMIN_ALL_PERMISSIONS) {
      await conn.execute(
        `INSERT INTO admin_permissions (admin_id, permission_name) VALUES (2, ?)`,
        [perm]
      );
    }
    for (const perm of ADMIN_LIMITED_PERMISSIONS) {
      await conn.execute(
        `INSERT INTO admin_permissions (admin_id, permission_name) VALUES (3, ?)`,
        [perm]
      );
    }
    console.log('  Inserted admin permissions');

    // Default settings
    for (const s of DEFAULT_SETTINGS) {
      await conn.execute(
        `INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?)`,
        [s.setting_key, s.setting_value]
      );
    }
    console.log('  Inserted default settings');

    // Run seed files in order (skip gracefully if not present yet)
    if (fs.existsSync(SEEDS_DIR)) {
      const seedFiles = fs.readdirSync(SEEDS_DIR)
        .filter(f => f.endsWith('.sql'))
        .sort();
      for (const seedFile of seedFiles) {
        const seedPath = path.join(SEEDS_DIR, seedFile);
        console.log(`  Running seed: ${seedFile}…`);
        try {
          await runSqlFile(conn, seedPath);
          console.log(`  ✓ ${seedFile} applied`);
        } catch (err) {
          console.warn(`  ⚠ ${seedFile} failed: ${err.message}`);
        }
      }
    } else {
      console.log('  No seeds/ directory yet — skipping seeds');
    }

    // Verify row counts
    const [userCount]    = await conn.query('SELECT COUNT(*) AS n FROM users');
    const [settingCount] = await conn.query('SELECT COUNT(*) AS n FROM system_settings');
    console.log('');
    console.log('=== Setup complete ===');
    console.log(`  users: ${userCount[0].n}`);
    console.log(`  system_settings: ${settingCount[0].n}`);
    console.log('');
    console.log('Demo accounts (all passwords: Password@123):');
    console.log('  superadmin@makemytour.test  — SUPER_ADMIN');
    console.log('  admin@makemytour.test        — ADMIN (all permissions)');
    console.log('  limitedadmin@makemytour.test — ADMIN (MANAGE_DESTINATIONS, MANAGE_CATEGORIES)');
    console.log('  provider1@makemytour.test    — PROVIDER (ACTIVE)');
    console.log('  provider2@makemytour.test    — PROVIDER (ACTIVE)');
    console.log('  provider3@makemytour.test    — PROVIDER (PENDING)');
    console.log('  customer1@makemytour.test    — CUSTOMER (ACTIVE)');
    console.log('  customer2@makemytour.test    — CUSTOMER (ACTIVE)');
    console.log('');
    console.log('Run `npm start` then open http://localhost:3000');

  } catch (err) {
    console.error('\n✗ Setup failed:', err.message);
    if (config.NODE_ENV === 'development') {
      console.error(err.stack);
    }
    process.exit(1);
  } finally {
    await conn.end();
  }
}

setup();
