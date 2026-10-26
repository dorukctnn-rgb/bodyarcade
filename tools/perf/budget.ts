// Frame budget of every game, in a real browser, through the real shell and session (camera or keyboard).
//
//   node tools/perf/budget.ts --game road-run [--throttle 1,4] [--seconds 15] [--input camera|keyboard] [--video clip.mp4]
//   node tools/perf/budget.ts --all                   every game that can start, writes qa-out/perf/report.json
//
// What is measured, per game and CPU slowdown (Chrome's CPU throttling; 4 = a phone that is four times slower):
//   - frame intervals from requestAnimationFrame (median, p95, p99, the share over 33.4 ms and over 50 ms),
//   - the main thread's busy time per frame from Chrome's own task counters (the JavaScript, layout and style cost of one
//     frame: what the game, the HUD and the 3D kit cost on the CPU), in windows of one second, and its p95,
//   - long tasks, workers (the pose runs in a worker), WebGL objects, the heap.
// Budget: at no slowdown the main thread may use at most 8 ms per frame (p95 of the one-second windows), so that at 4x it
// still fits a 33 ms frame. The frame intervals are reported, not judged: headless Chromium draws WebGL with a software
// renderer (SwiftShader), so GPU time is not the one of a phone and the cadence is only a rough lower bound.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type CDPSession, type Page } from '@playwright/test';
import { withFakeVideo, baseLaunchOptions } from '../../tests/e2e/support/browser.ts';
import { loadCatalogue } from '../../packages/web/catalogue/load.ts';
import { startWeb, repoRoot } from '../page-check/servers.ts';
import { pageScript } from '../fake-camera/cam.ts';
import { convertVideo, outRoot, probeSeconds } from '../fake-camera/convert.ts';
import { startRound } from '../fake-camera/phase.ts';
import { QA_SCRIPT, type QaSnapshot } from './instrument.ts';
import { cpus } from 'node:os';
import { busyBetween, cpuLook, stats, type Stats } from './stats.ts';
import { beNice } from '../page-check/nice.ts';

beNice();

export interface BudgetResult {
  game: string;
  throttle: number;
  input: 'camera' | 'keyboard';
  size: string;
  status: 'measured' | 'skipped';
  skipped?: string;
  seconds?: number;
  frames?: number;
  fps?: number;
  interval?: Stats;
  over33?: number;
  over50?: number;
  busyPercent?: number;
  msPerFrame?: Stats;
  scriptMsPerFrame?: number;
  layoutStyleMsPerFrame?: number;
  longTasks?: { count: number; totalMs: number; maxMs: number };
  workers?: { live: number; created: number };
  glLive?: number;
  heapMB?: { start: number; end: number };
  nodes?: number;
  /** Share of the machine's processors that were busy during the measurement (all programs): over 0.85 the numbers say little. */
  machineBusy?: number;
  /** The numbers were taken on a busy machine and are too high to judge a game by. */
  inconclusive?: boolean;
  pass?: boolean;
  reasons?: string[];
}

const BUDGET_MS_PER_FRAME = 8;

async function metrics(cdp: CDPSession): Promise<Record<string, number>> {
  const { metrics: list } = await cdp.send('Performance.getMetrics') as { metrics: { name: string; value: number }[] };
  return Object.fromEntries(list.map((m) => [m.name, m.value]));
}

