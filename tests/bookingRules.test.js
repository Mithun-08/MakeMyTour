/**
 * bookingRules.test.js — Unit tests for server/utils/bookingRules.js
 *
 * Uses Node's built-in test runner (node:test + node:assert/strict).
 * All tests run fully offline — no database, no HTTP, no sessions.
 *
 * Run with:  npm test   (or: node --test tests/bookingRules.test.js)
 *
 * Rules verified against docs/CONTRACT.md and database/schema.sql.
 * M3-owned file. Do not modify M1/M2 files.
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  computeTotalAmount,
  canCustomerCancel,
  validateProviderStatusTransition,
  seatStatusAfterDecrement,
  seatStatusAfterRestore,
  canReview,
  canCancel,
  _dateDiffDays,
} = require('../server/utils/bookingRules');

// ---------------------------------------------------------------------------
// Helper — build a minimal booking object for test brevity
// ---------------------------------------------------------------------------
function booking(status) {
  return { booking_status: status };
}

// Fixed "today" used throughout so tests are date-independent.
// '2025-06-10' is the canonical test baseline.
const TODAY = '2025-06-10';

// ---------------------------------------------------------------------------
// _dateDiffDays  (internal helper exposed for testing)
// ---------------------------------------------------------------------------
describe('_dateDiffDays', () => {
  it('returns 0 for the same date', () => {
    assert.equal(_dateDiffDays('2025-06-10', '2025-06-10'), 0);
  });

  it('returns positive when future date is after base', () => {
    assert.equal(_dateDiffDays('2025-06-10', '2025-06-12'), 2);
  });

  it('returns negative when future date is before base (past travel date)', () => {
    assert.equal(_dateDiffDays('2025-06-10', '2025-06-08'), -2);
  });

  it('handles month boundaries correctly', () => {
    assert.equal(_dateDiffDays('2025-05-31', '2025-06-01'), 1);
  });

  it('handles year boundaries correctly', () => {
    assert.equal(_dateDiffDays('2024-12-31', '2025-01-01'), 1);
  });
});

// ---------------------------------------------------------------------------
// computeTotalAmount
// ---------------------------------------------------------------------------
describe('computeTotalAmount', () => {
  it('computes integer price × travelers', () => {
    assert.equal(computeTotalAmount(1000, 2), 2000);
  });

  it('computes decimal price (number) × travelers', () => {
    assert.equal(computeTotalAmount(1234.5, 3), 3703.5);
  });

  it('accepts price as a string (as MySQL DECIMAL arrives via db.js)', () => {
    // db.js uses { decimalNumbers: false } — DECIMAL columns arrive as strings.
    assert.equal(computeTotalAmount('8500.00', 1), 8500);
    assert.equal(computeTotalAmount('8500.00', 3), 25500);
  });

  it('rounds to 2 decimal places', () => {
    // 99.99 × 3 = 299.97 exactly — no rounding needed but verify no float drift.
    assert.equal(computeTotalAmount('99.99', 3), 299.97);
  });

  it('handles travelers = 1 (minimum)', () => {
    assert.equal(computeTotalAmount(5000, 1), 5000);
  });

  it('handles large traveler count (max_travelers_per_booking default is 10)', () => {
    assert.equal(computeTotalAmount(2000, 10), 20000);
  });

  it('throws TypeError for non-numeric price', () => {
    assert.throws(() => computeTotalAmount('abc', 2), TypeError);
  });

  it('throws TypeError for travelers = 0', () => {
    assert.throws(() => computeTotalAmount(1000, 0), TypeError);
  });

  it('throws TypeError for fractional travelers', () => {
    assert.throws(() => computeTotalAmount(1000, 1.5), TypeError);
  });

  it('throws TypeError for negative travelers', () => {
    assert.throws(() => computeTotalAmount(1000, -1), TypeError);
  });
});

// ---------------------------------------------------------------------------
// canCustomerCancel
// ---------------------------------------------------------------------------
describe('canCustomerCancel', () => {
  // Window = 2 days (system_settings default per database/setup.js).
  const WIN = 2;

  // --- Eligible statuses (PENDING, CONFIRMED) ---

  describe('PENDING booking', () => {
    it('is cancellable when travel date is exactly windowDays away', () => {
      // 2025-06-12 is 2 days after TODAY — boundary case
      const result = canCustomerCancel(booking('PENDING'), '2025-06-12', WIN, TODAY);
      assert.equal(result.ok, true);
      assert.equal(result.reason, null);
    });

    it('is cancellable when travel date is more than windowDays away', () => {
      const result = canCustomerCancel(booking('PENDING'), '2025-06-20', WIN, TODAY);
      assert.equal(result.ok, true);
    });

    it('is NOT cancellable when travel date is 1 day away (within window)', () => {
      const result = canCustomerCancel(booking('PENDING'), '2025-06-11', WIN, TODAY);
      assert.equal(result.ok, false);
      assert.ok(result.reason, 'should have a reason string');
    });

    it('is NOT cancellable when travel date is today (0 days away)', () => {
      const result = canCustomerCancel(booking('PENDING'), '2025-06-10', WIN, TODAY);
      assert.equal(result.ok, false);
    });

    it('is NOT cancellable when travel date is in the past', () => {
      const result = canCustomerCancel(booking('PENDING'), '2025-06-05', WIN, TODAY);
      assert.equal(result.ok, false);
    });
  });

  describe('CONFIRMED booking', () => {
    it('is cancellable when travel date is far enough away', () => {
      const result = canCustomerCancel(booking('CONFIRMED'), '2025-06-15', WIN, TODAY);
      assert.equal(result.ok, true);
    });

    it('is NOT cancellable within cancellation window', () => {
      const result = canCustomerCancel(booking('CONFIRMED'), '2025-06-11', WIN, TODAY);
      assert.equal(result.ok, false);
    });
  });

  // --- Ineligible statuses (COMPLETED, CANCELLED) ---

  it('returns ok=false for COMPLETED booking regardless of date', () => {
    const result = canCustomerCancel(booking('COMPLETED'), '2025-07-01', WIN, TODAY);
    assert.equal(result.ok, false);
    assert.ok(result.reason);
  });

  it('returns ok=false for CANCELLED booking regardless of date', () => {
    const result = canCustomerCancel(booking('CANCELLED'), '2025-07-01', WIN, TODAY);
    assert.equal(result.ok, false);
    assert.ok(result.reason);
  });

  // --- Window = 0 edge case ---
  it('window of 0 days: cancellable even on day-of-travel', () => {
    const result = canCustomerCancel(booking('PENDING'), '2025-06-10', 0, TODAY);
    assert.equal(result.ok, true);
  });
});

// ---------------------------------------------------------------------------
// validateProviderStatusTransition
// ---------------------------------------------------------------------------
describe('validateProviderStatusTransition', () => {
  // Travel date that is clearly in the past (for CONFIRMED → COMPLETED checks).
  const PAST_DATE = '2025-06-01';
  // Travel date that is clearly in the future.
  const FUTURE_DATE = '2025-07-01';

  describe('from PENDING', () => {
    it('PENDING → CONFIRMED is allowed', () => {
      const r = validateProviderStatusTransition('PENDING', 'CONFIRMED', FUTURE_DATE, TODAY);
      assert.equal(r.ok, true);
    });

    it('PENDING → CANCELLED is allowed', () => {
      const r = validateProviderStatusTransition('PENDING', 'CANCELLED', FUTURE_DATE, TODAY);
      assert.equal(r.ok, true);
    });

    it('PENDING → COMPLETED is NOT allowed', () => {
      const r = validateProviderStatusTransition('PENDING', 'COMPLETED', PAST_DATE, TODAY);
      assert.equal(r.ok, false);
      assert.ok(r.reason);
    });

    it('PENDING → PENDING is NOT allowed', () => {
      const r = validateProviderStatusTransition('PENDING', 'PENDING', FUTURE_DATE, TODAY);
      assert.equal(r.ok, false);
    });
  });

  describe('from CONFIRMED', () => {
    it('CONFIRMED → CANCELLED is allowed', () => {
      const r = validateProviderStatusTransition('CONFIRMED', 'CANCELLED', FUTURE_DATE, TODAY);
      assert.equal(r.ok, true);
    });

    it('CONFIRMED → COMPLETED is allowed when travel date is today', () => {
      // TODAY = '2025-06-10'; travel date = '2025-06-10' → daysUntilTravel = 0
      const r = validateProviderStatusTransition('CONFIRMED', 'COMPLETED', '2025-06-10', TODAY);
      assert.equal(r.ok, true);
    });

    it('CONFIRMED → COMPLETED is allowed when travel date is in the past', () => {
      const r = validateProviderStatusTransition('CONFIRMED', 'COMPLETED', PAST_DATE, TODAY);
      assert.equal(r.ok, true);
    });

    it('CONFIRMED → COMPLETED is NOT allowed when travel date is in the future', () => {
      const r = validateProviderStatusTransition('CONFIRMED', 'COMPLETED', FUTURE_DATE, TODAY);
      assert.equal(r.ok, false);
      assert.ok(r.reason);
    });

    it('CONFIRMED → CONFIRMED is NOT allowed', () => {
      const r = validateProviderStatusTransition('CONFIRMED', 'CONFIRMED', FUTURE_DATE, TODAY);
      assert.equal(r.ok, false);
    });

    it('CONFIRMED → PENDING is NOT allowed', () => {
      const r = validateProviderStatusTransition('CONFIRMED', 'PENDING', FUTURE_DATE, TODAY);
      assert.equal(r.ok, false);
    });
  });

  describe('from COMPLETED (terminal)', () => {
    it('COMPLETED → PENDING is NOT allowed', () => {
      const r = validateProviderStatusTransition('COMPLETED', 'PENDING', PAST_DATE, TODAY);
      assert.equal(r.ok, false);
      assert.ok(r.reason);
    });

    it('COMPLETED → CONFIRMED is NOT allowed', () => {
      const r = validateProviderStatusTransition('COMPLETED', 'CONFIRMED', PAST_DATE, TODAY);
      assert.equal(r.ok, false);
    });

    it('COMPLETED → CANCELLED is NOT allowed', () => {
      const r = validateProviderStatusTransition('COMPLETED', 'CANCELLED', PAST_DATE, TODAY);
      assert.equal(r.ok, false);
    });
  });

  describe('from CANCELLED (terminal)', () => {
    it('CANCELLED → PENDING is NOT allowed', () => {
      const r = validateProviderStatusTransition('CANCELLED', 'PENDING', FUTURE_DATE, TODAY);
      assert.equal(r.ok, false);
      assert.ok(r.reason);
    });

    it('CANCELLED → CONFIRMED is NOT allowed', () => {
      const r = validateProviderStatusTransition('CANCELLED', 'CONFIRMED', FUTURE_DATE, TODAY);
      assert.equal(r.ok, false);
    });

    it('CANCELLED → COMPLETED is NOT allowed', () => {
      const r = validateProviderStatusTransition('CANCELLED', 'COMPLETED', PAST_DATE, TODAY);
      assert.equal(r.ok, false);
    });
  });

  it('unknown fromStatus returns ok=false', () => {
    const r = validateProviderStatusTransition('UNKNOWN', 'CONFIRMED', FUTURE_DATE, TODAY);
    assert.equal(r.ok, false);
    assert.ok(r.reason);
  });
});

// ---------------------------------------------------------------------------
// seatStatusAfterDecrement
// ---------------------------------------------------------------------------
describe('seatStatusAfterDecrement', () => {
  it('returns FULL when seatsAfter = 0', () => {
    assert.equal(seatStatusAfterDecrement(0), 'FULL');
  });

  it('returns OPEN when seatsAfter = 1', () => {
    assert.equal(seatStatusAfterDecrement(1), 'OPEN');
  });

  it('returns OPEN when seatsAfter > 1', () => {
    assert.equal(seatStatusAfterDecrement(5), 'OPEN');
  });
});

// ---------------------------------------------------------------------------
// seatStatusAfterRestore
// ---------------------------------------------------------------------------
describe('seatStatusAfterRestore', () => {
  it('FULL → OPEN (contract: "re-opens FULL")', () => {
    assert.equal(seatStatusAfterRestore('FULL'), 'OPEN');
  });

  it('OPEN → OPEN (already open, stays open)', () => {
    assert.equal(seatStatusAfterRestore('OPEN'), 'OPEN');
  });

  it('CLOSED → CLOSED (contract is silent on CLOSED; do not force open)', () => {
    assert.equal(seatStatusAfterRestore('CLOSED'), 'CLOSED');
  });
});

// ---------------------------------------------------------------------------
// canReview
// ---------------------------------------------------------------------------
describe('canReview', () => {
  it('returns true for COMPLETED booking with no existing review', () => {
    assert.equal(canReview(booking('COMPLETED'), false), true);
  });

  it('returns false for COMPLETED booking that already has a review', () => {
    assert.equal(canReview(booking('COMPLETED'), true), false);
  });

  it('returns false for CONFIRMED booking (not yet completed)', () => {
    assert.equal(canReview(booking('CONFIRMED'), false), false);
  });

  it('returns false for PENDING booking', () => {
    assert.equal(canReview(booking('PENDING'), false), false);
  });

  it('returns false for CANCELLED booking', () => {
    assert.equal(canReview(booking('CANCELLED'), false), false);
  });
});

// ---------------------------------------------------------------------------
// canCancel  (convenience wrapper — mirrors canCustomerCancel.ok)
// ---------------------------------------------------------------------------
describe('canCancel', () => {
  it('returns true for eligible PENDING booking', () => {
    assert.equal(canCancel(booking('PENDING'), '2025-06-15', 2, TODAY), true);
  });

  it('returns false for ineligible COMPLETED booking', () => {
    assert.equal(canCancel(booking('COMPLETED'), '2025-07-01', 2, TODAY), false);
  });

  it('returns false when inside cancellation window', () => {
    // 2025-06-11 is only 1 day away from TODAY with window=2
    assert.equal(canCancel(booking('PENDING'), '2025-06-11', 2, TODAY), false);
  });
});
