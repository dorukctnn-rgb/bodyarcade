// Google Play graphics from the design pages (headless):
//   design/store/export/feature-graphic.png        1024 x 500, 24-bit PNG (Play feature graphic)
//   design/store/export/feature-graphic-dark.png   the same on the night court, for promos
//   design/store/export/phone-<n>.png              1080 x 1920 phone screenshots, n = 1..6 (store order)
//   design/store/export/contact.webp               all of them on one sheet for review
// node design/tools/render-store.mjs [--only feature|shots]
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';
import { launch, sharp } from './pw.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = path.join(repo, 'design', 'store', 'export');
await mkdir(out, { recursive: true });
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const only = arg('--only', null);
const BG = { light: '#F4F2F8', dark: '#1A1430' };

const server = await startServer(repo);
const browser = await launch();
const settle = async (page) => {
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 120000 });
  for (const f of page.frames()) {
    await f.waitForFunction(() => [...document.images].every((i) => i.complete) && document.fonts.status === 'loaded', null, { timeout: 30000 }).catch(() => {});
  }
  await page.waitForTimeout(300);
};
const files = [];
try {
  if (!only || only === 'feature') {
    for (const theme of ['light', 'dark']) {
      const ctx = await browser.newContext({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 2, colorScheme: theme });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${server.url}/design/store/feature.html?theme=${theme}`, { waitUntil: 'networkidle' });
      await settle(page);
      if (errors.length) throw new Error(`feature ${theme}: ${errors.join('; ')}`);
      const buf = await page.screenshot();
      const name = theme === 'light' ? 'feature-graphic.png' : 'feature-graphic-dark.png';
      await sharp(buf).resize(1024, 500, { kernel: 'lanczos3' }).flatten({ background: BG[theme] }).png({ compressionLevel: 9 }).toFile(path.join(out, name));
      files.push(name); console.log(`store ${name}`);
      await ctx.close();
    }
  }
  if (!only || only === 'shots') {
    for (let n = 1; n <= 6; n++) {
      const ctx = await browser.newContext({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2, colorScheme: 'light' });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${server.url}/design/store/shot.html?n=${n}`, { waitUntil: 'networkidle' });
      await settle(page);
      if (errors.length) throw new Error(`shot ${n}: ${errors.join('; ')}`);
      const name = `phone-${n}.png`;
      await sharp(await page.screenshot()).flatten({ background: BG.light }).png({ compressionLevel: 9 }).toFile(path.join(out, name));
      files.push(name); console.log(`store ${name}`);
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
// Review sheet: the feature graphic on top, the six screenshots below.
const shots = files.filter((f) => f.startsWith('phone-'));
if (shots.length === 6 && files.includes('feature-graphic.png')) {
  const W = 6 * 270 + 7 * 16, top = 16 + 500 + 16;
  const comp = [{ input: await sharp(path.join(out, 'feature-graphic.png')).toBuffer(), left: 16, top: 16 }];
  for (const [i, f] of shots.entries()) comp.push({ input: await sharp(path.join(out, f)).resize(270, 480).toBuffer(), left: 16 + i * 286, top });
  await sharp({ create: { width: W, height: top + 480 + 16, channels: 3, background: '#8A84A0' } }).composite(comp).webp({ quality: 86 }).toFile(path.join(out, 'contact.webp'));
  console.log('store contact.webp');
}
