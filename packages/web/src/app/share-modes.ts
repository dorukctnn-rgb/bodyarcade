// The share clip and the two modes of the results and the stage, kept out of the app's own class so that it only calls in: the vertical
// clip of a round (story-clip.ts: made when the player asks, shared or saved), the family evening (family.ts: its rounds, its board) and
// the short rounds both modes play (short-round.ts: the desk break's 45 seconds, a family round's minute).
import type { BodyArcadeStore } from '../../../core/store/store.ts';
import type { I18n } from '../../../core/ui/i18n/index.ts';
import { localized } from '../../../core/ui/i18n/localized.ts';
import type { ShellGame } from '../../catalogue/types.ts';
import { supportsLocal2 } from '../../catalogue/filter.ts';
import { durationLabel, titleOf, type ViewContext } from '../context.ts';
import type { RoundResult } from '../views/results.ts';
import { familyHref } from '../views/family.ts';
import { formatClock } from '../views/results.ts';
import { CLIP_BRAND } from './clip.ts';
import { createFamilyBook, modeFor, type FamilyBook, type FamilyMode, type FamilySetId, type FamilyView, FAMILY_ROUND_SEC, FAMILY_SET_IDS } from './family.ts';
import { storyMoveOf } from './story-pose.ts';
import { recordStory, storyDeps, storyFileName, storyPoseAt, FIGURE_BOX, STORY_MS, type StoryInput, type StoryText } from './story-clip.ts';

export interface ShareModesHost {
  win: Window & typeof globalThis;
  doc: Document;
  store(): BodyArcadeStore;
  games(): readonly ShellGame[];
  can(feature: string): boolean;
  ctx(): ViewContext;
  go(href: string): void;
  toast(text: string, o?: { kind?: 'warn' }): void;
  reducedMotion(): boolean;
  /** The profile may share at all (a child's may not). */
  share(): boolean;
  result(): RoundResult | null;
  /** The address of the round's highlight clip, when there is one (the game view, recorded on this device). */
  highlightUrl(): string | null;
  rerender(): void;
  /** The player pressed something that starts a round: the page asks for full screen, the sound wakes up. */
  gesture?(): void;
}

/** A remembered choice of the family page: together or turns. */
const MODE_KEY = 'familyMode';

export class ShareModes {
  private readonly h: ShareModesHost;
  /** The round on the stage belongs to the family evening. */
  private familyRound = false;
  private storyBlob: Blob | null = null;
  private storyUrl: string | null = null;
  private storyName = '';
  private storyMime = '';
  private making = false;
  private storyToken = 0;
  /** What the clip's figure was drawn with: the 3D figure, or the flat one where this device cannot draw it (the card says it, for tests and a look in the inspector). */
  private storyFigure: '3d' | 'flat' | null = null;

  constructor(host: ShareModesHost) {
    this.h = host;
  }

  // ---- the family evening ------------------------------------------------------------------------------------------------

  book(): FamilyBook {
    const games = this.h.games();
    return createFamilyBook(this.h.store(), {
      games: () => games.map((g) => ({ id: g.id, local2: supportsLocal2(g) })),
      can: (f) => this.h.can(f),
      isFree: (id) => games.find((g) => g.id === id)?.free === true,
    });
  }

  /** What the family page draws: the evening that is going and the way of playing chosen last. */
  familyData(): { active: FamilyView | null; mode: FamilyMode | null } {
    let mode: FamilyMode | null = null;
    try {
      const raw = this.h.win.localStorage.getItem(`ba2.shell.${MODE_KEY}`);
      mode = raw === 'together' || raw === 'turns' ? raw : null;
    } catch { mode = null; }
    return { active: this.book().active(), mode };
  }

  private rememberMode(mode: FamilyMode): void {
    try { this.h.win.localStorage.setItem(`ba2.shell.${MODE_KEY}`, mode); } catch { /* a browser that keeps nothing */ }
  }

