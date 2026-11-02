/* Live-site API client: talks to the Node server. The preview build swaps this file for api-preview.js. */
(function () {
  'use strict';

  async function call(method, url, body) {
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
        credentials: 'same-origin'
      });
    } catch (e) {
      throw Object.assign(new Error("Couldn't reach the server. Check your connection and try again."), { status: 0 });
    }
    let data = {};
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong. Please try again.'), { status: res.status, data });
    return data;
  }
  const q = (o) => Object.keys(o).filter((k) => o[k] != null).map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(o[k])).join('&');

  window.API = {
    mode: 'live',
    config: () => call('GET', '/api/config'),
    schedule: () => call('GET', '/api/schedule'),
    createBooking: (payload) => call('POST', '/api/bookings', payload),
    getBooking: (id, t, sessionId) => call('GET', '/api/bookings/' + encodeURIComponent(id) + '?' + q({ t, session_id: sessionId })),
    cancelPending: (id, t) => call('POST', '/api/bookings/' + encodeURIComponent(id) + '/cancel', { t }),
    testPay: (id, t) => call('POST', '/api/bookings/' + encodeURIComponent(id) + '/test-pay', { t }),
    calendarUrl: (id, t) => '/api/bookings/' + encodeURIComponent(id) + '/calendar.ics?' + q({ t }),
    winterCheck: (code) => call('POST', '/api/winter/check', { code }),
    winterEnroll: (payload) => call('POST', '/api/winter/enroll', payload),
    siteUrl: () => location.origin,
    admin: {
      hint: '',
      me: () => call('GET', '/api/admin/me'),
      login: (password) => call('POST', '/api/admin/login', { password }),
      logout: () => call('POST', '/api/admin/logout'),
      overview: () => call('GET', '/api/admin/overview'),
      cancelBooking: (id) => call('POST', '/api/admin/bookings/' + encodeURIComponent(id) + '/cancel', {}),
      addClosure: (c) => call('POST', '/api/admin/closures', c),
      removeClosure: (date, track) => call('DELETE', '/api/admin/closures?' + q({ date, track })),
      winter: () => call('GET', '/api/admin/winter'),
      createInvite: (inv) => call('POST', '/api/admin/invites', inv),
      revokeInvite: (code) => call('POST', '/api/admin/invites/' + encodeURIComponent(code) + '/revoke', {})
    }
  };
})();
