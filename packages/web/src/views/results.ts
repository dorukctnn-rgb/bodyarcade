// The screen after a round: the score, what you did, why moves missed (with the one second skeleton replay of a miss),
// calories only when they are an honest estimate, and the way to go again.
import { html, type SafeHtml } from '../../../core/ui/html.ts';
import { icon } from '../../../core/ui/icons.ts';
import { proGames } from '../../catalogue/filter.ts';
import { hasPro, titleOf, type ViewContext } from '../context.ts';
import { chrome } from './chrome.ts';
import { playHref, type Difficulty, type SetupState } from './setup.ts';

export interface PlayerResult {
  slot: 1 | 2;
  score: number;
  reps?: number;
  hits?: number;
  cleared?: number;
}

export interface RoundResult {
  gameId: string;
  setup: SetupState;
  score: number;
  seconds: number;
  reps?: number;
  hits?: number;
  cleared?: number;
  bestStreak?: number;
  /** 0 to 1, how clean the movements were. */
  quality?: number;
  /** Estimated from the game's MET value, the player's weight and the time spent moving; null when there is no weight. */
  calories: number | null;
  personalBest: boolean;
  /** What the missed moves were, most frequent first. */
  reasons: { text: string; count: number }[];
  /** Mode local2: each player's own numbers. */
  players?: PlayerResult[];
  /** There is a one second skeleton replay of the first miss. */
  replay?: { reason: string } | null;
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function stat(label: string, value: string): SafeHtml {
  return html`<div class="ba-stat"><dt>${label}</dt><dd>${value}</dd></div>`;
}

function stats(ctx: ViewContext, r: RoundResult): SafeHtml {
  const t = ctx.i18n;
  const items: SafeHtml[] = [stat(t.t('results.seconds'), formatClock(r.seconds))];
  if (r.reps !== undefined) items.push(stat(t.t('results.reps'), ctx.i18n.number(r.reps)));
  if (r.hits !== undefined) items.push(stat(t.t('results.hits'), ctx.i18n.number(r.hits)));
  if (r.cleared !== undefined) items.push(stat(t.t('results.cleared'), ctx.i18n.number(r.cleared)));
  if (r.bestStreak !== undefined) items.push(stat(t.t('results.streak'), ctx.i18n.number(r.bestStreak)));
  if (r.quality !== undefined) items.push(stat(t.t('results.quality'), ctx.i18n.number(r.quality, { style: 'percent', maximumFractionDigits: 0 })));
  return html`<dl class="ba-stats">${items}</dl>`;
}

function calories(ctx: ViewContext, r: RoundResult): SafeHtml {
  const t = ctx.i18n;
  if (r.calories === null) return html`<p class="ba-small">${t.t('results.noWeight')} <a class="ba-link" href="${ctx.href('settings')}">${t.t('nav.settings')}</a></p>`;
  return html`<p class="ba-calories">${t.t('results.calories', { n: ctx.i18n.number(Math.round(r.calories)) })}</p><p class="ba-small">${t.t('results.calories.note')}</p>`;
}

function why(ctx: ViewContext, r: RoundResult): SafeHtml {
  const t = ctx.i18n;
  return html`<section class="ba-block" aria-labelledby="r-why"><h2 id="r-why">${t.t('results.why.title')}</h2>
    ${r.reasons.length === 0
      ? html`<p>${t.t('results.why.none')}</p>`
      : html`<ul class="ba-reasons">${r.reasons.map((x) => html`<li><span>${x.text}</span><b>${ctx.i18n.number(x.count)}</b></li>`)}</ul>`}
    ${r.replay ? html`<div class="ba-replay"><div class="ba-replay-frame" data-replay role="img" aria-label="${t.t('results.replay.alt', { reason: r.replay.reason })}"></div>
      <div><button type="button" class="ba-btn ba-btn--secondary" data-action="replay">${icon('replay')}<span>${t.t('results.replay.play')}</span></button><p class="ba-small">${t.t('results.replay.hint')}</p></div></div>` : ''}
  </section>`;
}

function duo(ctx: ViewContext, r: RoundResult): SafeHtml {
  const t = ctx.i18n;
  const ps = r.players ?? [];
  const [a, b] = ps;
  const verdict = a && b ? (a.score === b.score ? t.t('results.draw') : t.t('results.winner', { who: t.t(a.score > b.score ? 'hud.player1' : 'hud.player2') })) : '';
  return html`<div class="ba-duo-result">${verdict ? html`<p class="ba-verdict" role="status">${verdict}</p>` : ''}
    <div class="ba-duo-cols">${ps.map((p) => html`<section class="ba-duo-col ba-duo-col--p${p.slot}" aria-labelledby="r-p${p.slot}"><h2 id="r-p${p.slot}">${t.t(p.slot === 1 ? 'hud.player1' : 'hud.player2')}</h2><p class="ba-bignum">${ctx.i18n.number(p.score)}</p>
      <dl class="ba-stats">${[p.reps !== undefined ? stat(t.t('results.reps'), ctx.i18n.number(p.reps)) : '', p.hits !== undefined ? stat(t.t('results.hits'), ctx.i18n.number(p.hits)) : '', p.cleared !== undefined ? stat(t.t('results.cleared'), ctx.i18n.number(p.cleared)) : '']}</dl></section>`)}</div>
  </div>`;
}

export function resultsPage(ctx: ViewContext, r: RoundResult | null): SafeHtml {
  const t = ctx.i18n;
  if (!r) {
    return chrome(ctx, { tab: 'games', mainClass: 'ba-page--results', main: html`<header class="ba-pagehead"><h1 class="ba-h1" data-main-heading>${t.t('results.title')}</h1></header>
      <p class="ba-lead">${t.t('results.missing')}</p><div class="ba-actions"><a class="ba-btn ba-btn--primary" href="${ctx.href('home')}">${t.t('results.other')}</a></div>` });
  }
  const g = ctx.games.find((x) => x.id === r.gameId);
  const proMore = proGames(ctx.games).length;
  const again = g ? playHref(ctx, g, r.setup) : ctx.href('home');
  const main = html`
    <header class="ba-pagehead ba-resulthead"><div><p class="ba-small">${g ? titleOf(ctx, g) : ''}</p><h1 class="ba-h1" data-main-heading>${t.t('results.title')}</h1></div>
      ${r.personalBest ? html`<span class="ba-badge ba-badge--live">${icon('trophy')}${t.t('results.personalBest')}</span>` : ''}</header>
    <section class="ba-panel ba-scorecard" aria-label="${t.t('results.score')}">
      ${r.setup.players === 2 && r.players ? duo(ctx, r) : html`<div class="ba-bignum-box"><p class="ba-bignum" aria-label="${t.t('results.score')}: ${r.score}">${ctx.i18n.number(r.score)}</p><p class="ba-small ba-scorelabel">${t.t('results.score')}</p></div>`}
      ${stats(ctx, r)}
      ${calories(ctx, r)}
    </section>
    ${why(ctx, r)}
    <div class="ba-actions ba-actions--results">
      <a class="ba-btn ba-btn--primary ba-btn--lg" href="${again}" data-action="again">${icon('replay')}<span>${t.t('results.again')}</span></a>
      <a class="ba-btn ba-btn--secondary ba-btn--lg" href="${ctx.href('home')}">${t.t('results.other')}</a>
    </div>
    ${!hasPro(ctx) && proMore > 0 ? html`<p class="ba-small ba-proline">${t.t('results.proLine', { n: proMore })} <a class="ba-link" href="${ctx.href('pro')}" data-action="open-pro">${t.t('results.proLink')}</a></p>` : ''}`;
  return chrome(ctx, { tab: 'games', main, mainClass: 'ba-page--results' });
}

export type { Difficulty };
