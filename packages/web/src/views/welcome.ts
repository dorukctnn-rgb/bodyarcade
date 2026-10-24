// The welcome tour (design/onboarding): a stage that holds the 3D figure of the game and a panel with the words, five pages,
// then the real calibration and the real first game on the play page (steps 6 and 7 of "Step n of 7"). Honest by construction:
// every sentence about the camera is true of the code (the video stays on the device), the seated line counts the games that
// have a seated version, and a choice made here is kept in the settings. The stage is a picture for the eyes: the panel carries
// everything a screen reader needs, and the only thing that moves the tour on is a button.
import { attr, html, raw, type SafeHtml } from '../../../core/ui/html.ts';
import { glyph, REGION_GLYPHS } from '../../../core/ui/glyphs.ts';
import { LANG_INFO, type Lang } from '../../../core/ui/i18n/index.ts';
import { INDEXED_LANGS, router } from '../routes.ts';
import { regionLabel, type ViewContext } from '../context.ts';
import { deviceChoices, LEVELS, TOUR_REGIONS, TOUR_STEPS, type TourDevice, type TourState, type TourStep } from '../app/welcome-model.ts';
import { bare, logo } from './chrome.ts';

// The small drawings of the panel: the art director's, with the brand colours as they are (they read on both themes).
const svg = (viewBox: string, inner: string): SafeHtml => raw(`<svg viewBox="${viewBox}" aria-hidden="true" focusable="false">${inner}</svg>`);
const ICON = {
  device: svg('0 0 36 36', '<rect x="9" y="4" width="18" height="28" rx="4" fill="none" stroke="currentColor" stroke-width="2.6"/><circle cx="18" cy="17" r="5" fill="#FF4F6E"/><path d="M15.6 17.2l1.7 1.7 3.2-3.4" fill="none" stroke="#1C1433" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
  line: svg('0 0 36 36', '<circle cx="18" cy="11" r="5.5" fill="#FF4F6E"/><line x1="5" y1="25" x2="31" y2="25" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-dasharray="5 4"/>'),
  friends: svg('0 0 36 36', '<circle cx="12" cy="11" r="4.5" fill="currentColor"/><circle cx="25" cy="11" r="4.5" fill="#46B4FF"/><path d="M4.5 28c0-5 3.4-8.5 7.5-8.5s7.5 3.5 7.5 8.5M17.5 28c0-5 3.4-8.5 7.5-8.5s7.5 3.5 7.5 8.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>'),
  only: svg('0 0 36 36', '<rect x="5" y="8" width="26" height="20" rx="5" fill="none" stroke="currentColor" stroke-width="2.6"/><path d="M14 14l9 4-9 4z" fill="#FF4F6E"/>'),
  prompt: svg('0 0 36 36', '<rect x="5" y="7" width="26" height="22" rx="5" fill="none" stroke="currentColor" stroke-width="2.6"/><rect x="10" y="20" width="16" height="5" rx="2.5" fill="#FF4F6E"/><line x1="10" y1="13.5" x2="24" y2="13.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'),
  globe: svg('0 0 20 20', '<circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M2.8 10h14.4M10 2.5c2.2 2.3 2.2 12.7 0 15M10 2.5c-2.2 2.3-2.2 12.7 0 15" fill="none" stroke="currentColor" stroke-width="1.5"/>'),
  lock: svg('0 0 16 16', '<rect x="3" y="7" width="10" height="7" rx="2" fill="currentColor"/><path d="M5.5 7V5.2a2.5 2.5 0 015 0V7" fill="none" stroke="currentColor" stroke-width="1.6"/>'),
  phone: svg('0 0 18 18', '<rect x="5" y="1.5" width="8" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/>'),
  phoneLand: svg('0 0 18 18', '<rect x="1.5" y="5" width="15" height="8" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/>'),
  laptop: svg('0 0 18 18', '<rect x="3" y="3.5" width="12" height="8.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M1 14.5h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'),
  tv: svg('0 0 18 18', '<rect x="1.5" y="3" width="15" height="9.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M6 15.5h6M9 12.5v3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'),
} as const;

/** The state of a page that is drawn without a visitor (the generator): the first step, whatever the settings say. */
export const FIRST_TOUR: TourState = { step: 1, regions: ['legs', 'cardio'], level: 'steady', seated: false, quiet: false, device: 'phone', players: 1 };

const progress = (ctx: ViewContext, n: number): SafeHtml => html`<div class="ob-progress"><ol aria-hidden="true">${Array.from({ length: TOUR_STEPS }, (_, i) => html`<li class="${i + 1 < n ? 'done' : i + 1 === n ? 'now' : ''}"></li>`)}</ol><span>${ctx.i18n.t('onboarding.step', { n, total: TOUR_STEPS })}</span></div>`;

const nextButton = (label: string): SafeHtml => html`<button class="ba-btn ba-btn--primary ba-btn--lg" data-action="tour-next" type="button">${label}</button>`;
const backButton = (ctx: ViewContext): SafeHtml => html`<button class="ba-btn ba-btn--quiet" data-action="tour-back" type="button">${ctx.i18n.t('common.back')}</button>`;
const actions = (ctx: ViewContext, primary: SafeHtml, back = true): SafeHtml => html`<div class="ob-actions">${back ? backButton(ctx) : ''}${primary}</div>`;

/** The title of a step: the one heading of the screen, and where the focus goes when the step changes. */
const title = (text: string): SafeHtml => html`<h1 class="ob-title" tabindex="-1" data-main-heading>${text}</h1>`;

function points(rows: readonly { icon: SafeHtml; title: string; body: string }[]): SafeHtml {
  return html`<ul class="ob-points">${rows.map((r) => html`<li>${r.icon}<div><b>${r.title}</b><span>${r.body}</span></div></li>`)}</ul>`;
}

/** How many games have a seated version, said as the truth: "every game" only when every game does. */
export function seatedLine(ctx: ViewContext): string {
  const t = ctx.i18n;
  const n = ctx.games.filter((g) => g.seated).length;
  return n === ctx.games.length && n > 0 ? t.t('onboarding.s3.seated.all') : t.t('onboarding.s3.seated.some', { n });
}

const deviceName = (ctx: ViewContext, d: TourDevice): string => ctx.i18n.tx(`onboarding.device.${d}`);

/** What to do with the camera, for the device and the number of players. */
export function deviceText(ctx: ViewContext, st: Pick<TourState, 'device' | 'players'>): string {
  const t = ctx.i18n;
  return st.players === 2 ? t.tx(`onboarding.device.${st.device === 'tv' ? 'tv' : 'laptop'}.two.text`) : t.tx(`onboarding.device.${st.device === 'tv' ? 'laptop' : st.device}.text`);
}

function step1(ctx: ViewContext): SafeHtml {
  const t = ctx.i18n;
  return html`<div class="ob-scroll">${title(t.t('onboarding.h1'))}<p class="ob-text">${t.t('onboarding.text1', { n: ctx.games.length })}</p></div>
    <div class="ob-actions">${nextButton(t.t('onboarding.start'))}</div>
    <p class="ob-note">${t.t('onboarding.minutes')}</p>
    <button class="ob-link" type="button" data-action="tour-skip">${t.t('onboarding.skip')}</button>`;
}

function step2(ctx: ViewContext): SafeHtml {
  const t = ctx.i18n;
  return html`<div class="ob-scroll">${progress(ctx, 2)}${title(t.t('onboarding.s2.title'))}
    ${points([
      { icon: ICON.device, title: t.t('onboarding.s2.a.title'), body: t.t('onboarding.s2.a.body') },
      { icon: ICON.line, title: t.t('onboarding.s2.b.title'), body: t.t('onboarding.s2.b.body') },
      { icon: ICON.friends, title: t.t('onboarding.s2.c.title'), body: t.t('onboarding.s2.c.body') },
    ])}</div>${actions(ctx, nextButton(t.t('common.next')))}`;
}

function step3(ctx: ViewContext, st: TourState): SafeHtml {
  const t = ctx.i18n;
  const mode = (name: 'seated' | 'quiet', pose: 'seated' | 'stand', hint: string): SafeHtml => html`<label class="ob-mode">${glyph(pose, { decorative: true, className: 'g', floor: pose === 'stand', highlight: pose === 'seated' ? ['armL1', 'armL2', 'armR1', 'armR2'] : [] })}<div><b>${t.t(`onboarding.s3.${name}`)}</b><span>${hint}</span></div><span class="ba-switch"><input type="checkbox" name="tour-${name}" data-key="tour-${name}"${attr('checked', st[name])}><span aria-hidden="true"></span></span></label>`;
  return html`<div class="ob-scroll" data-form="tour">${progress(ctx, 3)}${title(t.t('onboarding.s3.title'))}
    <div class="ob-regions" role="group" aria-label="${t.t('onboarding.s3.regions')}">${TOUR_REGIONS.map((r) => {
      const g = REGION_GLYPHS[r];
      return html`<button class="ba-chip" type="button" data-action="tour-region" data-region="${r}" aria-pressed="${String(st.regions.includes(r))}">${g ? glyph(g.pose, { decorative: true, floor: false, size: 34, highlight: g.highlight }) : ''}${regionLabel(ctx, r)}</button>`;
    })}</div>
    <p class="ob-label" id="ob-level-label">${t.t('onboarding.s3.level')}</p>
    <div class="ob-levels" role="radiogroup" aria-labelledby="ob-level-label">${LEVELS.map((l) => html`<label class="ob-level"><input type="radio" name="tour-level" value="${l}" data-key="tour-level-${l}"${attr('checked', st.level === l)}><b>${t.tx(`onboarding.level.${l}`)}</b><span>${t.tx(`onboarding.level.${l}.desc`)}</span></label>`)}</div>
    <p class="ob-level-desc" data-level-desc aria-hidden="true">${t.tx(`onboarding.level.${st.level}.desc`)}.</p>
    <div class="ob-modes">${mode('seated', 'seated', seatedLine(ctx))}${mode('quiet', 'stand', t.t('onboarding.s3.quiet.body'))}</div>
    <p class="ob-note ob-note--wide">${t.t('onboarding.s3.note')}</p></div>${actions(ctx, nextButton(t.t('common.next')))}`;
}

function step4(ctx: ViewContext, st: TourState): SafeHtml {
  const t = ctx.i18n;
  const players = ctx.caps.local2
    ? html`<div class="ob-seg" role="radiogroup" aria-label="${t.t('onboarding.players.label')}">${([1, 2] as const).map((n) => html`<label><input type="radio" name="tour-players" value="${n}" data-key="tour-players-${n}"${attr('checked', st.players === n)}><span>${t.t(n === 1 ? 'onboarding.players.one' : 'onboarding.players.two')}</span></label>`)}</div>`
    : '';
  const devices = deviceChoices(st.players);
  return html`<div class="ob-scroll" data-form="tour">${progress(ctx, 4)}${title(st.players === 2 ? t.t('onboarding.s4.title.two') : t.t('onboarding.s4.title'))}
    ${players}
    <div class="ob-seg" role="radiogroup" aria-label="${t.t('onboarding.device.label')}">${devices.map((d) => html`<label><input type="radio" name="tour-device" value="${d}" data-key="tour-device-${d}"${attr('checked', st.device === d)}><span>${ICON[d]}${deviceName(ctx, d)}</span></label>`)}</div>
    <p class="ob-text" data-device-text>${deviceText(ctx, st)}</p>
    <div class="ob-health"><b>${t.t('onboarding.s4.healthLead')}</b> ${t.t('onboarding.s4.health')}</div></div>${actions(ctx, nextButton(t.t('onboarding.s4.cta')))}`;
}

function step5(ctx: ViewContext): SafeHtml {
  const t = ctx.i18n;
  return html`<div class="ob-scroll">${progress(ctx, 5)}${title(t.t('onboarding.s5.title'))}
    ${points([
      { icon: ICON.device, title: t.t('onboarding.s5.a.title'), body: t.t('onboarding.s5.a.body') },
      { icon: ICON.only, title: t.t('onboarding.s5.b.title'), body: t.t('onboarding.s5.b.body') },
      { icon: ICON.prompt, title: t.t('onboarding.s5.c.title'), body: t.t('onboarding.s5.c.body') },
    ])}</div><div class="ob-actions">${nextButton(t.t('common.continue'))}</div>`;
}

/** The panel of a step: what changes when the tour moves on (the stage stays). */
export function welcomePanel(ctx: ViewContext, st: TourState): SafeHtml {
  switch (st.step) {
    case 1: return step1(ctx);
    case 2: return step2(ctx);
    case 3: return step3(ctx, st);
    case 4: return step4(ctx, st);
    case 5: return step5(ctx);
  }
}

/** The language the top bar offers: the other complete language, as a link to this same step. */
function languageLink(ctx: ViewContext, step: TourStep): SafeHtml {
  const other: Lang | undefined = INDEXED_LANGS.find((l) => l !== ctx.lang);
  if (!other) return html``;
  const info = LANG_INFO.find((l) => l.code === other);
  const target = router.withLang(ctx.href('welcome', step === 1 ? {} : { query: { step: String(step) } }), other);
  return html`<a class="ob-lang" href="${target}" lang="${info?.tag ?? other}" hreflang="${info?.tag ?? other}" data-action="lang" data-lang="${other}">${ICON.globe}<span>${info?.name ?? other}</span></a>`;
}

/** The bar over the first page: the logo and the other language. */
export function welcomeTop(ctx: ViewContext, step: TourStep): SafeHtml {
  return html`<div class="ob-top">${logo(ctx, 30)}${languageLink(ctx, step)}</div>`;
}

/** The stage: the 3D canvas, its pre-rendered stand-ins for a device that cannot draw it, and the labels that sit over the picture. */
function stage(ctx: ViewContext, step: TourStep): SafeHtml {
  return html`<section class="ob-stage" data-stage>
    <canvas data-canvas aria-hidden="true"></canvas>
    <img class="ob-poster" data-poster alt="" aria-hidden="true">
    <video class="ob-poster" data-loop muted loop playsinline preload="none" aria-hidden="true" tabindex="-1"></video>
    <div data-overlay aria-hidden="true"></div>
    ${step === 1 ? welcomeTop(ctx, step) : ''}
  </section>`;
}

/** The whole page. It is drawn without the site frame: the tour is the page. */
export function welcomePage(ctx: ViewContext, st: TourState = FIRST_TOUR): SafeHtml {
  const t = ctx.i18n;
  return bare(ctx, html`<div class="ob" data-welcome data-step="${st.step}" data-done="0" role="region" aria-label="${t.t('onboarding.label')}">
    ${stage(ctx, st.step)}
    <section class="ob-panel" data-panel>${welcomePanel(ctx, st)}</section>
  </div>`, 'ba-app--welcome');
}
