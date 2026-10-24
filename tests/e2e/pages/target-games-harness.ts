// Browser side of tests/e2e/target-games.spec.ts: one of the three mirror games on the real 2D kit, the real HUD (PlayHud on
// the web shell's stylesheet), the real sound kit, a camera stand-in (a canvas with a stick figure that follows the virtual
// player) and a virtual player steered through the real handHit detector. Nothing here asserts; the spec does.
//
// The wiring is what the shell has to do for a mirror game, written out once so it is tested:
//   kit -> ctx.scene2d; hud.onLayout -> kit.setHud / kit.setHudDuo; the camera element -> setMirrorVideo(kit, el);
//   module.strings -> i18n.extend('game.<id>', strings); module.controls.keys -> the input hub.
import { createAudio, type AudioKit } from '../../../packages/core/audio/index.ts';
import { createInputHub } from '../../../packages/core/input/hub.ts';
import { rngStream } from '../../../packages/core/loop/rng.ts';
import { makeProjector, bodyToView } from '../../../packages/core/render2d/view.ts';
import { createScene2D, type Scene2DKit } from '../../../packages/core/render2d/scene2d.ts';
import { profileOf, SHAPE_UPPER } from '../../../packages/core/moves/testing/rig.ts';
import { PlayHud, type HudLayoutInfo } from '../../../packages/core/ui/hud/hud.ts';
import { createI18n, type I18n, type Lang } from '../../../packages/core/ui/i18n/index.ts';
import type { MeasuredDuo, MeasuredHud } from '../../../packages/core/ui/layout.ts';
import { FIXED_DT, LANDMARK_COUNT, LM } from '../../../packages/core/types/index.ts';
import type { BodyProfile, Game, GameContext, GameModule, InputFrame, Landmark, PoseFrame, Rng, Vec2 } from '../../../packages/core/types/index.ts';
import { padWorkModule } from '../../../packages/games/pad-work/index.ts';
import { reactionTagModule } from '../../../packages/games/reaction-tag/index.ts';
import { starCatchModule } from '../../../packages/games/star-catch/index.ts';
import type { TargetGame } from '../../../packages/games/target/game.ts';
import type { PadSpec } from '../../../packages/games/target/pad-work.ts';
import { frame2, frameOf, VirtualBody } from '../../../packages/games/target/testing/body.ts';
import { Chaser, PadChaser, type PadSeen } from '../../../packages/games/target/testing/bots.ts';
import { seenOf } from '../../../packages/games/target/testing/play.ts';
import type { BaseSpec, ViewLane } from '../../../packages/games/target/types.ts';
import { setMirrorVideo } from '../../../packages/games/target/video.ts';

export type GameId = 'star-catch' | 'pad-work' | 'reaction-tag';
export type BotMode = 'perfect' | 'sloppy' | 'idle';

export interface StartArgs {
  game: GameId;
  players?: 1 | 2;
  seated?: boolean;
  /** No camera: the arrow keys and W A S D steer two cursors through the real input hub. */
  keyboard?: boolean;
  bot?: BotMode;
  level?: 'easy' | 'normal' | 'hard' | 'expert';
  seed?: number;
  /** A shorter run than the manifest's (seconds) and its rounds. */
  seconds?: number;
  rounds?: number;
  lang?: Lang;
  /** Camera aspect (width / height) of the stand-in picture; upright on a portrait screen, 4:3 otherwise. */
  aspect?: number;
  /** Mirror games play with the picture; false leaves it out (the stage and the hands only). */
  picture?: boolean;
  reducedMotion?: boolean;
  /** Simulation seconds per real second (default 1, at most 8), so a long run is a short test. */
  speed?: number;
}

