/*
 * Shared scheduling, pricing and validation rules.
 * Loaded by the browser (window.Core) and by the server (require).
 * Keep this file free of DOM and Node APIs.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O, 1/I

  /* ---------- dates (all 'YYYY-MM-DD' strings, calendar math in UTC) ---------- */
  function parseDate(s) {
    var p = s.split('-').map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  }
  function toDateStr(dt) { return dt.toISOString().slice(0, 10); }
  function addDays(s, n) {
    var dt = parseDate(s);
    dt.setUTCDate(dt.getUTCDate() + n);
    return toDateStr(dt);
  }
  function weekday(s) { return parseDate(s).getUTCDay(); }
  function mondayOf(s) { return addDays(s, -((weekday(s) + 6) % 7)); }
  function minutes(t) { var p = t.split(':').map(Number); return p[0] * 60 + p[1]; }

  /* The current date and time in the coach's time zone. */
  function nowInZone(timeZone, date) {
    var parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(date || new Date());
    var get = function (t) { return parts.find(function (p) { return p.type === t; }).value; };
    var hour = get('hour') === '24' ? '00' : get('hour');
    return { date: get('year') + '-' + get('month') + '-' + get('day'), time: hour + ':' + get('minute') };
  }

  /* ---------- formatting ---------- */
  function fmtTime(t) {
    var p = t.split(':').map(Number);
    var h = p[0] % 12 || 12;
    return h + ':' + String(p[1]).padStart(2, '0') + ' ' + (p[0] >= 12 ? 'PM' : 'AM');
  }
  function fmtTimeRange(a, b) {
    var A = fmtTime(a), B = fmtTime(b);
    if (A.slice(-2) === B.slice(-2)) A = A.slice(0, -3);
    return A + '–' + B;
  }
  function fmtDay(s) {
    var d = parseDate(s);
    return DAY_SHORT[d.getUTCDay()] + ', ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate();
  }
  function fmtDayLong(s) {
    var d = parseDate(s);
    return DAY_LONG[d.getUTCDay()] + ', ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate();
  }
  function fmtRange(days) {
    var a = parseDate(days[0]), b = parseDate(days[days.length - 1]);
    if (a.getUTCMonth() === b.getUTCMonth()) return MONTHS[a.getUTCMonth()] + ' ' + a.getUTCDate() + '–' + b.getUTCDate();
    return MONTHS[a.getUTCMonth()] + ' ' + a.getUTCDate() + '–' + MONTHS[b.getUTCMonth()] + ' ' + b.getUTCDate();
  }
  function money(cents) {
    return '$' + (cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /* ---------- sessions ---------- */
  function track(cfg, id) {
    for (var i = 0; i < cfg.tracks.length; i++) if (cfg.tracks[i].id === id) return cfg.tracks[i];
    return null;
  }
  function sessionId(date, trackId) { return date + '_' + trackId; }
  function parseSessionId(id) {
    var m = /^(\d{4}-\d{2}-\d{2})_([a-z0-9]+)$/.exec(String(id || ''));
    return m ? { date: m[1], trackId: m[2] } : null;
  }
  function isTrainingDay(cfg, date) { return cfg.days.indexOf(weekday(date)) !== -1; }
  function weekDays(cfg, monday) {
    return cfg.days.map(function (d) { return addDays(monday, (d + 6) % 7); });
  }

  /**
   * Build the bookable schedule.
   * now: {date, time} in the coach's zone
   * counts: { sessionId: spotsTaken }
   * closures: [{ date, track: 'all' | trackId, reason }]
   */
  function buildSchedule(cfg, now, counts, closures) {
    counts = counts || {};
    closures = closures || [];
    var start = mondayOf(now.date);
    var weeks = [];
    for (var w = 0; w <= cfg.weeksAhead; w++) {
      var monday = addDays(start, w * 7);
      var days = weekDays(cfg, monday);
      var sessions = {};
      var anyOpen = false;
      cfg.tracks.forEach(function (t) {
        sessions[t.id] = days.map(function (date) {
          var id = sessionId(date, t.id);
          var taken = counts[id] || 0;
          var closure = null;
          for (var i = 0; i < closures.length; i++) {
            var c = closures[i];
            if (c.date === date && (c.track === 'all' || c.track === t.id)) { closure = c; break; }
          }
          var cutoff = minutes(t.start) - (cfg.bookingCutoffMinutes || 0);
          var status = 'open';
          if (date < now.date || (date === now.date && minutes(now.time) >= cutoff)) status = 'past';
          else if (closure) status = 'closed';
          else if (taken >= t.capacity) status = 'full';
          if (status !== 'past') anyOpen = true;
          return {
            id: id, date: date, track: t.id, start: t.start, end: t.end,
            capacity: t.capacity, taken: Math.min(taken, t.capacity),
            left: Math.max(0, t.capacity - taken), status: status,
            reason: closure ? (closure.reason || '') : ''
          };
        });
      });
      if (anyOpen) weeks.push({ key: monday, days: days, label: fmtRange(days), sessions: sessions });
    }
    return { weeks: weeks.slice(0, cfg.weeksAhead), today: now.date };
  }

  function indexSchedule(sched) {
    var map = {};
    sched.weeks.forEach(function (w) {
      Object.keys(w.sessions).forEach(function (k) {
        w.sessions[k].forEach(function (s) { map[s.id] = s; });
      });
    });
    return map;
  }

  /**
   * Price a set of session ids. Three group sessions for the same age group in
   * the same week become one week bundle automatically.
   */
  function priceCart(cfg, ids) {
    var seen = {};
    var items = [];
    (ids || []).forEach(function (id) {
      if (seen[id]) return;
      var p = parseSessionId(id);
      if (!p) return;
      var t = track(cfg, p.trackId);
      if (!t || !isTrainingDay(cfg, p.date)) return;
      seen[id] = true;
      items.push({ id: id, date: p.date, track: t });
    });
    items.sort(function (a, b) {
      return a.date < b.date ? -1 : a.date > b.date ? 1 : minutes(a.track.start) - minutes(b.track.start);
    });

    var groups = [];
    var byKey = {};
    items.forEach(function (it) {
      var key = it.track.id + '|' + mondayOf(it.date);
      if (!byKey[key]) { byKey[key] = { track: it.track, monday: mondayOf(it.date), items: [] }; groups.push(byKey[key]); }
      byKey[key].items.push(it);
    });

    var lines = [];
    var regular = 0;
    groups.forEach(function (g) {
      var t = g.track;
      regular += t.price * g.items.length;
      if (t.bundlePrice && g.items.length === cfg.days.length) {
        lines.push({
          kind: 'bundle', track: t.id, cents: t.bundlePrice,
          sessions: g.items.map(function (i) { return i.id; }),
          title: 'Full week of group training',
          detail: t.label + ' · Wed–Fri, ' + fmtRange(weekDays(cfg, g.monday))
        });
      } else {
        g.items.forEach(function (i) {
          lines.push({
            kind: t.kind === 'private' ? 'private' : 'dropin', track: t.id, cents: t.price,
            sessions: [i.id],
            title: t.kind === 'private' ? 'Private 1-on-1 session' : 'Group training session',
            detail: (t.kind === 'private' ? '' : t.label + ' · ') + fmtDay(i.date) + ', ' + fmtTimeRange(t.start, t.end)
          });
        });
      }
    });
    var total = lines.reduce(function (s, l) { return s + l.cents; }, 0);
    return {
      lines: lines,
      sessionIds: items.map(function (i) { return i.id; }),
      count: items.length,
      totalCents: total,
      regularCents: regular,
      savingsCents: regular - total
    };
  }

  /* ---------- validation ---------- */
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  function clean(v, max) { return String(v == null ? '' : v).trim().slice(0, max || 120); }
  function digits(v) { return String(v || '').replace(/\D/g, ''); }

  function ageProblem(cfg, trackIds, age, playerName) {
    for (var i = 0; i < trackIds.length; i++) {
      var t = track(cfg, trackIds[i]);
      if (!t || t.minAge == null) continue;
      if (age < t.minAge || age > t.maxAge) {
        var fit = cfg.tracks.filter(function (x) { return x.minAge != null && age >= x.minAge && age <= x.maxAge; })[0];
        var who = playerName ? playerName.split(' ')[0] : 'This player';
        return 'The ' + t.label + ' group is for players aged ' + t.minAge + ' to ' + t.maxAge + ', and ' + who + ' is ' + age + '.' +
          (fit ? ' Go back and pick the ' + fit.label + ' group instead.' : ' Private 1-on-1 sessions are open to any age.');
      }
    }
    return '';
  }

  function validateContact(input) {
    var errors = {};
    var player = input.player || {};
    var parent = input.parent || {};
    var out = {
      player: { name: clean(player.name, 80), age: parseInt(player.age, 10) },
      parent: { name: clean(parent.name, 80), email: clean(parent.email, 120).toLowerCase(), phone: clean(parent.phone, 30) }
    };
    if (out.player.name.length < 2) errors.playerName = "Enter the player's full name.";
    if (!(out.player.age >= 4 && out.player.age <= 19)) errors.playerAge = "Choose the player's age.";
    if (out.parent.name.length < 2) errors.parentName = 'Enter a parent or guardian name.';
    if (!EMAIL_RE.test(out.parent.email)) errors.email = 'Enter an email address like name@example.com.';
    if (digits(out.parent.phone).length < 10) errors.phone = 'Enter a phone number with area code.';
    return { errors: errors, value: out };
  }

  function validateBooking(cfg, input) {
    input = input || {};
    var r = validateContact(input);
    var errors = r.errors;
    var value = r.value;
    value.notes = clean(input.notes, 500);
    var ids = Array.isArray(input.items) ? input.items.slice(0, 40) : [];
    var pricing = priceCart(cfg, ids);
    value.items = pricing.sessionIds;
    if (!pricing.count) errors.items = 'Pick at least one session.';
    if (!input.consent) errors.consent = 'Please confirm you are the parent or guardian.';
    if (!errors.playerAge && pricing.count) {
      var trackIds = pricing.lines.map(function (l) { return l.track; });
      var prob = ageProblem(cfg, trackIds, value.player.age, value.player.name);
      if (prob) errors.playerAge = prob;
    }
    return { errors: Object.keys(errors).length ? errors : null, value: value, pricing: pricing };
  }

  function validateEnrollment(input) {
    input = input || {};
    var r = validateContact(input);
    var errors = r.errors;
    var value = r.value;
    value.code = normalizeCode(input.code);
    value.signature = clean(input.signature, 80);
    if (!value.code) errors.code = 'Enter your invite code.';
    if (value.signature.length < 2) errors.signature = 'Type your full name to sign.';
    if (!input.agree) errors.agree = 'Please confirm the commitment to continue.';
    return { errors: Object.keys(errors).length ? errors : null, value: value };
  }

  /* ---------- invite codes ---------- */
  function normalizeCode(s) {
    var raw = String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (raw.indexOf('WS') === 0 && raw.length === 10) raw = raw.slice(2);
    if (raw.length !== 8) return null;
    return 'WS-' + raw.slice(0, 4) + '-' + raw.slice(4);
  }
  /* randomInt(n) must return a uniformly random integer in [0, n). */
  function makeCode(randomInt) {
    var s = '';
    do {
      s = '';
      for (var i = 0; i < 8; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    } while (s.indexOf('WS') === 0); // keeps typed codes unambiguous with the WS- prefix
    return 'WS-' + s.slice(0, 4) + '-' + s.slice(4);
  }

  return {
    addDays: addDays, weekday: weekday, mondayOf: mondayOf, minutes: minutes, nowInZone: nowInZone,
    fmtTime: fmtTime, fmtTimeRange: fmtTimeRange, fmtDay: fmtDay, fmtDayLong: fmtDayLong, fmtRange: fmtRange, money: money,
    track: track, sessionId: sessionId, parseSessionId: parseSessionId, buildSchedule: buildSchedule,
    indexSchedule: indexSchedule, priceCart: priceCart, ageProblem: ageProblem,
    validateBooking: validateBooking, validateEnrollment: validateEnrollment,
    normalizeCode: normalizeCode, makeCode: makeCode, DAY_SHORT: DAY_SHORT
  };
});
