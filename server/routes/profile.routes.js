/**
 * server/routes/profile.routes.js — Owner: M1
 *
 * Profile endpoints per CONTRACT §1.5, §1.6, §1.7:
 *
 *   GET /api/profile           — any logged in user
 *   PUT /api/profile           — any logged in user
 *   PUT /api/profile/password  — any logged in user
 *
 * Access: CUSTOMER, PROVIDER, ADMIN, SUPER_ADMIN
 * Safe user response: user_id, name, email, mobile, role, status, permissions (never password)
 * Address: first matching address row or null
 * Password change: requires current_password verification, returns 400 INVALID_CREDENTIALS if wrong
 */

'use strict';

const { HttpError } = require('../utils/http');
const validate = require('../utils/validate');
const { hashPassword, verifyPassword } = require('../utils/password');
const { logAction } = require('../utils/logger');

const ALL_AUTHENTICATED_ROLES = ['CUSTOMER', 'PROVIDER', 'ADMIN', 'SUPER_ADMIN'];

/**
 * Returns a safe user object stripping sensitive fields like password.
 */
function safeUser(row, permissions = []) {
  return {
    user_id:     row.user_id,
    name:        row.name,
    email:       row.email,
    mobile:      row.mobile,
    role:        row.role,
    status:      row.status,
    permissions: Array.isArray(permissions) ? permissions : []
  };
}

/**
 * Formats an address record into the standard public shape.
 */
function formatAddress(row) {
  if (!row) return null;
  return {
    address_id:   row.address_id,
    address_line: row.address_line !== undefined ? row.address_line : null,
    city:         row.city !== undefined ? row.city : null,
    state:        row.state !== undefined ? row.state : null,
    pincode:      row.pincode !== undefined ? row.pincode : null
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/profile
// ─────────────────────────────────────────────────────────────────────────────

async function getProfile(ctx) {
  const userId = ctx.user.user_id;

  // Load fresh user data
  const userRows = await ctx.db.query(
    'SELECT user_id, name, email, mobile, role, status FROM users WHERE user_id = ?',
    [userId]
  );
  if (!userRows.length) {
    throw new HttpError(404, 'NOT_FOUND', 'User not found');
  }

  // Load first matching address (or null)
  const addrRows = await ctx.db.query(
    'SELECT address_id, address_line, city, state, pincode FROM addresses WHERE user_id = ? ORDER BY address_id ASC LIMIT 1',
    [userId]
  );

  const address = addrRows.length > 0 ? formatAddress(addrRows[0]) : null;

  return {
    data: {
      user: safeUser(userRows[0], ctx.user.permissions),
      address
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/profile
// ─────────────────────────────────────────────────────────────────────────────

async function updateProfile(ctx) {
  const userId = ctx.user.user_id;

  // Validate incoming body. Note: email, role, status are not in rules,
  // so validate() automatically drops them to prevent tampering.
  const body = validate(ctx.body, {
    name:         { required: true,  type: 'string', min: 1, max: 100 },
    mobile:       { required: true,  type: 'mobile' },
    address_line: { required: false, type: 'string', max: 255 },
    city:         { required: false, type: 'string', max: 100 },
    state:        { required: false, type: 'string', max: 100 },
    pincode:      { required: false, type: 'string', max: 10 }
  });

  const result = await ctx.db.transaction(async (tx) => {
    // 1. Update user row
    await tx.query(
      'UPDATE users SET name = ?, mobile = ? WHERE user_id = ?',
      [body.name, body.mobile, userId]
    );

    // 2. Check for existing address
    const addrRows = await tx.query(
      'SELECT address_id, address_line, city, state, pincode FROM addresses WHERE user_id = ? ORDER BY address_id ASC LIMIT 1',
      [userId]
    );

    if (addrRows.length > 0) {
      // Update existing address — preserve existing values when fields are omitted from request
      const existing = addrRows[0];
      const addressLine = body.address_line !== undefined ? body.address_line : existing.address_line;
      const city        = body.city !== undefined ? body.city : existing.city;
      const state       = body.state !== undefined ? body.state : existing.state;
      const pincode     = body.pincode !== undefined ? body.pincode : existing.pincode;

      await tx.query(
        'UPDATE addresses SET address_line = ?, city = ?, state = ?, pincode = ? WHERE address_id = ?',
        [addressLine, city, state, pincode, existing.address_id]
      );
    } else {
      // Insert new address only if at least one address component is supplied
      const addressLine = body.address_line !== undefined ? body.address_line : null;
      const city        = body.city !== undefined ? body.city : null;
      const state       = body.state !== undefined ? body.state : null;
      const pincode     = body.pincode !== undefined ? body.pincode : null;

      const hasAnyAddressData = addressLine !== null || city !== null || state !== null || pincode !== null;
      if (hasAnyAddressData) {
        await tx.query(
          'INSERT INTO addresses (user_id, address_line, city, state, pincode) VALUES (?, ?, ?, ?, ?)',
          [userId, addressLine, city, state, pincode]
        );
      }
    }

    // 3. Retrieve updated records within the transaction
    const updatedUserRows = await tx.query(
      'SELECT user_id, name, email, mobile, role, status FROM users WHERE user_id = ?',
      [userId]
    );
    const updatedAddrRows = await tx.query(
      'SELECT address_id, address_line, city, state, pincode FROM addresses WHERE user_id = ? ORDER BY address_id ASC LIMIT 1',
      [userId]
    );

    return {
      user: safeUser(updatedUserRows[0], ctx.user.permissions),
      address: updatedAddrRows.length > 0 ? formatAddress(updatedAddrRows[0]) : null
    };
  });

  await logAction(ctx, 'PROFILE_UPDATED', `Profile updated for ${ctx.user.email}`);

  return {
    data: {
      user: result.user,
      address: result.address
    },
    message: 'Profile updated successfully'
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/profile/password
// ─────────────────────────────────────────────────────────────────────────────

async function updatePassword(ctx) {
  const userId = ctx.user.user_id;

  const body = validate(ctx.body, {
    current_password: { required: true, type: 'string', min: 1 },
    new_password:     { required: true, type: 'string', min: 8, max: 255 }
  });

  const rows = await ctx.db.query(
    'SELECT password FROM users WHERE user_id = ?',
    [userId]
  );
  if (!rows.length) {
    throw new HttpError(404, 'NOT_FOUND', 'User not found');
  }

  // Verify current password against stored hash
  const isValid = await verifyPassword(body.current_password, rows[0].password);
  if (!isValid) {
    throw new HttpError(400, 'INVALID_CREDENTIALS', 'Current password is incorrect');
  }

  // Hash new password and update
  const hashedPassword = await hashPassword(body.new_password);
  await ctx.db.query(
    'UPDATE users SET password = ? WHERE user_id = ?',
    [hashedPassword, userId]
  );

  await logAction(ctx, 'PASSWORD_CHANGED', `Password changed for ${ctx.user.email}`);

  return {
    data: null,
    message: 'Password updated successfully'
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Route table (auto-loaded by router.js)
// ─────────────────────────────────────────────────────────────────────────────

module.exports = [
  {
    method:  'GET',
    path:    '/api/profile',
    roles:   ALL_AUTHENTICATED_ROLES,
    handler: getProfile
  },
  {
    method:  'PUT',
    path:    '/api/profile',
    roles:   ALL_AUTHENTICATED_ROLES,
    handler: updateProfile
  },
  {
    method:  'PUT',
    path:    '/api/profile/password',
    roles:   ALL_AUTHENTICATED_ROLES,
    handler: updatePassword
  }
];

