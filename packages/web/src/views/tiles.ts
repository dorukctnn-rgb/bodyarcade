// A game tile and the region filter. The filter is made of links to the region pages, so it works for crawlers and
// without scripts, and in the browser a click is an instant page change with a shareable address.
import { attr, html, type SafeHtml } from '../../../core/ui/html.ts';
import { glyph, REGION_GLYPHS } from '../../../core/ui/glyphs.ts';
import { icon } from '../../../core/ui/icons.ts';
import type { BodyRegion } from '../../../core/types/index.ts';
import { regionCounts, supportsLocal2 } from '../../catalogue/filter.ts';
import type { ShellGame } from '../../catalogue/types.ts';
import { durationLabel, hasPro, mainRegion, regionLabel, titleOf, type ViewContext } from '../context.ts';
import { REGION_ORDER } from '../routes.ts';

export function tileImage(ctx: ViewContext, g: ShellGame, sizes: string): SafeHtml {
  const stem = g.catalogue.tile;
  return html`<img src="${ctx.assets.tile(stem, 400)}" srcset="${ctx.assets.tile(stem, 400)} 400w, ${ctx.assets.tile(stem, 800)} 800w" sizes="${sizes}" width="400" height="300" alt="" loading="lazy" decoding="async">`;
}

const TILE_SIZES = '(min-width: 1680px) 300px, (min-width: 900px) 25vw, (min-width: 600px) 33vw, 50vw';

export function gameTile(ctx: ViewContext, g: ShellGame): SafeHtml {
  const t = ctx.i18n;
  const pro = !g.free && !hasPro(ctx) ? html`<span class="ba-badge ba-badge--pro">${t.t('common.pro')}</span>` : '';
  const region = mainRegion(g);
  const two = ctx.caps.local2 && supportsLocal2(g) ? html`<span class="ba-tag2">${t.t('game.badge.local2')}</span>` : '';
  const seat = g.seated ? html`<span class="ba-seat" title="${t.t('game.badge.seated')}" role="img" aria-label="${t.t('game.badge.seated')}">${icon('chair')}</span>` : '';
  return html`<a class="ba-tile" href="${ctx.href('game', { params: { slug: g.seo.slug } })}" data-game="${g.id}">
    <span class="art">${tileImage(ctx, g, TILE_SIZES)}${pro}</span>
    <span class="t">${titleOf(ctx, g)}</span>
    <span class="meta">${glyph(g.catalogue.move, { decorative: true, floor: false, size: 22 })}<span>${regionLabel(ctx, region)}</span><span class="dot-sep" aria-hidden="true"></span><span>${durationLabel(ctx, g.durationSec)}</span>${seat}${two}</span>
  </a>`;
}

export function gameGrid(ctx: ViewContext, games: readonly ShellGame[], label?: string): SafeHtml {
  return html`<ul class="ba-grid" ${attr('aria-label', label)}>${games.map((g) => html`<li>${gameTile(ctx, g)}</li>`)}</ul>`;
}

/** The chips above the grid: all games, then each body region that has games. `active` is the region page being shown. */
export function regionChips(ctx: ViewContext, active: BodyRegion | null): SafeHtml {
  const t = ctx.i18n;
  const counts = regionCounts(ctx.games, REGION_ORDER);
  const chip = (href: string, label: string, current: boolean, glyphHtml: SafeHtml): SafeHtml =>
    html`<a class="ba-chip" href="${href}"${attr('aria-current', current && 'page')}>${glyphHtml}<span>${label}</span></a>`;
  const all = chip(ctx.href('home'), t.t('home.all'), active === null, glyph('stand', { decorative: true, floor: false, size: 34 }));
  const rest = counts.map(({ region }) => {
    const g = REGION_GLYPHS[region];
    const gl = g ? glyph(g.pose, { decorative: true, floor: false, size: 34, highlight: g.highlight }) : html``;
    return chip(ctx.href('region', { params: { region } }), regionLabel(ctx, region), active === region, gl);
  });
  return html`<nav class="ba-filters" aria-label="${t.t('a11y.regionFilter')}">${all}${rest}</nav>`;
}
