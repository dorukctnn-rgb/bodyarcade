// The game stage and what is laid over it before and between rounds: the camera explainer, calibration, countdown,
// pause and errors. The stage has three layers: the game (and the camera preview), the HUD, and these panels.
import { attr, html, raw, type SafeHtml } from '../../../core/ui/html.ts';
import { icon } from '../../../core/ui/icons.ts';
import type { Framing, PauseReason } from '../../../core/types/index.ts';
import type { ShellGame } from '../../catalogue/types.ts';
import { titleOf, type ViewContext } from '../context.ts';
import { bare } from './chrome.ts';

export interface CalibCheck { part: 'head' | 'hips' | 'knees' | 'feet'; ok: boolean }

export type PlayOverlay =
  | { kind: 'camera-explainer' }
  | { kind: 'camera-error'; code: string }
  | { kind: 'loading' }
  | { kind: 'calibrating'; framing: Framing; two: boolean; message: string; checks: CalibCheck[]; progress: number; slow: boolean; gauge: GaugePos; /** Only the upper body is in view: the way to play at the desk is offered. */ desk: boolean; /** The round is a seated one already. */ seated: boolean }
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

/** Where the player stands against the camera, from the calibration code: too close, in the good range, too far, or not known. */
export type GaugePos = 'close' | 'good' | 'far' | 'none';

export function gaugeFor(code: string): GaugePos {
  switch (code) {
    case 'too_close': case 'head_out': case 'hips_out': case 'knees_out': case 'feet_out': return 'close';
    case 'too_far': return 'far';
    case 'hold': case 'ok': case 'move_still': return 'good';
    default: return 'none';
  }
}

/**
 * The framing guide drawn over the camera view: where the body should stand, and while the whole body is not yet in, the
 * zone where the feet go. Plain SVG at the size of the view (design/ui-kit/calibration.html), so nothing is stretched.
 */
export function framingGuide(w: number, h: number, o: { ready: boolean; feetLabel: string; showFeet: boolean }): string {
  const cx = w / 2;
  const top = h * 0.13;
  const bottom = h * 0.95;
  const bw = Math.min(w * 0.42, (bottom - top) * 0.36);
  const feet = o.showFeet
    ? `<rect x="${cx - bw * 0.8}" y="${bottom - h * 0.065}" width="${bw * 1.6}" height="${h * 0.065}" rx="10" fill="#FFC53A" opacity="0.45"/><text x="${cx}" y="${bottom - h * 0.022}" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" font-weight="800" font-size="${Math.max(12, Math.min(18, h * 0.03))}" fill="#1C1433">${o.feetLabel}</text>`
    : '';
  return `<svg viewBox="0 0 ${w} ${h}" aria-hidden="true" focusable="false"><rect x="${cx - bw / 2}" y="${top}" width="${bw}" height="${bottom - top}" rx="${bw * 0.45}" fill="none" stroke="${o.ready ? '#22C383' : '#F4F2F8'}" stroke-width="3" stroke-dasharray="10 8" opacity="0.9"/>${feet}</svg>`;
}

const RING = 163.4;
const TICK = '<svg class="tick" viewBox="0 0 14 14" aria-hidden="true" focusable="false"><path d="M3 7.4l2.6 2.6L11 4.6" fill="none" stroke="#1C1433" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const DOTS = '<svg class="dots" viewBox="0 0 14 14" aria-hidden="true" focusable="false"><circle cx="3.5" cy="7" r="1.4" fill="#1C1433"/><circle cx="7" cy="7" r="1.4" fill="#1C1433"/><circle cx="10.5" cy="7" r="1.4" fill="#1C1433"/></svg>';

/** The ring of the calibration screen: how many body checks are done, as a circle and as words. */
export function ringHtml(done: number, total: number, label: string, text: string): string {
  const ok = done === total && total > 0;
  return `<svg class="ring" viewBox="0 0 64 64" role="img" aria-label="${label}" data-calib-ring><circle cx="32" cy="32" r="26" fill="rgba(28,20,51,0.8)" stroke="rgba(244,242,248,0.2)" stroke-width="7"/><circle cx="32" cy="32" r="26" fill="none" stroke="${ok ? '#22C383' : '#FF4F6E'}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${RING}" stroke-dashoffset="${(RING * (1 - (total ? done / total : 0))).toFixed(1)}" transform="rotate(-90 32 32)" data-calib-arc/><text x="32" y="37.5" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" font-weight="800" font-size="15" fill="#F4F2F8" data-calib-ringtext>${text}</text></svg>`;
}

const CHECK_LABEL = { head: 'calib.check.head', hips: 'calib.check.hips', knees: 'calib.check.knees', feet: 'calib.check.feet' } as const;

