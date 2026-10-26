// Render the catalogue art (design/art/tiles.mjs) to design/art/tiles/<game>.webp
// (800 x 600 for game tiles, the game page hero and the store screenshots) and a 400 x 300
// version for small tiles. Rendered at 2x and downscaled for clean edges.
// node design/tools/render-tiles.mjs [--only squat-flap]
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';
import { launch, sharp } from './pw.mjs';
import { TILE_IDS } from '../art/tile-ids.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = path.join(repo, 'design', 'art', 'tiles');
await mkdir(out, { recursive: true });
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const only = arg('--only', null);
const W = 1600, H = 1200;

const server = await startServer(repo);
const browser = await launch();
try {
  for (const id of TILE_IDS.filter((g) => !only || g === only)) {
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${server.url}/design/art/render-tiles.html?game=${id}&w=${W}&h=${H}`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 120000 }).catch(() => {});
    if (errors.length) { console.log(`FAIL ${id}: ${errors.join('; ')}`); await page.close(); continue; }
    const buf = Buffer.from((await page.evaluate(() => window.__png())).split(',')[1], 'base64');
    await sharp(buf).resize(800, 600, { kernel: 'lanczos3' }).webp({ quality: 84 }).toFile(path.join(out, `${id}.webp`));
    await sharp(buf).resize(400, 300, { kernel: 'lanczos3' }).webp({ quality: 82 }).toFile(path.join(out, `${id}-400.webp`));
    console.log(`tile ${id}`);
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
