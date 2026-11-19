// The welcome tour in the browser: it keeps what the player chose, draws the panel of each page, plays the stage (a real person doing
// the page's moves with our body line, app/motion-cards.ts MotionPlayer; the poster stays for reduced motion, saving data, a weak device
// or a script), and hands the player to the real calibration and the real first game when the last page is read. The words and the markup are views/welcome.ts; the rules (steps, choices, what is kept, who is taken
// here, when the stage steps down a tier) are welcome-model.ts. This file is only the DOM and the clock.
import type { BodyRegion } from '../../../core/types/index.ts';
import type { Settings } from '../../../core/ui/settings.ts';
import type { ViewContext } from '../context.ts';
import { type ClipConnection } from '../clips.ts';
import { coverBox, pointIndex, poseAt } from '../hero-pose.ts';
import { motionAllowed, tourClips, type MotionId } from '../motion.ts';
import { deviceText, tourMedia, welcomePanel, welcomeTop } from '../views/welcome.ts';
import { loadPopFont } from './body-line.ts';
import { loadMotionPose, motionFormat, MotionPlayer, weakDevice } from './motion-cards.ts';
import {
  backStep, initialTour, isAutomated, nextStep, settingsPatch, toggleRegion, withDevice, withLevel, withPlayers, type TourState, type TourStep,
} from './welcome-model.ts';

export interface WelcomeHost {
  document: Document;
  /** Fresh every call: the language or the settings may have changed. */
  context(): ViewContext;
  settings(): Readonly<Settings>;
  saveSettings(patch: Partial<Settings>): void;
  /** The address of a step of the tour in the page language. */
  stepHref(step: TourStep): string;
  /** The address of the real first game (the play page, the calibration and a round of 30 seconds). */
  firstGameHref(s: TourState): string;
  go(href: string, o?: { replace?: boolean }): void;
  /** The camera explainer was read here: the play page does not show its own. */
  cameraExplained(): void;
  announce(text: string): void;
  reducedMotion(): boolean;
  /** 'static' holds the stage on one frame of its clip, 'fallback' keeps the posters (tests and pictures); 'first' plays as for a visitor. */
  hook(): 'static' | 'fallback' | 'first' | undefined;
  /** The home page address, for the skip. */
  homeHref(): string;
}

/** Seconds each clip of the first page stays before the next one comes (about one loop of each). */
const SEQUENCE_SECONDS = 4.2;
/** The moment a held stage shows ('static'): a moment of the move, not its first frame. */
const HOLD_AT = 1.2;

export class WelcomeController {
  private state: TourState;
  private player: MotionPlayer | null = null;
  /** The start of the clip on the stage (a held frame for a test): begin() waits for it before the page says it is ready. */
  private playerReady: Promise<void> | null = null;
  private clip: MotionId | null = null;
  private seq = 0;
  private seqTimer: ReturnType<typeof setTimeout> | null = null;
  private lastRegion: BodyRegion | null = null;
  private moving = false;
  private disposed = false;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private root!: HTMLElement;
  private panel!: HTMLElement;
  private overlay!: HTMLElement;
  private stageEl!: HTMLElement;

  private readonly host: WelcomeHost;

  constructor(host: WelcomeHost, step: TourStep) {
    this.host = host;
    this.state = initialTour(host.settings(), { step, bigScreen: host.context().caps.local2 });
  }

  /** What the page is drawn from (the first draw and every redraw of the panel). */
  tour(): TourState { return this.state; }

  // ---- start and stop ------------------------------------------------------------------------------------------------------

