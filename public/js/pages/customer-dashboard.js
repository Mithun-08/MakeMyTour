// public/js/pages/customer-dashboard.js
(function () {
  'use strict';
  // Ensure only CUSTOMER can access
  Auth.requireRole(['CUSTOMER']).then(init);

  function init(user) {
    // Welcome message
    var welcomeEl = document.getElementById('welcome-section');
    if (welcomeEl) {
      var name = user.name || user.email;
      welcomeEl.textContent = `Welcome, ${name}!`;
    }

    // Load bookings to compute a simple summary
    var summaryEl = document.getElementById('summary-section');
    if (!summaryEl) return;
    UI.setLoading(summaryEl, true);
    api.get('/api/bookings/mine')
      .then(function (resp) {
        var bookings = resp.data || [];
        var counts = { PENDING: 0, CONFIRMED: 0, CANCELLED: 0, COMPLETED: 0 };
        bookings.forEach(function (b) {
          var st = b.booking_status;
          if (counts[st] !== undefined) counts[st]++;
        });
        var html = `<h2>Booking Summary</h2>
          <ul>
            <li>Pending: ${counts.PENDING}</li>
            <li>Confirmed: ${counts.CONFIRMED}</li>
            <li>Cancelled: ${counts.CANCELLED}</li>
            <li>Completed: ${counts.COMPLETED}</li>
          </ul>`;
        summaryEl.innerHTML = html;
      })
      .catch(function (err) {
        UI.toast('Failed to load bookings summary', 'error');
        UI.empty(summaryEl, 'Unable to load summary');
      })
      .finally(function () { UI.setLoading(summaryEl, false); });
  }
})();
