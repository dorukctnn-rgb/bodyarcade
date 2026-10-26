// The welcome tour in the browser: it keeps what the player chose, draws the panel of each page, runs the 3D stage (and gives way to
// the pre-rendered pictures on a device that cannot draw it), and hands the player to the real calibration and the real first game
// when the last page is read. The words and the markup are views/welcome.ts; the rules (steps, choices, what is kept, who is taken
// here, when the stage steps down a tier) are welcome-model.ts. This file is only the DOM and the clock.
import type { Stage, StageLabels } from '../../../../design/onboarding/scene.mjs';
import type { Settings } from '../../../core/ui/settings.ts';
import type { ViewContext } from '../context.ts';
import { deviceText, welcomePanel, welcomeTop } from '../views/welcome.ts';
import {
  backStep, initialTour, judgeStage, nextStep, settingsPatch, startTier, toggleRegion, withDevice, withLevel, withPlayers, type StageTier, type TourState, type TourStep,
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
  /** 'static' draws the stage once and keeps it still, 'fallback' shows the pre-rendered pictures (tests and pictures). */
  hook(): 'static' | 'fallback' | 'first' | undefined;
  /** The home page address, for the skip. */
  homeHref(): string;
}

type SceneModule = typeof import('../../../../design/onboarding/scene.mjs');

