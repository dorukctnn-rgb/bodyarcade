// Runs one live scenario: a room, N headless Chromium players with fake cameras, an injected failure, and the checks.
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { withFakeVideo } from '../../e2e/support/browser.ts';
import type { Action, Scenario } from './scenarios.ts';
import { ROOT, type Stack } from './stack.ts';

const NAMES = ['alice', 'bob', 'carol', 'dave'];
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const FAKE_CAMERA = path.join(ROOT, 'tests/e2e/fixtures/standing-640x360.mjpeg');
const OUT = path.join(ROOT, 'tests/live/out');

export interface PlayerM {
  [k: string]: unknown;
  seat: string | null; done: boolean; results: { mid: string; reason: string; winner: string | null; scores: Record<string, { score: number; hits: number; passes: number; bestCombo: number }>; places: Record<string, number>; forfeited: string[] }[];
  localScores: ({ score: number } | null)[]; phases: { why: string; phase: string; at: number }[]; latency: number[]; seeds: number[]; remoteFrames: number;
  firstRemoteFrameMs: number | null; startWall: number | null; zeroDateNow?: number; endDateNow?: number; heap: number[]; cam?: { lostAt: number; backAt?: number }[];
  fatal?: { reason: string; code: number }; replaced?: boolean; removed?: unknown; roomErrors: string[]; chat: unknown[]; presets: unknown[]; tracks: Record<string, number>;
  finalStats?: { path?: { local?: string; remote?: string; protocol?: string } | null; videoIn?: { fps?: number; freezes?: number } | null }[]; pcs?: number; videos?: number;
  lm: {
    tWelcome?: number; warmupMs?: number; clock?: unknown; connectMs: number[]; pathTypes: ({ local?: string; remote?: string } | null)[]; stSent: number; stRecvDc: number; stRecvRelay: number;
    maxGap: number; gaps: number[]; iceRestarts: number; hardResets: number; wsOpens: number; wsCloses: number; deadSockets: number;
  };
}

export interface ScenarioResult {
  scenario: string;
  pass: boolean;
  failed: string[];
  checks: Record<string, boolean>;
  wallSec: number;
  startSkewMs: number | null;
  endSkewMs: number | null;
  results: unknown;
  players: unknown[];
  extra: Record<string, unknown>;
}

function q(arr: number[] | undefined, p: number): number | null {
  if (!arr || !arr.length) return null;
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? null;
}

async function grab(page: Page): Promise<PlayerM | null> {
  return page.evaluate(() => {
    const m = (window as unknown as { __M__?: Record<string, unknown> }).__M__;
    if (!m) return null;
    const { log: _log, ...rest } = m;
    void _log;
    return JSON.parse(JSON.stringify(rest)) as never;
  }).catch(() => null);
}

async function postJson(url: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, unknown> };
}

export interface PlayerSetup { name: string; pid: string; age: 'adult' | 'teen' | 'child' }

export function identity(i: number, age: PlayerSetup['age'] = 'adult'): PlayerSetup {
  return { name: NAMES[i] as string, pid: `${NAMES[i]}-device-000${i + 1}`, age };
}

/** Opens a WebSocket with a ticket and a hello and reports how the Room answered (used for the third player). */
export function wsProbe(base: string, grant: { code: string; ticket: string }, tab: string): Promise<{ closeCode: number | null; msgs: string[] }> {
  return new Promise((resolve) => {
    const out: { closeCode: number | null; msgs: string[] } = { closeCode: null, msgs: [] };
    const ws = new WebSocket(base.replace(/^http/, 'ws') + `/api/rooms/${grant.code}/ws?ticket=${encodeURIComponent(grant.ticket)}`);
    ws.addEventListener('open', () => ws.send(JSON.stringify({ t: 'hello', v: 1, tab, sess: 'probe-' + tab, video: false, reasons: [], blocks: [] })));
    ws.addEventListener('message', (e) => out.msgs.push(String(e.data).slice(0, 80)));
    ws.addEventListener('close', (e) => { out.closeCode = e.code; resolve(out); });
    setTimeout(() => { try { ws.close(); } catch { /* closing */ } resolve(out); }, 6000);
  });
}

