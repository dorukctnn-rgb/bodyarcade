// page-check: opens pages at the ten screen sizes of the layout rule (BUILD-PLAN "Screen layout rule"), saves a picture of
// each and fails on layout bugs (see probe.ts) and on console errors, uncaught errors and failed requests.
// Headless only; starts the servers it needs on free ports and stops them at the end.
//
//   npm run qa:pages                                  every built-in target (web shell + live site) at the ten sizes
//   npm run qa:pages -- --only web:home,web:play      some targets (a prefix works: --only web:game)
//   npm run qa:pages -- --sizes 360x780,1280x800      some sizes (or breakpoint ids: phone-390)
//   npm run qa:pages -- --url http://127.0.0.1:5173/x.html [--click "#start"] [--wait-for ".ready"] [--hook '{"timeScale":5}']
//   npm run qa:pages -- --list                        what would be checked
//   options: --lang tr --dark --plan pro --out qa-out/page-check --png --no-shots --warn-as-error --jobs 1 --camera tests/e2e/fixtures/standing-640x360.mjpeg --base qa-out/older/report.json
//            --known web:home:trial,web:friends  (pages with an open, filed bug: their errors are listed and shown as KNOWN but do not fail the run)
//            --browser chromium|webkit|firefox (default chromium; the other two run the same checks in WebKit, the engine under Safari and every browser on an iPhone, and in Firefox;
//            a camera for them is the page-side person camera of tools/browsers/support/camera.ts)
//            --groups web,site   --fixtures fill|only|none   --allow-external   --ignore ".selector,.other"
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { baseLaunchOptions, withFakeVideo } from '../../tests/e2e/support/browser.ts';
import { convertVideo, probeSeconds } from '../fake-camera/convert.ts';
import { BREAKPOINTS } from '../../packages/core/ui/layout.ts';
import { startDev, startStatic, startWeb, repoRoot, type Served } from './servers.ts';
import { builtinTargets, type Step, type Target } from './targets.ts';
import { layoutProbe, type Finding, type ProbeResult } from './probe.ts';
import { mergeReports, type Report } from './summarize.ts';
import { analyseScene, decodePng, isBlank, type Rect } from './scene.ts';
import { beNice } from './nice.ts';
import { settle } from './settle.ts';
import { afterCrash, crashed } from './crash.ts';
import { installPersonCamera } from '../browsers/support/camera.ts';
import { firefoxPrefs } from '../browsers/support/firefox.ts';

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

const engine = (flag('browser') ?? 'chromium') as 'chromium' | 'webkit' | 'firefox';
if (!['chromium', 'webkit', 'firefox'].includes(engine)) throw new Error(`--browser ${engine}: use chromium, webkit or firefox`);
const lang = flag('lang') ?? 'en';
const plan = flag('plan') ?? 'free';
const dark = has('dark');
const out = resolve(flag('out') ?? join(repoRoot(), 'qa-out', 'page-check'));
// One page at a time by default (the machine is shared); --jobs 3 on a quiet one.
const jobsN = Math.max(1, Number(flag('jobs') ?? 1));
const shots = !has('no-shots');
const png = has('png');
const warnAsError = has('warn-as-error');
/** Pages (or the start of a page's name) whose errors are known and filed: they are reported, and they do not fail the run. */
const known = list('known');
const isKnown = (id: string): boolean => known.some((k) => id === k || id.startsWith(`${k}:`));
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
if (!flag('camera')) targets = targets.filter((t) => !t.needsCamera);
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

