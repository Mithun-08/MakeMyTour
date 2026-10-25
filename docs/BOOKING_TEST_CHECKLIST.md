# MakeMyTour — Booking Test Checklist (M3)

> **How to use:** Run `npm run db:setup` first (drops and recreates the database, loads schema, demo users, seeds). Then execute each test manually with `curl`, a REST client (e.g. Bruno/Postman), or the browser. Record `PASS`, `FAIL`, or `BLOCKED (reason)` in the **Result** column. All API responses must match the envelope from §1.6 of `docs/CONTRACT.md`.
>
> **`Requires` column key:**
> `READY` = executable now (SQL query only, no server needed).
> Route file names (e.g. `packages.routes.js`) indicate which backend file must be implemented before the test can be run. Files not yet committed are noted as `(M1/M2/M3 — pending)`.

---

## TC-CAT — Package Listing and Catalog

| # | Endpoint / Action | Pre-condition | Expected result | Requires | Result |
|---|---|---|---|---|---|
| CAT-01 | `GET /api/packages` | No session | Returns only `APPROVED` packages (ids 1–8). Packages 9 (PENDING) and 10 (DISABLED) must not appear. | `packages.routes.js` (M2) | |
| CAT-02 | `GET /api/packages?destination_id=1` | No session | Returns packages 1 and 2 only (Munnar). | `packages.routes.js` (M2) | |
| CAT-03 | `GET /api/packages?category_id=1` | No session | Returns all APPROVED Adventure packages (ids 2, 4, 7, 8). | `packages.routes.js` (M2) | |
| CAT-04 | `GET /api/packages?min_price=10000&max_price=25000` | No session | Returns packages 6 (18500), 7 (22000), 8 (14500). | `packages.routes.js` (M2) | |
| CAT-05 | `GET /api/packages?sort=price_asc&pageSize=3` | No session | First page has the 3 cheapest APPROVED packages in ascending price order. | `packages.routes.js` (M2) | |
| CAT-06 | `GET /api/packages/:id` (id = 1) | No session | Returns full package detail including `inclusions`, `exclusions`, `itinerary` (4 days), `availability` (future OPEN dates), `provider` info, and `rating`. | `packages.routes.js` (M2) | |
| CAT-07 | `GET /api/packages/:id` (id = 9, PENDING) | No session (public) | Returns `404 NOT_FOUND` or `403 FORBIDDEN` — must not expose unapproved package. | `packages.routes.js` (M2) | |
| CAT-08 | `GET /api/packages/:id` (id = 9, PENDING) | Logged in as provider 5 (owner) | Returns full package detail (provider may see their own PENDING package). | `packages.routes.js` (M2) + `auth.routes.js` (M1) | |
| CAT-09 | `GET /api/packages/:id` (id = 10, DISABLED) | No session | Must not be visible publicly. | `packages.routes.js` (M2) | |
| CAT-10 | `GET /api/destinations` | No session | Returns all 6 ACTIVE destinations with correct `package_count` (count of APPROVED packages). | `catalog.routes.js` (M2) | |
| CAT-11 | `GET /api/categories` | No session | Returns all 5 ACTIVE categories. | `catalog.routes.js` (M2) | |
| CAT-12 | `GET /api/packages/:id/reviews` (id = 7) | No session | Returns 1 review (review_id 1, rating 5 from customer 7). | `catalog.routes.js` or `reviews.routes.js` (M2/M3) | |
| CAT-13 | `GET /api/packages/:id/reviews` (id = 3) | No session | Returns 1 review (review_id 3, rating 4 from customer 8). | `catalog.routes.js` or `reviews.routes.js` (M2/M3) | |

---

## TC-BOOK — Booking Creation and Capacity

