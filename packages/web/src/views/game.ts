// A game's page: what it is, how to play it, where to stand, what the camera reads, and a way in. Generated from the
// manifest, so it can only say what the manifest says (rule 8: only the modes the game lists).
import { html, type SafeHtml } from '../../../core/ui/html.ts';
import { glyph, type PoseName } from '../../../core/ui/glyphs.ts';
import { icon } from '../../../core/ui/icons.ts';
import { localized } from '../../../core/ui/i18n/localized.ts';
import type { Framing } from '../../../core/types/index.ts';
import { relatedGames, supportsLocal2 } from '../../catalogue/filter.ts';
import type { ShellGame } from '../../catalogue/types.ts';
import { accessOf, aboutOf, durationLabel, regionLabel, taglineOf, titleOf, type Access, type ViewContext } from '../context.ts';
import { chrome } from './chrome.ts';
import { gameGrid } from './tiles.ts';

const FRAMING_POSE: Readonly<Record<Framing, PoseName>> = { full: 'stand', upper: 'seated', side: 'squat' };

/** The words about whether this player can start the game now. */
export function accessNote(ctx: ViewContext, g: ShellGame, access: Access): string {
  const t = ctx.i18n;
  if (access === 'free') return t.t('setup.note.free');
  if (access === 'once') return t.t('setup.note.once');
  if (access === 'locked') return t.t('setup.note.used');
  return '';
}

/** The main button: Play, or the way to Pro when the free round of a Pro game is used up. */
export function playButton(ctx: ViewContext, g: ShellGame, o: { large?: boolean } = {}): SafeHtml {
  const t = ctx.i18n;
  const access = accessOf(ctx, g);
  const cls = `ba-btn ba-btn--primary${o.large ? ' ba-btn--lg' : ''}`;
  if (access === 'locked') {
    return html`<a class="${cls}" href="${ctx.href('pro')}" data-action="open-pro" data-game="${g.id}">${icon('lock')}<span>${t.t('setup.needPro')}</span></a>`;
  }
  return html`<a class="${cls}" href="${ctx.href('play', { params: { slug: g.seo.slug } })}" data-action="open-setup" data-game="${g.id}">${icon('play')}<span>${t.t('game.play')}</span></a>`;
}

function facts(ctx: ViewContext, g: ShellGame): SafeHtml {
  const t = ctx.i18n;
  const regions = ctx.i18n.list(g.regions.map((r) => regionLabel(ctx, r)));
  const badge = (ic: Parameters<typeof icon>[0], text: string): SafeHtml => html`<li class="ba-fact">${icon(ic)}<span>${text}</span></li>`;
  return html`<ul class="ba-facts" aria-label="${t.t('game.section.measures')}">
    ${badge('clock', durationLabel(ctx, g.durationSec))}
    ${badge('user', regions)}
    ${g.seated ? badge('chair', t.t('game.badge.seated')) : ''}
    ${g.silentSafe ? badge('quiet', t.t('game.badge.quiet')) : ''}
    ${g.lowImpact ? badge('check', t.t('game.badge.lowImpact')) : ''}
    ${supportsLocal2(g) ? badge('users', t.t('game.badge.local2')) : ''}
    <li class="ba-fact ba-fact--tier">${g.free ? t.t('common.free') : t.t('common.pro')}</li>
  </ul>`;
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

export function gamePage(ctx: ViewContext, g: ShellGame): SafeHtml {
  const t = ctx.i18n;
  const c = g.catalogue;
  const access = accessOf(ctx, g);
  const note = accessNote(ctx, g, access);
  const related = relatedGames(g, ctx.games, 3);
  const framingTip = t.tx(`game.framing.${g.framing}.tip`);
  const main = html`
    <p class="ba-crumb"><a href="${ctx.href('home')}">${icon('back')}<span>${t.t('game.back')}</span></a></p>
    <article class="ba-game" aria-labelledby="game-h1">
      <header class="ba-gamehead">
        <div class="ba-gameart"><img src="${ctx.assets.tile(c.tile, 800)}" srcset="${ctx.assets.tile(c.tile, 400)} 400w, ${ctx.assets.tile(c.tile, 800)} 800w" sizes="(min-width: 900px) 46vw, 92vw" width="800" height="600" alt="" fetchpriority="high" decoding="async"></div>
        <div class="ba-gameinfo">
          <h1 class="ba-h1" id="game-h1" data-main-heading>${titleOf(ctx, g)}</h1>
          <p class="ba-lead">${taglineOf(ctx, g)}</p>
          ${facts(ctx, g)}
          <div class="ba-actions">${playButton(ctx, g, { large: true })}</div>
          ${note ? html`<p class="ba-small ba-accessnote">${note}</p>` : ''}
        </div>
      </header>

      <section class="ba-block" aria-labelledby="g-about"><h2 id="g-about">${t.t('game.section.about')}</h2><p>${aboutOf(ctx, g)}</p></section>

      <div class="ba-twocol">
        <section class="ba-block" aria-labelledby="g-how"><h2 id="g-how">${t.t('game.section.how')}</h2>
          <ol class="ba-steps">${c.how.map((s) => html`<li>${localized(s, ctx.lang)}</li>`)}</ol>
        </section>
        <section class="ba-block" aria-labelledby="g-stand"><h2 id="g-stand">${t.t('game.section.stand')}</h2>
          <div class="ba-stand">${glyph(FRAMING_POSE[g.framing], { decorative: true, floor: true, size: 72 })}<div><p><b>${t.tx(`game.framing.${g.framing}`)}</b></p><p>${framingTip}</p></div></div>
        </section>
      </div>

      <section class="ba-block" aria-labelledby="g-measures"><h2 id="g-measures">${t.t('game.section.measures')}</h2>
        <ul class="ba-bullets">${c.measures.map((s) => html`<li>${localized(s, ctx.lang)}</li>`)}</ul>
        <p class="ba-small">${t.t('game.measures.not')}</p>
      </section>

      ${variants(ctx, g)}

      <section class="ba-block" aria-labelledby="g-safety"><h2 id="g-safety">${t.t('game.section.safety')}</h2>
        <p class="ba-callout">${icon('info')}<span><b>${t.t('onboarding.s4.healthLead')}</b> ${t.t('onboarding.s4.health')}</span></p>
      </section>

      ${related.length ? html`<section class="ba-block" aria-labelledby="g-related"><h2 id="g-related">${t.t('game.section.related')}</h2>${gameGrid(ctx, related, t.t('game.section.related'))}</section>` : ''}
    </article>`;
  return chrome(ctx, { tab: 'games', main, mainClass: 'ba-page--game' });
}
