'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const config = require('./lib/config');
const Core = require('./public/core.js');
const { open } = require('./lib/store');

const store = open({ databaseUrl: config.databaseUrl, pgliteDir: config.pgliteDir });
const stripe = config.stripeSecretKey ? require('stripe')(config.stripeSecretKey) : null;
const cfg = config.publicConfig();
// Keeps the coach signed in across server restarts. Changing ADMIN_PASSWORD signs everyone out.
const sessionSecret = config.sessionSecret ||
  crypto.createHash('sha256').update('kb-movement:' + (config.adminPassword || crypto.randomBytes(16).toString('hex'))).digest('hex');

/* ---------- helpers ---------- */
const randomId = (prefix, n) => prefix + Core.makeCode((max) => crypto.randomInt(max)).replace(/^WS-|-/g, '').slice(0, n);
const token = () => crypto.randomBytes(24).toString('base64url');
const now = () => Core.nowInZone(config.timeZone);
const safeEqual = (a, b) => {
  const A = Buffer.from(String(a)), B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
};
const fail = (res, status, error, extra) => res.status(status).json(Object.assign({ error }, extra || {}));

async function schedule() {
  const n = now();
  const [counts, closures] = await Promise.all([store.counts(Date.now(), n.date), store.closures(n.date)]);
  return Core.buildSchedule(cfg, n, counts, closures);
}

function baseUrl(req) {
  return config.publicUrl || `${req.protocol}://${req.get('host')}`;
}

function publicBooking(b) {
  return {
    id: b.id,
    status: b.status,
    playerName: b.player_name,
    parentEmail: b.email,
    totalCents: b.total_cents,
    lines: b.lines,
    sessions: b.items.map((i) => ({ id: i.session_id, date: i.date, track: i.track })),
    holdExpiresAt: b.hold_expires_at,
    paidAt: b.paid_at
  };
}

async function loadBooking(req, res) {
  const b = await store.getBooking(String(req.params.id));
  const t = req.query.t || (req.body && req.body.t);
  if (!b || !t || !safeEqual(b.token, t)) { fail(res, 404, "We couldn't find that booking."); return null; }
  return b;
}

/* Tiny in-memory rate limiter (per server instance). */
const buckets = new Map();
function limit(name, max, windowMs) {
  return (req, res, next) => {
    const key = name + ':' + req.ip;
    const t = Date.now();
    let b = buckets.get(key);
    if (!b || b.reset < t) { b = { n: 0, reset: t + windowMs }; buckets.set(key, b); }
    if (++b.n > max) return fail(res, 429, 'Too many attempts. Please wait a few minutes and try again.');
    if (buckets.size > 5000) for (const [k, v] of buckets) if (v.reset < t) buckets.delete(k);
    next();
  };
}

/* ---------- coach (admin) auth: signed, http-only cookie ---------- */
const COOKIE = 'kbm_coach';
function sign(value) { return crypto.createHmac('sha256', sessionSecret).update(value).digest('base64url'); }
function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}
function isCoach(req) {
  const v = readCookie(req, COOKIE);
  const [exp, sig] = v.split('.');
  return Boolean(exp && sig && Number(exp) > Date.now() && safeEqual(sig, sign(exp)));
}
function requireCoach(req, res, next) {
  if (!isCoach(req)) return fail(res, 401, 'Please sign in again.');
  next();
}

/* ---------- app ---------- */
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
  });
  if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
  next();
});

/* Stripe webhook needs the raw body, so it is registered before the JSON parser. */
app.post('/api/stripe/webhook', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
  if (!stripe || !config.stripeWebhookSecret) return res.status(400).send('Webhook is not configured.');
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], config.stripeWebhookSecret);
  } catch (e) {
    return res.status(400).send('Invalid signature.');
  }
  const s = event.data.object;
  const bookingId = s && s.metadata && s.metadata.bookingId;
  if (bookingId) {
    if ((event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') && s.payment_status === 'paid') {
      await store.markPaid(bookingId, s.id, s.payment_intent);
    } else if (event.type === 'checkout.session.expired') {
      await store.releasePending(bookingId, 'expired');
    }
  }
  res.json({ received: true });
});

app.use(express.json({ limit: '50kb' }));

