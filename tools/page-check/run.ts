// page-check: opens pages at the ten screen sizes of the layout rule (BUILD-PLAN "Screen layout rule"), saves a picture of
// each and fails on layout bugs (see probe.ts) and on console errors, uncaught errors and failed requests.
// Headless only; starts the servers it needs on free ports and stops them at the end.
//
//   npm run qa:pages                                  every built-in target (web shell + live site) at the ten sizes
//   npm run qa:pages -- --only web:home,web:play      some targets (a prefix works: --only web:game)
//   npm run qa:pages -- --sizes 360x780,1280x800      some sizes (or breakpoint ids: phone-390)
//   npm run qa:pages -- --url http://127.0.0.1:5173/x.html [--click "#start"] [--wait-for ".ready"] [--hook '{"timeScale":5}']
//   npm run qa:pages -- --list                        what would be checked
//   options: --lang tr --dark --plan pro --out qa-out/page-check --png --no-shots --warn-as-error --jobs 1 --camera tests/traces/videos/x.mjpeg
//            --groups web,site   --fixtures fill|only|none   --allow-external   --ignore ".selector,.other"
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { baseLaunchOptions, withFakeVideo } from '../../tests/e2e/support/browser.ts';
import { BREAKPOINTS } from '../../packages/core/ui/layout.ts';
import { startDev, startStatic, startWeb, repoRoot, type Served } from './servers.ts';
import { builtinTargets, type Step, type Target } from './targets.ts';
import { layoutProbe, type Finding, type ProbeResult } from './probe.ts';
import { analyseScene, decodePng, isBlank, type Rect } from './scene.ts';
import { beNice } from './nice.ts';

beNice();

// ---- arguments ----------------------------------------------------------------------------------------------------------
const argv = process.argv.slice(2);
const flags = new Map<string, string[]>();
for (let i = 0; i < argv.length; i++) {
  const a = argv[i] as string;
  if (!a.startsWith('--')) continue;
  const eq = a.indexOf('=');
  const key = eq > 0 ? a.slice(2, eq) : a.slice(2);
  let val: string;
  if (eq > 0) val = a.slice(eq + 1);
  else if (argv[i + 1] !== undefined && !(argv[i + 1] as string).startsWith('--')) { val = argv[i + 1] as string; i += 1; } else val = 'true';
  flags.set(key, [...(flags.get(key) ?? []), val]);
}
const flag = (k: string): string | undefined => flags.get(k)?.[flags.get(k)!.length - 1];
const has = (k: string): boolean => flags.has(k) && flag(k) !== 'false';
const list = (k: string): string[] => (flags.get(k) ?? []).flatMap((v) => v.split(',')).map((s) => s.trim()).filter(Boolean);

const lang = flag('lang') ?? 'en';
const plan = flag('plan') ?? 'free';
const dark = has('dark');
const out = resolve(flag('out') ?? join(repoRoot(), 'qa-out', 'page-check'));
// One page at a time by default (the machine is shared); --jobs 3 on a quiet one.
const jobsN = Math.max(1, Number(flag('jobs') ?? 1));
const shots = !has('no-shots');
const png = has('png');
const warnAsError = has('warn-as-error');
const groups = list('groups').length ? list('groups') : ['web', 'site'];

const sizes = (() => {
  const wanted = list('sizes');
  if (!wanted.length) return BREAKPOINTS.map((b) => ({ id: b.id, w: b.w, h: b.h }));
  return wanted.map((s) => {
    const bp = BREAKPOINTS.find((b) => b.id === s);
    if (bp) return { id: bp.id, w: bp.w, h: bp.h };
    const m = /^(\d+)x(\d+)$/.exec(s);
    if (!m) throw new Error(`unknown size ${s}: use WIDTHxHEIGHT or one of ${BREAKPOINTS.map((b) => b.id).join(', ')}`);
    return { id: s, w: Number(m[1]), h: Number(m[2]) };
  });
})();

