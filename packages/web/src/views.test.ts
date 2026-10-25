// Every page, drawn in every complete language: no missing strings, one heading, valid links, labelled controls,
// the facts of each game present, and nothing a visitor should not see. No browser needed: views are functions.
import { describe, expect, it } from 'vitest';
import { textOf } from '../../core/ui/html.ts';
import type { Lang } from '../../core/ui/i18n/index.ts';
import { SERVER_CAPABILITIES, type UiCapabilities } from '../../core/ui/capabilities.ts';
import { loadCatalogue } from '../catalogue/load.ts';
import type { ShellGame } from '../catalogue/types.ts';
import { copyProblems } from '../catalogue/copy.ts';
import { makeContext, type ContextInit } from './make-context.ts';
import { EMPTY_STATE, renderPage, snippet, type Rendered } from './pages.ts';
import { REGION_ORDER, router, type RouteId } from './routes.ts';
import type { RoundResult } from './views/results.ts';
import { overlayHtml } from './views/play.ts';
import { defaultSetup, sanitizeSetup, setupFromQuery } from './views/setup.ts';

const games = loadCatalogue({ fixtures: 'only', requiredLangs: ['en', 'tr'] }).catalogue.games;
const LANGS: Lang[] = ['en', 'tr'];

function draw(lang: Lang, url: string, init: Partial<ContextInit> = {}, state = EMPTY_STATE): { r: Rendered; html: string; missing: string[] } {
  const missing: string[] = [];
  const ctx = makeContext({ lang, games, url, i18n: { onMissing: (k, l) => missing.push(`${l}:${k}`) }, ...init });
  const r = renderPage(ctx, router.match(url), state);
  return { r, html: r.body.value, missing };
}

const ids = (html: string): string[] => [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1] as string);
const hrefs = (html: string): string[] => [...html.matchAll(/\shref="([^"]*)"/g)].map((m) => m[1] as string);

const bigScreen: UiCapabilities = { device: 'desktop', platform: 'web', deviceClass: 'medium', landscape: true, touch: false, camera: true, secure: true, tv: false, keyboard: true, local2: true, local2Reason: 'ok' };

function pageUrls(lang: Lang): string[] {
  const p = lang === 'en' ? '' : `/${lang}`;
  return [
    `${p}/`,
    ...REGION_ORDER.map((r) => `${p}/workouts/${r}/`),
    ...games.map((g) => `${p}/games/${g.seo.slug}/`),
    `${p}/plans/`,
    `${p}/settings/`,
    `${p}/pro/`,
    `${p}/results/`,
    `${p}/welcome/`,
    `${p}/nope/`,
  ];
}

