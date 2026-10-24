// Plays a real round of a real game with a video as the camera and records the screen cleanly.
//
//   node tools/fake-camera/run.ts --video clip.mp4 --game road-run [--mode solo|local2] [--seed 1] [--out dir]
//
// What happens: the video is converted to a fake-camera file (convert.ts, with a sync leader), headless Chromium is
// started with that file as its camera, the game page is opened (/play/<game>/?input=camera...), the camera explainer
// is clicked through, the game calibrates on the person in the video and plays until the results screen (or the time
// asked for). The screen is recorded frame by frame (Chrome DevTools screencast, with the browser's own time stamps) into
// capture.mp4 at a constant rate, with nothing but the page in the picture. timeline.json says when each thing happened
// in capture time, including the moment the video started, so the video and the capture can be put side by side.
// Everything is headless: no window opens. See README.md for the options, the files and what is and is not exact.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { withFakeVideo } from '../../tests/e2e/support/browser.ts';
import { loadCatalogue } from '../../packages/web/catalogue/load.ts';
import { startWeb } from '../page-check/servers.ts';
import { ffmpegCommand, findStart, pageScript, type PageCam, type SyncInfo } from './cam.ts';
import { phaseOf, readState } from './phase.ts';
import { convertVideo, outRoot, probeSeconds } from './convert.ts';
import { beNice } from '../page-check/nice.ts';

beNice();

// ---- arguments ----------------------------------------------------------------------------------------------------------
const argv = process.argv.slice(2);
const VALUE_FLAGS = new Set(['video', 'game', 'mode', 'seed', 'out', 'size', 'fps', 'until', 'max', 'lang', 'plan', 'difficulty', 'url', 'hide', 'css', 'from', 'to', 'camera-size', 'camera-fps', 'repeat', 'crf', 'calib-timeout', 'name', 'input-fps']);
const flags = new Map<string, string>();
for (let i = 0; i < argv.length; i++) {
  const a = argv[i] as string;
  if (!a.startsWith('--')) { if (!flags.has('video')) flags.set('video', a); continue; }
  const k = a.slice(2);
  if (VALUE_FLAGS.has(k)) { flags.set(k, argv[i + 1] ?? ''); i++; } else flags.set(k, 'true');
}
const flag = (k: string): string | undefined => flags.get(k);
const has = (k: string): boolean => flags.has(k) && flag(k) !== 'false';

if (has('help') || !flag('video')) {
  console.log(`usage: node tools/fake-camera/run.ts --video <file> --game <id> [options]
  --game <id>          catalogue id (road-run, squat-flap, ...)
  --mode solo|local2   one player, or two on one camera (needs a big screen size)
  --seed <n|random>    seed of the round (default 1: the same obstacles every run)
  --seated --quiet     the seated / quiet version
  --difficulty <d>     easy, normal, hard, ...  --plan pro (unlocks the Pro games and levels)
  --size 1280x720      the capture size (default 1280x720; 390x844 for a phone portrait cut)
  --fps 30             capture rate
  --until results|video-end|<seconds>   when to stop (default results; seconds count from the start of the round)
  --max 240            hard limit in seconds for the whole run
  --hide ".ba-pip-host,[data-hud=timer]"   CSS selectors to hide for a cleaner picture   --css "<css>"
  --camera-size 640x360 --camera-fps 30 --from <s> --to <s> --cover --mirror --input-fps <n>    how the video becomes the camera (convert.ts)
  --repeat <n>         times the video is put in the camera file (default: as often as the round needs; a game runs longer than a short clip)
  --out <dir>          default tools/fake-camera/out/<video name>-<game>-<mode>
  --url <address>      use another server (default: the web shell on a free local port)
  --lang en|tr  --crf 18  --calib-timeout 30  --no-capture  --allow-errors`);
  process.exit(has('help') ? 0 : 2);
}

const gameId = flag('game') ?? '';
const mode = flag('mode') === 'local2' ? 'local2' : 'solo';
const seed = flag('seed') === 'random' ? null : Number(flag('seed') ?? 1) >>> 0;
const [vw, vh] = (flag('size') ?? '1280x720').split('x').map(Number) as [number, number];
const fps = Number(flag('fps') ?? 30);
const until = flag('until') ?? 'results';
const maxSeconds = Number(flag('max') ?? 240);
const lang = flag('lang') ?? 'en';
const calibTimeout = Number(flag('calib-timeout') ?? 30);

