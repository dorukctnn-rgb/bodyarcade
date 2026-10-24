// Browser side of tests/e2e/g1-games.spec.ts: one game of builder G1 on the real stack as far as a page can have it without
// a person: the Session, the pose feed, the movement detectors, the input hub, the 2D scene kit, the shell's own HUD and
// stylesheet, the real audio kit; only the camera and the pose model are replaced by a synthetic body (the movement
// library's rig) delivered as pose frames in real time. Nothing here asserts; the spec does.
//   ?game=squat-flap|knee-sprint|summit-climb  &mode=solo|local2  &difficulty=easy  &seated=1  &body=perfect|good|sloppy|idle
//   &sets=2&setSec=10&restSec=4  (a shorter Squat Flap round)  &heats=2&dist=60&restSec=4  (a shorter Knee Sprint round)
//   &sets=2&summit=20&setSec=40&restSec=4  (a shorter Summit Climb round)
//   &quiet=1  (the quiet variant)  &corner=bottom-right
import '../../../packages/web/src/styles/app.css';
import { createAudio } from '../../../packages/core/audio/audio.ts';
import { SFX_NAMES } from '../../../packages/core/audio/sfx.ts';
import { rngStream } from '../../../packages/core/loop/rng.ts';
import { createScene2D } from '../../../packages/core/render2d/scene2d.ts';
import { createI18n } from '../../../packages/core/ui/i18n/index.ts';
import { PlayHud } from '../../../packages/core/ui/hud/hud.ts';
import type { PipPlacement } from '../../../packages/core/ui/layout.ts';
import { SHAPE_FULL, SHAPE_UPPER, type RigShape } from '../../../packages/core/moves/testing/rig.ts';
import type { GameManifest, GameModule } from '../../../packages/core/types/index.ts';
import { createChain, type ChainPerson } from '../../../packages/games/kit-g1/testing/chain.ts';
import { manifest as flapManifest, squatFlapModule, STRINGS as FLAP_STRINGS } from '../../../packages/games/squat-flap/index.ts';
import { squatPerson } from '../../../packages/games/flight/testing/body.ts';
import { kneeSprintModule, manifest as sprintManifest, STRINGS as SPRINT_STRINGS } from '../../../packages/games/knee-sprint/index.ts';
import { runnerPerson } from '../../../packages/games/sprint/testing/body.ts';
import { manifest as climbManifest, STRINGS as CLIMB_STRINGS, summitClimbModule } from '../../../packages/games/summit-climb/index.ts';
import { climberPerson } from '../../../packages/games/climb/testing/body.ts';

const q = new URLSearchParams(location.search);
const id = q.get('game') ?? 'squat-flap';
const mode = q.get('mode') === 'local2' ? 'local2' : 'solo';
const difficulty = q.get('difficulty') ?? 'easy';
const seated = q.get('seated') === '1';
const quiet = q.get('quiet') === '1';
const body = (q.get('body') ?? 'perfect') as 'perfect' | 'good' | 'sloppy' | 'idle';
const corner = (q.get('corner') ?? 'bottom-right') as PipPlacement;
const plan = {
  sets: Number(q.get('sets') ?? 2), setSec: Number(q.get('setSec') ?? 10), restSec: Number(q.get('restSec') ?? 4),
};

const errors: string[] = [];
window.addEventListener('error', (e) => errors.push(`error: ${e.message}`));
window.addEventListener('unhandledrejection', (e) => errors.push(`rejection: ${String((e.reason as Error)?.message ?? e.reason)}`));

const sceneEl = document.querySelector('[data-scene]') as HTMLElement;
const hudEl = document.querySelector('[data-hud-root]') as HTMLElement;
const cameraHost = document.querySelector('[data-camera-host]') as HTMLElement;

interface Entry { module: GameModule; manifest: GameManifest; strings: Parameters<ReturnType<typeof createI18n>['extend']>[1]; people(kind: typeof body, mode: 'solo' | 'local2', seated: boolean, shapes: RigShape[]): ChainPerson[] }

const games: Record<string, Entry> = {
  'squat-flap': {
    module: squatFlapModule(flapManifest, { plan }),
    manifest: flapManifest,
    strings: FLAP_STRINGS,
    people: (kind, m, s, shapes) => shapes.map((shape, i) => squatPerson({ kind, lane: i, seed: i + 1, shape, arms: s })),
  },
};