  /** The player starts an evening of a set, the way the page's picker says (or the device's default). */
  startFamily(setId: string, asked: string | null): void {
    const ctx = this.h.ctx();
    if (!(FAMILY_SET_IDS as readonly string[]).includes(setId)) return;
    const mode = modeFor(asked, ctx.caps.local2);
    this.rememberMode(mode);
    const r = this.book().start(setId as FamilySetId, mode);
    if (!r.ok) {
      if (r.code === 'locked') this.h.go(ctx.href('pro'));
      else this.h.toast(ctx.i18n.t('plans.noGames'), { kind: 'warn' });
      return;
    }
    const href = r.view.current ? familyHref(ctx, r.view.current.game, mode) : null;
    if (!href) { this.book().abandon(); this.h.toast(ctx.i18n.t('plans.noGames'), { kind: 'warn' }); return; }
    this.h.gesture?.();
    this.h.go(href);
  }

  leaveFamily(): void {
    this.book().abandon();
    const r = this.h.result();
    if (r?.family) r.family = null;
    this.h.toast(this.h.ctx().i18n.t('family.left'));
    this.h.rerender();
  }

  /**
   * The round that is starting: whether it is the family evening's (the address says `family=1` and the evening's next game is this one),
   * and how long it lasts when it is a short round (the plan's step, or a family round).
   */
  roundOf(g: ShellGame, query: URLSearchParams, planStep: { game: string; roundSec?: number } | null): { roundSec: number | null; family: boolean } {
    const v = query.get('family') === '1' ? this.book().active() : null;
    this.familyRound = !!v?.current && v.current.game === g.id;
    if (this.familyRound) return { roundSec: FAMILY_ROUND_SEC, family: true };
    return { roundSec: planStep && planStep.game === g.id && typeof planStep.roundSec === 'number' ? planStep.roundSec : null, family: false };
  }

  isFamilyRound(): boolean { return this.familyRound; }

  /** The round of the evening is over: its scores go on the board. Null when it was not the evening's. */
  finishFamily(summary: { score: number; players?: Partial<Record<1 | 2, { score: number }>> }): FamilyView | null {
    if (!this.familyRound) return null;
    this.familyRound = false;
    const two = summary.players?.[1] && summary.players?.[2];
    return this.book().finishRound(two ? { p1: summary.players?.[1]?.score ?? 0, p2: summary.players?.[2]?.score ?? 0 } : { p1: summary.score });
  }

  // ---- the vertical clip ----------------------------------------------------------------------------------------------------

  /** This browser can make the clip and the profile may share it. */
  storyPossible(): boolean {
    return this.h.share() && storyDeps(this.h.win) !== null;
  }

  /** The clip goes when the results do. */
  dropStory(): void {
    this.storyToken++;
    this.making = false;
    if (this.storyUrl) { try { URL.revokeObjectURL(this.storyUrl); } catch { /* never made */ } }
    this.storyUrl = null;
    this.storyBlob = null;
    this.storyFigure = null;
  }

  private card(): HTMLElement | null { return this.h.doc.querySelector<HTMLElement>('[data-story]'); }

  /** The player asked for the clip: it is made (nine seconds), then shown with the way to share and to save it. */
  async makeStory(): Promise<void> {
    const r = this.h.result();
    if (!r || !this.card() || this.making) return;
    const ctx = this.h.ctx();
    const g = ctx.games.find((x) => x.id === r.gameId);
    const deps = storyDeps(this.h.win);
    if (!g || !deps) { this.failed(ctx.i18n); return; }
    this.making = true;
    const token = ++this.storyToken;
    this.paintMaking(0);
    const scene = await this.sceneOf(g);
    const players: 1 | 2 = r.players && r.players.length === 2 ? 2 : 1;
    const input = this.inputOf(ctx, g, r, players, scene);
    // the 3D figure when this device draws it, else the flat one
    let stage: Awaited<ReturnType<typeof import('./story-figure.ts').createStoryStage>> = null;
    try {
      const { createStoryStage } = await import('./story-figure.ts');
      stage = await createStoryStage(this.h.doc, { width: FIGURE_BOX.w, height: FIGURE_BOX.h, players });
    } catch { stage = null; }
    if (token !== this.storyToken) { stage?.dispose(); return; }
    this.storyFigure = stage ? '3d' : 'flat';
    const move = input.move;
    const figure = stage ? { frame: (t: number) => { stage?.draw(players === 2 ? [storyPoseAt(move, t, 0), storyPoseAt(move, t, 1)] : [storyPoseAt(move, t)]); return stage?.canvas ?? null; } } : null;
    let shown = -1;
    const file = await recordStory(deps, input, figure, {
      progress: (u) => {
        const pct = Math.round(u * 100);
        if (pct === shown || token !== this.storyToken) return;
        shown = pct;
        this.paintMaking(pct);
      },
    });
    stage?.dispose();
    if (scene && 'pause' in scene) { try { (scene as HTMLVideoElement).pause(); (scene as HTMLVideoElement).removeAttribute('src'); } catch { /* gone */ } }
    this.making = false;
    if (token !== this.storyToken) return;
    if (!file) { this.failed(ctx.i18n); return; }
    this.dropStoryUrl();
    try {
      this.storyBlob = file.blob;
      this.storyUrl = URL.createObjectURL(file.blob);
    } catch { this.failed(ctx.i18n); return; }
    this.storyName = storyFileName(g.seo.slug, r.score, file.ext);
    this.storyMime = file.mime;
    this.restoreStory(true);
    this.h.toast(ctx.i18n.t('story.ready'));
  }

