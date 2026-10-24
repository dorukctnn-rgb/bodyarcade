// Leak runner: plays a game round after round in the same page (Play, run for a few seconds, Back), forces a garbage
// collection after each round and compares what is still alive with the state after the second round. A round that
// leaves something behind shows up as a number that only goes up.
//
//   node tools/perf/leak.ts --game road-run [--rounds 6] [--seconds 5] [--input camera|keyboard] [--video clip.mp4] [--tolerance 10]
//   node tools/perf/leak.ts --all
//
// Counted (see instrument.ts for the browser calls that are wrapped): WebGL objects by kind (every create has a delete),
// listeners on window, document and the other long-lived targets, intervals, timeouts and animation callbacks, workers,
// audio contexts, camera tracks (all must be stopped on the game page), plus Chrome's own numbers after a collection: DOM
// nodes, event listeners, documents and the JavaScript heap (which may grow by the tolerance, 10 % by default).
// The first round is a warm-up (model download, shader compile, caches); round 2 is the baseline.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type CDPSession, type Page } from '@playwright/test';
import { withFakeVideo, baseLaunchOptions } from '../../tests/e2e/support/browser.ts';
import { loadCatalogue } from '../../packages/web/catalogue/load.ts';
import { startWeb, repoRoot } from '../page-check/servers.ts';
import { pageScript } from '../fake-camera/cam.ts';
import { convertVideo, outRoot, probeSeconds } from '../fake-camera/convert.ts';
import { startRound } from '../fake-camera/phase.ts';
import { QA_SCRIPT, type QaSnapshot } from './instrument.ts';
import { judge, type RoundState } from './judge.ts';
import { beNice } from '../page-check/nice.ts';

beNice();

export interface LeakResult {
  game: string;
  input: 'camera' | 'keyboard';
  status: 'measured' | 'skipped';
  skipped?: string;
  rounds: RoundState[];
  pass?: boolean;
  problems?: string[];
}

async function settle(cdp: CDPSession, page: Page): Promise<void> {
  for (let i = 0; i < 3; i++) { await cdp.send('HeapProfiler.collectGarbage'); await page.waitForTimeout(150); }
}

async function state(cdp: CDPSession, page: Page, round: number): Promise<RoundState> {
  await settle(cdp, page);
  const { metrics } = await cdp.send('Performance.getMetrics') as { metrics: { name: string; value: number }[] };
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
  const qa = await page.evaluate(() => (window as unknown as { __qa: { snapshot(): QaSnapshot } }).__qa.snapshot());
  const domNodes = await page.evaluate(() => document.getElementsByTagName('*').length);
  return { round, heapMB: Math.round(((m['JSHeapUsedSize'] ?? 0) / 1048576) * 100) / 100, nodes: m['Nodes'] ?? 0, listeners: m['JSEventListeners'] ?? 0, documents: m['Documents'] ?? 0, qa, domNodes };
}

async function leakGame(browser: Awaited<ReturnType<typeof chromium.launch>>, base: string, game: { id: string; slug: string }, o: { rounds: number; seconds: number; input: 'camera' | 'keyboard'; tolerance: number }): Promise<LeakResult> {
  const result: LeakResult = { game: game.id, input: o.input, status: 'measured', rounds: [] };
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, permissions: ['camera'], locale: 'en-US' });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message.split('\n')[0] ?? ''));
  await page.addInitScript(QA_SCRIPT);
  await page.addInitScript(pageScript({ seed: 1, lookFrames: 1 }));
  try {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    await page.goto(`${base}/games/${game.slug}/?plan=pro`, { waitUntil: 'networkidle' });
    for (let r = 1; r <= o.rounds; r++) {
      // Play, as a link of the page itself (the shell follows it without loading the page again; Back returns to the game page).
      await page.evaluate((href) => { const link = document.createElement('a'); link.href = href; link.textContent = 'play'; document.body.append(link); link.click(); link.remove(); }, `/play/${game.slug}/?players=1&input=${o.input}&difficulty=normal`);
      const started = await startRound(page, { timeoutMs: 60_000 });
      if (started.phase !== 'running') return { ...result, status: 'skipped', skipped: started.phase === 'failed' ? `the round did not start: ${started.text}` : `round ${r} did not reach the running state (last phase: ${started.phase})` };
      await page.waitForTimeout(o.seconds * 1000);
      await page.goBack({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('form[data-form="setup"]', { timeout: 15_000 });
      await page.waitForTimeout(400);
      result.rounds.push(await state(cdp, page, r));
    }
    const problems = judge(result.rounds, o.tolerance, o.input);
    if (errors.length) problems.push(`page error: ${errors[0]}`);
    return { ...result, pass: problems.length === 0, problems };
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
  if (!wanted.length) { console.error(`usage: node tools/perf/leak.ts --game <id[,id]>|--all [--rounds 6] [--seconds 5] [--input camera|keyboard] [--video file] [--tolerance 10]\ngames: ${catalogue.games.map((g) => g.id).join(', ')}`); process.exit(2); }
  const input = opt('input') === 'keyboard' ? 'keyboard' : 'camera';
  const rounds = Number(opt('rounds') ?? 6);
  const seconds = Number(opt('seconds') ?? 5);
  const tolerance = Number(opt('tolerance') ?? 10) / 100;
  const out = resolve(opt('out') ?? join(repoRoot(), 'qa-out', 'perf'));
  mkdirSync(out, { recursive: true });
  const video = opt('video') ?? join(repoRoot(), 'tests', 'e2e', 'fixtures', 'standing-640x360.mjpeg');
  // The camera file holds the video as often as one round needs it (Chromium starts the file again, leader included, at its end).
  const clip = (await probeSeconds(video)) || 6;
  const conv = await convertVideo({ input: video, out: join(outRoot(), 'perf-camera', 'camera.mjpeg'), repeat: Math.ceil((seconds + 45) / clip), ...(video.endsWith('.mjpeg') ? { inputFps: 15 } : {}) });
  const server = await startWeb('fill');
  const browser = await chromium.launch(input === 'camera' ? withFakeVideo(conv.file) : baseLaunchOptions);
  const results: LeakResult[] = [];
  try {
    for (const g of wanted) {
      const r = await leakGame(browser, server.url, { id: g.id, slug: g.seo.slug }, { rounds, seconds, input, tolerance });
      results.push(r);
      const last = r.rounds[r.rounds.length - 1];
      console.log(r.status === 'skipped' ? `SKIP ${g.id}: ${r.skipped}` : `${r.pass ? 'ok  ' : 'FAIL'} ${g.id}: ${r.rounds.length} rounds, heap ${r.rounds[1]?.heapMB} -> ${last?.heapMB} MB, nodes ${r.rounds[1]?.nodes} -> ${last?.nodes}, GL objects ${Object.values(r.rounds[1]?.qa.gl.live ?? {}).reduce((a, b) => a + b, 0)} -> ${Object.values(last?.qa.gl.live ?? {}).reduce((a, b) => a + b, 0)}${r.problems?.length ? `\n     ${r.problems.join('\n     ')}` : ''}`);
    }
  } finally {
    await browser.close();
    await server.close();
  }
  writeFileSync(join(out, 'leak.json'), JSON.stringify({ generated: new Date().toISOString(), rounds, seconds, tolerance, results }, null, 1));
  const failed = results.filter((r) => r.status === 'measured' && !r.pass);
  console.log(`${results.length} game(s), ${failed.length} with leaks, ${results.filter((r) => r.status === 'skipped').length} skipped. ${join(out, 'leak.json')}`);
  process.exit(failed.length ? 1 : 0);
}