  /** The page is in the document: the parts are found, and the stage is started for the step. */
  async begin(): Promise<void> {
    const doc = this.host.document;
    const root = doc.querySelector<HTMLElement>('[data-welcome]');
    if (!root) return;
    this.root = root;
    this.panel = root.querySelector('[data-panel]') as HTMLElement;
    this.stageEl = root.querySelector('[data-stage]') as HTMLElement;
    this.overlay = root.querySelector('[data-overlay]') as HTMLElement;
    const win = this.host.document.defaultView;
    const hook = this.host.hook();
    const nav = win?.navigator as (Navigator & { connection?: ClipConnection }) | undefined;
    // the stage moves for a visitor; for reduced motion, saving data, a weak device, a crawler or a script the posters stay
    this.moving = !!win && hook !== 'fallback' && (hook === 'static' || hook === 'first' || motionAllowed({
      reducedMotion: this.host.reducedMotion(), connection: nav?.connection,
      automated: isAutomated({ userAgent: nav?.userAgent ?? '', webdriver: nav?.webdriver === true }), weak: weakDevice(win),
    }));
    if (win) loadPopFont(this.host.document, () => undefined);
    this.clip = (this.stageEl.dataset['clip'] as MotionId | undefined) ?? null;
    this.drawStageFor(this.state.step);
    await (this.playerReady ?? (this.playerReady = this.startPlayer()));
    this.settle();
  }

  /** The window changed its shape: the choice of one or two players depends on it. */
  refresh(): void {
    if (this.disposed || !this.panel) return;
    this.state = withPlayers(this.state, this.state.players, this.host.context().caps.local2);
    this.drawPanel(false);
  }

  dispose(): void {
    this.disposed = true;
    for (const t of this.timers.splice(0)) clearTimeout(t);
    if (this.seqTimer) clearTimeout(this.seqTimer);
    this.player?.dispose();
    this.player = null;
  }

  /** For tests: the stage is ready (or the pictures are) and the page has settled. */
  private settle(): void {
    this.root.dataset['ready'] = '1';
  }

  // ---- the pages ------------------------------------------------------------------------------------------------------------

  /** The tour is on another page (the address changed): the panel and the stage follow. */
  show(step: TourStep): void {
    if (this.disposed || step === this.state.step) return;
    this.state = { ...this.state, step };
    this.drawPanel(true);
    this.drawStageFor(step);
    this.host.announce(this.panel.querySelector('.ob-title')?.textContent ?? '');
  }

  private drawPanel(focusTitle: boolean): void {
    const ctx = this.host.context();
    this.root.dataset['step'] = String(this.state.step);
    this.panel.innerHTML = welcomePanel(ctx, this.state).value;
    this.stageEl.querySelector('.ob-top')?.remove();
    if (this.state.step === 1) {
      this.stageEl.insertAdjacentHTML('beforeend', welcomeTop(ctx, 1).value);
    }
    const scroll = this.panel.querySelector<HTMLElement>('.ob-scroll');
    if (scroll) this.timers.push(setTimeout(() => scroll.classList.toggle('is-clipped', scroll.scrollHeight > scroll.clientHeight + 4), 0));
    if (focusTitle) this.panel.querySelector<HTMLElement>('.ob-title')?.focus({ preventScroll: true });
  }

  // ---- what the player does ------------------------------------------------------------------------------------------------------

  action(name: string, el: HTMLElement): boolean {
    switch (name) {
      case 'tour-next': this.next(); return true;
      case 'tour-back': this.host.go(this.host.stepHref(backStep(this.state.step)), { replace: false }); return true;
      case 'tour-skip':
        this.host.saveSettings({ onboardingDone: true });
        this.host.go(this.host.homeHref(), { replace: true });
        return true;
      case 'tour-region': {
        this.state = toggleRegion(this.state, el.dataset['region'] ?? '');
        const on = this.state.regions.includes((el.dataset['region'] ?? '') as never);
        el.setAttribute('aria-pressed', String(on));
        if (on) this.lastRegion = (el.dataset['region'] ?? null) as BodyRegion | null;
        this.drawStageFor(this.state.step);
        return true;
      }
      default: return false;
    }
  }

