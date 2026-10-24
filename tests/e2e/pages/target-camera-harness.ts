// Browser side of tests/e2e/target-camera.spec.ts: Star Catch, Pad Work and Reaction Tag through the REAL session, the real
// camera service (Chromium's fake device playing a recorded person), the real pose model, the real hand detector, the real
// HUD, the real 2D kit and the real sound kit. Nothing is steered: the person in the clip stands where they stand, so the
// run shows that every part of the chain is connected, and the hands the game draws land on the hands in the picture.
//
// The wiring here is what the shell's session factory does for a mirror game, written once so it is tested:
//   kit -> ui().scene2d; hud.onLayout -> kit.setHud / setHudDuo (feedKit); session 'video' -> setMirrorVideo + the HUD's self
//   view host; session 'player' -> hud.setAway; module.strings -> i18n.extend('game.<id>', strings).
import { createAudio, type AudioKit } from '../../../packages/core/audio/index.ts';
import { browserServices, createBrowserSession } from '../../../packages/core/loop/browser.ts';
import { rngStream } from '../../../packages/core/loop/rng.ts';
import { makeProjector } from '../../../packages/core/render2d/view.ts';
import { createScene2D, type Scene2DKit } from '../../../packages/core/render2d/scene2d.ts';
import { PlayHud } from '../../../packages/core/ui/hud/hud.ts';
import { createI18n, type I18n, type Lang } from '../../../packages/core/ui/i18n/index.ts';
import type { Game, GameModule, PoseFrame, RunSummary, Session, SessionEvents } from '../../../packages/core/types/index.ts';
import { padWorkModule } from '../../../packages/games/pad-work/index.ts';
import { reactionTagModule } from '../../../packages/games/reaction-tag/index.ts';
import { starCatchModule } from '../../../packages/games/star-catch/index.ts';
import type { TargetGame } from '../../../packages/games/target/game.ts';
import type { BaseSpec } from '../../../packages/games/target/types.ts';
import { setMirrorVideo } from '../../../packages/games/target/video.ts';
import { checkTargets, feedKit, plateBoxes, type Box, type Geo } from './target-games-harness.ts';

export type GameId = 'star-catch' | 'pad-work' | 'reaction-tag';

export interface BeginArgs {
  game: GameId;
  players?: 1 | 2;
  seated?: boolean;
  level?: 'easy' | 'normal' | 'hard' | 'expert';
  /** A shorter run than the manifest's (seconds), in one round. */
  seconds?: number;
  lang?: Lang;
  /** Quiet mode: no stamping, no floor lights. */
  silent?: boolean;
}

interface Run {
  game: GameId;
  players: 1 | 2;
  session: Session;
  kit: Scene2DKit;
  hud: PlayHud;
  audio: AudioKit;
  canvas: HTMLCanvasElement;
  instance: (Game & { engine?: TargetGame<BaseSpec>['engine'] }) | null;
  offs: (() => void)[];
  states: string[];
  pauses: string[];
  errors: { code: string; message: string }[];
  players_: { player: number; present: boolean }[];
  over: RunSummary | null;
  video: HTMLVideoElement | null;
  calibrations: number;
  countdown: number[];
  lastPose: PoseFrame | null;
  announced: string[];
  reasons: Set<string>;
  geo: Geo;
  raf: number;
  frames: number;
  observer: ResizeObserver;
  cues: Record<string, number>;
}

let run: Run | null = null;

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T;

function moduleOf(game: GameId, seconds: number | undefined): GameModule {
  const build = game === 'star-catch' ? starCatchModule : game === 'pad-work' ? padWorkModule : reactionTagModule;
  const base = build();
  return build(seconds !== undefined ? { ...base.manifest, durationSec: seconds } : base.manifest, { rounds: 1 });
}