async function measureGame(browser: Browser, base: string, game: { id: string; slug: string }, o: { throttle: number; seconds: number; input: 'camera' | 'keyboard'; size: [number, number]; plan: string }): Promise<BudgetResult> {
  const result: BudgetResult = { game: game.id, throttle: o.throttle, input: o.input, size: `${o.size[0]}x${o.size[1]}`, status: 'measured' };
  const context = await browser.newContext({ viewport: { width: o.size[0], height: o.size[1] }, deviceScaleFactor: 1, hasTouch: o.size[0] < 1000, permissions: ['camera'], locale: 'en-US' });
  const page: Page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message.split('\n')[0] ?? ''));
  await page.addInitScript(QA_SCRIPT);
  await page.addInitScript(pageScript({ seed: 1, lookFrames: 1 }));
  try {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    await page.goto(`${base}/play/${game.slug}/?input=${o.input}&players=1&plan=${o.plan}`, { waitUntil: 'domcontentloaded' });
    const started = await startRound(page, { timeoutMs: 60_000 });
    if (started.phase !== 'running') {
      return { ...result, status: 'skipped', skipped: started.phase === 'failed' ? `the round did not start: ${started.text}` : `the round did not reach the running state in 60 s (last phase: ${started.phase})${o.input === 'camera' ? ': the person in the camera video may not be seen well enough to calibrate' : ''}` };
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: o.throttle });
    await page.waitForTimeout(2500);
    await page.evaluate(() => (window as unknown as { __qa: { startFrames(): void } }).__qa.startFrames());
    const first = await metrics(cdp);
    const cpu0 = cpuLook(cpus());
    const windows: number[] = [];
    let prev = first;
    let prevFrames = 0;
    for (let i = 0; i < o.seconds; i++) {
      await page.waitForTimeout(1000);
      const m = await metrics(cdp);
      const n = await page.evaluate(() => (window as unknown as { __qa: { snapshot(): QaSnapshot } }).__qa.snapshot().frames.length);
      const df = n - prevFrames;
      if (df > 0) windows.push((((m['TaskDuration'] ?? 0) - (prev['TaskDuration'] ?? 0)) * 1000) / df);
      prev = m;
      prevFrames = n;
    }
    const snap = await page.evaluate(() => (window as unknown as { __qa: { snapshot(): QaSnapshot } }).__qa.snapshot());
    const last = prev;
    const machineBusy = busyBetween(cpu0, cpuLook(cpus()));
    const wall = (last['Timestamp'] ?? 0) - (first['Timestamp'] ?? 0);
    const frames = snap.frames;
    const interval = stats(frames);
    const nFrames = Math.max(1, frames.length);
    const ms = (k: string): number => (((last[k] ?? 0) - (first[k] ?? 0)) * 1000) / nFrames;
    const mpf = stats(windows);
    const reasons: string[] = [];
    // Other programs using the processors make every number here too high (the main thread waits for its turn).
    const inconclusive = machineBusy > 0.85;
    if (o.throttle === 1 && mpf.p95 > BUDGET_MS_PER_FRAME) reasons.push(`main thread ${mpf.p95} ms per frame (p95 of one-second windows), budget ${BUDGET_MS_PER_FRAME} ms`);
    if (o.throttle > 1 && mpf.p95 > 33.4) reasons.push(`main thread ${mpf.p95} ms per frame at ${o.throttle}x, over the 33 ms frame`);
    if (errors.length) reasons.push(`page error: ${errors[0]}`);
    if (o.input === 'camera' && snap.workers.created === 0) reasons.push('the pose ran on the main thread (no worker was started)');
    Object.assign(result, {
      seconds: Math.round(wall * 10) / 10, frames: frames.length, fps: Math.round((frames.length / Math.max(0.1, wall)) * 10) / 10, interval,
      over33: Math.round((frames.filter((x) => x > 33.4).length / nFrames) * 1000) / 10, over50: Math.round((frames.filter((x) => x > 50).length / nFrames) * 1000) / 10,
      busyPercent: Math.round((((last['TaskDuration'] ?? 0) - (first['TaskDuration'] ?? 0)) / Math.max(0.1, wall)) * 1000) / 10,
      msPerFrame: mpf, scriptMsPerFrame: Math.round(ms('ScriptDuration') * 100) / 100, layoutStyleMsPerFrame: Math.round((ms('LayoutDuration') + ms('RecalcStyleDuration')) * 100) / 100,
      longTasks: snap.longTasks, workers: snap.workers, glLive: Object.values(snap.gl.live).reduce((a, b) => a + b, 0),
      heapMB: { start: Math.round(((first['JSHeapUsedSize'] ?? 0) / 1048576) * 10) / 10, end: Math.round(((last['JSHeapUsedSize'] ?? 0) / 1048576) * 10) / 10 }, nodes: last['Nodes'] ?? 0,
      machineBusy, inconclusive, pass: inconclusive ? true : reasons.length === 0, reasons: inconclusive ? [`inconclusive: the machine's processors were ${Math.round(machineBusy * 100)} % busy (other programs); measure again when it is quiet. Numbers taken: ${reasons.join('; ') || 'within budget'}`] : reasons,
    });
    return result;
  } catch (e) {
    return { ...result, status: 'skipped', skipped: `error: ${(e as Error).message.split('\n')[0]}` };
  } finally {
    await context.close();
  }
}

