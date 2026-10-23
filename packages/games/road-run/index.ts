// Road Run: today's runner on the platform (template A). Jump, duck and lean through ten worlds; the seated variant
// leans and ducks from a chair.
import type { GameManifest, GameModule } from '../../core/types/index.ts';
import manifestJson from './manifest.json' with { type: 'json' };
import { RUNNER_KEYS, RUNNER_TOUCH } from '../runner/controls.ts';
import { createRunnerGame } from '../runner/game.ts';

export const manifest = manifestJson as GameManifest;

const roadRun: GameModule = {
  manifest,
  create: () => createRunnerGame(manifest),
  controls: { keys: RUNNER_KEYS, touch: RUNNER_TOUCH },
};

export default roadRun;
