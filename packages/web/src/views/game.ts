// A game's page (design/ui-kit/game.html): the art, how to play, who is playing and how hard, your best, and the Play
// button; a Pro game whose free round is used shows the honest lock instead. Below it the page carries what a search
// engine and a careful player want: what the game is, where to stand, what the camera reads, the seated and quiet
// versions and safety. Generated from the manifest, so it can only say what the manifest says (rule 8).
import { html, type SafeHtml } from '../../../core/ui/html.ts';
import { glyph, type PoseName } from '../../../core/ui/glyphs.ts';
import { icon } from '../../../core/ui/icons.ts';
import { localized } from '../../../core/ui/i18n/localized.ts';
import type { Framing } from '../../../core/types/index.ts';
import { proGames, relatedGames } from '../../catalogue/filter.ts';
import type { ShellGame } from '../../catalogue/types.ts';
import { accessOf, aboutOf, durationLabel, regionLabel, taglineOf, titleOf, type Access, type ViewContext } from '../context.ts';
import type { FamilyEntry } from '../../../core/store/index.ts';
import { chrome } from './chrome.ts';
import { pageHead } from './parts.ts';
import type { GhostRun } from '../../../core/net/ghost.ts';
import { canRace } from '../app/duel.ts';
import { familyTable } from './profiles.ts';
import { ghostOffer } from './race.ts';
import { defaultSetup, setupFields, startLabel, twoPlayersPossible, type SetupState } from './setup.ts';
import { gameGrid } from './tiles.ts';

const FRAMING_POSE: Readonly<Record<Framing, PoseName>> = { full: 'stand', upper: 'seated', side: 'squat' };

/** What the page knows about this player and this game; empty on the server. */
export interface GameData {
  /** The best score on any difficulty, or null. */
  best: number | null;
  /** The choices on the page; the defaults for this player when not given. */
  setup?: SetupState;
  /** This game is the challenge of the day, and how it stands. */
  challenge?: { done: boolean; bonus: boolean } | null;
  /** The players of this device and their best in this game (the table is drawn from two players on). */
  family?: readonly FamilyEntry[];
  /** A friend's link (`?ghost=<code>`) opened on this page: the recording in it and the address of the race. */
  ghostOffer?: { run: GhostRun; startHref: string } | null;
}

export const NO_GAME_DATA: GameData = { best: null, challenge: null };

/** The words about whether this player can start the game now. */
export function accessNote(ctx: ViewContext, access: Access): string {
  const t = ctx.i18n;
  if (access === 'free') return t.t('setup.note.free');
  if (access === 'once') return t.t('setup.note.once');
  if (access === 'locked') return t.t('setup.note.used');
  return '';
}

function facts(ctx: ViewContext, g: ShellGame): SafeHtml {
  const t = ctx.i18n;
  const regions = ctx.i18n.list(g.regions.map((r) => regionLabel(ctx, r)));
  return html`<ul class="k-facts" aria-label="${t.t('game.section.measures')}">
    <li>${glyph(g.catalogue.move, { decorative: true, floor: false, size: 22 })}${regions}</li>
    <li>${icon('clock')}${t.t('game.round', { time: durationLabel(ctx, g.durationSec) })}</li>
    ${g.seated ? html`<li>${icon('chair')}${t.t('game.badge.seated')}</li>` : ''}
    ${g.silentSafe ? html`<li>${icon('quiet')}${t.t('game.badge.quiet')}</li>` : ''}
    ${g.lowImpact ? html`<li>${icon('check')}${t.t('game.badge.lowImpact')}</li>` : ''}
    ${twoPlayersPossible(ctx, g) ? html`<li>${icon('users')}${t.t('game.badge.local2')}</li>` : ''}
  </ul>`;
}

function how(ctx: ViewContext, g: ShellGame): SafeHtml {
  return html`<ol class="k-how">${g.catalogue.how.map((s, i) => html`<li><span class="g" aria-hidden="true">${i + 1}</span><div><span class="s">${localized(s, ctx.lang)}</span></div></li>`)}</ol>`;
}

