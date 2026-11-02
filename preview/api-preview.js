/*
 * Preview API: same interface as public/api-http.js, but everything runs in the browser
 * and is saved to localStorage. Used only by the hosted preview (scripts/build-preview.js).
 * Sample bookings and invites are marked `sample: true` and labelled "Example" in the dashboard.
 */
(function () {
  'use strict';
  var C = window.Core;
  var CFG = window.__NP_CONFIG__;
  var KEY = 'kbm-preview:v2';
  var PASSWORD = 'coach';
  var memory = null;
  var authed = false;

  function rnd(seed) { // small deterministic PRNG so sample data looks the same on every load
    var x = 0;
    for (var i = 0; i < seed.length; i++) x = (x * 31 + seed.charCodeAt(i)) >>> 0;
    return function () { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; };
  }
  function nowZ() { return C.nowInZone(CFG.timeZone); }
  function uid(prefix, n) { var s = ''; var a = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; for (var i = 0; i < n; i++) s += a[Math.floor(Math.random() * a.length)]; return prefix + s; }
  function err(status, message, data) { var e = new Error(message); e.status = status; e.data = Object.assign({ error: message }, data || {}); return e; }
  function later(v) { return new Promise(function (res) { setTimeout(function () { res(v); }, 180); }); }
  function fail(status, message, data) { return new Promise(function (res, rej) { setTimeout(function () { rej(err(status, message, data)); }, 180); }); }

  var FIRST = ['Maya', 'Leo', 'Ava', 'Mateo', 'Zoe', 'Noah', 'Isla', 'Eli', 'Nora', 'Kai', 'Lena', 'Omar', 'Ruby', 'Theo', 'Priya', 'Diego', 'Hana', 'Jonah', 'Sofia', 'Malik', 'Ivy', 'Luca', 'Amara', 'Finn'];
  var LAST = 'ABCDEFGHJKLMNPRSTVW';

  function seed() {
    var r = rnd('kb-movement');
    var n = nowZ();
    var sched = C.buildSchedule(CFG, n, {}, []);
    var db = { bookings: [], closures: [], invites: [], enrollments: [] };
    var fill = [[0.6, 0.95], [0.3, 0.65], [0.05, 0.35]];
    sched.weeks.slice(0, 3).forEach(function (w, wi) {
      CFG.tracks.forEach(function (t) {
        w.sessions[t.id].forEach(function (s, di) {
          if (s.status === 'past') return;
          var count;
          if (t.kind === 'private') count = r() < (wi === 0 ? 0.6 : 0.3) ? 1 : 0;
          else {
            var lo = fill[wi][0], hi = fill[wi][1];
            count = Math.round(t.capacity * (lo + r() * (hi - lo)));
            if (wi === 0 && t.id === 'g811' && di === 1) count = t.capacity; // one full session to show the state
          }
          for (var k = 0; k < count; k++) {
            var name = FIRST[Math.floor(r() * FIRST.length)] + ' ' + LAST[Math.floor(r() * LAST.length)] + '.';
            var age = t.minAge == null ? 9 + Math.floor(r() * 6) : t.minAge + Math.floor(r() * (t.maxAge - t.minAge + 1));
            db.bookings.push({
              id: 'EX-' + uid('', 5), token: 'sample', status: 'paid', sample: true,
              playerName: name, playerAge: age, parentName: 'Parent of ' + name.split(' ')[0],
              email: 'family@example.com', phone: '(555) 010-' + String(1000 + Math.floor(r() * 8999)),
              notes: '', totalCents: t.price, lines: [], items: [s.id],
              holdExpiresAt: 0, createdAt: Date.now() - 86400000 * (2 + Math.floor(r() * 10)), paidAt: Date.now() - 86400000 * 2
            });
          }
        });
      });
    });
    var t0 = Date.now() - 86400000 * 3;
    db.invites.push({ code: 'WS-DEMO-2026', invitee_name: '', contact: '', note: 'Preview code for trying the flow', status: 'active', created_at: t0, sample: true });
    db.invites.push({ code: 'WS-7KQ2-MXP4', invitee_name: 'Ruby T.', contact: 'family@example.com', note: 'Center mid', status: 'redeemed', created_at: t0 - 86400000, redeemed_at: t0, sample: true });
    db.invites.push({ code: 'WS-H4ZN-3RCE', invitee_name: 'Diego M.', contact: '(555) 010-2211', note: 'Striker', status: 'active', created_at: t0, sample: true });
    db.enrollments.push({ id: 'WS-ESAMPLE', code: 'WS-7KQ2-MXP4', player_name: 'Ruby T.', player_age: 12, parent_name: 'Parent of Ruby', email: 'family@example.com', phone: '(555) 010-3141', signature: 'Parent of Ruby', created_at: t0, sample: true });
    return db;
  }

  function load() {
    if (memory) return memory;
    try { var raw = localStorage.getItem(KEY); if (raw) memory = JSON.parse(raw); } catch (e) { /* storage blocked */ }
    if (!memory) { memory = seed(); save(); }
    return memory;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(memory)); } catch (e) { /* storage blocked */ } }

  function active(b, t) { return b.status === 'paid' || (b.status === 'pending' && b.holdExpiresAt > t); }
  function counts() {
    var db = load(), t = Date.now(), out = {};
    db.bookings.forEach(function (b) { if (active(b, t)) b.items.forEach(function (id) { out[id] = (out[id] || 0) + 1; }); });
    return out;
  }
  function schedule() {
    var n = nowZ();
    return C.buildSchedule(CFG, n, counts(), load().closures.filter(function (c) { return c.date >= n.date; }));
  }
  function pub(b) {
    return {
      id: b.id, status: b.status, playerName: b.playerName, parentEmail: b.email, totalCents: b.totalCents, lines: b.lines,
      sessions: b.items.map(function (id) { var p = C.parseSessionId(id); return { id: id, date: p.date, track: p.trackId }; }),
      holdExpiresAt: b.holdExpiresAt, paidAt: b.paidAt
    };
  }
  function find(id, t) {
    var b = load().bookings.filter(function (x) { return x.id === id; })[0];
    return b && b.token === t ? b : null;
  }
  function inviteProblem(inv) {
    if (!inv || inv.status === 'revoked') return [404, "That code doesn't match an active invite. Check the text or email from your coach and try again."];
    if (inv.status === 'redeemed') return [409, "This code has already been used to accept a spot. If that wasn't you, contact your coach."];
    return null;
  }
  function getInvite(code) { return load().invites.filter(function (i) { return i.code === code; })[0] || null; }
  function needCoach() { if (!authed) throw err(401, 'Please sign in again.'); }
  function guarded(fn) { return function () { try { needCoach(); return later(fn.apply(null, arguments)); } catch (e) { return fail(e.status, e.message); } }; }

  window.API = {
    mode: 'preview',
    reset: function () { memory = seed(); save(); authed = false; },
    config: function () { return later(Object.assign({}, CFG, { payments: 'test' })); },
    schedule: function () { return later(schedule()); },
    createBooking: function (payload) {
      var v = C.validateBooking(CFG, payload);
      if (v.errors) return fail(400, 'Please fix the highlighted fields.', { fields: v.errors });
      var idx = C.indexSchedule(schedule());
      var unavailable = v.value.items.filter(function (id) { return !idx[id] || idx[id].status !== 'open'; });
      if (unavailable.length) return fail(409, 'Some of your sessions just filled up or closed. They have been removed from your list.', { unavailable: unavailable });
      var b = {
        id: uid('KB-', 6), token: uid('', 16), status: 'pending',
        playerName: v.value.player.name, playerAge: v.value.player.age, parentName: v.value.parent.name,
        email: v.value.parent.email, phone: v.value.parent.phone, notes: v.value.notes,
        totalCents: v.pricing.totalCents, lines: v.pricing.lines, items: v.value.items,
        holdExpiresAt: Date.now() + CFG.holdMinutes * 60000, createdAt: Date.now(), paidAt: null
      };
      load().bookings.push(b); save();
      return later({ bookingId: b.id, token: b.token, totalCents: b.totalCents, test: true });
    },
    getBooking: function (id, t) { var b = find(id, t); return b ? later(pub(b)) : fail(404, "We couldn't find that booking."); },
    cancelPending: function (id, t) {
      var b = find(id, t);
      if (!b) return fail(404, "We couldn't find that booking.");
      if (b.status === 'pending') { b.status = 'cancelled'; save(); }
      return later(pub(b));
    },
    testPay: function (id, t) {
      var b = find(id, t);
      if (!b) return fail(404, "We couldn't find that booking.");
      if (b.status === 'pending' && b.holdExpiresAt < Date.now()) { b.status = 'expired'; save(); return fail(410, 'Your 30-minute hold ran out. Please pick your sessions again.'); }
      if (b.status === 'pending') { b.status = 'paid'; b.paidAt = Date.now(); save(); }
      return later(pub(b));
    },
    calendarUrl: function () { return null; },
    winterCheck: function (code) {
      var c = C.normalizeCode(code);
      if (!c) return fail(400, 'Codes look like WS-4F7K-Q2MX: the letters WS and eight letters or numbers.');
      var inv = getInvite(c), p = inviteProblem(inv);
      if (p) return fail(p[0], p[1]);
      return later({ code: c, inviteeName: inv.invitee_name });
    },
    winterEnroll: function (payload) {
      var v = C.validateEnrollment(payload);
      if (v.errors) return fail(400, 'Please fix the highlighted fields.', { fields: v.errors });
      var inv = getInvite(v.value.code), p = inviteProblem(inv);
      if (p) return fail(p[0], p[1]);
      var e = {
        id: uid('WS-E', 6), code: inv.code, player_name: v.value.player.name, player_age: v.value.player.age,
        parent_name: v.value.parent.name, email: v.value.parent.email, phone: v.value.parent.phone,
        signature: v.value.signature, created_at: Date.now()
      };
      inv.status = 'redeemed'; inv.redeemed_at = Date.now();
      load().enrollments.unshift(e); save();
      return later({ enrollmentId: e.id, playerName: e.player_name });
    },
    siteUrl: function () { return CFG.publicUrl || ''; },
    admin: {
      hint: 'Preview password: coach. On the live site you set your own.',
      me: function () { return later({ authed: authed }); },
      login: function (pw) { if (pw !== PASSWORD) return fail(401, "That password isn't right."); authed = true; return later({ ok: true }); },
      logout: function () { authed = false; return later({ ok: true }); },
      overview: guarded(function () {
        var n = nowZ(), t = Date.now(), db = load();
        var rosters = {};
        db.bookings.forEach(function (b) {
          if (!active(b, t)) return;
          b.items.forEach(function (id) {
            if (id.slice(0, 10) < n.date) return;
            (rosters[id] = rosters[id] || []).push({
              bookingId: b.id, status: b.status, playerName: b.playerName, playerAge: b.playerAge, parentName: b.parentName,
              email: b.email, phone: b.phone, notes: b.notes, createdAt: b.createdAt, paidAt: b.paidAt, sample: Boolean(b.sample)
            });
          });
        });
        var weekAgo = t - 7 * 86400000;
        var paid = db.bookings.filter(function (b) { return b.status === 'paid' && b.paidAt >= weekAgo; });
        return {
          schedule: schedule(), rosters: rosters,
          closures: db.closures.filter(function (c) { return c.date >= n.date; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; }),
          revenue7d: { cents: paid.reduce(function (s, b) { return s + b.totalCents; }, 0), count: paid.length }
        };
      }),
      cancelBooking: guarded(function (id) {
        var b = load().bookings.filter(function (x) { return x.id === id; })[0];
        if (!b || (b.status !== 'paid' && b.status !== 'pending')) throw err(404, 'That booking is already cancelled.');
        b.status = 'cancelled'; save();
        return { ok: true };
      }),
      addClosure: guarded(function (c) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(c.date || '')) throw err(400, 'Pick a date.');
        if (CFG.days.indexOf(C.weekday(c.date)) === -1) throw err(400, 'Training only runs Wednesday, Thursday and Friday. Pick one of those days.');
        var db = load();
        db.closures = db.closures.filter(function (x) { return !(x.date === c.date && x.track === c.track); });
        db.closures.push({ date: c.date, track: c.track || 'all', reason: String(c.reason || '').slice(0, 80) });
        save();
        return { closures: db.closures.filter(function (x) { return x.date >= nowZ().date; }) };
      }),
      removeClosure: guarded(function (date, track) {
        var db = load();
        db.closures = db.closures.filter(function (x) { return !(x.date === date && x.track === track); });
        save();
        return { closures: db.closures.filter(function (x) { return x.date >= nowZ().date; }) };
      }),
      winter: guarded(function () {
        var db = load();
        return { invites: db.invites.slice().sort(function (a, b) { return b.created_at - a.created_at; }), enrollments: db.enrollments };
      }),
      createInvite: guarded(function (f) {
        var code;
        do { code = C.makeCode(function (n) { return Math.floor(Math.random() * n); }); } while (getInvite(code));
        var inv = { code: code, invitee_name: String(f.name || '').trim(), contact: String(f.contact || '').trim(), note: String(f.note || '').trim(), status: 'active', created_at: Date.now() };
        load().invites.push(inv); save();
        return { invite: inv };
      }),
      revokeInvite: guarded(function (code) {
        var inv = getInvite(code);
        if (!inv || inv.status !== 'active') throw err(409, 'Only unused codes can be cancelled.');
        inv.status = 'revoked'; save();
        return { ok: true };
      })
    }
  };
})();
