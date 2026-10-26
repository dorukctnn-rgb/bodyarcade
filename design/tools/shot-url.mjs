// node design/tools/shot-url.mjs <path-under-repo?query> <out-file-no-ext> <w> <h> [waitReady=1]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';
import { launch, saveShot } from './pw.mjs';
const [, , rel, out, w, h, wait = '1'] = process.argv;
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const server = await startServer(repo);
const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(`${server.url}/${rel}`, { waitUntil: 'networkidle' });
  if (wait === '1') await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 60000 });
  const stats = await page.evaluate(() => window.__stats ?? null);
  const file = await saveShot(await page.screenshot(), out);
  console.log(file, JSON.stringify(stats), errs.join(' | '));
} finally { await browser.close(); await server.close(); }
