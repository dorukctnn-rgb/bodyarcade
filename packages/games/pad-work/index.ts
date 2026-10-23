// Pad Work (template C, the mirror, with the beat of template D): numbered pads around your head, punches on the beat,
// swinging bags to slip or duck. The rules, the view and the HUD live in ../target; this folder is the game the catalogue
// lists (manifest.json is read from packages/games/<id>/ by the catalogue loader).
import type { GameManifest } from '../../core/types/index.ts';
import { padWorkRules } from '../target/pad-work.ts';
import { targetModule, type TargetGameModule, type TargetModuleOptions } from '../target/module.ts';
import manifestJson from './manifest.json' with { type: 'json' };

export const manifest = manifestJson as GameManifest;

/** Pad Work with another manifest or a shorter run (tools and the end-to-end tests); the game itself is the same. */
export function padWorkModule(m: GameManifest = manifest, o: TargetModuleOptions = {}): TargetGameModule {
  return targetModule(m, padWorkRules, o);
}

const padWork = padWorkModule();

/** The game's words in every language, for the shell to add with i18n.extend('game.pad-work', strings). */
export const strings = padWork.strings;

export default padWork;
