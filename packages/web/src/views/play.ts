// The game stage and what is laid over it before and between rounds: the camera explainer, calibration, countdown,
// pause and errors. The stage has three layers: the game (and the camera preview), the HUD, and these panels.
import { attr, html, raw, type SafeHtml } from '../../../core/ui/html.ts';
import { glyph } from '../../../core/ui/glyphs.ts';
import { icon } from '../../../core/ui/icons.ts';
import type { Framing, PauseReason } from '../../../core/types/index.ts';
import type { ShellGame } from '../../catalogue/types.ts';
import { titleOf, type ViewContext } from '../context.ts';
import { bare } from './chrome.ts';
import { noCameraPossible } from './setup.ts';

/** The parts of the body the calibration screen checks off. */
export type CalibPart = 'head' | 'shoulders' | 'hips' | 'knees' | 'feet';
export interface CalibCheck { part: CalibPart; ok: boolean }

/** How the screen frames the player: the game's framing, or the desk when the round is a seated one. */
export type ScreenFraming = Framing | 'desk';

/** Where the player stands against the camera, from the calibration code: too close, in the good range, too far, or not known. */
export type GaugePos = 'close' | 'good' | 'far' | 'none';

/** The desk card on the calibration screen: the way to play at the desk, or the news that this game is a standing one. */
export type DeskCard = 'none' | 'offer' | 'standing-only';

export type PlayOverlay =
  | { kind: 'camera-explainer'; two?: boolean }
  | { kind: 'camera-error'; code: string; two?: boolean }
  | { kind: 'loading' }
  | {
    kind: 'calibrating'; framing: ScreenFraming; two: boolean; message: string; checks: CalibCheck[]; progress: number; slow: boolean; gauge: GaugePos;
    /** Head and shoulders are in view without the lower body: the desk is offered. */
    desk: DeskCard;
    /** The player has been at it a while: the way around the camera is put forward. */
    stuck: boolean;
    /** The game lifts the hands above the head: the screen says the hands must stay in view. */
    headroom: boolean;
  }
  | { kind: 'countdown'; n: number }
  | { kind: 'paused'; reason: PauseReason }
  | { kind: 'error'; message: string };

/** The page of a round: only the stage, no site frame. The session mounts the game into [data-scene]. */
export function playPage(ctx: ViewContext, g: ShellGame): SafeHtml {
  const t = ctx.i18n;
  return bare(ctx, html`<div class="ba-stage" data-stage data-game="${g.id}">
    <h1 class="ba-visually-hidden" data-main-heading>${titleOf(ctx, g)}</h1>
    <div class="ba-stage-scene" data-scene></div>
    <div class="ba-camera-host" data-camera-host></div>
    <div class="ba-hud" data-hud-root aria-label="${t.t('hud.label')}"></div>
    <div class="ba-overlay" data-overlay></div>
  </div>`, 'ba-app--play');
}

const CAMERA_ERRORS = ['denied', 'not_found', 'in_use', 'overconstrained', 'no_frames', 'insecure', 'unsupported', 'unknown'] as const;

export function cameraErrorText(ctx: ViewContext, code: string): string {
  const known = (CAMERA_ERRORS as readonly string[]).includes(code) ? code : 'unknown';
  return ctx.i18n.tx(`play.camera.err.${known}`);
}

function panel(inner: SafeHtml, o: { cls?: string } = {}): SafeHtml {
  return html`<div class="ba-sheetpanel ${o.cls ?? ''}" role="dialog" aria-modal="true" aria-labelledby="ov-title">${inner}</div>`;
}

const RING = 163.4;
const TICK = '<svg class="tick" viewBox="0 0 14 14" aria-hidden="true" focusable="false"><path d="M3 7.4l2.6 2.6L11 4.6" fill="none" stroke="#1C1433" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const DOTS = '<svg class="dots" viewBox="0 0 14 14" aria-hidden="true" focusable="false"><circle cx="3.5" cy="7" r="1.4" fill="#1C1433"/><circle cx="7" cy="7" r="1.4" fill="#1C1433"/><circle cx="10.5" cy="7" r="1.4" fill="#1C1433"/></svg>';

/** The ring of the calibration screen: how many body checks are done, as a circle and as words. */
export function ringHtml(done: number, total: number, label: string, text: string): string {
  const ok = done === total && total > 0;
  return `<svg class="ring" viewBox="0 0 64 64" role="img" aria-label="${label}" data-calib-ring><circle cx="32" cy="32" r="26" fill="rgba(28,20,51,0.8)" stroke="rgba(244,242,248,0.2)" stroke-width="7"/><circle cx="32" cy="32" r="26" fill="none" stroke="${ok ? '#22C383' : '#FF4F6E'}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${RING}" stroke-dashoffset="${(RING * (1 - (total ? done / total : 0))).toFixed(1)}" transform="rotate(-90 32 32)" data-calib-arc/><text x="32" y="37.5" text-anchor="middle" font-weight="800" font-size="15" fill="#F4F2F8" data-calib-ringtext>${text}</text></svg>`;
}

