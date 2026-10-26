// Synthetic player for the two-browser live suite. It plays through LiveRace, the same facade a game page uses, so every
// scenario also tests the facade; the "player" passes or hits each obstacle from a seeded random stream instead of a
// camera, so a run is repeatable.
// Query: room, pid, name, age (adult|teen|child), video=0|1, relay=1 (TURN only), nop2p=1, peers=none, dur (s, for the
// first ready), skill (0..1), matches=N (rematch until N results), busy=ms (block the main thread this long every
// 33 ms, like pose inference on a phone), noready=1 (do not press ready on welcome), lang=en|tr (the language of the
// friend tiles: the shell's own words for a camera that did not connect).
// A friend tile per rival (the model of core/net/friend-tile.ts, drawn here the way the stage draws it): the camera picture
// only while it flows, otherwise a skeleton from the ghost frames, one line when the camera did not connect and a retry button.
import { decodeRun, encodeRun, friendTiles, LiveRace, runScore, scoreOf, type Identity } from '../../../packages/core/net/index.ts';
import { createI18n, isLang } from '../../../packages/core/ui/i18n/index.ts';
import type { MatchResult } from '../../../packages/core/types/net.ts';
import type { Landmark } from '../../../packages/core/types/index.ts';

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
  /** The camera link states the page was told, with the page's time; the tile as drawn; what the player would have read and pressed. */
  videoLog: { seat: string; state: string; reason: string | null; attempts: number; at: number }[];
  peersBroken?: boolean;
  runChecks: { mid: string; seat: string; has: boolean; score: number | null; roomScore: number | null; code: boolean }[];
  skeletonFrames: Record<string, number>; lastScore: Record<string, number>; shows: Record<string, string[]>; notes: Record<string, string[]>; noteNow: Record<string, string>; retryShown: Record<string, boolean>; retryClicks: number;
}

const M: Metrics = {
  log: [], done: false, startWall: null, events: 0, remoteFrames: 0, firstRemoteFrameMs: null, phases: [], latency: [], results: [], localScores: [], ends: [], seeds: [], heap: [], chat: [], presets: [], roomErrors: [], tracks: {},
  videoLog: [], runChecks: [], skeletonFrames: {}, lastScore: {}, shows: {}, notes: {}, noteNow: {}, retryShown: {}, retryClicks: 0,
};
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

let race: LiveRace;
try {
  race = await LiveRace.join({
    who, invite: code, origin, stream, video: wantVideo && !!stream, peers: q.get('peers') === 'none' ? 'none' : 'webrtc',
    blocks: { load: () => JSON.parse(sessionStorage.getItem('blocks') ?? '[]') as string[], save: (k) => sessionStorage.setItem('blocks', JSON.stringify(k)) },
    client: { forceRelay: q.get('relay') === '1', noP2P: q.get('nop2p') === '1', log },
  });
} catch (e) { M.fatal = { reason: 'join', error: String(e) }; M.done = true; throw e; }
const lm = race.client;
const w = window as unknown as { __lm: typeof lm; __race: LiveRace; __stream: MediaStream | null };
w.__lm = lm; w.__race = race; w.__stream = stream;
M.lm = lm.m;

// Camera lost mid-match (unplugged, permission revoked, another app took it, a phone locked on iOS): pause, get a new
// track, swap it into the running connections without renegotiating, recalibrate, resume.
function watchCamera(track: MediaStreamTrack): void {
  track.addEventListener('ended', async () => {
    const ev: { lostAt: number; backAt?: number } = { lostAt: Math.round(clock() - lm.m.t0) };
    (M.cam ??= []).push(ev);
    log('camera lost: pausing');
    race.pause('camera');
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
        race.unpause('camera');
        return;
      } catch (e) { log('camera retry failed ' + (e as Error).name); }
    }
  });
}
if (stream) watchCamera(stream.getVideoTracks()[0] as MediaStreamTrack);