function die(code: number, message: string): never {
  console.error(message);
  process.exit(code);
}

// ---- the game ------------------------------------------------------------------------------------------------------------
const { catalogue } = loadCatalogue({ fixtures: 'fill', requiredLangs: ['en'] });
const game = catalogue.games.find((g) => g.id === gameId || g.seo.slug === gameId);
if (!game) die(2, `unknown game "${gameId}". Games: ${catalogue.games.map((g) => g.id).join(', ')}`);
if (mode === 'local2' && !game.modes.includes('local2')) die(2, `${game.id} has no two-player mode (modes: ${game.modes.join(', ')})`);

// ---- the camera ----------------------------------------------------------------------------------------------------------
const videoArg = flag('video') as string;
const runName = flag('name') ?? `${basename(videoArg, extname(videoArg)).replace(/[^a-z0-9._-]+/gi, '-')}-${game.id}-${mode}`;
const out = resolve(flag('out') ?? join(outRoot(), runName));
mkdirSync(out, { recursive: true });
const cameraFile = join(out, 'camera.mjpeg');
const [cw, ch] = (flag('camera-size') ?? '640x360').split('x').map(Number) as [number, number];
// Chromium plays the camera file again from its start (with the sync leader) when it ends, so the file holds the content as
// often as the run needs it, unless the run stops with the video.
const clipSeconds = Math.max(0.5, ((flag('to') ? Number(flag('to')) : (await probeSeconds(videoArg)) || 10) - Number(flag('from') ?? 0)));
const needSeconds = until === 'video-end' ? 0 : Math.min(maxSeconds, (/^d+(.d+)?$/.test(until) ? Number(until) : game.durationSec * 1.3) + calibTimeout + 10);
const repeat = flag('repeat') ? Number(flag('repeat')) : until === 'video-end' ? 1 : Math.min(300, Math.max(1, Math.ceil(needSeconds / clipSeconds)));
const conv = await convertVideo({
  input: videoArg, out: cameraFile, width: cw, height: ch, fps: Number(flag('camera-fps') ?? 30), repeat, fit: has('cover') ? 'cover' : 'contain', mirror: has('mirror'),
  ...(flag('from') ? { from: Number(flag('from')) } : {}), ...(flag('to') ? { to: Number(flag('to')) } : {}), ...(flag('input-fps') ? { inputFps: Number(flag('input-fps')) } : {}),
});
const sync: SyncInfo = conv.sync;

// ---- the screen recorder ---------------------------------------------------------------------------------------------------
/** Pictures come in at the browser's pace with its own time stamps; the file gets one picture per 1/fps, the latest one. */
class Recorder {
  private proc: ChildProcess | null = null;
  private last: Buffer | null = null;
  private next = 0;
  private chain: Promise<void> = Promise.resolve();
  t0: number | null = null;
  pictures = 0;
  frames = 0;
  done: Promise<number> = Promise.resolve(0);
  private readonly rate: number;
  private readonly file: string;
  private readonly crf: number;
  constructor(rate: number, file: string, crf: number) {
    this.rate = rate;
    this.file = file;
    this.crf = crf;
  }

  private open(): void {
    const args = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(this.rate), '-c:v', 'mjpeg', '-i', '-',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-threads', '2', '-preset', 'veryfast', '-crf', String(this.crf), '-pix_fmt', 'yuv420p', '-r', String(this.rate), '-movflags', '+faststart', this.file];
    this.proc = spawn(ffmpegCommand(), args, { stdio: ['pipe', 'ignore', 'inherit'] });
    this.done = new Promise((ok) => { this.proc?.on('close', (c) => ok(c ?? 1)); });
    this.proc.stdin?.on('error', () => undefined);
  }

  private write(b: Buffer): Promise<void> {
    this.frames++;
    const stdin = this.proc?.stdin;
    if (!stdin || stdin.destroyed) return Promise.resolve();
    return stdin.write(b) ? Promise.resolve() : new Promise((ok) => { stdin.once('drain', ok); });
  }

  /** A picture the browser made at epoch time tsMs. */
  push(b: Buffer, tsMs: number): void {
    this.pictures++;
    this.chain = this.chain.then(async () => {
      if (!this.proc) this.open();
      if (this.last === null || this.t0 === null) { this.t0 = tsMs; this.last = b; return; }
      while (this.t0 + (this.next * 1000) / this.rate < tsMs) { await this.write(this.last); this.next++; }
      this.last = b;
    });
  }