/* On Vercel the site needs a hosted database (Neon). Explain clearly if it isn't connected yet. */
app.use('/api', (req, res, next) => {
  if (process.env.VERCEL && !config.databaseUrl && req.path !== '/config') {
    return fail(res, 503, "The booking database isn't connected yet. In your Vercel project, open Storage, add a Neon database, connect it to this project, then redeploy.");
  }
  next();
});

app.get('/api/config', (req, res) => res.json(cfg));
app.get('/api/schedule', async (req, res) => res.json(await schedule()));
app.get('/api/health', async (req, res) => {
  await store.init();
  res.json({ ok: true, database: store.kind, payments: cfg.payments });
});

/* Create a booking, hold the spots, and hand back a checkout URL (or a test-payment step). */
app.post('/api/bookings', limit('book', 30, 15 * 60_000), async (req, res) => {
  const { errors, value, pricing } = Core.validateBooking(cfg, req.body);
  if (errors) return fail(res, 400, 'Please fix the highlighted fields.', { fields: errors });

  const id = randomId('KB-', 6);
  const tok = token();
  const result = await store.createBooking({
    id, token: tok,
    player_name: value.player.name, player_age: value.player.age,
    parent_name: value.parent.name, email: value.parent.email, phone: value.parent.phone,
    notes: value.notes, total_cents: pricing.totalCents, lines_json: JSON.stringify(pricing.lines),
    hold_expires_at: Date.now() + config.holdMinutes * 60_000, created_at: Date.now()
  }, value.items.map((sid) => { const p = Core.parseSessionId(sid); return { id: sid, date: p.date, track: p.trackId }; }),
  (counts, closures) => {
    // Runs inside a locked transaction, so two parents can't take the last spot at the same time.
    const sessions = Core.indexSchedule(Core.buildSchedule(cfg, now(), counts, closures));
    return value.items.filter((sid) => !sessions[sid] || sessions[sid].status !== 'open');
  });
  if (result.unavailable.length) {
    return fail(res, 409, result.unavailable.length === 1
      ? 'One of your sessions just filled up or closed. It has been removed from your booking.'
      : 'Some of your sessions just filled up or closed. They have been removed from your booking.', { unavailable: result.unavailable });
  }

  if (!stripe) return res.json({ bookingId: id, token: tok, totalCents: pricing.totalCents, test: true });

  try {
    const base = baseUrl(req);
    const checkout = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: value.parent.email,
      client_reference_id: id,
      metadata: { bookingId: id, player: value.player.name },
      payment_intent_data: { description: `${config.businessName} booking ${id} for ${value.player.name}`, metadata: { bookingId: id } },
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
      line_items: pricing.lines.map((l) => ({
        quantity: 1,
        price_data: { currency: 'usd', unit_amount: l.cents, product_data: { name: l.title, description: `${l.detail} · Player: ${value.player.name}` } }
      })),
      success_url: `${base}/?booking=${id}&t=${tok}&session_id={CHECKOUT_SESSION_ID}#booked`,
      cancel_url: `${base}/?cancelled=${id}&t=${tok}#book`
    });
    await store.setStripeSession(id, checkout.id);
    res.json({ bookingId: id, token: tok, totalCents: pricing.totalCents, checkoutUrl: checkout.url });
  } catch (e) {
    console.error('Stripe checkout failed:', e.message);
    await store.releasePending(id, 'cancelled');
    fail(res, 502, "Checkout couldn't start. Nothing was charged. Please try again in a minute.");
  }
});

/* Booking status for the confirmation page. Confirms with Stripe directly if the webhook hasn't landed yet. */
app.get('/api/bookings/:id', async (req, res) => {
  let b = await loadBooking(req, res);
  if (!b) return;
  if (b.status === 'pending' && stripe && b.stripe_session_id) {
    try {
      const s = await stripe.checkout.sessions.retrieve(b.stripe_session_id);
      if (s.payment_status === 'paid') { await store.markPaid(b.id, s.id, s.payment_intent); b = await store.getBooking(b.id); }
    } catch (e) { console.error('Stripe lookup failed:', e.message); }
  }
  res.json(publicBooking(b));
});

/* Parent backed out of checkout: release the held spots. */
app.post('/api/bookings/:id/cancel', async (req, res) => {
  const b = await loadBooking(req, res);
  if (!b) return;
  if (b.status === 'pending') {
    await store.releasePending(b.id, 'cancelled');
    if (stripe && b.stripe_session_id) stripe.checkout.sessions.expire(b.stripe_session_id).catch(() => {});
  }
  res.json(publicBooking(await store.getBooking(b.id)));
});

