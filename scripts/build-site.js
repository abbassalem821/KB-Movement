'use strict';
/*
 * Vercel build step: copies public/ to dist/site.
 *
 * Without a database (no DATABASE_URL), the site is built in demo mode: bookings, codes and the coach
 * dashboard run in each visitor's browser, so the link works straight after importing the repo.
 * Connect a Neon database in Vercel and redeploy, and the same build switches to the real site.
 *   node scripts/build-site.js
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'dist', 'site');
const hasDatabase = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL);

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(root, 'public'), out, { recursive: true });

if (!hasDatabase) {
  const config = require('../lib/config');
  const pub = config.publicConfig();
  pub.payments = 'test';
  fs.copyFileSync(path.join(root, 'preview', 'api-preview.js'), path.join(out, 'api-preview.js'));
  fs.writeFileSync(path.join(out, 'demo-config.js'), 'window.__NP_CONFIG__ = ' + JSON.stringify(pub).replace(/</g, '\\u003c') + ';\n');
  const indexFile = path.join(out, 'index.html');
  const html = fs.readFileSync(indexFile, 'utf8');
  const live = '<script src="api-http.js"></script>';
  if (!html.includes(live)) throw new Error('index.html no longer loads api-http.js; update scripts/build-site.js');
  fs.writeFileSync(indexFile, html.replace(live, '<script src="demo-config.js"></script>\n<script src="api-preview.js"></script>'));
}

console.log(`Built dist/site in ${hasDatabase ? 'live mode (database connected)' : 'demo mode (no database yet: everything runs in the browser)'}`);
