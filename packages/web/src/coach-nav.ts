// The navigation of the coach pages (the form coach and the progress coach run as apps of their own, without the site's frame):
// the brand back to the home page and the same five places as the site's own navigation (games, Today, the form coach, progress
// and duels), in the page's language. Real links, so each one loads its page.
import { createI18n, type Lang } from '../../core/ui/i18n/index.ts';
import { router } from './routes.ts';

export type CoachNavPlace = 'today' | 'coach' | 'progress';

const CSS = `
.cn{display:flex;flex-wrap:wrap;align-items:center;gap:6px 4px;margin:0;padding:0}
.cn a{display:inline-flex;align-items:center;min-height:44px;padding:0 12px;border-radius:12px;font-weight:700;font-size:15px;color:#A79FBE;text-decoration:none}
.cn a:hover,.cn a:focus-visible{color:#F4F2F8;background:rgba(244,242,248,.06)}
.cn a[aria-current="page"]{color:#F4F2F8;background:#241A42;box-shadow:inset 0 0 0 1.5px #31285A}
@media (max-width:560px){.cn{width:100%;gap:2px}.cn a{padding:0 9px;font-size:14px}}
`;

/** The address of a place in a language (the home page's duel section for duels). */
export function coachNavHref(place: 'games' | 'duel' | CoachNavPlace, lang: Lang): string {
  if (place === 'games') return router.href('home', { lang });
  if (place === 'duel') return `${router.href('home', { lang })}#duel`;
  return router.href(place === 'coach' ? 'formcoach' : place, { lang });
}

/** The brand link and the navigation, as elements for the top of a coach page. */
export function coachNav(doc: Document, lang: Lang, here: CoachNavPlace): { brand: HTMLAnchorElement; nav: HTMLElement } {
  if (!doc.getElementById('cn-css')) { const s = doc.createElement('style'); s.id = 'cn-css'; s.textContent = CSS; doc.head.append(s); }
  const t = createI18n(lang);
  const brand = doc.createElement('a'); brand.href = coachNavHref('games', lang); brand.textContent = t.t('brand.name');
  const nav = doc.createElement('nav'); nav.className = 'cn'; nav.setAttribute('aria-label', t.t('nav.label'));
  const places: ['games' | 'duel' | CoachNavPlace, string][] = [['games', t.t('nav.games')], ['today', t.t('nav.today')], ['coach', t.t('nav.coach')], ['progress', t.t('nav.progress')], ['duel', t.t('nav.duel')]];
  for (const [p, label] of places) {
    const a = doc.createElement('a'); a.href = coachNavHref(p, lang); a.textContent = label; a.dataset.coachNav = p;
    if (p === here) a.setAttribute('aria-current', 'page');
    nav.append(a);
  }
  return { brand, nav };
}