describe.each(LANGS)('every page in %s', (lang) => {
  const urls = pageUrls(lang);

  it('uses only strings that exist, and has no leftovers of code in the text', () => {
    for (const url of urls) {
      const { html, missing } = draw(lang, url);
      expect(missing, url).toEqual([]);
      const text = textOf(html);
      expect(text, url).not.toMatch(/undefined|\[object|NaN|\{[a-z]+\}/);
    }
  });

  it('has exactly one main heading and one main landmark, with unique ids and labelled references', () => {
    for (const url of urls) {
      const { r, html } = draw(lang, url);
      if (r.status === 404 && url.endsWith('/nope/')) { /* still a page */ }
      expect((html.match(/<h1[\s>]/g) ?? []).length, `${url} h1`).toBe(1);
      expect((html.match(/<main[\s>]/g) ?? []).length, `${url} main`).toBe(1);
      const all = ids(html);
      expect(new Set(all).size, `${url} duplicate ids`).toBe(all.length);
      for (const m of html.matchAll(/aria-(?:labelledby|describedby)="([^"]+)"/g)) {
        for (const ref of (m[1] as string).split(' ')) expect(all, `${url} references #${ref}`).toContain(ref);
      }
    }
  });

  it('gives every image a text alternative, every button a name and every link a target', () => {
    for (const url of urls) {
      const { html } = draw(lang, url);
      for (const img of html.matchAll(/<img\b[^>]*>/g)) expect(img[0], `${url} img`).toMatch(/\salt="/);
      for (const b of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
        const label = /aria-label="[^"]+"/.test(b[1] as string) || textOf(b[2] as string).length > 0;
        expect(label, `${url} button ${b[0].slice(0, 80)}`).toBe(true);
      }
      for (const a of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)) {
        expect(/\shref="[^"]+"/.test(a[1] as string), `${url} link without href`).toBe(true);
        const named = /aria-label="[^"]+"/.test(a[1] as string) || textOf(a[2] as string).length > 0 || /<img[^>]*\salt="[^"]+"/.test(a[2] as string);
        expect(named, `${url} link ${a[0].slice(0, 80)}`).toBe(true);
      }
    }
  });

  it("the footer's links to the site's own pages (privacy, terms, FAQ) go to the pages of the page's language: Turkish under /tr/, English at the root", () => {
    const root = lang === 'tr' ? '/tr' : '';
    let withFooter = 0;
    for (const url of urls) {
      const page = draw(lang, url).html;
      if (!page.includes('class="ba-footer"')) continue; // the paywall, the tour and the round are full-screen pages with no footer
      withFooter += 1;
      const links = hrefs(page);
      for (const name of ['privacy', 'terms', 'faq']) {
        expect(links, `${url} ${name}`).toContain(`${root}/${name}`);
        // and never the other language's page
        expect(links, `${url} ${name}`).not.toContain(lang === 'tr' ? `/${name}` : `/tr/${name}`);
      }
    }
    expect(withFooter).toBeGreaterThan(10);
  });

  it('links only to pages that exist, in the same language', () => {
    const files = new Set(['/privacy', '/terms', '/faq', '/tr/privacy', '/tr/terms', '/tr/faq']);
    for (const url of urls) {
      const { html } = draw(lang, url);
      for (const h of hrefs(html)) {
        if (h.startsWith('#') || h.startsWith('mailto:') || h.startsWith('/assets/') || files.has(h)) continue;
        const m = router.match(h);
        expect(m, `${url} links to ${h}`).not.toBeNull();
        // The footer's language links are the one place a page links to another language.
        if (!/hreflang/.test(html.slice(html.indexOf(`href="${h}"`) - 40, html.indexOf(`href="${h}"`) + 200))) expect(m?.lang, `${url} -> ${h}`).toBe(lang);
      }
    }
  });

  it('follows the copy rules in every visible sentence', () => {
    for (const url of urls) {
      const text = textOf(draw(lang, url).html);
      const found = copyProblems(text.replace(/\s{2,}/g, ' '));
      expect(found, url).toEqual([]);
    }
  });

  it('a link or button whose name is set by hand keeps the words it shows in that name (WCAG 2.5.3, label in name)', () => {
    for (const url of urls) {
      const { html } = draw(lang, url);
      for (const m of html.matchAll(/<(a|button)\b([^>]*?)\saria-label="([^"]+)"([^>]*)>([\s\S]*?)<\/\1>/g)) {
        const visible = textOf(m[5] as string).replace(/\s+/g, ' ').trim().toLowerCase();
        if (visible === '') continue;
        expect((m[3] as string).toLowerCase(), `${url}: <${m[1]}> "${m[3]}" does not hold its visible text "${visible}"`).toContain(visible);
      }
    }
  });
});

