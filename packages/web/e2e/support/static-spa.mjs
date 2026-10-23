// A static server for the built site, answering like the host will: a file when there is one, a page of the site
// (index.html in a folder) for a clean address, and for an address nobody generated the app's own index.html with a
// 200 (the host's single page application fallback). A missing file with an extension is a plain 404.
// Usage: node packages/web/e2e/support/static-spa.mjs <dir> <port>
import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';

const root = resolve(process.argv[2] || 'packages/web/dist');
const port = Number(process.argv[3] || 4310);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.wasm': 'application/wasm',
  '.task': 'application/octet-stream', '.map': 'application/json',
};

function fileFor(urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath.split('?')[0]); } catch { return null; }
  const abs = normalize(join(root, p));
  if (abs !== root && !abs.startsWith(root + sep)) return null;
  for (const cand of [abs, join(abs, 'index.html')]) {
    try { if (statSync(cand).isFile()) return cand; } catch { /* next */ }
  }
  return null;
}

http.createServer((req, res) => {
  const url = req.url || '/';
  let f = fileFor(url);
  let status = 200;
  if (!f) {
    if (extname(url.split('?')[0]) !== '') { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); return; }
    f = join(root, 'index.html');
  }
  res.writeHead(status, { 'content-type': TYPES[extname(f).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
  createReadStream(f).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`static ${root} on http://127.0.0.1:${port}`));
