// The office break, family mode, their cards on the home page, and the vertical clip's card and the family board on the results screen,
// drawn in every complete language: the words exist and follow the copy rules, the set is the plan's data, the way two play is the
// device's, and nothing says "AI". No browser needed: views are functions.
import { describe, expect, it } from 'vitest';
import { textOf } from '../../core/ui/html.ts';
import type { Lang } from '../../core/ui/i18n/index.ts';
import { stringTables } from '../../core/ui/i18n/index.ts';
import type { UiCapabilities } from '../../core/ui/capabilities.ts';
import { FREE_PLAN_ID, WORKOUT_PLANS, resolvePlan } from '../../core/store/workout-plans.ts';
import { loadCatalogue } from '../catalogue/load.ts';
import { copyProblems } from '../catalogue/copy.ts';
import { makeContext, type ContextInit } from './make-context.ts';
import { EMPTY_STATE, renderPage, type PageState } from './pages.ts';
import { router } from './routes.ts';
import { afterRound, viewOf, type FamilyRun } from './app/family.ts';
import { familyHref, familyPanel } from './views/family.ts';
import { resultsPage, type RoundResult } from './views/results.ts';
import { defaultSetup } from './views/setup.ts';

const games = loadCatalogue({ fixtures: 'only', requiredLangs: ['en', 'tr'] }).catalogue.games;
const LANGS: Lang[] = ['en', 'tr'];
const bigScreen: UiCapabilities = { device: 'desktop', platform: 'web', deviceClass: 'medium', landscape: true, touch: false, camera: true, secure: true, tv: false, keyboard: true, local2: true, local2Reason: 'ok' };
const phone: UiCapabilities = { device: 'phone', platform: 'web', deviceClass: 'phone', landscape: false, touch: true, camera: true, secure: true, tv: false, keyboard: false, local2: false, local2Reason: 'small_screen' };

function draw(lang: Lang, url: string, init: Partial<ContextInit> = {}, state: PageState = EMPTY_STATE): { html: string; text: string; missing: string[]; noindex: boolean } {
  const missing: string[] = [];
  const ctx = makeContext({ lang, games, url, i18n: { onMissing: (k, l) => missing.push(`${l}:${k}`) }, ...init });
  const r = renderPage(ctx, router.match(url), state);
  return { html: r.body.value, text: textOf(r.body.value), missing, noindex: r.noindex };
}

const p = (lang: Lang, path: string): string => (lang === 'en' ? path : `/${lang}${path}`);

describe('the new strings', () => {
  const NEW = /^(story|office|family|modes)\.|^plans\.stepShort/;
  it.each(LANGS)('%s: follow the copy rules and never say AI', (lang) => {
    const keys = Object.keys(stringTables.en).filter((k) => NEW.test(k));
    expect(keys.length).toBeGreaterThan(60);
    for (const k of keys) {
      const v = stringTables[lang][k] as string;
      expect(v, `${lang} ${k}`).toBeTruthy();
      expect(copyProblems(v), `${lang} ${k}`).toEqual([]);
      expect(v, `${lang} ${k}`).not.toMatch(/\bAI\b|yapay zek/i);
    }
  });

  it('the draft languages have them too', () => {
    for (const lang of ['de', 'es', 'fr'] as const) for (const k of Object.keys(stringTables.en).filter((x) => NEW.test(x))) expect(stringTables[lang][k], `${lang} ${k}`).toBeTruthy();
  });
});

describe.each(LANGS)('the office break in %s', (lang) => {
  it('is the free desk break: its four seated games, each 45 seconds, the desk set-up, and a start button', () => {
    const { html, text, missing, noindex } = draw(lang, p(lang, '/office/'), { caps: bigScreen, server: false });
    expect(missing).toEqual([]);
    expect(noindex).toBe(false);
    const plan = WORKOUT_PLANS.find((x) => x.id === FREE_PLAN_ID);
    const r = plan ? resolvePlan(plan, games, { seated: true }) : null;
    expect(r?.steps.length).toBe(4);
    expect((html.match(/data-office-step=/g) ?? []).length).toBe(4);
    for (const s of r?.steps ?? []) expect(html).toContain(`data-office-step="${s.game}"`);
    expect((html.match(/data-office-tip=/g) ?? []).length).toBe(4);
    expect(html).toContain(`data-action="plan-start" data-plan="${FREE_PLAN_ID}"`);
    expect(text).toContain(lang === 'en' ? 'about 4 minutes' : 'yaklaşık 4 dakika');
    expect(text).toContain(lang === 'en' ? '45 seconds' : '45 saniye');
    expect(text).toContain(lang === 'en' ? 'The camera picture stays on this device.' : 'Kamera görüntüsü bu cihazda kalır.');
    expect(text).not.toMatch(/undefined|NaN|\{[a-z]+\}/);
  });

  it('drawn without a visitor, it opens the first game instead of starting a run', () => {
    const { html } = draw(lang, p(lang, '/office/'), { server: true });
    expect(html).not.toContain('data-action="plan-start"');
    expect(html).toContain(p(lang, '/games/'));
  });
});

