// Family mode (/family) and its panel on the results screen (app/family.ts holds the rules). Two players and one camera: together
// where the screen is big enough for two people in the picture (caps.local2), in turns anywhere else; three games of a minute,
// two scores added up over the evening. The page says plainly which way this device plays, and why.
import { html, type SafeHtml } from '../../../core/ui/html.ts';
import { icon } from '../../../core/ui/icons.ts';
import { localized } from '../../../core/ui/i18n/localized.ts';
import type { ShellGame } from '../../catalogue/types.ts';
import { supportsLocal2 } from '../../catalogue/filter.ts';
import { FAMILY_ROUND_SEC, FAMILY_SETS, defaultMode, type FamilyMode, type FamilySet, type FamilyView, type Slot } from '../app/family.ts';
import { hasPro, titleOf, type ViewContext } from '../context.ts';
import { chrome } from './chrome.ts';
import { segmented } from './forms.ts';
import { pageHead } from './parts.ts';
import { defaultSetup, playHref, sanitizeSetup } from './setup.ts';

/** What the family page knows: the evening that is going, and the mode the player chose last (null: the device's default). */
export interface FamilyData {
  active: FamilyView | null;
  mode: FamilyMode | null;
}

export const NO_FAMILY_DATA: FamilyData = { active: null, mode: null };

const gameOf = (ctx: ViewContext, id: string): ShellGame | undefined => ctx.games.find((g) => g.id === id);
const who = (ctx: ViewContext, slot: Slot): string => ctx.i18n.t(slot === 1 ? 'hud.player1' : 'hud.player2');

/** The games of a set that this build has and that two can play on one camera. */
export function setGames(ctx: ViewContext, set: FamilySet): ShellGame[] {
  return set.games.map((id) => gameOf(ctx, id)).filter((g): g is ShellGame => !!g && supportsLocal2(g));
}

/** A set is the player's to start: every game in it is free, or the player has Pro. */
export const setLocked = (ctx: ViewContext, set: FamilySet): boolean => !hasPro(ctx) && setGames(ctx, set).some((g) => !g.free);

/** The address of a round of the evening: the game, played together (two players) or by one player, easy, with the camera. */
export function familyHref(ctx: ViewContext, gameId: string, mode: FamilyMode): string | null {
  const g = gameOf(ctx, gameId);
  if (!g) return null;
  const base = defaultSetup(ctx, g);
  const setup = sanitizeSetup(ctx, g, { ...base, players: mode === 'together' ? 2 : 1, input: 'camera', difficulty: 'easy', seated: false, quiet: ctx.settings.quiet });
  const href = playHref(ctx, g, setup);
  return `${href}${href.includes('?') ? '&' : '?'}family=1`;
}

function modePicker(ctx: ViewContext, mode: FamilyMode): SafeHtml {
  const t = ctx.i18n;
  const together = ctx.caps.local2;
  return html`${segmented('family-mode', t.t('family.mode'), [
    { value: 'together', label: t.t('family.mode.together'), checked: mode === 'together', disabled: !together },
    { value: 'turns', label: t.t('family.mode.turns'), checked: mode === 'turns' },
  ], { legendClass: 'k-label', className: 'k-block', describedBy: 'family-mode-hint' })}
  ${ctx.server
    // a page drawn without a visitor knows nothing of the screen it will be on: it says both ways
    ? html`<p class="ba-small k-hint" id="family-mode-hint">${t.t('family.how.together')} ${t.t('family.how.turns')}</p>`
    : html`<p class="ba-small k-hint" id="family-mode-hint" data-family-hint="${together ? mode : 'narrow'}">${together ? t.t(mode === 'together' ? 'family.how.together' : 'family.how.turns') : t.t('family.how.narrow')}</p>`}`;
}

