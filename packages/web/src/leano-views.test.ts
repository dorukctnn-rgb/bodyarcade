// The Leano card (views/leano.ts), drawn in every language of the site: where it is (under the home page's before/after band, at the end of
// the results screen after the Pro card) and where it is not (a page a crawler reads, a desktop, a child's profile, a first tour round, a game,
// the Pro page, the plans, the settings), what it says (Leano's own facts, no time promised, no "AI", no emoji), and its link and badge.
// Views are functions: no browser needed. The real decision about the device is app/leano-offer.test.ts; the browser's is tests/e2e/leano-cta.spec.ts.
import { describe, expect, it } from 'vitest';
import { textOf } from '../../core/ui/html.ts';
import { LANGS, stringTables, type Lang } from '../../core/ui/i18n/index.ts';
import type { UiCapabilities } from '../../core/ui/capabilities.ts';
import { loadCatalogue } from '../catalogue/load.ts';
import { copyProblems } from '../catalogue/copy.ts';
import type { ShellGame } from '../catalogue/types.ts';
import { makeContext, type ContextInit } from './make-context.ts';
import { EMPTY_STATE, renderPage } from './pages.ts';
import { REGION_ORDER, router } from './routes.ts';
import { defaultSetup } from './views/setup.ts';
import type { RoundResult } from './views/results.ts';
import { BADGE_SIZE, leanoShown } from './views/leano.ts';
import { leanoHref } from './app/leano-offer.ts';
import type { PlayerFacts } from './app/profiles-model.ts';

const games = loadCatalogue({ fixtures: 'only', requiredLangs: ['en', 'tr'] }).catalogue.games;
const phone: UiCapabilities = { device: 'phone', platform: 'web', deviceClass: 'phone', landscape: false, touch: true, camera: true, secure: true, tv: false, keyboard: false, local2: false, local2Reason: 'small_screen' };
const p = (lang: Lang, path: string): string => (lang === 'en' ? path : `/${lang}${path}`);

function draw(lang: Lang, url: string, init: Partial<ContextInit> = {}, state = EMPTY_STATE): { html: string; text: string; missing: string[] } {
  const missing: string[] = [];
  const ctx = makeContext({ lang, games, url, i18n: { onMissing: (k, l) => missing.push(`${l}:${k}`) }, ...init });
  const r = renderPage(ctx, router.match(url), state);
  return { html: r.body.value, text: textOf(r.body.value), missing };
}

const sample = (lang: Lang): RoundResult => ({
  gameId: 'squat-flap', setup: defaultSetup(makeContext({ lang, games, url: '/' }), games[0] as ShellGame), score: 42, seconds: 95,
  reps: 31, quality: 0.82, calories: null, personalBest: true, reasons: [{ text: 'Hips 4 cm above the line', count: 3 }], replay: { reason: 'Hips 4 cm above the line' },
});
const kidPlayer: PlayerFacts = {
  id: 'kid', name: 'Defne', avatar: 'fox', kid: true, owner: false, guarded: true, players: 2, capacity: { max: 6, used: 2 },
  rules: { record: true, online: false, purchase: 'parent_gate', autoPaywall: false, calories: false, ghosts: 'all', freeText: false, share: false },
};
const card = (html: string): string => { const i = html.indexOf('data-leano='); return i < 0 ? '' : html.slice(html.lastIndexOf('<section', i), html.indexOf('</section>', i) + 10); };
const count = (html: string): number => html.split('data-leano=').length - 1;

const KEYS = ['leano.eyebrow', 'leano.title', 'leano.body', 'leano.note', 'leano.badge.alt'] as const;

