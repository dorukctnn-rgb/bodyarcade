// The in-game HUD: score, timer and pause, the one command, the reason a move missed, and the player's own camera
// view. It implements the contract's Hud (set, announce, toast) and places every plate with the layout system of the
// art director (layout.ts, design/LAYOUT.md): measure the plates, fit the command, choose the reason row, place,
// then check the result against the rendered DOM. Browser only; the maths is tested in layout.test.ts and fit.test.ts,
// the placement on ten screen sizes by the end-to-end HUD test.
import type { Hud, HudSlot, PlayerSlot } from '../../types/index.ts';
import { glyph, type PoseName } from '../glyphs.ts';
import { html, raw, type SafeHtml } from '../html.ts';
import type { I18n } from '../i18n/index.ts';
import {
  checkRects, duoAvailable, duoReasonRows, hudMetrics, hudSlots, placeHud, placeHudDuo, typicalInsets,
  type DuoLayout, type HudLayout, type HudMetrics, type HudMode, type Insets, type PipPlacement, type PlacedRect, type Rect, type Size,
} from '../layout.ts';
import { calibrationPip, chooseReasonRow, fitCommand, fitReasonFont, fitStatusFont, REASON_LINES, type ReasonRows } from './fit.ts';

export interface PlayHudOptions {
  document: Document;
  /** The element the plates are drawn into: absolutely positioned over the stage. */
  root: HTMLElement;
  /** Where a mirror game draws the camera; it is moved and sized to the mirror rectangle in mirror mode. */
  cameraHost?: HTMLElement | null;
  i18n: I18n;
  mode?: HudMode;
  pipCorner?: PipPlacement;
  /** Two players, one camera (only on a screen that allows it). */
  duo?: boolean;
  announce(text: string, o?: { assertive?: boolean }): void;
  toast(text: string): void;
  onPause(): void;
  /** The little button on the self view: the owner cycles the corner or hides it. */
  onMovePip(): void;
  onLayout?(info: HudLayoutInfo): void;
  /** The size of the stage and its safe-area insets. Default: the root's own box and the typical insets for it. */
  viewport?(): { w: number; h: number; insets?: Insets };
}

export interface HudLayoutInfo {
  metrics: HudMetrics;
  mode: HudMode;
  /** Where the player's own view sits now (or 'hidden'). */
  pipCorner: PipPlacement;
  duo: boolean;
  solo?: HudLayout;
  twoPlayers?: DuoLayout;
  /** The area the game keeps its key objects in. */
  play: Rect;
}

type Value = string | number | { icon?: string; text: string; progress?: number };

const PAUSE_ICON = '<svg viewBox="0 0 10 10" aria-hidden="true" focusable="false"><rect x="1.5" y="1" width="2.4" height="8" rx="1" fill="#F4F2F8"/><rect x="6.1" y="1" width="2.4" height="8" rx="1" fill="#F4F2F8"/></svg>';
const LINE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="7" r="4"/><line x1="3" y1="17" x2="21" y2="17" stroke="#F4F2F8" stroke-width="3.2" stroke-linecap="round" stroke-dasharray="4 3.4"/></svg>';
const CAMERA_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="#F4F2F8" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6.5" width="13" height="11" rx="3"/><path d="M16 10.4l5-2.9v9l-5-2.9"/></svg>';
const MOVE_ICON ='<svg viewBox="0 0 14 14" aria-hidden="true" focusable="false"><path d="M2 5V2h3M12 5V2H9M2 9v3h3M12 9v3H9" fill="none" stroke="#F4F2F8" stroke-width="1.8" stroke-linecap="round"/></svg>';