| # | Endpoint / Action | Pre-condition | Expected result | Requires | Result |
|---|---|---|---|---|---|
| BOOK-01 | `POST /api/bookings` body `{ package_id:1, availability_id:1, travelers:2 }` | Logged in as customer 7 | `201` with `booking_id`, `total_amount=17000`, `booking_status=PENDING`, `payment_status=UNPAID`. `seats_available` for avail 1 decrements by 2. | `bookings.routes.js` (M3) + `auth.routes.js` (M1) | |
| BOOK-02 | `POST /api/bookings` body `{ package_id:1, availability_id:1, travelers:25 }` | Logged in as customer 7 | `409 CONFLICT` — travelers exceed `max_travelers_per_booking` (10) or available seats. | `bookings.routes.js` (M3) | |
| BOOK-03 | `POST /api/bookings` body `{ package_id:4, availability_id:18, travelers:1 }` | Logged in as customer 7 | `409 CONFLICT` — availability 18 is `FULL`. | `bookings.routes.js` (M3) | |
| BOOK-04 | `POST /api/bookings` body `{ package_id:1, availability_id:6, travelers:1 }` | Logged in as customer 7 | `409 CONFLICT` — avail 6 belongs to package 2, not package 1. Server must reject the mismatched pair. | `bookings.routes.js` (M3) | |
| BOOK-05 | `POST /api/bookings` body `{ package_id:9, availability_id:41, travelers:1 }` | Logged in as customer 7 | `409` or `404` — package 9 is PENDING; cannot be booked. | `bookings.routes.js` (M3) | |
| BOOK-06 | `POST /api/bookings` body `{ package_id:1, availability_id:1, travelers:1 }` | Logged in as provider 4 | `403 FORBIDDEN` — only CUSTOMER role may create bookings. | `bookings.routes.js` (M3) + `auth.routes.js` (M1) | |
| BOOK-07 | `POST /api/bookings` body `{ package_id:1, availability_id:1, travelers:1 }` | No session | `401 UNAUTHENTICATED`. | `bookings.routes.js` (M3) | |
| BOOK-08 | Concurrent test: two simultaneous POST for the last seat on avail 8 (8 seats, book 8 travelers each) | Two customer sessions | Exactly one booking succeeds; the other receives `409`. No over-booking. | `bookings.routes.js` (M3) — requires `SELECT … FOR UPDATE` transaction | |

---

## TC-CANCEL — Cancellation and Seat Restoration

| # | Endpoint / Action | Pre-condition | Expected result | Requires | Result |
|---|---|---|---|---|---|
| CAN-01 | `POST /api/bookings/1/cancel` | Logged in as customer 7, booking 1 is PENDING / UNPAID, travel ≥ cancellation_window_days ahead | `200` with `booking_status=CANCELLED`. `seats_available` for avail 1 incremented back. No payment record, so payment_status stays UNPAID. | `bookings.routes.js` (M3) | |
| CAN-02 | `POST /api/bookings/3/cancel` | Logged in as customer 7, booking 3 is CONFIRMED / PAID, travel date ≥ cancellation_window_days ahead | `200`. `booking_status=CANCELLED`, `payment_status=REFUNDED`. Payment row updated to `REFUNDED`. Seats restored. | `bookings.routes.js` (M3) | |
| CAN-03 | `POST /api/bookings/7/cancel` | Logged in as customer 7, booking 7 is COMPLETED | `409 CONFLICT` — COMPLETED bookings cannot be cancelled. | `bookings.routes.js` (M3) | |
| CAN-04 | `POST /api/bookings/3/cancel` | Logged in as customer 8 (not the owner) | `403 FORBIDDEN` — only the booking owner may cancel. | `bookings.routes.js` (M3) | |
| CAN-05 | Force travel date within cancellation window (set `cancellation_window_days=30` via settings, use booking with avail_date+7) | Logged in as customer 7 | `409 CONFLICT` — cancellation window has passed. | `bookings.routes.js` (M3) + `settings.routes.js` (M1) | |
| CAN-06 | `PATCH /api/bookings/2/status` body `{ status:'CANCELLED' }` | Logged in as provider 4 (pkg 2 belongs to provider 4) | `200`. Booking 2 cancelled. If PAID, payment refunded. Seats restored. | `bookings.routes.js` (M3) | |

