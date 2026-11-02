'use strict';
/* End-to-end API tests against an in-memory database, in test-payment mode. Run: npm test */
// Uses the built-in database in memory. Set TEST_DATABASE_URL to run against a real Postgres server instead.
process.env.PGLITE_DIR = 'memory://';
delete process.env.POSTGRES_URL;
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
else delete process.env.DATABASE_URL;
process.env.ADMIN_PASSWORD = 'test-pass';
process.env.GROUP_CAPACITY = '2';
delete process.env.STRIPE_SECRET_KEY;

const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../server');
const Core = require('../public/core.js');

let base, server, cookie = '';
test.before(() => new Promise((r) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); }));
test.after(() => server.close());

async function call(method, path, body, withCookie) {
  const res = await fetch(base + path, {
    method,
    headers: Object.assign(body ? { 'Content-Type': 'application/json' } : {}, withCookie && cookie ? { Cookie: cookie } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch (e) { data = text; }
  return { status: res.status, data };
}
const person = (age) => ({ player: { name: 'Sam Rivera', age }, parent: { name: 'Alex Rivera', email: 'alex@example.com', phone: '(555) 010-2030' }, consent: true });

let sched;
test('config and schedule', async () => {
  const c = await call('GET', '/api/config');
  assert.equal(c.status, 200);
  assert.equal(c.data.payments, 'test');
  assert.equal(c.data.adminPassword, undefined, 'secrets must not leak');
  assert.equal(c.data.tracks.length, 3);
  const s = await call('GET', '/api/schedule');
  sched = s.data;
  assert.ok(sched.weeks.length >= 7);
  for (const w of sched.weeks) {
    assert.deepEqual(w.days.map(Core.weekday), [3, 4, 5], 'only Wed/Thu/Fri');
    assert.equal(w.sessions.g811[0].start, '17:00');
    assert.equal(w.sessions.g1214[0].start, '18:15');
    assert.equal(w.sessions.p1[0].start, '19:30');
  }
});

test('pricing: three days in one week become a bundle', () => {
  const cfg = require('../lib/config').publicConfig();
  const w = sched.weeks[2];
  const ids = w.sessions.g811.map((s) => s.id);
  const p = Core.priceCart(cfg, ids);
  assert.equal(p.totalCents, 15999);
  assert.equal(p.lines.length, 1);
  assert.equal(p.lines[0].kind, 'bundle');
  const two = Core.priceCart(cfg, ids.slice(0, 2).concat(sched.weeks[3].sessions.p1[0].id));
  assert.equal(two.totalCents, 5999 * 2 + 9999);
  assert.equal(two.savingsCents, 0);
});

test('validation: age must match the group', async () => {
  const id = sched.weeks[2].sessions.g811[0].id;
  const r = await call('POST', '/api/bookings', Object.assign({ items: [id] }, person(13)));
  assert.equal(r.status, 400);
  assert.match(r.data.fields.playerAge, /Ages 12–14/);
  const r2 = await call('POST', '/api/bookings', { items: [id], player: {}, parent: {} });
  assert.equal(r2.status, 400);
  assert.ok(r2.data.fields.email && r2.data.fields.consent && r2.data.fields.playerName);
});

let booking;
test('booking: hold, capacity, test payment, calendar file', async () => {
  const ids = sched.weeks[2].sessions.g811.map((s) => s.id);
  const r = await call('POST', '/api/bookings', Object.assign({ items: ids }, person(10)));
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.totalCents, 15999);
  booking = r.data;

  const r2 = await call('POST', '/api/bookings', Object.assign({ items: [ids[0]] }, person(9)));
  assert.equal(r2.status, 200);
  // capacity is 2 in this test, so a third booking must be refused
  const r3 = await call('POST', '/api/bookings', Object.assign({ items: [ids[0]] }, person(9)));
  assert.equal(r3.status, 409);
  assert.deepEqual(r3.data.unavailable, [ids[0]]);
  const s = await call('GET', '/api/schedule');
  const wed = Core.indexSchedule(s.data)[ids[0]];
  assert.equal(wed.status, 'full');

  // releasing the second hold frees the spot
  await call('POST', `/api/bookings/${r2.data.bookingId}/cancel`, { t: r2.data.token });
  const s2 = await call('GET', '/api/schedule');
  assert.equal(Core.indexSchedule(s2.data)[ids[0]].status, 'open');

  const bad = await call('GET', `/api/bookings/${booking.bookingId}?t=wrong`);
  assert.equal(bad.status, 404);
  const paid = await call('POST', `/api/bookings/${booking.bookingId}/test-pay`, { t: booking.token });
  assert.equal(paid.data.status, 'paid');
  assert.equal(paid.data.sessions.length, 3);

  const ics = await call('GET', `/api/bookings/${booking.bookingId}/calendar.ics?t=${booking.token}`);
  assert.equal(ics.status, 200);
  assert.match(ics.data, /BEGIN:VEVENT/);
  assert.equal((ics.data.match(/BEGIN:VEVENT/g) || []).length, 3);
});

test('coach: sign-in required, rosters, closures', async () => {
  assert.equal((await call('GET', '/api/admin/overview')).status, 401);
  assert.equal((await call('POST', '/api/admin/login', { password: 'nope' })).status, 401);
  cookie = '';
  assert.equal((await call('POST', '/api/admin/login', { password: 'test-pass' })).status, 200);
  assert.ok(cookie.startsWith('kbm_coach='));
  const o = await call('GET', '/api/admin/overview', null, true);
  assert.equal(o.status, 200);
  const sid = sched.weeks[2].sessions.g811[0].id;
  assert.equal(o.data.rosters[sid].length, 1);
  assert.equal(o.data.rosters[sid][0].playerName, 'Sam Rivera');
  assert.equal(o.data.revenue7d.cents, 15999);

  const date = sched.weeks[3].days[1];
  const notWed = Core.addDays(date, 2); // Saturday
  assert.equal((await call('POST', '/api/admin/closures', { date: notWed, track: 'all' }, true)).status, 400);
  const c = await call('POST', '/api/admin/closures', { date, track: 'all', reason: 'Holiday' }, true);
  assert.equal(c.status, 200);
  const s = await call('GET', '/api/schedule');
  const idx = Core.indexSchedule(s.data);
  assert.equal(idx[`${date}_g811`].status, 'closed');
  assert.equal(idx[`${date}_p1`].reason, 'Holiday');
  await call('DELETE', `/api/admin/closures?date=${date}&track=all`, null, true);
  assert.equal(Core.indexSchedule((await call('GET', '/api/schedule')).data)[`${date}_g811`].status, 'open');
});

test('winter select: invite, check, enroll once, revoke', async () => {
  const inv = await call('POST', '/api/admin/invites', { name: 'Jordan Lee', contact: 'jordan.parent@example.com' }, true);
  assert.equal(inv.status, 200);
  const code = inv.data.invite.code;
  assert.match(code, /^WS-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);

  assert.equal((await call('POST', '/api/winter/check', { code: 'WS-AAAA-AAAA' })).status, 404);
  const typed = code.toLowerCase().replace(/-/g, ' ');
  const ok = await call('POST', '/api/winter/check', { code: typed });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.inviteeName, 'Jordan Lee');

  const missing = await call('POST', '/api/winter/enroll', { code });
  assert.equal(missing.status, 400);
  assert.ok(missing.data.fields.signature && missing.data.fields.agree);

  const enroll = { code, player: { name: 'Jordan Lee', age: 12 }, parent: { name: 'Pat Lee', email: 'pat@example.com', phone: '555-010-4455' }, signature: 'Pat Lee', agree: true };
  const e = await call('POST', '/api/winter/enroll', enroll);
  assert.equal(e.status, 200, JSON.stringify(e.data));
  assert.equal((await call('POST', '/api/winter/enroll', enroll)).status, 409, 'a code works once');
  assert.equal((await call('POST', '/api/winter/check', { code })).status, 409);

  const w = await call('GET', '/api/admin/winter', null, true);
  assert.equal(w.data.enrollments.length, 1);
  assert.equal(w.data.invites[0].status, 'redeemed');

  const inv2 = await call('POST', '/api/admin/invites', { name: 'Casey' }, true);
  assert.equal((await call('POST', `/api/admin/invites/${inv2.data.invite.code}/revoke`, {}, true)).status, 200);
  assert.equal((await call('POST', '/api/winter/check', { code: inv2.data.invite.code })).status, 404);
});

test('past sessions and booking cutoff', () => {
  const cfg = require('../lib/config').publicConfig();
  const s = Core.buildSchedule(cfg, { date: '2026-11-05', time: '16:30' }, {}, []);
  const idx = Core.indexSchedule(s);
  assert.equal(idx['2026-11-04_g811'].status, 'past');
  assert.equal(idx['2026-11-05_g811'].status, 'past', 'closes 60 min before 5:00 PM');
  assert.equal(idx['2026-11-05_g1214'].status, 'open', '6:15 PM session still bookable at 4:30');
  assert.equal(idx['2026-11-06_g811'].status, 'open');
  assert.equal(s.weeks[0].key, '2026-11-02');
});

test('static site is served', async () => {
  const r = await fetch(base + '/');
  assert.equal(r.status, 200);
  assert.match(await r.text(), /<div id="app"/);
  const core = await fetch(base + '/core.js');
  assert.equal(core.status, 200);
  assert.equal((await call('GET', '/api/nope')).status, 404);
});

test('simultaneous bookings never overbook a session', async () => {
  const sid = sched.weeks[4].sessions.g1214[0].id; // capacity is 2 in this test
  const results = await Promise.all(Array.from({ length: 6 }, (_, i) =>
    call('POST', '/api/bookings', Object.assign({ items: [sid] }, person(12), { player: { name: 'Racer ' + i, age: 12 } }))));
  const ok = results.filter((r) => r.status === 200).length;
  const full = results.filter((r) => r.status === 409).length;
  assert.equal(ok, 2, JSON.stringify(results.map((r) => r.status)));
  assert.equal(full, 4);
});