describe.each(LANGS)('family mode in %s', (lang) => {
  it('on a big screen: together first, turns as the other way, the two sets, the free one startable and the Pro one behind Pro', () => {
    const { html, missing } = draw(lang, p(lang, '/family/'), { caps: bigScreen, server: false });
    expect(missing).toEqual([]);
    expect(html).toMatch(/name="family-mode" value="together"[^>]*checked/);
    expect(html).not.toMatch(/value="together"[^>]*disabled/);
    expect(html).toContain('data-family-hint="together"');
    expect(html).toContain('data-action="family-start" data-family-set="classic"');
    expect(html).not.toContain('data-family-set="party"');   // locked: it leads to Pro instead
    expect(html).toContain(p(lang, '/pro/'));
  });

  it('on a phone: turns, with the reason that playing side by side needs a bigger screen', () => {
    const { html, text } = draw(lang, p(lang, '/family/'), { caps: phone, server: false });
    expect(html).toMatch(/value="together"[^>]*disabled/);
    expect(html).toMatch(/name="family-mode" value="turns"[^>]*checked/);
    expect(html).toContain('data-family-hint="narrow"');
    expect(text).toContain(lang === 'en' ? 'needs a bigger screen' : 'daha büyük bir ekran gerekir');
  });

  it('a Pro player starts the party set too', () => {
    const { html } = draw(lang, p(lang, '/family/'), { caps: bigScreen, server: false, plan: 'pro' });
    expect(html).toContain('data-action="family-start" data-family-set="party"');
  });
});

describe('the rounds of the family evening', () => {
  const ctx = makeContext({ lang: 'en', games, url: '/', caps: bigScreen });
  const base: FamilyRun = { set: 'classic', mode: 'turns', day: '2026-11-11', games: ['star-catch', 'pose-wall', 'squat-flap'], index: 0, turn: 1, scores: [] };

  it('are played with the camera, easy, one player in turns and two together, and the address says it is the evening\'s', () => {
    const turns = familyHref(ctx, 'star-catch', 'turns') ?? '';
    expect(turns).toContain('/play/star-catch/');
    expect(turns).toContain('players=1');
    expect(turns).toContain('input=camera');
    expect(turns).toContain('difficulty=easy');
    expect(turns).toContain('family=1');
    expect(familyHref(ctx, 'star-catch', 'together')).toContain('players=2');
    expect(familyHref(ctx, 'made-up', 'turns')).toBeNull();
  });

  it('the results say whose turn is next, then the next game, and at the end who won the evening', () => {
    let run = afterRound(base, { p1: 70 });
    let html = familyPanel(ctx, viewOf(run)).value;
    expect(html).toContain('data-family-panel="next"');
    expect(textOf(html)).toContain('Now hand over to Player 2 for Star Catch.');
    expect(html).toContain('data-family-total="1"');
    run = afterRound(run, { p1: 90 });
    html = familyPanel(ctx, viewOf(run)).value;
    expect(textOf(html)).toContain('Player 1 plays Pose Wall next.');
    for (const x of [10, 20, 30, 40]) run = afterRound(run, { p1: x });
    html = familyPanel(ctx, viewOf(run)).value;
    expect(html).toContain('data-family-panel="over"');
    expect(textOf(html)).toContain('Player 2 wins the evening, 150 points to 110.');
    expect(html).toContain('data-action="family-again" data-family-set="classic" data-family-mode="turns"');
  });

  it('together: the next game is for both', () => {
    const v = viewOf(afterRound({ ...base, mode: 'together' }, { p1: 5, p2: 6 }));
    expect(textOf(familyPanel(ctx, v).value)).toContain('Next game: Pose Wall. Both of you in front of the camera.');
  });
});