interface Running {
  args: Required<Pick<StartArgs, 'game' | 'players' | 'seated' | 'keyboard' | 'bot'>>;
  game: Game & { engine?: TargetGame<BaseSpec>['engine'] };
  kit: Scene2DKit;
  hud: PlayHud;
  audio: AudioKit;
  i18n: I18n;
  canvas: HTMLCanvasElement;
  cam: HTMLCanvasElement;
  bodies: VirtualBody[];
  bots: ((lane: ViewLane, body: VirtualBody, t: number) => void)[];
  hub: ReturnType<typeof createInputHub> | null;
  offKeys: (() => void) | null;
  frames: ((f: PoseFrame) => void)[];
  raf: number;
  last: number;
  acc: number;
  k: number;
  rendered: number;
  phase: string;
  announced: string[];
  toasts: string[];
  layouts: number;
  errors: string[];
  observer: ResizeObserver;
  cues: Record<string, number>;
  aspect: number;
  speed: number;
  geo: { checked: number; violations: string[] };
}

let run: Running | null = null;

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T;

function modules(game: GameId, seconds: number | undefined, rounds: number | undefined): GameModule {
  const opts = { ...(rounds !== undefined ? { rounds } : {}), ...(rounds !== undefined && rounds <= 1 ? {} : { restSec: 4 }) };
  const build = game === 'star-catch' ? starCatchModule : game === 'pad-work' ? padWorkModule : reactionTagModule;
  const base = build();
  return build(seconds !== undefined ? { ...base.manifest, durationSec: seconds } : base.manifest, opts);
}

// ───────── the camera stand-in ─────────

/** A body-space point of one virtual player as a fraction of the raw picture (x from the left of the unmirrored image). */
function rawOf(b: VirtualBody, p: Vec2, aspect: number, out: Vec2): Vec2 {
  const v = bodyToView(p, b.profile, { x: 0, y: 0 });
  out.x = 1 - v.x / aspect;
  out.y = v.y;
  return out;
}

function landmarksOf(b: VirtualBody, aspect: number): Landmark[] {
  const lm: Landmark[] = Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }));
  const put = (i: number, x: number, y: number): void => {
    const o = { x: 0, y: 0 };
    rawOf(b, { x, y }, aspect, o);
    lm[i] = { x: o.x, y: o.y, z: 0, visibility: 1 };
  };
  const s = b.shift, d = b.drop;
  put(LM.nose, s, 1.45 - d);
  put(LM.leftShoulder, s - 0.4, 1 - d); put(LM.rightShoulder, s + 0.4, 1 - d);
  put(LM.leftElbow, s - 0.5, 0.6 - d); put(LM.rightElbow, s + 0.5, 0.6 - d);
  put(LM.leftWrist, b.hand.L.x, b.hand.L.y); put(LM.rightWrist, b.hand.R.x, b.hand.R.y);
  put(LM.leftHip, s - 0.25, -d); put(LM.rightHip, s + 0.25, -d);
  put(LM.leftKnee, s - 0.25, -0.9); put(LM.rightKnee, s + 0.25, -0.9);
  put(LM.leftAnkle, b.foot.L, -1.8); put(LM.rightAnkle, b.foot.R, -1.8);
  return lm;
}

function paintCamera(cam: HTMLCanvasElement, bodies: VirtualBody[], aspect: number, tMs: number): void {
  const c = cam.getContext('2d') as CanvasRenderingContext2D;
  const W = cam.width, H = cam.height;
  const g = c.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#3b3a52'); g.addColorStop(1, '#1f2a3a');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  c.fillStyle = 'rgba(255,255,255,0.05)';
  for (let i = 0; i < 6; i++) c.fillRect(((i * 97 + tMs / 40) % (W + 80)) - 40, H * 0.72, 40, H * 0.28);
  for (const b of bodies) {
    const lm = landmarksOf(b, aspect);
    const px = (i: number): [number, number] => [lm[i]!.x * W, lm[i]!.y * H];
    const line = (a: number, z: number, w: number, col: string): void => {
      c.strokeStyle = col; c.lineWidth = w; c.lineCap = 'round';
      c.beginPath(); c.moveTo(...px(a)); c.lineTo(...px(z)); c.stroke();
    };
    const t = b.profile.T * H;
    line(LM.leftShoulder, LM.rightShoulder, t * 0.3, '#caa38a');
    line(LM.leftShoulder, LM.leftHip, t * 0.34, '#6d83c9'); line(LM.rightShoulder, LM.rightHip, t * 0.34, '#6d83c9');
    line(LM.leftHip, LM.rightHip, t * 0.34, '#6d83c9');
    line(LM.leftShoulder, LM.leftElbow, t * 0.16, '#caa38a'); line(LM.leftElbow, LM.leftWrist, t * 0.14, '#caa38a');
    line(LM.rightShoulder, LM.rightElbow, t * 0.16, '#caa38a'); line(LM.rightElbow, LM.rightWrist, t * 0.14, '#caa38a');
    line(LM.leftHip, LM.leftKnee, t * 0.22, '#3d4466'); line(LM.rightHip, LM.rightKnee, t * 0.22, '#3d4466');
    c.fillStyle = '#d9b49a';
    const [hx, hy] = px(LM.nose);
    c.beginPath(); c.arc(hx, hy, t * 0.26, 0, Math.PI * 2); c.fill();
  }
}