games['knee-sprint'] = {
  module: kneeSprintModule(sprintManifest, { heats: Number(q.get('heats') ?? 2), dist: Number(q.get('dist') ?? 60), restSec: Number(q.get('restSec') ?? 4) }),
  manifest: sprintManifest,
  strings: SPRINT_STRINGS,
  people: (kind, m, s, shapes) => shapes.map((shape, i) => runnerPerson({ kind, lane: i, seed: i + 1, shape, arms: s })),
};

games['summit-climb'] = {
  module: summitClimbModule(climbManifest, { sets: Number(q.get('sets') ?? 2), summit: Number(q.get('summit') ?? 20), setSec: Number(q.get('setSec') ?? 40), restSec: Number(q.get('restSec') ?? 4) }),
  manifest: climbManifest,
  strings: CLIMB_STRINGS,
  people: (kind, m, s, shapes) => shapes.map((shape, i) => climberPerson({ kind, seed: i + 1, shape, seated: s })),
};

const entry = games[id];
if (!entry) throw new Error(`No harness entry for ${id}`);

const i18n = createI18n('en');
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
const people = entry.people(body, mode, seated, mode === 'local2'
  ? [{ ...SHAPE_FULL, aspect: 16 / 9, cx: 0.68, T: 0.17 }, { ...SHAPE_FULL, aspect: 16 / 9, cx: 0.32, T: 0.17 }]
  : [seated ? { ...SHAPE_UPPER, aspect: 16 / 9, T: 0.24 } : { ...SHAPE_FULL, aspect: 16 / 9, T: 0.2 }]);

const chain = createChain({
  module: entry.module, mode, difficulty, seated, quiet, people, realtime: true, scene2d: kit, hud, audio, countdownMs: 1500, seed: 5, t: (k, v) => say(k, v),
});
const session = chain.session;
chain.session.on('state', (s) => {
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

window.ba = {
  id, mode, difficulty, seated, quiet, body, say,
  chain, hud, kit, canvas, audio, errors, announced,
  start: async () => { audio.unlock(); resize(); await chain.start(); chain.pump(); },
  state: () => {
    const g = chain.game() as unknown as { state?: Record<string, unknown> } | null;
    // Summit Climb: is a rock coming down right now (for a screenshot of the warning).
    const st = g?.state as { rocks?: { t: number }[]; setT?: number; phase?: string; c?: { rock?: number } } | undefined;
    const next = st?.rocks?.[st.c?.rock ?? 0];
    const warned = !!next && st?.phase === 'climb' && next.t - (st.setT ?? 0) <= 1.2 && next.t - (st.setT ?? 0) > 0.3;
    return { session: chain.session.state, game: g?.state ? { phase: g.state['phase'], round: g.state['round'] ?? null, heat: g.state['heat'] ?? null, lanes: g.state['lanes'], warned } : null, seen: chain.seen };
  },
  /** The hero of each lane as the view drew it (the bird of Squat Flap, the runner of Knee Sprint). */
  birds: () => {
    const g = chain.game() as unknown as { view?: { birdAt?(i: number): { x: number; y: number; r: number } | null; runnerAt?(i: number): { x: number; y: number; r: number } | null; climberAt?(): { x: number; y: number; r: number } | null } } | null;
    return [0, 1].map((i) => g?.view?.birdAt?.(i) ?? g?.view?.runnerAt?.(i) ?? (i === 0 ? g?.view?.climberAt?.() : null) ?? null);
  },
  plates: () => [...hudEl.querySelectorAll('[data-hud]')].filter((e) => !(e as HTMLElement).hidden).map((e) => ({ name: (e as HTMLElement).dataset['hud'] as string, ...rect(e)! })),
  rects: () => kit.rects,
  problems: () => hud.problems(),
  frames: () => [...frames],
  audioStats: () => ({ ...audio.stats(), names: SFX_NAMES.length }),
  pixelCheck: () => {
    // Is the canvas drawn at all: count distinct colours on a coarse grid (one read-back of the whole picture).
    const c = canvas.getContext('2d') as CanvasRenderingContext2D;
    const img = c.getImageData(0, 0, canvas.width, canvas.height);
    const seen = new Set<string>();
    for (let gx = 1; gx < 12; gx++) for (let gy = 1; gy < 12; gy++) {
      const i = (Math.floor((canvas.height * gy) / 12) * canvas.width + Math.floor((canvas.width * gx) / 12)) * 4;
      seen.add(`${img.data[i]! >> 4},${img.data[i + 1]! >> 4},${img.data[i + 2]! >> 4}`);
    }
    return seen.size;
  },
};
window.harnessReady = true;

declare global {
  interface Window { ba: Record<string, unknown> & { start(): Promise<void>; state(): unknown }; harnessReady?: boolean }
}
