// What a game folder (packages/games/<id>/index.ts) exports for the three target-hit games: the GameModule with the game,
// its keyboard cursors and its words. One function builds all three from their manifest and their rules, so a folder is a
// manifest.json and a few lines.
import type { GameManifest, GameModule } from '../../core/types/index.ts';
import { CURSOR_KEYS } from './cursor.ts';
import { createTargetGame, type TargetGameOptions } from './game.ts';
import { GAME_STRINGS } from './strings.ts';
import type { BaseSpec, Rules } from './types.ts';
import { isScene2DKit, mirrorVideoOf } from './video.ts';
import { createMirrorView } from './view.ts';

export interface TargetModuleOptions extends Omit<TargetGameOptions, 'view'> {
  /** Another camera picture than the one the shell gave the scene with setMirrorVideo (tools and tests). */
  video?: () => CanvasImageSource | null;
  /** Another view, or none (tests that only want the rules and the HUD). */
  view?: TargetGameOptions['view'];
}

/** The module plus the game's words, for the shell to add with `i18n.extend('game.<id>', module.strings)`. */
export type TargetGameModule = GameModule & { strings: typeof GAME_STRINGS };

export function targetModule<S extends BaseSpec>(manifest: GameManifest, rules: Rules<S>, o: TargetModuleOptions = {}): TargetGameModule {
  const { video, view, ...game } = o;
  return {
    manifest,
    create: () => createTargetGame(manifest, rules, {
      ...game,
      view: view ?? ((ctx) => {
        const kit = ctx.scene2d;
        // a context without the platform's 2D kit (a test, a server) plays the game with the HUD only
        return isScene2DKit(kit) ? createMirrorView(kit, { video: video ?? (() => mirrorVideoOf(kit)) }) : null;
      }),
    }),
    controls: { keys: CURSOR_KEYS },
    strings: GAME_STRINGS,
  };
}
