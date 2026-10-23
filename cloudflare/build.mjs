// Builds .cf-dist/ for the Cloudflare Worker (static assets) from site/ plus cloudflare/overlay/.
// site/ stays exactly what Netlify publishes; nothing Cloudflare-specific lives there.
//   node cloudflare/build.mjs && npx wrangler deploy            (workers.dev)
//   node cloudflare/build.mjs && npx wrangler deploy -c wrangler.prod.jsonc   (adds bodyarcade.com, once the zone is active)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = path.join(root, 'site');
const overlay = path.join(root, 'cloudflare', 'overlay');
const out = path.join(root, '.cf-dist');

fs.rmSync(out, { recursive: true, force: true });
// Workers match paths case-sensitively: /bodyarcade must find bodyarcade.html (the repo file is BodyArcade.html, which Netlify matches loosely).
fs.cpSync(site, out, { recursive: true, filter: (src) => path.relative(site, src) !== 'BodyArcade.html' });
fs.copyFileSync(path.join(site, 'BodyArcade.html'), path.join(out, 'bodyarcade.html'));
fs.cpSync(overlay, out, { recursive: true });
// The rule files must be LF-only whatever the checkout's line-ending setting (Windows git may hand out CRLF).
for (const f of ['_headers', '_redirects']) {
  const p = path.join(out, f);
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').split('\r\n').join('\n'));
}

const count = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? count(path.join(d, e.name)) : 1), 0);
const must = ['index.html', 'bodyarcade.html', 'sw.js', 'robots.txt', 'sitemap.xml', '_headers', '_redirects', '.well-known/assetlinks.json'];
for (const f of must) if (!fs.existsSync(path.join(out, f))) { console.error('missing from build: ' + f); process.exit(1); }
console.log(`built ${path.relative(root, out)}: ${count(out)} files (site ${count(site)} + overlay)`);