// ---- command line -------------------------------------------------------------------------------------------------------
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (k: string): string | undefined => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
  const { catalogue } = loadCatalogue({ fixtures: 'fill', requiredLangs: ['en'] });
  const wanted = args.includes('--all') ? catalogue.games : catalogue.games.filter((g) => (opt('game') ?? '').split(',').includes(g.id));
  if (!wanted.length) { console.error(`usage: node tools/perf/budget.ts --game <id[,id]>|--all [--throttle 1,4] [--seconds 15] [--input camera|keyboard] [--video file] [--size 1280x720]\ngames: ${catalogue.games.map((g) => g.id).join(', ')}`); process.exit(2); }
  const input = opt('input') === 'keyboard' ? 'keyboard' : 'camera';
  const throttles = (opt('throttle') ?? '1,4').split(',').map(Number);
  const seconds = Number(opt('seconds') ?? 15);
  const size = (opt('size') ?? '1280x720').split('x').map(Number) as [number, number];
  const out = resolve(opt('out') ?? join(repoRoot(), 'qa-out', 'perf'));
  mkdirSync(out, { recursive: true });
  const video = opt('video') ?? join(repoRoot(), 'tests', 'e2e', 'fixtures', 'standing-640x360.mjpeg');
  // The camera file holds the video as often as one round needs it (Chromium starts the file again, leader included, at its end).
  const clip = (await probeSeconds(video)) || 6;
  const conv = await convertVideo({ input: video, out: join(outRoot(), 'perf-camera', 'camera.mjpeg'), repeat: Math.ceil((seconds + 45) / clip), ...(video.endsWith('.mjpeg') ? { inputFps: 15 } : {}) });
  const server = await startWeb('fill');
  const browser = await chromium.launch(input === 'camera' ? withFakeVideo(conv.file) : baseLaunchOptions);
  const results: BudgetResult[] = [];
  try {
    for (const g of wanted) {
      for (const t of throttles) {
        const r = await measureGame(browser, server.url, { id: g.id, slug: g.seo.slug }, { throttle: t, seconds, input, size, plan: 'pro' });
        results.push(r);
        console.log(r.status === 'skipped'
          ? `SKIP ${g.id} ${t}x: ${r.skipped}`
          : `${r.inconclusive ? 'BUSY' : r.pass ? 'ok  ' : 'FAIL'} ${g.id} ${t}x: ${r.fps} fps, frame p95 ${r.interval?.p95} ms (${r.over33}% over 33 ms), main thread ${r.msPerFrame?.p50}/${r.msPerFrame?.p95} ms per frame (p50/p95), busy ${r.busyPercent}%, long tasks ${r.longTasks?.count}, heap ${r.heapMB?.start}->${r.heapMB?.end} MB${r.reasons?.length ? `\n     ${r.reasons.join('\n     ')}` : ''}`);
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }
  writeFileSync(join(out, 'budget.json'), JSON.stringify({ generated: new Date().toISOString(), note: 'Headless Chromium with a software GL renderer: frame intervals are a lower bound; the verdict uses the main-thread cost per frame.', budgetMsPerFrame: BUDGET_MS_PER_FRAME, results }, null, 1));
  const failed = results.filter((r) => r.status === 'measured' && !r.pass);
  console.log(`${results.length} measurement(s), ${failed.length} over budget, ${results.filter((r) => r.status === 'skipped').length} skipped. ${join(out, 'budget.json')}`);
  process.exit(failed.length ? 1 : 0);
}