const CHECK_LABEL = { head: 'calib.check.head', shoulders: 'calib.check.shoulders', hips: 'calib.check.hips', knees: 'calib.check.knees', feet: 'calib.check.feet' } as const;

export function overlayHtml(ctx: ViewContext, g: ShellGame, o: PlayOverlay): SafeHtml {
  const t = ctx.i18n;
  switch (o.kind) {
    case 'camera-explainer': {
      const noCam = noCameraPossible(ctx, g) && !o.two;
      return panel(html`<div class="ba-explain">${icon('camera')}<h2 class="ba-h3" id="ov-title">${t.t('play.camera.title')}</h2><p>${t.t('play.camera.body')}</p>
        <div class="ba-actions ba-actions--stack"><button type="button" class="ba-btn ba-btn--primary ba-btn--lg ba-btn--block" data-action="camera-continue" autofocus>${t.t('play.camera.continue')}</button>
        ${noCam ? html`<button type="button" class="ba-btn ba-btn--secondary ba-btn--block" data-action="use-keyboard">${t.t('play.camera.noCamera')}</button>` : ''}
        <a class="ba-btn ba-btn--quiet ba-btn--block" href="${ctx.href('game', { params: { slug: g.seo.slug } })}">${t.t('common.back')}</a></div>
        ${noCam ? html`<p class="ba-small" data-no-camera-note>${t.t('play.camera.noCamera.note')}</p>` : ''}</div>`);
    }
    case 'camera-error': {
      // The way around the camera is offered wherever it exists (a keyboard, or a touch screen and a game with swipes). A phone is
      // also walked through allowing the camera, which is the usual reason it did not start. A mirror game on a phone has no way
      // around it: the panel says the game needs the camera and helps with the permission.
      const noCam = noCameraPossible(ctx, g) && !o.two;
      const fixable = o.code === 'denied' || o.code === 'in_use' || o.code === 'no_frames' || o.code === 'unknown' || o.code === 'overconstrained';
      const back = html`<a class="ba-btn ba-btn--quiet ba-btn--block" href="${ctx.href('game', { params: { slug: g.seo.slug } })}">${t.t('common.back')}</a>`;
      const steps = fixable ? html`<div class="ba-fix"><b>${t.t('play.needsCamera.fix')}</b><ol><li>${t.t('play.needsCamera.step1')}</li><li>${t.t('play.needsCamera.step2')}</li><li>${t.t('play.needsCamera.step3')}</li></ol></div>` : '';
      const retry = html`<button type="button" class="ba-btn ba-btn--primary ba-btn--block" data-action="camera-retry" autofocus>${t.t('common.retry')}</button>`;
      if (noCam) {
        return panel(html`<div class="ba-explain">${icon('cameraOff')}<h2 class="ba-h3" id="ov-title">${t.t('play.error.title')}</h2><p role="alert">${cameraErrorText(ctx, o.code)}</p>
          ${ctx.caps.keyboard ? '' : steps}
          <div class="ba-actions ba-actions--stack">${retry}
          <button type="button" class="ba-btn ba-btn--secondary ba-btn--block" data-action="use-keyboard">${t.t('play.camera.noCamera')}</button>
          ${back}</div></div>`);
      }
      if (ctx.caps.keyboard) {
        return panel(html`<div class="ba-explain">${icon('cameraOff')}<h2 class="ba-h3" id="ov-title">${t.t('play.error.title')}</h2><p role="alert">${cameraErrorText(ctx, o.code)}</p>
          <div class="ba-actions ba-actions--stack">${retry}${back}</div></div>`);
      }
      return panel(html`<div class="ba-explain">${icon('cameraOff')}<h2 class="ba-h3" id="ov-title">${t.t('play.needsCamera.title')}</h2>
        <p>${t.t('play.needsCamera.body', { game: titleOf(ctx, g) })}</p><p role="alert">${cameraErrorText(ctx, o.code)}</p>
        ${steps}
        <div class="ba-actions ba-actions--stack">${retry}${back}</div></div>`);
    }
    case 'loading':
      return html`<div class="ba-loading" role="status"><span class="ba-spinner" aria-hidden="true"></span><span>${t.t('play.loading')}</span></div>`;
    case 'calibrating': {
      const title = o.two ? t.t('calib.title.two') : t.tx(`calib.title.${o.framing}`);
      const desk = o.framing === 'desk';
      const done = o.checks.filter((c) => c.ok).length;
      const progress = t.t('calib.progress', { done, total: o.checks.length });
      const gaugeText: Record<Exclude<GaugePos, 'none'>, string> = { close: t.t('calib.gauge.close'), good: t.t('calib.gauge.good'), far: t.t('calib.gauge.far') };
      return html`<div class="cal" role="group" aria-labelledby="ov-title">
        <div class="view" data-cal-view>
          <div class="guide" data-cal-guide aria-hidden="true"></div><div class="shade"></div>
          <div class="cal-top">
            <button class="ba-icon-btn" type="button" data-action="leave-now" aria-label="${t.t('common.close')}">${icon('close')}</button>
            <div class="grow"><h2 id="ov-title">${title}</h2></div>
            ${raw(ringHtml(done, o.checks.length, progress, t.t('calib.done', { done, total: o.checks.length })))}
          </div>
          <ul class="checks" aria-label="${t.t('calib.progress', { done, total: o.checks.length })}" data-calib-checks>${o.checks.map((c) => html`<li class="ck${c.ok ? ' is-ok' : ''}" data-calib-check="${c.part}"><i>${raw(TICK)}${raw(DOTS)}</i>${t.tx(CHECK_LABEL[c.part])}</li>`)}</ul>
        </div>
        <div class="panel">
          <p class="msg" role="status" data-calib-msg>${o.message}</p>
          ${o.headroom ? html`<p class="headroom" data-calib-headroom>${glyph('jackOpen', { decorative: true, floor: false, size: 30, ink: '#F4F2F8', accent: '#FFC53A', ball: '#F4F2F8' })}<span>${t.t('calib.headroom')}</span></p>` : ''}
          <div class="gauge" data-calib-gauge data-pos="${o.gauge}"${attr('hidden', o.gauge === 'none')} role="img" aria-label="${t.t('calib.gauge.label', { state: o.gauge === 'none' ? '' : gaugeText[o.gauge] })}"><div class="bar"><em></em></div><div class="lbl"><span>${gaugeText.close}</span><span>${gaugeText.good}</span><span>${gaugeText.far}</span></div></div>
          <div class="slow" data-calib-slow${attr('hidden', !o.slow)}>${noCameraPossible(ctx, g) && !o.two
            ? html`<p class="sub">${t.t('calib.slow.body')}</p><button type="button" class="ba-btn ba-btn--secondary" data-action="use-keyboard">${t.t('calib.slow.cta')}</button>`
            : html`<p class="sub">${t.t('calib.slow.phone')}</p>`}</div>
          <div class="desk" data-calib-desk="offer"${attr('hidden', o.desk !== 'offer')}><p class="sub"><b>${t.t('calib.desk.title')}</b> <span class="more">${t.t('calib.desk.body')}</span></p><button type="button" class="ba-btn ba-btn--primary" data-action="desk-play">${t.t('calib.desk.cta')}</button></div>
          <div class="desk" data-calib-desk="standing-only"${attr('hidden', o.desk !== 'standing-only')}><p class="sub">${t.t('calib.desk.standOnly')}</p><button type="button" class="ba-btn ba-btn--secondary" data-action="desk-games">${t.t('calib.desk.games')}</button></div>
          <div class="skips">
            ${g.seated && !desk ? html`<button class="seated" type="button" data-action="seated-instead" data-calib-skip>${t.t('calib.seatedInstead')}</button>` : ''}
            ${noCameraPossible(ctx, g) && !o.two ? html`<button class="seated" type="button" data-action="use-keyboard" data-calib-keyboard${attr('hidden', !o.stuck)}>${t.t('calib.keyboardInstead')}</button>` : ''}
            ${!g.seated || desk ? html`<a class="seated" href="${ctx.href('home')}">${t.t('calib.leaveGame')}</a>` : ''}
          </div>
        </div>
      </div>`;
    }
    case 'countdown':
      return html`<div class="ba-countdown" aria-hidden="true"><span class="ba-countdown-n" data-n="${o.n}">${o.n > 0 ? o.n : t.t('countdown.go')}</span><span class="ba-countdown-ready">${t.t('countdown.ready')}</span></div>`;
    case 'paused': {
      const key = `pause.reason.${o.reason}`;
      const why = ctx.i18n.has(key) ? ctx.i18n.tx(key) : '';
      const recal = o.reason === 'camera_ended' || o.reason === 'person_lost' || o.reason === 'recalibrate';
      return panel(html`<div class="ba-explain">${icon('pause')}<h2 class="ba-h3" id="ov-title">${t.t('pause.title')}</h2>${why ? html`<p>${why}</p>` : ''}
        <div class="ba-actions ba-actions--stack"><button type="button" class="ba-btn ba-btn--primary ba-btn--lg ba-btn--block" data-action="resume" autofocus>${t.t('pause.resume')}</button>
        <button type="button" class="ba-btn ${recal ? 'ba-btn--secondary' : 'ba-btn--quiet'} ba-btn--block" data-action="recalibrate">${t.t('pause.recalibrate')}</button>
        <button type="button" class="ba-btn ba-btn--quiet ba-btn--block" data-action="quit">${t.t('pause.quit')}</button></div></div>`);
    }
    case 'error':
      return panel(html`<div class="ba-explain">${icon('info')}<h2 class="ba-h3" id="ov-title">${t.t('play.error.title')}</h2><p role="alert">${o.message}</p>
        <div class="ba-actions ba-actions--stack"><button type="button" class="ba-btn ba-btn--primary ba-btn--block" data-action="camera-retry" autofocus>${t.t('common.retry')}</button>
        <a class="ba-btn ba-btn--quiet ba-btn--block" href="${ctx.href('game', { params: { slug: g.seo.slug } })}">${t.t('common.back')}</a></div></div>`);
  }
}
