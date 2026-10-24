// The welcome tour without a browser: its rules (steps, choices, what is kept, who is taken to it, when the stage steps down)
// and the five pages it draws, in both complete languages. The stage and the clicks are the end-to-end test's (e2e/welcome.spec.ts).
import { describe, expect, it } from 'vitest';
import { textOf } from '../../core/ui/html.ts';
import type { UiCapabilities } from '../../core/ui/capabilities.ts';
import type { Lang } from '../../core/ui/i18n/index.ts';
import { DEFAULT_SETTINGS } from '../../core/ui/settings.ts';
import { loadCatalogue } from '../catalogue/load.ts';
import {
  backStep, DEFAULT_REGIONS, deviceChoices, firstDifficulty, initialTour, isAutomated, judgeStage, nextStep, settingsPatch, startTier, stepFrom, TOUR_PAGES, TOUR_REGIONS,
  takeToTour, toggleRegion, withDevice, withLevel, withPlayers, type FirstVisit, type TourState, type TourStep,
} from './app/welcome-model.ts';
import { makeContext } from './make-context.ts';
import { FIRST_TOUR, seatedLine, welcomePage } from './views/welcome.ts';

const games = loadCatalogue({ fixtures: 'only', requiredLangs: ['en', 'tr'] }).catalogue.games;
const big: UiCapabilities = { device: 'desktop', platform: 'web', deviceClass: 'medium', landscape: true, touch: false, camera: true, secure: true, tv: false, keyboard: true, local2: true, local2Reason: 'ok' };
const STEPS: TourStep[] = [1, 2, 3, 4, 5];
const ctxOf = (lang: Lang, caps?: UiCapabilities, missing: string[] = []) => makeContext({ lang, games, url: lang === 'en' ? '/welcome/' : `/${lang}/welcome/`, ...(caps ? { caps } : {}), i18n: { onMissing: (k, l) => missing.push(`${l}:${k}`) } });
const tour = (over: Partial<TourState> = {}): TourState => ({ ...FIRST_TOUR, ...over });

describe('the steps', () => {
  it('are the five pages of the tour; anything else in an address is the first page', () => {
    expect(TOUR_PAGES).toBe(5);
    expect([null, undefined, '', 'x', '0', '6', '-1', '2.5x'].map((v) => stepFrom(v))).toEqual([1, 1, 1, 1, 1, 1, 1, 2]);
    expect(['1', '2', '3', '4', '5'].map((v) => stepFrom(v))).toEqual(STEPS);
  });

  it('go on until the last page, which hands the player to the real calibration and the first game; back stops at the first', () => {
    expect(STEPS.map(nextStep)).toEqual([2, 3, 4, 5, 'play']);
    expect(STEPS.map(backStep)).toEqual([1, 1, 2, 3, 4]);
  });
});

describe('the choices', () => {
  it('start from what the settings hold, with legs and cardio for a first visit, and the seated region left to the seated switch', () => {
    expect(initialTour({ ...DEFAULT_SETTINGS }, { bigScreen: false }).regions).toEqual(DEFAULT_REGIONS);
    const kept = initialTour({ ...DEFAULT_SETTINGS, regions: ['arms', 'seated'], level: 'strong', seated: true, quiet: true, device: 'laptop' }, { bigScreen: true, step: 3 });
    expect(kept).toMatchObject({ regions: ['arms'], level: 'strong', seated: true, quiet: true, device: 'laptop', step: 3, players: 1 });
  });

  it('toggle a region on and off in the order the app lists them, and ignore a region the tour does not offer', () => {
    let s = tour({ regions: [] });
    s = toggleRegion(s, 'core');
    s = toggleRegion(s, 'legs');
    expect(s.regions).toEqual(['legs', 'core']);
    expect(toggleRegion(s, 'core').regions).toEqual(['legs']);
    expect(toggleRegion(s, 'seated')).toBe(s);
    expect(toggleRegion(s, 'nonsense')).toBe(s);
    expect(TOUR_REGIONS).not.toContain('seated');
  });

  it('take a level that exists and no other', () => {
    expect(withLevel(tour(), 'strong').level).toBe('strong');
    expect(withLevel(tour({ level: 'gentle' }), 'extreme').level).toBe('gentle');
  });

  it('offer a phone, a phone on its side and a laptop to one player, and a laptop or a TV to two, who share one camera', () => {
    expect(deviceChoices(1)).toEqual(['phone', 'phoneLand', 'laptop']);
    expect(deviceChoices(2)).toEqual(['laptop', 'tv']);
    expect(withDevice(tour(), 'tv').device).toBe('phone');
    const two = withPlayers(tour({ device: 'phone' }), 2, true);
    expect(two).toMatchObject({ players: 2, device: 'laptop' });
    expect(withDevice(two, 'tv').device).toBe('tv');
    expect(withPlayers(two, 1, true)).toMatchObject({ players: 1, device: 'laptop' });
    expect(withPlayers(withDevice(two, 'tv'), 1, true).device).toBe('laptop');
  });

  it('never offer two players on a screen that cannot show them', () => {
    expect(withPlayers(tour(), 2, false)).toMatchObject({ players: 1, device: 'phone' });
  });

  it('keep in the settings the regions, the level, the two modes and the place of the camera (a TV is a laptop to the rest of the app)', () => {
    expect(settingsPatch(tour({ regions: ['legs'], level: 'gentle', seated: true, quiet: false, device: 'phoneLand' }))).toEqual({ regions: ['legs'], level: 'gentle', seated: true, quiet: false, device: 'phoneLand' });
    expect(settingsPatch(withDevice(withPlayers(tour(), 2, true), 'tv')).device).toBe('laptop');
  });

  it('give the first game a free level: easy for a gentle player, normal for everybody else', () => {
    expect(['gentle', 'steady', 'strong'].map((l) => firstDifficulty(l as 'gentle'))).toEqual(['easy', 'normal', 'normal']);
  });
});

