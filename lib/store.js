'use strict';
/*
 * Postgres persistence.
 *  - On Vercel (or any host): set DATABASE_URL (Neon via the Vercel Marketplace sets it for you).
 *  - On your computer and in tests: no DATABASE_URL needed. An embedded Postgres (PGlite) stores
 *    data in ./data/pglite, or in memory when PGLITE_DIR=memory://.
 * Timestamps are milliseconds stored as double precision so both drivers return plain numbers.
 */
const path = require('node:path');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY,
    token TEXT NOT NULL,
    status TEXT NOT NULL,                 -- pending | paid | cancelled | expired
    player_name TEXT NOT NULL,
    player_age INTEGER NOT NULL,
    parent_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    total_cents INTEGER NOT NULL,
    lines_json TEXT NOT NULL,
    stripe_session_id TEXT,
    stripe_payment_intent TEXT,
    hold_expires_at DOUBLE PRECISION NOT NULL,
    created_at DOUBLE PRECISION NOT NULL,
    paid_at DOUBLE PRECISION,
    cancelled_at DOUBLE PRECISION
  );
  CREATE TABLE IF NOT EXISTS booking_items (
    booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL,
    date TEXT NOT NULL,
    track TEXT NOT NULL,
    PRIMARY KEY (booking_id, session_id)
  );
  CREATE INDEX IF NOT EXISTS booking_items_session ON booking_items(session_id);
  CREATE INDEX IF NOT EXISTS booking_items_date ON booking_items(date);
  CREATE TABLE IF NOT EXISTS closures (
    date TEXT NOT NULL,
    track TEXT NOT NULL,                  -- 'all' or a track id
    reason TEXT NOT NULL DEFAULT '',
    created_at DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (date, track)
  );
  CREATE TABLE IF NOT EXISTS invites (
    code TEXT PRIMARY KEY,
    invitee_name TEXT NOT NULL DEFAULT '',
    contact TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,                 -- active | redeemed | revoked
    created_at DOUBLE PRECISION NOT NULL,
    redeemed_at DOUBLE PRECISION
  );
  CREATE TABLE IF NOT EXISTS enrollments (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL REFERENCES invites(code),
    player_name TEXT NOT NULL,
    player_age INTEGER NOT NULL,
    parent_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    signature TEXT NOT NULL,
    created_at DOUBLE PRECISION NOT NULL
  );
