// Road Run: today's runner on the platform (template A). Jump, duck and lean through ten worlds; the seated variant
// leans and ducks from a chair.
import type { GameManifest, GameModule, ThemeData } from '../../core/types/index.ts';
import type { Scene3DKit } from '../../core/render3d/scene3d.ts';
import worldsJson from '../../core/render3d/themes/classic-worlds.json' with { type: 'json' };
import manifestJson from './manifest.json' with { type: 'json' };
import { RUNNER_KEYS, RUNNER_TOUCH } from '../runner/controls.ts';
import { createRunnerGame } from '../runner/game.ts';
import { createRunnerView } from '../runner/view.ts';

export const manifest = manifestJson as GameManifest;

/** The ten worlds of today's runner (render3d themes); Alps, Desert and Forest are free. */
export const WORLDS = worldsJson as unknown as ThemeData[];

/** The 3D view needs the scene kit (stage, prototypes, pickups); a plain Scene3D gets the HUD only. */
const isKit = (s: unknown): s is Scene3DKit => !!s && typeof s === 'object' && 'stage' in s && 'prototypes' in s;

const roadRun: GameModule = {
  manifest,
  create: () => createRunnerGame(manifest, {
    worlds: WORLDS,
    view: (ctx) => (isKit(ctx.scene3d) ? createRunnerView(ctx.scene3d, { fx: ctx.rng('fx'), reducedMotion: ctx.flags.reducedMotion }) : null),
  }),
  controls: { keys: RUNNER_KEYS, touch: RUNNER_TOUCH },
};

export default roadRun;
