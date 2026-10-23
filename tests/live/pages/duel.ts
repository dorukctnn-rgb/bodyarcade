// Synthetic player for the two-browser live suite. It uses the same LiveClient the game uses; the "player" passes or
// hits each obstacle from a seeded random stream instead of a camera, so a run is repeatable.
// Query: room, pid, name, age (adult|teen|child), video=0|1, relay=1 (TURN only), nop2p=1, peers=none, dur (s, for the
// first ready), skill (0..1), matches=N (rematch until N results), busy=ms (block the main thread this long every
// 33 ms, like pose inference on a phone), noready=1 (do not press ready on welcome).
import { LiveClient, fetchIce, joinRoom, makeSchedule, scoreOf, specFor, type Identity, type Obstacle } from '../../../packages/core/net/index.ts';
import type { MatchInfo, MatchResult, ObstacleResult } from '../../../packages/core/types/net.ts';

const q = new URLSearchParams(location.search);
const clock = (): number => performance.timeOrigin + performance.now();
const logEl = document.getElementById('log') as HTMLElement;

interface Metrics {
  [k: string]: unknown;
  log: string[]; done: boolean; startWall: number | null; zeroDateNow?: number; endDateNow?: number; events: number; remoteFrames: number;
  firstRemoteFrameMs: number | null; phases: { why: string; phase: string; at: number }[]; latency: number[]; results: MatchResult[];
  localScores: (ReturnType<typeof scoreOf> | null)[]; ends: number[]; seeds: number[]; heap: number[]; seat?: string | null;
  members?: unknown; chat: unknown[]; presets: unknown[]; roomErrors: string[]; removed?: unknown; fatal?: unknown; replaced?: boolean;
  cam?: { lostAt: number; backAt?: number }[]; finalStats?: unknown; lm?: unknown; pcs?: number; videos?: number; tracks: Record<string, number>;
}

const M: Metrics = { log: [], done: false, startWall: null, events: 0, remoteFrames: 0, firstRemoteFrameMs: null, phases: [], latency: [], results: [], localScores: [], ends: [], seeds: [], heap: [], chat: [], presets: [], roomErrors: [], tracks: {} };
(window as unknown as { __M__: Metrics }).__M__ = M;

const log = (s: string): void => {
  const line = `${((clock() % 100_000) / 1000).toFixed(2)} ${s}`;
  logEl.textContent += line + '\n';
  M.log.push(line);
};

const code = q.get('room') ?? '';
const pid = q.get('pid') ?? `p${Math.random().toString(36).slice(2, 10)}xxxx`;
const who: Identity = { pid, name: (q.get('name') ?? pid.replace(/[^A-Za-z]/g, '').slice(0, 12)) || 'Player', age: (q.get('age') as Identity['age'] | null) ?? 'adult' };
const wantVideo = q.get('video') === '1';
const skill = Number(q.get('skill') ?? '0.8');
const matches = Number(q.get('matches') ?? '1');
const busy = Number(q.get('busy') ?? '0');
const origin = location.origin;
if (busy > 0) setInterval(() => { const t = performance.now(); while (performance.now() - t < busy) { /* a busy main thread */ } }, 33);

let stream: MediaStream | null = null;
if (wantVideo && q.get('camdeny') === '1') { M.camDenied = true; log('camera denied (test)'); }
else if (wantVideo) {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, frameRate: 30 }, audio: false });
    (document.getElementById('me') as HTMLVideoElement).srcObject = stream;
  } catch (e) { log('camera failed: ' + (e as Error).name); }
}

let grant;
try { grant = await joinRoom(origin, code, who); } catch (e) { M.fatal = { reason: 'join', error: String(e) }; M.done = true; throw e; }
const lm = new LiveClient({
  grant, origin, refreshTicket: () => joinRoom(origin, code, who), video: wantVideo && !!stream, stream,
  peers: q.get('peers') === 'none' ? 'none' : 'webrtc', ice: () => fetchIce(origin),
  forceRelay: q.get('relay') === '1', noP2P: q.get('nop2p') === '1', log,
  blocks: JSON.parse(sessionStorage.getItem('blocks') ?? '[]') as string[],
});
const w = window as unknown as { __lm: LiveClient; __stream: MediaStream | null };
w.__lm = lm; w.__stream = stream;
M.lm = lm.m;