export async function runScenario(stack: Stack, name: string, sc: Scenario): Promise<ScenarioResult> {
  mkdirSync(OUT, { recursive: true });
  const n = sc.players ?? 2;
  const dur = sc.dur ?? 25;
  const matches = sc.matches ?? 1;
  const diag: string[] = [];
  const pageErrors: string[] = [];
  const t0 = Date.now();
  await stack.turnControl('/loss?p=0'); await stack.turnControl('/blackhole?on=0');
  stack.shaperA.freeze(false); stack.shaperB.freeze(false);
  stack.shaperA.setDelay(sc.shape?.[0]?.ms ?? 0, sc.shape?.[0]?.jitter ?? 0);
  stack.shaperB.setDelay(sc.shape?.[1]?.ms ?? 0, sc.shape?.[1]?.jitter ?? 0);

  const who = Array.from({ length: n }, (_, i) => identity(i));
  const created = await postJson(`${stack.base}/api/rooms`, { kind: sc.kind ?? 'private', gameId: 'squat-flap', size: Math.max(2, n), durationMs: dur * 1000, pid: who[0]?.pid, name: who[0]?.name, age: 'adult' });
  if (created.status !== 201) throw new Error(`room not created: ${created.status} ${JSON.stringify(created.json)}`);
  const code = String(created.json.code);
  let thirdTicket: { code: string; ticket: string } | null = null;
  if (sc.actions?.some((a) => a.do === 'thirdJoin')) {
    const j = await postJson(`${stack.base}/api/rooms/${code}/join`, { pid: 'carol-device-0003', name: 'carol', age: 'adult' });
    thirdTicket = { code, ticket: String(j.json.ticket) };
  }

  const videoOf = (i: number): boolean => sc.videoOf?.[i] ?? sc.video ?? false;
  const baseFor = (i: number): string => (i === 0 && sc.shape?.[0] ? stack.baseA : i === 1 && sc.shape?.[1] ? stack.baseB : stack.base);
  const urlFor = (i: number): string => {
    const w = who[i] as PlayerSetup;
    const p = new URLSearchParams({ room: code, pid: w.pid, name: w.name, age: w.age, video: videoOf(i) ? '1' : '0', relay: sc.relay ? '1' : '0', nop2p: sc.nop2p ? '1' : '0', matches: String(matches) });
    if (sc.busy?.[i]) p.set('busy', String(sc.busy[i]));
    if (sc.readyDelayMs) p.set('readydelay', String(sc.readyDelayMs));
    return `${baseFor(i)}/duel?${p.toString()}`;
  };

  const browsers: (Browser | null)[] = await Promise.all(who.map(() => chromium.launch(withFakeVideo(FAKE_CAMERA))));
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];
  const gone = new Set<number>();
  let framesAtCamLoss: number | null = null;
  let third: { closeCode: number | null; msgs: string[]; httpStatus?: number } | null = null;
  let extraPage: Page | null = null;
  const watch = (page: Page, tag: string): void => {
    page.on('pageerror', (e) => { const s = `${tag} pageerror ${String(e).slice(0, 240)}`; diag.push(s); pageErrors.push(s); });
    page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/favicon/.test(m.text())) diag.push(`${tag} console.${m.type()} ${m.text().slice(0, 200)}`); });
    page.on('requestfailed', (r) => { if (!/favicon/.test(r.url())) diag.push(`${tag} requestfailed ${r.url().slice(-60)} ${r.failure()?.errorText ?? ''}`); });
    page.on('crash', () => { const s = `${tag} CRASH`; diag.push(s); pageErrors.push(s); });
  };
  const throttle = async (page: Page, rate: number): Promise<void> => { const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate }); };

  try {
    for (let i = 0; i < n; i++) {
      const ctx = await (browsers[i] as Browser).newContext();
      contexts.push(ctx);
      const page = await ctx.newPage();
      pages.push(page);
      watch(page, (who[i] as PlayerSetup).name);
      const rate = sc.cpu?.[i] ?? 1;
      if (rate > 1) await throttle(page, rate);
    }
    await Promise.all(pages.map((p, i) => p.goto(urlFor(i), { timeout: 60_000 })));

    // fail fast when a page never ran (syntax error, failed module load): 10 s, not the whole match timeout
    let broken = false;
    for (let i = 0; i < 100; i++) {
      const ok = await Promise.all(pages.map((p) => p.evaluate(() => !!(window as unknown as { __M__?: unknown }).__M__).catch(() => false)));
      if (ok.every(Boolean)) break;
      if (i === 99) broken = true; else await sleep(100);
    }

    const act = async (a: Action): Promise<void> => {
      const idx = 'p' in a ? a.p : 0;
      switch (a.do) {
        case 'loss': await stack.turnControl(`/loss?p=${a.p}`); break;
        case 'blackhole': await stack.turnControl(`/blackhole?on=${a.on}`); break;
        case 'deploy': await stack.redeploy(); break;
        case 'kick': await stack.admin(`/api/admin/kick-all?code=${code}`, 'POST'); break;
        case 'freeze': (idx === 0 ? stack.shaperA : stack.shaperB).freeze(true); break;
        case 'reload': await (pages[idx] as Page).reload(); break;
        case 'reloadAll': await Promise.all(pages.map((p) => p.reload())); break;
        case 'quit': await (browsers[idx] as Browser).close(); browsers[idx] = null; gone.add(idx); break;
        case 'leave': gone.add(idx); await (pages[idx] as Page).evaluate(() => (window as unknown as { __lm: { leave(): void } }).__lm.leave()); break;
        case 'thirdJoin': {
          const full = await postJson(`${stack.base}/api/rooms/${code}/join`, { pid: 'dave-device-0004', name: 'dave', age: 'adult' });
          const ws = thirdTicket ? await wsProbe(stack.base, thirdTicket, 'probe') : { closeCode: null, msgs: [] };
          third = { ...ws, httpStatus: full.status };
          break;
        }
        case 'hide': await (pages[idx] as Page).evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }); break;
        case 'show': await (pages[idx] as Page).evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }); break;
        case 'camLoss': {
          framesAtCamLoss = await (pages[0] as Page).evaluate(() => (window as unknown as { __M__: { remoteFrames: number } }).__M__.remoteFrames);
          await (pages[idx] as Page).evaluate(() => { const s = (window as unknown as { __stream: MediaStream }).__stream; const t = s.getVideoTracks()[0] as MediaStreamTrack; t.stop(); t.dispatchEvent(new Event('ended')); });   // stop() alone fires no 'ended'
          break;
        }
        case 'dupTab': {
          extraPage = await (contexts[idx] as BrowserContext).newPage();
          watch(extraPage, `${(who[idx] as PlayerSetup).name}2`);
          await extraPage.goto(urlFor(idx));
          break;
        }
      }
    };

    // wait for the `start` message (the countdown begins), run the pre-actions, then wait for match time zero
    let tStart: number | null = null;
    for (let i = 0; !broken && i < 600 && tStart === null; i++) {
      const ok = await (pages[0] as Page).evaluate(() => !!(window as unknown as { __M__?: { phases: { why: string }[] } }).__M__?.phases.some((p) => p.why === 'start')).catch(() => false);
      if (ok) tStart = Date.now(); else await sleep(100);
    }
    for (const a of broken ? [] : sc.pre ?? []) { const wait = a.at - (Date.now() - (tStart ?? Date.now())); if (wait > 0) await sleep(wait); await act(a); }
    let zero: number | null = null;
    for (let i = 0; !broken && i < 600 && zero === null; i++) {
      zero = await (pages[0] as Page).evaluate(() => (window as unknown as { __M__?: { startWall: number | null } }).__M__?.startWall ?? null).catch(() => null);
      if (zero === null) await sleep(100);
    }
    const tZero = Date.now();
    for (const a of (broken ? [] : sc.actions ?? []).slice().sort((x, y) => x.at - y.at)) { const wait = a.at - (Date.now() - tZero); if (wait > 0) await sleep(wait); await act(a); }

    const deadline = broken ? Date.now() + 1000 : Date.now() + (dur * matches + 120) * 1000;
    let M: (PlayerM | null)[] = [];
    while (Date.now() < deadline) {
      M = await Promise.all(pages.map((p, i) => (gone.has(i) ? Promise.resolve(null) : grab((i === 1 && extraPage ? extraPage : p)))));
      const live = M.filter((_, i) => !gone.has(i));
      const need = sc.expect === 'forfeit' ? [M[0]] : live;
      if (need.every((m) => m && m.done)) break;
      await sleep(500);
    }
    const oldTab = extraPage ? await grab(pages[1] as Page) : null;
    const state = await stack.admin(`/api/admin/state?code=${code}`).catch(() => null) as { match?: { phase: string } } | null;
    const turn = await stack.turnControl('/stats');
    const tail = await Promise.all(pages.map((p) => p.evaluate(() => (window as unknown as { __M__?: { log: string[] } }).__M__?.log.slice(-60) ?? []).catch(() => [] as string[])));
    return finish(name, sc, who, M, oldTab, { third, framesAtCamLoss, state, turnDropped: turn?.dropped ?? null, diag: diag.slice(0, 20), diagCount: diag.length, pageErrors, tail, broken, code }, Date.now() - t0);
  } finally {
    await Promise.all(browsers.map((b) => b?.close().catch(() => undefined)));
  }
}

