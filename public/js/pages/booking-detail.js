(function () {
  'use strict';
  // Only customers can view booking details
  Auth.requireRole(['CUSTOMER']).then(init);

  function init(user) {
    var container = document.getElementById('booking-detail');
    if (!container) return;
    var params = new URLSearchParams(window.location.search);
    var bookingId = params.get('id');
    if (!bookingId) {
      UI.showError(container, 'Missing booking ID.');
      return;
    }
    UI.showLoading(container, 'Loading booking details…');
    // Fetch booking detail (owner view)
    api.get('/api/bookings/' + encodeURIComponent(bookingId))
      .then(function (resp) {
        var b = resp.data || {};
        renderDetail(b);
      })
      .catch(function (err) {
        if (err && err.status === 404) {
          UI.showError(container, 'Booking not found.');
        } else {
          UI.showError(container, (err && err.message) || 'Unable to load booking details.');
        }
      });

    function renderDetail(b) {
      container.innerHTML = '';
      var title = document.createElement('h2');
      title.textContent = 'Booking #' + b.booking_id;
      container.appendChild(title);

      var infoList = document.createElement('ul');
      infoList.className = 'booking-info';

      function li(label, value) {
        var li = document.createElement('li');
        li.textContent = label + ': ' + value;
        return li;
      }

      infoList.appendChild(li('Package', b.package_title || '—'));
      infoList.appendChild(li('Date', UI.date(b.available_date)));
      infoList.appendChild(li('Travelers', b.travelers || '—'));
      infoList.appendChild(li('Total Amount', UI.money(b.total_amount)));
      infoList.appendChild(li('Booking Status', b.booking_status));
      infoList.appendChild(li('Payment Status', b.payment_status));

      container.appendChild(infoList);

      // Actions container
      var actions = document.createElement('div');
      actions.className = 'booking-actions';

      // Cancel button if allowed
      if (b.can_cancel) {
        var cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'btn btn-danger';
        cancelBtn.textContent = 'Cancel Booking';
        cancelBtn.addEventListener('click', function () {
          UI.confirm('Are you sure you want to cancel this booking?').then(function (ok) {
            if (!ok) return;
            UI.setLoading(cancelBtn, true);
            api.post('/api/bookings/' + encodeURIComponent(b.booking_id) + '/cancel')
              .then(function () {
                UI.toast('Booking cancelled successfully.', 'success');
                // Refresh details
                init(user);
              })
              .catch(function (err) {
                UI.toast((err && err.message) || 'Failed to cancel booking.', 'error');
              })
              .finally(function () { UI.setLoading(cancelBtn, false); });
          });
        });
        actions.appendChild(cancelBtn);
      }

      // Review button if eligible
      if (b.can_review && !b.has_review) {
        var reviewBtn = document.createElement('button');
        reviewBtn.type = 'button';
        reviewBtn.className = 'btn btn-primary';
        reviewBtn.textContent = 'Leave Review';
        reviewBtn.addEventListener('click', function () {
          // Navigate to a simple review page (placeholder)
          window.location.href = '/review.html?booking_id=' + encodeURIComponent(b.booking_id);
        });
        actions.appendChild(reviewBtn);
      }

      if (actions.children.length) {
        container.appendChild(actions);
      }
    }
  }
})();