---

## TC-PAY — Payment Records

| # | Endpoint / Action | Pre-condition | Expected result | Requires | Result |
|---|---|---|---|---|---|
| PAY-01 | `POST /api/bookings/1/pay` body `{ payment_method:'UPI' }` | Logged in as customer 7, booking 1 PENDING / UNPAID | `200`. Payments row inserted (`SUCCESS`). `payment_status=PAID` on booking. | `bookings.routes.js` (M3) | |
| PAY-02 | `POST /api/bookings/3/pay` body `{ payment_method:'CARD' }` | Logged in as customer 7, booking 3 already PAID | `409 CONFLICT` — already paid. | `bookings.routes.js` (M3) | |
| PAY-03 | `POST /api/bookings/5/pay` body `{ payment_method:'UPI' }` | Logged in as customer 7, booking 5 CANCELLED | `409 CONFLICT` — cannot pay a cancelled booking. | `bookings.routes.js` (M3) | |
| PAY-04 | `POST /api/bookings/1/pay` body `{ payment_method:'UPI' }` | Logged in as customer 8 (not owner) | `403 FORBIDDEN`. | `bookings.routes.js` (M3) | |
| PAY-05 | `GET /api/bookings/3` | Logged in as customer 7 | Response includes `payment` object: `payment_method=UPI`, `payment_status=SUCCESS`, `amount=15600`. | `bookings.routes.js` (M3) | |

---

## TC-REVIEW — Reviews

> **Seed state note:** `03_bookings.sql` inserts seeded reviews for bookings 7, 8, and 9.
> This affects REV-01 and REV-02 directly — see per-row pre-condition notes below.

| # | Endpoint / Action | Pre-condition | Expected result | Requires | Result |
|---|---|---|---|---|---|
| REV-01 | `POST /api/reviews` body `{ booking_id:7, rating:5, comment:'...' }` | Logged in as customer 7. **The seed already inserts review_id 1 for booking 7.** Before running this test, delete it: `DELETE FROM reviews WHERE booking_id = 7;` — then POST the review. Alternative: run `POST /api/reviews` for a freshly created COMPLETED booking from the live test session. | `201` — review inserted. `GET /api/packages/7/reviews` now returns it. | `reviews.routes.js` (M3) | |
| REV-02 | `POST /api/reviews` body `{ booking_id:7, rating:3, comment:'...' }` | Logged in as customer 7. Run immediately after REV-01 (review for booking 7 now exists). | `409 CONFLICT` — one review per booking. | `reviews.routes.js` (M3) | |
| REV-03 | `POST /api/reviews` body `{ booking_id:3, rating:4, comment:'...' }` | Logged in as customer 7, booking 3 is CONFIRMED (not COMPLETED) | `409 CONFLICT` — review only allowed on COMPLETED booking. | `reviews.routes.js` (M3) | |
| REV-04 | `POST /api/reviews` body `{ booking_id:8, rating:5, comment:'...' }` | Logged in as customer 7 (not the owner of booking 8) | `403 FORBIDDEN`. | `reviews.routes.js` (M3) | |
| REV-05 | `POST /api/reviews` body `{ booking_id:7, rating:6, comment:'...' }` | Logged in as customer 7 | `400 VALIDATION_ERROR` — rating must be 1–5. | `reviews.routes.js` (M3) | |
| REV-06 | `GET /api/reviews/mine` | Logged in as customer 7 | Returns reviews written by customer 7 (review_id 1 if seed is intact, or the re-inserted review from REV-01). | `reviews.routes.js` (M3) | |
| REV-07 | `GET /api/packages/8/reviews` | No session | Returns review_id 2 (booking 8, rating 4) — customer name shown, no private data leaked. | `catalog.routes.js` or `reviews.routes.js` (M2/M3) | |