function variants(ctx: ViewContext, g: ShellGame): SafeHtml {
  const t = ctx.i18n;
  const c = g.catalogue;
  const items: SafeHtml[] = [];
  if (g.seated) items.push(html`<li>${icon('chair')}<div><h3>${t.t('game.badge.seated')}</h3><p>${localized(c.seatedNote, ctx.lang)}</p></div></li>`);
  if (g.silentSafe) items.push(html`<li>${icon('quiet')}<div><h3>${t.t('game.badge.quiet')}</h3><p>${localized(c.quietNote, ctx.lang)}</p></div></li>`);
  if (g.lowImpact) items.push(html`<li>${icon('check')}<div><h3>${t.t('game.badge.lowImpact')}</h3><p>${t.t('game.lowImpact.note')}</p></div></li>`);
  if (items.length === 0) return html``;
  return html`<section class="ba-block" aria-labelledby="g-variants"><h2 id="g-variants">${t.t('game.section.variants')}</h2><ul class="ba-variants">${items}</ul></section>`;
}

/**
 * The part of the page that starts a round: the lock for a Pro game without a free round, else the setup and Play. On a phone only
 * Play stays at the foot of the screen (the action bar); the races and the note follow it in the page, so the bar never lies over the
 * game's name and facts (release 3, 27 Oct: at 360 x 640 the bar of three buttons and a paragraph was 43 % of the screen).
 */
function play(ctx: ViewContext, g: ShellGame, data: GameData, access: Access): SafeHtml {
  const t = ctx.i18n;
  if (access === 'locked') {
    const pro = proGames(ctx.games).length;
    return html`<div class="k-block k-card k-lockcard"><span class="ico">${icon('lock')}</span><div><b>${t.t('paywall.locked', { game: titleOf(ctx, g) })}</b><p>${t.t('game.lock.body', { n: pro, free: ctx.games.length - pro })}</p></div></div>
      <div class="k-actionbar"><div class="k-actions"><a class="ba-btn ba-btn--primary ba-btn--lg" href="${ctx.href('pro', { query: { game: g.id } })}">${icon('lock')}<span>${t.t('settings.pro.see')}</span></a><a class="ba-btn ba-btn--secondary ba-btn--lg" href="${ctx.href('home')}">${t.t('game.lock.free')}</a></div></div>`;
  }
  const state = data.setup ?? defaultSetup(ctx, g);
  // A race with a friend: only where the game can be raced and the friends side exists in this build.
  const race = ctx.flags.social && g.modes.includes('duel')
    ? html`<button type="button" class="ba-btn ba-btn--secondary ba-btn--lg" data-action="race.new" data-game="${g.id}">${icon('users')}<span>${t.t('game.race')}</span></button>` : '';
  // A race against a recording: any game that can be raced, on its own at any time (the window asks who to race).
  const ghost = canRace(g)
    ? html`<button type="button" class="ba-btn ba-btn--secondary ba-btn--lg" data-action="ghost-open" data-game="${g.id}">${icon('replay')}<span>${t.t('race.ghost')}</span></button>` : '';
  return html`${data.ghostOffer ? ghostOffer(ctx, data.ghostOffer) : ''}<form data-form="setup" data-game="${g.id}" method="get" action="${ctx.href('play', { params: { slug: g.seo.slug } })}" novalidate>
    <div data-setup-fields>${setupFields(ctx, g, state)}</div>
    ${data.best !== null ? html`<div class="k-block k-best">${icon('star')}<span>${t.t('game.best', { score: ctx.i18n.number(data.best) })}</span></div>` : ''}
    <div class="k-actionbar"><div class="k-actions"><button type="submit" class="ba-btn ba-btn--primary ba-btn--lg" data-key="play">${icon('play')}<span>${startLabel(ctx, g)}</span></button></div></div>
    ${race || ghost ? html`<div class="k-actions k-moreplay">${race}${ghost}</div>` : ''}
    <p class="k-note k-playnote">${access === 'once' ? `${t.t('setup.note.once')} ` : ''}${t.t('game.cameraNote')}${race ? html` ${t.t('game.race.note')}` : ''}${ghost ? html` ${t.t('game.ghost.note')}` : ''}</p>
  </form>`;
}

