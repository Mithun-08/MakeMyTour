/**
 * server/routes/superadmin.routes.js — Owner: M1
 *
 * Superadmin Admin Management APIs per CONTRACT §1.5, §1.6, §1.7:
 *
 *   GET    /api/superadmin/admins            — List admin accounts with status and permissions
 *   POST   /api/superadmin/admins            — Create admin account (role forced to ADMIN, status ACTIVE)
 *   PUT    /api/superadmin/admins/:id        — Update admin details (name, mobile)
 *   PATCH  /api/superadmin/admins/:id/status — Activate/deactivate admin (ACTIVE or INACTIVE)
 *   DELETE /api/superadmin/admins/:id        — Delete admin account (never SUPER_ADMIN)
 *   GET    /api/superadmin/permissions       — List 8 allowed permission names
 *   GET    /api/superadmin/admins/:id/permissions — Get admin permissions
 *   PUT    /api/superadmin/admins/:id/permissions — Replace admin permissions
 *   GET    /api/superadmin/stats             — Get dashboard statistics (admins_total, admins_active, users_total, logs_today)
 *
 * All endpoints strictly require role: SUPER_ADMIN.
 */

'use strict';

const { HttpError } = require('../utils/http');
const { hashPassword } = require('../utils/password');
const { logAction } = require('../utils/logger');

const ALLOWED_PERMISSIONS = [
  'MANAGE_USERS',
  'MANAGE_PROVIDERS',
  'MANAGE_DESTINATIONS',
  'MANAGE_CATEGORIES',
  'MODERATE_PACKAGES',
  'MANAGE_BOOKINGS',
  'VIEW_REPORTS',
  'VIEW_LOGS'
];

/**
 * Validates integer ID parameter.
 */
