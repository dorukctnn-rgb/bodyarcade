// Local servers for the QA tools. Each one listens on a free port of 127.0.0.1 and is stopped by close(); nothing is left
// running when a tool ends, and no window ever opens.
import { createReadStream, statSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';

export interface Served { url: string; close(): Promise<void> }

export const repoRoot = (): string => resolve(fileURLToPath(new URL('../../', import.meta.url)));

/** The web shell (packages/web) through Vite, with the practice session and the test hooks. BA_FIXTURES: fill | only | none. */
export async function startWeb(fixtures: 'fill' | 'only' | 'none' = 'fill'): Promise<Served> {
  const prev = process.env['BA_FIXTURES'];
  process.env['BA_FIXTURES'] = fixtures;
  const server = await createViteServer({ configFile: join(repoRoot(), 'packages', 'web', 'vite.config.ts'), server: { port: 0, strictPort: false }, logLevel: 'error' });
  await server.listen();
  if (prev === undefined) delete process.env['BA_FIXTURES']; else process.env['BA_FIXTURES'] = prev;
  const port = (server.httpServer?.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}`, close: () => server.close() };
}

/** The repository's own Vite config: the platform's dev pages (tests/e2e/pages, tools/*), the pose assets. */
export async function startDev(): Promise<Served> {
  const server = await createViteServer({ configFile: join(repoRoot(), 'vite.config.ts'), server: { port: 0, strictPort: false }, logLevel: 'error' });
  await server.listen();
  const port = (server.httpServer?.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}`, close: () => server.close() };
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.wasm': 'application/wasm',
  '.webm': 'video/webm', '.mp4': 'video/mp4', '.mjpeg': 'video/x-motion-jpeg',
};

/** A folder as a static site, with clean URLs (/privacy -> /privacy.html) like the live host. */
export async function startStatic(dir: string): Promise<Served> {
  const base = resolve(dir);
  const http = createHttpServer((req, res) => {
    let p: string;
    try { p = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/'); } catch { res.writeHead(400).end(); return; }
    const abs = normalize(join(base, p));
    if (abs !== base && !abs.startsWith(base + sep)) { res.writeHead(403).end(); return; }
    for (const cand of [abs, `${abs}.html`, join(abs, 'index.html')]) {
      try {
        if (statSync(cand).isFile()) {
          res.writeHead(200, { 'content-type': TYPES[extname(cand).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' });
          createReadStream(cand).pipe(res);
          return;
        }
      } catch { /* next candidate */ }
    }
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  });
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok));
  const port = (http.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((ok) => { http.closeAllConnections(); http.close(() => ok()); }) };
}
