const crypto = require('crypto');
const util = require('util');

const scrypt = util.promisify(crypto.scrypt);

const KEY_LENGTH = 64;
const SALT_BYTES = 16;

/**
 * Hashes a plaintext password using crypto.scrypt with a random salt.
 * @param {string} password
 * @returns {Promise<string>} Format: `${saltHex}:${derivedKeyHex}`
 */
async function hashPassword(password) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('Password must be a non-empty string');
  }
  const salt = crypto.randomBytes(SALT_BYTES).toString('hex');
  const derivedKey = await scrypt(password, salt, KEY_LENGTH);
  return `${salt}:${derivedKey.toString('hex')}`;
}

/**
 * Verifies a plaintext password against a stored scrypt hash.
 * @param {string} password
 * @param {string} storedHash Format: `${saltHex}:${derivedKeyHex}`
 * @returns {Promise<boolean>}
 */
async function verifyPassword(password, storedHash) {
  if (typeof password !== 'string' || typeof storedHash !== 'string') {
    return false;
  }
  const parts = storedHash.split(':');
  if (parts.length !== 2) {
    return false;
  }
  const [salt, expectedKeyHex] = parts;
  if (!salt || !expectedKeyHex) {
    return false;
  }

  try {
    const derivedKey = await scrypt(password, salt, KEY_LENGTH);
    const expectedKey = Buffer.from(expectedKeyHex, 'hex');
    if (derivedKey.length !== expectedKey.length) {
      return false;
    }
    return crypto.timingSafeEqual(derivedKey, expectedKey);
  } catch (err) {
    return false;
  }
}

module.exports = {
  hashPassword,
  verifyPassword
};
