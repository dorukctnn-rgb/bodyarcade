// The Leano card: a small, quiet cross-promotion of our body-measurement app Leano (App Store id 6761293700) for visitors on an iPhone
// or an iPad, drawn in two places only: under the before/after band of the home page (the progress section, where the site talks
// about tape measures and a 3D twin) and at the end of the results screen (after a round, below the Pro card, above the buttons that
// go on playing). Never in a game, never in the Android app, never on a desktop, never on a page a crawler reads (app/leano-offer.ts
// decides, in the browser; the page generator draws nothing), never for a child's profile.
//
// What it says is what Leano's own App Store page says (takip/devir/aso-portfoy-21kas/leano/METIN.md): it estimates body fat %, BMI and
// waist-to-height ratio from a soft tape measure and shapes a 3D twin from the numbers; free to download, no account, no ads. No time
// is promised ("in 30 seconds" is not true of Leano's quick measure, which takes about two minutes) and nobody is called a result.
// The badge is Apple's own artwork in the page's language (design/brand/appstore), unaltered, 56 px high like the site's buttons.
import { html, type SafeHtml } from '../../../core/ui/html.ts';
import type { Lang } from '../../../core/ui/i18n/index.ts';
import { leanoHref, type LeanoPlace } from '../app/leano-offer.ts';
import type { ViewContext } from '../context.ts';

/** The badge's size in CSS px at the site's button height (56): the width of each language's artwork (its viewBox) at that height. */
export const BADGE_SIZE: Readonly<Record<Lang, { width: number; height: number }>> = {
  en: { width: 168, height: 56 },
  tr: { width: 212, height: 56 },
  de: { width: 168, height: 56 },
  es: { width: 168, height: 56 },
  fr: { width: 177, height: 56 },
};

/** Does this visitor get the card: an iPhone or an iPad, a player who is not a child, and a page drawn for a visitor. */
export const leanoShown = (ctx: Pick<ViewContext, 'leano' | 'server' | 'player'>): boolean => ctx.leano && !ctx.server && !ctx.player?.kid;

/**
 * The card for a place. `level` is the heading level that fits the page around it (3 under the band's own title, 2 among the
 * results screen's sections). Nothing for a visitor who does not get it.
 */
export function leanoCard(ctx: ViewContext, place: LeanoPlace, level: 2 | 3): SafeHtml {
  if (!leanoShown(ctx)) return html``;
  const t = ctx.i18n;
  const id = `leano-h-${place}`;
  const size = BADGE_SIZE[ctx.lang];
  const title = t.t('leano.title');
  const heading = level === 2 ? html`<h2 class="k-h3" id="${id}">${title}</h2>` : html`<h3 class="k-h3" id="${id}">${title}</h3>`;
  return html`<section class="k-leano k-leano--${place}" aria-labelledby="${id}" data-leano="${place}">
    <div class="k-leano-text">
      <p class="k-eyebrow">${t.t('leano.eyebrow')}</p>
      ${heading}
      <p class="k-body">${t.t('leano.body')}</p>
      <p class="k-meta">${t.t('leano.note')}</p>
    </div>
    <a class="k-leano-badge" href="${leanoHref(place)}" rel="noopener" data-native data-leano-link="${place}"><img src="${ctx.assets.badge(ctx.lang)}" alt="${t.t('leano.badge.alt')}" width="${size.width}" height="${size.height}" decoding="async"></a>
  </section>`;
}