function setCard(ctx: ViewContext, set: FamilySet): SafeHtml {
  const t = ctx.i18n;
  const games = setGames(ctx, set);
  const locked = setLocked(ctx, set);
  const free = games.every((g) => g.free);
  const id = `family-${set.id}`;
  const button = ctx.server
    ? (games[0] ? html`<a class="ba-btn ba-btn--secondary" href="${ctx.href('game', { params: { slug: games[0].seo.slug } })}">${t.t('plans.open', { game: titleOf(ctx, games[0]) })}</a>` : '')
    : games.length === 0
      ? html`<p class="ba-small">${t.t('plans.noGames')}</p>`
      : locked
        ? html`<a class="ba-btn ba-btn--secondary" href="${ctx.href('pro')}">${t.t('plans.proStart')}</a>`
        : html`<button type="button" class="ba-btn ba-btn--primary" data-action="family-start" data-family-set="${set.id}">${icon('play')}<span>${t.t('family.start', { set: localized(set.title, ctx.lang) })}</span></button>`;
  return html`<article class="k-card k-familyset" id="${id}" aria-labelledby="${id}-h" data-family-set-card="${set.id}">
    <header><h2 class="k-h3" id="${id}-h">${localized(set.title, ctx.lang)}</h2><span class="ba-badge${free ? '' : ' ba-badge--pro'}">${free ? t.t('plans.free') : t.t('plans.pro')}</span></header>
    <p class="k-planmeta"><span>${t.t('plans.games', { n: games.length })}</span><span>${t.t('family.roundLen', { n: FAMILY_ROUND_SEC })}</span></p>
    <ol class="k-steps">${games.map((g) => html`<li><img src="${ctx.assets.tile(g.catalogue.tile, 400)}" alt="" width="56" height="42"><div><b>${titleOf(ctx, g)}</b><small>${localized(g.catalogue.tagline, ctx.lang)}</small></div></li>`)}</ol>
    <div class="ba-actions">${button}</div>
  </article>`;
}

/** Where the evening stands, with the next round's way in (the page of the mode and the results screen share it). */
function goingCard(ctx: ViewContext, v: FamilyView): SafeHtml {
  const t = ctx.i18n;
  const cur = v.current;
  const g = cur ? gameOf(ctx, cur.game) : undefined;
  const href = cur ? familyHref(ctx, cur.game, v.run.mode) : null;
  if (!cur || !g || !href) return html``;
  return html`<section class="k-card k-familygoing" aria-labelledby="family-going-h" data-family-going>
    <h2 class="k-h3" id="family-going-h">${t.t('family.going.title')}</h2>
    <p>${cur.turn ? t.t('family.going.turn', { n: cur.number, total: cur.total, game: titleOf(ctx, g), who: who(ctx, cur.turn) }) : t.t('family.going.body', { n: cur.number, total: cur.total, game: titleOf(ctx, g) })}</p>
    ${board(ctx, v)}
    <div class="ba-actions"><a class="ba-btn ba-btn--primary" href="${href}" data-action="family-go">${icon('play')}<span>${t.t('family.continue')}</span></a>
      <button type="button" class="ba-btn ba-btn--quiet" data-action="family-leave">${t.t('family.leave')}</button></div>
  </section>`;
}

/** The two totals, side by side in the players' colours, and each game's scores under them. */
function board(ctx: ViewContext, v: FamilyView): SafeHtml {
  const t = ctx.i18n;
  const cell = (n: number | null): SafeHtml => html`<td>${n === null ? html`<span aria-label="${t.t('family.notYet')}">·</span>` : t.number(n)}</td>`;
  return html`<div class="k-familyboard" data-family-board>
    <div class="k-duocols">${([1, 2] as const).map((s) => html`<section class="k-duocol k-duocol--p${s}${v.over && v.winner === s ? ' is-winner' : ''}" aria-label="${who(ctx, s)}"><h3>${who(ctx, s)}</h3><p class="n" data-family-total="${s}">${t.number(s === 1 ? v.totals.p1 : v.totals.p2)}</p></section>`)}</div>
    ${v.run.scores.length ? html`<table class="k-familytable"><caption class="ba-visually-hidden">${t.t('family.table')}</caption>
      <thead><tr><th scope="col">${t.t('family.game')}</th><th scope="col">${who(ctx, 1)}</th><th scope="col">${who(ctx, 2)}</th></tr></thead>
      <tbody>${v.run.scores.map((s) => { const g = gameOf(ctx, s.game); return html`<tr><th scope="row">${g ? titleOf(ctx, g) : s.game}</th>${cell(s.p1)}${cell(s.p2)}</tr>`; })}</tbody></table>` : ''}
  </div>`;
}