export async function begin(a: BeginArgs): Promise<void> {
  await quit();
  const players = a.players ?? 1;
  const canvas = document.createElement('canvas');
  canvas.className = 'ba-scene-canvas';
  $('[data-scene]').append(canvas);
  const kit = createScene2D({ canvas, rng: rngStream(7, 'fx'), reducedMotion: false });
  const observer = new ResizeObserver(() => kit.resize());
  observer.observe($('[data-scene]'));

  const base = moduleOf(a.game, a.seconds);
  let captured: Run['instance'] = null;
  const mod: GameModule = { ...base, create: () => { const g = base.create() as NonNullable<Run['instance']>; captured = g; return g; } };
  const i18n: I18n = createI18n(a.lang ?? 'en');
  i18n.extend(`game.${a.game}`, (base as unknown as { strings: Parameters<I18n['extend']>[1] }).strings);

  const audio = createAudio();
  audio.unlock();
  const cues: Record<string, number> = {};
  const realPlay = audio.play.bind(audio);
  (audio as { play: (n: string) => void }).play = (n: string) => { cues[n] = (cues[n] ?? 0) + 1; realPlay(n); };
  const announced: string[] = [];

  const hud = new PlayHud({
    document, root: $('[data-hud-root]'), cameraHost: $('[data-camera-host]'), i18n, mode: 'mirror', pipCorner: 'bottom-right', duo: players === 2,
    announce: (t) => { announced.push(t); }, toast: () => undefined, onPause: () => undefined, onMovePip: () => undefined,
    onLayout: (info) => feedKit(kit, info),
  });
  hud.setPhase('calibrate');

  const session = createBrowserSession({
    games: () => mod,
    ui: (m) => ({
      hud, audio, store: { get: <T,>(_k: string, _s: unknown, f: T) => f, set() {}, remove() {} } as never, scene2d: kit, t: i18n.scoped(`game.${m.id}`),
    }),
    countdownMs: 1000,
    seed: () => 7,
    flags: () => ({ reducedMotion: false, silent: a.silent ?? false }),
  });

  const r: Run = {
    game: a.game, players, session, kit, hud, audio, canvas, instance: null, offs: [], states: [], pauses: [], errors: [], players_: [], over: null,
    video: null, calibrations: 0, countdown: [], lastPose: null, announced, reasons: new Set(), geo: { checked: 0, violations: [] }, raf: 0, frames: 0,
    observer, cues,
  };
  run = r;

  const on = <K extends keyof SessionEvents>(k: K, cb: (e: SessionEvents[K]) => void): void => { r.offs.push(session.on(k, cb)); };
  on('state', (s) => {
    r.states.push(s);
    r.instance = captured;
    if (s === 'idle' || s === 'setup' || s === 'calibrating') hud.setPhase('calibrate');
    else if (s === 'countdown' || s === 'running') hud.setPhase('play');
    if (s === 'running') hud.setAway(null);
  });
  on('pause', (p) => { r.pauses.push(p); });
  on('error', (e) => { r.errors.push({ code: e.code, message: e.message }); });
  on('over', (s) => { r.over = s; });
  on('player', (p) => { r.players_.push(p); hud.setAway(p.present ? null : p.player); });
  on('calibration', () => { r.calibrations++; });
  on('countdown', (c) => { r.countdown.push(c.remaining); });
  on('video', ({ el }) => {
    r.video = el;
    setMirrorVideo(kit, el);
    if (el) { el.classList.add('ba-selfview'); el.setAttribute('aria-hidden', 'true'); hud.pipHost.replaceChildren(el); } else hud.pipHost.replaceChildren();
  });
  r.offs.push(browserServices().pose.onFrame((f) => { r.lastPose = f; }));

  // what the player would see, sampled while the round runs: the geometry of every target and every sentence of the reason strip
  const tick = (): void => {
    r.raf = requestAnimationFrame(tick);
    r.frames++;
    if (session.state !== 'running') return;
    r.instance = captured;
    if (r.frames % 3 === 0) checkTargets(kit, r.instance?.engine ?? null, r.geo);
    for (const n of document.querySelectorAll('.ba-hud [data-hud^="reason"]')) {
      const t = (n.textContent ?? '').trim();
      if (t) r.reasons.add(t);
    }
  };
  r.raf = requestAnimationFrame(tick);

  await session.start(a.game, { mode: players === 2 ? 'local2' : 'solo', difficulty: a.level ?? 'normal', input: 'camera', seated: a.seated ?? false });
}

export interface CamState {
  state: string;
  pauseReason: string | null;
  states: string[];
  pauses: string[];
  errors: { code: string; message: string }[];
  players: { player: number; present: boolean }[];
  over: { score: number; hits: number; seconds: number; metSeconds: number; log: number; misses: number; reasons: string[] } | null;
  calibrations: number;
  countdown: number[];
  cameraLive: number;
  video: { w: number; h: number; ready: number; inPip: boolean } | null;
  game: {
    t: number;
    phase: string;
    lanes: {
      score: number; hits: number; misses: number; aspect: number; torso: number;
      hands: Record<'L' | 'R', { x: number; y: number; seen: boolean; px: { x: number; y: number } | null; wrist: { x: number; y: number } | null }>;
      targets: number;
    }[];
  } | null;
  mirror: Box;
  hudProblems: string[];
  hudText: Record<string, string>;
  reasons: string[];
  announced: string[];
  geometry: Geo;
  cues: Record<string, number>;
  audio: { unknown: number };
  canvases: number;
  frames: number;
}