export function overlayHtml(ctx: ViewContext, g: ShellGame, o: PlayOverlay): SafeHtml {
  const t = ctx.i18n;
  switch (o.kind) {
    case 'camera-explainer':
      return panel(html`<div class="ba-explain">${icon('camera')}<h2 class="ba-h3" id="ov-title">${t.t('play.camera.title')}</h2><p>${t.t('play.camera.body')}</p>
        <div class="ba-actions ba-actions--stack"><button type="button" class="ba-btn ba-btn--primary ba-btn--lg ba-btn--block" data-action="camera-continue" autofocus>${t.t('play.camera.continue')}</button>
        <a class="ba-btn ba-btn--quiet ba-btn--block" href="${ctx.href('game', { params: { slug: g.seo.slug } })}">${t.t('common.back')}</a></div></div>`);
    case 'camera-error': {
      // Where a keyboard is a way around the camera it is offered. On a phone the game needs the camera, so the panel says so
      // and walks through allowing it (a blocked camera is the usual reason) instead of offering a mode nobody can play.
      if (ctx.caps.keyboard) {
        return panel(html`<div class="ba-explain">${icon('cameraOff')}<h2 class="ba-h3" id="ov-title">${t.t('play.error.title')}</h2><p role="alert">${cameraErrorText(ctx, o.code)}</p>
          <div class="ba-actions ba-actions--stack"><button type="button" class="ba-btn ba-btn--primary ba-btn--block" data-action="camera-retry" autofocus>${t.t('common.retry')}</button>
          <button type="button" class="ba-btn ba-btn--secondary ba-btn--block" data-action="use-keyboard">${t.t('setup.input.keyboard')}</button>
          <a class="ba-btn ba-btn--quiet ba-btn--block" href="${ctx.href('game', { params: { slug: g.seo.slug } })}">${t.t('common.back')}</a></div></div>`);
      }
      const fixable = o.code === 'denied' || o.code === 'in_use' || o.code === 'no_frames' || o.code === 'unknown' || o.code === 'overconstrained';
      return panel(html`<div class="ba-explain">${icon('cameraOff')}<h2 class="ba-h3" id="ov-title">${t.t('play.needsCamera.title')}</h2>
        <p>${t.t('play.needsCamera.body', { game: titleOf(ctx, g) })}</p><p role="alert">${cameraErrorText(ctx, o.code)}</p>
        ${fixable ? html`<div class="ba-fix"><b>${t.t('play.needsCamera.fix')}</b><ol><li>${t.t('play.needsCamera.step1')}</li><li>${t.t('play.needsCamera.step2')}</li><li>${t.t('play.needsCamera.step3')}</li></ol></div>` : ''}
        <div class="ba-actions ba-actions--stack"><button type="button" class="ba-btn ba-btn--primary ba-btn--block" data-action="camera-retry" autofocus>${t.t('common.retry')}</button>
        <a class="ba-btn ba-btn--quiet ba-btn--block" href="${ctx.href('game', { params: { slug: g.seo.slug } })}">${t.t('common.back')}</a></div></div>`);
    }
    case 'loading':
      return html`<div class="ba-loading" role="status"><span class="ba-spinner" aria-hidden="true"></span><span>${t.t('play.loading')}</span></div>`;
    case 'calibrating': {
      const title = o.two ? t.t('calib.title.two') : t.tx(`calib.title.${o.framing}`);
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
          <div class="gauge" data-calib-gauge data-pos="${o.gauge}"${attr('hidden', o.gauge === 'none')} role="img" aria-label="${t.t('calib.gauge.label', { state: o.gauge === 'none' ? '' : gaugeText[o.gauge] })}"><div class="bar"><em></em></div><div class="lbl"><span>${gaugeText.close}</span><span>${gaugeText.good}</span><span>${gaugeText.far}</span></div></div>
          <div class="slow" data-calib-slow${attr('hidden', !o.slow)}>${ctx.caps.keyboard
            ? html`<p class="sub">${t.t('calib.slow.body')}</p><button type="button" class="ba-btn ba-btn--secondary" data-action="use-keyboard">${t.t('calib.slow.cta')}</button>`
            : html`<p class="sub">${t.t('calib.slow.phone')}</p>`}</div>
          <div class="desk" data-calib-desk${attr('hidden', !o.desk)}><p class="sub"><b>${t.t('calib.desk.title')}</b> ${t.t('calib.desk.body')}</p><button type="button" class="ba-btn ba-btn--primary" data-action="seated-instead">${t.t('calib.desk.cta')}</button></div>
          ${g.seated && !o.seated ? html`<button class="seated" type="button" data-action="seated-instead" data-calib-skip${attr('hidden', o.desk)}>${t.t('calib.seatedInstead')}</button>` : ''}
          ${!g.seated || o.seated ? html`<a class="seated" href="${ctx.href('home')}">${t.t('calib.leaveGame')}</a>` : ''}
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
