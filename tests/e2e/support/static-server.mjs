// Minimal static file server for end-to-end tests (no dependencies). Started and stopped by Playwright's
// webServer option, so nothing keeps running after a test run.
// Usage: node tests/e2e/support/static-server.mjs <dir> <port>
// Like the live host it maps clean URLs (/privacy -> /privacy.html) and answers 404 for missing files.
import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';

const root = resolve(process.argv[2] || 'site');
const port = Number(process.argv[3] || 4310);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.wasm': 'application/wasm',
  '.task': 'application/octet-stream', '.y4m': 'application/octet-stream', '.mjpeg': 'video/x-motion-jpeg',
};

function fileFor(urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath.split('?')[0]); } catch { return null; }
  const abs = normalize(join(root, p));
  if (abs !== root && !abs.startsWith(root + sep)) return null;   // no path traversal
  for (const cand of [abs, abs + '.html', join(abs, 'index.html')]) {
    try { if (statSync(cand).isFile()) return cand; } catch { /* try the next candidate */ }
  }
  return null;
}

http.createServer((req, res) => {
  const f = fileFor(req.url || '/');
  if (!f) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(f).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
  createReadStream(f).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`static ${root} on http://127.0.0.1:${port}`));
