// Pose Wall (template F gate and pose): a wall with a person-shaped hole flies toward you; make the shape before it reaches you,
// hold it, and pass through. Two people can play side by side on one camera on a big screen. The simulation, view and HUD live in
// ../gatepose; this folder is the game the catalogue lists (manifest.json is read from packages/games/<id>/ by the catalogue loader).
import type { GameManifest, GameModule } from '../../core/types/index.ts';
import { createPoseWallGame, PW_KEYS, PW_TOUCH, type PoseWallGameOptions } from '../gatepose/posewall-game.ts';
import { PW_STRINGS } from '../gatepose/strings.ts';
import manifestJson from './manifest.json' with { type: 'json' };

export const manifest = manifestJson as GameManifest;

/** The game's words in every language, for the shell to add with i18n.extend('game.pose-wall', strings). */
export const strings = PW_STRINGS;

/** Pose Wall with another manifest or a shorter run (tools and the end-to-end tests); the game itself is the same. */
export function poseWallModule(m: GameManifest = manifest, o: PoseWallGameOptions = {}): GameModule & { strings: typeof PW_STRINGS } {
  return {
    manifest: m,
    create: () => createPoseWallGame(m, o),
    controls: { keys: PW_KEYS, touch: PW_TOUCH },
    strings,
  };
}

const poseWall = poseWallModule();

export default poseWall;
