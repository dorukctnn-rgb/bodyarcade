// Render the in-game HUD mockup on every breakpoint and mode, check overlaps and clipping
// from the real DOM, and save screenshots to design/shots/hud/.
// node design/tools/check-hud.mjs [--modes scene,live-friend] [--only phone-390]
import path from 'node:path';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { BREAKPOINTS, duoAvailable } from '../tokens/layout.mjs';
import { startServer } from './serve.mjs';
import { launch, saveShot } from './pw.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const outDir = path.join(repo, 'design', 'shots', 'hud');
await mkdir(outDir, { recursive: true });

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const modes = arg('--modes', 'scene,scene-tl,scene-de,live-friend,live-ghost,mirror,mirror-tr,duo,duo-away').split(',');
const only = arg('--only', null);

const server = await startServer(repo);
const browser = await launch();
const report = [];
let failures = 0;
try {
  for (const bp of BREAKPOINTS.filter((b) => !only || b.id === only)) {
    for (const mode of modes) {
      if (mode.startsWith('duo') && !duoAvailable(bp)) continue; // 2 players: big screens only
      const ctx = await browser.newContext({ viewport: { width: bp.w, height: bp.h }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      const VARIANTS = {
        'scene-tl': 'mode=scene&corner=top-left',
        'scene-de': `mode=scene&corner=bottom-left&cmd=${encodeURIComponent('Knie­beugen')}&reason=${encodeURIComponent('Hüfte bleibt 4 cm über der Linie')}`,
        'mirror-tr': `mode=mirror&cmd=${encodeURIComponent('Sağ el')}&pose=reach&reason=${encodeURIComponent('Sol el değil, sağ el')}`,
      };
      const query = VARIANTS[mode] ?? `mode=${mode}&corner=bottom-right`;
      const pageUrl = mode === 'duo' ? 'hud-duo.html' : mode === 'duo-away' ? 'hud-duo.html?away=p2' : `hud.html?${query}`;
      await page.goto(`${server.url}/design/ui-kit/${pageUrl}`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 15000 });
      const res = await page.evaluate(() => ({
        problems: window.__hud.problems, rendered: window.__hud.rendered, commandFont: window.__hud.commandFont,
        overflowX: document.documentElement.scrollWidth - innerWidth,
      }));
      const problems = [...res.problems, ...errors.map((e) => `console: ${e}`)];
      if (res.overflowX > 0) problems.push(`horizontal overflow ${res.overflowX}px`);
      const file = await saveShot(await page.screenshot(), path.join(outDir, `${mode}-${bp.id}`));
      report.push({ breakpoint: bp.id, w: bp.w, h: bp.h, mode, commandFont: res.commandFont, commandPct: +(100 * res.commandFont / bp.h).toFixed(1), problems, rects: res.rendered, shot: path.relative(repo, file).replaceAll('\\', '/') });
      if (problems.length) { failures++; console.log(`FAIL ${bp.id} ${mode}: ${problems.join('; ')}`); }
      else console.log(`pass ${bp.id.padEnd(17)} ${mode.padEnd(12)} command ${res.commandFont}px (${(100 * res.commandFont / bp.h).toFixed(1)} %)`);
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
// Merge with an earlier full run so a partial run (--only, --modes) keeps the other rows.
const prev = JSON.parse(await readFile(path.join(outDir, 'report.json'), 'utf8').catch(() => '[]'));
const key = (x) => `${x.breakpoint}|${x.mode}`;
const merged = new Map(prev.map((x) => [key(x), x]));
for (const x of report) merged.set(key(x), x);
const order = (x) => BREAKPOINTS.findIndex((b) => b.id === x.breakpoint) * 100 + modes.indexOf(x.mode);
await writeFile(path.join(outDir, 'report.json'), JSON.stringify([...merged.values()].sort((a, b) => order(a) - order(b)), null, 1));
console.log(failures ? `${failures} layout(s) with problems` : `all ${report.length} layouts pass`);
process.exit(failures ? 1 : 0);
