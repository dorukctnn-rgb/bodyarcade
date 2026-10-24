// Spike driver (temporary): node tools/synth-video/spike.ts <model-file-in-assets> [skin.png]
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { baseLaunchOptions } from '../../tests/e2e/support/browser.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [, , model, skin] = process.argv;
if (!model) { console.error('usage: node tools/synth-video/spike.ts <path under tools/synth-video/assets> [skin]'); process.exit(2); }
const out = process.env.SPIKE_OUT ?? resolve(root, 'qa-out');
mkdirSync(out, { recursive: true });
const server = await createServer({ configFile: resolve(root, 'vite.config.ts'), logLevel: 'warn', server: { port: 41500 + Math.floor(Math.random() * 500), strictPort: false, host: '127.0.0.1' } });
await server.listen();
const base = server.resolvedUrls?.local[0] ?? '';
const browser = await chromium.launch({ ...baseLaunchOptions, args: [...(baseLaunchOptions.args ?? []), '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.error('page:', m.text()); });
  page.on('pageerror', (e) => console.error('pageerror:', e.message));
  await page.goto(`${base}tools/synth-video/spike.html`);
  await page.waitForFunction(() => (window as unknown as { spikeReady?: boolean }).spikeReady === true, null, { timeout: 60000 });
  const poses = [
    { name: 'bind' }, { name: 'idle0', clip: 'idle', t: 0 }, { name: 'idle1', clip: 'idle', t: 0.7 },
    { name: 'walk0', clip: 'walk', t: 0.1 }, { name: 'walk1', clip: 'walk', t: 0.5 }, { name: 'run0', clip: 'run', t: 0.15 },
  ];
  const t0 = Date.now();
  const r = await page.evaluate(async (a) => (window as unknown as { spike: { run(o: unknown): Promise<unknown> } }).spike.run(a), {
    url: `/tools/synth-video/assets/${model}`, rotY: (Number(process.env.ROTY ?? 0) * Math.PI) / 180, height: 1.75, fovY: 50, frame: 0.8, skin: skin ? `/tools/synth-video/assets/${skin}` : undefined, poses,
  }) as { results: unknown[]; sheet: string; info: unknown };
  const name = model.replace(/[\\/]/g, '_').replace(/\.[^.]+$/, '');
  writeFileSync(resolve(out, `spike-${name}.jpg`), Buffer.from(r.sheet.split(',')[1] ?? '', 'base64'));
  console.log(name, JSON.stringify(r.info));
  console.table(r.results);
  console.log(`${((Date.now() - t0) / 1000).toFixed(1)} s -> ${resolve(out, `spike-${name}.jpg`)}`);
} finally {
  await browser.close();
  await server.close();
}