// Camera lost mid-match (unplugged, permission revoked, another app took it, a phone locked on iOS): pause, get a new
// track, swap it into the running connections without renegotiating, recalibrate, resume.
function watchCamera(track: MediaStreamTrack): void {
  track.addEventListener('ended', async () => {
    const ev: { lostAt: number; backAt?: number } = { lostAt: Math.round(clock() - lm.m.t0) };
    (M.cam ??= []).push(ev);
    log('camera lost: pausing');
    lm.pause('camera');
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const s2 = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, frameRate: 30 }, audio: false });
        const t2 = s2.getVideoTracks()[0] as MediaStreamTrack;
        stream = w.__stream = s2;
        (document.getElementById('me') as HTMLVideoElement).srcObject = s2;
        await lm.replaceVideoTrack(t2);
        watchCamera(t2);
        await new Promise((r) => setTimeout(r, 1200));           // the game recalibrates the player here
        ev.backAt = Math.round(clock() - lm.m.t0);
        log('camera back, resuming');
        lm.unpause('camera');
        return;
      } catch (e) { log('camera retry failed ' + (e as Error).name); }
    }
  });
}
if (stream) watchCamera(stream.getVideoTracks()[0] as MediaStreamTrack);

lm.on('fatal', (d) => { M.fatal = d; log('fatal ' + JSON.stringify(d)); if (d.reason === 'replaced') { M.replaced = true; M.done = true; } });
lm.on('removed', (d) => { M.removed = d; });
lm.on('roomError', (d) => { M.roomErrors.push(d.code); });
lm.on('chat', (d) => { M.chat.push(d); });
lm.on('preset', (d) => { M.presets.push(d); });
lm.on('blocked', (d) => { sessionStorage.setItem('blocks', JSON.stringify(lm.blocks)); ((M.blocked ??= []) as unknown[]).push(d); });
lm.on('chatRejected', (d) => { ((M.chatRejected ??= []) as unknown[]).push(d); });
lm.on('reported', (d) => { ((M.reported ??= []) as unknown[]).push(d); });
lm.on('room', (d) => { M.room = d; });
lm.on('forfeit', (d) => { ((M.forfeits ??= []) as unknown[]).push(d.seat); });
lm.on('presence', (list) => { M.members = list; });
lm.on('synced', (d) => log('clock ' + JSON.stringify(d)));
lm.on('welcome', (d) => {
  M.seat = d.you;
  M.room = d.room;
  M.welcomes = ((M.welcomes as number | undefined) ?? 0) + 1;
  if (!(M as { readySent?: boolean }).readySent && q.get('noready') !== '1') {
    (M as { readySent?: boolean }).readySent = true;
    const delay = Number(q.get('readydelay') ?? '0');
    if (delay > 0) setTimeout(() => lm.setReady(true), delay); else lm.setReady(true);
  }
  const mt = d.match;
  if (mt && game && game.id === mt.id) game.resolvedUpTo = Math.max(game.resolvedUpTo, lm.matchTime());      // skip what passed while we were away
});
lm.on('track', (d) => {
  M.tracks[d.from] = (M.tracks[d.from] ?? 0) + 1;
  let v = document.getElementById('rival-' + d.from) as HTMLVideoElement | null;
  if (!v) { v = document.createElement('video'); v.id = 'rival-' + d.from; v.muted = true; v.autoplay = true; v.playsInline = true; document.getElementById('videos')?.appendChild(v); }
  v.srcObject = d.stream;
  const onFrame = (): void => {
    M.remoteFrames++;
    if (M.firstRemoteFrameMs === null) { M.firstRemoteFrameMs = Math.round(clock() - lm.m.t0); log('first remote video frame'); }
    (v as HTMLVideoElement).requestVideoFrameCallback(onFrame);
  };
  v.requestVideoFrameCallback(onFrame);
});
lm.on('phase', (d) => { M.phases.push({ why: d.why, phase: d.match.phase, at: Math.round(clock() - lm.m.t0) }); log(`phase ${d.why} ${d.match.phase}`); });
lm.on('state', (d) => { if (M.latency.length < 4000) M.latency.push(Math.round(d.latency)); });