/* Demo payment, only when Stripe isn't configured. */
app.post('/api/bookings/:id/test-pay', async (req, res) => {
  if (stripe) return fail(res, 404, 'Not available.');
  const b = await loadBooking(req, res);
  if (!b) return;
  if (b.status === 'pending' && b.hold_expires_at < Date.now()) {
    await store.releasePending(b.id, 'expired');
    return fail(res, 410, 'Your 30-minute hold ran out. Please pick your sessions again.');
  }
  if (b.status === 'pending') await store.markPaid(b.id, null, null);
  res.json(publicBooking(await store.getBooking(b.id)));
});

/* Calendar file for paid bookings. */
app.get('/api/bookings/:id/calendar.ics', async (req, res) => {
  const b = await loadBooking(req, res);
  if (!b) return;
  if (b.status !== 'paid') return fail(res, 404, 'This booking is not paid yet.');
  const esc = (s) => String(s).replace(/[\\;,]/g, (m) => '\\' + m).replace(/\n/g, '\\n');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//KB Movement//Bookings//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const it of b.items) {
    const t = Core.track(cfg, it.track);
    const d = it.date.replace(/-/g, '');
    lines.push('BEGIN:VEVENT',
      `UID:${b.id}-${it.session_id}@kb-movement`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=${config.timeZone}:${d}T${t.start.replace(':', '')}00`,
      `DTEND;TZID=${config.timeZone}:${d}T${t.end.replace(':', '')}00`,
      `SUMMARY:${esc(`${config.businessName}: ${t.kind === 'private' ? '1-on-1' : t.label + ' group'} (${b.player_name})`)}`,
      config.location ? `LOCATION:${esc(config.location)}` : '',
      `DESCRIPTION:${esc(`Booking ${b.id}. Bring a ball, shin guards, cleats or turf shoes, and water.`)}`,
      'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  res.set('Content-Type', 'text/calendar; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${b.id}.ics"`);
  res.send(lines.filter(Boolean).join('\r\n'));
});

/* ---------- Winter Select ---------- */
function inviteProblem(invite) {
  if (!invite || invite.status === 'revoked') return [404, "That code doesn't match an active invite. Check the text or email from your coach and try again."];
  if (invite.status === 'redeemed') return [409, 'This code has already been used to accept a spot. If that wasn\'t you, contact your coach.'];
  return null;
}

app.post('/api/winter/check', limit('winter', 20, 15 * 60_000), async (req, res) => {
  const code = Core.normalizeCode(req.body && req.body.code);
  if (!code) return fail(res, 400, 'Codes look like WS-4F7K-Q2MX: the letters WS and eight letters or numbers.');
  const invite = await store.getInvite(code);
  const p = inviteProblem(invite);
  if (p) return fail(res, p[0], p[1]);
  res.json({ code, inviteeName: invite.invitee_name });
});

app.post('/api/winter/enroll', limit('winter-enroll', 10, 15 * 60_000), async (req, res) => {
  const { errors, value } = Core.validateEnrollment(req.body);
  if (errors) return fail(res, 400, 'Please fix the highlighted fields.', { fields: errors });
  const p = inviteProblem(await store.getInvite(value.code));
  if (p) return fail(res, p[0], p[1]);
  const id = randomId('WS-E', 6);
  const ok = await store.redeem(value.code, {
    id, player_name: value.player.name, player_age: value.player.age,
    parent_name: value.parent.name, email: value.parent.email, phone: value.parent.phone, signature: value.signature
  });
  if (!ok) return fail(res, 409, 'This code has already been used to accept a spot.');
  res.json({ enrollmentId: id, playerName: value.player.name });
});

