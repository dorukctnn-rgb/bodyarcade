// Browser side of tests/e2e/g3-games.spec.ts: one game of builder G3 on the real stack as far as a page can have it without a
// person: the Session, the pose feed, the movement detectors, the input hub, the 2D scene kit, the shell's own HUD and stylesheet,
// the real audio kit; only the camera and the pose model are replaced by a synthetic body (the movement library's rig) delivered as
// pose frames in real time, and the body looks at the game to know what to do (the next beat, gate or wall). Nothing here asserts;
// the spec does.
//   ?game=firework-jacks|twist-turbine|limbo-bend|pose-wall  &mode=solo|local2  &difficulty=easy  &seated=1  &quiet=1
//   &body=perfect|late|sloppy|idle  &corner=bottom-right  &workS=18  (the length of the one set that is played)
//   &lang=tr|de|es|fr  plays in that language (the shell's words and the game's)
//   &tile=1  keeps the shell's self view tile opaque with a stand-in picture, so a screenshot shows the layout as the player sees it
import '../../../packages/web/src/styles/app.css';
import { createAudio } from '../../../packages/core/audio/audio.ts';
import { SFX_NAMES } from '../../../packages/core/audio/sfx.ts';
import { rngStream } from '../../../packages/core/loop/rng.ts';
import { createScene2D } from '../../../packages/core/render2d/scene2d.ts';
import type { Rect } from '../../../packages/core/render2d/view.ts';
import { createI18n, isLang } from '../../../packages/core/ui/i18n/index.ts';
import { PlayHud } from '../../../packages/core/ui/hud/hud.ts';
import type { PipPlacement } from '../../../packages/core/ui/layout.ts';
import { SHAPE_FULL, SHAPE_UPPER, type RigShape } from '../../../packages/core/moves/testing/rig.ts';
import type { GameModule } from '../../../packages/core/types/index.ts';
import { createChain, type ChainPerson } from '../../../packages/games/kit-g1/testing/chain.ts';
import { fireworkJacksModule, manifest as fjManifest, strings as fjStrings } from '../../../packages/games/firework-jacks/index.ts';
import { twistTurbineModule, manifest as ttManifest, strings as ttStrings } from '../../../packages/games/twist-turbine/index.ts';
import { limboBendModule, manifest as lbManifest, strings as lbStrings } from '../../../packages/games/limbo-bend/index.ts';
import { poseWallModule, manifest as pwManifest, strings as pwStrings } from '../../../packages/games/pose-wall/index.ts';
import { stageOf } from '../../../packages/games/_shared/stage.ts';
import { fjLayout } from '../../../packages/games/strength/fireworks-view.ts';
import { ttLayout } from '../../../packages/games/strength/turbine-view.ts';
import { lbLayout } from '../../../packages/games/gatepose/limbo-view.ts';
import { pwLayout } from '../../../packages/games/gatepose/posewall-view.ts';
import { jackPerson, twistPerson } from '../../../packages/games/strength/testing/people.ts';
import { bendPerson, posePerson } from '../../../packages/games/gatepose/testing/people.ts';

const q = new URLSearchParams(location.search);
const id = q.get('game') ?? 'pose-wall';
const mode = q.get('mode') === 'local2' ? 'local2' : 'solo';
const difficulty = q.get('difficulty') ?? 'easy';
const seated = q.get('seated') === '1';
const quiet = q.get('quiet') === '1';
const body = (q.get('body') ?? 'perfect') as 'perfect' | 'late' | 'sloppy' | 'idle';
const workS = Number(q.get('workS') ?? 18);

const errors: string[] = [];
window.addEventListener('error', (e) => errors.push(`error: ${e.message}`));
window.addEventListener('unhandledrejection', (e) => errors.push(`rejection: ${String((e.reason as Error)?.message ?? e.reason)}`));

const sceneEl = document.querySelector('[data-scene]') as HTMLElement;
const hudEl = document.querySelector('[data-hud-root]') as HTMLElement;
const cameraHost = document.querySelector('[data-camera-host]') as HTMLElement;

interface Geometry { w: number; h: number; play: Rect; pip: Rect | null; lanes: readonly [Rect, Rect] | null }
interface Entry {
  module: GameModule;
  strings: Parameters<ReturnType<typeof createI18n>['extend']>[1];
  /** The corner the self view starts in (design/LAYOUT.md 5: E bottom left, F bottom right). */
  corner: PipPlacement;
  people(shapes: RigShape[]): ChainPerson[];
  /** What must stay out from under the plates and the self view. */
  keep(g: Geometry, players: 1 | 2): Rect[];
}

