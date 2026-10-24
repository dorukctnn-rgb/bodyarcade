// The screen after a round (design/ui-kit/results.html): the score, what you did, why moves missed (with the one second
// skeleton replay of a miss once the session records one), calories only as an honest estimate, and the way to go again.
import { html, type SafeHtml } from '../../../core/ui/html.ts';
import { icon } from '../../../core/ui/icons.ts';
import { localized } from '../../../core/ui/i18n/localized.ts';
import { proGames } from '../../catalogue/filter.ts';
import type { ShellGame } from '../../catalogue/types.ts';
import { durationLabel, hasPro, titleOf, type ViewContext } from '../context.ts';
import { chrome } from './chrome.ts';
import { pageHead } from './parts.ts';
import { playHref, type SetupState } from './setup.ts';

/** A number a game adds to its results beyond the common ones (Reaction Tag: the average and the best reaction), already in words. */
export interface ResultExtra { label: string; value: string }

export interface PlayerResult {
  slot: 1 | 2;
  score: number;
  reps?: number;
  hits?: number;
  cleared?: number;
  extras?: ResultExtra[];
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
  /** The best score before this round on this difficulty, or null when there was none. */
  previousBest?: number | null;
  /** What the missed moves were, most frequent first. */
  reasons: { text: string; count: number }[];
  /** More numbers of this game: reaction times and the like. */
  extras?: ResultExtra[];
  /** Mode local2: each player's own numbers. */
  players?: PlayerResult[];
  /** There is a one second skeleton replay of a miss. The slot stays out of the page until the session gives frames. */
  replay?: { reason: string } | null;
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const stat = (label: string, value: string): SafeHtml => html`<div><b>${value}</b><span>${label}</span></div>`;

function stats(ctx: ViewContext, r: RoundResult): SafeHtml {
  const t = ctx.i18n;
  const items: SafeHtml[] = [stat(t.t('results.seconds'), formatClock(r.seconds))];
  if (r.reps !== undefined) items.push(stat(t.t('results.reps'), t.number(r.reps)));
  if (r.hits !== undefined && r.reps === undefined) items.push(stat(t.t('results.hits'), t.number(r.hits)));
  if (r.cleared !== undefined) items.push(stat(t.t('results.cleared'), t.number(r.cleared)));
  if (r.bestStreak !== undefined) items.push(stat(t.t('results.streak'), t.number(r.bestStreak)));
  if (r.quality !== undefined) items.push(stat(t.t('results.quality'), t.number(r.quality, { style: 'percent', maximumFractionDigits: 0 })));
  for (const x of r.extras ?? []) items.push(stat(x.label, x.value));
  return html`<div class="k-stats">${items}</div>`;
}

function counted(ctx: ViewContext, r: RoundResult): SafeHtml {
  const t = ctx.i18n;
  if (r.hits === undefined || r.reps === undefined || r.reps <= 0) return html``;
  const pct = Math.max(0, Math.min(100, Math.round((r.hits / r.reps) * 100)));
  const label = t.t('results.countedOf', { hits: t.number(r.hits), reps: t.number(r.reps) });
  return html`<div class="k-card k-reach">
    <div class="row"><span>${t.t('results.counted')}</span><span>${label}</span></div>
    <progress class="k-linebar" max="100" value="${pct}" aria-label="${t.t('results.counted')}: ${label}"></progress>
  </div>`;
}

function calories(ctx: ViewContext, r: RoundResult): SafeHtml {
  const t = ctx.i18n;
  if (r.calories === null) return html`<div class="k-kcal"><span class="ba-small">${t.t('results.noWeight')} <a class="ba-link" href="${ctx.href('settings')}">${t.t('nav.settings')}</a></span></div>`;
  return html`<div class="k-kcal"><b>${t.t('results.calories', { n: t.number(Math.round(r.calories)) })}</b><span class="ba-small">${t.t('results.calories.note')}</span></div>`;
}

function why(ctx: ViewContext, r: RoundResult): SafeHtml {
  const t = ctx.i18n;
  return html`<section aria-labelledby="why"><h2 id="why" class="k-h3">${t.t('results.why.title')}</h2>
    ${r.reasons.length === 0
      ? html`<p class="k-sub">${t.t('results.why.none')}</p>`
      : html`<ul class="k-misses">${r.reasons.map((x) => html`<li><div><b>${x.text}</b></div><span class="x">${t.number(x.count)}x</span></li>`)}</ul>`}
  </section>`;
}

function duo(ctx: ViewContext, r: RoundResult): SafeHtml {
  const t = ctx.i18n;
  const ps = r.players ?? [];
  const [a, b] = ps;
  const verdict = a && b ? (a.score === b.score ? t.t('results.draw') : t.t('results.winner', { who: t.t(a.score > b.score ? 'hud.player1' : 'hud.player2') })) : '';
  return html`${verdict ? html`<p class="k-verdict" role="status">${verdict}</p>` : ''}
    <div class="k-duocols">${ps.map((p) => html`<section class="k-duocol k-duocol--p${p.slot}" aria-labelledby="r-p${p.slot}"><h2 id="r-p${p.slot}">${t.t(p.slot === 1 ? 'hud.player1' : 'hud.player2')}</h2><p class="n">${t.number(p.score)}</p>
      <div class="k-stats">${[p.reps !== undefined ? stat(t.t('results.reps'), t.number(p.reps)) : '', p.hits !== undefined ? stat(t.t('results.hits'), t.number(p.hits)) : '', p.cleared !== undefined ? stat(t.t('results.cleared'), t.number(p.cleared)) : '', ...(p.extras ?? []).map((x) => stat(x.label, x.value))]}</div></section>`)}</div>`;
}

function score(ctx: ViewContext, r: RoundResult, g: ShellGame | undefined): SafeHtml {
  const t = ctx.i18n;
  const unit = g?.catalogue.unit ? localized(g.catalogue.unit, ctx.lang) : t.t('results.score');
  const small = r.previousBest !== null && r.previousBest !== undefined ? html`<small>${t.t('results.bestBefore', { n: t.number(r.previousBest) })}</small>` : '';
  return html`<div class="k-score"><span class="n" aria-label="${t.t('results.score')}: ${r.score}">${t.number(r.score)}</span><span class="u">${t.t('results.unitIn', { unit, time: durationLabel(ctx, Math.max(1, r.seconds)) })}${small}</span></div>`;
}

export function resultsPage(ctx: ViewContext, r: RoundResult | null): SafeHtml {
  const t = ctx.i18n;
  if (!r) {
    const main = html`${pageHead(ctx, t.t('results.title'), { back: ctx.href('home') })}
      <p class="k-sub">${t.t('results.missing')}</p><div class="ba-actions"><a class="ba-btn ba-btn--primary ba-btn--lg" href="${ctx.href('home')}">${t.t('results.other')}</a></div>`;
    return chrome(ctx, { tab: 'games', main, mainClass: 'ba-page--results', pushed: true });
  }
  const g = ctx.games.find((x) => x.id === r.gameId);
  const proMore = proGames(ctx.games).length;
  const again = g ? playHref(ctx, g, r.setup) : ctx.href('home');
  const level = t.tx(`setup.difficulty.${r.setup.difficulty}`);
  const main = html`
    ${pageHead(ctx, t.t('results.title'), { back: g ? ctx.href('game', { params: { slug: g.seo.slug } }) : ctx.href('home') })}
    <div class="k-cols k-cols--results">
      <div class="k-stack">
        <div class="ba-row-wrap k-between">
          <span class="k-game">${g ? html`<img src="${ctx.assets.tile(g.catalogue.tile, 400)}" alt="" width="48" height="36">` : ''}${g ? t.t('results.gameLevel', { game: titleOf(ctx, g), level }) : ''}</span>
          ${r.personalBest ? html`<span class="k-pb">${icon('star')}${t.t('results.personalBest')}</span>` : ''}
        </div>
        ${r.setup.players === 2 && r.players ? duo(ctx, r) : html`${score(ctx, r, g)}${counted(ctx, r)}`}
        ${stats(ctx, r)}
        ${calories(ctx, r)}
      </div>
      <div class="k-stack">
        ${why(ctx, r)}
        ${r.replay ? html`<section class="k-card k-replay" aria-labelledby="replay"><h2 id="replay" class="k-h3">${t.t('results.replay.title')}</h2>
          <div class="view" data-replay role="img" aria-label="${t.t('results.replay.alt', { reason: r.replay.reason })}"></div>
          <div class="scrub"><button class="ba-icon-btn" type="button" data-action="replay" aria-label="${t.t('results.replay.play')}">${icon('replay')}</button></div>
          <p class="k-fine">${t.t('results.replay.hint')}</p></section>` : ''}
        ${!hasPro(ctx) && proMore > 0 ? html`<div class="k-card k-procard"><p>${t.t('results.proCard', { n: proMore })}</p><a class="ba-link" href="${ctx.href('pro')}">${t.t('results.proLink')}</a></div>` : ''}
      </div>
      <div class="k-actionbar"><div class="k-actions k-actions--results">
        <a class="ba-btn ba-btn--primary ba-btn--lg" href="${again}" data-action="again" data-replace>${icon('replay')}<span>${t.t('results.again')}</span></a>
        <a class="ba-btn ba-btn--secondary ba-btn--lg" href="${ctx.href('home')}">${t.t('results.other')}</a>
      </div></div>
    </div>`;
  return chrome(ctx, { tab: 'games', main, mainClass: 'ba-page--results', pushed: true });
}
