// Star Catch (template C, the mirror): stars drift into the picture of your room; catch each with the hand of its colour
// before it fades, and light up whole constellations. The rules, the view and the HUD live in ../target; this folder is the
// game the catalogue lists (manifest.json is read from packages/games/<id>/ by the catalogue loader).
import type { GameManifest } from '../../core/types/index.ts';
import { targetModule, type TargetGameModule, type TargetModuleOptions } from '../target/module.ts';
import { starCatchRules } from '../target/star-catch.ts';
import manifestJson from './manifest.json' with { type: 'json' };

export const manifest = manifestJson as GameManifest;

/** Star Catch with another manifest or a shorter run (tools and the end-to-end tests); the game itself is the same. */
export function starCatchModule(m: GameManifest = manifest, o: TargetModuleOptions = {}): TargetGameModule {
  return targetModule(m, starCatchRules, o);
}

const starCatch = starCatchModule();

/** The game's words in every language, for the shell to add with i18n.extend('game.star-catch', strings). */
export const strings = starCatch.strings;

export default starCatch;