---

## TC-ADMIN — Admin Reporting and Booking Management

| # | Endpoint / Action | Pre-condition | Expected result | Requires | Result |
|---|---|---|---|---|---|
| ADM-01 | `GET /api/admin/stats` | Logged in as admin@makemytour.test (has VIEW_REPORTS) | `total_bookings` ≥ 9, `total_revenue` = sum of PAID booking amounts (3+4+7+8+9 = 15600+37000+44000+14500+8400 = 119500). | `reports.routes.js` (M3) + `auth.routes.js` (M1) | |
| ADM-02 | `GET /api/admin/bookings?status=COMPLETED` | Logged in as admin with MANAGE_BOOKINGS | Returns bookings 7, 8, 9 only. | `bookings.routes.js` (M3) + `auth.routes.js` (M1) | |
| ADM-03 | `GET /api/admin/reports/bookings` | Logged in as admin with VIEW_REPORTS | `by_status[]` includes all four statuses; `top_packages[5]` is non-empty. | `reports.routes.js` (M3) | |
| ADM-04 | `GET /api/customer/reports` | Logged in as customer 7 | `total_bookings` correct for customer 7; `total_spent` equals sum of customer 7's PAID bookings. | `reports.routes.js` (M3) | |
| ADM-05 | `GET /api/provider/reports` | Logged in as provider 5 (Meena Iyer) | `total_earnings` = sum of PAID bookings on provider 5's packages (pkgs 6,7,8). | `providerReports.routes.js` (M2) | |

---

## TC-RBAC — Role and Ownership Guards