const clockText = (seconds: number): string => {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const asText = (v: Value): string => (typeof v === 'object' ? v.text : String(v));

export class PlayHud implements Hud {
  /** Where the self view (camera canvas or video) is placed by the session. */
  readonly pipHost: HTMLElement;

  private readonly o: PlayHudOptions;
  private readonly doc: Document;
  private readonly el: Record<string, HTMLElement> = {};
  private mode: HudMode;
  private corner: PipPlacement;
  private duo: boolean;
  private away: { player: PlayerSlot } | null = null;
  private phase: 'calibrate' | 'play' = 'play';
  private info: HudLayoutInfo | null = null;
  /** The signature of what the last layout was done for. */
  private laidOut = '';
  private raf = 0;
  private disposed = false;
  private maxLives = 0;
  private resize: () => void;
  private observer: ResizeObserver | null = null;

  constructor(o: PlayHudOptions) {
    this.o = o;
    this.doc = o.document;
    this.mode = o.mode ?? 'scene';
    this.corner = o.pipCorner ?? 'bottom-right';
    this.duo = !!o.duo;
    this.pipHost = this.doc.createElement('div');
    this.pipHost.className = 'ba-pip-host';
    this.build();
    this.resize = () => this.schedule();
    this.doc.defaultView?.addEventListener('resize', this.resize);
    this.doc.defaultView?.addEventListener('orientationchange', this.resize);
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(this.resize);
      this.observer.observe(o.root);
    }
    this.relayout();
  }

  // ---- the contract ------------------------------------------------------------------------------------------------

  set(slot: HudSlot, v: Value): void {
    const t = this.o.i18n;
    switch (slot) {
      case 'score':
        this.text('score', typeof v === 'number' ? t.number(v) : asText(v));
        break;
      case 'timer':
        this.text('timer', typeof v === 'number' ? clockText(v) : asText(v));
        break;
      case 'lives': {
        const n = typeof v === 'number' ? v : Number.parseInt(asText(v), 10);
        if (Number.isFinite(n)) { this.maxLives = Math.max(this.maxLives, n); this.setLives(n, this.maxLives); }
        break;
      }
      case 'combo': {
        const n = typeof v === 'number' ? v : Number.parseInt(asText(v), 10);
        const chip = this.el['combo'] as HTMLElement | undefined;
        if (!chip) break;
        chip.hidden = !(n >= 2);
        chip.textContent = n >= 2 ? `×${t.number(n)}` : '';
        break;
      }
      case 'prompt': {
        const text = asText(v);
        const command = this.el['command'] as HTMLElement | undefined;
        if (!command) break;
        command.hidden = text === '';
        (this.el['commandText'] as HTMLElement).textContent = text;
        const pose = typeof v === 'object' && v.icon ? (v.icon as PoseName) : null;
        (this.el['commandGlyph'] as HTMLElement).innerHTML = pose ? glyph(pose, { ink: '#1C1433', floor: false, size: 100, decorative: true }).value : '';
        command.classList.toggle('no-glyph-source', !pose);
        break;
      }
      case 'hint': {
        const text = asText(v);
        const reason = this.el['reason'] as HTMLElement | undefined;
        const span = this.el['reasonText'] as HTMLElement | undefined;
        if (!reason || !span) break;
        reason.hidden = text === '';
        span.textContent = text;
        break;
      }
    }
    this.schedule();
  }

  announce(text: string, o?: { assertive?: boolean }): void { this.o.announce(text, o); }
  toast(text: string): void { this.o.toast(text); }

  // ---- what the shell adds -----------------------------------------------------------------------------------------

  /** Two players: each has their own score and reason strip. */
  setPlayer(player: PlayerSlot, slot: 'score' | 'hint', v: Value): void {
    const t = this.o.i18n;
    if (slot === 'score') this.text(`score${player}`, typeof v === 'number' ? t.number(v) : asText(v));
    else {
      const strip = this.el[`reason${player}`] as HTMLElement | undefined;
      const span = this.el[`reason${player}Text`] as HTMLElement | undefined;
      if (!strip || !span) return;
      strip.hidden = asText(v) === '';
      span.textContent = asText(v);
    }
    this.schedule();
  }

  setLabels(l: { score?: string; timer?: string }): void {
    if (l.score !== undefined) for (const k of ['scoreLabel', 'score1Label', 'score2Label']) (this.el[k] as HTMLElement).textContent = l.score;
    if (l.timer !== undefined) (this.el['timerLabel'] as HTMLElement).textContent = l.timer;
    this.schedule();
  }

  setMode(mode: HudMode): void { this.mode = mode; this.schedule(); }

  /** Shows the self view in another element (the big view while calibrating), or back in its tile when null. */
  attachPipTo(el: HTMLElement | null): void {
    if (el) el.prepend(this.pipHost);
    else (this.el['pip'] as HTMLElement).prepend(this.pipHost);
  }

  /** 'calibrate': only the camera view, large; 'play': the plates and the small view. */
  setPhase(phase: 'calibrate' | 'play'): void {
    this.phase = phase;
    this.o.root.dataset['phase'] = phase;
    this.schedule();
  }
  setPipCorner(c: PipPlacement): void { this.corner = c; this.schedule(); }
  setDuo(on: boolean): void { this.duo = on; this.build(); this.schedule(); }

  /** The player who left the frame ("Player 2, step back in") with the seconds before the other may go on; null clears it. */
  setAway(player: PlayerSlot | null): void {
    this.away = player ? { player } : null;
    const plate = this.el['away'] as HTMLElement | undefined;
    if (plate) {
      plate.hidden = !this.away;
      if (this.away) {
        const t = this.o.i18n;
        (this.el['awayTitle'] as HTMLElement).textContent = t.t('hud.stepBackIn', { player: t.t(this.away.player === 1 ? 'hud.player1' : 'hud.player2') });
        plate.dataset['player'] = String(this.away.player);
      }
    }
    const dim = this.el['dim'] as HTMLElement | undefined;
    if (dim) dim.hidden = !this.away;
    this.schedule();
  }

  layoutInfo(): HudLayoutInfo | null { return this.info; }

  /** Problems found in what is on the screen: cut off, overlapping, command under 8 % of the height, text spilling out. */
  problems(): string[] {
    this.relayout(true);
    const out: string[] = [];
    const info = this.info;
    if (!info) return ['the HUD has not been laid out'];
    const rendered: Record<string, Rect & { font?: number }> = {};
    const root = this.o.root.getBoundingClientRect();
    for (const n of this.o.root.querySelectorAll<HTMLElement>('[data-hud]')) {
      if (n.hidden) continue;
      const r = n.getBoundingClientRect();
      rendered[n.dataset['hud'] as string] = { x: r.x - root.x, y: r.y - root.y, w: r.width, h: r.height };
    }
    const command = this.el['command'] as HTMLElement;
    if (!command.hidden && rendered['command']) rendered['command'].font = Number.parseFloat(command.style.fontSize);
    out.push(...checkRects(rendered, { w: info.metrics.w, h: info.metrics.h, minCommand: Math.ceil(0.08 * info.metrics.h) }));
    for (const plate of this.o.root.querySelectorAll<HTMLElement>('[data-hud]')) {
      if (plate.hidden) continue;
      const pr = plate.getBoundingClientRect();
      const walker = this.doc.createTreeWalker(plate, 4 /* NodeFilter.SHOW_TEXT */);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const parent = n.parentElement;
        if (!n.textContent?.trim() || !parent || parent.closest('svg')) continue;
        const range = this.doc.createRange();
        range.selectNodeContents(n);
        const view = this.doc.defaultView;
        const tol = 0.25 * Number.parseFloat(view?.getComputedStyle(parent).fontSize ?? '16');
        for (const rr of range.getClientRects()) {
          if (rr.left < pr.left - 0.5 || rr.right > pr.right + 0.5 || rr.top < pr.top - tol || rr.bottom > pr.bottom + tol) {
            out.push(`text spills out of ${plate.dataset['hud']}`);
            break;
          }
        }
      }
    }
    return out;
  }

  dispose(): void {
    this.disposed = true;
    if (this.raf) this.doc.defaultView?.cancelAnimationFrame(this.raf);
    this.doc.defaultView?.removeEventListener('resize', this.resize);
    this.doc.defaultView?.removeEventListener('orientationchange', this.resize);
    this.observer?.disconnect();
    this.o.root.replaceChildren();
  }

  // ---- building ----------------------------------------------------------------------------------------------------

  private make(markup: SafeHtml): HTMLElement {
    const tpl = this.doc.createElement('template');
    tpl.innerHTML = markup.value.trim();
    return tpl.content.firstElementChild as HTMLElement;
  }

  private ref(key: string, root: HTMLElement): HTMLElement {
    const n = root.matches(`[data-ref="${key}"]`) ? root : root.querySelector<HTMLElement>(`[data-ref="${key}"]`);
    if (!n) throw new Error(`HUD markup has no ${key}`);
    this.el[key] = n;
    return n;
  }

  private build(): void {
    const t = this.o.i18n;
    this.laidOut = '';
    this.o.root.replaceChildren();
    for (const k of Object.keys(this.el)) delete this.el[k];
    const add = (node: HTMLElement): HTMLElement => { this.o.root.append(node); return node; };
    const pauseBtn = html`${this.duo ? '' : html`<button type="button" class="pause showpip" data-ref="showPip" aria-label="${t.t('hud.moveView')}" hidden>${raw(CAMERA_ICON)}</button>`}<button type="button" class="pause" data-ref="pause" aria-label="${t.t('hud.pause')}">${raw(PAUSE_ICON)}</button>`;
    const who = (n: 1 | 2): SafeHtml => html`<span class="who">${glyph('stand', { ink: '#1C1433', floor: false, decorative: true, size: 100 })}${t.t(n === 1 ? 'hud.player1' : 'hud.player2')}</span>`;
    const status = (key: string, n: 1 | 2, left: boolean): SafeHtml => html`<div class="hud-plate status p${n}" data-hud="status${n === 1 ? 'P1' : 'P2'}" data-ref="${key}">${left ? who(n) : ''}<div class="stack"><b data-ref="score${n}">0</b><small data-ref="score${n}Label">${t.t('hud.score')}</small></div>${left ? '' : who(n)}</div>`;

    if (!this.duo) {
      add(this.make(html`<div class="hud-plate status" data-hud="statusLeft" data-ref="statusLeft"><div class="stack"><b data-ref="score">0</b><small data-ref="scoreLabel">${t.t('hud.score')}</small></div><div class="feathers" data-ref="lives" hidden></div><span class="ba-combo" data-ref="combo" hidden></span></div>`));
      add(this.make(html`<div class="hud-plate status" data-hud="statusRight" data-ref="statusRight"><div class="stack"><b data-ref="timer">0:00</b><small data-ref="timerLabel">${t.t('hud.time')}</small></div>${pauseBtn}</div>`));
      add(this.make(html`<div class="hud-command" data-hud="command" data-ref="command" aria-hidden="true" hidden><span class="hud-command-glyph" data-ref="commandGlyph"></span><span data-ref="commandText"></span></div>`));
      add(this.make(html`<div class="hud-plate reason" data-hud="reason" data-ref="reason" aria-hidden="true" hidden>${raw(LINE_ICON)}<span data-ref="reasonText"></span></div>`));
    } else {
      add(this.make(status('statusP1', 1, true)));
      add(this.make(status('statusP2', 2, false)));
      add(this.make(html`<div class="hud-plate status" data-hud="timer" data-ref="timerPlate"><div class="stack"><b data-ref="timer">0:00</b><small data-ref="timerLabel">${t.t('hud.time')}</small></div>${pauseBtn}</div>`));
      add(this.make(html`<div class="hud-command" data-hud="command" data-ref="command" aria-hidden="true" hidden><span class="hud-command-glyph" data-ref="commandGlyph"></span><span data-ref="commandText"></span></div>`));
      for (const n of [1, 2] as const) add(this.make(html`<div class="hud-plate reason p${n}" data-hud="reasonP${n}" data-ref="reason${n}" aria-hidden="true" hidden>${raw(LINE_ICON)}<span data-ref="reason${n}Text"></span></div>`));
      add(this.make(html`<div class="hud-plate away" data-hud="away" data-ref="away" hidden>${glyph('stand', { ink: '#F4F2F8', accent: '#46B4FF', highlight: ['torso'], floor: false, decorative: true, size: 100 })}<b data-ref="awayTitle"></b><span>${t.t('hud.away.body')}</span></div>`));
      const dim = this.make(html`<div class="lane-dim" data-ref="dim" hidden></div>`);
      this.o.root.prepend(dim);
    }

    // The self view: a tile that holds whatever the session draws (one wide view of both players in duo mode).
    const pip = add(this.make(html`<div class="tile" data-hud="pip" data-size="1" data-ref="pip"><span class="tag" data-ref="pipTag">${t.t(this.duo ? 'hud.youBoth' : 'hud.you')}</span><button type="button" class="move" data-ref="move" aria-label="${t.t('hud.moveView')}">${raw(MOVE_ICON)}</button></div>`));
    pip.prepend(this.pipHost);
    for (const n of this.o.root.querySelectorAll<HTMLElement>('[data-ref]')) this.el[n.dataset['ref'] as string] = n;
    (this.el['pause'] as HTMLElement).addEventListener('click', () => this.o.onPause());
    (this.el['move'] as HTMLElement).addEventListener('click', () => this.o.onMovePip());
    this.el['showPip']?.addEventListener('click', () => this.o.onMovePip());
    if (this.duo) (this.el['move'] as HTMLElement).hidden = true;
  }

  private text(key: string, value: string): void {
    const n = this.el[key];
    if (n && n.textContent !== value) n.textContent = value;
  }

  private setLives(left: number, total: number): void {
    const box = this.el['lives'] as HTMLElement | undefined;
    if (!box) return;
    box.hidden = total <= 0;
    box.setAttribute('aria-label', this.o.i18n.t('hud.lives', { n: left }));
    box.setAttribute('role', 'img');
    const dots: string[] = [];
    for (let i = 0; i < total; i++) dots.push(i < left ? '<i></i>' : '<i class="off"></i>');
    box.innerHTML = dots.join('');
  }

  // ---- layout ------------------------------------------------------------------------------------------------------

  private schedule(): void {
    if (this.disposed || this.raf) return;
    const view = this.doc.defaultView;
    if (!view) return;
    this.raf = view.requestAnimationFrame(() => { this.raf = 0; this.relayout(); });
  }

  private viewport(): { w: number; h: number; insets: Insets } {
    const given = this.o.viewport?.();
    const r = this.o.root.getBoundingClientRect();
    const w = Math.round(given?.w ?? r.width);
    const h = Math.round(given?.h ?? r.height);
    return { w, h, insets: given?.insets ?? typicalInsets(w, h) };
  }

  private size(n: HTMLElement): Size {
    const r = n.getBoundingClientRect();
    return { w: Math.ceil(r.width), h: Math.ceil(r.height) };
  }

  private put(n: HTMLElement | undefined, r: PlacedRect | Rect | undefined, withSize = false): void {
    if (!n || !r) return;
    n.style.left = `${r.x}px`;
    n.style.top = `${r.y}px`;
    if (withSize) { n.style.width = `${r.w}px`; n.style.height = `${r.h}px`; }
  }

  /**
   * Everything that decides where the plates go: the screen, the way the HUD is set, and what is written on it. When none of
   * it changed since the last layout, the layout is not done again (a game that sets the timer every frame costs nothing).
   */
  private signature(vp: { w: number; h: number; insets: Insets }): string {
    const flag = (k: string): string => (this.el[k]?.hidden ? '0' : '1');
    const lives = this.el['lives']?.innerHTML.length ?? 0;
    return [
      vp.w, vp.h, vp.insets.top, vp.insets.right, vp.insets.bottom, vp.insets.left,
      this.mode, this.corner, this.duo, this.phase, this.away?.player ?? 0,
      ['command', 'reason', 'reason1', 'reason2', 'combo', 'lives', 'showPip'].map(flag).join(''), lives, this.o.root.textContent,
    ].join('|');
  }

  /**
   * A plate is measured from the corner of the stage, never from where it stood last time: its width, and with it the number of
   * lines of a text in it, depends on the room to its right, and the place a plate was left in while it was hidden is no room.
   */
  private resetPlates(): void {
    for (const n of this.o.root.querySelectorAll<HTMLElement>('[data-hud]')) {
      if (n.dataset['hud'] === 'pip') continue;
      n.style.left = '0px';
      n.style.top = '0px';
    }
  }

  /** The status plates sit side by side inside the safe area: when a long score, lives and a combo would touch, the numerals shrink. */
  private fitStatus(keys: readonly string[], m: HudMetrics): void {
    const plates = keys.map((k) => this.el[k]).filter((n): n is HTMLElement => !!n);
    if (plates.length < 2) return;
    const widthAt = (font: number): number => {
      for (const p of plates) p.style.fontSize = `${font}px`;
      return plates.reduce((sum, p) => sum + p.getBoundingClientRect().width, 0) + m.gap * (plates.length - 1);
    };
    const font = fitStatusFont({ start: m.font.numeral, floor: Math.max(18, Math.floor(m.font.numeral * 0.72)), safeW: m.safe.w }, widthAt);
    for (const p of plates) p.style.fontSize = `${font}px`;
  }

  /** How many lines a reason takes in a plate that may be this wide, at the plate's own font size (the clamp is lifted to count them). */
  private reasonLines(plate: HTMLElement, span: HTMLElement, maxW: number): number {
    plate.style.maxWidth = `${Math.floor(maxW)}px`;
    span.style.webkitLineClamp = 'unset';
    const lh = Number.parseFloat(this.doc.defaultView?.getComputedStyle(span).lineHeight ?? '') || Number.parseFloat(plate.style.fontSize) * 1.2;
    const lines = Math.round(span.getBoundingClientRect().height / lh);
    span.style.webkitLineClamp = '';
    // A word wider than the room cannot wrap: it then stands out of the text box (which clips it), which counts as a line too many.
    return span.scrollWidth > span.clientWidth + 1 ? Math.max(lines, REASON_LINES) + 1 : lines;
  }

  /** A reason takes two lines in the room it has: its own size while that holds, then smaller; the plate keeps that size and width. */
  private fitReason(plate: HTMLElement, span: HTMLElement, maxW: number, start: number): void {
    const { font } = fitReasonFont({ start, floor: Math.max(12, Math.floor(start * 0.72)) }, (f) => {
      plate.style.fontSize = `${f}px`;
      return this.reasonLines(plate, span, maxW);
    });
    plate.style.fontSize = `${font}px`;
    this.reasonLines(plate, span, maxW);
  }

  /** Measures, fits, places and reports. Called after every content change (next frame) and on every resize. */
  relayout(force = false): void {
    if (this.disposed) return;
    const vp = this.viewport();
    if (vp.w < 2 || vp.h < 2) return;
    const sig = this.signature(vp);
    if (!force && sig === this.laidOut) return;
    this.laidOut = sig;
    const metrics = hudMetrics({ w: vp.w, h: vp.h, insets: vp.insets });
    const F = metrics.font;
    const duo = this.duo && duoAvailable({ w: vp.w, h: vp.h });
    const command = this.el['command'] as HTMLElement;

    this.resetPlates();
    for (const k of ['statusLeft', 'statusRight', 'statusP1', 'statusP2', 'timerPlate']) { const n = this.el[k]; if (n) n.style.fontSize = `${F.numeral}px`; }
    for (const k of ['scoreLabel', 'timerLabel', 'score1Label', 'score2Label']) { const n = this.el[k]; if (n) n.style.fontSize = `${F.label}px`; }
    for (const k of ['reason', 'reason1', 'reason2']) { const n = this.el[k]; if (n) n.style.fontSize = `${F.reason}px`; }
    const away = this.el['away'];
    if (away) away.style.fontSize = `${Math.round(F.reason * 1.05)}px`;
    this.fitStatus(duo ? ['statusP1', 'timerPlate', 'statusP2'] : ['statusLeft', 'statusRight'], metrics);

    // The command: shrink, then drop the glyph, then wrap (design/LAYOUT.md section 8).
    const setCommand = (font: number, st: { noGlyph: boolean; wrap: boolean }): void => {
      command.style.fontSize = `${font}px`;
      command.classList.toggle('no-glyph', st.noGlyph);
      command.classList.toggle('wrap', st.wrap);
      command.style.maxWidth = st.wrap ? `${metrics.safe.w}px` : '';
    };
    if (!command.hidden) {
      const fit = fitCommand({ startFont: F.command, floor: metrics.commandShrinkFloor, safeW: metrics.safe.w }, (font, st) => {
        setCommand(font, st);
        return command.getBoundingClientRect().width;
      });
      setCommand(fit.font, { noGlyph: fit.noGlyph, wrap: fit.wrap });
    } else {
      setCommand(F.command, { noGlyph: false, wrap: false });
    }

    const pip = this.el['pip'] as HTMLElement;
    // Two players always see the shared view; one player can hide theirs, and gets a button to bring it back.
    const calibrating = this.phase === 'calibrate';
    // Two players always see the shared view, except in a mirror game, where the camera picture is the scene itself.
    pip.hidden = calibrating ? false : this.mode === 'mirror' ? true : duo ? false : this.corner === 'hidden';
    const showPip = this.el['showPip'];
    if (showPip) showPip.hidden = calibrating || !(this.corner === 'hidden' && this.mode !== 'mirror');
    const play: Rect = { x: 0, y: 0, w: vp.w, h: vp.h };

    if (duo) {
      // Each player's reason stands beside the shared view when it takes two lines there, else above it in their half of the screen.
      const rows: ReasonRows = duoReasonRows({ w: vp.w, h: vp.h, metrics }, this.mode === 'mirror' ? { mirror: true } : {});
      for (const n of [1, 2] as const) {
        const plate = this.el[`reason${n}`];
        const span = this.el[`reason${n}Text`];
        if (!plate || !span || plate.hidden) continue;
        const pick = chooseReasonRow(rows, (_row, w) => this.reasonLines(plate, span, w));
        this.fitReason(plate, span, rows[pick.row]?.w ?? metrics.safe.w / 2, F.reason);
      }
      const measured = {
        statusP1: this.size(this.el['statusP1'] as HTMLElement), statusP2: this.size(this.el['statusP2'] as HTMLElement),
        timer: this.size(this.el['timerPlate'] as HTMLElement), command: command.hidden ? { w: 1, h: 1 } : this.size(command),
        ...(this.visible('reason1') ? { reasonP1: this.size(this.el['reason1'] as HTMLElement) } : {}),
        ...(this.visible('reason2') ? { reasonP2: this.size(this.el['reason2'] as HTMLElement) } : {}),
        away: this.away ? this.size(away as HTMLElement) : null,
      };
      const layout = placeHudDuo({ w: vp.w, h: vp.h, metrics }, measured, { away: this.away ? (this.away.player === 1 ? 'p1' : 'p2') : null, ...(this.mode === 'mirror' ? { mirror: true } : {}) });
      const r = layout.rects;
      this.put(this.el['statusP1'], r.statusP1); this.put(this.el['statusP2'], r.statusP2); this.put(this.el['timerPlate'], r.timer); this.put(command, r.command);
      this.put(this.el['reason1'], r.reasonP1); this.put(this.el['reason2'], r.reasonP2);
      this.put(pip, calibrating ? calibrationPip(metrics, true) : r.pip, true);
      if (this.away && r.away) this.put(away, r.away);
      const dim = this.el['dim'];
      if (dim && this.away) {
        const lane = this.away.player === 1 ? r.playP1 : r.playP2;
        Object.assign(dim.style, { left: `${lane.x}px`, top: '0px', width: `${lane.w}px`, height: `${vp.h}px` });
      }
      this.info = { metrics, mode: this.mode, pipCorner: this.corner, duo: true, twoPlayers: layout, play: { x: r.playP1.x, y: r.playP1.y, w: r.playP2.x + r.playP2.w - r.playP1.x, h: r.playP1.h } };
    } else {
      const status = { statusLeft: this.size(this.el['statusLeft'] as HTMLElement), statusRight: this.size(this.el['statusRight'] as HTMLElement) };
      const cmdSize = command.hidden ? { w: 1, h: 1 } : this.size(command);
      const reason = this.el['reason'] as HTMLElement;
      const options = { mode: this.mode, pipCorner: this.corner };
      const slots = hudSlots({ w: vp.w, h: vp.h, metrics }, { ...status, command: cmdSize }, options);
      let reasonRow = slots.reason.preferred;
      if (!reason.hidden) {
        const span = this.el['reasonText'] as HTMLElement;
        const pick = chooseReasonRow(slots.reason, (_row, maxW) => this.reasonLines(reason, span, maxW));
        reasonRow = pick.row;
        // When no row has room for two lines, the words are made smaller, never cut off.
        this.fitReason(reason, span, slots.reason[pick.row]?.w ?? metrics.safe.w, F.reason);
      }
      const measured = { ...status, command: cmdSize, reason: reason.hidden ? { w: 1, h: 1 } : this.size(reason) };
      const layout = placeHud({ w: vp.w, h: vp.h, metrics }, measured, { ...options, reasonRow });
      const r = layout.rects;
      this.put(this.el['statusLeft'], r.statusLeft); this.put(this.el['statusRight'], r.statusRight); this.put(command, r.command); this.put(reason, r.reason);
      this.put(pip, calibrating ? calibrationPip(metrics, false) : r.pip, true);
      if (calibrating && this.o.cameraHost) this.o.cameraHost.style.display = 'none';
      else if (r.mirror && this.o.cameraHost) {
        const host = this.o.cameraHost;
        Object.assign(host.style, { left: `${r.mirror.x}px`, top: `${r.mirror.y}px`, width: `${r.mirror.w}px`, height: `${r.mirror.h}px`, right: 'auto', bottom: 'auto', display: '' });
      } else if (this.o.cameraHost && this.mode !== 'mirror') {
        this.o.cameraHost.style.display = 'none';
      }
      this.info = { metrics, mode: this.mode, pipCorner: this.corner, duo: false, solo: layout, play: r.play };
    }
    this.o.onLayout?.(this.info as HudLayoutInfo);
  }

  private visible(key: string): boolean {
    const n = this.el[key];
    return !!n && !n.hidden;
  }
}

