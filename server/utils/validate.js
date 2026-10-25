/**
 * server/utils/validate.js  — Owner: M1
 *
 * validate(body, rules) → cleaned object | throws HttpError 400 VALIDATION_ERROR
 *
 * Rule options:
 *   required  {boolean}
 *   type      'string' | 'email' | 'mobile' | 'int' | 'number' | 'date' | 'enum' | 'array'
 *   min       for string: min length; for int/number: min value
 *   max       for string: max length; for int/number: max value
 *   values    array of allowed values (used by 'enum')
 *
 * Unknown fields in body are dropped (not passed through).
 */

const { HttpError } = require('./http');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_RE = /^\d{10}$/;
const DATE_RE   = /^\d{4}-\d{2}-\d{2}$/;

function validate(body, rules) {
  const details = {};
  const cleaned = {};

  if (!body || typeof body !== 'object') {
    throw new HttpError(400, 'BAD_REQUEST', 'Request body must be a JSON object');
  }

  for (const [field, rule] of Object.entries(rules)) {
    const raw = body[field];
    const missing = raw === undefined || raw === null || raw === '';

    if (missing) {
      if (rule.required) {
        details[field] = `${field} is required`;
      }
      // Leave field absent from cleaned; do not include undefined keys
      continue;
    }

    let value = raw;

    switch (rule.type) {
      case 'string': {
        if (typeof value !== 'string') {
          details[field] = `${field} must be a string`;
          continue;
        }
        value = value.trim();
        if (rule.min !== undefined && value.length < rule.min) {
          details[field] = `${field} must be at least ${rule.min} character(s)`;
          continue;
        }
        if (rule.max !== undefined && value.length > rule.max) {
          details[field] = `${field} must be at most ${rule.max} character(s)`;
          continue;
        }
        break;
      }
      case 'email': {
        if (typeof value !== 'string') {
          details[field] = `${field} must be a string`;
          continue;
        }
        value = value.trim().toLowerCase();
        if (!EMAIL_RE.test(value)) {
          details[field] = `${field} must be a valid email address`;
          continue;
        }
        if (rule.max !== undefined && value.length > rule.max) {
          details[field] = `${field} must be at most ${rule.max} character(s)`;
          continue;
        }
        break;
      }
      case 'mobile': {
        if (typeof value !== 'string' && typeof value !== 'number') {
          details[field] = `${field} must be exactly 10 digits`;
          continue;
        }
        value = String(value).trim();
        if (!MOBILE_RE.test(value)) {
          details[field] = `${field} must be exactly 10 digits`;
          continue;
        }
        break;
      }
      case 'int': {
        const parsed = parseInt(value, 10);
        if (isNaN(parsed) || String(parsed) !== String(value) && Number(value) !== parsed) {
          details[field] = `${field} must be an integer`;
          continue;
        }
        value = parsed;
        if (rule.min !== undefined && value < rule.min) {
          details[field] = `${field} must be at least ${rule.min}`;
          continue;
        }
        if (rule.max !== undefined && value > rule.max) {
          details[field] = `${field} must be at most ${rule.max}`;
          continue;
        }
        break;
      }
      case 'number': {
        const parsed = Number(value);
        if (isNaN(parsed)) {
          details[field] = `${field} must be a number`;
          continue;
        }
        value = parsed;
        if (rule.min !== undefined && value < rule.min) {
          details[field] = `${field} must be at least ${rule.min}`;
          continue;
        }
        if (rule.max !== undefined && value > rule.max) {
          details[field] = `${field} must be at most ${rule.max}`;
          continue;
        }
        break;
      }
      case 'date': {
        if (typeof value !== 'string' || !DATE_RE.test(value.trim())) {
          details[field] = `${field} must be a date in YYYY-MM-DD format`;
          continue;
        }
        value = value.trim();
        const d = new Date(value);
        if (isNaN(d.getTime())) {
          details[field] = `${field} is not a valid date`;
          continue;
        }
        break;
      }
      case 'enum': {
        if (!Array.isArray(rule.values) || rule.values.length === 0) {
          throw new Error(`Rule for "${field}": enum type requires a non-empty 'values' array`);
        }
        if (typeof value === 'string') {
          value = value.trim();
        }
        if (!rule.values.includes(value)) {
          details[field] = `${field} must be one of: ${rule.values.join(', ')}`;
          continue;
        }
        break;
      }
      case 'array': {
        if (!Array.isArray(value)) {
          details[field] = `${field} must be an array`;
          continue;
        }
        if (rule.min !== undefined && value.length < rule.min) {
          details[field] = `${field} must have at least ${rule.min} item(s)`;
          continue;
        }
        if (rule.max !== undefined && value.length > rule.max) {
          details[field] = `${field} must have at most ${rule.max} item(s)`;
          continue;
        }
        break;
      }
      default:
        // No type restriction; copy value as-is
        break;
    }

    cleaned[field] = value;
  }

  if (Object.keys(details).length > 0) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Validation failed', details);
  }

  return cleaned;
}

module.exports = validate;
