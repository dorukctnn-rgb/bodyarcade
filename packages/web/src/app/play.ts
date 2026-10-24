// Runs one round on the stage: the HUD, the panels before and between play, and the Session. The Session owns the camera,
// the calibration, the countdown and the loop; this listens to its events and shows what the player needs to see, and
// turns the player's presses (pause, resume, recalibrate, leave) into calls on it.
import type {
  CalibrationStatus, PauseReason, PlayerSlot, RunSummary, Session, SessionEvents, TwoPlayerCalibrationStatus, Unsubscribe,
} from '../../../core/types/index.ts';
import { PlayHud, type HudLayoutInfo } from '../../../core/ui/hud/hud.ts';
import type { HudMode, PipPlacement } from '../../../core/ui/layout.ts';
import type { ShellGame } from '../../catalogue/types.ts';
import type { ViewContext } from '../context.ts';
import { overlayHtml, type CalibCheck, type CalibPart, type DeskCard, type GaugePos, type PlayOverlay, type ScreenFraming } from '../views/play.ts';
import { framingGuide } from '../views/silhouette.ts';
import type { SetupState } from '../views/setup.ts';
import {
  bandsFor, bothSeen, calibMessage, checksFor, deskCard, DeskOffer, extrasOf, gaugeFor, guideMessage, keepsChecks, needsHeadroom, screenFraming, STUCK_MS,
} from './calib.ts';
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
  /** The player chose to play at the desk: the mode stays on for the next rounds too (Settings turns it off). */
  deskChosen(): void;
  /** To the page with all the games. */
  home(): void;
  /** Milliseconds, from a clock that tests can move. */
  now?(): number;
}

export interface PlayControllerOptions {
  host: PlayHost;
  game: ShellGame;
  setup: SetupState;
  stage: HTMLElement;
  /** Builds the session once the HUD exists (the session draws into the stage handles). Null: games cannot run here. */
  makeSession(stage: StageHandles, setup: SetupState): Session | null;
  /** Called when the round is over or left, to give back what the session's scene held (the 3D kit, say). */
  release?(): void;
  /** The player has just read what the camera is for (the welcome tour's page does it): the camera is asked for without that panel again. */
  explained?: boolean;
}

const CAMERA_CODES = new Set(['denied', 'not_found', 'in_use', 'overconstrained', 'no_frames', 'insecure', 'unsupported', 'unknown']);

/** The HUD layout that fits a template: mirror games draw the camera as the scene, duels show the opponent. */
export function hudModeFor(game: ShellGame): HudMode {
  return game.template === 'target' || game.template === 'rhythm' ? 'mirror' : game.template === 'duel' ? 'live' : 'scene';
}

function isTwo(s: CalibrationStatus | TwoPlayerCalibrationStatus): s is TwoPlayerCalibrationStatus {
  return 'players' in s;
}

