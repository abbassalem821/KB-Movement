'use strict';
/*
 * Builds dist/preview.html: the whole site in one self-contained file that runs without the server
 * (bookings, codes and payments are simulated in the browser). Used for the shareable preview link.
 *   npm run build:preview
 */
const fs = require('node:fs');
const path = require('node:path');

delete process.env.STRIPE_SECRET_KEY;
const config = require('../lib/config');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const scripts = ['public/core.js', 'public/graphics.js', 'preview/api-preview.js', 'public/app.js'].map(read);
for (const s of scripts) if (/<\/script/i.test(s)) throw new Error('A script contains a closing script tag; escape it before inlining.');
const pub = config.publicConfig();
// Photos are embedded as data URIs so the single-file preview can show them.
const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif' };
pub.photos = pub.photos.map((p) => {
  const file = path.join(root, 'public', decodeURIComponent(p));
  return `data:${mime[path.extname(file).slice(1).toLowerCase()]};base64,${fs.readFileSync(file).toString('base64')}`;
});
const cfg = JSON.stringify(pub).replace(/</g, '\\u003c');

const html = [
  `<title>${config.businessName}</title>`,
  '<meta name="claude:viewport-fit-sides" content="cover">',
  '<link rel="preconnect" href="https://fonts.googleapis.com">',
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nunito:wght@700;800;900&family=Nunito+Sans:opsz,wght@6..12,400;6..12,600;6..12,700&display=swap">',
  `<style>\n${read('public/styles.css')}\n</style>`,
  '<div id="app" aria-live="polite"><p class="boot">Loading…</p></div>',
  '<div id="toast" role="status" hidden></div>',
  `<script>\n${scripts[0]}\n</script>`,
  `<script>\n${scripts[1]}\n</script>`,
  `<script>window.__NP_CONFIG__ = ${cfg};</script>`,
  `<script>\n${scripts[2]}\n</script>`,
  `<script>\n${scripts[3]}\n</script>`,
  ''
].join('\n');

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'preview.html'), html);
console.log(`Wrote dist/preview.html (${(html.length / 1024).toFixed(1)} KB)`);