  /** A radio or a switch of the tour changed. */
  change(el: HTMLInputElement): boolean {
    const ctx = this.host.context();
    switch (el.name) {
      case 'tour-level':
        this.state = withLevel(this.state, el.value);
        this.root.querySelector('[data-level-desc]')?.replaceChildren(`${ctx.i18n.tx(`onboarding.level.${this.state.level}.desc`)}.`);
        return true;
      case 'tour-seated': this.state = { ...this.state, seated: el.checked }; return true;
      case 'tour-quiet': this.state = { ...this.state, quiet: el.checked }; return true;
      case 'tour-device':
        this.state = withDevice(this.state, el.value as TourState['device']);
        this.root.querySelector('[data-device-text]')?.replaceChildren(deviceText(ctx, this.state));
        this.drawLabels();
        return true;
      case 'tour-players':
        this.state = withPlayers(this.state, el.value === '2' ? 2 : 1, ctx.caps.local2);
        this.drawPanel(false);
        this.panel.querySelector<HTMLElement>(`input[name="tour-players"][value="${this.state.players}"]`)?.focus({ preventScroll: true });
        this.drawLabels();
        return true;
      default: return false;
    }
  }

  private next(): void {
    const n = nextStep(this.state.step);
    if (n !== 'play') { this.host.go(this.host.stepHref(n)); return; }
    // The last page: what was chosen is kept, the camera explainer counts as read, and the real calibration and first game begin.
    this.host.saveSettings({ ...settingsPatch(this.state), onboardingDone: true });
    this.host.cameraExplained();
    this.host.go(this.host.firstGameHref(this.state));
  }

  // ---- the stage ----------------------------------------------------------------------------------------------------------------

  /** What the stage shows for a step: the person of the page (the clip changes when the page asks for another one) and the labels. */
  private drawStageFor(step: TourStep): void {
    const t = this.host.context().i18n;
    this.overlay.replaceChildren();
    if (step === 5) {
      this.overlay.innerHTML = `<div class="ob-finder"><i></i><i></i><i></i><i></i><em>${LOCK}${escapeText(t.t('onboarding.finder'))}</em></div>`;
    }
    const clips = tourClips(step, this.state.regions, this.lastRegion);
    if (step !== 1) { this.seq = 0; if (this.seqTimer) { clearTimeout(this.seqTimer); this.seqTimer = null; } }
    const want = clips[step === 1 ? this.seq % clips.length : 0];
    if (want && want !== this.clip) this.swapClip(want, step);
    else this.syncMediaFlags(step);
    this.drawLabels();
  }

  /** The page's flags on the clip that stays (the pops on the first page, the 33 points on the second). */
  private syncMediaFlags(step: TourStep): void {
    const el = this.stageEl.querySelector<HTMLElement>('.k-mo');
    if (!el) return;
    el.toggleAttribute('data-mo-pops', step === 1);
    el.toggleAttribute('data-mo-all', step === 2);
  }

  /** Another person on the stage: the new poster replaces the old clip, and plays as soon as its clip is in. */
  private swapClip(id: MotionId, step: TourStep): void {
    const ctx = this.host.context();
    const old = this.stageEl.querySelector<HTMLElement>('.k-mo');
    const tpl = this.host.document.createElement('template');
    tpl.innerHTML = tourMedia(ctx, id, step).value;
    const el = tpl.content.firstElementChild as HTMLElement | null;
    if (!el) return;
    this.clip = id;
    this.stageEl.dataset['clip'] = id;
    this.player?.dispose();
    this.player = null;
    if (old) old.replaceWith(el); else this.stageEl.prepend(el);
    if (!this.disposed) this.playerReady = this.startPlayer();
  }