  /** How far the clip is, on the card that is on the page now (the page may have been drawn again meanwhile). */
  private paintMaking(pct: number): void {
    const card = this.card();
    if (!card) return;
    card.dataset['story'] = 'making';
    const make = card.querySelector<HTMLButtonElement>('[data-action="story-make"]');
    if (make) make.disabled = true;
    const bar = card.querySelector<HTMLElement>('[data-story-progress]');
    if (bar) bar.hidden = false;
    const meter = bar?.querySelector('progress');
    if (meter) meter.value = pct;
    const label = card.querySelector<HTMLElement>('[data-story-progress-text]');
    if (label && (pct % 10 === 0 || pct === 0)) label.textContent = this.h.ctx().i18n.t('story.making', { n: pct });
  }

  private failed(t: I18n): void {
    this.making = false;
    const card = this.card();
    if (card) {
      card.dataset['story'] = 'failed';
      const bar = card.querySelector<HTMLElement>('[data-story-progress]');
      if (bar) bar.hidden = true;
      const make = card.querySelector<HTMLButtonElement>('[data-action="story-make"]');
      if (make) make.disabled = false;
    }
    this.h.toast(t.t('story.failed'), { kind: 'warn' });
  }

  /**
   * The results were drawn (again: a resize, a change of language): the clip that is ready goes back into the card, and one that is being made
   * shows how far it is. `play`: the clip has just been made, and plays unless the player asked for less motion.
   */
  restoreStory(play = false): void {
    const card = this.card();
    if (!card) return;
    if (this.making) { this.paintMaking(0); return; }
    if (!this.storyUrl) return;
    card.dataset['story'] = 'ready';
    if (this.storyFigure) card.dataset['storyFigure'] = this.storyFigure;
    const frame = card.querySelector<HTMLElement>('[data-story-frame]');
    if (frame) {
      let video = frame.querySelector('video');
      if (!video) {
        video = this.h.doc.createElement('video');
        video.className = 'k-storyvideo';
        video.playsInline = true;
        video.muted = true;
        video.loop = true;
        video.controls = true;
        video.preload = 'metadata';
        video.setAttribute('aria-label', frame.dataset['storyAlt'] ?? '');
        frame.append(video);
      }
      video.src = this.storyUrl;
      frame.hidden = false;
      if (play && !this.h.reducedMotion()) void video.play().catch(() => undefined);
    }
    const bar = card.querySelector<HTMLElement>('[data-story-progress]');
    if (bar) bar.hidden = true;
    const make = card.querySelector<HTMLElement>('[data-action="story-make"]');
    if (make) make.hidden = true;
    const share = card.querySelector<HTMLElement>('[data-action="story-share"]');
    if (share) share.hidden = false;
    const save = card.querySelector<HTMLAnchorElement>('[data-story-save]');
    if (save) { save.href = this.storyUrl; save.download = this.storyName; save.hidden = false; }
  }

  private dropStoryUrl(): void {
    if (this.storyUrl) { try { URL.revokeObjectURL(this.storyUrl); } catch { /* never made */ } }
    this.storyUrl = null;
    this.storyBlob = null;
  }

