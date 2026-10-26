// Summit Climb: a wall climbed hand over hand, template E (free). The seated and the quiet variants climb with the arms only.
// Register STRINGS with i18n.extend('game.summit-climb', STRINGS) so the plates and messages speak the player's language.
import type { GameManifest, GameModule } from '../../core/types/index.ts';
import manifestJson from './manifest.json' with { type: 'json' };
import { CLIMB_KEYS, CLIMB_TOUCH } from '../climb/controls.ts';
import { createClimbGame, type ClimbGameOptions } from '../climb/game.ts';

export const manifest = manifestJson as unknown as GameManifest;
export { STRINGS } from '../climb/strings.ts';

/** Summit Climb with another manifest or shorter climbs (tools and tests); the game itself is the same. */
export function summitClimbModule(m: GameManifest = manifest, o: ClimbGameOptions = {}): GameModule {
  return { manifest: m, create: () => createClimbGame(m, o), controls: { keys: CLIMB_KEYS, touch: CLIMB_TOUCH } };
}

const summitClimb: GameModule = summitClimbModule();

export default summitClimb;
