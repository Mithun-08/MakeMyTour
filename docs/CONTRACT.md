# Part 1: Shared Architecture and Integration Contract

**Source of truth:** Commit this file as `docs/CONTRACT.md` before feature work begins. All three members and every Antigravity task prompt must follow it. The seven-day schedule is 26 October–1 November 2026, with approximately 1–2 hours per member per day. The assignment's full feature list remains the target, but delivery order is governed by Section 1.9.

---

## 1.1 Stack and Hard Rules

* **Backend:** Node.js using only built-in modules (`http`, `fs`, `path`, `url`, `crypto`) plus exactly one npm package, `mysql2` (the MySQL driver). No Express, no other npm packages.
* **Frontend:** Static HTML in `public/`, CSS, vanilla JavaScript, DOM manipulation, `fetch()`. No React, Angular, Vue, jQuery, Bootstrap, Tailwind, Chart.js or any other framework or library. Charts are hand-built with CSS bars or canvas.
* **One origin:** Node serves the API and the static files on `http://localhost:3000`, so cookies and fetch need no CORS.
* **Security basics:** Passwords hashed with `crypto.scrypt`, all SQL parameterized with `?`, user text inserted with `textContent` or `UI.escapeHtml` (never raw `innerHTML`), the server enforces roles (frontend guards are only convenience).
* **JSON keys:** Use `snake_case` and match DB column names exactly. Joined fields use clear names (`destination_name`, `provider_name`, `avg_rating`).
* **Dates & Numbers:** Dates are `YYYY-MM-DD` strings, timestamps are ISO strings, money is a JSON number (use `Number()` on `DECIMAL` values).

---

## 1.2 Folder Structure and Owners

```text
MakeMyTour/
  README.md                   M1 skeleton D1, each member adds own section, final D7
  package.json                M1 (scripts: start, dev, db:setup, test; dependency: mysql2)
  .env.example .gitignore     M1 (.env and node_modules are never committed)
  docs/CONTRACT.md            M1 (copy of Part 1)
  docs/screenshots/           everyone, Day 6-7
  database/
    schema.sql                M1
    setup.js                  M1 (recreates DB, runs schema, inserts demo users/settings, runs seeds in order)
    seeds/02_catalog.sql      M3
    seeds/03_bookings.sql     M3
  server/
    server.js router.js config.js db.js        M1
    utils/http.js validate.js password.js logger.js session.js   M1
    routes/
      auth.routes.js profile.routes.js adminUsers.routes.js
      superadmin.routes.js logs.routes.js settings.routes.js     M1
      catalog.routes.js packages.routes.js providerPackages.routes.js
      availability.routes.js adminPackages.routes.js
      providerReports.routes.js                                  M2
      bookings.routes.js payments.routes.js reviews.routes.js
      reports.routes.js                                          M3
  public/
    *.html                    30 pages, owner per Part 2
    css/style.css             M2 foundation (frozen after D1)
    css/admin.css (M1) css/provider.css (M2) css/customer.css (M3)
    js/api.js ui.js auth.js layout.js   M2 foundation (frozen after D1)
    js/pages/<page>.js        the owner of that page
    images/                   M3
  tests/smoke.test.js         M1
```

### Seven-Day Workstream Ownership (Authoritative)

- **M1 — Mithun:** server core, database schema/setup, configuration, HTTP/router utilities, password/session/authentication, profile, admin user management, Super Admin, logs/settings, smoke tests, integration and final README.
- **M2 — Mehar­naz (Member 2):** shared frontend foundation on Day 1; public catalog UI; catalog/destination/category APIs; provider package/availability APIs and UI; provider reports/reviews APIs; provider booking UI. M2 owns `catalog.routes.js`, `packages.routes.js`, `providerPackages.routes.js`, `availability.routes.js`, `adminPackages.routes.js`, and `providerReports.routes.js`.
- **M3 — Mehar­naz (Member 3):** catalog and booking seed data; booking, payment, review and customer/admin report APIs; customer booking/review UI; admin reporting UI; role and booking regression tests. M3 owns `bookings.routes.js`, `payments.routes.js`, `reviews.routes.js`, and `reports.routes.js`.
- The two members entered as Mehar­naz must be distinguished operationally as **Member 2 (M2)** and **Member 3 (M3)** until their separate GitHub usernames are confirmed. Do not assume they are the same GitHub account.
- The owner of a file is responsible for its changes and tests. Other members raise a GitHub issue or coordinate a patch rather than editing the file independently.

### Ownership Rules (Prevents Merge Conflicts)
* **One owner per file:** Need a change in someone else's file? Open a GitHub Issue or message them. Never edit it yourself.
* **Foundation files frozen after Day 1:** `server core`, `utils`, `style.css`, `api.js`, `ui.js`, `auth.js`, `layout.js` are frozen after Day 1. Bug fixes go to the owner.
* **Auto-loaded route files:** Route files are auto-loaded by the router, so nobody edits a shared route registry. Page JS is per page, so nobody edits a shared script.
* **README.md and package.json:** Only Member 1 edits `package.json`. In `README.md` each member edits only their own section.

