// Live races between headless Chromium players on the DEPLOYED Worker (the preview by default): real HTTPS, the Room
// Durable Object on Cloudflare, WebSockets through the edge, STUN from Cloudflare and P2P video between the players.
// The synthetic player is the live suite's duel page (tests/live/pages/duel.html, the same LiveClient the game uses),
// built here and served to each browser under <origin>/__live-test/ by request interception, so nothing test-only is
// deployed and the page's origin is the deployed one. Checks as in tests/live/support/runner.ts: every player gets
// every result, the results are identical, complete, and each player's own score equals the Room's.
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { build } from 'vite';
import { withFakeVideo } from '../e2e/support/browser.ts';
import { BASE, OUT, ROOT, sleep } from './support.ts';

const PREFIX = '/__live-test/';
let pagesDir = '';
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

test.beforeAll(async () => {
  test.setTimeout(120_000);
  pagesDir = mkdtempSync(join(tmpdir(), 'ba-release-live-'));
  await build({
    root: join(ROOT, 'tests/live/pages'), base: PREFIX, configFile: false, logLevel: 'warn',
    build: { outDir: pagesDir, emptyOutDir: true, minify: false, target: 'es2022', sourcemap: false, rollupOptions: { input: join(ROOT, 'tests/live/pages/duel.html') } },
  });
});
test.afterAll(() => { if (pagesDir) rmSync(pagesDir, { recursive: true, force: true }); });

interface M {
  done: boolean; seat: string | null; fatal: unknown; results: { scores: Record<string, { score: number }>; winner: string | null; reason: string; places: Record<string, number>; forfeited: string[] }[];
  localScores: ({ score: number } | null)[]; seeds: number[]; remoteFrames: number; phases: { why: string; phase: string }[]; roomErrors: string[]; tracks: Record<string, number>;
}

const grab = (p: Page): Promise<M | null> => p.evaluate(() => {
  const m = (window as unknown as { __M__?: M }).__M__;
  return m ? JSON.parse(JSON.stringify({ done: m.done, seat: m.seat ?? null, fatal: m.fatal ?? null, results: m.results, localScores: m.localScores, seeds: m.seeds, remoteFrames: m.remoteFrames, phases: m.phases, roomErrors: m.roomErrors, tracks: m.tracks })) as M : null;
}).catch(() => null);

interface Race { players: number; video: boolean; matches: number; dur: number; reloadAt?: number }

