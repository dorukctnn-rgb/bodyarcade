// After the production switch: tell IndexNow (Bing, Yandex and others) about every address in the sitemap, with the
// site's existing key file (/06bb4e63d6d4983eed0ac457e2d4a483.txt). Run by the main session, never on the preview.
//   node release/indexnow.ts            reads dist/sitemap.xml (built for production) and submits it
//   node release/indexnow.ts --dry-run  prints what it would send
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CANONICAL_ORIGIN } from './site.ts';

const KEY = '06bb4e63d6d4983eed0ac457e2d4a483';
const root = fileURLToPath(new URL('..', import.meta.url));
const stamp = JSON.parse(readFileSync(join(root, 'dist', 'version.json'), 'utf8')) as { target: string };
if (stamp.target !== 'production') { console.error('dist/ is not a production build'); process.exit(1); }
const urls = [...readFileSync(join(root, 'dist', 'sitemap.xml'), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1] as string);
const body = { host: new URL(CANONICAL_ORIGIN).host, key: KEY, keyLocation: `${CANONICAL_ORIGIN}/${KEY}.txt`, urlList: urls };
if (process.argv.includes('--dry-run')) { console.log(JSON.stringify(body, null, 1)); process.exit(0); }
const res = await fetch('https://api.indexnow.org/indexnow', { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) });
console.log(`IndexNow: ${res.status} for ${urls.length} addresses`);
if (res.status >= 400) process.exit(1);
