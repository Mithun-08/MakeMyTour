/**
 * server/utils/session.js  — Owner: M1
 *
 * Server-side in-memory session store backed by a Map.
 * A server restart logs everyone out (documented, accepted per CONTRACT §1.5).
 *
 * Cookie: mmt_sid; HttpOnly; SameSite=Lax; Path=/; Max-Age=7200
 *
 * Exported API:
 *   createSession(userId)        → token string
 *   getSession(token)            → { user_id } or null (handles expiry)
 *   deleteSession(token)         → void
 *   SESSION_COOKIE_NAME          constant 'mmt_sid'
 *   SESSION_MAX_AGE_SECONDS      constant
 */

const crypto = require('crypto');
const config = require('../config');

const SESSION_COOKIE_NAME = 'mmt_sid';
const SESSION_MAX_AGE_SECONDS = config.SESSION_TTL_MINUTES * 60;

/** @type {Map<string, { user_id: number, expires: number }>} */
const sessions = new Map();

// Periodically prune expired sessions to avoid unbounded memory growth
const PRUNE_INTERVAL_MS = 15 * 60 * 1000; // every 15 minutes
const pruneTimer = setInterval(() => {
  const now = Date.now();
  for (const [token, data] of sessions) {
    if (data.expires <= now) {
      sessions.delete(token);
    }
  }
}, PRUNE_INTERVAL_MS);
pruneTimer.unref(); // Don't keep the process alive just for pruning

/**
 * Creates a new session token for the given user and stores it.
 * @param {number} userId
 * @returns {string} 64-char hex token
 */
function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
  sessions.set(token, { user_id: userId, expires });
  return token;
}

/**
 * Retrieves a valid (non-expired) session by token.
 * @param {string} token
 * @returns {{ user_id: number } | null}
 */
function getSession(token) {
  if (typeof token !== 'string' || token.length === 0) return null;
  const data = sessions.get(token);
  if (!data) return null;
  if (Date.now() > data.expires) {
    sessions.delete(token);
    return null;
  }
  return { user_id: data.user_id };
}

/**
 * Deletes a session (logout).
 * @param {string} token
 */
function deleteSession(token) {
  if (typeof token === 'string') {
    sessions.delete(token);
  }
}

module.exports = {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  createSession,
  getSession,
  deleteSession
};
