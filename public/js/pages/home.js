/**
 * pages/home.js — Public landing page logic
 * Owner: M2 (Meharnaz)
 * Contract: docs/CONTRACT.md §1.8
 *
 * Depends on: api.js, ui.js, auth.js, layout.js
 *
 * Features:
 *  1. Attempt to load destinations and featured packages from the API.
 *  2. Show honest loading → empty/error states if the backend is not ready.
 *  3. Handle the search form — navigates to packages.html with a query.
 *  4. Never fabricates data; never silently swallows errors.
 */

(function () {
  'use strict';

  /* ── DOM refs ──────────────────────────────────────────────── */
  var destList       = document.getElementById('home-dest-list');
  var featuredGrid   = document.getElementById('home-featured-grid');
  var searchForm     = document.getElementById('home-search-form');
  var searchInput    = document.getElementById('home-search-input');
  var heroSearchForm = document.getElementById('hero-search-form');
  var heroSearchInput= document.getElementById('hero-search-input');

  /* ── Destination chips ─────────────────────────────────────── */

  function loadDestinations() {
    if (!destList) return;
    UI.showLoading(destList, 'Loading destinations…');

    api.get('/api/destinations').then(function (res) {
      var items = res.data;
      destList.innerHTML = '';   // safe — no user content yet

      if (!items || !items.length) {
        UI.empty(destList, 'No destinations listed yet. Check back soon!');
        return;
      }

      items.forEach(function (dest) {
        var a = document.createElement('a');
        a.className = 'dest-chip';
        a.href = '/packages.html?destination_id=' + encodeURIComponent(dest.destination_id);

        var icon = document.createElement('span');
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = '📍';

        var label = document.createElement('span');
        label.textContent = dest.name;   // textContent — safe

        var count = document.createElement('span');
        count.style.color = 'var(--color-text-muted)';
        count.style.fontSize = 'var(--text-xs)';
        if (typeof dest.package_count === 'number') {
          count.textContent = '(' + dest.package_count + ')';
        }

        a.appendChild(icon);
        a.appendChild(label);
        if (dest.package_count !== undefined) a.appendChild(count);
        destList.appendChild(a);
      });

    }).catch(function (err) {
      if (err && err.code === 'NETWORK_ERROR') {
        UI.showError(destList, 'Backend server is not running yet. Start the server and refresh.');
      } else {
        UI.showError(destList, err.message || 'Could not load destinations.');
      }
    });
  }

  /* ── Package card builder ──────────────────────────────────── */

  function buildPackageCard(pkg) {
    var a = document.createElement('a');
    a.className = 'pkg-card';
    a.href = '/package-detail.html?id=' + encodeURIComponent(pkg.package_id);

    /* Image */
    var imgWrap = document.createElement('div');
    imgWrap.className = 'pkg-card-img';

    if (pkg.image) {
      var img = document.createElement('img');
      img.src = '/images/' + pkg.image;
      img.alt = pkg.title;   // pkg.title is server data, safe for alt attribute
      img.loading = 'lazy';
      imgWrap.appendChild(img);
    } else {
      var placeholder = document.createElement('div');
      placeholder.className = 'pkg-card-img-placeholder';
      placeholder.setAttribute('aria-hidden', 'true');
      placeholder.textContent = '🏔️';
      imgWrap.appendChild(placeholder);
    }

    /* Badge (category) */
    if (pkg.category_name) {
      var badgeWrap = document.createElement('div');
      badgeWrap.className = 'pkg-card-badge';
      var badge = document.createElement('span');
      badge.className = 'badge badge-active';
      badge.textContent = pkg.category_name;
      badgeWrap.appendChild(badge);
      imgWrap.appendChild(badgeWrap);
    }

    /* Body */
    var body = document.createElement('div');
    body.className = 'pkg-card-body';

    var dest = document.createElement('p');
    dest.className = 'pkg-card-dest';
    dest.textContent = (pkg.destination_name || '') +
      (pkg.state ? ', ' + pkg.state : '');

    var title = document.createElement('h3');
    title.className = 'pkg-card-title';
    title.textContent = pkg.title;   // textContent — safe

    /* Meta row */
    var meta = document.createElement('div');
    meta.className = 'pkg-card-meta';

    if (pkg.duration_days) {
      var durItem = document.createElement('span');
      durItem.className = 'pkg-card-meta-item';
      durItem.textContent = '🗓 ' + pkg.duration_days + ' day' + (pkg.duration_days !== 1 ? 's' : '');
      meta.appendChild(durItem);
    }

    if (pkg.next_available_date) {
      var dateItem = document.createElement('span');
      dateItem.className = 'pkg-card-meta-item';
      dateItem.textContent = '📅 Next: ' + UI.date(pkg.next_available_date);
      meta.appendChild(dateItem);
    }

    if (pkg.avg_rating !== null && pkg.avg_rating !== undefined) {
      var ratingItem = document.createElement('span');
      ratingItem.className = 'pkg-card-meta-item';
      var rating = Number(pkg.avg_rating).toFixed(1);
      ratingItem.textContent = '⭐ ' + rating + ' (' + (pkg.review_count || 0) + ')';
      meta.appendChild(ratingItem);
    }

    body.appendChild(dest);
    body.appendChild(title);
    body.appendChild(meta);

    /* Footer */
    var footer = document.createElement('div');
    footer.className = 'pkg-card-footer';

    var priceWrap = document.createElement('div');
    var price = document.createElement('p');
    price.className = 'pkg-card-price';
    price.textContent = UI.money(pkg.price);

    var priceLabel = document.createElement('p');
    priceLabel.className = 'pkg-card-price-label';
    priceLabel.textContent = 'per person';

    priceWrap.appendChild(price);
    priceWrap.appendChild(priceLabel);

    var viewBtn = document.createElement('span');
    viewBtn.className = 'btn btn-primary btn-sm';
    viewBtn.setAttribute('aria-hidden', 'true');
    viewBtn.textContent = 'View';

    footer.appendChild(priceWrap);
    footer.appendChild(viewBtn);

    a.appendChild(imgWrap);
    a.appendChild(body);
    a.appendChild(footer);

    return a;
  }

  /* ── Featured packages ─────────────────────────────────────── */

  function loadFeaturedPackages() {
    if (!featuredGrid) return;
    UI.showLoading(featuredGrid, 'Loading packages…');

    api.get('/api/packages', { pageSize: 6, sort: 'rating' }).then(function (res) {
      var items = res.data;
      featuredGrid.innerHTML = '';

      if (!items || !items.length) {
        UI.empty(featuredGrid, 'No packages are available yet. Providers will add them soon!');
        return;
      }

      items.forEach(function (pkg) {
        featuredGrid.appendChild(buildPackageCard(pkg));
      });

    }).catch(function (err) {
      if (err && err.code === 'NETWORK_ERROR') {
        UI.showError(featuredGrid, 'Backend server is not running yet. Start the server and refresh.');
      } else {
        UI.showError(featuredGrid, err.message || 'Could not load packages.');
      }
    });
  }

  /* ── Search forms ──────────────────────────────────────────── */

  function handleSearch(input) {
    var q = input ? input.value.trim() : '';
    var url = '/packages.html';
    if (q) url += '?q=' + encodeURIComponent(q);
    window.location.href = url;
  }

  if (heroSearchForm) {
    heroSearchForm.addEventListener('submit', function (e) {
      e.preventDefault();
      handleSearch(heroSearchInput);
    });
  }

  if (searchForm) {
    searchForm.addEventListener('submit', function (e) {
      e.preventDefault();
      handleSearch(searchInput);
    });
  }

  /* ── Init ──────────────────────────────────────────────────── */

  document.addEventListener('DOMContentLoaded', function () {
    loadDestinations();
    loadFeaturedPackages();
  });

}());
