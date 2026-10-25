/**
 * ui.js — Shared UI helper
 * Owner: M2 (Meharnaz)  |  Frozen after Day 1
 * Contract: docs/CONTRACT.md §1.8
 *
 * Exports a global `UI` object with these helpers:
 *   UI.toast(message, type)              – 'success' | 'error' | 'info'
 *   UI.confirm(message)                  – returns Promise<boolean>
 *   UI.escapeHtml(text)                  – safe string for text interpolation
 *   UI.money(n)                          – '₹1,234.00'
 *   UI.date(str)                         – human-readable date
 *   UI.statusBadge(status)               – <span class="badge badge-<status>">
 *   UI.setLoading(el, bool)              – busy state on element
 *   UI.empty(container, message)         – shows an empty-state block
 *   UI.showErrors(form, details)         – marks field-level validation errors
 *   UI.clearErrors(form)                 – clears all field-level errors
 *   UI.pager(container, meta, onPage)    – renders pagination controls
 *   UI.debounce(fn, ms)                  – debounce wrapper
 *   UI.showLoading(container, message?)  – renders a loading state block
 *   UI.showError(container, message?)    – renders an error state block
 *
 * Safety rules:
 *  - User-supplied text MUST go through textContent or UI.escapeHtml.
 *  - Never insert unescaped strings via innerHTML.
 *  - escapeHtml is the only approved path for string interpolation into HTML.
 */

