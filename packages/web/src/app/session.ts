// The real session of a round: the platform's browser session (one camera and one pose service per page, the device
// capabilities, the wake lock) plus what the shell owns: the game modules, the HUD, the store, the sound, the scene kit
// and the strings. Games are found by their folder (packages/games/<id>/index.ts) and loaded when the round starts, so a
// player only downloads the games they open.
//
// Two scene kits exist and a game gets the one its template draws with:
//  - the 3D kit (three.js) for the runner;
//  - the 2D kit (a canvas) for everything else: the mirror games draw the camera picture as their scene, the scene games
//    keep clear the self view window that the HUD places as a DOM tile.
// Both kits follow the HUD: the 2D kit is told where the HUD put its plates and the self view (layout-bridge.ts), so a game
// keeps its play area clear of them with the same rectangles the HUD uses.
import type { GameModule, Session, Unsubscribe } from '../../../core/types/index.ts';
import { createAudio, type AudioKit } from '../../../core/audio/index.ts';
import { createBrowserSession } from '../../../core/loop/browser.ts';
import { rngStream } from '../../../core/loop/rng.ts';
import { createScene2D, type Scene2DKit } from '../../../core/render2d/index.ts';
import { createScene3D, initialQualityLevel, type Scene3DKit } from '../../../core/render3d/index.ts';
import { registerGameStrings, type I18n, type Lang } from '../../../core/ui/i18n/index.ts';
import type { StoreNamespace } from '../../../core/store/store.ts';
import { setMirrorVideo } from '../../../games/target/video.ts';
import { followHud } from './layout-bridge.ts';
import { hudModeFor } from './play.ts';
import type { SessionFactory, SessionRequest } from './ports.ts';

type StringTables = Partial<Record<Lang, Readonly<Record<string, string>>>>;
/** What a game folder's index.ts may export: the module, and its words (named `strings` or `STRINGS`, or on the module). */
interface GameFile { default: GameModule & { strings?: StringTables }; strings?: StringTables; STRINGS?: StringTables }

const modules = import.meta.glob<GameFile>('../../../games/*/index.ts');

/** The ids of the games this build can run: the folders of packages/games that have an index. */
export function playableGameIds(): string[] {
  return Object.keys(modules).map((k) => k.split('/').at(-2) ?? '').filter(Boolean);
}

const withWords = new Set<string>();

/** The game's code, and its words added to the shell's (once), under `game.<id>`. */
export async function loadGame(id: string): Promise<GameModule | null> {
  const load = modules[`../../../games/${id}/index.ts`];
  if (!load) return null;
  const file = await load();
  if (!withWords.has(id)) {
    withWords.add(id);
    const words = file.strings ?? file.STRINGS ?? file.default.strings;
    if (words) registerGameStrings(`game.${id}`, words);
  }
  return file.default;
}

/** The runner draws in 3D; every other template draws on the 2D kit. */
export const kitFor = (template: string): '2d' | '3d' => (template === 'runner' ? '3d' : '2d');

export interface RealSessionDeps {
  /** The store of one game (its best scores and the like). */
  store(gameId: string): StoreNamespace;
  /** The current language: fresh every call. */
  i18n(): I18n;
  reducedMotion(): boolean;
  /** The sound switch of the settings. */
  soundOn(): boolean;
  /** Only needed for tests that cannot make a WebGL context. */
  makeScene?: (canvas: HTMLCanvasElement, size: () => { width: number; height: number }, level: 0 | 1 | 2, mobile: boolean, reducedMotion: boolean) => Scene3DKit;
}

let sharedAudio: AudioKit | null = null;

/** One sound kit per page: the browser allows only so many audio contexts, and the first player gesture unlocks it. */
export function pageAudio(): AudioKit {
  sharedAudio ??= createAudio();
  return sharedAudio;
}

const isMobile = (w: Window): boolean => /Android|iPhone|iPad|iPod|Mobile/i.test(w.navigator.userAgent) || Math.min(w.screen.width, w.screen.height) < 700;

