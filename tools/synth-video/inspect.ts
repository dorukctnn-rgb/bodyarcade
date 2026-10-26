// Dev helper: prints a model's node tree (bones with world positions) so the rig can be mapped. node tools/synth-video/inspect.ts <file under assets>
import { chromium } from '@playwright/test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { baseLaunchOptions } from '../../tests/e2e/support/browser.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const model = process.argv[2];
if (!model) { console.error('usage: node tools/synth-video/inspect.ts <path under tools/synth-video/assets>'); process.exit(2); }
const server = await createServer({ configFile: resolve(root, 'vite.config.ts'), logLevel: 'error', server: { port: 41500 + Math.floor(Math.random() * 500), strictPort: false, host: '127.0.0.1' } });
await server.listen();
const base = server.resolvedUrls?.local[0] ?? '';
const browser = await chromium.launch({ ...baseLaunchOptions, args: [...(baseLaunchOptions.args ?? []), '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('pageerror:', e.message));
  await page.goto(`${base}tools/synth-video/spike.html`);
  await page.waitForFunction(() => (window as unknown as { spikeReady?: boolean }).spikeReady === true, null, { timeout: 60000 });
  const r = await page.evaluate(async (u) => (window as unknown as { spike: { inspect(u: string): Promise<unknown> } }).spike.inspect(u), `/tools/synth-video/assets/${model}`) as { tree: string[]; box: number[]; clips: string[] };
  console.log(r.tree.join('\n'));
  console.log('box', r.box.map((x) => x.toFixed(3)).join(' '), 'clips', r.clips.join(', '));
} finally { await browser.close(); await server.close(); }