function finish(name: string, sc: Scenario, who: PlayerSetup[], M: (PlayerM | null)[], oldTab: PlayerM | null, extra: Record<string, unknown>, wallMs: number): ScenarioResult {
  const n = sc.matches ?? 1;
  const A = M[0] ?? null;
  const live = M.filter((m, i): m is PlayerM => !!m && !(sc.expect === 'forfeit' && i === 1));
  const checks: Record<string, boolean> = {};
  checks.noPageErrors = (extra.pageErrors as string[]).length === 0;
  checks.pagesRan = !extra.broken;
  if (sc.expect === 'forfeit') {
    checks.aDone = !!A?.done;
    checks.forfeitToA = !!A && A.results[0]?.reason === 'forfeit' && A.results[0]?.winner === A.seat;
  } else {
    const goneCount = (sc.actions ?? []).filter((a) => a.do === 'quit' || a.do === 'leave').length;
    checks.allDone = live.length === M.length - goneCount && live.every((m) => m.done && m.results.length === n);
    const sig = (m: PlayerM): string => JSON.stringify(m.results.map((r) => [r.scores, r.winner, r.reason, r.places]));
    checks.sameResult = checks.allDone && live.every((m) => sig(m) === sig(live[0] as PlayerM));
    checks.complete = checks.allDone && live.every((m) => m.results.every((r) => r.reason === 'complete'));
    checks.localEqualsServer = checks.allDone && live.every((m) => !!m.seat && m.results.every((r, i) => !!m.localScores[i] && r.scores[m.seat as string]?.score === m.localScores[i]?.score));
    if (n > 1) checks.newSeedEachMatch = !!A && new Set(A.seeds).size === n;
    const third = extra.third as { closeCode: number | null; msgs: string[]; httpStatus?: number } | null;
    if (sc.actions?.some((a) => a.do === 'thirdJoin')) checks.thirdRejected = !!third && third.httpStatus === 409 && third.closeCode === 4001;
    if (oldTab) checks.oldTabStopped = !!oldTab.replaced && oldTab.lm.wsOpens === 1 && oldTab.fatal?.reason === 'replaced';
    if (sc.actions?.some((a) => a.do === 'camLoss')) {
      const B = M[1];
      checks.camBack = !!B?.cam?.[0]?.backAt;
      checks.pausedForCamera = !!A && A.phases.some((p) => p.phase === 'paused') && A.phases.some((p) => p.why === 'resumed');
      checks.videoFlowsAgain = !!A && extra.framesAtCamLoss !== null && A.remoteFrames - (extra.framesAtCamLoss as number) > 60;
    }
    if (sc.actions?.some((a) => a.do === 'hide')) checks.resumed = !!A && A.phases.some((p) => p.why === 'resumed');
    // a reload under the 5 s debounce need not pause anything; the reloaded page must be back in the same match
    const reloaded = (sc.actions ?? []).flatMap((a) => (a.do === 'reload' ? [a.p] : a.do === 'reloadAll' ? M.map((_, i) => i) : []));
    if (reloaded.length) checks.rejoined = reloaded.every((i) => !!M[i] && (M[i] as PlayerM).phases.some((p) => p.why === 'welcome') && (M[i] as PlayerM).seeds.length >= 1);
    if (goneCount > 0 && (sc.players ?? 2) > 2) {
      const left = (sc.actions ?? []).filter((a) => a.do === 'quit' || a.do === 'leave').length;
      checks.leaversForfeited = checks.allDone && live.every((m) => m.results.every((r) => r.forfeited.length === left));
      checks.othersCompleted = checks.complete;
    }
    if ((sc.players ?? 2) > 2) checks.placesForEveryone = checks.allDone && live.every((m) => m.results.every((r) => Object.keys(r.places).length === (sc.players ?? 2) - goneCount));
    if (sc.kind === 'public') checks.noVideoInPublic = live.every((m) => Object.keys(m.tracks).length === 0 && m.remoteFrames === 0);
    else if (sc.video && (sc.players ?? 2) > 2) checks.meshVideo = live.every((m) => Object.keys(m.tracks).length >= (sc.players ?? 2) - 1 - goneCount && m.remoteFrames > 30);
  }
  const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  const B = M[1] ?? null;
  const pick = (X: PlayerM | null) => X && {
    seat: X.seat, welcomeMs: Math.round(X.lm.tWelcome ?? 0), warmupMs: X.lm.warmupMs, clock: X.lm.clock, connectMs: X.lm.connectMs, path: X.lm.pathTypes.slice(-1)[0],
    firstRemoteFrameMs: X.firstRemoteFrameMs, remoteFrames: X.remoteFrames, stSent: X.lm.stSent, recvDc: X.lm.stRecvDc, recvRelay: X.lm.stRecvRelay, maxGapMs: Math.round(X.lm.maxGap),
    gapsOver400: X.lm.gaps.length, iceRestarts: X.lm.iceRestarts, hardResets: X.lm.hardResets, wsOpens: X.lm.wsOpens, wsCloses: X.lm.wsCloses, deadSockets: X.lm.deadSockets,
    latencyP50: q(X.latency, 0.5), latencyP95: q(X.latency, 0.95), phases: X.phases.map((p) => `${p.why}:${p.phase}`).join(' '), video: X.finalStats?.[0]?.videoIn, cam: X.cam,
    heapKB: X.heap, fatal: X.fatal, roomErrors: X.roomErrors,
  };
  const result: ScenarioResult = {
    scenario: name, pass: failed.length === 0, failed, checks, wallSec: Math.round(wallMs / 1000),
    startSkewMs: A?.zeroDateNow && B?.zeroDateNow ? +Math.abs(A.zeroDateNow - B.zeroDateNow).toFixed(1) : null,
    endSkewMs: A?.endDateNow && B?.endDateNow ? +Math.abs(A.endDateNow - B.endDateNow).toFixed(1) : null,
    results: A ? A.results.map((r) => ({ reason: r.reason, winner: r.winner, scores: Object.fromEntries(Object.entries(r.scores).map(([k, v]) => [k, v.score])) })) : null,
    players: M.map(pick), extra,
  };
  void who;
  writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({ result, M, oldTab }, null, 1));
  console.log(JSON.stringify({ scenario: name, pass: result.pass, failed, wallSec: result.wallSec, startSkewMs: result.startSkewMs, results: result.results, diagCount: extra.diagCount }));
  return result;
}