export function snap(): CamState | null {
  const r = run;
  if (!r) return null;
  const e = (r.instance ?? null)?.engine ?? null;
  const view = e ? e.view() : null;
  const m = r.kit.rects.mirror;
  const out = { x: 0, y: 0 };
  const text: Record<string, string> = {};
  for (const n of document.querySelectorAll('.ba-hud [data-hud]')) text[(n as HTMLElement).getAttribute('data-hud') as string] = (n.textContent ?? '').trim();
  const pose = r.lastPose;
  const wristOf = (lane: number, side: 'L' | 'R'): { x: number; y: number } | null => {
    // the raw picture is not mirrored; the mirror view is: a wrist at raw x shows at 1 - x of the mirror's width
    const all = pose ? (pose.poses && pose.poses.length > 0 ? pose.poses : [pose.landmarks]) : [];
    const hipX = (l: { x: number }[]): number => ((l[23]?.x ?? 0.5) + (l[24]?.x ?? 0.5)) / 2;
    const sorted = [...all].filter((l) => !!l).sort((a, b) => hipX(b as { x: number }[]) - hipX(a as { x: number }[]));
    const lm = (r.players === 1 ? all[0] : sorted[lane]) as { x: number; y: number; visibility?: number }[] | undefined;
    const w = lm?.[side === 'L' ? 15 : 16];
    if (!w || (w.visibility ?? 1) < 0.5) return null;
    return { x: m.x + (1 - w.x) * m.w, y: m.y + w.y * m.h };
  };
  const vid = r.video;
  return {
    state: r.session.state,
    pauseReason: r.session.pauseReason,
    states: [...r.states],
    pauses: [...r.pauses],
    errors: [...r.errors],
    players: [...r.players_],
    over: r.over ? { score: r.over.score, hits: r.over.hits ?? 0, seconds: r.over.seconds, metSeconds: r.over.metSeconds, log: r.over.log.length, misses: r.over.log.filter((l) => !l.ok).length, reasons: [...new Set(r.over.log.filter((l) => !l.ok).map((l) => l.kind))] } : null,
    calibrations: r.calibrations,
    countdown: [...r.countdown],
    cameraLive: browserServices().camera.stats().live,
    video: vid ? { w: vid.videoWidth, h: vid.videoHeight, ready: vid.readyState, inPip: r.hud.pipHost.contains(vid) } : null,
    game: view ? {
      t: view.t,
      phase: view.phase,
      lanes: view.lanes.map((l, i) => {
        const pr = makeProjector(l.profile, m, l.profile.aspect);
        const px = (s: 'L' | 'R'): { x: number; y: number } | null => (l.hands[s].seen ? (pr.into({ x: l.hands[s].x, y: l.hands[s].y }, out), { x: out.x, y: out.y }) : null);
        const lane = e!.lane((i + 1) as 1 | 2);
        return {
          score: l.score, hits: lane?.state.stats.hits ?? 0, misses: lane?.state.stats.misses ?? 0, aspect: l.profile.aspect, torso: l.profile.T,
          hands: {
            L: { x: l.hands.L.x, y: l.hands.L.y, seen: l.hands.L.seen, px: px('L'), wrist: wristOf(i, 'L') },
            R: { x: l.hands.R.x, y: l.hands.R.y, seen: l.hands.R.seen, px: px('R'), wrist: wristOf(i, 'R') },
          },
          targets: l.targets.length,
        };
      }),
    } : null,
    mirror: { ...m },
    hudProblems: r.hud.problems(),
    hudText: text,
    reasons: [...r.reasons],
    announced: [...r.announced],
    geometry: { checked: r.geo.checked, violations: [...r.geo.violations] },
    cues: { ...r.cues },
    audio: { unknown: r.audio.stats().skipped.unknown },
    canvases: document.querySelectorAll('canvas').length,
    frames: r.frames,
  };
}

export function pause(): void { run?.session.pause('user'); }
export async function resume(): Promise<void> { await run?.session.resume(); }
export { plateBoxes };

/** Leaves the run and everything it held: the camera, the sound kit, the HUD and the kit's surfaces. */
export async function quit(): Promise<{ cameraLive: number; canvases: number; surfaces: number } | null> {
  const r = run;
  if (!r) return null;
  run = null;
  cancelAnimationFrame(r.raf);
  r.observer.disconnect();
  r.session.quit();
  for (const off of r.offs) off();
  setMirrorVideo(r.kit, null);
  r.hud.dispose();
  r.kit.dispose();
  const surfaces = r.kit.stats().surfaces;
  await r.audio.dispose();
  r.canvas.remove();
  return { cameraLive: browserServices().camera.stats().live, canvases: document.querySelectorAll('canvas').length, surfaces };
}