race.on('closed', (d) => { M.fatal = { reason: d.reason, code: d.code }; log('closed ' + JSON.stringify(d)); if (d.reason === 'replaced') { M.replaced = true; M.done = true; } });
race.on('removed', (d) => { M.removed = d; });
race.on('roomError', (d) => { M.roomErrors.push(d.code); });
race.on('chat', (d) => { M.chat.push(d); });
race.on('preset', (d) => { M.presets.push(d); });
race.on('blocked', (d) => { ((M.blocked ??= []) as unknown[]).push(d); });
race.on('chatRejected', (d) => { ((M.chatRejected ??= []) as unknown[]).push(d); });
race.on('reported', (d) => { ((M.reported ??= []) as unknown[]).push(d); });
race.on('forfeit', (d) => { ((M.forfeits ??= []) as unknown[]).push(d.seat); });
race.on('lobby', (v) => { M.members = v.members; M.room = v.room; });
race.on('ghost', (d) => {
  if (M.latency.length < 4000) M.latency.push(Math.round(d.latencyMs));
  drawSkeleton(d.from);
});
race.on('state', (d) => log(`state ${d.prev} -> ${d.state}`));
lm.on('synced', (d) => log('clock ' + JSON.stringify(d)));
lm.on('phase', (d) => { M.phases.push({ why: d.why, phase: d.match.phase, at: Math.round(clock() - lm.m.t0) }); log(`phase ${d.why} ${d.match.phase}`); });
lm.on('welcome', (d) => {
  M.seat = d.you;
  M.room = d.room;
  M.welcomes = ((M.welcomes as number | undefined) ?? 0) + 1;
  if (!(M as { readySent?: boolean }).readySent && q.get('noready') !== '1') {
    (M as { readySent?: boolean }).readySent = true;
    const delay = Number(q.get('readydelay') ?? '0');
    if (delay > 0) setTimeout(() => race.ready(), delay); else race.ready();
  }
});
// ───────── the friend tiles ─────────
const i18n = createI18n(isLang(q.get('lang')) ? (q.get('lang') as 'en' | 'tr') : 'en');
const tilesEl = document.getElementById('tiles') as HTMLElement;
const tileEl = (seat: string): HTMLElement => {
  let el = document.getElementById('tile-' + seat);
  if (!el) {
    el = document.createElement('div');
    el.id = 'tile-' + seat;
    el.innerHTML = `<span class="who"></span><div class="pic"><canvas id="sk-${seat}" width="160" height="120"></canvas></div><p id="note-${seat}" role="status"></p><button id="retry-${seat}" type="button" hidden></button>`;
    (el.querySelector('button') as HTMLButtonElement).addEventListener('click', () => { M.retryClicks++; race.retryVideo(seat); });
    tilesEl.appendChild(el);
  }
  return el;
};
function renderTiles(): void {
  for (const tile of friendTiles(race.members, race.you, race.videos)) {
    const el = tileEl(tile.seat);
    (el.querySelector('.who') as HTMLElement).textContent = tile.name;
    const canvas = document.getElementById('sk-' + tile.seat) as HTMLCanvasElement;
    const vid = document.getElementById('rival-' + tile.seat) as HTMLVideoElement | null;
    if (vid) vid.style.display = tile.show === 'video' ? '' : 'none';
    canvas.style.display = tile.show === 'video' ? 'none' : '';
    const seen = (M.shows[tile.seat] ??= []);
    if (seen[seen.length - 1] !== tile.show) seen.push(tile.show);
    const note = document.getElementById('note-' + tile.seat) as HTMLElement;
    note.textContent = tile.note ? i18n.t(tile.note) : '';
    M.noteNow[tile.seat] = note.textContent;
    if (tile.note) { const seen = (M.notes[tile.seat] ??= []); if (!seen.includes(note.textContent)) seen.push(note.textContent); }
    const btn = document.getElementById('retry-' + tile.seat) as HTMLButtonElement;
    btn.hidden = !tile.retry;
    btn.textContent = i18n.t('common.retry');
    if (tile.retry) M.retryShown[tile.seat] = true;
  }
}
/** The friend's skeleton as the board keeps it (frames are checked on arrival, a skeleton goes when its frames stop). */
function drawSkeleton(from: string): void {
  const pose = race.rivals.pose(from);
  if (!pose) return;
  tileEl(from);
  const canvas = document.getElementById('sk-' + from) as HTMLCanvasElement | null;
  const g = canvas?.getContext('2d');
  if (!canvas || !g) return;
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#9fd';
  for (const p of pose) if (p.visibility > 0) g.fillRect((1 - p.x) * canvas.width - 1, p.y * canvas.height - 1, 3, 3);
  M.skeletonFrames[from] = (M.skeletonFrames[from] ?? 0) + 1;
  M.lastScore[from] = race.rivals.score(from) ?? -1;
}
race.on('video', (s) => {
  M.videoLog.push({ seat: s.seat, state: s.state, reason: s.reason, attempts: s.attempts, at: Math.round(clock() - lm.m.t0) });
  log(`video ${s.seat} ${s.state}${s.reason ? ' ' + s.reason : ''} attempts ${s.attempts}`);
  renderTiles();
});
race.on('lobby', renderTiles);
setInterval(renderTiles, 250);