  /** Ends the file at epoch time endMs. Returns ffmpeg's exit code. */
  async finish(endMs: number): Promise<number> {
    await this.chain;
    if (this.last !== null && this.t0 !== null) {
      while (this.t0 + (this.next * 1000) / this.rate <= endMs) { await this.write(this.last); this.next++; }
    }
    this.proc?.stdin?.end();
    return this.proc ? this.done : 0;
  }
}

// ---- running -------------------------------------------------------------------------------------------------------------
const server = flag('url') ? null : await startWeb('fill');
const base = flag('url') ?? (server as { url: string }).url;
const prefix = lang === 'en' ? '' : `/${lang}`;
const query = new URLSearchParams({ input: 'camera', players: mode === 'local2' ? '2' : '1' });
if (has('seated')) query.set('seated', '1');
if (has('quiet')) query.set('quiet', '1');
if (flag('difficulty')) query.set('difficulty', flag('difficulty') as string);
if (flag('plan')) query.set('plan', flag('plan') as string);
const address = `${base}${prefix}/play/${game.seo.slug}/?${query}`;

const browser = await chromium.launch(withFakeVideo(cameraFile));
const t0Wall = Date.now();
const phases: { phase: string; epoch: number }[] = [];
const problems: string[] = [];
const messages: string[] = [];
const rec = new Recorder(fps, join(out, 'capture.mp4'), Number(flag('crf') ?? 18));
let exitCode = 0;
let finalEpoch = Date.now();
let result: unknown = null;
let camera: PageCam | null = null;
let page: Page | null = null;