async function runStep(page: Page, s: Step): Promise<void> {
  if ('click' in s) await page.locator(s.click).first().click({ timeout: 8000 });
  else if ('waitFor' in s) await page.waitForSelector(s.waitFor, { timeout: s.timeout ?? 20000 });
  else if ('waitGone' in s) await page.waitForFunction((sel) => !document.querySelector(sel), s.waitGone, { timeout: s.timeout ?? 20000 });
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
  // WebKit has phones (isMobile, an iPhone's user agent); Firefox only a touch screen of that size; Chromium is checked as a desktop browser at every size.
  const phone = engine === 'webkit' && size.w < 700;
  const context: BrowserContext = await browser.newContext({
    viewport: { width: size.w, height: size.h }, deviceScaleFactor: 1, hasTouch: touch, isMobile: phone,
    ...(phone ? { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1' } : {}),
    colorScheme: dark ? 'dark' : 'light', locale: lang === 'en' ? 'en-US' : `${lang}-${lang.toUpperCase()}`, reducedMotion: 'no-preference',
  });
  // Chromium has a fake camera that plays a file (set at launch); the other engines get the same pictures from the page. Firefox has a test picture of
  // its own without a file; WebKit's headless run only says "not allowed" (the pages with a camera screen all showed "The camera is blocked"), so it gets
  // the page-side camera too: with the file when there is one, an empty room (Chromium's test pattern shows nobody either) when there is not.
  if (engine !== 'chromium' && (personCamera || engine === 'webkit')) await installPersonCamera(context, { ...(personCamera ? { file: personCamera } : {}), portrait: size.w < size.h && size.w < 700 });
  const page = await context.newPage();
  const messages: string[] = [];
  const warnings: string[] = [];
  const blocked = new Set<string>();
  // Messages of the software GL driver of the headless browser are not the page's.
  const allowed = ['GPU stall due to ReadPixels', 'Autofocus processing was blocked', 'OpenGL error checking is disabled', 'inference_feedback_manager', 'XNNPACK', 'Created TensorFlow Lite', ...(t.allowMessages ?? []), ...list('allow')];
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
  // Firefox and WebKit ask for the page's declared icon like any file (Chromium's headless shell does not); the page-check server has no copy of it where the release build has the hashed one
  const isIcon = (u: string): boolean => /\/favicon\.(svg|ico)$/.test(u);
  page.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith(origin) && !isAllowed(r.url()) && !isIcon(r.url())) messages.push(`HTTP ${r.status()}: ${r.url().slice(origin.length)}`); });
  page.on('requestfailed', (r) => { if (r.url().startsWith(origin) && !isAllowed(r.url()) && !/ERR_ABORTED|NS_BINDING_ABORTED|cancelled/i.test(r.failure()?.errorText ?? '')) messages.push(`request failed: ${r.url().slice(origin.length)} (${r.failure()?.errorText})`); });

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
        const look = async (): Promise<ReturnType<typeof analyseScene>> => analyseScene(decodePng(await page.screenshot({ type: 'png' })), m.scene as Rect, m.covered as Rect[]);
        let rep = await look();
        // A scene that is blank in one picture gets a second look: on a loaded machine a single frame can be caught between a
        // clear and the next draw (26 Oct, star-catch phone-land-915: blank once, the saved picture a moment later drawn, 8 of 8 clean alone).
        // A scene that draws nothing stays blank in both.
        if (isBlank(rep)) { await page.waitForTimeout(600); rep = await look(); }
        if (isBlank(rep)) sceneFinding = { kind: 'blank-scene', severity: 'error', message: `nothing is drawn in the game scene: ${rep.flatColour} over ${(rep.flatShare * 100).toFixed(1)} % of it (${rep.colours} colour(s) in all), in two pictures 0.6 s apart`, at: '[data-scene]' };
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
  // No WebGL in this engine here: a console error that says so, and a round that cannot start (the pose model and the 3D scene both need a GL context), are the engine's, not the page's.
  const noGl = (m: string): boolean => /WebGL context could not be created|Error creating WebGL context|WebGL creation failed/i.test(m);
  if (!engineWebgl) {
    for (let i = messages.length - 1; i >= 0; i--) if (noGl(messages[i] as string)) warnings.push(`console.warn: no WebGL in this engine here: ${(messages.splice(i, 1)[0] as string).replace(/^console.error: /, '')}`);
    for (let i = probeLines.length - 1; i >= 0; i--) if (/^the round did not start/.test(probeLines[i] as string)) probeLines[i] = `warn:no WebGL in this engine here, ${probeLines[i]}`;
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
let personCamera: string | null = null;
/** False when the engine cannot make a WebGL context on this machine (GitHub's Linux runner gives Firefox none): its 3D scenes and the pose model cannot start, which says nothing about the page. */
let engineWebgl = true;
const t00 = Date.now();
try {
  // --camera <video>: the fake camera shows this video instead of Chromium's test picture (a person to calibrate on). A raw .mjpeg
  // is read at --camera-input-fps (default 15). The pages that need a person (web:cam:*) are only checked with it.
  let cameraFile: string | null = null;
  if (flag('camera')) {
    const src = resolve(flag('camera') as string);
    const clip = (await probeSeconds(src)) || 6;
    // Chromium plays the file from its start with a sync leader in front; the page-side camera of the other engines loops the pictures, leader or not.
    const conv = await convertVideo({ input: src, out: join(out, 'camera', engine === 'chromium' ? 'camera.mjpeg' : `camera-${engine}.mjpeg`), repeat: Math.ceil(150 / clip), ...(engine === 'chromium' ? {} : { leader: false }), ...(src.endsWith('.mjpeg') ? { inputFps: Number(flag('camera-input-fps') ?? 15) } : {}) });
    cameraFile = conv.file;
    personCamera = engine === 'chromium' ? null : conv.file;
  }
  const launch = (): Promise<Browser> => engine === 'webkit' ? webkit.launch({ headless: true })
    : engine === 'firefox' ? firefox.launch({ headless: true, firefoxUserPrefs: firefoxPrefs() })
      : chromium.launch(cameraFile ? withFakeVideo(cameraFile) : baseLaunchOptions);
  browser = await launch();
  if (engine !== 'chromium') {
    const probeContext = await browser.newContext();
    engineWebgl = await (await probeContext.newPage()).evaluate(() => { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); }).catch(() => true);
    await probeContext.close();
    if (!engineWebgl) console.log(`${engine} has no WebGL on this machine: what only that breaks (the console says so, a round that cannot start) is listed as a warning`);
  }
  // Start the servers before the workers race for them.
  for (const k of new Set(targets.map((t) => t.server))) await serverFor(k);
  // A screen that never answers (a browser that crashed and does not say so: WebKit for Windows on the home page hung a run for twenty minutes) is a finding of its own, and the browser
  // is started again for the screens after it.
  const SCREEN_LIMIT_MS = 180_000;
  let restarting: Promise<void> | null = null;
  // One worker starts the browser again; the others wait for it (a screen that was open in the old browser is lost with it and is reported like any other that gave no answer).
  const restartBrowser = (old: Browser | null): Promise<void> => {
    if (!restarting) restarting = (async () => { await old?.close().catch(() => undefined); browser = await launch(); })().finally(() => { restarting = null; });
    return restarting;
  };
  const checkWithin = async (target: Target, size: { id: string; w: number; h: number }): Promise<PageResult> => {
    if (restarting) await restarting;
    const used = browser as Browser;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const answer = await Promise.race([
        check(used, target, size),
        new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error(`no answer in ${SCREEN_LIMIT_MS / 1000} s`)), SCREEN_LIMIT_MS); }),
      ]);
      // the screen answered that its browser is gone (a crash under it): the screens after it get a new one
      if (answer.messages.some((m) => /has been closed|browser has disconnected|Target crashed|Browser closed/i.test(m)) && browser === used) await restartBrowser(used);
      return answer;
    } catch (e) {
      const message = ((e as Error).message.split(/\r?\n/)[0] ?? '').trim();
      // a browser that is gone (crashed, closed under the screen) or that gave no answer is started again for the screens after it
      if (/no answer|has been closed|browser has disconnected|Target crashed|Browser closed/i.test(message) && browser === used) await restartBrowser(used);
      return { target: target.id, size: size.id, w: size.w, h: size.h, errors: 1, warnings: 0, findings: [], messages: [`could not check the page: ${message}`], probe: [], probeWarn: [], shot: null, ms: SCREEN_LIMIT_MS, stats: null } as unknown as PageResult;
    } finally { clearTimeout(timer); }
  };
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(jobsN, jobs.length) }, async () => {
    for (;;) {
      const j = jobs[next++];
      if (!j) return;
      let r = await checkWithin(j.t, j.s);
      // The engine's page process died under the screen (WebKit on a macOS runner did it once in 874 screens): looked at once more in a new context (crash.ts).
      if (crashed(r)) { console.log(`CRASH ${r.target} ${r.size}: the page crashed, looking at it once more`); r = afterCrash(r, await checkWithin(j.t, j.s)); }
      // A dev server that resets one connection on a loaded machine is not a finding: a screen whose only problem is that is looked at once more.
      if (r.errors > 0 && r.findings.length === 0 && r.probe.length === 0 && r.messages.filter((m) => !m.startsWith('console.warn')).every((m) => /ERR_CONNECTION_(RESET|REFUSED|CLOSED)|ECONNRESET/.test(m))) r = await check(browser as Browser, j.t, j.s);
      results.push(r);
      const bad = r.errors > 0 || (warnAsError && r.warnings > 0);
      if (bad) {
        const lines = [...r.findings.filter((f) => f.severity === 'error' || warnAsError).map((f) => `${f.kind}: ${f.message}`), ...r.probe.map((p) => `HUD: ${p}`), ...r.messages.filter((m) => !m.startsWith('console.warn'))];
        console.log(`${isKnown(r.target) ? 'KNOWN' : 'FAIL'} ${r.target} ${r.size}: ${lines.length} problem(s)\n  ${lines.slice(0, 8).join('\n  ')}${lines.length > 8 ? `\n  ... ${lines.length - 8} more` : ''}`);
      }
    }
  }));
} finally {
  await browser?.close();
  for (const s of servers.values()) await s.close();
}

