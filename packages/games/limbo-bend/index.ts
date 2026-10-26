// Limbo Bend (template F gate and pose): tilted gates fly toward you; lean from the hips to the tilt and slip through. Two
// people can play side by side on one camera on a big screen. The simulation, view and HUD live in ../gatepose; this folder
// is the game the catalogue lists (manifest.json is read from packages/games/<id>/ by the catalogue loader).
import type { GameManifest, GameModule } from '../../core/types/index.ts';
import { createLimboBendGame, LB_KEYS, LB_TOUCH, type LimboGameOptions } from '../gatepose/limbo-game.ts';
import { LB_STRINGS } from '../gatepose/strings.ts';
import manifestJson from './manifest.json' with { type: 'json' };

export const manifest = manifestJson as GameManifest;

/** The game's words in every language, for the shell to add with i18n.extend('game.limbo-bend', strings). */
export const strings = LB_STRINGS;

/** Limbo Bend with another manifest or a shorter run (tools and the end-to-end tests); the game itself is the same. */
export function limboBendModule(m: GameManifest = manifest, o: LimboGameOptions = {}): GameModule & { strings: typeof LB_STRINGS } {
  return {
    manifest: m,
    create: () => createLimboBendGame(m, o),
    controls: { keys: LB_KEYS, touch: LB_TOUCH },
    strings,
  };
}

const limboBend = limboBendModule();

export default limboBend;
