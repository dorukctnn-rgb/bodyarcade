// Kol G (11 Nov): the home page in the Apple Fitness+ order, the navigation's new places and the coach pages, drawn in every language of
// the site: the order of the sections, the before/after band ("illustration", no photo, no promised result), the form coach, Today and
// the progress coach, duels with the office break and family mode, privacy; the five places of the navigation; the first paint of
// /form-coach, /today and /progress. The words follow the copy rules, never say "AI" and make no health claim. Views are functions.
import { describe, expect, it } from 'vitest';
import { textOf } from '../../core/ui/html.ts';
import { LANGS, stringTables, type Lang } from '../../core/ui/i18n/index.ts';
import { FORM_MOVE_IDS } from '../../core/form/moves/index.ts';
import type { UiCapabilities } from '../../core/ui/capabilities.ts';
import { loadCatalogue } from '../catalogue/load.ts';
import { copyProblems } from '../catalogue/copy.ts';
import { makeContext, type ContextInit } from './make-context.ts';
import { EMPTY_STATE, renderPage } from './pages.ts';
import { router } from './routes.ts';
import { FORM_MOVE_COUNT } from './views/home-sections.ts';
import { bandMarkup, bandWords } from './growth/before-after-band.ts';
import { coachNavHref } from './coach-nav.ts';

const games = loadCatalogue({ fixtures: 'only', requiredLangs: ['en', 'tr'] }).catalogue.games;
const phone: UiCapabilities = { device: 'phone', platform: 'web', deviceClass: 'phone', landscape: false, touch: true, camera: true, secure: true, tv: false, keyboard: false, local2: false, local2Reason: 'small_screen' };
const p = (lang: Lang, path: string): string => (lang === 'en' ? path : `/${lang}${path}`);

function draw(lang: Lang, url: string, init: Partial<ContextInit> = {}): { html: string; text: string; missing: string[]; noindex: boolean; status: number; title: string } {
  const missing: string[] = [];
  const ctx = makeContext({ lang, games, url, i18n: { onMissing: (k, l) => missing.push(`${l}:${k}`) }, ...init });
  const r = renderPage(ctx, router.match(url), EMPTY_STATE);
  return { html: r.body.value, text: textOf(r.body.value), missing, noindex: r.noindex, status: r.status, title: r.title };
}

const NEW = /^(nav\.(today|coach|progress|duel)|modes\.duel\.|home\.(coach|today|growth|privacy)\.|coachpage\.)/;
const HEALTH = /\b(cure|cures|treat|treats|treatment|diagnos\w*|heal|heals|lose weight|weight loss|burn fat|fat burn\w*|guarantee\w*)\b|kilo ver|zayıfla|tedavi|teşhis|garanti|\d+\s?%/i;

describe('the new strings of Kol G', () => {
  it.each(LANGS)('%s: every one is there, follows the copy rules, never says AI and claims nothing about health', (lang) => {
    const keys = Object.keys(stringTables.en).filter((k) => NEW.test(k));
    expect(keys.length).toBe(47);
    for (const k of keys) {
      const v = stringTables[lang][k] as string | undefined;
      expect(v, `${lang} ${k}`).toBeTruthy();
      expect(copyProblems(v as string), `${lang} ${k}`).toEqual([]);
      expect(v, `${lang} ${k}`).not.toMatch(/(?<!\p{L})(AI|KI|IA)(?!\p{L})/u);
      expect(v, `${lang} ${k}`).not.toMatch(/yapay zek|artificial intelligence|intelligence artificielle|inteligencia artificial|künstliche intelligenz/i);
      expect(v, `${lang} ${k}`).not.toMatch(HEALTH);
    }
  });

  it('the home page says how many moves the form coach has from the catalogue itself', () => {
    expect(FORM_MOVE_COUNT).toBe(FORM_MOVE_IDS.length);
  });
});