`;

/* Each driver exposes: query(sql, params) -> { rows, count }, exec(sql), tx(fn(q)) */
function pgDriver(url) {
  const pg = require('pg');
  const pool = new pg.Pool({ connectionString: url, max: 3, idleTimeoutMillis: 10_000 });
  const wrap = (r) => ({ rows: r.rows, count: r.rowCount });
  return {
    kind: 'postgres',
    query: (sql, params) => pool.query(sql, params).then(wrap),
    exec: (sql) => pool.query(sql),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn((sql, params) => client.query(sql, params).then(wrap));
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    }
  };
}

function pgliteDriver(dir) {
  let dbp;
  const db = () => {
    if (!dbp) {
      const mod = '@electric-sql/pglite'; // kept out of the deploy bundle; only used without DATABASE_URL
      dbp = import(mod).then(({ PGlite }) => {
        if (dir !== 'memory://') require('node:fs').mkdirSync(dir, { recursive: true });
        return new PGlite(dir === 'memory://' ? undefined : dir);
      });
    }
    return dbp;
  };
  const wrap = (r) => ({ rows: r.rows, count: r.affectedRows || 0 });
  return {
    kind: 'pglite',
    query: async (sql, params) => wrap(await (await db()).query(sql, params)),
    exec: async (sql) => (await db()).exec(sql),
    async tx(fn) {
      return (await db()).transaction((t) => fn((sql, params) => t.query(sql, params).then(wrap)));
    }
  };
}

function open(opts) {
  opts = opts || {};
  const driver = opts.databaseUrl
    ? pgDriver(opts.databaseUrl)
    : pgliteDriver(opts.pgliteDir || path.join(__dirname, '..', 'data', 'pglite'));

  let ready;
  const init = () => (ready = ready || driver.exec(SCHEMA).catch((e) => { ready = null; throw e; }));
  const q = async (sql, params) => { await init(); return driver.query(sql, params); };
  const one = async (sql, params) => (await q(sql, params)).rows[0] || null;

  const COUNTS = `SELECT bi.session_id AS id, COUNT(*)::int AS n FROM booking_items bi
                  JOIN bookings b ON b.id = bi.booking_id
                  WHERE (b.status = 'paid' OR (b.status = 'pending' AND b.hold_expires_at > $1)) AND bi.date >= $2
                  GROUP BY bi.session_id`;
  const CLOSURES = `SELECT date, track, reason FROM closures WHERE date >= $1 ORDER BY date, track`;
  const toCounts = (rows) => { const out = {}; for (const r of rows) out[r.id] = Number(r.n); return out; };

  return {
    kind: driver.kind,
    init,
    async counts(nowMs, fromDate) { return toCounts((await q(COUNTS, [nowMs, fromDate])).rows); },
    async closures(fromDate) { return (await q(CLOSURES, [fromDate])).rows; },

    /*
     * Atomically check availability and create a pending booking.
     * check(counts, closures) returns the list of unavailable session ids (empty = OK).
     */
    async createBooking(b, items, check) {
      await init();
      return driver.tx(async (tq) => {
        await tq('SELECT pg_advisory_xact_lock(4242)');
        const counts = toCounts((await tq(COUNTS, [Date.now(), items.length ? items[0].date.slice(0, 10) : '0000'])).rows);
        const closures = (await tq(CLOSURES, ['0000-00-00'])).rows;
        const unavailable = check(counts, closures);
        if (unavailable.length) return { unavailable };
        await tq(`INSERT INTO bookings (id, token, status, player_name, player_age, parent_name, email, phone, notes,
                  total_cents, lines_json, hold_expires_at, created_at)
                  VALUES ($1, $2, 'pending', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [b.id, b.token, b.player_name, b.player_age, b.parent_name, b.email, b.phone, b.notes,
          b.total_cents, b.lines_json, b.hold_expires_at, b.created_at]);
        for (const it of items) {
          await tq('INSERT INTO booking_items (booking_id, session_id, date, track) VALUES ($1, $2, $3, $4)', [b.id, it.id, it.date, it.track]);
        }
        return { unavailable: [] };
      });
    },
    async getBooking(id) {
      const b = await one('SELECT * FROM bookings WHERE id = $1', [id]);
      if (!b) return null;
      b.items = (await q('SELECT session_id, date, track FROM booking_items WHERE booking_id = $1 ORDER BY date', [id])).rows;
      b.lines = JSON.parse(b.lines_json);
      return b;
    },
    async setStripeSession(id, sid) { await q('UPDATE bookings SET stripe_session_id = $1 WHERE id = $2', [sid, id]); },
    async markPaid(id, sid, pi) {
      const r = await q(`UPDATE bookings SET status = 'paid', paid_at = $1, stripe_session_id = COALESCE($2, stripe_session_id),
                         stripe_payment_intent = COALESCE($3, stripe_payment_intent) WHERE id = $4 AND status != 'paid'`,
      [Date.now(), sid || null, pi || null, id]);
      return r.count > 0;
    },
    async releasePending(id, status) {
      return (await q(`UPDATE bookings SET status = $1, cancelled_at = $2 WHERE id = $3 AND status = 'pending'`, [status, Date.now(), id])).count > 0;
    },
    async adminCancel(id) {
      return (await q(`UPDATE bookings SET status = 'cancelled', cancelled_at = $1 WHERE id = $2 AND status IN ('paid', 'pending')`, [Date.now(), id])).count > 0;
    },
    async roster(fromDate, nowMs) {
      return (await q(`SELECT bi.session_id, bi.date, bi.track, b.id AS booking_id, b.status, b.player_name, b.player_age,
                              b.parent_name, b.email, b.phone, b.notes, b.total_cents, b.created_at, b.paid_at
                       FROM booking_items bi JOIN bookings b ON b.id = bi.booking_id
                       WHERE bi.date >= $1 AND (b.status = 'paid' OR (b.status = 'pending' AND b.hold_expires_at > $2))
                       ORDER BY bi.date, b.created_at`, [fromDate, nowMs])).rows;
    },
    async revenueSince(ms) {
      const r = await one(`SELECT COALESCE(SUM(total_cents), 0)::float8 AS cents, COUNT(*)::int AS n FROM bookings WHERE status = 'paid' AND paid_at >= $1`, [ms]);
      return { cents: Number(r.cents), count: Number(r.n) };
    },
    async addClosure(date, track, reason) {
      await q(`INSERT INTO closures (date, track, reason, created_at) VALUES ($1, $2, $3, $4)
               ON CONFLICT (date, track) DO UPDATE SET reason = EXCLUDED.reason`, [date, track, reason, Date.now()]);
    },
    async removeClosure(date, track) { return (await q('DELETE FROM closures WHERE date = $1 AND track = $2', [date, track])).count > 0; },
    async createInvite(code, name, contact, note) {
      const r = await q(`INSERT INTO invites (code, invitee_name, contact, note, status, created_at) VALUES ($1, $2, $3, $4, 'active', $5)
                         ON CONFLICT (code) DO NOTHING`, [code, name, contact, note, Date.now()]);
      return r.count ? one('SELECT * FROM invites WHERE code = $1', [code]) : null;
    },
    async getInvite(code) { return one('SELECT * FROM invites WHERE code = $1', [code]); },
    async invites() { return (await q('SELECT * FROM invites ORDER BY created_at DESC')).rows; },
    async revokeInvite(code) { return (await q(`UPDATE invites SET status = 'revoked' WHERE code = $1 AND status = 'active'`, [code])).count > 0; },
    async redeem(code, e) {
      await init();
      return driver.tx(async (tq) => {
        const r = await tq(`UPDATE invites SET status = 'redeemed', redeemed_at = $1 WHERE code = $2 AND status = 'active'`, [Date.now(), code]);
        if (!r.count) return false;
        await tq(`INSERT INTO enrollments (id, code, player_name, player_age, parent_name, email, phone, signature, created_at)
                  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [e.id, code, e.player_name, e.player_age, e.parent_name, e.email, e.phone, e.signature, Date.now()]);
        return true;
      });
    },
    async enrollments() { return (await q('SELECT * FROM enrollments ORDER BY created_at DESC')).rows; }
  };
}

module.exports = { open };