| # | Endpoint / Action | Pre-condition | Expected result | Requires | Result |
|---|---|---|---|---|---|
| RBAC-01 | `GET /api/bookings/1` | Logged in as customer 8 (not owner) | `403 FORBIDDEN`. | `bookings.routes.js` (M3) | |
| RBAC-02 | `GET /api/bookings/1` | Logged in as provider 4 (owns package 1) | `200` — provider may view bookings on their package. | `bookings.routes.js` (M3) | |
| RBAC-03 | `PATCH /api/admin/packages/1/status` body `{ status:'DISABLED' }` | Logged in as limitedadmin@makemytour.test (no MODERATE_PACKAGES) | `403 FORBIDDEN`. | `adminPackages.routes.js` (M2) + `auth.routes.js` (M1) | |
| RBAC-04 | `POST /api/bookings` | Logged in as provider 4 | `403 FORBIDDEN` — PROVIDER role cannot create customer bookings. | `bookings.routes.js` (M3) | |
| RBAC-05 | `DELETE /api/provider/packages/1` with active (non-cancelled) bookings | Logged in as provider 4 | `409 CONFLICT` — cannot delete a package that has active bookings. | `providerPackages.routes.js` (M2) | |
| RBAC-06 | `PATCH /api/provider/packages/9/status` body `{ status:'APPROVED' }` | Logged in as provider 5 | `409` — provider cannot self-approve. Only Admin can set APPROVED. | `providerPackages.routes.js` (M2) | |
| RBAC-07 | `GET /api/provider/bookings` | Logged in as provider 4 | Returns only bookings whose package belongs to provider 4 (not provider 5's bookings). | `bookings.routes.js` (M3) | |

---

## TC-SEED — Seed Data Integrity Checks

> **These are the only tests executable right now** — they are direct SQL queries that require only a working MySQL connection and a completed `npm run db:setup`, with no server routes needed.

| # | Check | How to verify | Expected result | Requires | Result |
|---|---|---|---|---|---|
| SEED-01 | All 6 destinations present and ACTIVE | `SELECT count(*) FROM destinations WHERE status='ACTIVE';` | `6` | READY | |
| SEED-02 | All 5 categories present and ACTIVE | `SELECT count(*) FROM categories WHERE status='ACTIVE';` | `5` | READY | |
| SEED-03 | 8 APPROVED, 1 PENDING, 1 DISABLED package | `SELECT status, count(*) FROM tour_packages GROUP BY status;` | APPROVED=8, PENDING=1, DISABLED=1 | READY | |
| SEED-04 | Every package has ≥ 3 itinerary days | `SELECT package_id, count(*) c FROM package_itinerary GROUP BY package_id HAVING c < 3;` | Empty result | READY | |
| SEED-05 | Every package has ≥ 4 future availability dates | `SELECT package_id, count(*) c FROM package_availability WHERE available_date > CURDATE() GROUP BY package_id HAVING c < 4;` | Empty result | READY | |
| SEED-06 | No past availability dates | `SELECT count(*) FROM package_availability WHERE available_date <= CURDATE();` | `0` | READY | |
| SEED-07 | Bookings cover all four statuses | `SELECT booking_status, count(*) FROM bookings GROUP BY booking_status;` | PENDING=2, CONFIRMED=2, CANCELLED=2, COMPLETED=3 | READY | |
| SEED-08 | Payments exist only for PAID / REFUNDED bookings | `SELECT b.payment_status, count(p.payment_id) FROM bookings b LEFT JOIN payments p ON p.booking_id=b.booking_id GROUP BY b.payment_status;` | UNPAID rows have 0 payments; PAID and REFUNDED rows each have a matching payment | READY | |
| SEED-09 | Exactly 3 reviews, all on COMPLETED bookings | `SELECT r.review_id, b.booking_status FROM reviews r JOIN bookings b ON b.booking_id=r.booking_id;` | 3 rows, all COMPLETED | READY | |
| SEED-10 | Second `npm run db:setup` completes without errors and produces correct counts | Run `npm run db:setup` a second time, then re-run SEED-01 through SEED-09 | `db:setup` drops and recreates all tables, re-runs schema and all seeds from scratch. Final row counts must match SEED-01 through SEED-09 exactly (tables are rebuilt, not patched). | READY | |

---

## Known Limitations / Blockers

| Item | Detail |
|---|---|
| SQL execution | MySQL was **not available in the sandbox** during seed file creation or the subsequent correctness review. Syntax has been reviewed manually and via static cross-reference scripts. Actual execution must be confirmed by the team member running `npm run db:setup`. |
| `setup.js` integration | Seeds are not yet wired into `setup.js`. **M1 must add** execution of `database/seeds/02_catalog.sql` followed by `database/seeds/03_bookings.sql` (via `fs.readFileSync` + `connection.query`, or equivalent) to the setup script before `npm run db:setup` will load them automatically. |
| All TC-CAT tests | Require `packages.routes.js` and `catalog.routes.js` (M2). Currently BLOCKED. |
| All TC-BOOK tests | Require `bookings.routes.js` (M3). Currently BLOCKED. |
| All TC-CANCEL tests | Require `bookings.routes.js` (M3) and `auth.routes.js` (M1). Currently BLOCKED. |
| All TC-PAY tests | Require `bookings.routes.js` pay handler (M3). Currently BLOCKED. |
| TC-REV POST tests (REV-01 to REV-05) | Require `reviews.routes.js` (M3). Currently BLOCKED. |
| TC-REV-01 seed conflict | The seed inserts review_id 1 for booking 7. REV-01 must clean up the seeded review first (`DELETE FROM reviews WHERE booking_id = 7;`) or use a fresh booking. See pre-condition in the table above. |
| Concurrent booking (BOOK-08) | Requires `SELECT ... FOR UPDATE` inside a transaction; can only be tested once the booking route exists. |
| CAN-05 cancellation window | Requires Settings API (`PUT /api/settings`) to adjust `cancellation_window_days`, which needs M1's server core and `settings.routes.js`. |
