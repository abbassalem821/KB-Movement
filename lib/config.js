'use strict';
/*
 * Everything a coach would want to change lives here.
 * Each value can also be overridden with an environment variable (see .env.example).
 */
const env = process.env;
const cents = (v, fallback) => (v ? Math.round(parseFloat(v) * 100) : fallback);
const int = (v, fallback) => (v ? parseInt(v, 10) : fallback);

const config = {
  businessName: env.BUSINESS_NAME || 'KB Movement',
  coachName: env.COACH_NAME || '',
  location: env.LOCATION || '',
  contactEmail: env.CONTACT_EMAIL || '',
  contactPhone: env.CONTACT_PHONE || '',
  publicUrl: (env.PUBLIC_URL || '').replace(/\/$/, ''),
  timeZone: env.TIME_ZONE || 'America/New_York',

  // Training runs on these weekdays (0 = Sunday … 6 = Saturday): Wednesday, Thursday, Friday.
  days: [3, 4, 5],
  weeksAhead: int(env.WEEKS_AHEAD, 8),
  bookingCutoffMinutes: int(env.BOOKING_CUTOFF_MINUTES, 60), // online booking closes this long before a session
  holdMinutes: 32, // spots are held this long while a parent checks out (Stripe Checkout itself expires at 31)

  tracks: [
    {
      id: 'g811', kind: 'group', label: 'Ages 8–11', ages: '8–11', minAge: 8, maxAge: 11,
      start: '17:00', end: '18:15',
      capacity: int(env.GROUP_CAPACITY, 15),
      price: cents(env.PRICE_DROP_IN, 5999),
      bundlePrice: cents(env.PRICE_WEEK_BUNDLE, 15999)
    },
    {
      id: 'g1214', kind: 'group', label: 'Ages 12–14', ages: '12–14', minAge: 12, maxAge: 14,
      start: '18:15', end: '19:30',
      capacity: int(env.GROUP_CAPACITY, 15),
      price: cents(env.PRICE_DROP_IN, 5999),
      bundlePrice: cents(env.PRICE_WEEK_BUNDLE, 15999)
    },
    {
      id: 'p1', kind: 'private', label: '1-on-1', ages: 'Any age', minAge: null, maxAge: null,
      start: '19:30', end: '20:45',
      capacity: 1,
      price: cents(env.PRICE_PRIVATE, 9999),
      bundlePrice: null
    }
  ],

  winter: {
    name: 'Winter Select',
    summary: 'An invite-only squad of selected players who train together and represent us at winter tournaments.',
    host: {
      name: env.TOURNAMENT_HOST_NAME || 'Soccer Coliseum',
      url: env.TOURNAMENT_HOST_URL || 'https://soccercoliseum.com/tournaments/schedule/'
    },
    commitments: [
      'Attend every Winter Select training session unless you are sick or injured.',
      'Be available for our winter tournament weekends at Soccer Coliseum. I confirm which tournaments we enter with enrolled families first.',
      'Tell the coach at least 48 hours ahead if you have to miss anything.',
      'Bring the right kit every time: ball, shin guards, cleats or turf shoes, and water.'
    ]
  },

  // Server-only settings (never sent to the browser)
  adminPassword: env.ADMIN_PASSWORD || '',
  sessionSecret: env.SESSION_SECRET || '',
  stripeSecretKey: env.STRIPE_SECRET_KEY || '',
  stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
  databaseUrl: env.DATABASE_URL || env.POSTGRES_URL || '',   // set automatically by Vercel's Neon integration
  pgliteDir: env.PGLITE_DIR || '',                               // local built-in database folder (default: data/pglite)
  port: int(env.PORT, 3000),
  isProduction: env.NODE_ENV === 'production'
};

/*
 * Photos in public/photos:
 *  - coach.jpg (or .png/.webp) is the coach's portrait, shown in the "Your coach" badge at the top of the home page.
 *  - Every other photo, sorted by file name: the first is the large photo at the top, the rest appear under "At training".
 */
function imageSize(buf) {
  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return { w: 4, h: 3 };
}
function listPhotos() {
  const fs = require('node:fs');
  const dir = require('node:path').join(__dirname, '..', 'public', 'photos');
  const out = { coach: null, items: [] };
  try {
    for (const f of fs.readdirSync(dir).filter((x) => /\.(jpe?g|png|webp)$/i.test(x)).sort()) {
      const size = imageSize(fs.readFileSync(require('node:path').join(dir, f)));
      const photo = { src: 'photos/' + encodeURIComponent(f), w: size.w, h: size.h };
      if (/^coach\./i.test(f)) out.coach = photo; else if (out.items.length < 12) out.items.push(photo);
    }
  } catch (e) { /* no photos folder */ }
  return out;
}

/* The subset that is safe to show to visitors. */
config.publicConfig = function publicConfig() {
  return {
    businessName: config.businessName,
    coachName: config.coachName,
    location: config.location,
    contactEmail: config.contactEmail,
    contactPhone: config.contactPhone,
    publicUrl: config.publicUrl,
    timeZone: config.timeZone,
    days: config.days,
    weeksAhead: config.weeksAhead,
    bookingCutoffMinutes: config.bookingCutoffMinutes,
    holdMinutes: config.holdMinutes,
    tracks: config.tracks,
    winter: config.winter,
    photos: listPhotos(),
    payments: config.stripeSecretKey ? 'stripe' : 'test'
  };
};

module.exports = config;