mkdirSync(out, { recursive: true });
// --base <older report.json>: a run of a few pages or sizes adds to the report of an earlier run instead of replacing it (see mergeReports).
let carried = 0;
let reportSizes = sizes.map((s) => s.id);
if (flag('base')) {
  const baseFile = resolve(flag('base') as string);
  const merged = mergeReports({ generated: '', lang, dark, sizes: reportSizes, checked: results.length, failing: 0, results }, JSON.parse(readFileSync(baseFile, 'utf8')) as Report, { fresh: out, old: dirname(baseFile) });
  carried = (merged as Report & { carried: number }).carried;
  results.splice(0, results.length, ...merged.results);
  reportSizes = merged.sizes;
} else {
  results.sort((a, b) => a.target.localeCompare(b.target) || reportSizes.indexOf(a.size) - reportSizes.indexOf(b.size));
}
const failingAll = results.filter((r) => r.errors > 0 || (warnAsError && r.warnings > 0));
const failing = failingAll.filter((r) => !isKnown(r.target));
const knownBad = failingAll.filter((r) => isKnown(r.target));
const warnOnly = results.filter((r) => r.errors === 0 && r.warnings > 0);
writeFileSync(join(out, 'report.json'), JSON.stringify({ generated: new Date().toISOString(), browser: engine, lang, dark, sizes: reportSizes, carried, checked: results.length, failing: failing.length, results }, null, 1));
// The list a builder works through (FINDINGS.md next to the report): one line per page and problem, with the sizes and the element.
try { execFileSync(process.execPath, [fileURLToPath(new URL('./summarize.ts', import.meta.url)), join(out, 'report.json'), '--md', join(out, 'FINDINGS.md'), '--warnings'], { stdio: 'ignore' }); } catch { /* exit code 1 only says that errors are listed */ }
const kinds = new Map<string, number>();
for (const r of results) for (const f of r.findings) kinds.set(`${f.severity} ${f.kind}`, (kinds.get(`${f.severity} ${f.kind}`) ?? 0) + 1);
console.log(`\n${results.length} screen(s) in ${targets.length} page(s) checked in ${((Date.now() - t00) / 1000).toFixed(0)} s: ${failing.length} with problems, ${warnOnly.length} with warnings only${knownBad.length ? `, ${knownBad.length} with KNOWN problems (filed, not failing: ${[...new Set(knownBad.map((r) => r.target))].join(', ')})` : ''}. Report and pictures: ${out}`);
if (kinds.size) console.log([...kinds].map(([k, n]) => `${k} x${n}`).join(', '));
process.exit(failing.length ? 1 : 0);