// ---- targets ------------------------------------------------------------------------------------------------------------
let targets: Target[];
if (flag('url')) {
  const steps: Step[] = [];
  for (const c of flags.get('click') ?? []) steps.push({ click: c });
  for (const w of flags.get('wait-for') ?? []) steps.push({ waitFor: w });
  const hooks = flag('hook') ? (JSON.parse(flag('hook') as string) as Record<string, unknown>) : undefined;
  targets = [{ id: flag('name') ?? 'url', server: 'external', path: flag('url') as string, steps, ...(hooks ? { hooks } : {}) }];
} else {
  const prefix = lang === 'en' ? '' : `/${lang}`;
  targets = builtinTargets({ prefix, groups });
  const only = list('only');
  if (only.length) targets = targets.filter((t) => only.some((o) => t.id === o || t.id.startsWith(`${o}:`) || t.id.startsWith(o)));
}
if (has('list')) {
  for (const t of targets) console.log(`${t.id.padEnd(34)} ${t.server.padEnd(8)} ${t.path}${t.steps?.length ? `  (${t.steps.length} step(s))` : ''}${t.sizes ? `  [${t.sizes.length} size(s)]` : ''}`);
  console.log(`${targets.length} target(s) x ${sizes.length} size(s) = ${targets.reduce((n, t) => n + sizes.filter((s) => !t.sizes || t.sizes.includes(s.id)).length, 0)} screen(s)`);
  process.exit(0);
}
if (!targets.length) { console.error('nothing to check (see --list)'); process.exit(2); }

// ---- running ------------------------------------------------------------------------------------------------------------
export interface PageResult {
  target: string; size: string; w: number; h: number;
  errors: number; warnings: number;
  findings: Finding[]; messages: string[]; probe: string[]; probeWarn: string[];
  shot: string | null; ms: number; stats: ProbeResult['stats'] | null;
}

const servers = new Map<string, Served>();
async function serverFor(kind: Target['server']): Promise<string> {
  if (kind === 'external') return '';
  const have = servers.get(kind);
  if (have) return have.url;
  const s = kind === 'web' ? await startWeb((flag('fixtures') as 'fill' | 'only' | 'none' | undefined) ?? 'fill')
    : kind === 'dev' ? await startDev() : await startStatic(join(repoRoot(), 'site'));
  servers.set(kind, s);
  return s.url;
}

const slug = (s: string): string => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();

async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].filter((i) => !i.complete).map((i) => i.decode().catch(() => undefined)));
    const finite = document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity);
    await Promise.race([Promise.all(finite.map((a) => a.finished.catch(() => undefined))), new Promise((r) => setTimeout(r, 2500))]);
  });
  await page.waitForTimeout(120);
}

async function runStep(page: Page, s: Step): Promise<void> {
  if ('click' in s) await page.locator(s.click).first().click({ timeout: 8000 });
  else if ('waitFor' in s) await page.waitForSelector(s.waitFor, { timeout: 20000 });
  else if ('waitGone' in s) await page.waitForFunction((sel) => !document.querySelector(sel), s.waitGone, { timeout: 20000 });
  else if ('waitUrl' in s) await page.waitForURL(new RegExp(s.waitUrl), { timeout: 30000 });
  else if ('wait' in s) await page.waitForTimeout(s.wait);
  else if ('press' in s) await page.keyboard.press(s.press);
  else if ('goto' in s) await page.goto(s.goto, { waitUntil: 'networkidle' });
  else await page.evaluate(s.eval);
}

