// The weekly boards: the player's best score of the week for a game, among their friends or among the players of their
// country. A board lists real players only (nobody is added to fill it), the player's own line is always there when they
// have a score, and the week turns over on Monday. States: loading, failed, nothing yet, no friends, no country known.
import { attr, html, type SafeHtml } from '../../../../core/ui/html.ts';
import { icon } from '../../../../core/ui/icons.ts';
import type { BoardEntry, BoardScope, BoardView } from '../../../../core/social/types.ts';
import type { ShellGame } from '../../../catalogue/types.ts';
import { titleOf, type ViewContext } from '../../context.ts';
import { chrome } from '../../views/chrome.ts';
import { segmented } from '../../views/forms.ts';
import { pageHead } from '../../views/parts.ts';
import { dateText } from '../messages.ts';
import type { SocialState } from '../port.ts';
import { ux } from '../strings.ts';
import { avatar, stateBanners } from '../ui.ts';
import { kidPanel, needProfile, under13Panel } from './friends.ts';

export interface BoardsView {
  state: SocialState;
  /** The games that have a weekly board. */
  games: readonly ShellGame[];
  game: ShellGame | null;
  scope: BoardScope;
  week: 'current' | 'previous';
  /** null while it loads or when it did not load. */
  board: BoardView | null;
  loading: boolean;
  failed: boolean;
}

const DAY = 86_400_000;

function countryName(ctx: ViewContext, code: string): string {
  try { return new Intl.DisplayNames([ctx.i18n.tag], { type: 'region' }).of(code) ?? code; } catch { return code; }
}

function row(ctx: ViewContext, e: BoardEntry, scope: BoardScope): SafeHtml {
  const u = ux(ctx);
  const score = ctx.i18n.number(e.score);
  return html`<li class="${e.you ? 'you' : ''}" aria-label="${u('boards.row', { rank: e.rank, name: e.you ? u('boards.you') : e.name, score })}"><span class="rank" aria-hidden="true">${e.rank}</span>${scope === 'friends' && e.fid ? avatar(e.fid) : ''}<b aria-hidden="true">${e.name}${e.you ? html` <span class="ba-small">(${u('boards.you')})</span>` : ''}</b><span class="score" aria-hidden="true">${score}</span></li>`;
}

function list(ctx: ViewContext, v: BoardsView, g: ShellGame): SafeHtml {
  const u = ux(ctx);
  if (v.loading) return html`<p class="ba-lead k-mt" role="status">${u('boards.loading')}</p>`;
  if (v.failed || !v.board) return html`<p class="ba-lead k-mt" role="status">${u('boards.failed')}</p><button class="ba-btn ba-btn--secondary k-mt" type="button" data-action="boards.retry">${ctx.i18n.t('common.retry')}</button>`;
  const b = v.board;
  if (b.scope === 'country' && b.country === null) return html`<p class="ba-callout k-mt">${icon('globe')}<span>${u('boards.noCountry')}</span></p>`;
  const end = b.week.end - DAY;
  const head = html`<div class="k-sechead k-mt"><h2 class="k-h3">${b.scope === 'country' && b.country ? u('boards.countryOf', { country: countryName(ctx, b.country) }) : u('boards.friends')}</h2><span class="ba-small">${u('boards.weekLine', { start: dateText(ctx, b.week.start), end: dateText(ctx, end) })}</span></div>`;
  const inList = b.entries.some((e) => e.you);
  const yours = b.you
    ? html`<p class="k-yours" role="status">${b.you.atLeast ? u('boards.yoursLow', { score: ctx.i18n.number(b.you.score), rank: b.you.rank }) : u('boards.yours', { score: ctx.i18n.number(b.you.score), rank: b.you.rank })}</p>`
    : html`<p class="k-yours" role="status">${u(b.week.current ? 'boards.yoursNone' : 'boards.yoursNonePrevious', { game: titleOf(ctx, g) })}</p>`;
  if (b.entries.length === 0 && !b.you) {
    return html`${head}<p class="ba-lead k-mt">${b.scope === 'friends' && v.state.friends.length === 0 ? u('boards.noFriends') : u(b.week.current ? 'boards.empty' : 'boards.emptyPrevious', { game: titleOf(ctx, g) })}</p>`;
  }
  const own = !inList && b.you ? html`<li class="you gap" aria-label="${u('boards.row', { rank: b.you.atLeast ? `${b.you.rank}+` : b.you.rank, name: u('boards.you'), score: ctx.i18n.number(b.you.score) })}"><span class="rank" aria-hidden="true">${b.you.atLeast ? `${b.you.rank}+` : b.you.rank}</span><b aria-hidden="true">${v.state.profile?.name ?? ''} <span class="ba-small">(${u('boards.you')})</span></b><span class="score" aria-hidden="true">${ctx.i18n.number(b.you.score)}</span></li>` : '';
  return html`${head}<ol class="k-board k-mt" data-board="${b.scope}">${b.entries.map((e) => row(ctx, e, b.scope))}${own}</ol>${yours}`;
}

export function boardsMain(ctx: ViewContext, v: BoardsView): SafeHtml {
  const t = ctx.i18n;
  const u = ux(ctx);
  const s = v.state;
  const head = pageHead(ctx, u('boards.title'), { back: ctx.href('friends') });
  if (s.noOnline === 'under13') return html`${head}${under13Panel(ctx)}`;
  if (s.noOnline === 'kid') return html`${head}${kidPanel(ctx)}`;
  const banners = stateBanners(ctx, s);
  if (!s.profile) return html`${head}${banners}<div class="k-mt">${needProfile(ctx, s, { icon: 'trophy', title: u('boards.title'), body: u('boards.needProfile') })}</div>`;
  if (v.games.length === 0 || !v.game) return html`${head}${banners}<p class="ba-lead k-mt">${u('boards.noGames')}</p>`;
  const g = v.game;
  const chips = v.games.map((x) => html`<button class="ba-chip" type="button" data-action="boards.game" data-game="${x.id}" aria-pressed="${x.id === g.id ? 'true' : 'false'}"><img src="${ctx.assets.tile(x.catalogue.tile, 400)}" alt="" width="34" height="26">${titleOf(ctx, x)}</button>`);
  return html`${head}${banners}<p class="k-sub">${u('boards.sub')}</p>
    <div class="k-boardctl k-mt-lg">
      <div class="ba-filters k-gamechips" role="group" aria-label="${u('boards.game')}">${chips}</div>
      <form data-form="boards" novalidate>
        <div class="k-boardsegs">
          ${segmented('scope', u('boards.scope'), [{ value: 'friends', label: u('boards.friends'), checked: v.scope === 'friends' }, { value: 'country', label: u('boards.country'), checked: v.scope === 'country' }], { legendClass: 'k-label' })}
          ${segmented('week', u('boards.week'), [{ value: 'current', label: u('boards.current'), checked: v.week === 'current' }, { value: 'previous', label: u('boards.previous'), checked: v.week === 'previous' }], { legendClass: 'k-label' })}
        </div>
      </form>
    </div>
    <section aria-live="polite" aria-busy="${v.loading ? 'true' : 'false'}"${attr('data-game', g.id)}>${list(ctx, v, g)}</section>
    <p class="ba-small k-mt-lg">${u('boards.honest')}</p>`;
}

export function boardsPage(ctx: ViewContext, v: BoardsView): SafeHtml {
  return chrome(ctx, { tab: 'friends', main: boardsMain(ctx, v), mainClass: 'ba-page--boards', pushed: true });
}
