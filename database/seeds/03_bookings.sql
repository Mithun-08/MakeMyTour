-- =============================================================
-- seeds/03_bookings.sql   Owner: M3
-- Booking test data: bookings, payments, reviews.
--
-- Re-runnable: uses INSERT IGNORE throughout.
-- All IDs are fixed to allow deterministic API testing.
--
-- Prerequisites (inserted by setup.js + 02_catalog.sql):
--   users     : 7 = customer1@makemytour.test (Anita Sharma)
--               8 = customer2@makemytour.test (Karthik R)
--   packages  : 1-8 APPROVED  (see 02_catalog.sql)
--   availability ids used here:
--     1  = pkg 1, CURDATE+7    (OPEN, 20 seats)
--     2  = pkg 1, CURDATE+14   (OPEN, 20 seats)
--     6  = pkg 2, CURDATE+5    (OPEN, 12 seats)
--     11 = pkg 3, CURDATE+6    (OPEN, 18 seats)
--     12 = pkg 3, CURDATE+13   (OPEN, 18 seats)
--     16 = pkg 4, CURDATE+8    (OPEN, 16 seats)
--     26 = pkg 6, CURDATE+10   (OPEN, 14 seats)
--     31 = pkg 7, CURDATE+11   (OPEN, 10 seats)
--     36 = pkg 8, CURDATE+14   (OPEN,  8 seats)
--
-- NOTE: Bookings that consume seats must be reflected back in
-- package_availability.  We patch seats_available here to match
-- the total travelers inserted, keeping the database internally
-- consistent for query tests.  The booking handler will manage
-- seats correctly for live transactions.
-- =============================================================

-- -------------------------------------------------------
-- 1. BOOKINGS  (9 rows)
--    Statuses covered:
--      PENDING    : bookings 1, 2
--      CONFIRMED  : bookings 3, 4
--      CANCELLED  : bookings 5, 6
--      COMPLETED  : bookings 7, 8, 9
-- -------------------------------------------------------

-- booking_id 1  customer 7 / pkg 1 / avail 1   PENDING / UNPAID
INSERT IGNORE INTO bookings
  (booking_id, customer_id, package_id, availability_id,
   travelers, total_amount, booking_status, payment_status)
VALUES
  (1, 7, 1, 1, 2, 17000.00, 'PENDING', 'UNPAID');

-- booking_id 2  customer 8 / pkg 2 / avail 6   PENDING / UNPAID
INSERT IGNORE INTO bookings
  (booking_id, customer_id, package_id, availability_id,
   travelers, total_amount, booking_status, payment_status)
VALUES
  (2, 8, 2, 6, 3, 15600.00, 'PENDING', 'UNPAID');

-- booking_id 3  customer 7 / pkg 4 / avail 16  CONFIRMED / PAID
INSERT IGNORE INTO bookings
  (booking_id, customer_id, package_id, availability_id,
   travelers, total_amount, booking_status, payment_status)
VALUES
  (3, 7, 4, 16, 2, 15600.00, 'CONFIRMED', 'PAID');

-- booking_id 4  customer 8 / pkg 6 / avail 26  CONFIRMED / PAID
INSERT IGNORE INTO bookings
  (booking_id, customer_id, package_id, availability_id,
   travelers, total_amount, booking_status, payment_status)
VALUES
  (4, 8, 6, 26, 2, 37000.00, 'CONFIRMED', 'PAID');

-- booking_id 5  customer 7 / pkg 3 / avail 11  CANCELLED / REFUNDED
INSERT IGNORE INTO bookings
  (booking_id, customer_id, package_id, availability_id,
   travelers, total_amount, booking_status, payment_status)
VALUES
  (5, 7, 3, 11, 1,  4200.00, 'CANCELLED', 'REFUNDED');

-- booking_id 6  customer 8 / pkg 1 / avail 2   CANCELLED / UNPAID
INSERT IGNORE INTO bookings
  (booking_id, customer_id, package_id, availability_id,
   travelers, total_amount, booking_status, payment_status)
VALUES
  (6, 8, 1, 2, 2, 17000.00, 'CANCELLED', 'UNPAID');

-- booking_id 7  customer 7 / pkg 7 / avail 31  COMPLETED / PAID
INSERT IGNORE INTO bookings
  (booking_id, customer_id, package_id, availability_id,
   travelers, total_amount, booking_status, payment_status)
VALUES
  (7, 7, 7, 31, 2, 44000.00, 'COMPLETED', 'PAID');

-- booking_id 8  customer 8 / pkg 8 / avail 36  COMPLETED / PAID
INSERT IGNORE INTO bookings
  (booking_id, customer_id, package_id, availability_id,
   travelers, total_amount, booking_status, payment_status)
