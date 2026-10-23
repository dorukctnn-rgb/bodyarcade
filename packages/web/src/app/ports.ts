// What the shell needs from the other parts of the platform, as small interfaces. Each one has a stand-in here or in
// the demo code until the real module is wired; swapping it in is a change in boot.ts only.
import type { ActivateFailureCode, Hud, Plan, Session, Unsubscribe } from '../../../core/types/index.ts';
import type { ShellGame } from '../../catalogue/types.ts';
import type { SetupState } from '../views/setup.ts';

/** Who may use what. The real one is core/entitlements (builder S). */
export interface EntitlementsPort {
  plan(): Plan;
  onChange(cb: (plan: Plan) => void): Unsubscribe;
  /** A license key typed in by the player. Never throws. */
  activate(key: string): Promise<{ ok: true; plan: Plan } | { ok: false; code: ActivateFailureCode }>;
  /** Android only: ask Google Play for the purchases again. */
  restore?(): Promise<boolean>;
  /** Android only: start a purchase for a Play product id. */
  purchase?(productId: string): Promise<boolean>;
}

/** What the stage hands a session so it can draw the game and the player's own view. */
export interface StageHandles {
  /** The element the game's canvas goes into. */
  scene: HTMLElement;
  /** The self view (picture in picture); the HUD places and sizes it. */
  pip: HTMLElement;
  /** The mirror of a mirror game; the HUD places and sizes it. */
  mirror: HTMLElement;
  hud: Hud;
}

export interface SessionRequest {
  game: ShellGame;
  setup: SetupState;
  stage: StageHandles;
}

/**
 * Makes the contract's Session for a round, or null when games cannot run in this build (the shell then says so
 * honestly). The real factory builds core/loop's createSession with this shell's HUD, store and strings.
 */
export type SessionFactory = (r: SessionRequest) => Session | null;
