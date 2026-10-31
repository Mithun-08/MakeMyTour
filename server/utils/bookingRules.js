/**
 * bookingRules.js — Pure business-rule functions for MakeMyTour bookings.
 *
 * All functions are pure: no I/O, no database access, no HTTP, no session
 * references. They can be imported by route handlers and unit tests alike.
 *
 * Rules are derived exclusively from docs/CONTRACT.md (booking section) and
 * database/schema.sql. Any rule that was unclear is noted inline.
 *
 * Owned by M3 (booking seed data & verification). Do not modify M1/M2 files.
 */

'use strict';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse a date value (Date object, ISO string 'YYYY-MM-DD', or anything
 * accepted by new Date()) into a UTC midnight timestamp (integer ms).
 * Using Date.UTC avoids local-timezone / DST drift when comparing DATE-only
 * values stored in MySQL.
 *
 * @param {string|Date} value
 * @returns {number} UTC midnight ms
 */
function toUtcMidnight(value) {
  const d = value instanceof Date ? value : new Date(value);
  // Use the UTC date parts so a '2025-06-01' string always resolves to the
  // same instant regardless of the server's local timezone.
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Return the difference in whole calendar days between two date values.
 * Positive when futureDateStr is after baseDateStr.
 *
 * @param {string|Date} baseDateStr   — typically "today"
 * @param {string|Date} futureDateStr — the travel / available date
 * @returns {number} integer days (may be negative if past)
 */
function dateDiffDays(baseDateStr, futureDateStr) {
  const base = toUtcMidnight(baseDateStr);
  const future = toUtcMidnight(futureDateStr);
  return Math.round((future - base) / (1000 * 60 * 60 * 24));
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Compute the booking total amount.
 *
 * CONTRACT: total_amount = price × travelers  (DECIMAL arithmetic in the DB;
 * this function returns a JS Number rounded to 2 decimal places).
 *
 * Because db.js uses { decimalNumbers: false }, MySQL DECIMAL columns arrive
 * as strings (e.g. "8500.00"). This function accepts string or number price.
 *
 * @param {string|number} price     — package price per person
 * @param {number}        travelers — positive integer
 * @returns {number} total amount rounded to 2 decimal places
 */
function computeTotalAmount(price, travelers) {
  const p = parseFloat(price);
  if (!Number.isFinite(p)) throw new TypeError('price must be a finite number or numeric string');
  if (!Number.isInteger(travelers) || travelers < 1)
    throw new TypeError('travelers must be a positive integer');
  // Round to 2 dp to match DECIMAL(10,2) storage.
  return Math.round(p * travelers * 100) / 100;
}

/**
 * Determine whether a customer is eligible to cancel a booking.
 *
 * CONTRACT (POST /api/bookings/:id/cancel):
 *   Eligible if booking_status is 'PENDING' or 'CONFIRMED'
 *   AND the travel date is at least `windowDays` calendar days away from today.
 *
 * "At least N days away" is interpreted as dateDiffDays(today, availableDate) >= N.
 * The comparison uses UTC midnight to avoid DST / timezone drift.
 *
 * @param {{ booking_status: string }} booking
 * @param {string|Date} availableDateStr — available_date from package_availability
 * @param {number}      windowDays       — cancellation_window_days from system_settings
 * @param {string|Date} [today]          — override for today (useful in tests); defaults to new Date()
 * @returns {{ ok: boolean, reason: string|null }}
 */
function canCustomerCancel(booking, availableDateStr, windowDays, today = new Date()) {
  const cancellableStatuses = ['PENDING', 'CONFIRMED'];
  if (!cancellableStatuses.includes(booking.booking_status)) {
    return {
      ok: false,
      reason: `Booking status '${booking.booking_status}' is not eligible for cancellation.`,
    };
  }
  const daysUntilTravel = dateDiffDays(today, availableDateStr);
  if (daysUntilTravel < windowDays) {
    return {
      ok: false,
      reason:
        `Cancellation window has passed. Travel date is ${daysUntilTravel} day(s) away; ` +
        `minimum required is ${windowDays} day(s).`,
    };
  }
  return { ok: true, reason: null };
}

/**
 * Validate a provider/admin booking-status transition.
 *
 * CONTRACT (PATCH /api/bookings/:id/status) allowed transitions:
 *   PENDING    → CONFIRMED   (always)
 *   PENDING    → CANCELLED   (always)
 *   CONFIRMED  → CANCELLED   (always)
 *   CONFIRMED  → COMPLETED   (only when travel date is today or in the past)
 *
 * All other transitions (including from COMPLETED or CANCELLED) are invalid.
 *
 * @param {string}      fromStatus       — current booking_status
 * @param {string}      toStatus         — requested booking_status
 * @param {string|Date} availableDateStr — travel date (for CONFIRMED→COMPLETED check)
 * @param {string|Date} [today]          — override for today (useful in tests)
 * @returns {{ ok: boolean, reason: string|null }}
 */
function validateProviderStatusTransition(fromStatus, toStatus, availableDateStr, today = new Date()) {
  // Terminal statuses — no further transitions allowed.
  if (fromStatus === 'COMPLETED') {
    return { ok: false, reason: "A COMPLETED booking cannot be changed." };
  }
  if (fromStatus === 'CANCELLED') {
    return { ok: false, reason: "A CANCELLED booking cannot be changed." };
  }

  if (fromStatus === 'PENDING') {
    if (toStatus === 'CONFIRMED') return { ok: true, reason: null };
    if (toStatus === 'CANCELLED') return { ok: true, reason: null };
    return {
      ok: false,
      reason: `Transition PENDING → ${toStatus} is not permitted. Allowed: CONFIRMED, CANCELLED.`,
    };
  }

  if (fromStatus === 'CONFIRMED') {
    if (toStatus === 'CANCELLED') return { ok: true, reason: null };
    if (toStatus === 'COMPLETED') {
      // Only allowed when travel date is today or in the past.
      const daysUntilTravel = dateDiffDays(today, availableDateStr);
      if (daysUntilTravel <= 0) return { ok: true, reason: null };
      return {
        ok: false,
        reason:
          `Booking can only be marked COMPLETED on or after the travel date. ` +
          `Travel date is still ${daysUntilTravel} day(s) away.`,
      };
    }
    return {
      ok: false,
      reason: `Transition CONFIRMED → ${toStatus} is not permitted. Allowed: CANCELLED, COMPLETED.`,
    };
  }

  // Unknown fromStatus
  return { ok: false, reason: `Unknown booking status '${fromStatus}'.` };
}

/**
 * Determine the new availability status after decrementing seats.
 *
 * CONTRACT: if seats_available reaches 0 after a booking, set status = 'FULL'.
 *
 * @param {number} seatsAfter — seats_available value after decrement (>= 0)
 * @returns {'OPEN'|'FULL'}
 */
function seatStatusAfterDecrement(seatsAfter) {
  return seatsAfter === 0 ? 'FULL' : 'OPEN';
}

/**
 * Determine the new availability status after restoring seats on cancellation.
 *
 * CONTRACT: "Restores seats (re-opens FULL → OPEN)."
 * The parenthetical means: if the availability was FULL it becomes OPEN.
 * CLOSED slots are not mentioned — they remain CLOSED (no implicit re-open).
 * A slot already OPEN stays OPEN.
 *
 * @param {string} currentStatus — current package_availability.status
 * @returns {'OPEN'|'CLOSED'|'FULL'}
 */
function seatStatusAfterRestore(currentStatus) {
  if (currentStatus === 'FULL') return 'OPEN';
  // OPEN → stays OPEN; CLOSED → stays CLOSED (contract is silent on CLOSED).
  return currentStatus;
}

/**
 * Determine whether a customer can submit a review for a booking.
 *
 * CONTRACT (POST /api/reviews):
 *   Only on own COMPLETED booking; one review per booking (UNIQUE constraint).
 *
 * @param {{ booking_status: string }} booking
 * @param {boolean} hasExistingReview — true if a review row already exists for this booking
 * @returns {boolean}
 */
function canReview(booking, hasExistingReview) {
  return booking.booking_status === 'COMPLETED' && !hasExistingReview;
}

/**
 * Convenience wrapper used when building GET /api/bookings/mine rows.
 * Returns the can_cancel boolean flag directly.
 *
 * CONTRACT: can_cancel is true if booking_status is PENDING or CONFIRMED AND
 * travel date >= cancellation_window_days away.
 *
 * @param {{ booking_status: string }} booking
 * @param {string|Date} availableDateStr
 * @param {number}      windowDays
 * @param {string|Date} [today]
 * @returns {boolean}
 */
function canCancel(booking, availableDateStr, windowDays, today = new Date()) {
  return canCustomerCancel(booking, availableDateStr, windowDays, today).ok;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  computeTotalAmount,
  canCustomerCancel,
  validateProviderStatusTransition,
  seatStatusAfterDecrement,
  seatStatusAfterRestore,
  canReview,
  canCancel,
  // Exported for tests only — not part of the public route-handler API.
  _dateDiffDays: dateDiffDays,
};