VALUES
  (8, 8, 8, 36, 1, 14500.00, 'COMPLETED', 'PAID');

-- booking_id 9  customer 8 / pkg 3 / avail 12  COMPLETED / PAID
INSERT IGNORE INTO bookings
  (booking_id, customer_id, package_id, availability_id,
   travelers, total_amount, booking_status, payment_status)
VALUES
  (9, 8, 3, 12, 2,  8400.00, 'COMPLETED', 'PAID');

-- -------------------------------------------------------
-- 2. PAYMENTS  (6 rows — one per paid / refunded booking)
--    booking 3 CONFIRMED / PAID     → payment SUCCESS
--    booking 4 CONFIRMED / PAID     → payment SUCCESS
--    booking 5 CANCELLED / REFUNDED → payment REFUNDED
--    booking 7 COMPLETED / PAID     → payment SUCCESS
--    booking 8 COMPLETED / PAID     → payment SUCCESS
--    booking 9 COMPLETED / PAID     → payment SUCCESS
-- -------------------------------------------------------
INSERT IGNORE INTO payments
  (payment_id, booking_id, customer_id, amount,
   payment_method, payment_status)
VALUES
  (1, 3, 7, 15600.00, 'UPI',        'SUCCESS'),
  (2, 4, 8, 37000.00, 'CARD',       'SUCCESS'),
  (3, 5, 7,  4200.00, 'NETBANKING', 'REFUNDED'),
  (4, 7, 7, 44000.00, 'UPI',        'SUCCESS'),
  (5, 8, 8, 14500.00, 'CARD',       'SUCCESS'),
  (6, 9, 8,  8400.00, 'NETBANKING', 'SUCCESS');

-- -------------------------------------------------------
-- 3. REVIEWS  (3 rows — only on COMPLETED bookings)
--    booking 7 → review by customer 7 on package 7 (rating 5)
--    booking 8 → review by customer 8 on package 8 (rating 4)
--    booking 9 → review by customer 8 on package 3 (rating 4)
-- -------------------------------------------------------
INSERT IGNORE INTO reviews
  (review_id, booking_id, customer_id, package_id, rating, comment)
VALUES
  (1, 7, 7, 7, 5,
   'The scuba sessions were incredibly well organised. Instructor was patient and knowledgeable. Radhanagar beach snorkelling was a dream!'),
  (2, 8, 8, 8, 4,
   'Breathtaking views on the Spiti trek. The guide''s local knowledge was exceptional. High altitude was tough but totally worth it.'),
  (3, 9, 8, 3, 4,
   'Hampi exceeded all expectations. The coracle ride at sunset was magical. Wish we had one more day.');

-- -------------------------------------------------------
-- 4. SEAT CONSISTENCY PATCH
--    Reduce seats_available to reflect travelers already
--    booked into those slots (non-cancelled bookings only).
--    This keeps the availability table honest for read tests.
--
--    avail 1  : 20 seats − 2 (booking 1 PENDING)     = 18
--    avail 6  : 12 seats − 3 (booking 2 PENDING)     =  9
--    avail 16 : 16 seats − 2 (booking 3 CONFIRMED)   = 14
--    avail 26 : 14 seats − 2 (booking 4 CONFIRMED)   = 12
--    avail 31 : 10 seats − 2 (booking 7 COMPLETED)   =  8
--    avail 36 :  8 seats − 1 (booking 8 COMPLETED)   =  7
--    avail 12 :  18 seats − 2 (booking 9 COMPLETED)  = 16
--    (avail 11 : booking 5 CANCELLED → seats restored → 18  unchanged)
--    (avail 2  : booking 6 CANCELLED / UNPAID → 20 unchanged)
--
--    WARNING: These UPDATEs set ABSOLUTE seat counts, not deltas.
--    They are safe only immediately after a full db:setup (DROP +
--    recreate), where the tables start from the values inserted by
--    02_catalog.sql. Do NOT execute this file independently
--    against a live database that already contains real user
--    bookings — doing so will silently overwrite whatever seat
--    count the booking handler has maintained.
-- -------------------------------------------------------
UPDATE package_availability SET seats_available = 18 WHERE availability_id = 1;
UPDATE package_availability SET seats_available =  9 WHERE availability_id = 6;
UPDATE package_availability SET seats_available = 14 WHERE availability_id = 16;
UPDATE package_availability SET seats_available = 12 WHERE availability_id = 26;
UPDATE package_availability SET seats_available =  8 WHERE availability_id = 31;
UPDATE package_availability SET seats_available =  7 WHERE availability_id = 36;
UPDATE package_availability SET seats_available = 16 WHERE availability_id = 12;

-- End of 03_bookings.sql
