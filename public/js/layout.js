/**
 * layout.js — Shared header/footer renderer
 * Owner: M2 (Meharnaz)  |  Frozen after Day 1
 * Contract: docs/CONTRACT.md §1.8
 *
 * Depends on: api.js, ui.js, auth.js (loaded first)
 *
 * Fills #site-header and #site-footer on every page.
 * Navigation is role-aware:
 *   public       → Home, Destinations, Packages, Login, Register
 *   CUSTOMER     → Home, Destinations, Packages, My Bookings, My Reviews, [avatar/logout]
 *   PROVIDER     → Home, My Packages, Bookings, Reports, [avatar/logout]
 *   ADMIN        → Home, Packages (MODERATE_PACKAGES), Users, Destinations/Categories,
 *                   Bookings (MANAGE_BOOKINGS), Reports (VIEW_REPORTS),
 *                   Logs (VIEW_LOGS), [avatar/logout]
 *   SUPER_ADMIN  → all ADMIN links + Admins, Permissions, Settings, [avatar/logout]
 *
 * Works on phones: toggles a hamburger nav drawer.
 * All text inserted via textContent or createElement (never raw innerHTML with user data).
 */

(function () {
  'use strict';

  /* ── nav link definitions ─────────────────────────────────── */

  var PUBLIC_NAV = [
    { label: 'Home',         href: '/index.html' },
    { label: 'Destinations', href: '/destinations.html' },
    { label: 'Packages',     href: '/packages.html' }
  ];

  var CUSTOMER_NAV = [
    { label: 'Home',         href: '/index.html' },
    { label: 'Packages',     href: '/packages.html' },
    { label: 'My Bookings',  href: '/customer-bookings.html' },
    { label: 'My Reviews',   href: '/customer-reviews.html' }
  ];

  var PROVIDER_NAV = [
    { label: 'Dashboard',    href: '/provider-dashboard.html' },
    { label: 'My Packages',  href: '/provider-packages.html' },
    { label: 'Bookings',     href: '/provider-bookings.html' },
    { label: 'Reviews',      href: '/provider-reviews.html' },
    { label: 'Reports',      href: '/provider-reports.html' }
  ];

  /* Admin links — each may carry a required permission */
  var ADMIN_NAV = [
    { label: 'Dashboard',    href: '/admin-dashboard.html',    permission: null },
    { label: 'Packages',     href: '/admin-packages.html',     permission: 'MODERATE_PACKAGES' },
    { label: 'Users',        href: '/admin-customers.html',    permission: 'MANAGE_USERS' },
    { label: 'Providers',    href: '/admin-providers.html',    permission: 'MANAGE_PROVIDERS' },
    { label: 'Destinations', href: '/admin-destinations.html', permission: 'MANAGE_DESTINATIONS' },
    { label: 'Bookings',     href: '/admin-bookings.html',     permission: 'MANAGE_BOOKINGS' },
    { label: 'Reports',      href: '/admin-reports.html',      permission: 'VIEW_REPORTS' },
    { label: 'Logs',         href: '/admin-logs.html',         permission: 'VIEW_LOGS' }
  ];

  var SUPERADMIN_EXTRA = [
    { label: 'Admins',       href: '/superadmin-admins.html' },
    { label: 'Permissions',  href: '/superadmin-permissions.html' },
    { label: 'Settings',     href: '/admin-settings.html' }
  ];

  /* ── helper: create a nav link element ───────────────────── */

  function makeNavLink(label, href, inDrawer) {
    var a = document.createElement('a');
    a.className = 'nav-link';
    a.href = href;
    a.textContent = label;   // textContent — safe
    // Mark active if this link matches the current page
    if (window.location.pathname === href ||
        (href !== '/index.html' && window.location.pathname.startsWith(href.replace('.html', '')))) {
      a.classList.add('active');
      a.setAttribute('aria-current', 'page');
    }
    return a;
  }

  /* ── buildHeader ──────────────────────────────────────────── */

  function buildHeader(user) {
    var headerEl = document.getElementById('site-header');
    if (!headerEl) return;

    /* ── nav root ──── */
    var nav = document.createElement('nav');
    nav.className = 'nav';
    nav.setAttribute('aria-label', 'Main navigation');

    /* Brand */
    var brand = document.createElement('a');
    brand.className = 'nav-brand';
    brand.href = '/index.html';
    brand.setAttribute('aria-label', 'MakeMyTour home');

    var brandIcon = document.createElement('span');
    brandIcon.className = 'nav-brand-icon';
    brandIcon.setAttribute('aria-hidden', 'true');
    brandIcon.textContent = '🧭';

    var brandText = document.createElement('span');
    brandText.textContent = 'MakeMyTour';

    brand.appendChild(brandIcon);
    brand.appendChild(brandText);

    /* Links container (desktop) */
    var linksEl = document.createElement('div');
    linksEl.className = 'nav-links';
    linksEl.id = 'nav-links';

    /* Actions container */
    var actionsEl = document.createElement('div');
    actionsEl.className = 'nav-actions';

    /* Hamburger toggle */
    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'nav-toggle';
    toggle.setAttribute('aria-controls', 'nav-drawer');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Toggle navigation menu');
    for (var i = 0; i < 3; i++) {
      var line = document.createElement('span');
      line.setAttribute('aria-hidden', 'true');
      toggle.appendChild(line);
    }

    /* Determine which links to show */
    var links = [];

    if (!user) {
      links = PUBLIC_NAV.slice();
      // Auth buttons
      var loginA = document.createElement('a');
      loginA.href = '/login.html';
      loginA.className = 'btn btn-ghost btn-sm';
      loginA.textContent = 'Log in';

      var registerA = document.createElement('a');
      registerA.href = '/register.html';
      registerA.className = 'btn btn-primary btn-sm';
      registerA.textContent = 'Register';

      actionsEl.appendChild(loginA);
      actionsEl.appendChild(registerA);

    } else if (user.role === 'CUSTOMER') {
      links = CUSTOMER_NAV.slice();

    } else if (user.role === 'PROVIDER') {
      links = PROVIDER_NAV.slice();

    } else if (user.role === 'ADMIN') {
      // Filter admin links by permission
      var perms = user.permissions || [];
      links = ADMIN_NAV.filter(function (item) {
        if (!item.permission) return true;
        return perms.indexOf(item.permission) !== -1;
      });

    } else if (user.role === 'SUPER_ADMIN') {
      // All admin links (no filter) + super admin extras
      links = ADMIN_NAV.map(function (item) {
        return { label: item.label, href: item.href };
      }).concat(SUPERADMIN_EXTRA);
    }

    /* Render desktop links */
    links.forEach(function (item) {
      linksEl.appendChild(makeNavLink(item.label, item.href, false));
    });

    /* Avatar / logout for logged-in users */
    if (user) {
      var avatarWrap = document.createElement('div');
      avatarWrap.style.display = 'flex';
      avatarWrap.style.alignItems = 'center';
      avatarWrap.style.gap = 'var(--sp-2)';

      var userName = document.createElement('span');
      userName.style.fontSize = 'var(--text-sm)';
      userName.style.color = 'var(--color-text-muted)';
      userName.style.maxWidth = '120px';
      userName.style.overflow = 'hidden';
      userName.style.textOverflow = 'ellipsis';
      userName.style.whiteSpace = 'nowrap';
      userName.textContent = user.name || user.email;   // textContent — safe

      var logoutBtn = document.createElement('button');
      logoutBtn.type = 'button';
      logoutBtn.className = 'btn btn-ghost btn-sm';
      logoutBtn.id = 'nav-logout-btn';
      logoutBtn.textContent = 'Log out';
      logoutBtn.addEventListener('click', function () {
        UI.setLoading(logoutBtn, true);
        Auth.logout().catch(function () { UI.setLoading(logoutBtn, false); });
      });

      avatarWrap.appendChild(userName);
      avatarWrap.appendChild(logoutBtn);
      actionsEl.appendChild(avatarWrap);
    }

    actionsEl.appendChild(toggle);

    nav.appendChild(brand);
    nav.appendChild(linksEl);
    nav.appendChild(actionsEl);
    headerEl.appendChild(nav);

    /* ── Mobile drawer ──── */
    var drawer = document.createElement('div');
    drawer.id = 'nav-drawer';
    drawer.className = 'nav-drawer';
    drawer.setAttribute('aria-label', 'Mobile navigation');

    links.forEach(function (item) {
      drawer.appendChild(makeNavLink(item.label, item.href, true));
    });

    if (!user) {
      var mLoginA = document.createElement('a');
      mLoginA.href = '/login.html';
      mLoginA.className = 'btn btn-secondary btn-sm';
      mLoginA.textContent = 'Log in';
      drawer.appendChild(mLoginA);

      var mRegA = document.createElement('a');
      mRegA.href = '/register.html';
      mRegA.className = 'btn btn-primary btn-sm';
      mRegA.textContent = 'Register';
      drawer.appendChild(mRegA);
    } else {
      var mLogoutBtn = document.createElement('button');
      mLogoutBtn.type = 'button';
      mLogoutBtn.className = 'btn btn-ghost btn-sm';
      mLogoutBtn.textContent = 'Log out';
      mLogoutBtn.addEventListener('click', function () { Auth.logout(); });
      drawer.appendChild(mLogoutBtn);
    }

    document.body.insertBefore(drawer, document.body.firstChild.nextSibling || null);

    /* Toggle behaviour */
    toggle.addEventListener('click', function () {
      var expanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!expanded));
      drawer.classList.toggle('open', !expanded);
    });

    /* Close drawer when a link inside it is clicked */
    drawer.addEventListener('click', function (e) {
      if (e.target.tagName === 'A' || e.target.tagName === 'BUTTON') {
        drawer.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* ── buildFooter ──────────────────────────────────────────── */

  function buildFooter() {
    var footerEl = document.getElementById('site-footer');
    if (!footerEl) return;

    var inner = document.createElement('div');
    inner.className = 'footer-inner container';

    /* Brand column */
    var brandCol = document.createElement('div');

    var brandName = document.createElement('p');
    brandName.className = 'footer-brand';
    brandName.textContent = 'MakeMyTour';

    var tagline = document.createElement('p');
    tagline.className = 'footer-tagline';
    tagline.textContent = 'Discover local tourism packages crafted by trusted local providers.';

    brandCol.appendChild(brandName);
    brandCol.appendChild(tagline);

    /* Explore column */
    var exploreCol = document.createElement('div');
    var exploreTitle = document.createElement('p');
    exploreTitle.style.color = 'white';
    exploreTitle.style.fontWeight = 'var(--font-semi)';
    exploreTitle.style.marginBottom = 'var(--sp-3)';
    exploreTitle.textContent = 'Explore';

    var exploreLinks = document.createElement('div');
    exploreLinks.className = 'footer-links';
    [
      { label: 'Destinations', href: '/destinations.html' },
      { label: 'Packages',     href: '/packages.html' },
      { label: 'Register',     href: '/register.html' }
    ].forEach(function (item) {
      var a = document.createElement('a');
      a.href = item.href;
      a.textContent = item.label;
      exploreLinks.appendChild(a);
    });

    exploreCol.appendChild(exploreTitle);
    exploreCol.appendChild(exploreLinks);

    /* Account column */
    var accountCol = document.createElement('div');
    var accountTitle = document.createElement('p');
    accountTitle.style.color = 'white';
    accountTitle.style.fontWeight = 'var(--font-semi)';
    accountTitle.style.marginBottom = 'var(--sp-3)';
    accountTitle.textContent = 'Account';

    var accountLinks = document.createElement('div');
    accountLinks.className = 'footer-links';
    [
      { label: 'Log in',    href: '/login.html' },
      { label: 'Register',  href: '/register.html' },
      { label: 'My Profile', href: '/profile.html' }
    ].forEach(function (item) {
      var a = document.createElement('a');
      a.href = item.href;
      a.textContent = item.label;
      accountLinks.appendChild(a);
    });

    accountCol.appendChild(accountTitle);
    accountCol.appendChild(accountLinks);

    inner.appendChild(brandCol);
    inner.appendChild(exploreCol);
    inner.appendChild(accountCol);

    /* Bottom bar */
    var bottom = document.createElement('div');
    bottom.className = 'footer-bottom container';
    var year = new Date().getFullYear();
    bottom.textContent = '© ' + year + ' MakeMyTour · Local Tourism Package Booking System · WebTech Assessment';

    footerEl.appendChild(inner);
    footerEl.appendChild(bottom);
  }

  /* ── Init ─────────────────────────────────────────────────── */

  document.addEventListener('DOMContentLoaded', function () {
    Auth.getUser()
      .then(function (user) {
        buildHeader(user);
        buildFooter();
      })
      .catch(function () {
        // If /api/auth/me itself fails (server not up), still render a public header
        buildHeader(null);
        buildFooter();
      });
  });

}());
