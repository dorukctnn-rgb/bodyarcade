// The top of the home page: what BodyArcade is, at a glance. The headline, one line, the two buttons, then the scene (src/how.ts): on the
// left a person squats in front of a camera with our body line over them, on the right the game's character squats at the same moment
// from the same points; under it the three steps. The markup is the still (the bottom of the squat): what a visitor sees first, with
// reduced motion, when saving data, and what a crawler reads; app/how-scene.ts moves it once the page has loaded.
import { html, raw, type SafeHtml } from '../../../core/ui/html.ts';
import { icon } from '../../../core/ui/icons.ts';
import type { ViewContext } from '../context.ts';
import { framePoints, HOW_FLOOR, HOW_H, HOW_STILL, HOW_W, moverShapes, personShapes, type Shape } from '../how.ts';
import type { ShellGame } from '../../catalogue/types.ts';

const n1 = (v: number | string): string => (typeof v === 'number' ? (Math.round(v * 10) / 10).toString() : v);
const attrs = (o: Record<string, number | string>): string => Object.entries(o).map(([k, v]) => ` ${k}="${n1(v)}"`).join('');

/** The shapes as SVG markup; each moving shape carries data-g (app/how-scene.ts finds them in this order). */
export function shapesMarkup(shapes: readonly Shape[]): string {
  return shapes.map((s) => `<${s.tag} data-g${attrs(s.geo)}${attrs(s.style)}/>`).join('');
}

/** The camera picture: a dim room, the corners of a viewfinder, the person. */
function cameraPane(still: string): string {
  const c = (x: number, y: number, dx: number, dy: number): string => `<path d="M${x} ${y + dy * 22}V${y}H${x + dx * 22}" fill="none" stroke="rgba(244,242,248,0.55)" stroke-width="3" stroke-linecap="round"/>`;
  return `<svg viewBox="0 0 ${HOW_W} ${HOW_H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">`
    + '<defs><linearGradient id="how-room" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3A3350"/><stop offset="1" stop-color="#262036"/></linearGradient></defs>'
    + `<rect width="${HOW_W}" height="${HOW_H}" fill="url(#how-room)"/>`
    + `<rect y="${HOW_FLOOR}" width="${HOW_W}" height="${HOW_H - HOW_FLOOR}" fill="#1D1829"/>`
    + `<rect x="300" y="40" width="64" height="92" rx="4" fill="rgba(244,242,248,0.06)"/>`
    + `<g data-how-person>${still}</g>`
    + c(16, 16, 1, 1) + c(HOW_W - 16, 16, -1, 1) + c(16, HOW_H - 16, 1, -1) + c(HOW_W - 16, HOW_H - 16, -1, -1)
    + '<circle cx="36" cy="40" r="5" fill="#FF4F6E"/>'
    + '</svg>';
}

/** The game: Pose Wall's night corridor (a deep sky, a floor with lines toward the end of the corridor, a glow at the feet), the Mover. */
function gamePane(still: string): string {
  const vx = HOW_W / 2, vy = 150;
  const rays = [-260, -150, -60, 60, 150, 260].map((dx) => `<line x1="${vx}" y1="${vy}" x2="${vx + dx * 1.6}" y2="${HOW_H}" stroke="#40366E" stroke-width="1.5"/>`).join('');
  const rungs = [176, 204, 238, 280].map((y) => `<line x1="0" y1="${y}" x2="${HOW_W}" y2="${y}" stroke="#40366E" stroke-width="1.2" opacity="0.7"/>`).join('');
  const stars = [[40, 34], [92, 70], [150, 22], [262, 40], [318, 78], [370, 28], [212, 64], [24, 102]].map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i % 3 === 0 ? 1.6 : 1.1}" fill="#F4F2F8" opacity="${i % 2 ? 0.55 : 0.85}"/>`).join('');
  return `<svg viewBox="0 0 ${HOW_W} ${HOW_H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">`
    + '<defs><linearGradient id="how-night" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#140F27"/><stop offset="0.5" stop-color="#1A1430"/><stop offset="1" stop-color="#241C40"/></linearGradient>'
    + '<radialGradient id="how-glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#46B4FF" stop-opacity="0.32"/><stop offset="1" stop-color="#46B4FF" stop-opacity="0"/></radialGradient></defs>'
    + `<rect width="${HOW_W}" height="${HOW_H}" fill="url(#how-night)"/>${stars}`
    + `<rect y="${vy}" width="${HOW_W}" height="${HOW_H - vy}" fill="#2A2150"/>${rays}${rungs}`
    + `<ellipse cx="${vx}" cy="${HOW_FLOOR + 2}" rx="120" ry="22" fill="url(#how-glow)"/>`
    + `<g data-how-mover>${still}</g>`
    + '</svg>';
}

export function howHero(ctx: ViewContext, featured: ShellGame | undefined): SafeHtml {
  const t = ctx.i18n;
  const pts = framePoints(HOW_STILL);
  const steps = [
    ['globe', t.t('home.how.step.one'), t.t('home.how.step.one.sub')],
    ['camera', t.t('home.how.step.two'), t.t('home.how.step.two.sub')],
    ['play', t.t('home.how.step.three'), t.t('home.how.step.three.sub')],
  ] as const;
  return html`<section class="k-how" aria-labelledby="home-h1" data-how>
    <div class="k-how-head">
      <h1 id="home-h1" data-main-heading>${t.t('home.how.h1')}</h1>
      <p class="lead">${t.t('home.how.lead')}</p>
      <div class="k-actions">
        ${featured ? html`<a class="ba-btn ba-btn--primary ba-btn--lg" href="${ctx.href('game', { params: { slug: featured.seo.slug } })}" data-how-play="${featured.id}">${icon('play')}<span>${t.t('home.how.play')}</span></a>` : ''}
        <a class="ba-btn ba-btn--secondary ba-btn--lg" href="${ctx.href('welcome')}">${t.t('home.cta.how')}</a>
      </div>
    </div>
    <figure class="k-how-scene">
      <div class="k-how-pane k-how-pane--cam">${raw(cameraPane(shapesMarkup(personShapes(pts))))}<span class="k-how-tag" aria-hidden="true">${icon('camera')}${t.t('home.how.camera')}</span></div>
      <div class="k-how-pane k-how-pane--game">${raw(gamePane(shapesMarkup(moverShapes(pts))))}<span class="k-how-tag" aria-hidden="true">${icon('play')}${t.t('home.how.game')}</span><span class="k-how-rep" aria-hidden="true">+1</span></div>
      <figcaption class="ba-visually-hidden">${t.t('home.how.caption')}</figcaption>
    </figure>
    <ol class="k-how-steps">
      ${steps.map(([ic, title, sub]) => html`<li><span class="k-how-n" aria-hidden="true">${icon(ic)}</span><span><b>${title}</b><span>${sub}</span></span></li>`)}
    </ol>
    <p class="ba-assure k-how-assure">${icon('shield')}<span>${t.t('home.how.assure')}</span></p>
  </section>`;
}
