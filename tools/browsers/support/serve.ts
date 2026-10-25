// A static server that answers like the host does (Cloudflare Workers assets, wrangler.jsonc): a file when there is one, `/page`
// for page.html, `/folder` redirected to `/folder/`, byte ranges (Safari plays a video only from a server that answers them), and for
// an address nobody made either the app's own index.html with a 200 (mode 'spa': the single page application fallback of the
// practice build) or the site's 404 page with a 404 (mode '404': the release build).
//   node tools/browsers/support/serve.ts <dir> <port> [spa|404]
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.wasm': 'application/wasm', '.task': 'application/octet-stream', '.map': 'application/json',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream',
};

export type Fallback = 'spa' | '404';

const isFile = (p: string): boolean => { try { return statSync(p).isFile(); } catch { return false; } };
const isDir = (p: string): boolean => { try { return statSync(p).isDirectory(); } catch { return false; } };

export function startSite(dirArg: string, port: number, fallback: Fallback): Promise<Server> {
  const root = resolve(dirArg);
  if (!existsSync(root)) throw new Error(`no folder ${root}`);
  const inside = (abs: string): boolean => abs === root || abs.startsWith(root + sep);
  const send = (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, file: string, status = 200): void => {
    const size = statSync(file).size;
    const type = TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
    const range = status === 200 ? /^bytes=(\d*)-(\d*)$/.exec(String(req.headers['range'] ?? '')) : null;
    const base = { 'content-type': type, 'cache-control': 'no-cache', 'accept-ranges': 'bytes' };
    if (range && (range[1] !== '' || range[2] !== '')) {
      const start = range[1] === '' ? Math.max(0, size - Number(range[2])) : Number(range[1]);
      const end = range[1] === '' || range[2] === '' ? size - 1 : Math.min(size - 1, Number(range[2]));
      if (start > end || start >= size) { res.writeHead(416, { 'content-range': `bytes */${size}` }).end(); return; }
      res.writeHead(206, { ...base, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
      if (req.method === 'HEAD') { res.end(); return; }
      createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(status, { ...base, 'content-length': size });
    if (req.method === 'HEAD') { res.end(); return; }
    createReadStream(file).pipe(res);
  };
  const server = createServer((req, res) => {
    let path: string;
    try { path = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/'); } catch { res.writeHead(400).end(); return; }
    if (path === '/__ready') { res.writeHead(200, { 'content-type': 'text/plain' }).end('ok'); return; }
    const abs = normalize(join(root, path));
    if (!inside(abs)) { res.writeHead(403).end(); return; }
    // An exact file first (anything with an extension, and index.html itself).
    if (isFile(abs)) { send(req, res, abs); return; }
    const trailing = path.endsWith('/');
    const bare = trailing ? abs.slice(0, -1) : abs;
    // /page -> page.html; /folder -> /folder/ ; /folder/ -> folder/index.html; /page/ -> /page
    if (!trailing && isFile(`${abs}.html`)) { send(req, res, `${abs}.html`); return; }
    if (!trailing && isFile(join(abs, 'index.html'))) { res.writeHead(307, { location: `${path}/${(req.url ?? '').includes('?') ? `?${(req.url ?? '').split('?')[1]}` : ''}` }).end(); return; }
    if (trailing && isFile(join(abs, 'index.html'))) { send(req, res, join(abs, 'index.html')); return; }
    if (trailing && isFile(`${bare}.html`) && bare !== root) { res.writeHead(307, { location: path.slice(0, -1) }).end(); return; }
    if (extname(path) === '') {
      if (fallback === 'spa' && isFile(join(root, 'index.html'))) { send(req, res, join(root, 'index.html')); return; }
      if (fallback === '404' && isFile(join(root, '404.html'))) { send(req, res, join(root, '404.html'), 404); return; }
    }
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  });
  return new Promise((ok, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', () => ok(server)); });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const [dir, port, mode] = process.argv.slice(2);
  if (!dir || !port) { console.error('usage: node tools/browsers/support/serve.ts <dir> <port> [spa|404]'); process.exit(2); }
  await startSite(dir, Number(port), mode === '404' ? '404' : 'spa');
  console.log(`serving ${resolve(dir)} on http://127.0.0.1:${port}`);
}
