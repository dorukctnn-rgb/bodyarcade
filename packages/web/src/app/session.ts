// The real session of a round: the platform's browser session (one camera and one pose service per page, the device
// capabilities, the wake lock) plus what the shell owns: the game modules, the HUD, the store, the sound, the 3D scene and
// the strings. Games are found by their folder (packages/games/<id>/index.ts) and loaded when the round starts, so a
// player only downloads the games they open.
import type { GameModule, Session } from '../../../core/types/index.ts';
import { createAudio, type AudioKit } from '../../../core/audio/index.ts';
import { createBrowserSession } from '../../../core/loop/browser.ts';
import { createScene3D, initialQualityLevel, type Scene3DKit } from '../../../core/render3d/index.ts';
import type { I18n } from '../../../core/ui/i18n/index.ts';
import type { StoreNamespace } from '../../../core/store/store.ts';
import { hudModeFor } from './play.ts';
import type { SessionFactory, SessionRequest } from './ports.ts';

const modules = import.meta.glob<{ default: GameModule }>('../../../games/*/index.ts');

/** The ids of the games this build can run: the folders of packages/games that have an index. */
export function playableGameIds(): string[] {
  return Object.keys(modules).map((k) => k.split('/').at(-2) ?? '').filter(Boolean);
}

export async function loadGame(id: string): Promise<GameModule | null> {
  const load = modules[`../../../games/${id}/index.ts`];
  if (!load) return null;
  return (await load()).default;
}

export interface RealSessionDeps {
  /** The store of one game (its best scores and the like). */
  store(gameId: string): StoreNamespace;
  /** The current language: fresh every call. */
  i18n(): I18n;
  reducedMotion(): boolean;
  /** The sound switch of the settings. */
  soundOn(): boolean;
  /** Quiet mode: games leave out the loud sounds. */
  quiet(): boolean;
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
    // Mirror games draw the camera as their scene with the 2D kit, which needs the game's own random stream; they are
    // wired when the first one exists. Until then the shell says so instead of starting something half there.
    if (hudModeFor(r.game) === 'mirror') return null;
    const doc = r.stage.scene.ownerDocument;
    const view = doc.defaultView as Window & typeof globalThis;
    const canvas = doc.createElement('canvas');
    canvas.className = 'ba-scene-canvas';
    r.stage.scene.append(canvas);
    let kit: Scene3DKit | null = null;
    const size = (): { width: number; height: number } => ({ width: Math.max(1, r.stage.scene.clientWidth), height: Math.max(1, r.stage.scene.clientHeight) });

    const session = createBrowserSession({
      games: (id) => loadGame(id),
      ui: (m) => {
        // A round that was left and started again draws into the same canvas.
        if (!canvas.isConnected) r.stage.scene.append(canvas);
        const mobile = isMobile(view);
        const level = initialQualityLevel({ mobile, cores: view.navigator.hardwareConcurrency, stored: null });
        kit = deps.makeScene
          ? deps.makeScene(canvas, size, level, mobile, deps.reducedMotion())
          : createScene3D({ canvas, mode: 'auto', level, mobile, reducedMotion: deps.reducedMotion(), size });
        const audio = pageAudio();
        audio.setMuted(!deps.soundOn());
        return { hud: r.stage.hud, audio, store: deps.store(m.id), scene3d: kit, t: deps.i18n().scoped(`game.${m.id}`) };
      },
      touchTarget: () => r.stage.scene,
      flags: () => ({ reducedMotion: deps.reducedMotion(), silent: deps.quiet() || !deps.soundOn() }),
    });

    // Giving the round back also gives back the scene: the 3D kit's GPU objects and the canvas.
    const release = (): void => {
      kit?.dispose();
      kit = null;
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