/* ---------- coach dashboard API ---------- */
app.post('/api/admin/login', limit('login', 10, 15 * 60_000), (req, res) => {
  if (!config.adminPassword) return fail(res, 503, 'Coach sign-in is turned off until ADMIN_PASSWORD is set on the server.');
  if (!safeEqual(String((req.body && req.body.password) || ''), config.adminPassword)) return fail(res, 401, "That password isn't right.");
  const exp = String(Date.now() + 7 * 24 * 3600_000);
  res.cookie(COOKIE, `${exp}.${sign(exp)}`, {
    httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: 7 * 24 * 3600_000, path: '/'
  });
  res.json({ ok: true });
});
app.post('/api/admin/logout', (req, res) => { res.clearCookie(COOKIE, { path: '/' }); res.json({ ok: true }); });
app.get('/api/admin/me', (req, res) => res.json({ authed: isCoach(req) }));

app.use('/api/admin', requireCoach);

app.get('/api/admin/overview', async (req, res) => {
  const n = now();
  const weekAgo = Date.now() - 7 * 24 * 3600_000;
  const [sched, rows, closures, revenue7d] = await Promise.all([
    schedule(), store.roster(n.date, Date.now()), store.closures(n.date), store.revenueSince(weekAgo)
  ]);
  const rosters = {};
  for (const r of rows) {
    (rosters[r.session_id] = rosters[r.session_id] || []).push({
      bookingId: r.booking_id, status: r.status, playerName: r.player_name, playerAge: r.player_age,
      parentName: r.parent_name, email: r.email, phone: r.phone, notes: r.notes, createdAt: r.created_at, paidAt: r.paid_at
    });
  }
  res.json({ schedule: sched, rosters, closures, revenue7d });
});

app.post('/api/admin/bookings/:id/cancel', async (req, res) => {
  if (!(await store.adminCancel(String(req.params.id)))) return fail(res, 404, 'That booking is already cancelled.');
  res.json({ ok: true });
});

app.post('/api/admin/closures', async (req, res) => {
  const date = String((req.body && req.body.date) || '');
  const trackId = String((req.body && req.body.track) || 'all');
  const reason = String((req.body && req.body.reason) || '').trim().slice(0, 80);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail(res, 400, 'Pick a date.');
  if (!cfg.days.includes(Core.weekday(date))) return fail(res, 400, 'Training only runs Wednesday, Thursday and Friday. Pick one of those days.');
  if (trackId !== 'all' && !Core.track(cfg, trackId)) return fail(res, 400, 'Pick a session.');
  await store.addClosure(date, trackId, reason);
  res.json({ closures: await store.closures(now().date) });
});
app.delete('/api/admin/closures', async (req, res) => {
  await store.removeClosure(String(req.query.date || ''), String(req.query.track || 'all'));
  res.json({ closures: await store.closures(now().date) });
});

app.get('/api/admin/winter', async (req, res) => {
  const [invites, enrollments] = await Promise.all([store.invites(), store.enrollments()]);
  res.json({ invites, enrollments });
});
app.post('/api/admin/invites', async (req, res) => {
  const name = String((req.body && req.body.name) || '').trim().slice(0, 80);
  const contact = String((req.body && req.body.contact) || '').trim().slice(0, 120);
  const note = String((req.body && req.body.note) || '').trim().slice(0, 200);
  for (let i = 0; i < 5; i++) {
    const invite = await store.createInvite(Core.makeCode((max) => crypto.randomInt(max)), name, contact, note);
    if (invite) return res.json({ invite });
  }
  fail(res, 500, "Couldn't create a code. Try again.");
});
app.post('/api/admin/invites/:code/revoke', async (req, res) => {
  if (!(await store.revokeInvite(String(req.params.code)))) return fail(res, 409, 'Only unused codes can be cancelled.');
  res.json({ ok: true });
});

app.use('/api', (req, res) => fail(res, 404, 'Not found.'));

app.use(express.static(path.join(__dirname, 'public'), { maxAge: config.isProduction ? '10m' : 0 }));
app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  fail(res, err.status && err.status < 500 ? err.status : 500, err.status === 400 ? 'That request was not valid.' : 'Something went wrong on our side. Please try again.');
});

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`${config.businessName} running on http://localhost:${config.port}`);
    console.log(`Database: ${store.kind === 'postgres' ? 'Postgres (DATABASE_URL)' : 'built-in local database (data/pglite)'}`);
    console.log(`Payments: ${stripe ? 'Stripe' : 'DEMO MODE (no real payments; set STRIPE_SECRET_KEY to take real payments)'}`);
    if (!config.adminPassword) console.log('Coach dashboard is locked: set ADMIN_PASSWORD to sign in.');
  });
}

module.exports = app;