  /** The clip to the share sheet as a file where the browser takes one; anywhere else it is saved, which the player is told. */
  async shareStory(): Promise<void> {
    const blob = this.storyBlob;
    const url = this.storyUrl;
    const r = this.h.result();
    if (!blob || !url || !r) return;
    const ctx = this.h.ctx();
    const g = ctx.games.find((x) => x.id === r.gameId);
    const file = new File([blob], this.storyName, { type: this.storyMime });
    const data: ShareData = {
      files: [file], title: g ? titleOf(ctx, g) : 'BodyArcade',
      text: ctx.i18n.t('results.clip.text', { score: ctx.i18n.number(Math.round(r.score)), game: g ? titleOf(ctx, g) : 'BodyArcade' }),
    };
    const nav = this.h.win.navigator;
    try {
      if (typeof nav.canShare === 'function' && nav.canShare(data) && typeof nav.share === 'function') { await nav.share(data); return; }
    } catch (e) {
      if ((e as { name?: string }).name === 'AbortError') return;
      /* the share sheet failed: the file is saved instead */
    }
    const a = this.h.doc.createElement('a');
    a.href = url;
    a.download = this.storyName;
    this.h.doc.body.append(a);
    a.click();
    a.remove();
    this.h.toast(ctx.i18n.t('results.clip.saved'));
  }

  /** The game behind the figure: the round's highlight (the game view, never the camera) playing, else the game's own picture. */
  private async sceneOf(g: ShellGame): Promise<CanvasImageSource | null> {
    const doc = this.h.doc;
    const url = this.h.highlightUrl();
    if (url) {
      const v = doc.createElement('video');
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.src = url;
      const ok = await new Promise<boolean>((resolve) => {
        const done = (x: boolean): void => { v.onloadeddata = null; v.onerror = null; resolve(x); };
        v.onloadeddata = () => done(true);
        v.onerror = () => done(false);
        this.h.win.setTimeout(() => done(v.readyState >= 2), 2500);
      });
      if (ok) { try { await v.play(); } catch { /* a still frame is fine */ } return v; }
    }
    const img = doc.createElement('img');
    img.decoding = 'async';
    img.src = this.h.ctx().assets.tile(g.catalogue.tile, 800);
    try { await img.decode(); return img; } catch { return null; }
  }

  /** Everything the picture says, in the page's language. */
  private inputOf(ctx: ViewContext, g: ShellGame, r: RoundResult, players: 1 | 2, scene: CanvasImageSource | null): StoryInput {
    const t = ctx.i18n;
    const unit = g.catalogue.unit ? localized(g.catalogue.unit, ctx.lang) : t.t('results.score');
    const stats: { value: string; label: string }[] = [{ value: formatClock(r.seconds), label: t.t('results.seconds') }];
    if (r.reps !== undefined) stats.push({ value: t.number(r.reps), label: t.t('results.reps') });
    else if (r.hits !== undefined) stats.push({ value: t.number(r.hits), label: t.t('results.hits') });
    if (r.quality !== undefined) stats.push({ value: t.number(r.quality, { style: 'percent', maximumFractionDigits: 0 }), label: t.t('results.quality') });
    const [a, b] = r.players ?? [];
    const two = players === 2 && a && b;
    const text: StoryText = {
      game: titleOf(ctx, g),
      level: t.tx(`setup.difficulty.${r.setup.difficulty}`),
      unit: t.t('results.unitIn', { unit, time: durationLabel(ctx, Math.max(1, r.seconds)) }),
      stats,
      best: r.personalBest ? t.t('results.personalBest') : null,
      challenge: t.t('story.challenge', { score: t.number(Math.round(r.score)) }),
      cta: t.t('story.cta', { site: CLIP_BRAND }),
      players: two ? [
        { label: t.t('hud.player1'), score: a.score, colour: '#FFC53A', winner: a.score > b.score },
        { label: t.t('hud.player2'), score: b.score, colour: '#46B4FF', winner: b.score > a.score },
      ] : null,
      verdict: two ? (a.score === b.score ? t.t('results.draw') : t.t('results.winner', { who: t.t(a.score > b.score ? 'hud.player1' : 'hud.player2') })) : null,
    };
    return { text, score: r.score, format: (n) => t.number(n), move: storyMoveOf(g.catalogue.move), players, scene, reducedMotion: this.h.reducedMotion() };
  }
}

export { STORY_MS };