try {
  const context = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1, hasTouch: vw < 1000, permissions: ['camera'], locale: lang === 'en' ? 'en-US' : `${lang}-${lang.toUpperCase()}`, reducedMotion: 'no-preference' });
  page = await context.newPage();
  await page.addInitScript(pageScript({ seed, lookFrames: 150 }));
  const hide = flag('hide');
  const css = `${hide ? `${hide} { display: none !important; }` : ''}${flag('css') ? ` ${flag('css')}` : ''}`;
  if (css.trim()) await page.addInitScript((c) => { const add = (): void => { const s = document.createElement('style'); s.textContent = c; document.documentElement.appendChild(s); }; if (document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add); }, css);
  page.on('pageerror', (e) => problems.push(`uncaught: ${e.message.split('\n')[0]}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console.error: ${m.text().split('\n')[0]}`); else if (m.type() === 'warning' && !/GPU stall|Autofocus/.test(m.text())) messages.push(`console.warn: ${m.text().split('\n')[0]}`); });
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url().replace(base, '')}`); });

  if (!has('no-capture')) {
    const cdp = await context.newCDPSession(page);
    cdp.on('Page.screencastFrame', (ev: { data: string; sessionId: number; metadata: { timestamp?: number } }) => {
      void cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => undefined);
      rec.push(Buffer.from(ev.data, 'base64'), (ev.metadata.timestamp ?? Date.now() / 1000) * 1000);
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1, maxWidth: vw, maxHeight: vh });
  }
  phases.push({ phase: 'start', epoch: Date.now() });
  await page.goto(address, { waitUntil: 'domcontentloaded' });

  let lastPhase = '';
  let runningSince = 0;
  let calibSince = 0;
  let clickedAt = 0;
  for (;;) {
    const now = Date.now();
    if (now - t0Wall > maxSeconds * 1000) { problems.push(`stopped after the ${maxSeconds} s limit (phase: ${lastPhase})`); exitCode = exitCode || 4; break; }
    const s = await readState(page);
    if (s) {
      const ph = phaseOf(s);
      if (ph !== lastPhase) { phases.push({ phase: ph, epoch: now }); lastPhase = ph; if (ph === 'calibrating') calibSince = now; if (ph === 'running') runningSince = now; }
      if (ph === 'explainer' && now - clickedAt > 1500) { clickedAt = now; await page.locator('[data-action="camera-continue"]').first().click({ timeout: 5000 }).catch(() => undefined); }
      if (ph === 'failed') { problems.push('the round did not start (see the page text in timeline.json)'); exitCode = exitCode || 3; break; }
      if (ph === 'calibrating' && now - calibSince > calibTimeout * 1000) { problems.push(`calibration did not finish in ${calibTimeout} s: the person in the video is not seen well enough`); exitCode = exitCode || 3; break; }
      if (ph === 'results') { await page.waitForTimeout(1500); break; }
      if (runningSince && /^\d+(\.\d+)?$/.test(until) && now - runningSince > Number(until) * 1000) break;
      if (until === 'video-end' && runningSince) {
        const cam = await page.evaluate(() => (window as unknown as { __fakeCam?: PageCam }).__fakeCam?.streams.length ?? 0).catch(() => 0);
        const sinceStart = (now - runningSince) / 1000;
        if (cam > 0 && sinceStart > sync.contentSeconds) break;
      }
    }
    await page.waitForTimeout(80);
  }
  finalEpoch = Date.now();
  result = await page.evaluate(() => (window as unknown as { __BA__?: { debug(): { result: unknown } } }).__BA__?.debug().result ?? null).catch(() => null);
  camera = await page.evaluate(() => (window as unknown as { __fakeCam?: PageCam }).__fakeCam ?? null).catch(() => null);
  if (exitCode) await page.screenshot({ path: join(out, 'failure.jpg'), type: 'jpeg', quality: 80 }).catch(() => undefined);
} catch (e) {
  problems.push(`runner: ${(e as Error).message.split('\n')[0]}`);
  exitCode = exitCode || 1;
} finally {
  const ffCode = has('no-capture') ? 0 : await rec.finish(finalEpoch);
  await browser.close();
  await server?.close();
  if (ffCode) { problems.push(`ffmpeg ended with code ${ffCode}`); exitCode = exitCode || 1; }
}

if (!has('allow-errors') && !exitCode && problems.some((p) => p.startsWith('uncaught') || p.startsWith('console.error') || p.startsWith('HTTP'))) exitCode = 2;

// ---- the timeline --------------------------------------------------------------------------------------------------------
const captureT0 = rec.t0 ?? t0Wall;
const at = (epoch: number): number => Math.round(((epoch - captureT0) / 1000) * 1000) / 1000;
const streams = (camera?.streams ?? []).map((s) => {
  const found = findStart(s.samples, sync.fps, sync.leaderFrames);
  const epochOf = (perf: number): number => s.timeOrigin + perf;
  const rate = found?.playbackFps ?? sync.fps;
  return {
    openedAt: at(epochOf(s.openedAt)),
    label: s.label,
    settings: s.settings,
    firstLook: s.samples[0] ? at(epochOf(s.samples[0][0])) : null,
    /** Capture time at which frame 0 of the file (the start of the leader) was on the camera; null when the leader was not seen. */
    videoStart: found ? at(epochOf(found.t0)) : null,
    /** Capture time at which the content (the video itself, after the leader) begins. */
    contentStart: found ? at(epochOf(found.t0) + (sync.leaderFrames / rate) * 1000) : null,
    playbackFps: found?.playbackFps ?? null,
    leaderMatch: found ? { agree: found.agree, disagree: found.disagree } : null,
    looks: s.samples.length,
  };
});
if (sync.leaderFrames && streams.length && streams.every((s) => s.videoStart === null)) messages.push('the sync leader was not recognised: the start of the video is known only to about 0.1 s (openedAt)');
const timeline = {
  v: 1,
  command: `node tools/fake-camera/run.ts ${argv.join(' ')}`,
  game: game.id, mode, seed, seated: has('seated'), quiet: has('quiet'), size: `${vw}x${vh}`, address: address.replace(base, '<server>'),
  capture: has('no-capture') ? null : { file: 'capture.mp4', fps, frames: rec.frames, seconds: Math.round((rec.frames / fps) * 1000) / 1000, pictures: rec.pictures, startEpochMs: Math.round(captureT0) },
  camera: { file: 'camera.mjpeg', sync, streams },
  /** Seconds in the capture. */
  phases: phases.map((p) => ({ phase: p.phase, at: at(p.epoch) })),
  result,
  problems,
  messages,
  exitCode,
};
writeFileSync(join(out, 'timeline.json'), JSON.stringify(timeline, null, 1));
const s0 = streams[0];
console.log(`${exitCode ? 'FAILED' : 'done'}: ${out}\n  capture.mp4 ${rec.frames} frames (${(rec.frames / fps).toFixed(1)} s), phases: ${phases.map((p) => `${p.phase}@${at(p.epoch).toFixed(1)}`).join(' ')}\n  video starts in the capture at ${s0?.videoStart ?? 'unknown'} s (content at ${s0?.contentStart ?? 'unknown'} s), playback ${s0?.playbackFps ?? '?'} fps`);
for (const p of problems) console.log(`  problem: ${p}`);
process.exit(exitCode);