describe('the results screen', () => {
  const ctx = makeContext({ lang: 'en', games, url: '/results/', caps: bigScreen });
  const g = games.find((x) => x.id === 'squat-flap');
  const result = (o: Partial<RoundResult> = {}): RoundResult => ({
    gameId: 'squat-flap', setup: defaultSetup(ctx, g as NonNullable<typeof g>), score: 42, seconds: 95, calories: null, personalBest: false, reasons: [], ...o,
  });

  it('offers the vertical clip only when the round may have one', () => {
    expect(resultsPage(ctx, result({ story: true })).value).toContain('data-action="story-make"');
    expect(resultsPage(ctx, result()).value).not.toContain('data-story');
    const html = resultsPage(ctx, result({ story: true })).value;
    expect(textOf(html)).toContain('There is no camera picture in it');
  });

  it('puts the family board first when the round was the evening\'s', () => {
    const v = viewOf(afterRound({ set: 'classic', mode: 'together', day: '2026-11-11', games: ['star-catch', 'pose-wall'], index: 0, turn: 1, scores: [] }, { p1: 3, p2: 4 }));
    const html = resultsPage(ctx, result({ family: v })).value;
    expect(html).toContain('data-family-panel="next"');
  });
});

describe('the home page', () => {
  it.each(LANGS)('%s: has the two mode cards, with the minutes of the office break and the way this device plays two', (lang) => {
    const big = draw(lang, p(lang, '/'), { caps: bigScreen, server: false });
    expect(big.html).toContain('data-mode-card="office"');
    expect(big.html).toContain('data-mode-card="family"');
    expect(big.html).toContain(`href="${p(lang, '/office/')}"`);
    expect(big.html).toContain(`href="${p(lang, '/family/')}"`);
    expect(big.text).toContain(lang === 'en' ? 'Two players side by side on one camera' : 'Tek kamerada yan yana iki oyuncu');
    const small = draw(lang, p(lang, '/'), { caps: phone, server: false });
    expect(small.text).toContain(lang === 'en' ? 'Two players take turns on one device' : 'İki oyuncu tek cihazda sırayla oynar');
  });
});

// The two pages are meant to be found: indexed, with a title and a description in each language made of what people type there
// (Google's suggestions of 12 Nov 2026: "desk exercises at work", "masa başı egzersiz", "übungen im büro", "pausas activas en la oficina",
// "exercices assis au bureau"; "family exercise games", "iki kişilik spor oyunu", "bewegungsspiele für die ganze familie",
// "juegos activos en familia", "sport en famille à la maison").
describe('the search titles of the office break and family mode', () => {
  const ALL: Lang[] = ['en', 'tr', 'de', 'es', 'fr'];
  const PHRASE: Record<'office' | 'family', Record<Lang, RegExp>> = {
    office: { en: /desk exercises at work/i, tr: /ofiste oturarak egzersiz/i, de: /Übungen im Büro/, es: /Pausas activas en la oficina/, fr: /Exercices assis au bureau/ },
    family: { en: /family exercise games/i, tr: /İki kişilik spor oyunları/, de: /Bewegungsspiele für die ganze Familie/, es: /Juegos activos en familia/, fr: /Sport en famille à la maison/ },
  };
  const page = (lang: Lang, path: string) => renderPage(makeContext({ lang, games, url: p(lang, path), caps: bigScreen, server: true }), router.match(p(lang, path)), EMPTY_STATE);

  it.each(ALL)('%s: both pages are indexable, with the phrase in the title and a title and description of a search result size', (lang) => {
    for (const [kind, path] of [['office', '/office/'], ['family', '/family/']] as const) {
      const r = page(lang, path);
      expect(r.status).toBe(200);
      expect(r.noindex, kind).toBe(false);
      expect(r.title, kind).toMatch(PHRASE[kind][lang]);
      expect(r.title.length, `${lang} ${kind} title`).toBeLessThanOrEqual(62);
      expect(r.description.length, `${lang} ${kind} description`).toBeGreaterThanOrEqual(100);
      expect(r.description.length, `${lang} ${kind} description`).toBeLessThanOrEqual(160);
      for (const text of [r.title, r.description]) {
        expect(copyProblems(text), `${lang} ${kind}`).toEqual([]);
        expect(text, `${lang} ${kind}`).not.toMatch(/\b(AI|KI|IA)\b|yapay zek|undefined|NaN|\{[a-z]+\}/);
        // features, never results or medical claims
        expect(text, `${lang} ${kind}`).not.toMatch(/weight|kilo|abnehm|adelgaz|maigr|pain|schmerz|dolor|douleur|ağrı|zayıfla/i);
      }
    }
  });

  it('the two pages have different titles and descriptions in every language', () => {
    for (const lang of ALL) {
      expect(page(lang, '/office/').title).not.toBe(page(lang, '/family/').title);
      expect(page(lang, '/office/').description).not.toBe(page(lang, '/family/').description);
    }
  });
});