const strengthTiming = { sets: 1, workS, restS: 4, finaleS: 3 };
const games: Record<string, Entry> = {
  'firework-jacks': {
    module: fireworkJacksModule(structuredClone(fjManifest), { timing: { ...strengthTiming, countIn: 4 } }),
    strings: fjStrings, corner: 'bottom-left',
    people: (shapes) => shapes.map((shape, i) => jackPerson({ kind: body, lane: i, seated, quiet, shape })),
    keep: (g, players) => fjLayout(g, players).zones.flatMap((z) => z.keep),
  },
  'twist-turbine': {
    module: twistTurbineModule(structuredClone(ttManifest), { timing: { ...strengthTiming, workS: Math.max(workS, 30) } }),
    strings: ttStrings, corner: 'bottom-left',
    people: (shapes) => shapes.map((shape) => twistPerson({ kind: body, seated, shape })),
    keep: (g) => { const k = ttLayout(g).keep; return [k.turbine, k.avatar, k.pace]; },
  },
  'limbo-bend': {
    module: limboBendModule(structuredClone(lbManifest), { timing: { sets: 1, workS, finaleS: 3 } }),
    strings: lbStrings, corner: 'bottom-right',
    people: (shapes) => shapes.map((shape, i) => bendPerson({ kind: body === 'late' ? 'perfect' : body, lane: i as 0 | 1, seated, shape })),
    keep: (g, players) => lbLayout(g, players).zones.map((z) => z.keep),
  },
  'pose-wall': {
    module: poseWallModule(structuredClone(pwManifest), { timing: { sets: 1, workS, finaleS: 3 } }),
    strings: pwStrings, corner: 'bottom-right',
    people: (shapes) => shapes.map((shape, i) => posePerson({ kind: body === 'late' ? 'perfect' : body, lane: i as 0 | 1, seated, shape })),
    keep: (g, players) => pwLayout(g, players).zones.map((z) => z.keep),
  },
};

const entry = games[id];
if (!entry) throw new Error(`No harness entry for ${id}`);
const corner = (q.get('corner') ?? entry.corner) as PipPlacement;

const langParam = q.get('lang');
const i18n = createI18n(isLang(langParam) ? langParam : 'en');
i18n.extend(`game.${id}`, entry.strings);
const say = i18n.scoped(`game.${id}`);

const canvas = document.createElement('canvas');
sceneEl.append(canvas);
const rng = rngStream(9, 'fx');
const kit = createScene2D({ canvas, size: () => ({ width: sceneEl.clientWidth, height: sceneEl.clientHeight }), devicePixelRatio: () => window.devicePixelRatio || 1, rng });

const announced: string[] = [];
const hud: PlayHud = new PlayHud({
  document, root: hudEl, cameraHost, i18n, mode: 'scene', pipCorner: corner, duo: mode === 'local2',
  announce: (t) => { announced.push(t); }, toast: () => undefined, onPause: () => undefined, onMovePip: () => undefined,
  onLayout: () => sync(),
});
if (q.get('tile') === '1') {
  document.body.classList.add('tile-real');
  const standIn = document.createElement('div');
  standIn.className = 'stand-in';
  standIn.innerHTML = '<i class="head"></i><i class="body"></i>';
  hud.pipHost.append(standIn);
}

/** The shell keeps the scene kit's layout in step with the plates the HUD really drew. */
function size(name: string): { w: number; h: number } {
  const el = hudEl.querySelector<HTMLElement>(`[data-hud="${name}"]`);
  if (!el || el.hidden) return { w: 1, h: 1 };
  const r = el.getBoundingClientRect();
  return { w: Math.max(1, Math.ceil(r.width)), h: Math.max(1, Math.ceil(r.height)) };
}
function sync(): void {
  if (mode === 'local2') kit.setHudDuo({ statusP1: size('statusP1'), statusP2: size('statusP2'), timer: size('timer'), command: size('command'), reasonP1: size('reasonP1'), reasonP2: size('reasonP2') });
  else kit.setHud({ mode: 'scene', pipCorner: corner, measured: { statusLeft: size('statusLeft'), statusRight: size('statusRight'), command: size('command'), reason: size('reason') } });
}

const resize = (): void => { kit.resize(); sync(); };
window.addEventListener('resize', resize);

const audio = createAudio();
/** What the first body did, step by step (for finding out why a run went as it did). */
const bodyLog: { k: number; twist: number; bend: number }[] = [];
const watched = (p: ChainPerson, i: number): ChainPerson => i > 0 ? p : {
  ...p,
  body: (t, game, state) => {
    const f = p.body(t, game, state);
    const sim = (game as unknown as { sim?: { k: number } } | null)?.sim;
    if (sim && bodyLog.length < 4000) bodyLog.push({ k: sim.k, twist: f.twist ?? 0, bend: f.bend ?? 0 });
    return f;
  },
};
const people = entry.people(mode === 'local2'
  ? [{ ...SHAPE_FULL, aspect: 16 / 9, cx: 0.68, T: 0.17 }, { ...SHAPE_FULL, aspect: 16 / 9, cx: 0.32, T: 0.17 }]
  : [seated ? { ...SHAPE_UPPER, aspect: 16 / 9, T: 0.24 } : { ...SHAPE_FULL, aspect: 16 / 9, T: 0.2 }]);

