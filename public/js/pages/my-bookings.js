// public/js/pages/my-bookings.js
(function () {
  'use strict';
  // Only customers can view this page
  Auth.requireRole(['CUSTOMER']).then(init);

  function init() {
    var container = document.getElementById('bookings-list');
    if (!container) return;
    UI.setLoading(container, true);
    loadPage(1);

    function loadPage(page) {
      api.get('/api/bookings/mine', { page: page, pageSize: 10 })
        .then(function (resp) {
          renderList(resp.data, resp.meta);
        })
        .catch(function (err) {
          UI.toast('Failed to load bookings', 'error');
          UI.empty(container, 'Unable to load bookings');
        })
        .finally(function () { UI.setLoading(container, false); });
    }

    function renderList(bookings, meta) {
      container.innerHTML = '';
      if (!bookings.length) {
        UI.empty(container, 'No bookings yet.');
        return;
      }
      var table = document.createElement('table');
      table.className = 'table bookings-table';
      var thead = document.createElement('thead');
      thead.innerHTML = `<tr>
        <th>ID</th><th>Package</th><th>Date</th><th>Status</th><th>Payment</th><th>Actions</th>
      </tr>`;
      table.appendChild(thead);
      var tbody = document.createElement('tbody');
      bookings.forEach(function (b) {
        var tr = document.createElement('tr');
        tr.innerHTML = `<td>${b.booking_id}</td>
          <td>${UI.escapeHtml(b.package_title || b.title)}</td>
          <td>${UI.date(b.available_date)}</td>
          <td>${UI.statusBadge(b.booking_status).outerHTML}</td>
          <td>${UI.statusBadge(b.payment_status).outerHTML}</td>
          <td>
            <a href="/booking-detail.html?id=${b.booking_id}" class="btn btn-sm btn-primary">View</a>
          </td>`;
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      container.appendChild(table);

      // Pagination if meta present
      if (meta && meta.total > meta.pageSize) {
        UI.pager(container, meta, function (newPage) {
          UI.setLoading(container, true);
          loadPage(newPage);
        });
      }
    }
  }
})();
