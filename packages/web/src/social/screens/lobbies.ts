// Public lobbies and quick match, for players 13 and older. Strangers appear as ghosts (a skeleton and a display name,
// preset messages, no video). Quick match looks for a lobby at the player's level every four seconds; after twenty seconds
// it offers a race against a practice ghost, and after two minutes it says nobody came.
import { attr, html, type SafeHtml } from '../../../../core/ui/html.ts';
import { glyph } from '../../../../core/ui/glyphs.ts';
import { icon } from '../../../../core/ui/icons.ts';
import { LEVEL_BANDS, REGIONS, type LevelBand, type LobbyEntry, type Region } from '../../../../core/social/types.ts';
import type { ShellGame } from '../../../catalogue/types.ts';
import { titleOf, type ViewContext } from '../../context.ts';
import { chrome } from '../../views/chrome.ts';
import { segmented } from '../../views/forms.ts';
import { pageHead } from '../../views/parts.ts';
import { dateTimeText } from '../messages.ts';
import type { SocialState } from '../port.ts';
import { ux } from '../strings.ts';
import { stateBanners } from '../ui.ts';
import { kidPanel, needProfile, under13Panel } from './friends.ts';

/** The state of a quick match search, as the page draws it. */
export interface QuickView {
  phase: 'idle' | 'looking' | 'timeout';
  /** The room the search opened and waits in (no player came yet). */
  hosting: boolean;
  waitedMs: number;
  /** After twenty seconds: a race against a ghost is offered (the player can wave it away and keep looking). */
  offerGhost: boolean;
  /** What stopped the last search, when it was not the player or the clock. */
  note: string | null;
}

export const IDLE_QUICK: QuickView = { phase: 'idle', hosting: false, waitedMs: 0, offerGhost: false, note: null };

export interface LobbiesView {
  state: SocialState;
  /** The games that have online play; empty when none do. */
  games: readonly ShellGame[];
  game: ShellGame | null;
  band: LevelBand;
  region: Region;
  /** null while the list loads. */
  list: readonly LobbyEntry[] | null;
  /** The sentence for why the list did not load, or null. */
  failed: string | null;
  quick: QuickView;
}

const bandLabel = (ctx: ViewContext, b: LevelBand): string => ctx.i18n.tx(`lobby.band.${b}`);

const seatDots = (ctx: ViewContext, n: number, of: number): SafeHtml =>
  html`<span class="k-seatdots" role="img" aria-label="${ctx.i18n.t('lobby.seats', { n, of })}">${Array.from({ length: of }, (_, i) => html`<i class="${i < n ? '' : 'free'}"></i>`)}</span>`;

function lobbyRow(ctx: ViewContext, g: ShellGame, l: LobbyEntry): SafeHtml {
  const t = ctx.i18n;
  const u = ux(ctx);
  const full = l.open <= 0;
  const level = l.band ? t.t('lobby.levelLine', { level: bandLabel(ctx, l.band) }) : t.t('lobby.anyLevel');
  return html`<li class="${full ? 'full' : ''}"><img src="${ctx.assets.tile(g.catalogue.tile, 400)}" alt="" width="72" height="54"><div><b>${level}</b><small>${seatDots(ctx, l.players, l.size)}<span>${u('lobby.playersShort', { n: l.players, of: l.size })}</span><span>${t.t('lobby.host', { name: l.hostName })}</span></small></div>${full
    ? html`<span class="ba-badge">${t.t('lobby.full')}</span>`
    : html`<button class="ba-btn ba-btn--secondary" type="button" data-action="lobby.join" data-code="${l.code}" aria-label="${t.t('lobby.joinLabel', { level: l.band ? bandLabel(ctx, l.band) : t.t('lobby.anyLevel'), name: l.hostName })}">${t.t('lobby.join')}</button>`}</li>`;
}

function ghostCard(ctx: ViewContext, o: { title: string; body: string; again?: SafeHtml }): SafeHtml {
  const u = ux(ctx);
  return html`<div class="k-ghostcard" role="status"><b>${o.title}</b><p>${o.body}</p><div class="k-rowbtns k-rowbtns--wrap"><button class="ba-btn ba-btn--primary" type="button" data-action="lobby.ghost">${icon('replay')}${u('lobby.quick.ghostCta')}</button>${o.again ?? ''}</div></div>`;
}

function quickPanel(ctx: ViewContext, v: LobbiesView, g: ShellGame | null): SafeHtml {
  const t = ctx.i18n;
  const u = ux(ctx);
  const q = v.quick;
  const looking = q.phase === 'looking';
  const seconds = Math.floor(q.waitedMs / 1000);
  return html`<form class="k-card k-quick" data-form="lobby" aria-labelledby="qm">
    <h2 id="qm" class="k-h3 k-flat">${t.t('lobby.quick.title')}</h2>
    ${g ? html`<div class="k-pick"><img src="${ctx.assets.tile(g.catalogue.tile, 400)}" alt="" width="64" height="48"><div><small>${t.t('lobby.quick.game')}</small><b>${titleOf(ctx, g)}</b></div></div>` : ''}
    ${segmented('band', t.t('lobby.level'), LEVEL_BANDS.map((b) => ({ value: b, label: bandLabel(ctx, b), checked: b === v.band, disabled: looking })), { legendClass: 'k-label' })}
    ${looking
      ? html`<div class="k-searching" role="status"><span class="k-spinner" aria-hidden="true"></span><div><b>${seconds < 2 ? t.t('lobby.quick.searching') : u('lobby.quick.elapsed', { n: seconds })}</b>${q.hosting ? html`<p>${t.t('lobby.quick.waiting')}</p>` : ''}</div></div>
        ${q.offerGhost ? ghostCard(ctx, { title: u('lobby.quick.ghostTitle'), body: u('lobby.quick.ghostBody'), again: html`<button class="ba-btn ba-btn--secondary" type="button" data-action="lobby.keep">${u('lobby.quick.keep')}</button>` }) : ''}
        <button class="ba-btn ba-btn--secondary ba-btn--lg" type="button" data-action="lobby.stop">${t.t('lobby.quick.stop')}</button>`
      : q.phase === 'timeout'
        ? html`${ghostCard(ctx, { title: u('lobby.quick.timeoutTitle'), body: u('lobby.quick.timeoutBody'), again: html`<button class="ba-btn ba-btn--secondary" type="button" data-action="lobby.quick"${attr('disabled', !g)}>${icon('search')}${u('lobby.quick.again')}</button>` })}`
        : html`${q.note ? html`<p class="ba-small k-note-line is-error" role="status">${q.note}</p>` : ''}<button class="ba-btn ba-btn--primary ba-btn--lg" type="button" data-action="lobby.quick"${attr('disabled', !g)}>${icon('search')}${t.t('lobby.quick.cta')}</button>`}
  </form>`;
}

