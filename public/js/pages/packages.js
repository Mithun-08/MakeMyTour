/**
 * pages/packages.js — Public package browsing (search + filters)
 * Owner: M2 (Meharnaz)
 * Contract: docs/CONTRACT.md — GET /api/packages, GET /api/destinations, GET /api/categories
 *
 * Depends on: api.js, ui.js, auth.js, layout.js
 *
 * Behaviour:
 *  - Reads filters from the URL (?q=&destination_id=&category_id=&min_price=&max_price=&sort=&page=)
 *    so links from the home page (and browser back/forward) work.
 *  - Only sends query params that the contract defines for GET /api/packages.
 *  - Renders API text with textContent / createElement only (no innerHTML with data).
 *  - Shows loading, error and empty states; never fabricates package data.
 */

(function () {
  'use strict';

  var PAGE_SIZE = 9;
  var FILTER_KEYS = ['q', 'destination_id', 'category_id', 'min_price', 'max_price', 'sort'];

  /* ── DOM refs ──────────────────────────────────────────────── */
  var form        = document.getElementById('pkg-filter-form');
  var searchInput = document.getElementById('pkg-search-input');
  var destSelect  = document.getElementById('pkg-filter-destination');
  var catSelect   = document.getElementById('pkg-filter-category');
  var minPrice    = document.getElementById('pkg-filter-min-price');
  var maxPrice    = document.getElementById('pkg-filter-max-price');
  var sortSelect  = document.getElementById('pkg-filter-sort');
  var resetBtn    = document.getElementById('pkg-filter-reset');
  var filterError = document.getElementById('pkg-filter-error');
  var results     = document.getElementById('pkg-results');
  var countEl     = document.getElementById('pkg-result-count');
  var pagerEl     = document.getElementById('pkg-pager');

  var fields = {
    q: searchInput, destination_id: destSelect, category_id: catSelect,
    min_price: minPrice, max_price: maxPrice, sort: sortSelect
  };

  var requestSeq = 0;   // ignore out-of-order responses

  /* ── URL <-> state ─────────────────────────────────────────── */

  function readStateFromUrl() {
    var sp = new URLSearchParams(window.location.search);
    var state = {};
    FILTER_KEYS.forEach(function (k) {
      var v = sp.get(k);
      if (v !== null && v.trim() !== '') state[k] = v.trim();
    });
    var page = parseInt(sp.get('page'), 10);
    state.page = page > 0 ? page : 1;
    return state;
  }

  function writeStateToUrl(state, push) {
    var sp = new URLSearchParams();
    FILTER_KEYS.forEach(function (k) { if (state[k]) sp.set(k, state[k]); });
    if (state.page > 1) sp.set('page', String(state.page));
    var qs = sp.toString();
    var url = window.location.pathname + (qs ? '?' + qs : '');
    if (push) history.pushState(null, '', url);
    else history.replaceState(null, '', url);
  }

  function applyStateToForm(state) {
    FILTER_KEYS.forEach(function (k) {
      if (fields[k]) fields[k].value = state[k] || '';
    });
  }

  function readStateFromForm() {
    var state = {};
    FILTER_KEYS.forEach(function (k) {
      var v = fields[k] ? String(fields[k].value).trim() : '';
      if (v) state[k] = v;
    });
    state.page = 1;
    return state;
  }

  function validate(state) {
    var min = state.min_price !== undefined ? Number(state.min_price) : null;
    var max = state.max_price !== undefined ? Number(state.max_price) : null;
    if ((min !== null && (isNaN(min) || min < 0)) || (max !== null && (isNaN(max) || max < 0))) {
      return 'Prices must be zero or a positive number.';
    }
    if (min !== null && max !== null && min > max) {
      return 'Min price cannot be greater than max price.';
    }
    return '';
  }

  function showFilterError(msg) {
    filterError.textContent = msg;
    filterError.hidden = !msg;
    minPrice.classList.toggle('is-error', !!msg);
    maxPrice.classList.toggle('is-error', !!msg);
  }

  /* ── Filter dropdowns ──────────────────────────────────────── */

  function fillSelect(select, items, valueKey, labelFn, selected) {
    // Keep the first "All …" option, drop the rest
    while (select.options.length > 1) select.remove(1);
    (items || []).forEach(function (item) {
      var opt = document.createElement('option');
      opt.value = String(item[valueKey]);
      opt.textContent = labelFn(item);   // textContent — safe
      select.appendChild(opt);
    });
    if (selected) select.value = selected;
  }

  function loadFilterOptions(state) {
    var destP = api.get('/api/destinations').then(function (res) {
      fillSelect(destSelect, res.data, 'destination_id', function (d) {
        return d.name + (d.state ? ', ' + d.state : '');
      }, state.destination_id);
    });
    var catP = api.get('/api/categories').then(function (res) {
      fillSelect(catSelect, res.data, 'category_id', function (c) {
        return c.category_name;
      }, state.category_id);
    });
    // Filter options failing should not block package results; just note it.
    Promise.all([destP, catP]).catch(function () {
      UI.toast('Some filter options could not be loaded.', 'info');
    });
  }

  /* ── Card builder ──────────────────────────────────────────── */

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function buildPackageCard(pkg) {
    var detailUrl = '/package-detail.html?id=' + encodeURIComponent(pkg.package_id);

    var card = el('article', 'pkg-card');

    /* Image */
    var imgWrap = el('div', 'pkg-card-img');
    if (pkg.image) {
      var img = document.createElement('img');
      img.src = '/images/' + encodeURIComponent(pkg.image);
      img.alt = pkg.title || 'Package image';
      img.loading = 'lazy';
      img.addEventListener('error', function () {
        imgWrap.replaceChild(placeholder(), img);
      });
      imgWrap.appendChild(img);
    } else {
      imgWrap.appendChild(placeholder());
    }
    if (pkg.category_name) {
      var badgeWrap = el('div', 'pkg-card-badge');
      badgeWrap.appendChild(el('span', 'badge badge-active', pkg.category_name));
      imgWrap.appendChild(badgeWrap);
    }

    /* Body */
    var body = el('div', 'pkg-card-body');
    var place = [pkg.destination_name, pkg.state].filter(Boolean).join(', ');
    body.appendChild(el('p', 'pkg-card-dest', place ? '📍 ' + place : ''));
    var titleH3 = el('h3', 'pkg-card-title');
    var titleLink = el('a', null, pkg.title);
    titleLink.href = detailUrl;
    titleLink.style.color = 'inherit';
    titleLink.style.textDecoration = 'none';
    titleH3.appendChild(titleLink);
    body.appendChild(titleH3);

    var meta = el('div', 'pkg-card-meta');
    if (pkg.duration_days) {
      var d = Number(pkg.duration_days);
      meta.appendChild(el('span', 'pkg-card-meta-item', '🗓 ' + d + ' day' + (d !== 1 ? 's' : '')));
    }
    if (pkg.avg_rating !== null && pkg.avg_rating !== undefined) {
      meta.appendChild(el('span', 'pkg-card-meta-item',
        '⭐ ' + Number(pkg.avg_rating).toFixed(1) + ' (' + (pkg.review_count || 0) + ')'));
    }
    if (pkg.next_available_date) {
      meta.appendChild(el('span', 'pkg-card-meta-item', '📅 Next: ' + UI.date(pkg.next_available_date)));
    }
    if (pkg.provider_name) {
      meta.appendChild(el('span', 'pkg-card-meta-item', '🧑‍💼 ' + pkg.provider_name));
    }
    body.appendChild(meta);

    /* Footer */
    var footer = el('div', 'pkg-card-footer');
    var priceWrap = el('div');
    priceWrap.appendChild(el('p', 'pkg-card-price', UI.money(pkg.price)));
    priceWrap.appendChild(el('p', 'pkg-card-price-label', 'per person'));

    var link = el('a', 'btn btn-primary btn-sm', 'View details');
    link.href = detailUrl;
    link.setAttribute('aria-label', 'View details for ' + (pkg.title || 'package'));

    footer.appendChild(priceWrap);
    footer.appendChild(link);

    card.appendChild(imgWrap);
    card.appendChild(body);
    card.appendChild(footer);
    return card;
  }

  function placeholder() {
    var p = el('div', 'pkg-card-img-placeholder', '🏔️');
    p.setAttribute('aria-hidden', 'true');
    return p;
  }

  /* ── Load packages ─────────────────────────────────────────── */

  function hasActiveFilters(state) {
    return FILTER_KEYS.some(function (k) { return k !== 'sort' && state[k]; });
  }

  function loadPackages(state) {
    var seq = ++requestSeq;
    var params = { page: state.page, pageSize: PAGE_SIZE };
    FILTER_KEYS.forEach(function (k) { if (state[k]) params[k] = state[k]; });

    results.setAttribute('aria-busy', 'true');
    countEl.textContent = '';
    pagerEl.innerHTML = '';   // safe — no user content
    UI.showLoading(results, 'Loading packages…');

    api.get('/api/packages', params).then(function (res) {
      if (seq !== requestSeq) return;
      var items = Array.isArray(res.data) ? res.data : [];
      results.innerHTML = '';   // safe — clearing only

      if (!items.length) {
        UI.empty(results, hasActiveFilters(state)
          ? 'No packages match your search. Try different keywords or clear the filters.'
          : 'No packages are available yet. Please check back soon.');
        return;
      }

      items.forEach(function (pkg) { results.appendChild(buildPackageCard(pkg)); });

      var total = res.meta && typeof res.meta.total === 'number' ? res.meta.total : items.length;
      countEl.textContent = total + ' package' + (total !== 1 ? 's' : '') + ' found';

      if (res.meta) {
        UI.pager(pagerEl, res.meta, function (page) {
          state.page = page;
          writeStateToUrl(state, true);
          loadPackages(state);
          results.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      }
    }).catch(function (err) {
      if (seq !== requestSeq) return;
      if (err && err.code === 'NETWORK_ERROR') {
        UI.showError(results, 'Could not reach the server. Make sure the backend is running, then refresh.');
      } else if (err && err.status === 404) {
        UI.showError(results, 'The package catalogue is not available yet (API not implemented).');
      } else {
        UI.showError(results, (err && err.message) || 'Could not load packages.');
      }
    }).then(function () {
      if (seq === requestSeq) results.setAttribute('aria-busy', 'false');
    });
  }

  /* ── Events ────────────────────────────────────────────────── */

  function submitFilters() {
    var state = readStateFromForm();
    var msg = validate(state);
    showFilterError(msg);
    if (msg) return;
    writeStateToUrl(state, true);
    loadPackages(state);
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    submitFilters();
  });

  // Dropdowns apply immediately; text/number inputs apply after a short pause.
  [destSelect, catSelect, sortSelect].forEach(function (s) {
    s.addEventListener('change', submitFilters);
  });
  var debounced = UI.debounce(submitFilters, 450);
  [searchInput, minPrice, maxPrice].forEach(function (i) {
    i.addEventListener('input', debounced);
  });

  resetBtn.addEventListener('click', function () {
    form.reset();
    showFilterError('');
    submitFilters();
  });

  window.addEventListener('popstate', function () {
    var state = readStateFromUrl();
    applyStateToForm(state);
    showFilterError('');
    loadPackages(state);
  });

  /* ── Init ──────────────────────────────────────────────────── */

  document.addEventListener('DOMContentLoaded', function () {
    var state = readStateFromUrl();
    applyStateToForm(state);
    writeStateToUrl(state, false);
    loadFilterOptions(state);
    loadPackages(state);
  });

}());