describe('who is taken to the tour', () => {
  const visit: FirstVisit = { initial: true, atHome: true, onboardingDone: false, rounds: 0, automated: false };

  it('is a first visit to the home page, with nothing played, that is not a script', () => {
    expect(takeToTour(visit)).toBe(true);
  });

  it('is nobody else: not a game page, not someone who has seen it or played, not a move inside the app, not a robot', () => {
    for (const no of [{ initial: false }, { atHome: false }, { onboardingDone: true }, { rounds: 1 }, { automated: true }]) expect(takeToTour({ ...visit, ...no }), JSON.stringify(no)).toBe(false);
  });

  it('never takes a crawler, a preview fetcher or a script driving the browser', () => {
    const robots = [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0)',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0 Safari/537.36',
      'Mozilla/5.0 (Linux; Android 11) Chrome-Lighthouse',
      'facebookexternalhit/1.1',
      'Twitterbot/1.0',
    ];
    for (const userAgent of robots) expect(isAutomated({ userAgent }), userAgent).toBe(true);
    expect(isAutomated({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' })).toBe(false);
    expect(isAutomated({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36', webdriver: true })).toBe(true);
    expect(isAutomated({})).toBe(false);
  });
});

describe('the 3D stage on a weak phone', () => {
  it('starts at the lightest tier on a device that says it is weak and at the middle one otherwise', () => {
    expect(startTier({ cores: 4 })).toBe(0);
    expect(startTier({ memoryGb: 2 })).toBe(0);
    expect(startTier({ cores: 8, memoryGb: 8 })).toBe(1);
    expect(startTier({})).toBe(1);
  });

  it('judges its own frames: waits for ninety, goes down a tier over 20 ms, gives way to the pictures over 33 ms at the lightest tier', () => {
    expect(judgeStage({ frames: 30, p95: 90, tier: 1 })).toBe('wait');
    expect(judgeStage({ frames: 90, p95: 12, tier: 1 })).toBe('keep');
    expect(judgeStage({ frames: 90, p95: 25, tier: 1 })).toBe('lower');
    expect(judgeStage({ frames: 90, p95: 25, tier: 2 })).toBe('lower');
    expect(judgeStage({ frames: 120, p95: 25, tier: 0 })).toBe('keep');
    expect(judgeStage({ frames: 120, p95: 40, tier: 0 })).toBe('fallback');
  });
});

describe.each(['en', 'tr'] as const)('the five pages in %s', (lang) => {
  const draw = (st: TourState, caps?: UiCapabilities) => {
    const missing: string[] = [];
    const html = welcomePage(ctxOf(lang, caps, missing), st).value;
    return { html, text: textOf(html), missing };
  };

  it('use only strings that exist and leave nothing of code in the words', () => {
    for (const step of STEPS) {
      const { text, missing } = draw(tour({ step }), big);
      expect(missing, `step ${step}`).toEqual([]);
      expect(text, `step ${step}`).not.toMatch(/undefined|\[object|NaN|\{[a-z]+\}|onboarding\./);
    }
  });

  it('have one heading each, which is where the focus goes, and say which step of seven they are', () => {
    for (const step of STEPS) {
      const { html, text } = draw(tour({ step }));
      expect(html.match(/<h1\b/g), `step ${step}`).toHaveLength(1);
      expect(html, `step ${step}`).toContain('class="ob-title" tabindex="-1"');
      if (step > 1) expect(text, `step ${step}`).toMatch(lang === 'en' ? new RegExp(`Step ${step} of 7`) : new RegExp(`Adım ${step} / 7`));
    }
  });

  it('open on the first page with the one honest sentence, a start button, a way to skip, and the other language', () => {
    const { html, text } = draw(tour());
    expect(html).toContain('data-action="tour-next"');
    expect(html).toContain('data-action="tour-skip"');
    expect(html).toContain(`hreflang="${lang === 'en' ? 'tr' : 'en'}"`);
    expect(text).toContain(String(games.length));
  });

  it('draw the regions as toggles that say whether they are on, the level as radio buttons and the two modes as switches', () => {
    const { html } = draw(tour({ step: 3, regions: ['legs', 'core'], level: 'strong', seated: true }));
    expect(html.match(/data-action="tour-region"/g)).toHaveLength(TOUR_REGIONS.length);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(2);
    expect(html.match(/name="tour-level"/g)).toHaveLength(3);
    expect(html).toMatch(/name="tour-level" value="strong"[^>]*checked/);
    expect(html).toMatch(/name="tour-seated"[^>]*checked/);
    expect(html).not.toMatch(/name="tour-quiet"[^>]*checked/);
  });

  it('offer two players only where the screen shows them, and then change the camera choices and the heading', () => {
    expect(draw(tour({ step: 4 })).html).not.toContain('name="tour-players"');
    const solo = draw(tour({ step: 4 }), big);
    const one = solo.html;
    expect(one.match(/name="tour-players"/g)).toHaveLength(2);
    expect(one.match(/name="tour-device"/g)).toHaveLength(3);
    const two = draw(tour({ step: 4, players: 2, device: 'laptop' }), big);
    expect(two.html.match(/name="tour-device"/g)).toHaveLength(2);
    expect(two.html).toContain('value="tv"');
    expect(two.html).not.toContain('value="phone"');
    expect(two.html).toMatch(/name="tour-players" value="2"[^>]*checked/);
    expect(two.text).not.toBe(solo.text);
  });

  it('end on the camera explainer with one way on and no way out (the browser asks for the camera next)', () => {
    const { html } = draw(tour({ step: 5 }));
    expect(html.match(/<button\b/g)).toHaveLength(1);
    expect(html).toContain('data-action="tour-next"');
    expect(html).not.toContain('tour-skip');
    expect(html).not.toContain('tour-back');
  });

  it('give every control a name and use only the actions the controller knows', () => {
    const known = new Set(['tour-next', 'tour-back', 'tour-skip', 'tour-region', 'lang']);
    for (const step of STEPS) {
      const { html } = draw(tour({ step }), big);
      for (const m of html.matchAll(/data-action="([^"]+)"/g)) expect(known.has(m[1] as string), `step ${step}: ${m[1]}`).toBe(true);
      for (const m of html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)) expect(textOf(m[1] as string).trim().length, `step ${step}: ${m[0].slice(0, 60)}`).toBeGreaterThan(0);
    }
  });
});

describe('the seated line', () => {
  it('says every game only when every game has a seated version, and counts them otherwise', () => {
    const every = ctxOf('en');
    expect(seatedLine({ ...every, games: games.map((g) => ({ ...g, seated: true })) })).toBe('Play from a chair. Every game has a seated version.');
    const some = games.map((g, i) => ({ ...g, seated: i < 3 }));
    expect(seatedLine({ ...every, games: some })).toBe('Play from a chair. 3 games have a seated version.');
    expect(seatedLine({ ...every, games: games.map((g, i) => ({ ...g, seated: i === 0 })) })).toBe('Play from a chair. 1 game has a seated version.');
    expect(seatedLine({ ...ctxOf('tr'), games: some })).toBe('Sandalyeden oyna. 3 oyunun oturarak sürümü var.');
  });
});
