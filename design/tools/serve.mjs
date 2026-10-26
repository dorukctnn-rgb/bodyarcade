// Tiny static server for the design pages (ES modules do not load from file://).
// Started and stopped by the check scripts; never left running.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.mjs': 'text/javascript', '.js': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif',
  '.woff2': 'font/woff2', '.webm': 'video/webm', '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.ico': 'image/x-icon',
};

export async function startServer(root) {
  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://x');
      let p = path.join(root, decodeURIComponent(u.pathname));
      if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
      const s = await stat(p).catch(() => null);
      if (s && s.isDirectory()) p = path.join(p, 'index.html');
      const body = await readFile(p);
      res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((ok) => server.close(ok)) };
}