const theme = (host: WelcomeHost): 'light' | 'dark' => {
  const set = host.settings().theme;
  if (set !== 'system') return set;
  return host.document.defaultView?.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export class WelcomeController {
  private state: TourState;
  private stage: Stage | null = null;
  private starting: Promise<void> | null = null;
  private fallback = false;
  private disposed = false;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private root!: HTMLElement;
  private panel!: HTMLElement;
  private canvas!: HTMLCanvasElement;
  private poster!: HTMLImageElement;
  private loop!: HTMLVideoElement;
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
    this.canvas = root.querySelector('[data-canvas]') as HTMLCanvasElement;
    this.poster = root.querySelector('[data-poster]') as HTMLImageElement;
    this.loop = root.querySelector('[data-loop]') as HTMLVideoElement;
    this.overlay = root.querySelector('[data-overlay]') as HTMLElement;
    this.fallback = this.host.hook() === 'fallback';
    this.drawStageFor(this.state.step);
    await this.ensureStage();
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
    this.stage?.dispose();
    this.stage = null;
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
        this.stage?.setRegions(this.state.regions);
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
        this.stage?.setDevice(this.state.device);
        return true;
      case 'tour-players':
        this.state = withPlayers(this.state, el.value === '2' ? 2 : 1, ctx.caps.local2);
        this.drawPanel(false);
        this.panel.querySelector<HTMLElement>(`input[name="tour-players"][value="${this.state.players}"]`)?.focus({ preventScroll: true });
        this.stage?.setPlayers(this.state.players);
        this.stage?.setDevice(this.state.device);
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

  /** What the stage shows for a step: the pre-rendered picture where the 3D scene is not drawn, and the labels over the picture. */
  private drawStageFor(step: TourStep): void {
    this.overlay.replaceChildren();
    const ctx = this.host.context();
    const t = ctx.i18n;
    if (step === 5) {
      this.overlay.innerHTML = `<div class="ob-finder"><i></i><i></i><i></i><i></i><em>${LOCK}${escapeText(t.t('onboarding.finder'))}</em></div>`;
    }
    this.stageEl.classList.toggle('is-fallback', this.fallback);
    this.canvas.style.display = this.fallback ? 'none' : '';
    this.showPictures(step);
    if (this.stage && !this.fallback) {
      this.stage.setRegions(this.state.regions);
      this.stage.setDevice(this.state.device);
      this.stage.setPlayers(step === 4 ? this.state.players : 1);
      this.stage.setStep(step, { instant: this.host.hook() === 'static', logoBand: step === 1 });
      if (this.host.hook() === 'static') this.stage.renderAt(1.7);
    }
  }

  /** A device that cannot draw the stage: the opening loop on the first page (a still when motion is reduced), a still for the others. */
  private showPictures(step: TourStep): void {
    const ctx = this.host.context();
    const th = theme(this.host);
    const still = this.host.reducedMotion() || this.host.hook() === 'static';
    const useLoop = this.fallback && step === 1 && !still;
    this.loop.style.display = useLoop ? 'block' : 'none';
    this.poster.style.display = this.fallback && !useLoop ? 'block' : 'none';
    if (useLoop && !this.loop.currentSrc && !this.loop.querySelector('source')) {
      this.loop.poster = ctx.assets.onboarding(`hero-${th}.avif`);
      for (const [ext, type] of [['webm', 'video/webm'], ['mp4', 'video/mp4']] as const) {
        const source = this.host.document.createElement('source');
        source.src = ctx.assets.onboarding(`hero-loop-${th}.${ext}`);
        source.type = type;
        this.loop.append(source);
      }
      this.loop.load();
      void this.loop.play().catch(() => undefined);
    }
    if (this.fallback && !useLoop) this.poster.src = ctx.assets.onboarding(`step-${step}-${th}.webp`);
  }

  private ensureStage(): Promise<void> {
    if (this.stage || this.fallback) return Promise.resolve();
    this.starting ??= this.startStage();
    return this.starting;
  }

  private async startStage(): Promise<void> {
    const nav = this.host.document.defaultView?.navigator as (Navigator & { deviceMemory?: number }) | undefined;
    const still = this.host.hook() === 'static';
    try {
      const scene: SceneModule = await import('../../../../design/onboarding/scene.mjs');
      if (this.disposed) return;
      const tier = startTier({ ...(nav?.hardwareConcurrency ? { cores: nav.hardwareConcurrency } : {}), ...(nav?.deviceMemory ? { memoryGb: nav.deviceMemory } : {}) });
      this.stage = scene.createStage(this.canvas, {
        theme: theme(this.host), step: this.state.step, capture: still, tier: still ? 1 : tier, reducedMotion: this.host.reducedMotion(),
        onLabels: (l) => this.drawLabels(l),
      });
      this.canvas.addEventListener('webglcontextlost', () => this.giveWay(), { once: true });
    } catch {
      // No WebGL, or the scene could not be built: the pictures made of the same scene stand in.
      this.giveWay();
      return;
    }
    this.drawStageFor(this.state.step);
    if (!still) {
      this.stage?.start();
      this.timers.push(setTimeout(() => this.judge(), 1500));
    }
  }

  /** The 3D stage is not drawn here (or no longer): its canvas goes and the pre-rendered picture of the page comes. */
  private giveWay(): void {
    if (this.disposed) return;
    this.fallback = true;
    this.stage?.stop();
    this.drawStageFor(this.state.step);
  }

  /** After 90 frames the stage looks at its own cost: a lighter tier, or the pictures. */
  private judge(): void {
    const stage = this.stage;
    if (!stage || this.disposed || this.fallback) return;
    const s = stage.stats();
    const verdict = judgeStage({ frames: s.frames, p95: s.p95, tier: s.tier });
    if (verdict === 'wait') { this.timers.push(setTimeout(() => this.judge(), 500)); return; }
    if (verdict === 'lower') {
      stage.setTier((stage.tier - 1) as StageTier);
      stage.resetStats();
      this.timers.push(setTimeout(() => this.judge(), 1500));
    } else if (verdict === 'fallback') this.giveWay();
  }

  /** The labels of the space page sit over the 3D scene where the scene says (the stage reports them every frame). */
  private drawLabels(l: StageLabels | null): void {
    if (!l || this.disposed) return;
    const t = this.host.context().i18n;
    const W = this.stageEl.clientWidth;
    const H = this.stageEl.clientHeight;
    const duo = l.players === 2;
    const put = (id: string, p: { x: number; y: number }, text: string, cls = ''): void => {
      let n = this.overlay.querySelector<HTMLElement>(`#${id}`);
      if (!n) { n = this.host.document.createElement('div'); n.id = id; this.overlay.append(n); }
      n.className = `ob-tag3d ${cls}`;
      n.textContent = text;
      n.style.left = `${Math.min(W - 70, Math.max(70, p.x * W))}px`;
      n.style.top = `${Math.max(36, p.y * H - 8)}px`;
    };
    put('t-dist', l.distance, t.t(duo ? 'onboarding.tag.distance.two' : 'onboarding.tag.distance'));
    put('t-dev', l.device, duo ? t.t('onboarding.tag.camera.two') : t.t(this.state.device === 'laptop' ? 'onboarding.tag.feet' : 'onboarding.tag.hip'), 'flush');
    put('t-space', l.space, t.t(duo ? 'onboarding.tag.apart' : 'onboarding.tag.clear'));
    // Labels that touch are pushed apart.
    const tags = [...this.overlay.querySelectorAll<HTMLElement>('.ob-tag3d')];
    for (let i = 0; i < tags.length; i++) {
      for (let j = 0; j < i; j++) {
        const a = (tags[i] as HTMLElement).getBoundingClientRect();
        const b = (tags[j] as HTMLElement).getBoundingClientRect();
        if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) {
          (tags[i] as HTMLElement).style.top = `${Number.parseFloat((tags[i] as HTMLElement).style.top) + (b.bottom - a.top) + 6}px`;
        }
      }
    }
  }
}

const LOCK = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="3" y="7" width="10" height="7" rx="2" fill="currentColor"/><path d="M5.5 7V5.2a2.5 2.5 0 015 0V7" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
const escapeText = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