async function check(browser: Browser, t: Target, size: { id: string; w: number; h: number }): Promise<PageResult> {
  const t0 = Date.now();
  const base = await serverFor(t.server);
  const url = t.server === 'external' ? t.path : `${base}${t.path}`;
  const origin = new URL(url).origin;
  const touch = size.w < 1000;
  const context: BrowserContext = await browser.newContext({
    viewport: { width: size.w, height: size.h }, deviceScaleFactor: 1, hasTouch: touch, isMobile: false,
    colorScheme: dark ? 'dark' : 'light', locale: lang === 'en' ? 'en-US' : `${lang}-${lang.toUpperCase()}`, reducedMotion: 'no-preference',
  });
  const page = await context.newPage();
  const messages: string[] = [];
  const warnings: string[] = [];
  const blocked = new Set<string>();
  // Messages of the software GL driver of the headless browser are not the page's.
  const allowed = ['GPU stall due to ReadPixels', 'Autofocus processing was blocked', 'OpenGL error checking is disabled', 'inference_feedback_manager', 'XNNPACK', ...(t.allowMessages ?? []), ...list('allow')];
  const isAllowed = (s: string): boolean => allowed.some((a) => s.includes(a));
  if (!has('allow-external')) {
    await context.route((u) => u.origin !== origin && !['data:', 'blob:', 'about:'].includes(u.protocol), (route) => { blocked.add(route.request().url()); return route.abort(); });
  }
  page.on('pageerror', (e) => { if (!isAllowed(e.message)) messages.push(`uncaught: ${e.message.split('\n')[0]}`); });
  page.on('console', (m) => {
    const text = m.text();
    if (m.type() === 'error') { if (!blocked.has(m.location().url) && !isAllowed(text) && !isAllowed(m.location().url)) messages.push(`console.error: ${text.split('\n')[0]}`); }
    else if (m.type() === 'warning' && !isAllowed(text)) warnings.push(`console.warn: ${text.split('\n')[0]}`);
  });
  page.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith(origin) && !isAllowed(r.url())) messages.push(`HTTP ${r.status()}: ${r.url().slice(origin.length)}`); });
  page.on('requestfailed', (r) => { if (r.url().startsWith(origin) && !isAllowed(r.url()) && !/ERR_ABORTED/.test(r.failure()?.errorText ?? '')) messages.push(`request failed: ${r.url().slice(origin.length)} (${r.failure()?.errorText})`); });

  const hooks = { ...(t.hooks ?? { timeScale: 40, roundSeconds: 6 }) };
  await page.addInitScript((h) => { (window as unknown as { __BA_TEST__: unknown }).__BA_TEST__ = h; }, hooks);
  const sep = url.includes('?') ? '&' : '?';
  const full = t.server === 'web' && plan !== 'free' ? `${url}${sep}plan=${plan}` : t.server === 'web' ? `${url}${sep}plan=free` : url;
  let probe: ProbeResult | null = null;
  let probeLines: string[] = [];
  let shot: string | null = null;
  let sceneFinding: Finding | null = null;
  try {
    await page.goto(full, { waitUntil: 'networkidle', timeout: 45000 });
    for (const s of t.steps ?? []) await runStep(page, s);
    await settle(page);
    if (t.probe) probeLines = (await page.evaluate(t.probe) as string[] | undefined) ?? [];
    probe = await page.evaluate(layoutProbe, { ignore: [...(t.ignore ?? []), ...list('ignore')], touch, minTarget: 24, primary: [...(t.primary ?? []), ...list('primary')] });
    if (t.expectScene) {
      const m = await page.evaluate(() => {
        const rect = (el: Element): { x: number; y: number; w: number; h: number } => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
        const shown = (el: Element): boolean => { const st = getComputedStyle(el); const r = el.getBoundingClientRect(); return st.display !== 'none' && st.visibility !== 'hidden' && r.width > 0 && r.height > 0 && !(el as HTMLElement).hidden; };
        const scene = document.querySelector('[data-scene]');
        const covered = [...document.querySelectorAll('[data-hud], [data-hud-root] button, .ba-pip-host, .ba-camera-host, .ba-overlay:has(*), [data-hud-root] .ba-combo')].filter(shown).map(rect);
        return { scene: scene ? rect(scene) : null, covered, overlay: !!document.querySelector('.ba-overlay:has(*)') };
      });
      if (m.scene && !m.overlay) {
        const rep = analyseScene(decodePng(await page.screenshot({ type: 'png' })), m.scene as Rect, m.covered as Rect[]);
        if (isBlank(rep)) sceneFinding = { kind: 'blank-scene', severity: 'error', message: `nothing is drawn in the game scene: ${rep.flatColour} over ${(rep.flatShare * 100).toFixed(1)} % of it (${rep.colours} colour(s) in all)`, at: '[data-scene]' };
      }
    }
    if (shots) {
      const dir = join(out, slug(t.id));
      mkdirSync(dir, { recursive: true });
      const ext = png ? 'png' : 'jpg';
      const file = join(dir, `${size.id}${lang === 'en' ? '' : `-${lang}`}${dark ? '-dark' : ''}.${ext}`);
      const tall = Math.min(probe.stats.pageHeight, 5000);
      await page.screenshot({ path: file, ...(png ? {} : { type: 'jpeg' as const, quality: 78 }), ...(probe.stats.scrollable ? { fullPage: true, clip: { x: 0, y: 0, width: size.w, height: tall } } : {}) });
      shot = `${slug(t.id)}/${file.split(/[\\/]/).pop()}`;
    }
  } catch (e) {
    // Say what the page looked like when a step failed: most of the time the answer is in its text.
    const seen = await page.evaluate(() => `${location.pathname}${location.search} | ${document.body.innerText.replace(/\s+/g, ' ').slice(0, 140)}`).catch(() => '');
    messages.push(`could not check the page: ${(e as Error).message.split('\n')[0]}${seen ? ` (the page showed: ${seen})` : ''}`);
  } finally {
    await context.close();
  }
  const findings = [...(probe?.findings ?? []), ...(sceneFinding ? [sceneFinding] : [])];
  // A probe line that starts with "warn:" is a warning, any other line is an error.
  const probeWarn = probeLines.filter((l) => l.startsWith('warn:')).map((l) => l.slice(5));
  const probeErr = probeLines.filter((l) => !l.startsWith('warn:'));
  const errorCount = findings.filter((f) => f.severity === 'error').length + messages.length + probeErr.length;
  const warnCount = findings.filter((f) => f.severity === 'warn').length + warnings.length + probeWarn.length;
  return { target: t.id, size: size.id, w: size.w, h: size.h, errors: errorCount, warnings: warnCount, findings, messages: [...messages, ...warnings], probe: probeErr, probeWarn, shot, ms: Date.now() - t0, stats: probe?.stats ?? null };
}