function poseFrame(r: Running): PoseFrame {
  const poses = r.bodies.map((b) => landmarksOf(b, r.aspect));
  return { seq: r.k, t: r.k * 1000 / 60, landmarks: poses[0] as Landmark[], inferenceMs: 8, source: 'test', aspect: r.aspect, ...(poses.length > 1 ? { poses } : {}) };
}

// ───────── steering ─────────

function steerOf(game: GameId, mode: BotMode, seed: number): (lane: ViewLane, body: VirtualBody, t: number) => void {
  if (game === 'pad-work') {
    const bot = new PadChaser(mode, seed);
    return (lane, body, t) => bot.steer(body, lane.targets.map((tg): PadSeen => {
      const s = tg.spec as PadSpec;
      return { id: tg.id, x: tg.x, y: tg.y, beat: s.beat, hand: s.hand ?? 'L', ...(s.kind === 'bag' && s.need ? { bag: s.need } : {}), from: s.from, until: s.until };
    }), t);
  }
  const bot = new Chaser(mode === 'idle' ? 'idle' : mode, seed);
  return (lane, body) => bot.steer(body, seenOf(lane));
}

// ───────── the HUD and the kit follow each other ─────────

const size = (r: { w: number; h: number }): { w: number; h: number } => ({ w: r.w, h: r.h });

function onLayout(r: Running, info: HudLayoutInfo): void {
  r.layouts++;
  if (info.duo && info.twoPlayers) {
    const d = info.twoPlayers.rects;
    const m: MeasuredDuo = { statusP1: size(d.statusP1), statusP2: size(d.statusP2), timer: size(d.timer), command: size(d.command) };
    if (d.reasonP1) m.reasonP1 = size(d.reasonP1);
    if (d.reasonP2) m.reasonP2 = size(d.reasonP2);
    r.kit.setHudDuo(m);
  } else if (info.solo) {
    const s = info.solo.rects;
    const m: MeasuredHud = { statusLeft: size(s.statusLeft), statusRight: size(s.statusRight), command: size(s.command), reason: size(s.reason) };
    r.kit.setHud({ mode: 'mirror', pipCorner: 'hidden', measured: m });
  }
}


// ───────── every target inside the picture and clear of every plate, checked while the game runs ─────────

interface Box { x: number; y: number; w: number; h: number }
const boxOf = (e: Element): Box => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; };

function plateBoxes(): Record<string, Box> {
  const plates: Record<string, Box> = {};
  for (const n of document.querySelectorAll('.ba-hud [data-hud]')) {
    const el = n as HTMLElement;
    if (el.hidden || getComputedStyle(el).display === 'none') continue;
    plates[el.getAttribute('data-hud') as string] = boxOf(el);
  }
  return plates;
}

interface Seen { lane: number; x: number; y: number; r: number; kind: string }

function targetsOf(r: Running): Seen[] {
  const e = r.game.engine;
  if (!e) return [];
  const v = e.view();
  const out = { x: 0, y: 0 };
  const list: Seen[] = [];
  v.lanes.forEach((l, i) => {
    const pr = makeProjector(l.profile, r.kit.rects.mirror, l.profile.aspect);
    for (const t of l.targets) {
      pr.into({ x: t.x, y: t.y }, out);
      list.push({ lane: i + 1, x: out.x, y: out.y, r: t.r * l.profile.T * r.kit.rects.mirror.h, kind: (t.spec as PadSpec).kind ?? 'target' });
    }
  });
  return list;
}

