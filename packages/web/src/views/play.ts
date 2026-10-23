// The game stage and what is laid over it before and between rounds: the camera explainer, calibration, countdown,
// pause and errors. The stage has three layers: the game (and the camera preview), the HUD, and these panels.
import { attr, html, type SafeHtml } from '../../../core/ui/html.ts';
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
  | { kind: 'calibrating'; framing: Framing; two: boolean; message: string; checks: CalibCheck[]; progress: number; slow: boolean }
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

const CHECK_LABEL = { head: 'calib.check.head', hips: 'calib.check.hips', knees: 'calib.check.knees', feet: 'calib.check.feet' } as const;

export function overlayHtml(ctx: ViewContext, g: ShellGame, o: PlayOverlay): SafeHtml {
  const t = ctx.i18n;
  switch (o.kind) {
    case 'camera-explainer':
      return panel(html`<div class="ba-explain">${icon('camera')}<h2 class="ba-h3" id="ov-title">${t.t('play.camera.title')}</h2><p>${t.t('play.camera.body')}</p>
        <div class="ba-actions ba-actions--stack"><button type="button" class="ba-btn ba-btn--primary ba-btn--lg ba-btn--block" data-action="camera-continue" autofocus>${t.t('play.camera.continue')}</button>
        <a class="ba-btn ba-btn--quiet ba-btn--block" href="${ctx.href('game', { params: { slug: g.seo.slug } })}">${t.t('common.back')}</a></div></div>`);
    case 'camera-error':
      return panel(html`<div class="ba-explain">${icon('cameraOff')}<h2 class="ba-h3" id="ov-title">${t.t('play.error.title')}</h2><p role="alert">${cameraErrorText(ctx, o.code)}</p>
        <div class="ba-actions ba-actions--stack"><button type="button" class="ba-btn ba-btn--primary ba-btn--block" data-action="camera-retry" autofocus>${t.t('common.retry')}</button>
        <button type="button" class="ba-btn ba-btn--secondary ba-btn--block" data-action="use-keyboard">${t.t('setup.input.keyboard')}</button>
        <a class="ba-btn ba-btn--quiet ba-btn--block" href="${ctx.href('game', { params: { slug: g.seo.slug } })}">${t.t('common.back')}</a></div></div>`);
    case 'loading':
      return html`<div class="ba-loading" role="status"><span class="ba-spinner" aria-hidden="true"></span><span>${t.t('play.loading')}</span></div>`;
    case 'calibrating': {
      const title = o.two ? t.t('calib.title.two') : t.tx(`calib.title.${o.framing}`);
      const done = o.checks.filter((c) => c.ok).length;
      return html`<div class="ba-calib" role="group" aria-label="${title}">
        <div class="ba-calib-card">
          <h2 class="ba-h3" id="ov-title">${title}</h2>
          <p class="ba-calib-msg" role="status" data-calib-msg>${o.message}</p>
          <ul class="ba-calib-checks" aria-label="${t.t('calib.progress', { done, total: o.checks.length })}" data-calib-checks>${o.checks.map((c) => html`<li data-calib-check="${c.part}" class="${c.ok ? 'is-ok' : ''}">${c.ok ? icon('check') : html`<span class="ba-dot" aria-hidden="true"></span>`}<span>${t.tx(CHECK_LABEL[c.part])}</span></li>`)}</ul>
          <progress class="ba-meter" max="100" value="${Math.round(o.progress * 100)}" aria-label="${t.t('calib.progress', { done, total: o.checks.length })}" data-calib-meter></progress>
          <div class="ba-calib-slow" data-calib-slow${attr('hidden', !o.slow)}><p class="ba-small">${t.t('calib.slow.body')}</p><button type="button" class="ba-btn ba-btn--secondary" data-action="use-keyboard">${t.t('calib.slow.cta')}</button></div>
          ${g.seated ? html`<button type="button" class="ba-btn ba-btn--quiet" data-action="seated-instead">${icon('chair')}<span>${t.t('calib.seatedInstead')}</span></button>` : ''}
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