export function lobbiesMain(ctx: ViewContext, v: LobbiesView): SafeHtml {
  const t = ctx.i18n;
  const u = ux(ctx);
  const s = v.state;
  const g = v.game;
  const head = pageHead(ctx, t.t('lobby.title'), { back: ctx.href('friends') });
  if (v.games.length === 0) return html`${head}<p class="ba-lead k-mt">${t.t('lobby.noGames')}</p>`;
  if (s.noOnline === 'under13') return html`${head}${under13Panel(ctx)}`;
  if (s.noOnline === 'kid') return html`${head}${kidPanel(ctx)}`;
  const banners = stateBanners(ctx, s).filter((b) => !b.value.includes('data-banner="suspended"'));
  let body: SafeHtml;
  const p = s.profile;
  if (!p) {
    body = needProfile(ctx, s, { icon: 'users', title: t.t('lobby.title'), body: t.t('lobby.needProfile') });
    return html`${head}<p class="k-sub">${t.t('lobby.sub')}</p>${banners}<div class="k-mt">${body}</div>`;
  }
  if (s.bannedUntil !== null) return html`${head}${banners}`;
  if (!p.can.publicPlay) body = html`<p class="ba-callout k-mt">${icon('shield')}<span>${t.t('lobby.closed')}</span></p>`;
  else if (p.publicBlockedUntil > Date.now()) body = html`<p class="ba-callout k-mt">${icon('shield')}<span>${u('lobby.suspendedUntil', { until: dateTimeText(ctx, p.publicBlockedUntil) })}</span></p>`;
  else {
    const chips = v.games.map((x) => html`<button class="ba-chip" type="button" data-action="lobby.game" data-game="${x.id}" aria-pressed="${x.id === g?.id ? 'true' : 'false'}"><img src="${ctx.assets.tile(x.catalogue.tile, 400)}" alt="" width="34" height="26">${titleOf(ctx, x)}</button>`);
    const list = v.list;
    const rows = list === null && !v.failed
      ? html`<p class="ba-small k-mt" role="status">${t.t('lobby.loading')}</p>`
      : v.failed ? html`<p class="ba-small k-mt" role="status">${v.failed}</p><button class="ba-btn ba-btn--secondary k-mt" type="button" data-action="lobby.refresh">${t.t('common.retry')}</button>`
      : (list ?? []).length === 0 ? html`<p class="ba-small k-mt">${t.t('lobby.none')}</p>`
      : html`<ul class="k-lobbies k-mt">${g ? (list ?? []).map((l) => lobbyRow(ctx, g, l)) : ''}</ul>`;
    body = html`<div class="ba-filters k-gamechips k-mt-lg" role="group" aria-label="${t.t('lobby.games')}">${chips}</div>
    <div class="k-cols k-cols--side k-mt-lg">
      <div class="k-stack">
        <section aria-labelledby="open">
          <header class="k-sechead"><h2 id="open" class="k-h3">${g ? t.t('lobby.open', { game: titleOf(ctx, g) }) : t.t('lobby.title')}</h2>
            <span class="k-regionpick"><label class="ba-small" for="lobby-region">${u('lobby.region')}</label><select class="ba-input k-regionselect" id="lobby-region" name="region" data-form="lobby-region" data-key="lobby-region">${REGIONS.map((r) => html`<option value="${r}"${attr('selected', r === v.region)}>${t.tx(`lobby.region.${r}`)}</option>`)}</select><button class="ba-icon-btn" type="button" data-action="lobby.refresh" aria-label="${u('lobby.refresh')}">${icon('replay')}</button></span></header>
          ${rows}
          <button class="ba-btn ba-btn--quiet k-mt" type="button" data-action="lobby.start"${attr('disabled', !g)}>${icon('plus')}${t.t('lobby.start')}</button>
        </section>
      </div>
      <aside class="k-stack">
        ${quickPanel(ctx, v, g)}
        <section class="k-card k-ghostnote"><span class="pic">${glyph('jackOpen', { ink: '#F4F2F8', accent: '#46B4FF', ball: '#46B4FF', floor: false, size: 100, decorative: true })}</span><p>${t.t('lobby.ghost')}</p></section>
      </aside>
    </div>`;
  }
  return html`${head}<p class="k-sub">${t.t('lobby.sub')}</p>${banners}${body}`;
}

export function lobbiesPage(ctx: ViewContext, v: LobbiesView): SafeHtml {
  return chrome(ctx, { tab: 'friends', main: lobbiesMain(ctx, v), mainClass: 'ba-page--lobbies', pushed: true });
}
