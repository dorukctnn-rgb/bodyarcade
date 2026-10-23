// Firework Jacks (template E strength, with the beat of template D): every jumping jack sends a firework up, a jack on the
// beat sends a bigger one, and at the end the whole show bursts again. Two people can share one sky on a big screen.
// The simulation, view and HUD live in ../strength; this folder is the game the catalogue lists (manifest.json is read
// from packages/games/<id>/ by the catalogue loader).
import type { GameManifest, GameModule } from '../../core/types/index.ts';
import { createFireworkJacksGame, FJ_KEYS, FJ_TOUCH, type FireworkGameOptions } from '../strength/fireworks-game.ts';
import { FJ_STRINGS } from '../strength/strings.ts';
import manifestJson from './manifest.json' with { type: 'json' };

export const manifest = manifestJson as GameManifest;

/** The game's words in every language, for the shell to add with i18n.extend('game.firework-jacks', strings). */
export const strings = FJ_STRINGS;

/** Firework Jacks with another manifest or a shorter run (tools and the end-to-end tests); the game itself is the same. */
export function fireworkJacksModule(m: GameManifest = manifest, o: FireworkGameOptions = {}): GameModule & { strings: typeof FJ_STRINGS } {
  return {
    manifest: m,
    create: () => createFireworkJacksGame(m, o),
    controls: { keys: FJ_KEYS, touch: FJ_TOUCH },
    strings,
  };
}

const fireworkJacks = fireworkJacksModule();

export default fireworkJacks;