function checkGeometry(r: Running): void {
  const m = r.kit.rects.mirror;
  const plates = plateBoxes();
  const t = r.game.engine?.view().t ?? 0;
  const bad = (what: string): void => { if (r.geo.violations.length < 20) r.geo.violations.push(`${what} at ${Math.round(t)} ms`); };
  for (const s of targetsOf(r)) {
    if (s.kind === 'bag') continue;
    r.geo.checked++;
    if (s.x - s.r < m.x - 1 || s.x + s.r > m.x + m.w + 1 || s.y - s.r < m.y - 1 || s.y + s.r > m.y + m.h + 1) bad(`lane ${s.lane} target outside the picture (${Math.round(s.x)}, ${Math.round(s.y)} r ${Math.round(s.r)})`);
    for (const [name, p] of Object.entries(plates)) {
      if (name === 'pip') continue;
      if (s.x + s.r > p.x && s.x - s.r < p.x + p.w && s.y + s.r > p.y && s.y - s.r < p.y + p.h) bad(`lane ${s.lane} target under ${name}`);
    }
  }
}

// ───────── the loop ─────────

function frame(r: Running, now: number): void {
  const dt = Math.min(100, now - r.last);
  r.last = now;
  r.acc += dt * r.speed;
  let steps = 0;
  while (r.acc >= 1000 / 60 && steps < 8) {
    r.acc -= 1000 / 60;
    steps++;
    r.k++;
    const engine = r.game.engine;
    const lanes = engine ? engine.view().lanes : [];
    let input: InputFrame;
    if (r.args.keyboard && r.hub) input = r.hub.sample(r.k * 1000 / 60);
    else {
      const ch = r.bodies.map((b, i) => {
        const lane = lanes[i];
        if (lane) r.bots[i]!(lane, b, engine ? engine.view().t : 0);
        return b.step(r.k);
      });
      input = r.args.players === 2 ? frame2(r.k, ch[0]!, ch[1]!) : frameOf(r.k, ch[0]!);
    }
    const out = r.game.step(FIXED_DT, input);
    r.phase = out.phase;
    if (out.phase !== 'running') break;
  }
  if (!r.args.keyboard) {
    paintCamera(r.cam, r.bodies, r.aspect, r.k * 1000 / 60);
    if (steps > 0) for (const cb of r.frames) cb(poseFrame(r));
  }
  r.game.render(Math.min(1, r.acc / (1000 / 60)));
  r.rendered++;
  if (r.rendered % 3 === 0) checkGeometry(r);
  if (r.phase === 'running') r.raf = requestAnimationFrame((t) => frame(r, t));
}

// ───────── what the spec calls ─────────

