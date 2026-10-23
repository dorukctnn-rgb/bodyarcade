// The frame around every page: skip link, top bar (wide screens), tab bar (phones, side rail on landscape phones),
// the main landmark and the footer. Navigation is real links, so the site works for crawlers and without scripts.
import { attr, html, type SafeHtml } from '../../../core/ui/html.ts';
import { icon, type IconName } from '../../../core/ui/icons.ts';
import { LANG_INFO, type Lang } from '../../../core/ui/i18n/index.ts';
import { router, INDEXED_LANGS, type NavTab } from '../routes.ts';
import { hasPro, type ViewContext } from '../context.ts';

interface Tab { tab: NavTab; label: string; href: string; icon: IconName }

export function tabsOf(ctx: ViewContext): Tab[] {
  const t = ctx.i18n;
  const tabs: Tab[] = [{ tab: 'games', label: t.t('nav.games'), href: ctx.href('home'), icon: 'arcade' }];
  if (ctx.flags.social) tabs.push({ tab: 'friends', label: t.t('nav.friends'), href: ctx.href('friends'), icon: 'friends' });
  tabs.push({ tab: 'pro', label: t.t('nav.pro'), href: ctx.href('pro'), icon: 'sparkle' });
  tabs.push({ tab: 'settings', label: t.t('nav.settings'), href: ctx.href('settings'), icon: 'settings' });
  return tabs;
}

/** Both logos are in the page; the stylesheet shows the one that fits the theme. */
function logo(ctx: ViewContext, height: number): SafeHtml {
  const name = ctx.i18n.t('brand.name');
  return html`<span class="ba-logo"><img class="ba-logo-light" src="${ctx.assets.logo('light')}" alt="${name}" height="${height}" width="${Math.round(height * 5.59)}"><img class="ba-logo-dark" src="${ctx.assets.logo('dark')}" alt="" aria-hidden="true" height="${height}" width="${Math.round(height * 5.59)}"></span>`;
}

function languageLinks(ctx: ViewContext): SafeHtml {
  const target = router.match(ctx.url) ? ctx.url : ctx.href('home');
  const langs: Lang[] = INDEXED_LANGS.includes(ctx.lang) ? [...INDEXED_LANGS] : [...INDEXED_LANGS, ctx.lang];
  const items = langs.map((l) => {
    const info = LANG_INFO.find((x) => x.code === l);
    const current = l === ctx.lang;
    return html`<li><a href="${router.withLang(target, l)}" lang="${info?.tag ?? l}" hreflang="${info?.tag ?? l}" data-action="lang" data-lang="${l}"${attr('aria-current', current && 'true')}>${info?.name ?? l}</a></li>`;
  });
  return html`<nav class="ba-footer-langs" aria-label="${ctx.i18n.t('footer.language')}"><ul>${items}</ul></nav>`;
}

function footer(ctx: ViewContext): SafeHtml {
  const t = ctx.i18n;
  return html`<footer class="ba-footer">
    <div class="ba-footer-inner">
      <p class="ba-footer-made">${t.t('footer.made')} ${t.t('footer.camera')}</p>
      <ul class="ba-footer-links">
        <li><a href="/privacy" data-native>${t.t('footer.privacy')}</a></li>
        <li><a href="/terms" data-native>${t.t('footer.terms')}</a></li>
        <li><a href="mailto:info@peakappsstudio.com">${t.t('footer.contact')}</a></li>
      </ul>
      ${languageLinks(ctx)}
    </div>
  </footer>`;
}

export interface ChromeOptions {
  tab: NavTab | null;
  main: SafeHtml;
  /** Extra class on the main element. */
  mainClass?: string;
}

/** The whole page body. */
export function chrome(ctx: ViewContext, o: ChromeOptions): SafeHtml {
  const t = ctx.i18n;
  const tabs = tabsOf(ctx);
  const homeLabel = `${t.t('brand.name')}: ${t.t('nav.games')}`;
  const proBadge = hasPro(ctx) ? html`<span class="ba-badge ba-badge--pro">${t.t('common.pro')}</span>` : '';
  const topLinks = tabs.map((x) => html`<a href="${x.href}"${attr('aria-current', o.tab === x.tab && 'page')}>${icon(x.icon)}<span>${x.label}</span></a>`);
  const tabLinks = tabs.map((x) => html`<a class="ba-tab" href="${x.href}"${attr('aria-current', o.tab === x.tab && 'page')}>${icon(x.icon)}<span>${x.label}</span></a>`);
  return html`<div class="ba-app">
    <a class="ba-skip" href="#main">${t.t('common.skipToContent')}</a>
    <header class="ba-topbar">
      <a class="ba-brand" href="${ctx.href('home')}" aria-label="${homeLabel}">${logo(ctx, 32)}</a>
      <nav aria-label="${t.t('nav.label')}">${topLinks}</nav>
      <span class="ba-me">${proBadge}</span>
    </header>
    <main id="main" class="ba-page ${o.mainClass ?? ''}" tabindex="-1">
      <div class="ba-mobilehead"><a class="ba-brand" href="${ctx.href('home')}" aria-label="${homeLabel}">${logo(ctx, 28)}</a>${proBadge}</div>
      ${o.main}
    </main>
    ${footer(ctx)}
    <nav class="ba-tabbar" style="--tabs:${tabs.length}" aria-label="${t.t('nav.label')}">${tabLinks}</nav>
  </div>`;
}

/** A page without the site frame, for the game stage and the welcome tour. */
export function bare(ctx: ViewContext, main: SafeHtml, cls = ''): SafeHtml {
  return html`<div class="ba-app ba-app--bare ${cls}"><a class="ba-skip" href="#main">${ctx.i18n.t('common.skipToContent')}</a><main id="main" tabindex="-1">${main}</main></div>`;
}
