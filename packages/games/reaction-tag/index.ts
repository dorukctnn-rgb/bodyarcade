// Reaction Tag (template C, the mirror): green lights come on around you and fade fast, red ones are traps, and every tap
// measures your reaction in milliseconds. The rules, the view and the HUD live in ../target; this folder is the game the
// catalogue lists (manifest.json is read from packages/games/<id>/ by the catalogue loader).
import type { GameManifest } from '../../core/types/index.ts';
import { reactionTagRules } from '../target/reaction-tag.ts';
import { targetModule, type TargetGameModule, type TargetModuleOptions } from '../target/module.ts';
import manifestJson from './manifest.json' with { type: 'json' };

export const manifest = manifestJson as GameManifest;

/** Reaction Tag with another manifest or a shorter run (tools and the end-to-end tests); the game itself is the same. */
export function reactionTagModule(m: GameManifest = manifest, o: TargetModuleOptions = {}): TargetGameModule {
  return targetModule(m, reactionTagRules, o);
}

const reactionTag = reactionTagModule();

/** The game's words in every language, for the shell to add with i18n.extend('game.reaction-tag', strings). */
export const strings = reactionTag.strings;

export default reactionTag;