const RING = 163.4;

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
  private lastChecks: CalibCheck[] = [];
  private readonly deskOffer = new DeskOffer();
  private calibSince = 0;
  private stuck = false;
  private deskShown: DeskCard = 'none';
  private fellBack = false;
  private disposed = false;
  private usedFree = false;
  private launching = false;
  private guideObserver: ResizeObserver | null = null;
  private guide: { ready: boolean; bands: CalibPart[] } = { ready: false, bands: [] };
  private readonly layoutListeners = new Set<(info: HudLayoutInfo) => void>();
  private lastLayout: HudLayoutInfo | null = null;
  private videoHolder: HTMLElement | null = null;
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
      onLayout: (info) => this.layoutChanged(info),
    });
    this.hud = hud;
    hud.setPhase('calibrate');
    this.doc.addEventListener('keydown', this.keys);
    this.doc.addEventListener('visibilitychange', this.visibility);
    this.videoHolder = this.doc.createElement('div');
    this.videoHolder.className = 'ba-video-holder';
    cameraHost.append(this.videoHolder);
    this.session = this.o.makeSession({ scene, pip: hud.pipHost, mirror: cameraHost, hud, onLayout: (cb) => this.listenToLayout(cb) }, this.setup);
    if (!this.session) {
      this.show({ kind: 'error', message: ctx.i18n.t('play.unavailable') });
      return;
    }
    this.wire(this.session);
    if (this.setup.input === 'camera' && this.o.explained !== true && !(await this.cameraReady())) {
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
    on('video', ({ el }) => this.onVideo(el));
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
      case 'calibrating': {
        hud.setPhase('calibrate');
        this.lastCalib = '';
        this.deskOffer.reset();
        this.deskShown = 'none';
        this.fellBack = false;
        this.stuck = false;
        this.calibSince = this.clock();
        const framing = this.framing();
        this.lastChecks = checksFor(framing, 'no_person');
        this.show({
          kind: 'calibrating', framing, two: this.setup.players === 2, message: calibMessage(this.ctx().i18n, 'no_person', framing), checks: this.lastChecks,
          progress: 0, slow: false, gauge: 'none', desk: 'none', stuck: false, headroom: needsHeadroom(this.game),
        });
        break;
      }
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

  /** Whoever draws the game (the session's 2D kit) follows the HUD: it is told now and after every change. */
  private listenToLayout(cb: (info: HudLayoutInfo) => void): Unsubscribe {
    this.layoutListeners.add(cb);
    if (this.lastLayout) cb(this.lastLayout);
    return () => { this.layoutListeners.delete(cb); };
  }

  private layoutChanged(info: HudLayoutInfo): void {
    this.lastLayout = info;
    for (const cb of [...this.layoutListeners]) cb(info);
  }

  /**
   * The camera picture, from the session. A scene game shows it in the self view window, mirrored, here and nowhere else.
   * A mirror game draws the picture itself, so the element only has to keep playing: it sits in a holder that is
   * rendered (a hidden video is not always decoded) but a pixel big and see-through.
   */
  private onVideo(el: HTMLVideoElement | null): void {
    const host = this.hud?.pipHost;
    if (!host || this.disposed) return;
    if (hudModeFor(this.game) === 'mirror') {
      if (el) el.setAttribute('aria-hidden', 'true');
      this.videoHolder?.replaceChildren(...(el ? [el] : []));
      return;
    }
    if (el) {
      el.classList.add('ba-selfview');
      el.setAttribute('aria-hidden', 'true');
      host.replaceChildren(el);
    } else host.replaceChildren();
  }

  private clock(): number { return this.host.now ? this.host.now() : Date.now(); }

  /** The framing the screen shows: the game's own, or the desk once the round is a seated one. */
  private framing(): ScreenFraming { return screenFraming(this.game, this.setup.seated); }

  private onCalibration(c: CalibrationStatus | TwoPlayerCalibrationStatus): void {
    if (this.disposed || this.overlay?.kind !== 'calibrating') return;
    const i18n = this.ctx().i18n;
    const code = c.code;
    const framing = this.framing();
    let message = '';
    if (isTwo(c) && c.guidance.action !== 'none') message = guideMessage(i18n, c.guidance);
    if (!message) message = calibMessage(i18n, code, framing);
    const slow = code === 'too_slow';
    // What a newer platform measures itself (which parts are in view, that the wait is long); the code alone does without.
    const x = extrasOf(c);
    const seen = isTwo(c) ? bothSeen(extrasOf(c.players[1]).seen, extrasOf(c.players[2]).seen) : x.seen;
    const worst = isTwo(c) ? (c.players[1].code === 'ok' || c.players[1].code === 'hold' ? c.players[2].code : c.players[1].code) : code;
    // A device too slow to calibrate (or a code about the room rather than the body) says nothing about the parts: the checks stay as they were.
    const checks = keepsChecks(code) && !seen ? this.lastChecks : checksFor(framing, worst, seen);
    this.lastChecks = checks;
    const gauge = gaugeFor(code);
    const now = this.clock();
    // The desk is for one player at a time: two people in front of one camera are not at a desk.
    const offered = !isTwo(c) && this.setup.players === 1 ? this.deskOffer.push(code, now) : false;
    const desk = deskCard(offered, this.game, this.setup.seated);
    const stuck = x.escape === true || (c.progress < 0.25 && now - this.calibSince >= STUCK_MS);
    const bands = bandsFor(framing, worst, seen);
    const headroom = needsHeadroom(this.game);
    // The calibration ended with the best that could be measured and not what the game wanted: the round is played at the desk, and the player is told.
    if (c.ready && x.outcome === 'fallback' && !this.fellBack) {
      this.fellBack = true;
      const t = this.ctx().i18n;
      this.host.announce(t.t('calib.fallback'));
      this.host.toast(t.t('calib.fallback'));
    }
    const stamp = `${message}|${checks.map((y) => (y.ok ? 1 : 0)).join('')}|${Math.round(c.progress * 20)}|${slow}|${gauge}|${desk}|${stuck}|${bands.join(',')}`;
    if (stamp === this.lastCalib) return;
    this.lastCalib = stamp;
    this.overlay = { kind: 'calibrating', framing, two: this.setup.players === 2, message, checks, progress: c.progress, slow, gauge, desk, stuck, headroom };
    this.updateCalibration({ message, checks, slow, gauge, desk, stuck, bands });
    if (desk !== 'none' && this.deskShown === 'none') {
      const t = this.ctx().i18n;
      this.host.announce(desk === 'offer' ? `${t.t('calib.desk.title')} ${t.t('calib.desk.body')}` : t.t('calib.desk.standOnly'));
    }
    this.deskShown = desk;
  }

  /** Updated in place: the message is a live region, and a live region that is replaced is not spoken. */
  private updateCalibration(u: { message: string; checks: CalibCheck[]; slow: boolean; gauge: GaugePos; desk: DeskCard; stuck: boolean; bands: CalibPart[] }): void {
    const root = this.overlayEl;
    const i18n = this.ctx().i18n;
    const { checks, gauge } = u;
    const msg = root.querySelector('[data-calib-msg]');
    if (msg && msg.textContent !== u.message) msg.textContent = u.message;
    for (const ch of checks) root.querySelector(`[data-calib-check="${ch.part}"]`)?.classList.toggle('is-ok', ch.ok);
    const done = checks.filter((x) => x.ok).length;
    const ring = root.querySelector('[data-calib-ring]');
    if (ring) {
      const arc = ring.querySelector('[data-calib-arc]');
      arc?.setAttribute('stroke-dashoffset', (RING * (1 - (checks.length ? done / checks.length : 0))).toFixed(1));
      arc?.setAttribute('stroke', done === checks.length ? '#22C383' : '#FF4F6E');
      const label = i18n.t('calib.progress', { done, total: checks.length });
      ring.setAttribute('aria-label', label);
      const text = ring.querySelector('[data-calib-ringtext]');
      if (text) text.textContent = i18n.t('calib.done', { done, total: checks.length });
    }
    const gaugeEl = root.querySelector<HTMLElement>('[data-calib-gauge]');
    if (gaugeEl) {
      gaugeEl.dataset['pos'] = gauge;
      gaugeEl.hidden = gauge === 'none';
      const names = { close: i18n.t('calib.gauge.close'), good: i18n.t('calib.gauge.good'), far: i18n.t('calib.gauge.far') };
      gaugeEl.setAttribute('aria-label', i18n.t('calib.gauge.label', { state: gauge === 'none' ? '' : names[gauge] }));
    }
    const slowBox = root.querySelector<HTMLElement>('[data-calib-slow]');
    if (slowBox) slowBox.hidden = !u.slow;
    for (const card of root.querySelectorAll<HTMLElement>('[data-calib-desk]')) card.hidden = card.dataset['calibDesk'] !== u.desk;
    const keyboard = root.querySelector<HTMLElement>('[data-calib-keyboard]');
    if (keyboard) keyboard.hidden = !u.stuck;
    const ready = checks.length > 0 && done === checks.length;
    if (ready !== this.guide.ready || u.bands.join() !== this.guide.bands.join()) {
      this.guide = { ready, bands: u.bands };
      this.drawGuide();
    }
  }

  private drawGuide(): void {
    const view = this.overlayEl.querySelector<HTMLElement>('[data-cal-view]');
    const target = this.overlayEl.querySelector<HTMLElement>('[data-cal-guide]');
    if (!view || !target) return;
    const w = Math.round(view.clientWidth);
    const h = Math.round(view.clientHeight);
    if (w < 2 || h < 2) return;
    const t = this.ctx().i18n;
    const labels: Partial<Record<CalibPart, string>> = {};
    for (const part of this.guide.bands) labels[part] = t.tx(`calib.check.${part}`);
    target.innerHTML = framingGuide(w, h, { framing: this.framing(), ready: this.guide.ready, missing: this.guide.bands, labels, headroom: needsHeadroom(this.game) });
  }

  /**
   * What the error panel says: a sentence of the player's own language for the code, or the shell's own words when it threw
   * them itself (a scene that could not be drawn). What the platform writes for developers never reaches the player.
   */
  private errorText(code: string, message: string): string {
    const t = this.ctx().i18n;
    const own = t.t('play.error.scene');
    if (message !== '' && message === own) return own;
    const key = `play.err.${code}`;
    return t.has(key) ? t.tx(key) : t.t('play.error.title');
  }

  private onError(code: string, message: string): void {
    if (this.disposed) return;
    if (CAMERA_CODES.has(code)) this.show({ kind: 'camera-error', code });
    else this.show({ kind: 'error', message: this.errorText(code, message) });
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
        // Skip the framing and play this round seated: the player's settings are left as they are.
        this.setup = { ...this.setup, seated: true };
        this.host.setupChanged(this.setup);
        void this.restart();
        return true;
      case 'desk-play':
        // The way to play at the desk: this round and the next ones, until Settings turns it off.
        this.setup = { ...this.setup, seated: true };
        this.host.setupChanged(this.setup);
        this.host.deskChosen();
        this.host.announce(this.ctx().i18n.t('calib.desk.on'));
        void this.restart();
        return true;
      case 'desk-games':
        this.host.deskChosen();
        this.host.home();
        return true;
      case 'resume':
        void s?.resume();
        return true;
      case 'recalibrate':
        void s?.recalibrate();
        return true;
      case 'leave-now':
        this.host.leave();
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
    const wasCalibrating = this.overlay?.kind === 'calibrating';
    this.overlay = o;
    const root = this.overlayEl;
    if (wasCalibrating && o?.kind !== 'calibrating') {
      this.guideObserver?.disconnect();
      this.guideObserver = null;
      this.hud?.attachPipTo(null);
    }
    if (!o) {
      root.replaceChildren();
      this.hudEl.inert = false;
      return;
    }
    root.innerHTML = overlayHtml(this.ctx(), this.game, o).value;
    const modal = o.kind === 'camera-explainer' || o.kind === 'camera-error' || o.kind === 'paused' || o.kind === 'error';
    this.hudEl.inert = modal || o.kind === 'calibrating';
    if (modal) (root.querySelector<HTMLElement>('[autofocus]') ?? root.querySelector<HTMLElement>('button, a'))?.focus({ preventScroll: true });
    if (o.kind === 'calibrating') this.startCalibrationView(o);
  }

  /** While getting into frame the camera picture fills the view of the calibration screen. */
  private startCalibrationView(o: Extract<PlayOverlay, { kind: 'calibrating' }>): void {
    const view = this.overlayEl.querySelector<HTMLElement>('[data-cal-view]');
    if (!view) return;
    this.hud?.attachPipTo(view);
    const done = o.checks.filter((c) => c.ok).length;
    this.guide = { ready: o.checks.length > 0 && done === o.checks.length, bands: bandsFor(o.framing, 'no_person') };
    this.drawGuide();
    if (typeof ResizeObserver !== 'undefined') {
      this.guideObserver?.disconnect();
      this.guideObserver = new ResizeObserver(() => this.drawGuide());
      this.guideObserver.observe(view);
    }
  }

  /** A round is on (calibrating, counting down, playing or paused): leaving it drops the score, so the player is asked first. */
  isLive(): boolean {
    const st = this.session?.state;
    return !this.disposed && (st === 'calibrating' || st === 'countdown' || st === 'running' || st === 'paused');
  }

  /** Pauses the round while the player is asked whether to leave it (a round that is paused already stays so). */
  holdForLeave(): void {
    const st = this.session?.state;
    if (st === 'running' || st === 'countdown') this.session?.pause('user');
  }

  /** Problems found in the HUD as it is drawn (tests and the screenshot tool). */
  problems(): string[] { return this.hud?.problems() ?? []; }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.doc.removeEventListener('keydown', this.keys);
    this.doc.removeEventListener('visibilitychange', this.visibility);
    for (const off of this.offs.splice(0)) off();
    this.guideObserver?.disconnect();
    this.session?.quit();
    this.layoutListeners.clear();
    this.videoHolder?.remove();
    this.videoHolder = null;
    this.hud?.dispose();
    this.o.release?.();
    this.overlayEl.replaceChildren();
    this.hudEl.inert = false;
  }
}