export function familyPage(ctx: ViewContext, data: FamilyData): SafeHtml {
  const t = ctx.i18n;
  const mode = data.mode === 'together' && !ctx.caps.local2 ? 'turns' : data.mode ?? defaultMode(ctx.caps.local2);
  const main = html`${pageHead(ctx, t.t('family.title'), { back: ctx.href('home') })}
    <p class="k-kicker" data-family>${icon('users')}<span>${t.t('family.kicker')}</span></p>
    <p class="k-sub">${t.t('family.lead', { n: FAMILY_ROUND_SEC })}</p>
    ${data.active && !data.active.over ? goingCard(ctx, data.active) : ''}
    <div class="k-card k-familymode">${modePicker(ctx, mode)}</div>
    <div class="k-plans-grid">${FAMILY_SETS.map((s) => setCard(ctx, s))}</div>
    <p class="ba-small k-officeprivate">${icon('shield')}<span>${t.t('family.private')}</span></p>`;
  return chrome(ctx, { tab: 'games', main, mainClass: 'ba-page--family', pushed: true });
}

/** The panel on the results screen of a family round: the board, and the next round (the other player's turn, or the next game) or the end. */
export function familyPanel(ctx: ViewContext, v: FamilyView): SafeHtml {
  const t = ctx.i18n;
  const cur = v.current;
  const g = cur ? gameOf(ctx, cur.game) : undefined;
  const href = cur ? familyHref(ctx, cur.game, v.run.mode) : null;
  if (v.over) {
    const verdict = v.winner === null ? t.t('family.over.draw', { n: t.number(v.totals.p1) }) : t.t('family.over.winner', { who: who(ctx, v.winner), a: t.number(Math.max(v.totals.p1, v.totals.p2)), b: t.number(Math.min(v.totals.p1, v.totals.p2)) });
    return html`<section class="k-card k-familypanel" aria-labelledby="family-panel-h" data-family-panel="over">
      <h2 class="k-h3" id="family-panel-h">${t.t('family.over.title')}</h2>
      <p class="k-verdict" role="status">${verdict}</p>
      ${board(ctx, v)}
      <div class="ba-actions"><button type="button" class="ba-btn ba-btn--primary" data-action="family-again" data-family-set="${v.run.set}" data-family-mode="${v.run.mode}">${icon('replay')}<span>${t.t('family.again')}</span></button>
        <a class="ba-btn ba-btn--secondary" href="${ctx.href('family')}">${t.t('family.title')}</a></div>
    </section>`;
  }
  if (!cur || !g || !href) return html``;
  const next = cur.turn === 2 && v.run.scores[cur.number - 1]?.p1 !== null
    ? t.t('family.next.handover', { who: who(ctx, 2), game: titleOf(ctx, g) })
    : cur.turn ? t.t('family.next.turn', { who: who(ctx, cur.turn), game: titleOf(ctx, g) }) : t.t('family.next.game', { game: titleOf(ctx, g) });
  return html`<section class="k-card k-familypanel" aria-labelledby="family-panel-h" data-family-panel="next">
    <h2 class="k-h3" id="family-panel-h">${t.t('family.panel.title', { n: cur.number, total: cur.total })}</h2>
    ${board(ctx, v)}
    <p data-family-next>${next}</p>
    <div class="ba-actions"><a class="ba-btn ba-btn--primary" href="${href}" data-action="family-go">${icon('play')}<span>${cur.turn ? t.t('family.go.turn', { who: who(ctx, cur.turn) }) : t.t('plan.go', { game: titleOf(ctx, g) })}</span></a>
      <button type="button" class="ba-btn ba-btn--quiet" data-action="family-leave">${t.t('family.leave')}</button></div>
  </section>`;
}