export function gamePage(ctx: ViewContext, g: ShellGame, data: GameData = NO_GAME_DATA): SafeHtml {
  const t = ctx.i18n;
  const c = g.catalogue;
  const access = accessOf(ctx, g);
  const related = relatedGames(g, ctx.games, 3);
  const main = html`
    ${pageHead(ctx, '', { back: ctx.href('home') })}
    <article class="k-detail" aria-labelledby="game-h1">
      <div class="art"><img src="${ctx.assets.tile(c.tile, 800)}" srcset="${ctx.assets.tile(c.tile, 400)} 400w, ${ctx.assets.tile(c.tile, 800)} 800w" sizes="(min-width: 900px) 48vw, 92vw" width="800" height="600" alt="" fetchpriority="high" decoding="async">${g.free ? html`<span class="ba-badge ba-badge--free">${t.t('common.free')}</span>` : html`<span class="ba-badge ba-badge--pro">${t.t('common.pro')}</span>`}</div>
      <div class="k-info">
        <div class="k-top">
          <h1 id="game-h1" data-main-heading>${titleOf(ctx, g)}</h1>
          <p class="k-lead">${taglineOf(ctx, g)}</p>
          ${data.challenge ? html`<p class="k-challengechip" data-challenge-today>${icon(data.challenge.done ? 'check' : 'star')}<span>${t.t('challenge.title')}${data.challenge.done ? `: ${t.t('challenge.done')}` : ''}</span></p>` : ''}
          ${facts(ctx, g)}
        </div>
        <div class="k-block"><span class="k-label">${t.t('game.section.how')}</span>${how(ctx, g)}</div>
        ${play(ctx, g, data, access)}
        ${familyTable(ctx, data.family ?? [])}
      </div>
    </article>

    <section class="ba-block" aria-labelledby="g-about"><h2 id="g-about">${t.t('game.section.about')}</h2><p>${aboutOf(ctx, g)}</p></section>

    <div class="ba-twocol">
      <section class="ba-block" aria-labelledby="g-stand"><h2 id="g-stand">${t.t('game.section.stand')}</h2>
        <div class="ba-stand">${glyph(FRAMING_POSE[g.framing], { decorative: true, floor: true, size: 72 })}<div><p><b>${t.tx(`game.framing.${g.framing}`)}</b></p><p>${t.tx(`game.framing.${g.framing}.tip`)}</p></div></div>
      </section>
      <section class="ba-block" aria-labelledby="g-measures"><h2 id="g-measures">${t.t('game.section.measures')}</h2>
        <ul class="ba-bullets">${c.measures.map((s) => html`<li>${localized(s, ctx.lang)}</li>`)}</ul>
        <p class="ba-small">${t.t('game.measures.not')}</p>
      </section>
    </div>

    ${variants(ctx, g)}

    <section class="ba-block" aria-labelledby="g-safety"><h2 id="g-safety">${t.t('game.section.safety')}</h2>
      <p class="ba-callout">${icon('info')}<span><b>${t.t('onboarding.s4.healthLead')}</b> ${t.t('onboarding.s4.health')}</span></p>
    </section>

    ${related.length ? html`<section class="ba-block" aria-labelledby="g-related"><h2 id="g-related">${t.t('game.section.related')}</h2>${gameGrid(ctx, related, t.t('game.section.related'))}</section>` : ''}`;
  return chrome(ctx, { tab: 'games', main, mainClass: 'ba-page--game', pushed: true });
}