async function race(name: string, r: Race): Promise<Record<string, unknown>> {
  const names = ['ana', 'ben', 'cem', 'dua'].slice(0, r.players);
  const pids = names.map((n, i) => `release-${n}-${Date.now().toString(36)}-${i}`);
  const created = await fetch(`${BASE}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'private', gameId: 'squat-flap', size: Math.max(2, r.players), durationMs: r.dur * 1000, pid: pids[0], name: names[0], age: 'adult' }) });
  expect(created.status, `create room: ${await created.clone().text()}`).toBe(201);
  const { code } = (await created.json()) as { code: string };
  const browsers: Browser[] = [];
  const pages: Page[] = [];
  const errors: string[] = [];
  try {
    for (let i = 0; i < r.players; i++) {
      const b = await chromium.launch(withFakeVideo(join(ROOT, 'tests/e2e/fixtures/standing-640x360.mjpeg')));
      browsers.push(b);
      const ctx = await b.newContext({ permissions: ['camera'], serviceWorkers: 'block' });
      await ctx.route(`${BASE}${PREFIX}**`, async (route) => {
        const path = new URL(route.request().url()).pathname.slice(PREFIX.length) || 'duel.html';
        const file = join(pagesDir, path === 'duel' ? 'duel.html' : path);
        if (!existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
        return route.fulfill({ status: 200, body: readFileSync(file), headers: { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' } });
      });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`${names[i]}: ${String(e).slice(0, 200)}`));
      pages.push(page);
    }
    const url = (i: number) => {
      const q = new URLSearchParams({ room: code, pid: pids[i] as string, name: names[i] as string, age: 'adult', video: r.video ? '1' : '0', matches: String(r.matches) });
      if (r.players > 2) q.set('noready', '1');
      return `${BASE}${PREFIX}duel.html?${q.toString()}`;
    };
    await Promise.all(pages.map((p, i) => p.goto(url(i), { timeout: 60_000 })));
    if (r.players > 2) {
      for (let i = 0; i < 300; i++) {
        const seats = await Promise.all(pages.map(async (p) => (await grab(p))?.seat ?? null));
        if (seats.every(Boolean)) break;
        await sleep(100);
      }
      await Promise.all(pages.map((p) => p.evaluate(() => (window as unknown as { __lm: { setReady(r: boolean): void } }).__lm.setReady(true))));
    }
    if (r.reloadAt !== undefined) {
      for (let i = 0; i < 600; i++) { if (((await grab(pages[0] as Page))?.seeds.length ?? 0) > 0) break; await sleep(100); }
      await sleep(r.reloadAt);
      await (pages[1] as Page).reload();
    }
    const deadline = Date.now() + (r.dur * r.matches + 150) * 1000;
    let all: (M | null)[] = [];
    while (Date.now() < deadline) {
      all = await Promise.all(pages.map(grab));
      if (all.every((m) => m?.done)) break;
      await sleep(500);
    }
    const live = all.filter((m): m is M => !!m);
    const sig = (m: M) => JSON.stringify(m.results.map((x) => [x.scores, x.winner, x.reason, x.places]));
    const allDone = live.length === r.players && live.every((m) => m.done && m.results.length === r.matches);
    const checks: Record<string, boolean> = { noPageErrors: errors.length === 0, allDone };
    checks.sameResult = allDone && live.every((m) => sig(m) === sig(live[0] as M));
    checks.complete = allDone && live.every((m) => m.results.every((x) => x.reason === 'complete'));
    checks.localEqualsServer = allDone && live.every((m) => !!m.seat && m.results.every((x, i) => !!m.localScores[i] && x.scores[m.seat as string]?.score === m.localScores[i]?.score));
    if (r.matches > 1) checks.newSeedEachMatch = new Set(live[0]?.seeds ?? []).size === r.matches;
    if (r.players > 2) checks.placesForEveryone = allDone && live.every((m) => m.results.every((x) => Object.keys(x.places).length === r.players));
    if (r.video) checks.videoFlows = live.every((m) => m.remoteFrames > 30);
    if (r.reloadAt !== undefined) checks.rejoined = !!live[1] && live[1].phases.some((p) => p.why === 'welcome');
    const out = { name, code, checks, errors, results: live.map((m) => ({ seat: m.seat, results: m.results.map((x) => ({ winner: x.winner, reason: x.reason, scores: x.scores })), remoteFrames: m.remoteFrames, roomErrors: m.roomErrors })) };
    writeFileSync(join(OUT, `live-${name}.json`), JSON.stringify(out, null, 1));
    return out;
  } finally {
    await Promise.all(browsers.map((b) => b.close().catch(() => undefined)));
  }
}

const RACES: [string, Race][] = [
  ['race_1v1_relay', { players: 2, video: false, matches: 1, dur: 25 }],
  ['race_1v1_video', { players: 2, video: true, matches: 1, dur: 25 }],
  ['rematch', { players: 2, video: false, matches: 2, dur: 18 }],
  ['reload_mid_match', { players: 2, video: false, matches: 1, dur: 30, reloadAt: 8000 }],
  ['room_of_3', { players: 3, video: false, matches: 1, dur: 25 }],
  ['room_of_4', { players: 4, video: false, matches: 1, dur: 25 }],
];

for (const [name, r] of RACES) {
  test(`live on the deployed Worker: ${name}`, async () => {
    test.setTimeout((r.dur * r.matches + 240) * 1000);
    const out = await race(name, r);
    const failed = Object.entries(out.checks as Record<string, boolean>).filter(([, v]) => !v).map(([k]) => k);
    expect(failed, JSON.stringify(out, null, 1).slice(0, 2500)).toEqual([]);
  });
}