export async function start(a: StartArgs): Promise<void> {
  void stop();
  const args = { game: a.game, players: a.players ?? 1, seated: a.seated ?? false, keyboard: a.keyboard ?? false, bot: a.bot ?? 'perfect' } as const;
  const lang = a.lang ?? 'en';
  // a phone held upright gives an upright picture, anything wider a landscape one
  const aspect = a.aspect ?? (window.innerHeight > window.innerWidth ? 3 / 4 : 4 / 3);
  const seed = a.seed ?? 5;
  const errors: string[] = [];
  const scene = $('[data-scene]');
  const canvas = document.createElement('canvas');
  canvas.className = 'ba-scene-canvas';
  scene.append(canvas);
  const kit = createScene2D({ canvas, rng: rngStream(seed, 'fx'), reducedMotion: a.reducedMotion ?? false });
  const observer = new ResizeObserver(() => kit.resize());
  observer.observe(scene);

  const mod = modules(a.game, a.seconds, a.rounds);
  const i18n = createI18n(lang);
  i18n.extend(`game.${a.game}`, (mod as unknown as { strings: Parameters<I18n['extend']>[1] }).strings);

  const audio = createAudio();
  audio.unlock();
  const announced: string[] = [], toasts: string[] = [];
  const cam = document.createElement('canvas');
  cam.width = Math.round(480 * aspect); cam.height = 480;
  if (a.picture !== false && !args.keyboard) setMirrorVideo(kit, cam);

  const mk = (cx: number): BodyProfile => profileOf({ ...SHAPE_UPPER, aspect, cx }, 'upper');
  const profiles = args.players === 2 ? [mk(0.7), mk(0.3)] : [mk(0.5)];
  const bodies = profiles.map((p, i) => new VirtualBody({ profile: p, clockOffset: 5000 + 2000 * i }));
  const bots = bodies.map((_, i) => steerOf(a.game, args.bot, seed + i));

  const r = { args, kit, audio, i18n, canvas, cam, bodies, bots, hub: null, offKeys: null, frames: [], raf: 0, last: performance.now(), acc: 0, k: 0, rendered: 0, phase: 'running', announced, toasts, layouts: 0, errors, observer, cues: {}, geo: { checked: 0, violations: [] }, aspect, speed: Math.min(8, Math.max(0.25, a.speed ?? 1)) } as unknown as Running;
  // count what the game asks the sound kit to play, and let the kit do it
  const realPlay = audio.play.bind(audio);
  (audio as { play: (n: string) => void }).play = (n: string) => { r.cues[n] = (r.cues[n] ?? 0) + 1; realPlay(n); };

  r.hud = new PlayHud({
    document, root: $('[data-hud-root]'), cameraHost: $('[data-camera-host]'), i18n, mode: 'mirror', pipCorner: 'hidden', duo: args.players === 2,
    announce: (t) => { announced.push(t); }, toast: (t) => { toasts.push(t); }, onPause: () => undefined, onMovePip: () => undefined,
    onLayout: (info) => onLayout(r, info),
  });
  r.hud.setPhase('play');
  r.hud.relayout();

  if (args.keyboard) {
    r.hub = createInputHub({ players: 1 });
    r.hub.allow(['keyboard']);
    r.offKeys = r.hub.bindKeyboard(mod.controls?.keys ?? {});
  }

  const ctx: GameContext = {
    pose: { onFrame: (cb: (f: PoseFrame) => void) => { r.frames.push(cb); return () => { r.frames.splice(r.frames.indexOf(cb), 1); }; } } as unknown as GameContext['pose'],
    input: (r.hub ?? {}) as GameContext['input'],
    hud: r.hud, audio,
    store: { get: <T>(_k: string, _s: unknown, f: T) => f, set() {}, remove() {} } as unknown as GameContext['store'],
    scene2d: kit,
    rng: ((streams: Map<string, Rng>) => (name: 'course' | 'fx') => { let s = streams.get(name); if (!s) { s = rngStream(seed, name); streams.set(name, s); } return s; })(new Map()),
    flags: { reducedMotion: a.reducedMotion ?? false, silent: false, seated: args.seated },
    t: i18n.scoped(`game.${a.game}`),
  };
  const game = mod.create() as Running['game'];
  r.game = game;
  await game.init(ctx);
  game.start({
    seed, difficulty: a.level ?? 'normal', seated: args.seated, mode: args.players === 2 ? 'local2' : 'solo',
    profile: args.keyboard ? null : profiles[0] as BodyProfile,
    ...(args.players === 2 ? { profiles: { 1: profiles[0] as BodyProfile, 2: profiles[1] as BodyProfile } } : {}),
  });
  run = r;
  r.last = performance.now();
  r.raf = requestAnimationFrame((t) => frame(r, t));
}

export function stop(): { canvases: number; surfaces: number; particles: number } | null {
  const r = run;
  if (!r) return null;
  cancelAnimationFrame(r.raf);
  r.offKeys?.();
  r.hub?.dispose();
  r.observer.disconnect();
  r.game.dispose();
  setMirrorVideo(r.kit, null);
  r.hud.dispose();
  r.kit.dispose();
  void r.audio.dispose();
  r.canvas.remove();
  run = null;
  return { canvases: document.querySelectorAll('canvas').length, surfaces: r.kit.stats().surfaces, particles: r.kit.particles.alive };
}

/** The colour of one canvas pixel (CSS pixel coordinates), read back from the kit's own canvas. */
export function pixel(x: number, y: number): { r: number; g: number; b: number } | null {
  const r = run;
  if (!r) return null;
  const k = r.kit.stats().ratio;
  const d = (r.canvas.getContext('2d') as CanvasRenderingContext2D).getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data;
  return { r: d[0] as number, g: d[1] as number, b: d[2] as number };
}