interface Game { id: string; course: Obstacle[]; mine: ObstacleResult[]; resolvedUpTo: number; rng: () => number; finalSent: boolean; zeroSeen: boolean }
let game: Game | null = null;

function mulberry(a: number): () => number {
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function startGame(mt: MatchInfo, mine: ObstacleResult[]): void {
  const course = makeSchedule(mt.seed, mt.duration, specFor(mt.gameId));
  const rng = mulberry([...pid].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) ^ mt.seed);
  game = { id: mt.id, course, mine: mine.slice(), resolvedUpTo: Math.max(0, lm.matchTime()), rng, finalSent: false, zeroSeen: false };
  M.seeds.push(mt.seed);
  M.courseLen = course.length;
  log(`match ${mt.id.slice(0, 8)} seed ${mt.seed} obstacles ${course.length} restored ${mine.length}`);
}

// 'match' fires for a new match and when this page rejoins a running one; it carries the outcomes the Room already holds
lm.on('match', (d) => { if (!game || game.id !== d.match.id) startGame(d.match, d.mine); });
lm.on('result', (res) => {
  const local = game && game.id === res.mid ? scoreOf(game.course, game.mine) : null;
  M.results.push(res); M.localScores.push(local);
  const pm = performance as unknown as { memory?: { usedJSHeapSize: number } };
  if (pm.memory) M.heap.push(Math.round(pm.memory.usedJSHeapSize / 1024));
  M.pcs = lm.peerLinks.size; M.videos = document.querySelectorAll('video').length;
  log('result ' + JSON.stringify(res));
  if (M.results.length < matches) { setTimeout(() => lm.setReady(true), 1500); return; }      // rematch
  void lm.stats().then((s) => { M.finalStats = s; M.done = true; });
});

let lastState = 0;
setInterval(() => {
  if (lm.closed || !game || !lm.match || lm.match.id !== game.id || lm.match.phase === 'over' || !lm.playing) return;
  const mt = lm.matchTime();
  const ph = lm.match.phase;
  if (ph === 'running' && mt >= 0 && !game.zeroSeen) {
    game.zeroSeen = true;
    // match time zero on the wall clock; only a page that saw zero live can measure the start skew
    if (M.startWall === null) { M.startWall = clock(); if (mt < 500) M.zeroDateNow = Date.now() - mt; }
    log('match time zero');
  }
  if (ph === 'running' && mt >= 0) {
    for (const o of game.course) {
      if (o.t <= game.resolvedUpTo || o.t > mt) continue;
      if (game.mine.some((e) => e.ob === o.id)) continue;
      const k = game.rng() < skill ? 'pass' : 'hit';
      game.mine.push({ ob: o.id, k });
      lm.reportResult(o.id, k);
      M.events++;
    }
    game.resolvedUpTo = Math.max(game.resolvedUpTo, mt);
  }
  if ((ph === 'running' || ph === 'settling') && mt >= lm.match.duration && !game.finalSent) {
    game.finalSent = true;
    M.ends.push(ph === 'running' ? Date.now() - (mt - lm.match.duration) : Date.now());
    if (M.endDateNow === undefined) M.endDateNow = M.ends[0] as number;
    lm.finish(game.mine);
    log('local end, final sent');
  }
  if (clock() - lastState > 66) {                    // about 15 Hz: ghost and live score
    lastState = clock();
    const pose = Array.from({ length: 17 }, (_, i) => [Math.round(320 + 80 * Math.sin(mt / 300 + i)), Math.round(240 + 60 * Math.cos(mt / 280 + i))]);
    lm.sendState({ mt: Math.round(mt), sc: scoreOf(game.course, game.mine).score, pose });
  }
  (document.getElementById('hud') as HTMLElement).textContent = `${ph} t=${(mt / 1000).toFixed(1)} score=${scoreOf(game.course, game.mine).score}`;
}, 50);

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') lm.pause('hidden'); else lm.unpause('hidden'); });
await lm.start();