const jobs = targets.flatMap((t) => sizes.filter((s) => !t.sizes || t.sizes.includes(s.id)).map((s) => ({ t, s })));
const results: PageResult[] = [];
let browser: Browser | null = null;
const t00 = Date.now();
try {
  // --camera <file.mjpeg|file.y4m>: the fake camera shows this video instead of Chromium's test picture (a person to calibrate on).
  browser = await chromium.launch(flag('camera') ? withFakeVideo(flag('camera') as string) : baseLaunchOptions);
  // Start the servers before the workers race for them.
  for (const k of new Set(targets.map((t) => t.server))) await serverFor(k);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(jobsN, jobs.length) }, async () => {
    for (;;) {
      const j = jobs[next++];
      if (!j) return;
      const r = await check(browser as Browser, j.t, j.s);
      results.push(r);
      const bad = r.errors > 0 || (warnAsError && r.warnings > 0);
      if (bad) {
        const lines = [...r.findings.filter((f) => f.severity === 'error' || warnAsError).map((f) => `${f.kind}: ${f.message}`), ...r.probe.map((p) => `HUD: ${p}`), ...r.messages.filter((m) => !m.startsWith('console.warn'))];
        console.log(`FAIL ${r.target} ${r.size}: ${lines.length} problem(s)\n  ${lines.slice(0, 8).join('\n  ')}${lines.length > 8 ? `\n  ... ${lines.length - 8} more` : ''}`);
      }
    }
  }));
} finally {
  await browser?.close();
  for (const s of servers.values()) await s.close();
}

results.sort((a, b) => a.target.localeCompare(b.target) || sizes.findIndex((s) => s.id === a.size) - sizes.findIndex((s) => s.id === b.size));
mkdirSync(out, { recursive: true });
const failing = results.filter((r) => r.errors > 0 || (warnAsError && r.warnings > 0));
const warnOnly = results.filter((r) => r.errors === 0 && r.warnings > 0);
writeFileSync(join(out, 'report.json'), JSON.stringify({ generated: new Date().toISOString(), lang, dark, sizes: sizes.map((s) => s.id), checked: results.length, failing: failing.length, results }, null, 1));
// The list a builder works through (FINDINGS.md next to the report): one line per page and problem, with the sizes and the element.
try { execFileSync(process.execPath, [fileURLToPath(new URL('./summarize.ts', import.meta.url)), join(out, 'report.json'), '--md', join(out, 'FINDINGS.md'), '--warnings'], { stdio: 'ignore' }); } catch { /* exit code 1 only says that errors are listed */ }
const kinds = new Map<string, number>();
for (const r of results) for (const f of r.findings) kinds.set(`${f.severity} ${f.kind}`, (kinds.get(`${f.severity} ${f.kind}`) ?? 0) + 1);
console.log(`\n${results.length} screen(s) in ${targets.length} page(s) checked in ${((Date.now() - t00) / 1000).toFixed(0)} s: ${failing.length} with problems, ${warnOnly.length} with warnings only. Report and pictures: ${out}`);
if (kinds.size) console.log([...kinds].map(([k, n]) => `${k} x${n}`).join(', '));
process.exit(failing.length ? 1 : 0);
