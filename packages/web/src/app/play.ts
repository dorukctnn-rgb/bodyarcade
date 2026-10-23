// Runs one round on the stage: the HUD, the panels before and between play, and the Session. The Session owns the camera,
// the calibration, the countdown and the loop; this listens to its events and shows what the player needs to see, and
// turns the player's presses (pause, resume, recalibrate, leave) into calls on it.
import type {
  CalibrationStatus, Framing, PauseReason, PlayerSlot, RunSummary, Session, SessionEvents, TwoPlayerCalibrationStatus, Unsubscribe,
} from '../../../core/types/index.ts';
import { PlayHud } from '../../../core/ui/hud/hud.ts';
import type { HudMode, PipPlacement } from '../../../core/ui/layout.ts';
import type { ShellGame } from '../../catalogue/types.ts';
import type { ViewContext } from '../context.ts';
import { overlayHtml, type CalibCheck, type PlayOverlay } from '../views/play.ts';
import type { SetupState } from '../views/setup.ts';
import type { StageHandles } from './ports.ts';

export interface PlayHost {
  document: Document;
  /** Fresh every call: the language or the settings may have changed. */
  context(): ViewContext;
  announce(text: string, o?: { assertive?: boolean }): void;
  toast(text: string): void;
  /** Asks "Leave this round?"; true to leave. */
  confirmLeave(): Promise<boolean>;
  /** Back to the game's page. */
  leave(): void;
  /** The round is over: show the results. */
  finish(game: ShellGame, setup: SetupState, summary: RunSummary): void;
  pipCorner(): PipPlacement;
  /** Moves the self view to the next corner (or hides it) and returns where it is now. */
  cyclePip(): PipPlacement;
  cameraExplained(): boolean;
  setCameraExplained(): void;
  /** The first round of a Pro game has started: the free round is used. */
  usedFreeRound(game: ShellGame): void;
  /** The setup changed during the round (keyboard instead of camera, seated instead): keep the address in step. */
  setupChanged(setup: SetupState): void;
}

export interface PlayControllerOptions {
  host: PlayHost;
  game: ShellGame;
  setup: SetupState;
  stage: HTMLElement;
  /** Builds the session once the HUD exists (the session draws into the stage handles). Null: games cannot run here. */
  makeSession(stage: StageHandles, setup: SetupState): Session | null;
}

const CAMERA_CODES = new Set(['denied', 'not_found', 'in_use', 'overconstrained', 'no_frames', 'insecure', 'unsupported', 'unknown']);

/** The HUD layout that fits a template: mirror games draw the camera as the scene, duels show the opponent. */
export function hudModeFor(game: ShellGame): HudMode {
  return game.template === 'target' || game.template === 'rhythm' ? 'mirror' : game.template === 'duel' ? 'live' : 'scene';
}

/** Which body parts a framing needs, in the order the panel lists them. */
export function partsFor(framing: Framing): CalibCheck['part'][] {
  return framing === 'full' ? ['head', 'hips', 'knees', 'feet'] : framing === 'upper' ? ['head', 'hips'] : ['head', 'hips', 'feet'];
}

/** Which of those parts are in view, from the calibration code. */
export function checksFor(framing: Framing, code: string): CalibCheck[] {
  const out: Record<string, CalibCheck['part'] | null> = { head_out: 'head', hips_out: 'hips', knees_out: 'knees', feet_out: 'feet' };
  const missing = out[code] ?? null;
  const nobody = code === 'no_person' || code === 'one_person' || code === 'too_close' || code === 'too_far';
  return partsFor(framing).map((part) => ({ part, ok: !nobody && part !== missing }));
}

function isTwo(s: CalibrationStatus | TwoPlayerCalibrationStatus): s is TwoPlayerCalibrationStatus {
  return 'players' in s;
}

export class PlayController {
  private readonly o: PlayControllerOptions;
  private readonly host: PlayHost;
  private readonly doc: Document;
  private readonly game: ShellGame;
  private setup: SetupState;
  private hud: PlayHud | null = null;
  private session: Session | null = null;
  private readonly offs: Unsubscribe[] = [];
  private readonly overlayEl: HTMLElement;
  private readonly hudEl: HTMLElement;
  private overlay: PlayOverlay | null = null;
  private pauseReason: PauseReason | null = null;
  private lastCalib = '';
  private disposed = false;
  private usedFree = false;
  private launching = false;
  private readonly keys: (e: KeyboardEvent) => void;
  private readonly visibility: () => void;