race.on('track', (d) => {
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

interface Game { id: string; resolvedUpTo: number; rng: () => number; zeroSeen: boolean }
let game: Game | null = null;

function mulberry(a: number): () => number {
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// 'start' fires for a new match and when this page rejoins a running one (`reported` then holds what the Room already has)
race.on('start', (d) => {
  const rng = mulberry([...pid].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) ^ d.match.seed);
  game = { id: d.match.id, resolvedUpTo: race.time(), rng, zeroSeen: false };     // what passed while this page was away is not played
  M.seeds.push(d.match.seed);
  M.courseLen = d.course.length;
  log(`match ${d.match.id.slice(0, 8)} seed ${d.match.seed} obstacles ${d.course.length} restored ${race.reported.size}`);
});
race.on('finished', (d) => {
  M.ends.push(Date.now() - Math.max(0, race.time() - d.match.duration));
  if (M.endDateNow === undefined) M.endDateNow = M.ends[0] as number;
  log('local end, final sent');
});
race.on('result', (r) => {
  M.peersBroken = lm.peersBroken;
  // every seat's run as a recording: what the Room scored is what the recording scores (private rooms; a public room sends none)
  for (const seat of Object.keys(r.result.scores)) {
    const run = race.runOf(seat);
    const back = run ? decodeRun(encodeRun(run)) : null;
    M.runChecks.push({ mid: r.result.mid, seat, has: !!run, score: run ? runScore(run).score : null, roomScore: r.result.scores[seat]?.score ?? null, code: !!back && back.outcomes === run?.outcomes });
  }
  const local = game && game.id === r.result.mid ? race.score() : null;
  M.results.push(r.result); M.localScores.push(local);
  const pm = performance as unknown as { memory?: { usedJSHeapSize: number } };
  if (pm.memory) M.heap.push(Math.round(pm.memory.usedJSHeapSize / 1024));
  M.pcs = lm.peerLinks.size; M.videos = document.querySelectorAll('video').length;
  log('result ' + JSON.stringify(r.result));
  if (M.results.length < matches) { setTimeout(() => race.rematch(), 1500); return; }      // rematch
  void lm.stats().then((s) => { M.finalStats = s; M.done = true; });
});

/** A body that moves, the way pose inference would give it: 33 landmarks of the camera picture. */
const fakeBody = (mt: number): Landmark[] => Array.from({ length: 33 }, (_, i) => ({ x: 0.5 + 0.2 * Math.sin(mt / 300 + i * 0.4), y: 0.08 + 0.84 * (i / 33) + 0.03 * Math.cos(mt / 280 + i), z: 0, visibility: 1 }));

let lastState = 0;
setInterval(() => {
  if (race.state === 'closed' || !game || !lm.match || lm.match.id !== game.id || lm.match.phase === 'over' || !lm.playing) return;
  const mt = race.time();
  const ph = lm.match.phase;
  const raw = race.rawMatchTime();
  if (ph === 'running' && raw >= 0 && !game.zeroSeen) {
    game.zeroSeen = true;
    // match time zero on the wall clock; only a page that saw zero live can measure the start skew
    if (M.startWall === null) { M.startWall = clock(); if (raw < 500) M.zeroDateNow = Date.now() - raw; }
    log('match time zero');
  }
  if (ph === 'running' && race.countdownMs() === 0) {
    for (const o of race.course) {
      if (o.t <= game.resolvedUpTo || o.t > mt || race.reported.has(o.id)) continue;
      race.report(o.id, game.rng() < skill ? 'pass' : 'hit');
      M.events++;
    }
    game.resolvedUpTo = Math.max(game.resolvedUpTo, mt);
  }
  if (clock() - lastState > 66) {                    // about 15 Hz: ghost and live score
    lastState = clock();
    race.sendPose(fakeBody(mt));
  }
  (document.getElementById('hud') as HTMLElement).textContent = `${race.state} t=${(mt / 1000).toFixed(1)} score=${race.score().score}`;
}, 50);