---

## 1.3 Database Setup Procedure (Every Member, Once)

1. Install MySQL 8 and make sure the server is running. Note your root password.
2. Copy `.env.example` to `.env` and fill in your own values: `PORT=3000`, `DB_HOST=localhost`, `DB_PORT=3306`, `DB_USER=root`, `DB_PASSWORD=<yours>`, `DB_NAME=makemytour`, `SESSION_TTL_MINUTES=120`.
3. `npm install`, then verify `.env` points only to your dedicated local development database before running `npm run db:setup`. This command DROPS and recreates the configured database; never run it against a shared, production, or data-bearing database. Then run `npm start` and open `http://localhost:3000`.
4. After every git pull that changes anything in `database/`, run `npm run db:setup` again.

### Demo Accounts (Created by setup.js, password for all: Password@123)

| user_id | email | role | status | notes |
| :--- | :--- | :--- | :--- | :--- |
| 1 | `superadmin@makemytour.test` | `SUPER_ADMIN` | `ACTIVE` | all permissions |
| 2 | `admin@makemytour.test` | `ADMIN` | `ACTIVE` | all 8 permissions |
| 3 | `limitedadmin@makemytour.test` | `ADMIN` | `ACTIVE` | only `MANAGE_DESTINATIONS`, `MANAGE_CATEGORIES` |
| 4 | `provider1@makemytour.test` | `PROVIDER` | `ACTIVE` | Ravi Kumar |
| 5 | `provider2@makemytour.test` | `PROVIDER` | `ACTIVE` | Meena Iyer |
| 6 | `provider3@makemytour.test` | `PROVIDER` | `PENDING` | awaits admin approval |
| 7 | `customer1@makemytour.test` | `CUSTOMER` | `ACTIVE` | Anita Sharma |
| 8 | `customer2@makemytour.test` | `CUSTOMER` | `ACTIVE` | Karthik R |

`setup.js` also inserts one address per provider (city and state, used as local tourist information) and default settings:
* `site_name=MakeMyTour`
* `cancellation_window_days=2`
* `max_travelers_per_booking=10`

---

## 1.4 MySQL Schema (`database/schema.sql`, Owner M1)

