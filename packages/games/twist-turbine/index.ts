// Twist Turbine (template E strength): twist from side to side to turn a wind turbine and light a night city. Hold the
// twist through an overload, twist fast through a blackout. The simulation, view and HUD live in ../strength; this folder
// is the game the catalogue lists (manifest.json is read from packages/games/<id>/ by the catalogue loader).
import type { GameManifest, GameModule } from '../../core/types/index.ts';
import { createTwistTurbineGame, TT_KEYS, TT_TOUCH, type TurbineGameOptions } from '../strength/turbine-game.ts';
import { TT_STRINGS } from '../strength/strings.ts';
import manifestJson from './manifest.json' with { type: 'json' };

export const manifest = manifestJson as GameManifest;

/** The game's words in every language, for the shell to add with i18n.extend('game.twist-turbine', strings). */
export const strings = TT_STRINGS;

/** Twist Turbine with another manifest or a shorter run (tools and the end-to-end tests); the game itself is the same. */
export function twistTurbineModule(m: GameManifest = manifest, o: TurbineGameOptions = {}): GameModule & { strings: typeof TT_STRINGS } {
  return {
    manifest: m,
    create: () => createTwistTurbineGame(m, o),
    controls: { keys: TT_KEYS, touch: TT_TOUCH },
    strings,
  };
}

const twistTurbine = twistTurbineModule();

export default twistTurbine;