function parseAdminId(idParam) {
  const id = parseInt(idParam, 10);
  if (isNaN(id) || id <= 0) {
    throw new HttpError(400, 'BAD_REQUEST', 'Invalid admin ID in request parameter');
  }
  return id;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. GET /api/superadmin/admins
// ─────────────────────────────────────────────────────────────────────────────

async function listAdmins(ctx) {
  const adminRows = await ctx.db.query(
    `SELECT
       user_id,
       name,
       email,
       mobile,
       role,
       status,
       created_at
     FROM users
     WHERE role = 'ADMIN'
     ORDER BY user_id ASC`
  );

  const permRows = await ctx.db.query(
    'SELECT admin_id, permission_name FROM admin_permissions ORDER BY admin_id, permission_id'
  );

  const permsByAdmin = {};
  for (const p of permRows) {
    if (!permsByAdmin[p.admin_id]) permsByAdmin[p.admin_id] = [];
    permsByAdmin[p.admin_id].push(p.permission_name);
  }

  const data = adminRows.map((a) => ({
    user_id:     Number(a.user_id),
    name:        a.name,
    email:       a.email,
    mobile:      a.mobile,
    role:        a.role,
    status:      a.status,
    created_at:  a.created_at instanceof Date ? a.created_at.toISOString() : String(a.created_at),
    permissions: permsByAdmin[a.user_id] || []
  }));

  return { data };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. POST /api/superadmin/admins
// ─────────────────────────────────────────────────────────────────────────────

async function createAdmin(ctx) {
  const body = ctx.body || {};
  const details = {};

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length < 2 || name.length > 100) {
    details.name = 'name is required and must be between 2 and 100 characters';
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    details.email = 'Valid email is required';
  }

  const password = typeof body.password === 'string' ? body.password : '';
  if (!password || password.length < 8) {
    details.password = 'password is required and must be at least 8 characters';
  }

  const mobile = typeof body.mobile === 'string' ? body.mobile.trim() : '';
  if (!mobile || !/^\d{10}$/.test(mobile)) {
    details.mobile = 'mobile must be exactly 10 digits';
  }

  const permissions = Array.isArray(body.permissions) ? body.permissions : [];
  if (!Array.isArray(body.permissions)) {
    details.permissions = 'permissions must be an array';
  } else {
    for (const p of permissions) {
      if (typeof p !== 'string' || !ALLOWED_PERMISSIONS.includes(p)) {
        details.permissions = `Invalid permission: ${p}. Must be one of: ${ALLOWED_PERMISSIONS.join(', ')}`;
        break;
      }
    }
  }

  if (Object.keys(details).length > 0) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Validation failed', details);
  }

  // Pre-check duplicate email
  const existing = await ctx.db.query('SELECT user_id FROM users WHERE email = ?', [email]);
  if (existing.length > 0) {
    throw new HttpError(409, 'CONFLICT', 'Email is already registered');
  }

  const uniquePermissions = Array.from(new Set(permissions));
  const hashedPassword = await hashPassword(password);

  let newAdmin;
  try {
    newAdmin = await ctx.db.transaction(async (tx) => {
      const userRes = await tx.query(
        'INSERT INTO users (name, email, password, mobile, role, status) VALUES (?, ?, ?, ?, ?, ?)',
        [name, email, hashedPassword, mobile, 'ADMIN', 'ACTIVE']
      );

      const adminId = userRes.insertId;

      for (const perm of uniquePermissions) {
        await tx.query(
          'INSERT INTO admin_permissions (admin_id, permission_name) VALUES (?, ?)',
          [adminId, perm]
        );
      }

      return {
        user_id:     Number(adminId),
        name,
        email,
        mobile,
        role:        'ADMIN',
        status:      'ACTIVE',
        permissions: uniquePermissions
      };
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY' || err.message?.includes('Duplicate entry')) {
      throw new HttpError(409, 'CONFLICT', 'Email is already registered');
    }
    throw err;
  }

  await logAction(ctx, 'ADMIN_CREATED', `Created admin ${email} (id: ${newAdmin.user_id})`);

  return {
    status: 201,
    data: newAdmin,
    message: 'Admin created successfully'
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. PUT /api/superadmin/admins/:id
// ─────────────────────────────────────────────────────────────────────────────

async function updateAdmin(ctx) {
  const adminId = parseAdminId(ctx.params.id);
  const body = ctx.body || {};

  const rows = await ctx.db.query(
    'SELECT user_id, name, email, mobile, role, status, created_at FROM users WHERE user_id = ?',
    [adminId]
  );

  if (!rows.length) {
    throw new HttpError(404, 'NOT_FOUND', 'Admin user not found');
  }

  const target = rows[0];

  if (target.role === 'SUPER_ADMIN') {
    throw new HttpError(403, 'FORBIDDEN', 'Cannot modify SUPER_ADMIN via admin endpoints');
  }

  if (target.role !== 'ADMIN') {
    throw new HttpError(403, 'FORBIDDEN', 'Only ADMIN accounts can be updated');
  }

  const details = {};
  let newName = target.name;
  let newMobile = target.mobile;

  if ('name' in body) {
    const val = typeof body.name === 'string' ? body.name.trim() : '';
    if (!val || val.length < 2 || val.length > 100) {
      details.name = 'name must be between 2 and 100 characters';
    } else {
      newName = val;
    }
  }

  if ('mobile' in body) {
    const val = typeof body.mobile === 'string' ? body.mobile.trim() : '';
    if (!val || !/^\d{10}$/.test(val)) {
      details.mobile = 'mobile must be exactly 10 digits';
    } else {
      newMobile = val;
    }
  }

  if (Object.keys(details).length > 0) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Validation failed', details);
  }

  await ctx.db.query(
    'UPDATE users SET name = ?, mobile = ? WHERE user_id = ?',
    [newName, newMobile, adminId]
  );

  await logAction(ctx, 'ADMIN_UPDATED', `Updated admin ${target.email} (id: ${adminId})`);

  const permRows = await ctx.db.query(
    'SELECT permission_name FROM admin_permissions WHERE admin_id = ?',
    [adminId]
  );

  return {
    data: {
      user_id:     Number(adminId),
      name:        newName,
      email:       target.email,
      mobile:      newMobile,
      role:        target.role,
      status:      target.status,
      created_at:  target.created_at instanceof Date ? target.created_at.toISOString() : String(target.created_at),
      permissions: permRows.map((r) => r.permission_name)
    },
    message: 'Admin updated successfully'
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. PATCH /api/superadmin/admins/:id/status
// ─────────────────────────────────────────────────────────────────────────────

async function updateAdminStatus(ctx) {
  const adminId = parseAdminId(ctx.params.id);
  const status = typeof ctx.body?.status === 'string' ? ctx.body.status.trim().toUpperCase() : '';

  if (!['ACTIVE', 'INACTIVE'].includes(status)) {
    throw new HttpError(400, 'VALIDATION_ERROR', "status must be 'ACTIVE' or 'INACTIVE'", {
      status: "status must be 'ACTIVE' or 'INACTIVE'"
    });
  }

  const rows = await ctx.db.query(
    'SELECT user_id, email, role, status FROM users WHERE user_id = ?',
    [adminId]
  );

  if (!rows.length) {
    throw new HttpError(404, 'NOT_FOUND', 'Admin user not found');
  }

  const target = rows[0];

  if (target.role === 'SUPER_ADMIN') {
    throw new HttpError(403, 'FORBIDDEN', 'Cannot modify status of SUPER_ADMIN');
  }

  if (target.role !== 'ADMIN') {
    throw new HttpError(403, 'FORBIDDEN', 'Only ADMIN accounts can be modified');
  }

  await ctx.db.query('UPDATE users SET status = ? WHERE user_id = ?', [status, adminId]);

  await logAction(
    ctx,
    'ADMIN_STATUS_CHANGED',
    `Admin ${target.email} status changed from ${target.status} to ${status}`
  );

  return {
    data: {
      user_id:         Number(adminId),
      status,
      previous_status: target.status
    },
    message: `Admin status changed to ${status}`
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. DELETE /api/superadmin/admins/:id
// ─────────────────────────────────────────────────────────────────────────────

async function deleteAdmin(ctx) {
  const adminId = parseAdminId(ctx.params.id);

  const rows = await ctx.db.query(
    'SELECT user_id, email, role FROM users WHERE user_id = ?',
    [adminId]
  );

  if (!rows.length) {
    throw new HttpError(404, 'NOT_FOUND', 'Admin user not found');
  }

  const target = rows[0];

  if (target.role === 'SUPER_ADMIN') {
    throw new HttpError(403, 'FORBIDDEN', 'Cannot delete SUPER_ADMIN accounts');
  }

  if (target.role !== 'ADMIN') {
    throw new HttpError(403, 'FORBIDDEN', 'Only ADMIN accounts can be deleted');
  }

  // Delete user (admin_permissions rows are deleted via ON DELETE CASCADE)
  await ctx.db.query('DELETE FROM users WHERE user_id = ?', [adminId]);

  await logAction(ctx, 'ADMIN_DELETED', `Deleted admin ${target.email} (id: ${adminId})`);

  return {
    data: {
      user_id: Number(adminId)
    },
    message: 'Admin deleted successfully'
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. GET /api/superadmin/permissions
// ─────────────────────────────────────────────────────────────────────────────

async function listPermissions() {
  const perms = [...ALLOWED_PERMISSIONS];
  Object.defineProperty(perms, 'permissions', { value: perms, enumerable: false });
  return {
    data: perms
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. GET /api/superadmin/admins/:id/permissions
// ─────────────────────────────────────────────────────────────────────────────

async function getAdminPermissions(ctx) {
  const adminId = parseAdminId(ctx.params.id);

  const rows = await ctx.db.query(
    'SELECT user_id, email, role FROM users WHERE user_id = ?',
    [adminId]
  );

  if (!rows.length) {
    throw new HttpError(404, 'NOT_FOUND', 'Admin user not found');
  }

  const target = rows[0];

  if (target.role === 'SUPER_ADMIN') {
    throw new HttpError(403, 'FORBIDDEN', 'Cannot inspect permissions of SUPER_ADMIN');
  }

  if (target.role !== 'ADMIN') {
    throw new HttpError(403, 'FORBIDDEN', 'Only ADMIN permissions can be inspected');
  }

  const permRows = await ctx.db.query(
    'SELECT permission_name FROM admin_permissions WHERE admin_id = ? ORDER BY permission_id ASC',
    [adminId]
  );

  const permissions = permRows.map((r) => r.permission_name);
  Object.defineProperty(permissions, 'permissions', { value: permissions, enumerable: false });
  Object.defineProperty(permissions, 'admin_id', { value: Number(adminId), enumerable: false });

  return {
    data: permissions
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. PUT /api/superadmin/admins/:id/permissions
// ─────────────────────────────────────────────────────────────────────────────

async function replaceAdminPermissions(ctx) {
  const adminId = parseAdminId(ctx.params.id);

  const rows = await ctx.db.query(
    'SELECT user_id, email, role FROM users WHERE user_id = ?',
    [adminId]
  );

  if (!rows.length) {
    throw new HttpError(404, 'NOT_FOUND', 'Admin user not found');
  }

  const target = rows[0];

  if (target.role === 'SUPER_ADMIN') {
    throw new HttpError(403, 'FORBIDDEN', 'Target must be an ADMIN, never a SUPER_ADMIN');
  }

  if (target.role !== 'ADMIN') {
    throw new HttpError(403, 'FORBIDDEN', 'Target must be an ADMIN');
  }

  // Accept body: { permissions: [...] } or raw array directly
  const permsInput = Array.isArray(ctx.body)
    ? ctx.body
    : (Array.isArray(ctx.body?.permissions) ? ctx.body.permissions : null);

  if (permsInput === null) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'permissions array is required', {
      permissions: 'permissions must be an array'
    });
  }

  for (const p of permsInput) {
    if (typeof p !== 'string' || !ALLOWED_PERMISSIONS.includes(p)) {
      throw new HttpError(400, 'VALIDATION_ERROR', `Invalid permission: ${p}`, {
        permissions: `Invalid permission: ${p}. Must be one of: ${ALLOWED_PERMISSIONS.join(', ')}`
      });
    }
  }

  const uniquePermissions = Array.from(new Set(permsInput));

  // Replace permissions in one transaction
  await ctx.db.transaction(async (tx) => {
    await tx.query('DELETE FROM admin_permissions WHERE admin_id = ?', [adminId]);
    for (const perm of uniquePermissions) {
      await tx.query(
        'INSERT INTO admin_permissions (admin_id, permission_name) VALUES (?, ?)',
        [adminId, perm]
      );
    }
  });

  await logAction(
    ctx,
    'PERMISSIONS_CHANGED',
    `Permissions updated for admin ${target.email} (id: ${adminId}): [${uniquePermissions.join(', ')}]`
  );

  Object.defineProperty(uniquePermissions, 'permissions', { value: uniquePermissions, enumerable: false });
  Object.defineProperty(uniquePermissions, 'admin_id', { value: Number(adminId), enumerable: false });

  return {
    data: uniquePermissions,
    message: 'Admin permissions updated successfully'
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. GET /api/superadmin/stats
// ─────────────────────────────────────────────────────────────────────────────

async function getSuperadminStats(ctx) {
  const userResult = await ctx.db.query(
    `SELECT
       COUNT(*) AS users_total,
       COUNT(CASE WHEN role = 'ADMIN' THEN 1 END) AS admins_total,
       COUNT(CASE WHEN role = 'ADMIN' AND status = 'ACTIVE' THEN 1 END) AS admins_active
     FROM users`
  );
  const userStats = Array.isArray(userResult) ? userResult[0] : userResult;

  const logResult = await ctx.db.query(
    `SELECT COUNT(*) AS logs_today
     FROM system_logs
     WHERE DATE(created_at) = CURRENT_DATE()`
  );
  const logStats = Array.isArray(logResult) ? logResult[0] : logResult;

  const stats = {
    admins_total:  Number(userStats?.admins_total ?? 0),
    admins_active: Number(userStats?.admins_active ?? 0),
    users_total:   Number(userStats?.users_total ?? 0),
    logs_today:    Number(logStats?.logs_today ?? userStats?.logs_today ?? 0)
  };

  return {
    data: stats,
    admins_total:  stats.admins_total,
    admins_active: stats.admins_active,
    users_total:   stats.users_total,
    logs_today:    stats.logs_today
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Route Table — All restricted strictly to SUPER_ADMIN
// ─────────────────────────────────────────────────────────────────────────────

module.exports = [
  {
    method:  'GET',
    path:    '/api/superadmin/admins',
    roles:   ['SUPER_ADMIN'],
    handler: listAdmins
  },
  {
    method:  'POST',
    path:    '/api/superadmin/admins',
    roles:   ['SUPER_ADMIN'],
    handler: createAdmin
  },
  {
    method:  'PUT',
    path:    '/api/superadmin/admins/:id',
    roles:   ['SUPER_ADMIN'],
    handler: updateAdmin
  },
  {
    method:  'PATCH',
    path:    '/api/superadmin/admins/:id/status',
    roles:   ['SUPER_ADMIN'],
    handler: updateAdminStatus
  },
  {
    method:  'DELETE',
    path:    '/api/superadmin/admins/:id',
    roles:   ['SUPER_ADMIN'],
    handler: deleteAdmin
  },
  {
    method:  'GET',
    path:    '/api/superadmin/permissions',
    roles:   ['SUPER_ADMIN'],
    handler: listPermissions
  },
  {
    method:  'GET',
    path:    '/api/superadmin/admins/:id/permissions',
    roles:   ['SUPER_ADMIN'],
    handler: getAdminPermissions
  },
  {
    method:  'PUT',
    path:    '/api/superadmin/admins/:id/permissions',
    roles:   ['SUPER_ADMIN'],
    handler: replaceAdminPermissions
  },
  {
    method:  'GET',
    path:    '/api/superadmin/stats',
    roles:   ['SUPER_ADMIN'],
    handler: getSuperadminStats
  }
];