describe('the words of the Leano card', () => {
  it.each(LANGS)('%s: all five are there, follow the copy rules, never say AI, promise no time and make no health claim', (lang) => {
    for (const k of KEYS) {
      const v = stringTables[lang][k] as string | undefined;
      expect(v, `${lang} ${k}`).toBeTruthy();
      expect(copyProblems(v as string), `${lang} ${k}`).toEqual([]);
      expect(v, `${lang} ${k}`).not.toMatch(/(?<!\p{L})(AI|KI|IA)(?!\p{L})/u);
      expect(v, `${lang} ${k}`).not.toMatch(/yapay zek|artificial intelligence|intelligence artificielle|inteligencia artificial|künstliche intelligenz/i);
      // Leano's quick measure takes about two minutes, so no time is promised ("in 30 seconds" would be a claim the app does not keep)
      expect(v, `${lang} ${k}`).not.toMatch(/\d+\s?(sec|second|saniye|sekunde|segundo|seconde|min|dakika)/i);
      expect(v, `${lang} ${k}`).not.toMatch(/\b(cure|treat\w*|diagnos\w*|lose weight|weight loss|burn fat|guarantee\w*)\b|zayıfla|tedavi|teşhis|garanti|abnehm|adelgaz|maigrir/i);
      expect(v, `${lang} ${k}`).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it('say what Leano does in its own words: the three numbers from a tape measure and the 3D twin', () => {
    const en = stringTables.en['leano.body'];
    expect(en).toContain('body fat %');
    expect(en).toContain('BMI');
    expect(en).toContain('waist-to-height');
    expect(en).toContain('3D twin');
    expect(en).toContain('tape measure');
    expect(stringTables.en['leano.title']).toBe('Track your body, not just your score');
  });
});

describe.each(LANGS)('the card in %s', (lang) => {
  const iphone = { leano: true, caps: phone } satisfies Partial<ContextInit>;

  it('sits under the before/after band of the home page, once, and before the Pro section', () => {
    const { html, missing } = draw(lang, p(lang, '/'), iphone);
    expect(missing.filter((m) => m.includes('leano.'))).toEqual([]);
    expect(count(html)).toBe(1);
    const at = html.indexOf('data-leano="progress"');
    expect(at).toBeGreaterThan(html.indexOf('data-home-band'));
    expect(at).toBeGreaterThan(html.indexOf('data-band>'));
    expect(at).toBeLessThan(html.indexOf('data-home-today'));
    // the band is still the band: its two stills, its label, its link (the card is inside the band's own wrapper, after the band's section)
    expect(html.slice(html.indexOf('data-home-band'), at).match(/<img /g)).toHaveLength(2);
    // nothing of the Pro section, the hero or the games was taken out or moved before it
    for (const m of ['data-hero', 'data-home-pro', 'data-home-faq', 'data-home-final']) expect(html.indexOf(m), m).toBeGreaterThan(-1);
    expect(html.indexOf('data-home-pro')).toBeGreaterThan(at);
  });

  it('has the words of the page language, the official badge of the page language and the App Store link of the place', () => {
    const { html } = draw(lang, p(lang, '/'), iphone);
    const c = card(html);
    const t = stringTables[lang];
    expect(textOf(c)).toContain(t['leano.title']);
    expect(textOf(c)).toContain(t['leano.eyebrow']);
    expect(textOf(c)).toContain(t['leano.body']);
    expect(textOf(c)).toContain(t['leano.note']);
    expect(c).toContain(`href="${leanoHref('progress').replace('&', '&amp;')}"`);
    expect(c).toContain('href="https://apps.apple.com/app/id6761293700?ct=bodyarcade-progress&amp;mt=8"');
    const img = /<img [^>]*>/.exec(c)?.[0] ?? '';
    expect(img).toContain(`src="/assets/brand/appstore/${lang}.svg"`);
    expect(img).toContain(`alt="${t['leano.badge.alt']}"`);
    expect(img).toContain(`width="${BADGE_SIZE[lang].width}"`);
    expect(img).toContain('height="56"');
    // a heading that names the card, a link a keyboard reaches
    const id = /aria-labelledby="([^"]+)"/.exec(c)?.[1] ?? '';
    expect(c).toContain(`<h3 class="k-h3" id="${id}">`);
    expect(c).toMatch(/<a class="k-leano-badge" href="[^"]+" rel="noopener"/);
  });

  it('draws the progress card as one with the page: the lime bar eyebrow, the heading role, the body role and the small role of the sports look', () => {
    const c = card(draw(lang, p(lang, '/'), iphone).html);
    expect(c).toContain('class="k-eyebrow"');
    expect(c).toContain('class="k-h3"');
    expect(c).toContain('class="k-body"');
    expect(c).toContain('class="k-meta"');
    expect(c).not.toMatch(/\sstyle="/);
    expect(c).not.toMatch(/<(script|svg)/);
  });

  it('is at the end of the results screen: after the Pro card, before the buttons that go on playing', () => {
    const { html, missing } = draw(lang, p(lang, '/results/'), iphone, { ...EMPTY_STATE, result: sample(lang) });
    expect(missing.filter((m) => m.includes('leano.'))).toEqual([]);
    expect(count(html)).toBe(1);
    const at = html.indexOf('data-leano="results"');
    expect(at).toBeGreaterThan(html.indexOf('k-procard'));
    expect(at).toBeLessThan(html.indexOf('class="k-actionbar"'));
    expect(html.indexOf('k-procard')).toBeGreaterThan(html.indexOf('k-score'));
    const c = card(html);
    expect(c).toContain('href="https://apps.apple.com/app/id6761293700?ct=bodyarcade-results&amp;mt=8"');
    expect(c).toContain('<h2 class="k-h3"');
    // the play-again button is still the page's lime button and still follows the stack
    expect(html).toContain('data-action="again"');
  });

  it('is not drawn for a page made for a crawler, nor for a visitor who is not on an iPhone or an iPad', () => {
    for (const url of [p(lang, '/'), p(lang, '/results/')]) {
      const state = url.endsWith('/results/') ? { ...EMPTY_STATE, result: sample(lang) } : EMPTY_STATE;
      expect(count(draw(lang, url, { server: true, leano: true }, state).html), `server ${url}`).toBe(0);
      expect(count(draw(lang, url, { leano: false, caps: phone }, state).html), `other device ${url}`).toBe(0);
      expect(count(draw(lang, url, {}, state).html), `default ${url}`).toBe(0);
    }
  });

  it('is not drawn for a child\'s profile, nor on the first round of the welcome tour', () => {
    expect(count(draw(lang, p(lang, '/'), { ...iphone, player: kidPlayer }).html)).toBe(0);
    expect(count(draw(lang, p(lang, '/results/'), { ...iphone, player: kidPlayer }, { ...EMPTY_STATE, result: sample(lang) }).html)).toBe(0);
    expect(count(draw(lang, p(lang, '/results/'), iphone, { ...EMPTY_STATE, result: { ...sample(lang), first: true } }).html)).toBe(0);
    expect(leanoShown({ leano: true, server: false, player: kidPlayer })).toBe(false);
    expect(leanoShown({ leano: true, server: false, player: null })).toBe(true);
  });

  it('is on no other page: not a game, not its play screen, not Pro, not the plans, not the settings, not a body area, not the welcome tour', () => {
    const others = [
      ...games.flatMap((g) => [p(lang, `/games/${g.seo.slug}/`), p(lang, `/play/${g.seo.slug}/`)]),
      ...REGION_ORDER.map((r) => p(lang, `/workouts/${r}/`)),
      p(lang, '/pro/'), p(lang, '/plans/'), p(lang, '/settings/'), p(lang, '/welcome/'), p(lang, '/profiles/'), p(lang, '/nope/'), p(lang, '/results/'),
    ];
    for (const url of others) expect(count(draw(lang, url, iphone).html), url).toBe(0);
  });
});

describe('the Pro trial stays where it is', () => {
  it('the home page keeps one Pro section and its button, whether the card is there or not', () => {
    const without = draw('en', '/', { caps: phone }).html;
    const withCard = draw('en', '/', { leano: true, caps: phone }).html;
    const pro = (h: string): string => h.slice(h.indexOf('data-home-pro'), h.indexOf('data-home-faq'));
    expect(pro(withCard)).toBe(pro(without));
    // the card is the only difference, and it is whole: everything before it and after it is the page as it was
    const c = card(withCard);
    expect(withCard.replace(c, '')).toBe(without);
  });

  it('the results screen keeps its Pro card and its buttons exactly, the card comes after them in the stack', () => {
    const state = { ...EMPTY_STATE, result: sample('en') };
    const without = draw('en', '/results/', { caps: phone }, state).html;
    const withCard = draw('en', '/results/', { leano: true, caps: phone }, state).html;
    expect(withCard.replace(card(withCard), '')).toBe(without);
    expect(withCard.indexOf('k-procard')).toBeLessThan(withCard.indexOf('data-leano='));
  });
});