export interface HarnessState {
  running: boolean;
  phase: string;
  t: number;
  steps: number;
  rendered: number;
  lanes: { score: number; hits: number; misses: number; streak: number; hands: Record<'L' | 'R', { x: number; y: number; seen: boolean }>; targets: { x: number; y: number; r: number; kind: string }[] }[];
  mirror: Box;
  play: Box;
  plates: Record<string, Box>;
  hudProblems: string[];
  hudText: Record<string, string>;
  layouts: number;
  announced: string[];
  cues: Record<string, number>;
  audio: { state: string; played: number; unknown: number };
  canvas: { width: number; height: number; css: { w: number; h: number } };
  sprites: { entries: number; misses: number };
  particles: number;
  summary: { score: number; hits?: number; metSeconds: number } | null;
  hasPicture: boolean;
  geometry: { checked: number; violations: string[] };
}

export function state(): HarnessState | null {
  const r = run;
  if (!r) return null;
  const e = r.game.engine;
  const v = e ? e.view() : null;
  const kit = r.kit;
  const prs = v ? v.lanes.map((l) => makeProjector(l.profile, kit.rects.mirror, l.profile.aspect)) : [];
  const out = { x: 0, y: 0 };
  const plates = plateBoxes();
  const text: Record<string, string> = {};
  for (const n of document.querySelectorAll('.ba-hud [data-hud]')) text[(n as HTMLElement).getAttribute('data-hud') as string] = (n.textContent ?? '').trim();
  const sp = kit.sprites.stats();
  return {
    running: r.phase === 'running',
    phase: r.phase,
    t: v?.t ?? 0,
    steps: r.k,
    rendered: r.rendered,
    lanes: v ? v.lanes.map((l, i) => ({
      score: l.score,
      hits: e!.lane((i + 1) as 1 | 2)?.state.stats.hits ?? 0,
      misses: e!.lane((i + 1) as 1 | 2)?.state.stats.misses ?? 0,
      streak: e!.lane((i + 1) as 1 | 2)?.state.stats.streak ?? 0,
      hands: { L: { x: l.hands.L.x, y: l.hands.L.y, seen: l.hands.L.seen }, R: { x: l.hands.R.x, y: l.hands.R.y, seen: l.hands.R.seen } },
      targets: l.targets.map((t) => {
        prs[i]!.into({ x: t.x, y: t.y }, out);
        return { x: out.x, y: out.y, r: t.r * l.profile.T * kit.rects.mirror.h, kind: (t.spec as PadSpec).kind ?? 'target' };
      }),
    })) : [],
    mirror: { ...kit.rects.mirror },
    play: { ...kit.rects.play },
    plates,
    hudProblems: r.hud.problems(),
    hudText: text,
    layouts: r.layouts,
    announced: [...r.announced],
    cues: { ...r.cues },
    audio: { state: r.audio.state, played: r.audio.stats().played, unknown: r.audio.stats().skipped.unknown },
    canvas: { width: r.canvas.width, height: r.canvas.height, css: { w: r.canvas.clientWidth, h: r.canvas.clientHeight } },
    sprites: { entries: sp.entries, misses: sp.misses },
    particles: kit.particles.alive,
    summary: r.phase !== 'running' ? (() => { const s = r.game.summary(); return { score: s.score, ...(s.hits !== undefined ? { hits: s.hits } : {}), metSeconds: s.metSeconds }; })() : null,
    hasPicture: !r.args.keyboard,
    geometry: { checked: r.geo.checked, violations: [...r.geo.violations] },
  };
}

/** A key held or released as the real keyboard would (the hub listens on the document). */
export function key(k: string, down: boolean): void {
  document.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { key: k, bubbles: true }));
}

/** Moves the virtual hands by hand (a test that wants a particular touch). */
export function aim(player: 1 | 2, hand: 'L' | 'R', x: number, y: number, speed = 6): void {
  run?.bodies[player - 1]?.aim(hand, x, y, speed);
}
