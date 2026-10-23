// Squat Flap: Flappy Bird where every flap is a squat (template B, free). The seated variant flaps with the arms.
// Register STRINGS with i18n.extend('game.squat-flap', STRINGS) so the plates and messages speak the player's language.
import type { GameManifest, GameModule } from '../../core/types/index.ts';
import manifestJson from './manifest.json' with { type: 'json' };
import { FLIGHT_KEYS, FLIGHT_TOUCH } from '../flight/controls.ts';
import { createFlightGame } from '../flight/game.ts';

export const manifest = manifestJson as unknown as GameManifest;
export { STRINGS } from '../flight/strings.ts';

/** Squat Flap with another manifest (tools and tests: a shorter run, say); the game itself is the same. */
export function squatFlapModule(m: GameManifest = manifest): GameModule {
  return { manifest: m, create: () => createFlightGame(m), controls: { keys: FLIGHT_KEYS, touch: FLIGHT_TOUCH } };
}

const squatFlap: GameModule = squatFlapModule();

export default squatFlap;