export function createRealSessionFactory(deps: RealSessionDeps): SessionFactory {
  return (r: SessionRequest): Session | null => {
    const doc = r.stage.scene.ownerDocument;
    const view = doc.defaultView as Window & typeof globalThis;
    const kind = kitFor(r.game.template);
    const mode = hudModeFor(r.game);
    const canvas = doc.createElement('canvas');
    canvas.className = 'ba-scene-canvas';
    r.stage.scene.append(canvas);
    let kit3: Scene3DKit | null = null;
    let kit2: Scene2DKit | null = null;
    let offLayout: Unsubscribe | null = null;
    let resizes: ResizeObserver | null = null;
    const size = (): { width: number; height: number } => ({ width: Math.max(1, r.stage.scene.clientWidth), height: Math.max(1, r.stage.scene.clientHeight) });

    /** Gives back what a round's scene held: the kit (GPU objects or the canvas surfaces), its observers and its listeners. */
    const dropKit = (): void => {
      offLayout?.();
      offLayout = null;
      resizes?.disconnect();
      resizes = null;
      kit3?.dispose();
      kit3 = null;
      if (kit2) setMirrorVideo(kit2, null);
      kit2?.dispose();
      kit2 = null;
    };

    const session = createBrowserSession({
      games: (id) => loadGame(id),
      ui: (m, o) => {
        // A round that was left and started again draws into the same canvas, with a new kit.
        dropKit();
        if (!canvas.isConnected) r.stage.scene.append(canvas);
        const i18n = deps.i18n();
        const audio = pageAudio();
        audio.setMuted(!deps.soundOn());
        const base = { hud: r.stage.hud, audio, store: deps.store(m.id), t: i18n.scoped(`game.${m.id}`) };
        try {
          if (kind === '3d') {
            const mobile = isMobile(view);
            const level = initialQualityLevel({ mobile, cores: view.navigator.hardwareConcurrency, stored: null });
            kit3 = deps.makeScene
              ? deps.makeScene(canvas, size, level, mobile, deps.reducedMotion())
              : createScene3D({ canvas, mode: 'auto', level, mobile, reducedMotion: deps.reducedMotion(), size });
            return { ...base, scene3d: kit3 };
          }
          const seed = (o.seed ?? Math.floor(Math.random() * 0x1_0000_0000)) >>> 0;
          const kit = createScene2D({ canvas, size, rng: rngStream(seed, 'kit'), reducedMotion: deps.reducedMotion() });
          kit2 = kit;
          offLayout = r.stage.onLayout((info) => followHud(kit, info, mode));
          if (typeof ResizeObserver !== 'undefined') {
            resizes = new ResizeObserver(() => { if (!kit.disposed) kit.resize(); });
            resizes.observe(r.stage.scene);
          }
          return { ...base, scene2d: kit };
        } catch (e) {
          dropKit();
          // The player reads this on the error panel: a device that cannot draw the scene says so in the player's words.
          throw new Error(i18n.t('play.error.scene'), { cause: e });
        }
      },
      touchTarget: () => r.stage.scene,
      flags: () => ({ reducedMotion: deps.reducedMotion(), silent: r.setup.quiet }),
    });

    // A mirror game draws the camera's picture itself: it gets the element when the camera runs and loses it when the camera is released.
    if (mode === 'mirror') session.on('video', ({ el }) => { if (kit2) setMirrorVideo(kit2, el); });

    // Giving the round back also gives back the scene.
    const release = (): void => {
      dropKit();
      canvas.remove();
    };
    return {
      get state() { return session.state; },
      get pauseReason() { return session.pauseReason; },
      start: (id, o) => session.start(id, o),
      pause: (reason) => session.pause(reason),
      resume: () => session.resume(),
      recalibrate: () => session.recalibrate(),
      quit() { session.quit(); release(); },
      on: (k, cb) => session.on(k, cb),
    };
  };
}