describe.each(['en', 'tr', 'de', 'es', 'fr'] as Lang[])('the home page in %s', (lang) => {
  it('goes: what it is, the before/after band, the games, the form coach, Today and progress, duels and the modes, privacy', () => {
    for (const server of [true, false]) {
      const { html, missing } = draw(lang, p(lang, '/'), { server, ...(server ? {} : { caps: phone }) });
      // the draft languages miss older words (they fall back to English); none of the new ones
      expect(missing.filter((m) => NEW.test(m.slice(m.indexOf(':') + 1)))).toEqual([]);
      const order = ['data-how', 'data-home-band', 'id="games-h"', 'data-home-coach', 'data-home-today', 'data-modes', 'id="duel"', 'data-mode-card="office"', 'data-mode-card="family"', 'data-home-privacy', 'id="about-h"'].map((m) => html.indexOf(m));
      for (const [i, at] of order.entries()) expect(at, `marker ${i}`).toBeGreaterThan(-1);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
    }
  });

  it('shows the before/after band as an illustration of the progress coach: the 3D twin\'s stills, no photo of a person, no result', () => {
    const { html, text } = draw(lang, p(lang, '/'), { server: true });
    const band = html.slice(html.indexOf('data-home-band'), html.indexOf('class="k-hero'));
    const W = bandWords(lang);
    expect((band.match(/class="bab-tag"/g) ?? []).length).toBe(2);
    expect(band.split(`>${W.label}<`).length - 1).toBe(2);
    expect(band).toContain(`href="${router.href('progress', { lang })}"`);
    const imgs = band.match(/<img [^>]*>/g) ?? [];
    expect(imgs).toHaveLength(2);
    for (const img of imgs) expect(img).toMatch(/band-(morph|compare)-800\.webp/);
    expect(text).not.toMatch(/\b\d+\s?(kg|lb|kilo|pounds?)\b/i);
  });

  it('leads to the coach pages with links that load them, and to a duel', () => {
    const { html } = draw(lang, p(lang, '/'), { server: false, caps: phone, flags: { social: true } });
    for (const id of ['formcoach', 'today', 'progress'] as const) expect(html).toMatch(new RegExp(`href="${router.href(id, { lang })}"[^>]*data-native`));
    expect(html).toMatch(/data-action="race\.new" data-game="[a-z-]+"/);
    const crawler = draw(lang, p(lang, '/'), { server: true }).html;
    expect(crawler).not.toContain('data-action="race.new"');
    expect(crawler.slice(crawler.indexOf('id="duel"'))).toMatch(new RegExp(`href="${router.href('home', { lang }).replace(/\/$/, '')}/games/[a-z-]+/"`));
  });

  it('has the five places in the navigation, the phone bar with five, and friends, Pro and settings at the top of a phone page', () => {
    const { html } = draw(lang, p(lang, '/'), { server: false, caps: phone, flags: { social: true } });
    const bar = html.slice(html.indexOf('class="ba-tabbar'));
    expect(bar).toContain('ba-tabbar--5');
    expect((bar.match(/class="ba-tab"/g) ?? []).length).toBe(5);
    for (const tab of ['games', 'today', 'coach', 'progress', 'duel']) expect(bar).toContain(`data-tab="${tab}"`);
    expect(bar).toContain(`href="${router.href('home', { lang })}#duel"`);
    const head = html.slice(html.indexOf('class="ba-headnav"'), html.indexOf('</span>', html.indexOf('class="ba-headnav"')));
    for (const tab of ['friends', 'pro', 'settings']) expect(head).toContain(`data-tab="${tab}"`);
    const top = html.slice(html.indexOf('class="ba-topbar"'), html.indexOf('</header>'));
    for (const tab of ['games', 'today', 'coach', 'progress', 'duel', 'friends', 'pro', 'settings']) expect(top).toContain(`data-tab="${tab}"`);
  });
});

describe.each(['en', 'tr'] as Lang[])('the coach pages in %s', (lang) => {
  it.each(['/form-coach/', '/today/', '/progress/'])('%s draws its first paint: its name, one line, no index', (path) => {
    const r = draw(lang, p(lang, path), { server: true });
    expect(r.status).toBe(200);
    expect(r.noindex).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.html).toContain('data-coach-boot=');
    expect(r.html).toMatch(/<h1 [^>]*data-main-heading>[^<]+<\/h1>/);
    expect(r.title).toMatch(/\| BodyArcade$/);
  });

  it('their navigation leads to the same places as the site', () => {
    expect(coachNavHref('games', lang)).toBe(router.href('home', { lang }));
    expect(coachNavHref('coach', lang)).toBe(router.href('formcoach', { lang }));
    expect(coachNavHref('today', lang)).toBe(router.href('today', { lang }));
    expect(coachNavHref('progress', lang)).toBe(router.href('progress', { lang }));
    expect(coachNavHref('duel', lang)).toBe(`${router.href('home', { lang })}#duel`);
  });
});

describe('the band markup on its own', () => {
  it('has the slider, the key and no picture when there are no stills', () => {
    const m = bandMarkup('en', { href: '/progress/' });
    expect(m).toContain('type="range"');
    expect(m).toContain('class="bab-key"');
    expect(m).not.toContain('<img');
    expect(m).toContain('data-native');
  });
});