  constructor(o: PlayControllerOptions) {
    this.o = o;
    this.host = o.host;
    this.doc = o.host.document;
    this.game = o.game;
    this.setup = o.setup;
    this.overlayEl = o.stage.querySelector('[data-overlay]') as HTMLElement;
    this.hudEl = o.stage.querySelector('[data-hud-root]') as HTMLElement;
    this.keys = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const st = this.session?.state;
      if (st === 'running' || st === 'countdown') { e.preventDefault(); this.session?.pause('user'); }
      else if (st === 'paused' && this.pauseReason === 'user') { e.preventDefault(); void this.session?.resume(); }
    };
    this.visibility = () => { if (this.doc.hidden) this.session?.pause('hidden'); };
  }

  /** The words of the panels come from the current language. */
  private ctx(): ViewContext { return this.host.context(); }

  async begin(): Promise<void> {
    const stage = this.o.stage;
    const ctx = this.ctx();
    const cameraHost = stage.querySelector('[data-camera-host]') as HTMLElement;
    const scene = stage.querySelector('[data-scene]') as HTMLElement;
    const hud = new PlayHud({
      document: this.doc, root: this.hudEl, cameraHost, i18n: ctx.i18n, mode: hudModeFor(this.game), pipCorner: this.host.pipCorner(), duo: this.setup.players === 2,
      announce: (t, a) => this.host.announce(t, a), toast: (t) => this.host.toast(t),
      onPause: () => this.session?.pause('user'),
      onMovePip: () => hud.setPipCorner(this.host.cyclePip()),
    });
    this.hud = hud;
    hud.setPhase('calibrate');
    this.doc.addEventListener('keydown', this.keys);
    this.doc.addEventListener('visibilitychange', this.visibility);
    this.session = this.o.makeSession({ scene, pip: hud.pipHost, mirror: cameraHost, hud }, this.setup);
    if (!this.session) {
      this.show({ kind: 'error', message: ctx.i18n.t('play.unavailable') });
      return;
    }
    this.wire(this.session);
    if (this.setup.input === 'camera' && !(await this.cameraReady())) {
      this.show({ kind: 'camera-explainer' });
      return;
    }
    await this.launch();
  }

  /** The explainer is shown until the player has read it once and the browser has the camera allowed. */
  private async cameraReady(): Promise<boolean> {
    if (!this.host.cameraExplained()) return false;
    try {
      const status = await this.doc.defaultView?.navigator.permissions.query({ name: 'camera' as PermissionName });
      return status ? status.state === 'granted' : true;
    } catch {
      return true; // this browser cannot tell; the player has already read the explainer
    }
  }

  private wire(s: Session): void {
    const on = <K extends keyof SessionEvents>(k: K, cb: (e: SessionEvents[K]) => void): void => { this.offs.push(s.on(k, cb)); };
    on('state', (st) => this.onState(st));
    on('pause', (r) => this.onPause(r));
    on('countdown', ({ remaining }) => this.onCountdown(remaining));
    on('calibration', (c) => this.onCalibration(c));
    on('over', (summary) => this.host.finish(this.game, this.setup, summary));
    on('error', (e) => this.onError(e.code, e.message));
    on('player', (p) => this.onPlayer(p.player, p.present));
  }

  private async launch(): Promise<void> {
    const s = this.session;
    if (!s || this.launching) return;
    this.launching = true;
    this.show({ kind: 'loading' });
    try {
      await s.start(this.game.id, {
        mode: this.setup.players === 2 ? 'local2' : 'solo', difficulty: this.setup.difficulty, input: this.setup.input, seated: this.setup.seated,
      });
    } catch (e) {
      const code = (e as { code?: string }).code ?? 'unknown';
      this.onError(code, e instanceof Error ? e.message : String(e));
    } finally {
      this.launching = false;
    }
  }

  // ---- what the session says --------------------------------------------------------------------------------------------

  private onState(state: string): void {
    const hud = this.hud;
    if (!hud || this.disposed) return;
    switch (state) {
      case 'idle':
      case 'setup':
        hud.setPhase('calibrate');
        if (!this.overlay || this.overlay.kind === 'loading' || this.overlay.kind === 'countdown') this.show({ kind: 'loading' });
        break;
      case 'calibrating':
        hud.setPhase('calibrate');
        this.lastCalib = '';
        this.show({ kind: 'calibrating', framing: this.game.framing, two: this.setup.players === 2, message: '', checks: checksFor(this.game.framing, 'no_person'), progress: 0, slow: false });
        break;
      case 'countdown':
        hud.setPhase('play');
        this.host.announce(this.ctx().i18n.t('countdown.announce', { n: 3 }));
        this.show({ kind: 'countdown', n: 3 });
        break;
      case 'running':
        hud.setPhase('play');
        this.show(null);
        this.pauseReason = null;
        hud.setAway(null);
        if (!this.usedFree) { this.usedFree = true; this.host.usedFreeRound(this.game); }
        break;
      case 'results':
        this.show(null);
        break;
      default:
        break;
    }
  }

  private onPause(reason: PauseReason): void {
    this.pauseReason = reason;
    // A lost player is shown on the stage (their half dims and a plate asks them back); everything else gets a panel.
    if (reason === 'player_lost') return;
    this.show({ kind: 'paused', reason });
    if (reason !== 'user') this.host.announce(this.ctx().i18n.t(`pause.reason.${reason}` as 'pause.reason.user'), { assertive: reason === 'camera_ended' });
    else this.host.announce(this.ctx().i18n.t('hud.announce.paused'));
  }

  private onCountdown(n: number): void {
    if (this.disposed) return;
    if (n > 0) this.show({ kind: 'countdown', n });
    else if (this.overlay?.kind === 'countdown') this.show(null);
  }

  private onCalibration(c: CalibrationStatus | TwoPlayerCalibrationStatus): void {
    if (this.disposed || this.overlay?.kind !== 'calibrating') return;
    const i18n = this.ctx().i18n;
    const code = c.code;
    let message = '';
    if (isTwo(c) && c.guidance.action !== 'none') {
      const who = c.guidance.player ? i18n.t(c.guidance.player === 1 ? 'hud.player1' : 'hud.player2') : '';
      const key = `calib.guide.${c.guidance.action}`;
      if (i18n.has(key)) message = i18n.tx(key, { player: who });
    }
    if (!message && i18n.has(`calib.msg.${code}`)) message = i18n.tx(`calib.msg.${code}`);
    const checks = isTwo(c)
      ? checksFor(this.game.framing, c.players[1].code === 'ok' || c.players[1].code === 'hold' ? c.players[2].code : c.players[1].code)
      : checksFor(this.game.framing, code);
    const slow = code === 'too_slow';
    const stamp = `${message}|${checks.map((x) => (x.ok ? 1 : 0)).join('')}|${Math.round(c.progress * 20)}|${slow}`;
    if (stamp === this.lastCalib) return;
    this.lastCalib = stamp;
    this.overlay = { kind: 'calibrating', framing: this.game.framing, two: this.setup.players === 2, message, checks, progress: c.progress, slow };
    // Updated in place: the message is a live region, and a live region that is replaced is not spoken.
    const root = this.overlayEl;
    const msg = root.querySelector('[data-calib-msg]');
    if (msg && msg.textContent !== message) msg.textContent = message;
    for (const ch of checks) root.querySelector(`[data-calib-check="${ch.part}"]`)?.classList.toggle('is-ok', ch.ok);
    const meter = root.querySelector<HTMLProgressElement>('[data-calib-meter]');
    if (meter) meter.value = Math.round(c.progress * 100);
    const slowBox = root.querySelector<HTMLElement>('[data-calib-slow]');
    if (slowBox) slowBox.hidden = !slow;
  }

  private onError(code: string, message: string): void {
    if (this.disposed) return;
    if (CAMERA_CODES.has(code)) this.show({ kind: 'camera-error', code });
    else this.show({ kind: 'error', message: message || this.ctx().i18n.t('play.error.title') });
    this.host.announce(this.ctx().i18n.t('play.error.title'), { assertive: true });
  }

  private onPlayer(player: PlayerSlot, present: boolean): void {
    this.hud?.setAway(present ? null : player);
    if (!present) this.host.announce(this.ctx().i18n.t('hud.stepBackIn', { player: this.ctx().i18n.t(player === 1 ? 'hud.player1' : 'hud.player2') }));
  }

  // ---- what the player presses --------------------------------------------------------------------------------------

  /** Overlay buttons: data-action values from views/play.ts. Returns false for an action that is not this controller's. */
  action(name: string): boolean {
    const s = this.session;
    switch (name) {
      case 'camera-continue':
        this.host.setCameraExplained();
        void this.launch();
        return true;
      case 'camera-retry':
        void this.restart();
        return true;
      case 'use-keyboard':
        this.setup = { ...this.setup, input: 'keyboard', players: 1 };
        this.host.setupChanged(this.setup);
        void this.restart();
        return true;
      case 'seated-instead':
        this.setup = { ...this.setup, seated: true };
        this.host.setupChanged(this.setup);
        void this.restart();
        return true;
      case 'resume':
        void s?.resume();
        return true;
      case 'recalibrate':
        void s?.recalibrate();
        return true;
      case 'quit':
        void this.host.confirmLeave().then((yes) => { if (yes) this.host.leave(); });
        return true;
      default:
        return false;
    }
  }

  private async restart(): Promise<void> {
    this.session?.quit();
    this.hud?.setAway(null);
    await this.launch();
  }

  // ---- the overlay -------------------------------------------------------------------------------------------------

  private show(o: PlayOverlay | null): void {
    this.overlay = o;
    const root = this.overlayEl;
    if (!o) {
      root.replaceChildren();
      this.hudEl.inert = false;
      return;
    }
    const markup = overlayHtml(this.ctx(), this.game, o).value;
    // A countdown number replaces the previous one so its entrance plays again.
    root.innerHTML = markup;
    const modal = o.kind === 'camera-explainer' || o.kind === 'camera-error' || o.kind === 'paused' || o.kind === 'error';
    this.hudEl.inert = modal;
    if (modal) (root.querySelector<HTMLElement>('[autofocus]') ?? root.querySelector<HTMLElement>('button, a'))?.focus({ preventScroll: true });
  }

  /** Problems found in the HUD as it is drawn (tests and the screenshot tool). */
  problems(): string[] { return this.hud?.problems() ?? []; }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.doc.removeEventListener('keydown', this.keys);
    this.doc.removeEventListener('visibilitychange', this.visibility);
    for (const off of this.offs.splice(0)) off();
    this.session?.quit();
    this.hud?.dispose();
    this.overlayEl.replaceChildren();
    this.hudEl.inert = false;
  }
}
