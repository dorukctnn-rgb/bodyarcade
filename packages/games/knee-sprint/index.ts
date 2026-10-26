// Knee Sprint: a race on the spot, every knee lift a stride (template A, free). The seated variant races on the swing of the
// arms and the march of the knees; the quiet variant steps over hurdles with a knee to the hip.
// Register STRINGS with i18n.extend('game.knee-sprint', STRINGS) so the plates and messages speak the player's language.
import type { GameManifest, GameModule } from '../../core/types/index.ts';
import manifestJson from './manifest.json' with { type: 'json' };
import { SPRINT_KEYS, SPRINT_TOUCH } from '../sprint/controls.ts';
import { createSprintGame, type SprintGameOptions } from '../sprint/game.ts';

export const manifest = manifestJson as unknown as GameManifest;
export { STRINGS } from '../sprint/strings.ts';

/** Knee Sprint with another manifest or shorter heats (tools and tests); the game itself is the same. */
export function kneeSprintModule(m: GameManifest = manifest, o: SprintGameOptions = {}): GameModule {
  return { manifest: m, create: () => createSprintGame(m, o), controls: { keys: SPRINT_KEYS, touch: SPRINT_TOUCH } };
}

const kneeSprint: GameModule = kneeSprintModule();

export default kneeSprint;