(function () {
  'use strict';

  /* ── Toast ────────────────────────────────────────────────── */

  var toastContainer = null;

  function ensureToastContainer() {
    if (toastContainer && document.body.contains(toastContainer)) {
      return toastContainer;
    }
    toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
      toastContainer = document.createElement('div');
      toastContainer.id = 'toast-container';
      document.body.appendChild(toastContainer);
    }
    return toastContainer;
  }

  var TOAST_ICONS = { success: '✓', error: '✕', info: 'ℹ' };
  var TOAST_LABELS = { success: 'Success', error: 'Error', info: 'Information' };

  /**
   * Show a toast notification.
   * @param {string} message
   * @param {'success'|'error'|'info'} [type='info']
   * @param {number} [duration=4000] ms before auto-dismiss
   */
  function toast(message, type, duration) {
    type     = type     || 'info';
    duration = duration || 4000;

    var container = ensureToastContainer();

    var el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.setAttribute('role', 'alert');
    el.setAttribute('aria-live', 'polite');

    var iconEl = document.createElement('span');
    iconEl.className = 'toast-icon';
    iconEl.setAttribute('aria-hidden', 'true');
    iconEl.textContent = TOAST_ICONS[type] || 'ℹ';

    var msgEl = document.createElement('span');
    msgEl.className = 'toast-msg';
    msgEl.textContent = message;   // textContent — safe

    var closeEl = document.createElement('button');
    closeEl.className = 'toast-close';
    closeEl.setAttribute('type', 'button');
    closeEl.setAttribute('aria-label', 'Dismiss ' + (TOAST_LABELS[type] || 'notification'));
    closeEl.textContent = '×';

    el.appendChild(iconEl);
    el.appendChild(msgEl);
    el.appendChild(closeEl);
    container.appendChild(el);

    function dismiss() {
      el.classList.add('toast-leaving');
      el.addEventListener('animationend', function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, { once: true });
      // Fallback removal in case animationend never fires
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 400);
    }

    closeEl.addEventListener('click', dismiss);
    var timer = setTimeout(dismiss, duration);

    // Pause auto-dismiss on hover
    el.addEventListener('mouseenter', function () { clearTimeout(timer); });
    el.addEventListener('mouseleave', function () { timer = setTimeout(dismiss, duration); });
  }

  /* ── Confirm dialog ───────────────────────────────────────── */

  /**
   * Show a modal confirmation dialog.
   * @param {string} message
   * @returns {Promise<boolean>}
   */
  function confirm(message) {
    return new Promise(function (resolve) {
      var backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      backdrop.setAttribute('role', 'dialog');
      backdrop.setAttribute('aria-modal', 'true');
      backdrop.setAttribute('aria-labelledby', 'confirm-title');

      var modal = document.createElement('div');
      modal.className = 'modal';

      var header = document.createElement('div');
      header.className = 'modal-header';

      var title = document.createElement('h2');
      title.className = 'modal-title';
      title.id = 'confirm-title';
      title.textContent = 'Confirm Action';

      header.appendChild(title);

      var body = document.createElement('div');
      body.className = 'modal-body';

      var msg = document.createElement('p');
      msg.textContent = message;   // textContent — safe
      body.appendChild(msg);

      var footer = document.createElement('div');
      footer.className = 'modal-footer';

      var cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn btn-ghost';
      cancelBtn.textContent = 'Cancel';

      var okBtn = document.createElement('button');
      okBtn.type = 'button';
      okBtn.className = 'btn btn-danger';
      okBtn.textContent = 'Confirm';

      footer.appendChild(cancelBtn);
      footer.appendChild(okBtn);

      modal.appendChild(header);
      modal.appendChild(body);
      modal.appendChild(footer);
      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);

      // Trap focus on the two buttons
      okBtn.focus();

      function close(result) {
        document.body.removeChild(backdrop);
        resolve(result);
      }

      cancelBtn.addEventListener('click', function () { close(false); });
      okBtn.addEventListener('click',     function () { close(true);  });

      // Dismiss on backdrop click (outside modal)
      backdrop.addEventListener('click', function (e) {
        if (e.target === backdrop) close(false);
      });

      // Dismiss on Escape
      function onKeyDown(e) {
        if (e.key === 'Escape') { document.removeEventListener('keydown', onKeyDown); close(false); }
      }
      document.addEventListener('keydown', onKeyDown);
    });
  }

  /* ── escapeHtml ───────────────────────────────────────────── */

  var ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  /**
   * Escape a string so it is safe to embed in an HTML attribute or tag body.
   * Prefer textContent where possible; use this only for string interpolation.
   * @param {*} text
   * @returns {string}
   */
  function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    return String(text).replace(/[&<>"']/g, function (ch) { return ESC_MAP[ch]; });
  }

  /* ── money ────────────────────────────────────────────────── */

  /**
   * Format a number as Indian rupees.
   * @param {number|string} n
   * @returns {string}  e.g. '₹1,234.00'
   */
  function money(n) {
    var num = Number(n);
    if (isNaN(num)) return '₹—';
    return '₹' + num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /* ── date ─────────────────────────────────────────────────── */

  /**
   * Format a YYYY-MM-DD date string or ISO timestamp into a readable form.
   * @param {string} str
   * @returns {string}  e.g. '26 Oct 2026'
   */
  function date(str) {
    if (!str) return '—';
    var d = new Date(str);
    if (isNaN(d.getTime())) return String(str);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  /* ── statusBadge ──────────────────────────────────────────── */

  /**
   * Return a <span> element with the appropriate badge classes.
   * Status strings are normalised to lowercase for the class name.
   * Text is set via textContent (safe).
   * @param {string} status
   * @returns {HTMLElement}
   */
  function statusBadge(status) {
    var span = document.createElement('span');
    var lower = status ? String(status).toLowerCase() : 'unknown';
    span.className = 'badge badge-' + lower;
    span.textContent = status || 'Unknown';
    return span;
  }

  /* ── setLoading ───────────────────────────────────────────── */

  /**
   * Put an element into / out of a loading (busy) state.
   * Disables the element and sets aria-busy when loading.
   * Stores and restores original textContent when used on buttons.
   * @param {HTMLElement} el
   * @param {boolean} bool
   */
  function setLoading(el, bool) {
    if (!el) return;
    if (bool) {
      el.setAttribute('aria-busy', 'true');
      el.disabled = true;
      if (el.tagName === 'BUTTON' || el.tagName === 'INPUT') {
        el.dataset.origText = el.textContent;
        el.textContent = 'Loading…';
      }
    } else {
      el.removeAttribute('aria-busy');
      el.disabled = false;
      if ((el.tagName === 'BUTTON' || el.tagName === 'INPUT') && el.dataset.origText) {
        el.textContent = el.dataset.origText;
        delete el.dataset.origText;
      }
    }
  }

  /* ── showLoading ──────────────────────────────────────────── */

  /**
   * Replace a container's content with a centred loading state.
   * @param {HTMLElement} container
   * @param {string} [message='Loading…']
   */
  function showLoading(container, message) {
    if (!container) return;
    container.innerHTML = '';   // safe — no user content

    var box = document.createElement('div');
    box.className = 'state-box state-loading';

    var spinner = document.createElement('div');
    spinner.className = 'spinner spinner-lg';
    spinner.setAttribute('role', 'status');
    spinner.setAttribute('aria-label', 'Loading');

    var text = document.createElement('p');
    text.className = 'state-box-body';
    text.textContent = message || 'Loading…';

    box.appendChild(spinner);
    box.appendChild(text);
    container.appendChild(box);
  }

  /* ── showError ────────────────────────────────────────────── */

  /**
   * Replace a container's content with a centred error state.
   * @param {HTMLElement} container
   * @param {string} [message]
   */
  function showError(container, message) {
    if (!container) return;
    container.innerHTML = '';   // safe — no user content

    var box = document.createElement('div');
    box.className = 'state-box state-error';

    var icon = document.createElement('div');
    icon.className = 'state-box-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '⚠️';

    var title = document.createElement('p');
    title.className = 'state-box-title';
    title.textContent = 'Something went wrong';

    var body = document.createElement('p');
    body.className = 'state-box-body';
    body.textContent = message || 'Unable to load data. Please try again.';

    box.appendChild(icon);
    box.appendChild(title);
    box.appendChild(body);
    container.appendChild(box);
  }

  /* ── empty ────────────────────────────────────────────────── */

  /**
   * Replace a container's content with an empty-state block.
   * @param {HTMLElement} container
   * @param {string} [message]
   */
  function empty(container, message) {
    if (!container) return;
    container.innerHTML = '';   // safe — no user content

    var box = document.createElement('div');
    box.className = 'state-box state-empty';

    var icon = document.createElement('div');
    icon.className = 'state-box-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '🗂️';

    var title = document.createElement('p');
    title.className = 'state-box-title';
    title.textContent = 'Nothing here yet';

    var body = document.createElement('p');
    body.className = 'state-box-body';
    body.textContent = message || 'No items to display.';

    box.appendChild(icon);
    box.appendChild(title);
    box.appendChild(body);
    container.appendChild(box);
  }

  /* ── showErrors / clearErrors ─────────────────────────────── */

  /**
   * Show server-side validation details on a form.
   * Matches the `name` attribute of inputs to keys in `details`.
   * Error text is written with textContent (safe).
   * @param {HTMLFormElement} form
   * @param {object} details  e.g. { email: 'Already taken', password: 'Too short' }
   */
  function showErrors(form, details) {
    if (!form || !details) return;
    clearErrors(form);
    Object.keys(details).forEach(function (fieldName) {
      var input = form.querySelector('[name="' + fieldName + '"]');
      if (!input) return;
      input.classList.add('is-error');

      var errorEl = input.parentNode
        ? input.parentNode.querySelector('.field-error')
        : null;
      if (errorEl) {
        errorEl.textContent = details[fieldName];   // textContent — safe
        errorEl.style.display = 'block';
      }
    });
  }

  /**
   * Clear all field-level errors from a form.
   * @param {HTMLFormElement} form
   */
  function clearErrors(form) {
    if (!form) return;
    var errorInputs = form.querySelectorAll('.is-error');
    errorInputs.forEach(function (el) { el.classList.remove('is-error'); });
    var errorEls = form.querySelectorAll('.field-error');
    errorEls.forEach(function (el) {
      el.textContent = '';
      el.style.display = 'none';
    });
  }

  /* ── pager ────────────────────────────────────────────────── */

  /**
   * Render pagination controls into a container element.
   * @param {HTMLElement} container
   * @param {{ page:number, pageSize:number, total:number }} meta
   * @param {function(page:number):void} onPage  callback when a page button is clicked
   */
  function pager(container, meta, onPage) {
    container.innerHTML = '';   // safe — no user content
    if (!meta || !meta.total) return;

    var totalPages = Math.ceil(meta.total / meta.pageSize);
    if (totalPages <= 1) return;

    var current = meta.page;
    var nav = document.createElement('nav');
    nav.className = 'pagination';
    nav.setAttribute('aria-label', 'Pagination');

    function makeBtn(label, page, isCurrent) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'page-btn' + (isCurrent ? ' active' : '');
      btn.textContent = label;   // textContent — safe
      btn.disabled = isCurrent;
      if (isCurrent) btn.setAttribute('aria-current', 'page');
      btn.setAttribute('aria-label', 'Page ' + label);
      btn.addEventListener('click', function () { onPage(page); });
      return btn;
    }

    // Previous
    var prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'page-btn';
    prevBtn.textContent = '‹';
    prevBtn.setAttribute('aria-label', 'Previous page');
    prevBtn.disabled = current <= 1;
    prevBtn.addEventListener('click', function () { onPage(current - 1); });
    nav.appendChild(prevBtn);

    // Page numbers — show up to 5 around current
    var start = Math.max(1, current - 2);
    var end   = Math.min(totalPages, current + 2);

    if (start > 1) {
      nav.appendChild(makeBtn('1', 1, false));
      if (start > 2) {
        var ellipsis = document.createElement('span');
        ellipsis.className = 'page-btn';
        ellipsis.textContent = '…';
        ellipsis.style.cursor = 'default';
        nav.appendChild(ellipsis);
      }
    }

    for (var p = start; p <= end; p++) {
      nav.appendChild(makeBtn(String(p), p, p === current));
    }

    if (end < totalPages) {
      if (end < totalPages - 1) {
        var ellipsis2 = document.createElement('span');
        ellipsis2.className = 'page-btn';
        ellipsis2.textContent = '…';
        ellipsis2.style.cursor = 'default';
        nav.appendChild(ellipsis2);
      }
      nav.appendChild(makeBtn(String(totalPages), totalPages, false));
    }

    // Next
    var nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'page-btn';
    nextBtn.textContent = '›';
    nextBtn.setAttribute('aria-label', 'Next page');
    nextBtn.disabled = current >= totalPages;
    nextBtn.addEventListener('click', function () { onPage(current + 1); });
    nav.appendChild(nextBtn);

    container.appendChild(nav);
  }

  /* ── debounce ─────────────────────────────────────────────── */

  /**
   * Return a debounced version of `fn` that waits `ms` milliseconds.
   * @param {function} fn
   * @param {number} ms
   * @returns {function}
   */
  function debounce(fn, ms) {
    var timer;
    return function () {
      var ctx  = this;
      var args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(ctx, args); }, ms);
    };
  }

  /* ── Public object ────────────────────────────────────────── */
  window.UI = {
    toast:       toast,
    confirm:     confirm,
    escapeHtml:  escapeHtml,
    money:       money,
    date:        date,
    statusBadge: statusBadge,
    setLoading:  setLoading,
    showLoading: showLoading,
    showError:   showError,
    empty:       empty,
    showErrors:  showErrors,
    clearErrors: clearErrors,
    pager:       pager,
    debounce:    debounce
  };

}());