const chain = createChain({
  module: entry.module, mode, difficulty, seated, quiet, people: people.map(watched), realtime: true, scene2d: kit, hud, audio, countdownMs: 1500, seed: 5, t: (k, v) => say(k, v),
});
const session = chain.session;
session.on('state', (s) => {
  if (s === 'calibrating' || s === 'setup') hud.setPhase('calibrate');
  else if (s === 'countdown' || s === 'running') hud.setPhase('play');
  if (s === 'running') frames.length = 0;
});

const frames: number[] = [];
let last = 0;
const tick = (t: number): void => {
  if (session.state === 'running' && last) frames.push(t - last);
  last = session.state === 'running' ? t : 0;
  requestAnimationFrame(tick);
};
requestAnimationFrame(tick);

function rect(el: Element | null): { x: number; y: number; w: number; h: number } | null {
  if (!el || (el as HTMLElement).hidden) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
}

/** The geometry the games lay themselves out from: through the same stage adapter, so the play area is the steady one (the smallest of the run so far). */
const stage = stageOf(kit) as NonNullable<ReturnType<typeof stageOf>>;
const geometry = (): Geometry => ({ w: stage.w, h: stage.h, play: stage.play, pip: stage.pip, lanes: stage.lanes });

window.ba = {
  id, mode, difficulty, seated, quiet, body, say,
  chain, hud, kit, canvas, audio, errors, announced,
  start: async () => { audio.unlock(); resize(); await chain.start(); chain.pump(); },
  state: () => {
    const g = chain.game() as unknown as { sim?: { phase: string; k: number; segment: { kind: string } } } | null;
    return { session: chain.session.state, game: g?.sim ? { phase: g.sim.phase, k: g.sim.k, segment: g.sim.segment.kind } : null, seen: chain.seen };
  },
  /** The score and counts of the run so far, from the game's own summary. */
  summary: () => { try { return (chain.game() as unknown as { summary(): unknown } | null)?.summary() ?? null; } catch { return null; } },
  /** What must stay clear of the plates and of the self view, where the view puts it on this screen. */
  keep: () => entry.keep(geometry(), mode === 'local2' ? 2 : 1),
  plates: () => [...hudEl.querySelectorAll('[data-hud]')].filter((e) => !(e as HTMLElement).hidden).map((e) => ({ name: (e as HTMLElement).dataset['hud'] as string, ...rect(e)! })),
  /** The reason strip(s) as the player reads them. */
  reasons: () => ['reason', 'reasonP1', 'reasonP2'].map((n) => hudEl.querySelector<HTMLElement>(`[data-hud="${n}"]`)).filter((e): e is HTMLElement => !!e && !e.hidden).map((e) => (e.textContent ?? '').trim()).filter((t) => t.length > 0),
  command: () => (hudEl.querySelector<HTMLElement>('[data-hud="command"]')?.textContent ?? '').trim(),
  rects: () => kit.rects,
  /** The play area and lanes the games work from (held still: the smallest of the run so far). */
  steady: () => ({ play: stage.play, lanes: stage.lanes }),
  bodyLog: () => bodyLog.slice(),
  problems: () => hud.problems(),
  frames: () => [...frames],
  audioStats: () => ({ ...audio.stats(), names: SFX_NAMES.length }),
  pixelCheck: () => {
    // Is the canvas drawn at all: count distinct colours on a grid of 40 by 40 points (one read-back of the whole picture). A wide
    // night corridor has a big plain sky and floor, so a coarse grid would find the same few colours whether the avatar is there or not.
    const c = canvas.getContext('2d') as CanvasRenderingContext2D;
    const img = c.getImageData(0, 0, canvas.width, canvas.height);
    const seen = new Set<string>();
    const N = 40;
    for (let gx = 0; gx < N; gx++) for (let gy = 0; gy < N; gy++) {
      const i = (Math.min(canvas.height - 1, Math.floor((canvas.height * (gy + 0.5)) / N)) * canvas.width + Math.min(canvas.width - 1, Math.floor((canvas.width * (gx + 0.5)) / N))) * 4;
      seen.add(`${img.data[i]! >> 4},${img.data[i + 1]! >> 4},${img.data[i + 2]! >> 4}`);
    }
    return seen.size;
  },
};
window.harnessReady = true;

declare global {
  interface Window { ba: Record<string, unknown> & { start(): Promise<void>; state(): unknown }; harnessReady?: boolean }
}
