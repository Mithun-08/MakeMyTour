/**
 * server/routes/settings.routes.js — Owner: M1
 *
 * System Settings API per CONTRACT §1.5, §1.6, §1.7:
 *
 *   GET /api/settings — Public
 *     Returns site_name, cancellation_window_days, max_travelers_per_booking.
 *     Numeric settings returned as numbers.
 *
 *   PUT /api/settings — SUPER_ADMIN only
 *     Updates any of the three settings.
 *     Validates supplied keys and values; rejects unsupported keys.
 *     Upserts into system_settings table.
 *     Logs action SETTINGS_CHANGED.
 *     Returns updated settings.
 */

'use strict';

const { HttpError } = require('../utils/http');
const { logAction } = require('../utils/logger');

const DEFAULT_SETTINGS = {
  site_name: 'MakeMyTour',
  cancellation_window_days: 2,
  max_travelers_per_booking: 10
};

const ALLOWED_KEYS = ['site_name', 'cancellation_window_days', 'max_travelers_per_booking'];

/**
 * Helper to fetch settings from database and map types.
 */
async function loadCurrentSettings(db) {
  const rows = await db.query(
    'SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN (?, ?, ?)',
    ALLOWED_KEYS
  );

  const settings = { ...DEFAULT_SETTINGS };

  for (const row of rows) {
    if (row.setting_key === 'site_name') {
      settings.site_name = String(row.setting_value);
    } else if (row.setting_key === 'cancellation_window_days') {
      settings.cancellation_window_days = Number(row.setting_value);
    } else if (row.setting_key === 'max_travelers_per_booking') {
      settings.max_travelers_per_booking = Number(row.setting_value);
    }
  }

  return settings;
}

/**
 * GET /api/settings
 * Public endpoint.
 */
async function getSettings(ctx) {
  const settings = await loadCurrentSettings(ctx.db);
  return {
    data: settings
  };
}

/**
 * PUT /api/settings
 * SUPER_ADMIN only.
 */
async function updateSettings(ctx) {
  const body = ctx.body || {};
  const bodyKeys = Object.keys(body);

  if (bodyKeys.length === 0) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'At least one setting must be provided for update', {
      settings: 'At least one setting must be provided for update'
    });
  }

  // Reject unsupported settings keys
  const unsupportedKeys = bodyKeys.filter((k) => !ALLOWED_KEYS.includes(k));
  if (unsupportedKeys.length > 0) {
    throw new HttpError(400, 'VALIDATION_ERROR', `Unsupported settings key(s): ${unsupportedKeys.join(', ')}`, {
      keys: `Unsupported settings key(s): ${unsupportedKeys.join(', ')}`
    });
  }

  const details = {};
  const validated = {};

  // site_name validation: string, 2-60 characters
  if ('site_name' in body) {
    const val = body.site_name;
    if (typeof val !== 'string' || val.trim().length < 2 || val.trim().length > 60) {
      details.site_name = 'site_name must be a string between 2 and 60 characters';
    } else {
      validated.site_name = val.trim();
    }
  }

  // cancellation_window_days validation: integer, 0-30
  if ('cancellation_window_days' in body) {
    const val = body.cancellation_window_days;
    const num = Number(val);
    if (!Number.isInteger(num) || num < 0 || num > 30) {
      details.cancellation_window_days = 'cancellation_window_days must be an integer between 0 and 30';
    } else {
      validated.cancellation_window_days = num;
    }
  }

  // max_travelers_per_booking validation: integer, 1-50
  if ('max_travelers_per_booking' in body) {
    const val = body.max_travelers_per_booking;
    const num = Number(val);
    if (!Number.isInteger(num) || num < 1 || num > 50) {
      details.max_travelers_per_booking = 'max_travelers_per_booking must be an integer between 1 and 50';
    } else {
      validated.max_travelers_per_booking = num;
    }
  }

  if (Object.keys(details).length > 0) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Settings validation failed', details);
  }

  // Upsert settings in database
  const upsertSql = `
    INSERT INTO system_settings (setting_key, setting_value)
    VALUES (?, ?)
    ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)
  `;

  for (const [key, value] of Object.entries(validated)) {
    await ctx.db.query(upsertSql, [key, String(value)]);
  }

  // Log action SETTINGS_CHANGED
  const updatedKeys = Object.keys(validated).join(', ');
  await logAction(ctx, 'SETTINGS_CHANGED', `Updated system settings: ${updatedKeys}`);

  // Fetch updated settings to return
  const currentSettings = await loadCurrentSettings(ctx.db);

  return {
    data: currentSettings,
    message: 'System settings updated successfully'
  };
}

module.exports = [
  {
    method:  'GET',
    path:    '/api/settings',
    handler: getSettings
  },
  {
    method:  'PUT',
    path:    '/api/settings',
    roles:   ['SUPER_ADMIN'],
    handler: updateSettings
  }
];

