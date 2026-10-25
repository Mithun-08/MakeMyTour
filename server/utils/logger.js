/**
 * server/utils/logger.js  — Owner: M1
 *
 * logAction(ctx, action, description)
 *   Inserts a row into system_logs. Never throws. Truncates description to 500 chars.
 *
 * Valid action values (for documentation; DB does not enforce an enum):
 *   REGISTER, LOGIN, LOGOUT,
 *   USER_STATUS_CHANGED,
 *   PACKAGE_CREATED, PACKAGE_UPDATED, PACKAGE_DELETED, PACKAGE_MODERATED,
 *   DESTINATION_CREATED, DESTINATION_UPDATED, DESTINATION_DELETED,
 *   CATEGORY_CREATED, CATEGORY_UPDATED, CATEGORY_DELETED,
 *   BOOKING_CREATED, BOOKING_CANCELLED, BOOKING_STATUS_CHANGED,
 *   PAYMENT_MADE, REVIEW_ADDED,
 *   ADMIN_CREATED, ADMIN_UPDATED, ADMIN_DELETED,
 *   PERMISSIONS_CHANGED, SETTINGS_CHANGED
 */

const MAX_DESCRIPTION = 500;

async function logAction(ctx, action, description) {
  try {
    const userId = (ctx.user && ctx.user.user_id) ? ctx.user.user_id : null;
    const ip = ctx.ip || null;
    const truncated = typeof description === 'string'
      ? description.slice(0, MAX_DESCRIPTION)
      : String(description || '').slice(0, MAX_DESCRIPTION);

    await ctx.db.query(
      'INSERT INTO system_logs (user_id, action, description, ip_address) VALUES (?, ?, ?, ?)',
      [userId, String(action).slice(0, 60), truncated, ip]
    );
  } catch (err) {
    // Never throw — logging failures must not break API responses
    console.error('[logger] Failed to write system log:', err.message);
  }
}

module.exports = { logAction };
