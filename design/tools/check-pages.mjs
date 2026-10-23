// Render design pages headless at the layout breakpoints, save screenshots and check:
// no horizontal scroll, the primary action fully on screen, no clipped button or chip text,
// no console errors. node design/tools/check-pages.mjs <set> [--only id]
//   sets: onboarding (7 steps + result, 10 screens), kit (UI kit pages at 390 and 1440)
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { BREAKPOINTS, duoAvailable } from '../tokens/layout.mjs';
import { startServer } from './serve.mjs';
import { launch, saveShot } from './pw.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const set = process.argv[2] || 'onboarding';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const only = arg('--only', null);
const theme = arg('--theme', 'light');

const SETS = {
  onboarding: {
    dir: 'onboarding',
    pages: [1, 2, 3, 4, 5, 6, 7].map((s) => ({ name: `step-${s}`, url: `design/onboarding/index.html?step=${s}&static=1&theme=${theme}` }))
      .concat([{ name: 'step-7-done', url: `design/onboarding/index.html?step=7&done=1&static=1&theme=${theme}` },
        { name: 'step-4-duo', url: `design/onboarding/index.html?step=4&players=2&device=tv&static=1&theme=${theme}`, when: duoAvailable }]),
    sizes: BREAKPOINTS,
  },
  kit: {
    dir: 'kit',
    pages: (arg('--pages', 'home,game-card,calibration,results,paywall,live-room,settings')).split(',').map((p) => ({ name: p, url: `design/ui-kit/${p}.html?theme=${theme}` })),
    sizes: BREAKPOINTS.filter((b) => ['phone-390', 'laptop-1440'].includes(b.id)).concat(arg('--all', null) ? BREAKPOINTS.filter((b) => !['phone-390', 'laptop-1440'].includes(b.id)) : []),
  },
  brand: { dir: 'brand', pages: [{ name: 'brand-sheet', url: 'design/brand/index.html' }], sizes: BREAKPOINTS.filter((b) => ['phone-390', 'laptop-1440'].includes(b.id)), full: true },
  art: { dir: 'art', pages: [{ name: 'art-direction', url: 'design/art/index.html' }], sizes: BREAKPOINTS.filter((b) => ['phone-390', 'laptop-1440'].includes(b.id)), full: true },
  store: { dir: 'store', pages: [{ name: 'play-graphics', url: 'design/store/index.html' }], sizes: BREAKPOINTS.filter((b) => ['phone-390', 'laptop-1440'].includes(b.id)), full: true },
  index: { dir: 'index', pages: [{ name: 'design-index', url: 'design/index.html' }], sizes: BREAKPOINTS.filter((b) => ['phone-390', 'laptop-1440'].includes(b.id)), full: true },
};
const S = SETS[set];
const outDir = path.join(repo, 'design', 'shots', S.dir + (theme === 'dark' ? '-dark' : ''));
await mkdir(outDir, { recursive: true });

const server = await startServer(repo);
const browser = await launch();
const report = [];
let failures = 0;
try {
  for (const bp of S.sizes.filter((b) => !only || b.id === only)) {
    for (const p of S.pages) {
      if (p.when && !p.when(bp)) continue;
      const ctx = await browser.newContext({ viewport: { width: bp.w, height: bp.h }, deviceScaleFactor: 1, colorScheme: theme });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      const t0 = Date.now();
      await page.goto(`${server.url}/${p.url}`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => document.documentElement.dataset.ready === '1' || document.readyState === 'complete' && !document.querySelector('script[type=module][data-wait]'), null, { timeout: 90000 });
      await page.evaluate(() => document.fonts.ready);
      // Onboarding panels must fit without scrolling, except on the smallest phone and on
      // phones held sideways, where the panel may scroll under a fade (the button stays put).
      const mayScroll = ['phone-360', 'phone-land-844', 'phone-land-915'].includes(bp.id);
      const res = await page.evaluate((mayScroll) => {
        const out = { problems: [] };
        const W = innerWidth, H = innerHeight;
        const sc = document.querySelector('.ob-scroll');
        if (sc && sc.offsetParent && !mayScroll && sc.scrollHeight > sc.clientHeight + 4) out.problems.push(`panel needs scrolling (${sc.scrollHeight - sc.clientHeight}px hidden)`);
        const ox = document.documentElement.scrollWidth - W;
        if (ox > 0) out.problems.push(`horizontal scroll ${ox}px`);
        const prim = [...document.querySelectorAll('.ba-btn--primary')].filter((b) => b.offsetParent && !b.closest('[data-offscreen-ok]'));
        if (!document.body.dataset.long) {
          for (const b of prim.slice(0, 1)) {
            const r = b.getBoundingClientRect();
            if (r.top < 0 || r.bottom > H + 0.5 || r.left < 0 || r.right > W + 0.5) out.problems.push(`primary button "${b.textContent.trim()}" not fully on screen (${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)})`);
          }
        }
        for (const el of document.querySelectorAll('.ba-btn, .ba-chip, .ob-seg button, .ob-level, .hud-command')) {
          if (!el.offsetParent) continue;
          if (el.scrollWidth > el.clientWidth + 1) out.problems.push(`text clipped in "${el.textContent.trim().slice(0, 30)}"`);
        }
        out.stats = window.__ob?.stats ?? null;
        return out;
      }, mayScroll);
      const problems = [...res.problems, ...errors.map((e) => `console: ${e}`)];
      const file = await saveShot(await page.screenshot({ fullPage: !!S.full }), path.join(outDir, `${p.name}-${bp.id}`));
      report.push({ page: p.name, breakpoint: bp.id, ms: Date.now() - t0, problems, stats: res.stats, shot: path.relative(repo, file).split(path.sep).join('/') });
      if (problems.length) { failures++; console.log(`FAIL ${p.name} ${bp.id}: ${problems.join('; ')}`); }
      else console.log(`pass ${p.name.padEnd(14)} ${bp.id}`);
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
await writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 1));
console.log(failures ? `${failures} page(s) with problems` : `all ${report.length} pass`);
process.exit(failures ? 1 : 0);