```sql
CREATE TABLE users (
  user_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  mobile VARCHAR(15) NOT NULL,
  role ENUM('CUSTOMER','PROVIDER','ADMIN','SUPER_ADMIN') NOT NULL,
  status ENUM('ACTIVE','PENDING','BLOCKED','REJECTED','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE addresses (
  address_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  address_line VARCHAR(255),
  city VARCHAR(100),
  state VARCHAR(100),
  pincode VARCHAR(10),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE destinations (
  destination_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  city VARCHAR(100) NOT NULL,
  state VARCHAR(100) NOT NULL,
  country VARCHAR(100) NOT NULL DEFAULT 'India',
  description TEXT,
  status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  UNIQUE (name, city)
);

CREATE TABLE categories (
  category_id INT AUTO_INCREMENT PRIMARY KEY,
  category_name VARCHAR(80) NOT NULL UNIQUE,
  description TEXT,
  status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE'
);

CREATE TABLE tour_packages (
  package_id INT AUTO_INCREMENT PRIMARY KEY,
  provider_id INT NOT NULL,
  destination_id INT NOT NULL,
  category_id INT NOT NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  inclusions TEXT, -- ADDED: one item per line
  exclusions TEXT, -- ADDED: one item per line
  duration_days INT NOT NULL CHECK (duration_days > 0),
  price DECIMAL(10,2) NOT NULL CHECK (price >= 0), -- price per traveler
  capacity INT NOT NULL CHECK (capacity > 0), -- default seats per date
  image VARCHAR(255),
  status ENUM('PENDING','APPROVED','REJECTED','DISABLED') NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (provider_id) REFERENCES users(user_id),
  FOREIGN KEY (destination_id) REFERENCES destinations(destination_id),
  FOREIGN KEY (category_id) REFERENCES categories(category_id)
);

CREATE TABLE package_itinerary (
  itinerary_id INT AUTO_INCREMENT PRIMARY KEY,
  package_id INT NOT NULL,
  day_no INT NOT NULL CHECK (day_no > 0),
  title VARCHAR(200) NOT NULL,
  description TEXT,
  UNIQUE (package_id, day_no),
  FOREIGN KEY (package_id) REFERENCES tour_packages(package_id) ON DELETE CASCADE
);

CREATE TABLE package_availability (
  availability_id INT AUTO_INCREMENT PRIMARY KEY,
  package_id INT NOT NULL,
  available_date DATE NOT NULL,
  seats_available INT NOT NULL CHECK (seats_available >= 0),
  status ENUM('OPEN','CLOSED','FULL') NOT NULL DEFAULT 'OPEN',
  UNIQUE (package_id, available_date),
  FOREIGN KEY (package_id) REFERENCES tour_packages(package_id) ON DELETE CASCADE
);

CREATE TABLE bookings (
  booking_id INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NOT NULL,
  package_id INT NOT NULL,
  availability_id INT NOT NULL,
  travelers INT NOT NULL CHECK (travelers > 0),
  total_amount DECIMAL(10,2) NOT NULL,
  booking_status ENUM('PENDING','CONFIRMED','CANCELLED','COMPLETED') NOT NULL DEFAULT 'PENDING',
  payment_status ENUM('UNPAID','PAID','REFUNDED') NOT NULL DEFAULT 'UNPAID',
  booked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES users(user_id),
  FOREIGN KEY (package_id) REFERENCES tour_packages(package_id),
  FOREIGN KEY (availability_id) REFERENCES package_availability(availability_id)
);

CREATE TABLE payments (
  payment_id INT AUTO_INCREMENT PRIMARY KEY,
  booking_id INT NOT NULL UNIQUE, -- one booking, one payment
  customer_id INT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  payment_method ENUM('UPI','CARD','NETBANKING','CASH') NOT NULL,
  payment_status ENUM('SUCCESS','FAILED','REFUNDED') NOT NULL,
  paid_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (booking_id) REFERENCES bookings(booking_id),
  FOREIGN KEY (customer_id) REFERENCES users(user_id)
);

CREATE TABLE reviews (
  review_id INT AUTO_INCREMENT PRIMARY KEY,
  booking_id INT NOT NULL UNIQUE, -- one booking, one review
  customer_id INT NOT NULL,
  package_id INT NOT NULL,
  rating TINYINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (booking_id) REFERENCES bookings(booking_id),
  FOREIGN KEY (customer_id) REFERENCES users(user_id),
  FOREIGN KEY (package_id) REFERENCES tour_packages(package_id)
);

CREATE TABLE admin_permissions (
  permission_id INT AUTO_INCREMENT PRIMARY KEY,
  admin_id INT NOT NULL,
  permission_name VARCHAR(50) NOT NULL,
  UNIQUE (admin_id, permission_name),
  FOREIGN KEY (admin_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE system_logs (
  log_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  action VARCHAR(60) NOT NULL,
  description VARCHAR(500),
  ip_address VARCHAR(45),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX (created_at),
  INDEX (action),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL
);

CREATE TABLE system_settings ( -- ADDED for Super Admin settings
  setting_key VARCHAR(60) PRIMARY KEY,
  setting_value VARCHAR(255) NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

### Relationships and Status Meanings
* **Relationships follow section 9 of the spec:** destination and category to many packages, provider to many packages, package to many itinerary rows and availability dates, customer to many bookings, booking to one package, one availability date, one payment and one review, admin to many permissions. Because the schema's separate `package_id` and `availability_id` foreign keys do not ensure that the availability belongs to that package, the booking handler MUST verify the pair together inside the transaction before locking/decrementing seats.
* **Status meanings:**
  * **Package:** `PENDING` (awaiting Admin), `APPROVED` (public), `REJECTED`, `DISABLED` (hidden). Only `APPROVED` packages whose provider is `ACTIVE` appear publicly. A provider may disable their own approved package, but must not re-enable a package disabled/rejected by Admin; do not allow a provider action to override moderation. If the single status field cannot distinguish who disabled it, allow provider re-enable only when the contract/application can safely establish that the package was provider-disabled; otherwise require Admin moderation.
  * **Availability:** `OPEN`, `CLOSED` (provider closed it), `FULL` (seats_available reached 0).
  * **Booking:** `PENDING` (created), `CONFIRMED` (provider or Admin), `CANCELLED`, `COMPLETED` (travel date reached).
  * **Provider users:** `PENDING` until approved.
  * **User status:** `ACTIVE`, `PENDING`, `BLOCKED`, `REJECTED`, `INACTIVE`.

### Seed Data Contract (Develop Against the Same Data)
* **`seeds/02_catalog.sql` (M3, seed-data ownership):** 6 destinations, 5 categories, at least 8 packages across provider ids 4 and 5 (mostly `APPROVED`, one `PENDING`, one `DISABLED`), 3 to 5 itinerary days each, 4 or more availability dates per package written as `DATE_ADD(CURDATE(), INTERVAL n DAY)` so the data never goes stale.
* **`seeds/03_bookings.sql` (M3, seed-data ownership):** At least 8 bookings for customers 7 and 8 covering all four booking statuses, payments for paid ones, and 3 reviews on `COMPLETED` bookings.
* Seeds must be re-runnable on a fresh database and use fixed ids.

---

## 1.5 Authentication, Sessions and RBAC

* **Register:** `POST /api/auth/register` with role `CUSTOMER` becomes `ACTIVE` at once. Role `PROVIDER` becomes `PENDING` and cannot log in until an Admin approves. `ADMIN` and `SUPER_ADMIN` can never self-register (the Super Admin creates admins).
* **Login errors:**
  * Wrong email or password: `401 INVALID_CREDENTIALS`.
  * Status `PENDING` / `BLOCKED` / `REJECTED` / `INACTIVE`: `403` with code `ACCOUNT_PENDING` / `ACCOUNT_BLOCKED` / `ACCOUNT_REJECTED` / `ACCOUNT_INACTIVE` and a friendly message. Never reveal which of email or password was wrong.
* **Session:** Server-side `Map`: token (`crypto.randomBytes(32)` hex) to `{ user_id, expires }`. Sent as cookie `mmt_sid` with `HttpOnly; SameSite=Lax; Path=/; Max-Age=7200`. On every API request the server reads the cookie, loads the fresh user row and permissions, and puts them in `ctx.user`, so blocking a user takes effect immediately. A server restart logs everybody out (accepted and documented). Logout deletes the token and clears the cookie.
* **`ctx.user` shape:** `{ user_id, name, email, mobile, role, status, permissions: [..] }`. `SUPER_ADMIN` gets `permissions: ['*']`.
* **Route protection flags:**
  * No flags = public.
  * `roles: [..]` = must be logged in with one of those roles. `SUPER_ADMIN` automatically passes every route that allows `ADMIN`.
  * `permission: 'X'` = an `ADMIN` needs `X` in `admin_permissions` (`SUPER_ADMIN` always passes).
  * Ownership checks (provider owns package, customer owns booking) live inside handlers: `403 FORBIDDEN`.
* **Permission names (exactly these 8):**
  1. `MANAGE_USERS` (customers)
  2. `MANAGE_PROVIDERS`
  3. `MANAGE_DESTINATIONS`
  4. `MANAGE_CATEGORIES`
  5. `MODERATE_PACKAGES`
  6. `MANAGE_BOOKINGS`
  7. `VIEW_REPORTS`
  8. `VIEW_LOGS` (gives read-only access to logs and settings, which is the Limited access in the permission table of the spec).

---

## 1.6 API Conventions

* **Success:** `{ success: true, data: <object or array>, meta?: { page, pageSize, total }, message?: 'text' }`. Create returns HTTP 201, everything else 200. Lists accept `?page=1&pageSize=10` (max 50).
* **Error:** `{ success: false, error: { code: 'VALIDATION_ERROR', message: 'Human readable', details?: { field: 'what is wrong' } } }`

| HTTP code | Error code | When |
| :--- | :--- | :--- |
| 400 | `VALIDATION_ERROR` / `BAD_REQUEST` | invalid or missing input (details has per-field messages) |
| 401 | `UNAUTHENTICATED` / `INVALID_CREDENTIALS` | no session, or bad login |
| 403 | `FORBIDDEN` / `ACCOUNT_*` | wrong role, missing permission, not the owner, blocked account |
| 404 | `NOT_FOUND` | missing record (also unknown `/api` path) |
| 409 | `CONFLICT` | duplicate email, seats unavailable, illegal status change |
| 500 | `INTERNAL_ERROR` | unexpected (server logs the stack, client gets a generic message) |

### Route File Shape
Every `server/routes/*.routes.js` exports an array; `router.js` loads all of them automatically:

```javascript
const { HttpError } = require('../utils/http');
const validate = require('../utils/validate');
const { logAction } = require('../utils/logger');

module.exports = [
  {
    method: 'GET',
    path: '/api/packages/:id', // :params arrive in ctx.params
    handler: async (ctx) => {
      const rows = await ctx.db.query('SELECT * FROM tour_packages WHERE package_id = ?', [ctx.params.id]);
      if (!rows.length) throw new HttpError(404, 'NOT_FOUND', 'Package not found');
      return { data: rows[0] }; // optional: meta, message, status
    }
  },
  {
    method: 'PATCH',
    path: '/api/admin/packages/:id/status',
    roles: ['ADMIN'], // SUPER_ADMIN passes automatically
    permission: 'MODERATE_PACKAGES',
    handler: async (ctx) => {
      const body = validate(ctx.body, {
        status: { required: true, type: 'enum', values: ['APPROVED', 'REJECTED', 'DISABLED'] }
      });
      // ... update, then:
      await logAction(ctx, 'PACKAGE_MODERATED', 'Package ' + ctx.params.id + ' set to ' + body.status);
      return { data: { package_id: Number(ctx.params.id), status: body.status } };
    }
  }
];
```

* `ctx = { req, res, params, query (object), body (parsed JSON or {}), user (or null), ip, db }`.
* `ctx.db.query(sql, params)` returns an array of rows for `SELECT`, or `{ insertId, affectedRows }` for `INSERT`/`UPDATE`/`DELETE`.
* `ctx.db.transaction(async (tx) => { ... })` gives `tx.query` with the same behavior, commits on success and rolls back if anything throws. Use it for booking, cancellation and package creation. Use `SELECT ... FOR UPDATE` on availability rows when changing seats.
* `validate(body, rules)` returns a cleaned object or throws `VALIDATION_ERROR` with details. Rule keys: `required`, `type` (`string`, `email`, `mobile`, `int`, `number`, `date`, `enum`, `array`), `min`, `max`, `values`. Unknown fields are dropped. Mobile means exactly 10 digits.
* `logAction(ctx, action, description)` inserts into `system_logs`, never throws. Truncates description to 500 characters. Call it for:
  `REGISTER`, `LOGIN`, `LOGOUT`, `USER_STATUS_CHANGED`, `PACKAGE_CREATED/UPDATED/DELETED/MODERATED`, `DESTINATION_*`, `CATEGORY_*`, `BOOKING_CREATED/CANCELLED/STATUS_CHANGED`, `PAYMENT_MADE`, `REVIEW_ADDED`, `ADMIN_CREATED/UPDATED/DELETED`, `PERMISSIONS_CHANGED`, `SETTINGS_CHANGED`.

---

## 1.7 Endpoint Catalogue

Access column: roles allowed (`SUPER_ADMIN` is implicit wherever `ADMIN` is listed). A permission after a plus sign applies only when the caller is an `ADMIN`. All bodies are JSON with `snake_case` keys.

### Auth and Profile (Owner M1: auth.routes.js, profile.routes.js)

| Endpoint | Access | Body or query and result |
| :--- | :--- | :--- |
| `POST /api/auth/register` | public | name, email, password (min 8), mobile, role (`CUSTOMER` or `PROVIDER`), optional city and state. Returns user_id, role, status |
| `POST /api/auth/login` | public | email, password. Sets cookie. Returns `{ user }` in `ctx.user` shape |
| `POST /api/auth/logout` | any logged in | clears session |
| `GET /api/auth/me` | any logged in | returns `{ user }` or 401 UNAUTHENTICATED |
| `GET /api/profile` | any logged in | returns `{ user, address }` |
| `PUT /api/profile` | any logged in | name, mobile, address_line, city, state, pincode |
| `PUT /api/profile/password` | any logged in | current_password, new_password |

### Admin User Management, Logs, Settings (Owner M1)

| Endpoint | Access | Notes |
| :--- | :--- | :--- |
| `GET /api/admin/customers` | ADMIN + MANAGE_USERS | query search, status, page. Rows: user_id, name, email, mobile, status, created_at, total_bookings |
| `GET /api/admin/providers` | ADMIN + MANAGE_PROVIDERS | query search, status, page. Rows add package_count, city, state |
| `PATCH /api/admin/users/:id/status` | ADMIN | body `{ status: ACTIVE, BLOCKED or REJECTED }`. Needs `MANAGE_USERS` if target is CUSTOMER, `MANAGE_PROVIDERS` if PROVIDER. Targets with role ADMIN or SUPER_ADMIN give 403. Approve = PENDING to ACTIVE, reject = PENDING to REJECTED, block = ACTIVE to BLOCKED, unblock = BLOCKED to ACTIVE |
| `GET /api/admin/logs` | ADMIN + VIEW_LOGS | query user_id, action, from, to, page, pageSize. Rows: log_id, user_id, user_name, action, description, ip_address, created_at |
| `GET /api/settings` | public | returns site_name, cancellation_window_days, max_travelers_per_booking |
| `PUT /api/settings` | SUPER_ADMIN | any of those three keys. Logs `SETTINGS_CHANGED` |

### Super Admin (Owner M1: superadmin.routes.js)

| Endpoint | Notes |
| :--- | :--- |
| `GET /api/superadmin/admins` | list admins with their permissions array and status |
| `POST /api/superadmin/admins` | name, email, password, mobile, permissions[]. Role is forced to ADMIN |
| `PUT /api/superadmin/admins/:id` | name, mobile |
| `PATCH /api/superadmin/admins/:id/status` | status ACTIVE or INACTIVE (activate or deactivate) |
| `DELETE /api/superadmin/admins/:id` | deletes an ADMIN only, never a SUPER_ADMIN |
| `GET /api/superadmin/permissions` | the 8 permission names |
| `GET /api/superadmin/admins/:id/permissions` | gets permissions array |
| `PUT /api/superadmin/admins/:id/permissions` | PUT body permissions[] replaces all |
| `GET /api/superadmin/stats` | admins_total, admins_active, users_total, logs_today |

### Catalog (Owner M2: catalog.routes.js, packages.routes.js)

| Endpoint | Access | Notes |
| :--- | :--- | :--- |
| `GET /api/destinations` | public | ACTIVE only. query q, state. Rows include package_count (APPROVED packages) |
| `GET /api/categories` | public | ACTIVE only |
| `GET /api/admin/destinations` | ADMIN + MANAGE_DESTINATIONS | all, including INACTIVE |
| `POST /api/admin/destinations` | ADMIN + MANAGE_DESTINATIONS | name, city, state, country, description, status |
| `PUT /api/admin/destinations/:id` | ADMIN + MANAGE_DESTINATIONS | name, city, state, country, description, status |
| `DELETE /api/admin/destinations/:id` | ADMIN + MANAGE_DESTINATIONS | 409 if it has packages (suggest setting INACTIVE) |
| `GET /api/admin/categories` | ADMIN + MANAGE_CATEGORIES | category_name, description, status |
| `POST /api/admin/categories` | ADMIN + MANAGE_CATEGORIES | category_name, description, status |
| `PUT /api/admin/categories/:id` | ADMIN + MANAGE_CATEGORIES | category_name, description, status |
| `DELETE /api/admin/categories/:id` | ADMIN + MANAGE_CATEGORIES | Same delete rule: 409 if it has packages |

### Provider Packages, Availability, Moderation, Provider Reports (Owner M2)

| Endpoint | Access | Notes |
| :--- | :--- | :--- |
| `GET /api/packages` | public | query q, destination_id, category_id, min_price, max_price, min_days, max_days, date (has an OPEN date with seats on or after it), sort (price_asc, price_desc, newest, rating, duration), page, pageSize. Rows: package_id, title, image, price, duration_days, destination_id, destination_name, city, state, category_id, category_name, provider_id, provider_name, avg_rating, review_count, next_available_date |
| `GET /api/packages/:id` | public | Non-APPROVED only visible to the owner provider and ADMIN. Returns package fields plus inclusions[] and exclusions[] (split on newline), provider { user_id, name, city, state }, itinerary[] { day_no, title, description }, availability[] { availability_id, available_date, seats_available, status } (public sees future OPEN dates only), rating { avg, count } |
| `GET /api/provider/packages` | PROVIDER | own packages, any status, with booking counts |
| `GET /api/provider/packages/:id` | PROVIDER owner | full detail incl. all availability |
| `POST /api/provider/packages` | PROVIDER | title, destination_id, category_id, description, inclusions[], exclusions[], duration_days, price, capacity, image, itinerary[] { day_no, title, description }, availability[] { available_date, seats_available }. Created as PENDING, one transaction. 201 with package_id |
| `PUT /api/provider/packages/:id` | PROVIDER owner | same fields. Itinerary is replaced, availability untouched, status unchanged |
| `PATCH /api/provider/packages/:id/status` | PROVIDER owner | toggle APPROVED and DISABLED only |
| `DELETE /api/provider/packages/:id` | PROVIDER owner | 409 if any non-cancelled booking exists |
| `GET /api/packages/:id/availability` | public | future OPEN dates with seats |
| `POST /api/packages/:id/availability` | PROVIDER owner, or ADMIN + MODERATE_PACKAGES | available_date, seats_available |
| `PUT /api/availability/:id` | PROVIDER owner, or ADMIN + MODERATE_PACKAGES | seats_available, status (OPEN or CLOSED). Set FULL automatically when seats reach 0 and OPEN again when seats are raised from 0 |
| `DELETE /api/availability/:id` | PROVIDER owner, or ADMIN + MODERATE_PACKAGES | Delete gives 409 if active bookings use it |
| `GET /api/admin/packages` | ADMIN + MODERATE_PACKAGES | query status, search, page. Rows include provider_name |
| `PATCH /api/admin/packages/:id/status` | ADMIN + MODERATE_PACKAGES | APPROVED, REJECTED or DISABLED |
| `DELETE /api/admin/packages/:id` | ADMIN + MODERATE_PACKAGES | 409 if bookings exist (use DISABLED) |
| `GET /api/provider/reports` | PROVIDER | total_earnings, total_bookings, total_travelers, packages[] { package_id, title, bookings, travelers, earnings, avg_rating, review_count } |
| `GET /api/provider/reviews` | PROVIDER | reviews on own packages: review_id, package_id, package_title, customer_name, rating, comment, created_at |

### Bookings, Payments, Reviews, Reports (Owner M3)

| Endpoint | Access | Notes |
| :--- | :--- | :--- |
| `POST /api/bookings` | CUSTOMER | package_id, availability_id, travelers. One transaction with row lock: package APPROVED and provider ACTIVE, date OPEN and not in the past, travelers between 1 and max_travelers_per_booking and not above seats_available (else 409). Decrements seats, sets FULL at 0, total_amount = price x travelers. 201 with booking_id, total_amount, booking_status PENDING, payment_status UNPAID |
| `POST /api/bookings/:id/pay` | CUSTOMER owner | payment_method (UPI, CARD, NETBANKING, CASH). Inserts payments row (SUCCESS), sets booking payment_status PAID. 409 if already paid or cancelled |
| `POST /api/bookings/:id/cancel` | CUSTOMER owner | Eligible if booking_status is PENDING or CONFIRMED and travel date is at least cancellation_window_days away. Restores seats (re-opens FULL). If PAID: payment_status REFUNDED and payments row REFUNDED. Otherwise 409 with reason |
| `GET /api/bookings/mine` | CUSTOMER | query status, page. Rows: booking fields, package title and image, available_date, can_cancel, can_review, has_review |
| `GET /api/bookings/:id` | CUSTOMER owner, PROVIDER of package, ADMIN + MANAGE_BOOKINGS | full detail with payment |
| `GET /api/provider/bookings` | PROVIDER | own packages only. query status, package_id, page. Rows add customer_name and customer_mobile |
| `PATCH /api/bookings/:id/status` | PROVIDER of package, or ADMIN + MANAGE_BOOKINGS | status CONFIRMED, COMPLETED or CANCELLED. Allowed: PENDING to CONFIRMED, CONFIRMED to COMPLETED (only when travel date is today or past), PENDING or CONFIRMED to CANCELLED (restores seats, refunds if PAID). Anything else 409 |
| `GET /api/admin/bookings` | ADMIN + MANAGE_BOOKINGS | query status, search, from, to, page |
| `POST /api/reviews` | CUSTOMER | booking_id, rating 1 to 5, comment. Own COMPLETED booking only, one per booking (409) |
| `GET /api/packages/:id/reviews` | public | review_id, customer_name, rating, comment, created_at |
| `GET /api/reviews/mine` | CUSTOMER | own reviews |
| `GET /api/admin/stats` | ADMIN + VIEW_REPORTS | total_customers, total_providers, pending_providers, total_packages, pending_packages, total_bookings, total_revenue, bookings_today |
| `GET /api/admin/reports/revenue` | ADMIN + VIEW_REPORTS | query from, to, group (day or month). Rows: period, bookings, revenue |
| `GET /api/admin/reports/bookings` | ADMIN + VIEW_REPORTS | by_status[], top_packages[5], top_destinations[5], by_category[] |
| `GET /api/customer/reports` | CUSTOMER | total_bookings, total_spent, by_status[], upcoming[] |

> **Revenue Definition:** Revenue always means the sum of `bookings.total_amount` where `payment_status` is `PAID`.

---

## 1.8 Frontend Contract (Foundation Built by M2 on Day 1)

Every page uses this skeleton (the page's own JS file goes last):

```html
<!DOCTYPE html>
<html lang='en'>
<head>
  <meta charset='UTF-8'>
  <meta name='viewport' content='width=device-width, initial-scale=1'>
  <title>Page Title | MakeMyTour</title>
  <link rel='stylesheet' href='/css/style.css'>
  <link rel='stylesheet' href='/css/OWNER.css'>
</head>
<body>
  <header id='site-header'></header>
  <main id='app' class='container'> ... </main>
  <footer id='site-footer'></footer>
  <script src='/js/api.js'></script>
  <script src='/js/ui.js'></script>
  <script src='/js/auth.js'></script>
  <script src='/js/layout.js'></script>
  <script src='/js/pages/PAGENAME.js'></script>
</body>
</html>
```

* **`api.js`:** `api.get(url, params)`, `api.post(url, body)`, `api.put(url, body)`, `api.patch(url, body)`, `api.del(url)`. Each resolves `{ data, meta, message }` and rejects with an `ApiError { status, code, message, details }`. A 401 on a page that requires login redirects to `/login.html?next=<encoded current page>`.
* **`auth.js`:** `Auth.getUser()` returns a promise of the user or null (cached per page load). `Auth.requireRole(['PROVIDER'])` returns the user, redirects to login when logged out, and redirects to the person's own dashboard when the role is wrong. `Auth.logout()`. `Auth.dashboardFor(role)` gives `customer-dashboard.html`, `provider-dashboard.html`, `admin-dashboard.html` or `superadmin-dashboard.html`. `Auth.hasPermission(name)` for hiding admin links (server still enforces). `Auth.safeNext(url)` only allows paths starting with a single slash.
* **`ui.js`:** `UI.toast(message, type)` with success, error or info. `UI.confirm(message)` returns a promise of true or false. `UI.escapeHtml(text)`. `UI.money(n)` gives a rupee string. `UI.date(str)`. `UI.statusBadge(status)` returns a span with classes `badge badge-<status in lowercase>`. `UI.setLoading(el, bool)`. `UI.empty(container, message)`. `UI.showErrors(form, details)` and `UI.clearErrors(form)` (inputs carry a `name` attribute, each has a sibling element with class `field-error`). `UI.pager(container, meta, onPage)`. `UI.debounce(fn, ms)`.
* **`layout.js`:** Fills header and footer. The nav depends on role: public (Home, Destinations, Packages, Login, Register), CUSTOMER, PROVIDER, ADMIN (links filtered by permissions), SUPER_ADMIN (admin links plus Admins, Permissions, Logs, Settings). Works on phones (hamburger menu).
* **`style.css`:** CSS variables for colors, spacing and fonts, mobile-first, breakpoints at 600px and 900px, classes for container, card, grid, btn (primary, secondary, danger), form fields, table plus a scroll wrapper, badge-*, toast, modal, pagination.
* **DOM rules:** Build lists with template strings through `UI.escapeHtml` or with `createElement` and `textContent`, use event delegation for buttons inside lists, always show loading, empty and error states, validate forms in the browser before calling the API and also show server details messages.

---

## 1.9 Seven-Day Delivery Priorities (26 October–1 November 2026)

The university assignment's full feature list remains the overall target. Given the team's available time (approximately 1–2 hours per person per day, or 21–42 person-hours total), the seven-day plan must prioritize a coherent, testable end-to-end application over broad unfinished scaffolding. Do not claim unimplemented features are complete.

| Tier | Seven-day delivery target |
| :--- | :--- |
| **P0 — end-to-end core** | Server/database startup; registration/login/logout and server-side RBAC for all four roles; provider approval; public destination/category/package browsing and details; provider package create/edit/availability; admin package moderation; booking with transactional seat control; customer booking history and eligible cancellation; provider booking confirmation; smoke tests and setup documentation. |
| **P1 — implement after P0 works** | Simulated payment records (not a real payment gateway); reviews for completed bookings; customer/provider/admin booking management; customer/provider blocking and approval controls; Super Admin admin accounts and permissions; system logs; essential admin/provider/customer reports. |
| **P2 — only after core flows pass** | System settings UI, profile/password changes, advanced filters and pagination polish, charts, image upload, extensive responsive refinements and additional automated tests. |

### Seven-Day Work Schedule

- **Day 1 — 26 Oct:** M1 verifies/commits contract, schema, setup foundation and test command; M2 builds shared frontend foundation; M3 prepares seed data and booking acceptance tests. Freeze API shapes and file ownership.
- **Day 2 — 27 Oct:** M1 builds authentication/session behavior; M2 builds public catalog/destination/category APIs and browsing UI in their owned files; M3 completes catalog/booking seed fixtures and validates API/booking test cases. Coordinate dependencies explicitly.
- **Day 3 — 28 Oct:** M1 completes server-side RBAC and essential admin user operations; M2 builds provider package/availability APIs and UI; M3 implements transactional booking creation.
- **Day 4 — 29 Oct:** M1 completes profile/essential admin API work; M2 builds customer booking screens; M3 implements booking history/cancellation and minimal simulated payment/review endpoints.
- **Day 5 — 30 Oct:** M1 implements moderation and remaining essential admin APIs; M2 completes provider booking management; M3 builds customer review and core admin screens.
- **Day 6 — 31 Oct:** M1 completes feasible Super Admin/security work; M2 runs UI regression and responsive fixes; M3 implements basic reports and tests booking/payment/review consistency.
- **Day 7 — 1 Nov:** M1 integrates reviewed branches and finalizes README/setup instructions; M2 verifies customer/provider browser flows and captures genuine screenshots; M3 verifies all four roles, booking constraints and documents passed/failed/blocked tests.

### Daily Integration Gates

1. **Day 1:** All members can clone, install dependencies, understand ownership and agree on API envelopes and startup procedure.
2. **Day 2:** Public catalog reads real database data; auth endpoints are testable; seed/setup process is repeatable.
3. **Day 3:** Server-side role/ownership checks work; booking rejects invalid capacity and mismatched package/availability pairs.
4. **Day 4:** Customer can create/view/cancel an eligible booking; seats are restored exactly once.
5. **Day 5:** Admin moderation affects public visibility; providers see/manage only their own packages and bookings.
6. **Day 6:** Clean setup and role smoke tests work; stop adding large features if critical flows fail.
7. **Day 7:** Regression checklist, README, screenshots of verified features and actual incremental commit history are ready.

### If Time Runs Short

Cut P2 first, then reduce report/chart polish. Keep the server-side authorization, database integrity, package discovery and customer booking/cancellation journey working. A simulated payment must be clearly labeled as a demo and must not collect real card details. Record incomplete requirements honestly in the README.

### Git and Collaboration Rules

- Each member works on their own feature branch and makes incremental commits that correspond to actual changes.
- Open a pull request to `main`; the owner reports tests actually run, and M1 checks contract compatibility before merging.
- Pull the latest `main` before starting a new task. Resolve conflicts with the owner of the affected file.
- Never create fake commits, backdate commits, or claim work by another member. Commit history must represent real contributions.
- `npm test` must be verified early; create `tests/smoke.test.js` on Day 1 so the configured test command has a real test file.
