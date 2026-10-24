// Looks at the content pages the way a visitor does, headless: every page at 390 and 1440 pixels wide (and in the dark
// theme at 390), a screenshot of each, and the checks that a screenshot cannot make: no sideways scroll, no console error, no
// request that failed, every picture loaded, one h1, and the accessibility rules of axe (WCAG 2.2 A and AA) with no serious
// finding. The server runs inside this process and everything is closed before it exits: nothing is left running.
//
//   node packages/web/content/check.ts --out <folder>            all pages
//   node packages/web/content/check.ts --out <folder> --only privacy,tr/privacy
//   node packages/web/content/check.ts --out <folder> --only privacy --slices 4    also one picture per screenful (the first 4)
//   node packages/web/content/check.ts --out <folder> --only privacy --sections kept,rights   also one picture per named section
import { createReadStream, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { chromium } from '@playwright/test';
import { baseLaunchOptions } from '../../../tests/e2e/support/browser.ts';
import { REPO_ROOT, pages } from './build.ts';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json', '.txt': 'text/plain', '.woff2': 'font/woff2',
};

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const siteRoot = join(REPO_ROOT, 'site');
const icons = join(REPO_ROOT, 'design', 'brand', 'png', 'web');

/** The site folder as the host serves it: clean addresses (/privacy answers privacy.html) and the brand icons at the root. */
function fileFor(urlPath: string): string | null {
  let p: string;
  try { p = decodeURIComponent(urlPath.split('?')[0] ?? '/'); } catch { return null; }
  for (const base of [siteRoot, icons]) {
    const abs = normalize(join(base, p));
    if (abs !== base && !abs.startsWith(base + sep)) continue;
    for (const cand of [abs, `${abs}.html`, join(abs, 'index.html')]) {
      try { if (statSync(cand).isFile()) return cand; } catch { /* next */ }
    }
  }
  return null;
}

interface Finding { page: string; size: string; kind: string; detail: string }

async function main(): Promise<void> {
  const out = arg('out');
  if (!out) throw new Error('--out <folder> is required');
  mkdirSync(out, { recursive: true });
  const slices = Number(arg('slices') ?? 0);
  const sections = arg('sections')?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
  const only = arg('only')?.split(',').map((s) => s.trim()).filter(Boolean);
  const list = pages().filter((p) => !only || only.includes(p.url.replace(/^\//, '').replace(/\/$/, '') || 'home') || only.includes(p.file.replace(/\.html$/, '')));

  const server = createServer((req, res) => {
    const f = fileFor(req.url ?? '/');
    if (!f) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(f).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    createReadStream(f).pipe(res);
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as { port: number }).port;
  const origin = `http://127.0.0.1:${port}`;

  const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
  const browser = await chromium.launch(baseLaunchOptions);
  const findings: Finding[] = [];
  const summary: Record<string, unknown>[] = [];
  try {
    const runs: { name: string; width: number; height: number; scheme: 'light' | 'dark' }[] = [
      { name: '390', width: 390, height: 844, scheme: 'light' },
      { name: '1440', width: 1440, height: 900, scheme: 'light' },
      { name: '390-dark', width: 390, height: 844, scheme: 'dark' },
    ];
    for (const run of runs) {
      const context = await browser.newContext({ viewport: { width: run.width, height: run.height }, colorScheme: run.scheme, deviceScaleFactor: 1 });
      for (const spec of list) {
        const page = await context.newPage();
        const problems: string[] = [];
        page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
        page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
        page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()}`));
        page.on('response', (r) => { if (r.status() >= 400) problems.push(`status ${r.status()}: ${r.url()}`); });
        await page.goto(`${origin}${spec.url}`, { waitUntil: 'load' });
        const info = await page.evaluate(() => {
          const imgs = [...document.images].filter((i) => i.offsetParent !== null || getComputedStyle(i).display !== 'none');
          return {
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            h1: document.querySelectorAll('h1').length,
            badImages: imgs.filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src),
            lang: document.documentElement.lang,
            height: document.documentElement.scrollHeight,
          };
        });
        if (info.overflow > 0) problems.push(`sideways scroll of ${info.overflow}px`);
        if (info.h1 !== 1) problems.push(`${info.h1} h1 elements`);
        for (const src of info.badImages) problems.push(`picture did not load: ${src}`);
        if (run.scheme === 'light') {
          await page.addScriptTag({ content: axeSource });
          const axe = await page.evaluate(async () => {
            const r = await (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; impact: string; nodes: { target: string[] }[] }[] }> } }).axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } });
            return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }));
          });
          for (const v of axe) problems.push(`axe ${v.impact} ${v.id}: ${v.nodes.join(' | ')}`);
        }
        const name = `${spec.file.replace(/\.html$/, '').replace(/[\\/]/g, '-')}-${run.name}.png`;
        await page.screenshot({ path: join(out, name), fullPage: true });
        for (let s = 0; s < slices; s++) {
          await page.evaluate((y) => window.scrollTo(0, y), s * run.height);
          await page.screenshot({ path: join(out, name.replace('.png', `-s${s}.png`)) });
        }
        for (const id of sections) {
          const found = await page.evaluate((i) => { const el = document.getElementById(i); if (!el) return false; el.scrollIntoView({ block: 'start' }); window.scrollBy(0, -80); return true; }, id);
          if (found) await page.screenshot({ path: join(out, name.replace('.png', `-sec-${id}.png`)) });
        }
        for (const p of problems) findings.push({ page: spec.url, size: run.name, kind: 'problem', detail: p });
        summary.push({ page: spec.url, size: run.name, height: info.height, lang: info.lang, problems: problems.length });
        await page.close();
      }
      await context.close();
    }
  } finally {
    await browser.close();
    await new Promise<void>((ok) => server.close(() => ok()));
  }
  writeFileSync(join(out, 'report.json'), JSON.stringify({ summary, findings }, null, 1));
  for (const f of findings) console.log(`${f.page} @${f.size}: ${f.detail}`);
  console.log(`${list.length} page(s) at ${3} setting(s): ${findings.length} finding(s); screenshots in ${resolve(out)}`);
  process.exitCode = findings.length === 0 ? 0 : 1;
}

await main();