  /** Plays the clip on the stage (or holds one moment of it, or leaves the poster: see begin()). */
  private async startPlayer(): Promise<void> {
    if (this.player || this.disposed || !this.moving) return;
    const win = this.host.document.defaultView;
    const el = this.stageEl.querySelector<HTMLElement>('.k-mo');
    if (!win || !el) return;
    const video = el.querySelector('video');
    const format = video ? motionFormat(video) : null;
    if (!format) return;
    const t = this.host.context().i18n;
    const player = new MotionPlayer(el, win, { combo: t.t('home.hero.combo', { n: '{n}' }), perfect: t.t('home.hero.perfect'), lang: this.host.document.documentElement.lang });
    this.player = player;
    if (this.host.hook() === 'static') { await player.hold(format, HOLD_AT); return; }
    await player.play(format);
    if (this.state.step === 1 && !this.disposed && this.player === player) {
      if (this.seqTimer) clearTimeout(this.seqTimer);
      this.seqTimer = setTimeout(() => {
        this.seqTimer = null;
        if (this.disposed || this.state.step !== 1) return;
        this.seq += 1;
        this.drawStageFor(1);
      }, SEQUENCE_SECONDS * 1000);
    }
  }

  /**
   * The labels of the space page (step 4), placed by the person in the poster's frame: where the camera goes (hip height, or the floor for
   * a laptop) beside the hips, the clear space round the feet (a ring on the floor) and the distance to the camera below them.
   */
  private drawLabels(): void {
    this.overlay.querySelectorAll('.ob-tag3d, .ob-floor').forEach((n) => n.remove());
    if (this.state.step !== 4 || !this.clip) return;
    const win = this.host.document.defaultView;
    const url = this.stageEl.querySelector<HTMLElement>('.k-mo')?.dataset['moPose'];
    if (!win || !url) return;
    const clip = this.clip;
    void loadMotionPose(url, win).then((pose) => {
      if (!pose || this.disposed || this.state.step !== 4 || this.clip !== clip) return;
      const W = this.stageEl.clientWidth, H = this.stageEl.clientHeight;
      const box = coverBox(W, H, 720, 900, 0.5, 0.5);
      const q = poseAt(pose, 0);
      const at = (n: Parameters<typeof pointIndex>[1]): [number, number] => { const k = pointIndex(pose, n) * 2; return [box.x + (q[k] ?? 0) * box.w, box.y + (q[k + 1] ?? 0) * box.h]; };
      const t = this.host.context().i18n;
      const duo = this.state.players === 2;
      const [hlx, hly] = at('hipL'), [hrx, hry] = at('hipR');
      const [alx, aly] = at('ankleL'), [arx, ary] = at('ankleR');
      const cx = (alx + arx) / 2, fy = Math.max(aly, ary);
      const span = Math.max(80, Math.abs(hlx - hrx) * 4.2);
      const floor = this.host.document.createElement('div');
      floor.className = 'ob-floor';
      Object.assign(floor.style, { left: `${cx - span / 2}px`, top: `${fy - span * 0.12}px`, width: `${span}px`, height: `${span * 0.28}px` });
      this.overlay.append(floor);
      const put = (text: string, x: number, y: number, cls = ''): void => {
        const n = this.host.document.createElement('div');
        n.className = `ob-tag3d ${cls}`;
        n.textContent = text;
        n.style.left = `${Math.min(W - 80, Math.max(80, x))}px`;
        n.style.top = `${Math.min(H - 12, Math.max(40, y))}px`;
        this.overlay.append(n);
      };
      const hipY = (hly + hry) / 2;
      put(duo ? t.t('onboarding.tag.camera.two') : t.t(this.state.device === 'laptop' ? 'onboarding.tag.feet' : 'onboarding.tag.hip'), Math.min(hlx, hrx) - span * 0.45, this.state.device === 'laptop' && !duo ? fy : hipY, 'flush');
      put(t.t(duo ? 'onboarding.tag.apart' : 'onboarding.tag.clear'), cx + span * 0.38, fy - span * 0.16);
      put(t.t(duo ? 'onboarding.tag.distance.two' : 'onboarding.tag.distance'), cx, fy + span * 0.3);
    });
  }
}

const LOCK = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="3" y="7" width="10" height="7" rx="2" fill="currentColor"/><path d="M5.5 7V5.2a2.5 2.5 0 015 0V7" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
const escapeText = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