describe('home and region pages', () => {
  it('list every game once, free and Pro, with the Pro mark only for players without Pro', () => {
    const free = draw('en', '/').html;
    for (const g of games) expect(free).toContain(`data-game="${g.id}"`);
    const pro = draw('en', '/', { plan: 'pro' }).html;
    const tileBadges = (h: string): number => [...h.matchAll(/class="ba-tile"[\s\S]*?<\/a>/g)].filter((m) => m[0].includes('ba-badge--pro')).length;
    expect(tileBadges(free)).toBe(games.filter((g) => !g.free).length);
    expect(tileBadges(pro)).toBe(0);
  });

  it('marks the active region chip and lists only that region', () => {
    const { html } = draw('en', '/workouts/legs/');
    expect(html).toMatch(/href="\/workouts\/legs\/" aria-current="page"/);
    expect(html).toContain('data-game="squat-flap"');
    expect(html).not.toContain('data-game="pad-work"');
  });

  it('applies seated and quiet mode and says how many games it hid', () => {
    const { html } = draw('en', '/', { settings: { quiet: true } });
    expect(html).not.toContain('data-game="road-run"');
    expect(textOf(html)).toContain('2 games are hidden by your modes.');
    expect(html).toMatch(/data-mode="quiet" aria-pressed="true"/);
    expect(html).toMatch(/data-mode="seated" aria-pressed="false"/);
  });

  it('shows an empty state with a way out when the modes hide everything', () => {
    const { html } = draw('en', '/workouts/cardio/', { games: games.filter((g) => g.id === 'knee-sprint'), settings: { quiet: true } });
    expect(textOf(html)).toContain('No games match');
    expect(html).toContain('href="/"');
  });

  it('puts the games of the regions chosen in the tour first', () => {
    const { html } = draw('en', '/', { settings: { regions: ['core'] } });
    const order = [...html.matchAll(/class="ba-tile" href="\/games\/([a-z-]+)\//g)].map((m) => m[1]);
    expect(order.slice(0, 3).sort()).toEqual(['limbo-bend', 'pad-work', 'twist-turbine']);
  });

  it('speaks Turkish with proper characters on the Turkish home page', () => {
    const t = textOf(draw('tr', '/tr/').html);
    expect(t).toContain('Tüm oyunlar');
    expect(draw('tr', '/tr/').html).toContain('href="/tr/games/squat-flap/"');
  });
});

describe('game pages', () => {
  it('carry the facts of the manifest and nothing else', () => {
    for (const g of games) {
      const { html, r } = draw('en', `/games/${g.seo.slug}/`, { caps: bigScreen });
      const text = textOf(html.match(/<ul class="k-facts"[\s\S]*?<\/ul>/)?.[0] ?? '');
      expect(r.title).toBe(`${typeof g.title === 'string' ? g.title : g.title['en']}: camera workout game`);
      expect(html.match(/<ol class="k-how">[\s\S]*?<\/ol>/)?.[0].match(/<li>/g)?.length, g.id).toBe(g.catalogue.how.length);
      expect(text.includes('2 players'), `${g.id} two players`).toBe(g.modes.includes('local2'));
      expect(text.includes('Seated version'), `${g.id} seated`).toBe(g.seated);
      expect(text.includes('Quiet mode'), `${g.id} quiet`).toBe(g.silentSafe);
      expect(text.includes('Low impact'), `${g.id} low impact`).toBe(g.lowImpact);
      expect(r.description.length, g.id).toBeLessThanOrEqual(160);
      expect(r.noindex).toBe(false);
    }
  });

  it('says "2 players" only where two players on one camera are offered: not on a phone, not in the Android app, not in the page made for a crawler', () => {
    const androidApp: UiCapabilities = { device: 'android_app', platform: 'android-app', deviceClass: 'large', landscape: true, touch: true, camera: true, secure: true, tv: false, keyboard: false, local2: false, local2Reason: 'android_app' };
    const phone: UiCapabilities = { device: 'phone', platform: 'web', deviceClass: 'phone', landscape: false, touch: true, camera: true, secure: true, tv: false, keyboard: false, local2: false, local2Reason: 'phone' };
    const narrow: UiCapabilities = { ...bigScreen, local2: false, local2Reason: 'narrow' };
    const facts = (html: string): string => textOf(html.match(/<ul class="k-facts"[\s\S]*?<\/ul>/)?.[0] ?? '');
    const duo = games.filter((g) => g.modes.includes('local2'));
    expect(duo.length, 'the catalogue has games for two players').toBeGreaterThan(0);
    for (const g of duo) {
      const url = `/games/${g.seo.slug}/`;
      expect(facts(draw('en', url, { caps: bigScreen }).html), `${g.id} on a big screen`).toContain('2 players');
      expect(facts(draw('tr', `/tr${url}`, { caps: bigScreen }).html), `${g.id} on a big screen, Turkish`).toContain('2 oyuncu');
      for (const [name, caps] of [['the Android app', androidApp], ['a phone', phone], ['a window too narrow for the split HUD', narrow], ['the page of a crawler', SERVER_CAPABILITIES]] as const) {
        const html = draw('en', url, { caps }).html;
        expect(facts(html), `${g.id} on ${name}`).not.toContain('2 players');
        expect(html, `${g.id} on ${name}: the setup does not offer it either`).not.toContain('name="players" value="2"');
        expect(facts(html), `${g.id} on ${name}: the other facts stay`).toContain('round');
      }
    }
  });

  it('offers Play for free games and for the first round of a Pro game, then the way to Pro', () => {
    const free = draw('en', '/games/squat-flap/').html;
    // The form goes to the play address, so a round starts the same way with or without scripts.
    expect(free).toContain('<form data-form="setup" data-game="squat-flap" method="get" action="/play/squat-flap/"');
    expect(free).toContain('type="submit"');
    const pro1 = draw('en', '/games/pad-work/');
    expect(textOf(pro1.html)).toContain('You can play it once for free.');
    expect(textOf(pro1.html)).toContain('Play once free');
    const pro2 = draw('en', '/games/pad-work/', { settings: { playedOnce: ['pad-work'] } }).html;
    expect(pro2).not.toContain('data-form="setup"');
    expect(pro2).toContain('href="/pro/?game=pad-work"');
    expect(textOf(pro2)).toContain('Pad Work is part of Pro.');
    const owner = draw('en', '/games/pad-work/', { plan: 'pro', settings: { playedOnce: ['pad-work'] } }).html;
    expect(owner).toContain('data-form="setup"');
  });

  it('has a breadcrumb in the structured data and an image for link previews', () => {
    const { r } = draw('en', '/games/squat-flap/');
    expect(JSON.stringify(r.jsonLd)).toContain('BreadcrumbList');
    expect(r.image).toBe('/assets/tiles/squat-flap.webp');
  });

  it('answers 404 for a game that does not exist and for a region without games', () => {
    expect(draw('en', '/games/nothing/').r.status).toBe(404);
    expect(draw('en', '/workouts/seated/', { games: games.filter((g) => !g.seated) }).r.status).toBe(404);
    expect(draw('en', '/workouts/kneecaps/').r.status).toBe(404);
  });

  it('escapes a hostile title', () => {
    const evil: ShellGame = { ...(games[0] as ShellGame), title: '<img src=x onerror=alert(1)>' };
    const { html } = draw('en', '/games/squat-flap/', { games: [evil, ...games.slice(1)] });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});

describe('meta descriptions', () => {
  it('end on a whole sentence when they can', () => {
    const s = snippet('One short sentence. Another sentence that is a little longer than the first. And a third sentence that goes past the limit of the description by quite a bit more than it should.', 100);
    expect(s).toBe('One short sentence. Another sentence that is a little longer than the first.');
  });
  it('cut at a word with a full stop when one sentence is too long', () => {
    const s = snippet(`${'word '.repeat(50)}`, 60);
    expect(s.length).toBeLessThanOrEqual(60);
    expect(s.endsWith('.')).toBe(true);
  });
});

describe('page state', () => {
  const route = (id: RouteId): boolean => ['home', 'region', 'game'].includes(id);

  it('indexes only the pages made for search: home, region and game', () => {
    for (const url of ['/', '/workouts/legs/', '/games/squat-flap/']) expect(draw('en', url).r.noindex, url).toBe(false);
    for (const url of ['/settings/', '/pro/', '/results/', '/play/squat-flap/', '/welcome/']) expect(draw('en', url).r.noindex, url).toBe(true);
    expect(route('home')).toBe(true);
  });

  it('shows the friends page only when the social flag is on', () => {
    expect(draw('en', '/friends/').r.status).toBe(404);
    const on = draw('en', '/friends/', { flags: { social: true } });
    expect(on.r.status).toBe(200);
    expect(textOf(on.html)).toContain('Loading your friends');
  });

  it('shows two players in the grid only where the device allows it', () => {
    expect(draw('en', '/').html).not.toContain('aria-label="2 players"');
    expect(draw('en', '/', { caps: bigScreen }).html).toContain('aria-label="2 players"');
  });
});

describe('results', () => {
  const sample: RoundResult = {
    gameId: 'squat-flap', setup: defaultSetup(makeContext({ lang: 'en', games, url: '/' }), games[0] as ShellGame), score: 42, seconds: 95,
    reps: 31, quality: 0.82, calories: null, personalBest: true, reasons: [{ text: 'Hips 4 cm above the line', count: 3 }], replay: { reason: 'Hips 4 cm above the line' },
  };

  it('asks to pick a game when there is no round', () => {
    expect(textOf(draw('en', '/results/').html)).toContain('There is no round to show.');
  });

  it('shows the score, the best badge, the clock, the share of clean moves and the reasons', () => {
    const t = textOf(draw('en', '/results/', {}, { ...EMPTY_STATE, result: sample }).html);
    expect(t).toContain('42');
    expect(t).toContain('New personal best');
    expect(t).toContain('1:35');
    expect(t).toContain('82%');
    expect(t).toContain('Hips 4 cm above the line');
    expect(t).toContain('Add your weight in Settings to see calories.');
  });

  it('shows calories only as an estimate, with the note', () => {
    const t = textOf(draw('en', '/results/', {}, { ...EMPTY_STATE, result: { ...sample, calories: 12.4 } }).html);
    expect(t).toContain('About 12 kcal');
    expect(t).toContain('An estimate from your weight');
  });

  it('says a round with the keyboard or touch is practice, and shows no calories and no progress for it', () => {
    const practice: RoundResult = { ...sample, practice: true, calories: null, personalBest: false, progress: { activeDay: true, weekGoalReached: false, weekDays: 1, weekStreak: 0, challengeDone: false, challengeBonus: false, achievements: [] } };
    for (const lang of ['en', 'tr'] as const) {
      const page = draw(lang, lang === 'en' ? '/results/' : '/tr/results/', {}, { ...EMPTY_STATE, result: practice }).html;
      expect(page, lang).toContain('data-practice');
      expect(textOf(page), lang).toContain(lang === 'en' ? 'it is practice' : 'yani antrenman');
      expect(page, lang).not.toContain('k-kcal');
      expect(page, lang).not.toContain('data-progress');
      expect(page, lang).not.toContain('data-first-saved');
    }
    // the same round with the camera has no such note
    expect(draw('en', '/results/', {}, { ...EMPTY_STATE, result: sample }).html).not.toContain('data-practice');
  });

  it('offers the clip of the round: a video, a way to share it and to save it, what it is made of, and nothing without one', () => {
    const clip = { url: 'blob:https://example.test/abc', name: 'bodyarcade-squat-flap-42.mp4', mime: 'video/mp4', seconds: 8.4 };
    for (const lang of ['en', 'tr'] as const) {
      const page = draw(lang, lang === 'en' ? '/results/' : '/tr/results/', {}, { ...EMPTY_STATE, result: { ...sample, clip } }).html;
      expect(page, lang).toContain('data-clip');
      expect(page, lang).toMatch(/<video[^>]*src="blob:https:\/\/example.test\/abc"[^>]*controls/);
      expect(page, lang).toContain('data-action="clip-share"');
      expect(page, lang).toContain('download="bodyarcade-squat-flap-42.mp4"');
      expect(textOf(page), lang).toContain(lang === 'en' ? 'without your camera picture' : 'kamera görüntün olmadan');
      expect(textOf(page), lang).not.toMatch(/undefined|\[object|results\.clip/);
    }
    expect(draw('en', '/results/', {}, { ...EMPTY_STATE, result: sample }).html).not.toContain('data-clip');
  });

  it('has the slot of the one second replay only when the round gave one: the picture, the reason in words, the button, the track and the length', () => {
    const withReplay: RoundResult = { ...sample, replay: { reason: 'Hips not low enough', ms: 933 } };
    for (const lang of ['en', 'tr'] as const) {
      const page = draw(lang, lang === 'en' ? '/results/' : '/tr/results/', {}, { ...EMPTY_STATE, result: withReplay }).html;
      expect(page, lang).toContain('data-replay');
      expect(page, lang).toMatch(/<div class="view" data-replay role="img" aria-label="[^"]*Hips not low enough[^"]*">/);
      expect(page, lang).toContain('<p class="k-replay-reason" data-replay-reason>Hips not low enough</p>');
      expect(page, lang).toContain('data-action="replay"');
      expect(page, lang).toContain('data-replay-track');
      expect(textOf(page), lang).toContain(lang === 'en' ? 'One second replay' : 'Bir saniyelik tekrar');
      expect(textOf(page), lang).toContain(lang === 'en' ? '0.9 s' : '0,9 sn');
      expect(textOf(page), lang).toContain(lang === 'en' ? 'never the video' : 'görüntü asla saklanmaz');
    }
    // no replay, no slot (a round with the keyboard, a round without a miss with a reason)
    const without = draw('en', '/results/', {}, { ...EMPTY_STATE, result: { ...sample, replay: null } }).html;
    expect(without).not.toContain('data-replay');
    expect(without).not.toContain('One second replay');
    expect(draw('en', '/results/', {}, { ...EMPTY_STATE, result: { ...sample, replay: undefined } }).html).not.toContain('data-replay');
  });

  it('names the winner of a two player round and shows both scores', () => {
    const duo: RoundResult = { ...sample, setup: { ...sample.setup, players: 2 }, players: [{ slot: 1, score: 10 }, { slot: 2, score: 14 }] };
    const t = textOf(draw('en', '/results/', {}, { ...EMPTY_STATE, result: duo }).html);
    expect(t).toContain('Player 2 wins');
    const tie = textOf(draw('en', '/results/', {}, { ...EMPTY_STATE, result: { ...duo, players: [{ slot: 1, score: 7 }, { slot: 2, score: 7 }] } }).html);
    expect(tie).toContain('Draw');
  });
});

describe('playing without the camera', () => {
  const phone: UiCapabilities = { device: 'phone', platform: 'web', deviceClass: 'phone', landscape: false, touch: true, camera: true, secure: true, tv: false, keyboard: false, local2: false, local2Reason: 'phone' };
  const squat = games.find((x) => x.id === 'squat-flap') as ShellGame;
  const mirror = games.find((x) => x.template === 'target') as ShellGame;
  const ctxOf = (caps: UiCapabilities, extra: Partial<ContextInit> = {}): ReturnType<typeof makeContext> => makeContext({ lang: 'en', games, url: '/', caps, ...extra });

  it('a phone is offered swipes and taps for a game that has them: the controls are on the game page, with what such a round is', () => {
    const { html } = draw('en', '/games/squat-flap/', { caps: phone });
    expect(html).toContain('value="keyboard"');
    expect(html).not.toContain('<input type="hidden" name="input" value="camera">');
    expect(textOf(html)).toContain('Keyboard or touch');
    expect(textOf(html)).toContain('Those rounds are practice');
    expect(html).toMatch(/name="input" value="camera"[^>]*checked/);
  });

  it('a mirror game on a phone has no way around the camera, and the page says so', () => {
    const { html } = draw('en', `/games/${mirror.seo.slug}/`, { caps: phone });
    expect(html).not.toContain('value="keyboard"');
    expect(html).toContain('<input type="hidden" name="input" value="camera">');
    expect(textOf(html)).toContain('plays with the camera');
    // on a laptop the keys move the cursor over the picture
    expect(draw('en', `/games/${mirror.seo.slug}/`, { caps: bigScreen }).html).toContain('value="keyboard"');
  });

  it('what a round starts with: the camera, unless there is none to use or the setting says otherwise, and only where there is a way', () => {
    expect(defaultSetup(ctxOf(phone), squat).input).toBe('camera');
    expect(defaultSetup(ctxOf(phone, { settings: { controls: 'keyboard' } }), squat).input).toBe('keyboard');
    expect(defaultSetup(ctxOf({ ...phone, camera: false }), squat).input).toBe('keyboard');
    expect(defaultSetup(ctxOf(bigScreen, { settings: { controls: 'keyboard' } }), squat).input).toBe('keyboard');
    // a mirror game on a phone has none: the setting and a missing camera change nothing
    expect(defaultSetup(ctxOf(phone, { settings: { controls: 'keyboard' } }), mirror).input).toBe('camera');
    expect(defaultSetup(ctxOf({ ...phone, camera: false }), mirror).input).toBe('camera');
    // two players need the camera
    expect(sanitizeSetup(ctxOf(bigScreen), squat, { ...defaultSetup(ctxOf(bigScreen), squat), players: 2, input: 'keyboard' }).input).toBe('camera');
  });

  it('an address that asks for swipes and taps gets them on a phone for a game that has them, and the camera for one that has not', () => {
    expect(setupFromQuery(ctxOf(phone), squat, new URLSearchParams('input=keyboard')).input).toBe('keyboard');
    expect(setupFromQuery(ctxOf(phone), mirror, new URLSearchParams('input=keyboard')).input).toBe('camera');
    expect(setupFromQuery(ctxOf(bigScreen), squat, new URLSearchParams('input=keyboard')).input).toBe('keyboard');
  });

  it('the camera explainer offers the way around it, on a phone too, and never to two players or for a game with no way', () => {
    const explainer = (c: ReturnType<typeof makeContext>, g: ShellGame, two = false): string => overlayHtml(c, g, { kind: 'camera-explainer', two }).value;
    const onPhone = explainer(ctxOf(phone), squat);
    expect(onPhone).toContain('data-action="use-keyboard"');
    expect(textOf(onPhone)).toContain('Play without the camera');
    expect(textOf(onPhone)).toContain('is practice');
    expect(onPhone).toContain('data-action="camera-continue"');
    expect(explainer(ctxOf(bigScreen), squat)).toContain('data-action="use-keyboard"');
    expect(explainer(ctxOf(phone), mirror)).not.toContain('data-action="use-keyboard"');
    expect(explainer(ctxOf(bigScreen), squat, true)).not.toContain('data-action="use-keyboard"');
    expect(textOf(overlayHtml(ctxOf(phone, { lang: 'tr' }), squat, { kind: 'camera-explainer' }).value)).toContain('Kamerasız oyna');
  });

  it('a camera that did not start: steps to allow it on a phone, and the way around it wherever there is one', () => {
    const panel = (c: ReturnType<typeof makeContext>, g: ShellGame, two = false): string => overlayHtml(c, g, { kind: 'camera-error', code: 'denied', two }).value;
    const onPhone = panel(ctxOf(phone), squat);
    expect(textOf(onPhone)).toContain('To allow the camera');
    expect(textOf(onPhone)).not.toContain('This game needs the camera');
    expect(onPhone).toContain('data-action="camera-retry"');
    expect(onPhone).toContain('data-action="use-keyboard"');
    // a mirror game on a phone says it needs the camera and offers no other way
    const needs = panel(ctxOf(phone), mirror);
    expect(textOf(needs)).toContain('This game needs the camera');
    expect(textOf(needs)).toContain('To allow the camera');
    expect(needs).toContain('data-action="camera-retry"');
    expect(needs).not.toContain('data-action="use-keyboard"');
    // a laptop has no steps (it is a matter of the address bar) and has the way around
    const onLaptop = panel(ctxOf(bigScreen), squat);
    expect(onLaptop).toContain('data-action="use-keyboard"');
    expect(textOf(onLaptop)).not.toContain('To allow the camera');
    // two players are not offered it
    expect(panel(ctxOf(bigScreen), squat, true)).not.toContain('data-action="use-keyboard"');
    expect(textOf(overlayHtml(ctxOf(phone, { lang: 'tr' }), mirror, { kind: 'camera-error', code: 'denied' }).value)).toContain('Bu oyun için kamera gerekli');
  });

  it('the clips of the settings are one switch: on to begin with, and the page says never the camera picture', () => {
    const page = (settings: Partial<ContextInit['settings'] & object>): string => draw('en', '/settings/', { settings }).html;
    expect(page({})).toMatch(/id="set-clips"[^>]*checked/);
    expect(page({ clips: false })).not.toMatch(/id="set-clips"[^>]*checked/);
    expect(page({})).not.toContain('set-clipcamera');
    expect(textOf(page({}))).toContain('Highlight clips');
    expect(textOf(page({}))).toContain('Never your camera picture');
    expect(textOf(draw('tr', '/tr/settings/').html)).toContain('Öne çıkan an klipleri');
  });

  it('the controls of the settings are the camera and the keyboard or touch, the one chosen marked', () => {
    const page = (controls: 'camera' | 'keyboard'): string => draw('en', '/settings/', { settings: { controls } }).html;
    expect(page('camera')).toMatch(/name="controls" value="camera"[^>]*checked/);
    expect(page('keyboard')).toMatch(/name="controls" value="keyboard"[^>]*checked/);
    expect(textOf(page('camera'))).toContain('What a round starts with');
    expect(textOf(draw('tr', '/tr/settings/').html)).toContain('Bir turun neyle başlayacağı');
  });
});

describe('the calibration screen', () => {
  const phone: UiCapabilities = { device: 'phone', platform: 'web', deviceClass: 'phone', landscape: false, touch: true, camera: true, secure: true, tv: false, keyboard: false, local2: false, local2Reason: 'phone' };
  const squat = games.find((x) => x.id === 'squat-flap') as ShellGame;
  const standing: ShellGame = { ...squat, seated: false };
  const base = { kind: 'calibrating', framing: 'full', two: false, message: 'Msg', checks: [{ part: 'head', ok: true }, { part: 'hips', ok: false }], progress: 0, slow: false, gauge: 'close', desk: 'none', stuck: false, headroom: false } as const;
  const draw2 = (lang: Lang, g: ShellGame, o: Partial<Extract<Parameters<typeof overlayHtml>[2], { kind: 'calibrating' }>>, caps = bigScreen): string =>
    overlayHtml(makeContext({ lang, games, url: lang === 'en' ? '/' : `/${lang}/`, caps }), g, { ...base, ...o } as Parameters<typeof overlayHtml>[2]).value;

  it('the title says what to show: the whole body, head and hips, head and shoulders at the desk, sideways, both of you', () => {
    expect(textOf(draw2('en', squat, { framing: 'full' }))).toContain('Get your whole body in view');
    expect(textOf(draw2('en', squat, { framing: 'upper' }))).toContain('head and hips');
    expect(textOf(draw2('en', squat, { framing: 'desk' }))).toContain('head and shoulders');
    expect(textOf(draw2('en', squat, { framing: 'side' }))).toContain('sideways');
    expect(textOf(draw2('en', squat, { two: true }))).toContain('Both of you');
    expect(textOf(draw2('tr', squat, { framing: 'desk' }))).toContain('Başın ve omuzların görünsün');
  });

  it('"Skip, play seated" is always on screen for a game that can be played seated, and the keyboard way when the player is stuck', () => {
    const html = draw2('en', squat, {});
    expect(html).toContain('data-calib-skip');
    expect(textOf(html)).toContain('Skip, play seated');
    expect(draw2('tr', squat, {})).toContain('Atla, oturarak oyna');
    // every state keeps the button, with or without the desk card
    for (const desk of ['none', 'offer', 'standing-only'] as const) expect(draw2('en', squat, { desk })).toContain('data-calib-skip');
    // on a laptop the keyboard is there but waits until the player has been at it a while
    expect(draw2('en', squat, { stuck: false })).toMatch(/data-calib-keyboard hidden/);
    expect(draw2('en', squat, { stuck: true })).not.toMatch(/data-calib-keyboard hidden/);
    expect(textOf(draw2('tr', squat, { stuck: true }))).toContain('Atla, klavyeyle oyna');
    // a phone has swipes for this game, so the way around the camera is there (waiting for the same moment); a mirror game has none on a phone
    expect(draw2('en', squat, { stuck: false }, phone)).toMatch(/data-calib-keyboard hidden/);
    expect(draw2('en', squat, { stuck: true }, phone)).not.toMatch(/data-calib-keyboard hidden/);
    expect(draw2('en', squat, { stuck: true }, phone)).toContain('data-calib-keyboard');
    const target = games.find((x) => x.template === 'target') as ShellGame;
    expect(draw2('en', target, { stuck: true }, phone)).not.toContain('data-calib-keyboard');
    expect(draw2('en', target, { stuck: true }, phone)).not.toContain('data-action="use-keyboard"');
    // two players on one camera cannot use it
    expect(draw2('en', squat, { stuck: true, two: true })).not.toContain('data-calib-keyboard');
  });

  it('a game that is played standing offers a way to another game instead of seated play', () => {
    const html = draw2('en', standing, {});
    expect(html).not.toContain('data-calib-skip');
    expect(textOf(html)).toContain('Pick another game');
    expect(html).toContain('href="/"');
    expect(textOf(draw2('tr', standing, {}))).toContain('Başka oyun seç');
    // at the desk, too, the way out is one press away
    expect(textOf(draw2('en', squat, { framing: 'desk' }))).toContain('Pick another game');
    expect(draw2('en', squat, { framing: 'desk' })).not.toContain('data-calib-skip');
  });

  it('the desk card is in the page but shown only when it is offered, and says what to do', () => {
    const none = draw2('en', squat, { desk: 'none' });
    expect(none).toMatch(/data-calib-desk="offer" hidden/);
    expect(none).toMatch(/data-calib-desk="standing-only" hidden/);
    const offer = draw2('en', squat, { desk: 'offer' });
    expect(offer).not.toMatch(/data-calib-desk="offer" hidden/);
    expect(textOf(offer)).toContain('Are you at a desk?');
    expect(textOf(offer)).toContain('Play at the desk');
    expect(offer).toContain('data-action="desk-play"');
    const tr = draw2('tr', squat, { desk: 'offer' });
    expect(textOf(tr)).toContain('Masada mısın?');
    expect(textOf(tr)).toContain('Masada oyna');
    const only = draw2('en', standing, { desk: 'standing-only' });
    expect(only).not.toMatch(/data-calib-desk="standing-only" hidden/);
    expect(textOf(only)).toContain('This game is played standing');
    expect(only).toContain('data-action="desk-games"');
  });

  it('a game that lifts the hands above the head says the hands must stay in view, and the others stay quiet', () => {
    const summit = games.find((x) => x.id === 'summit-climb') as ShellGame;
    expect(textOf(draw2('en', summit, { headroom: true }))).toContain('When you raise your arms, your hands should stay in view.');
    expect(textOf(draw2('tr', summit, { headroom: true }))).toContain('Kollarını kaldırınca ellerin görünsün.');
    expect(draw2('en', summit, { headroom: true })).toContain('data-calib-headroom');
    expect(draw2('en', squat, {})).not.toContain('data-calib-headroom');
  });

  it('shows no raw code or key in any state, in English or Turkish', () => {
    for (const lang of LANGS) {
      for (const framing of ['full', 'upper', 'side', 'desk'] as const) {
        const text = textOf(draw2(lang, squat, { framing, desk: 'offer', stuck: true }));
        expect(text, `${lang} ${framing}`).not.toMatch(/calib\.|_out\b|undefined|\[object/);
      }
    }
  });
});

describe('the language picker of the settings', () => {
  const options = (html: string): string[] => [...html.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1] as string);
  const select = (html: string): string => html.slice(html.indexOf('id="set-lang"'), html.indexOf('</select>', html.indexOf('id="set-lang"')));

  it('offers the languages that are finished (English, Turkish) and the one that follows the browser, never a draft', () => {
    for (const lang of LANGS) {
      const page = select(draw(lang, lang === 'en' ? '/settings/' : `/${lang}/settings/`).html);
      expect(options(page), lang).toEqual(['auto', 'en', 'tr']);
      expect(page, lang).not.toMatch(/Deutsch|Español|Français|draft|taslak/i);
    }
  });

  it('keeps showing a draft that is already the setting (a development build), marked as a draft, so the select never holds a value it has no option for', () => {
    const page = select(draw('en', '/settings/', { settings: { lang: 'de' } }).html);
    expect(options(page)).toEqual(['auto', 'en', 'tr', 'de']);
    expect(page).toMatch(/<option value="de"[^>]*selected[^>]*>Deutsch \(/);
  });
});
