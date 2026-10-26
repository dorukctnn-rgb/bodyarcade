// The screens that tell the player's record: the challenge of the day and the week on the home page, the workout plans (the
// page, the strip, the card of the plan that is going, the panel between two games), what a round did on the results screen.
// Drawn from S's real arcade on a memory store, in English and Turkish, with every link and button checked.
import { describe, expect, it } from 'vitest';
import { createArcade, type Arcade } from '../../core/store/arcade.ts';
import { createStore, memoryStorage } from '../../core/store/store.ts';
import { textOf } from '../../core/ui/html.ts';
import type { Lang } from '../../core/ui/i18n/index.ts';
import { copyProblems } from '../catalogue/copy.ts';
import { loadCatalogue } from '../catalogue/load.ts';
import { weekStats, secondsByDay, recentBests } from './app/arcade.ts';
import { makeContext, type ContextInit } from './make-context.ts';
import { EMPTY_STATE, renderPage } from './pages.ts';
import { router } from './routes.ts';
import { gamePage } from './views/game.ts';
import { NO_HOME_DATA } from './views/home.ts';
import { planPanel, stepHref, type PlanPanel } from './views/plans.ts';
import { resultsPage, type RoundResult } from './views/results.ts';
import type { SetupState } from './views/setup.ts';

const games = loadCatalogue({ fixtures: 'only', requiredLangs: ['en', 'tr'] }).catalogue.games;
const LANGS: Lang[] = ['en', 'tr'];
const NOON = Date.UTC(2026, 9, 21, 12);

function arcadeFor(can: (f: string) => boolean = () => true, at = NOON): Arcade {
  return createArcade({ store: createStore({ storage: memoryStorage(), now: () => at, timeZone: 'UTC' }), games: () => games, can });
}

const FREE_ONLY = (f: string): boolean => f === 'plan:desk-break' || (f.startsWith('game:') && games.find((g) => g.id === f.slice(5))?.free === true);

function draw(lang: Lang, url: string, init: Partial<ContextInit> = {}, state = EMPTY_STATE) {
  const ctx = makeContext({ lang, games, url, ...init });
  const r = renderPage(ctx, router.match(url), state);
  return { ctx, r, html: r.body.value, text: textOf(r.body.value) };
}

const actions = (html: string): string[] => [...html.matchAll(/data-action="([^"]+)"/g)].map((m) => m[1] as string);

describe('the plans page', () => {
  for (const lang of LANGS) {
    const url = lang === 'en' ? '/plans/' : '/tr/plans/';

    it(`${lang}: drawn without a visitor it lists every plan with its games and rests and holds nothing to press`, () => {
      const { html, text, r } = draw(lang, url, { server: true });
      expect(r.noindex).toBe(false);
      expect((html.match(/class="k-card k-plancard"/g) ?? []).length).toBe(5);
      for (const name of lang === 'en' ? ['Desk break', 'Full body', 'Legs day', 'Kids active break', 'Easy 60+'] : ['Masa molası', 'Tüm vücut', 'Bacak günü', 'Çocuklar için hareket arası', 'Rahat 60+']) expect(text).toContain(name);
      expect(actions(html)).not.toContain('plan-start');
      expect(html).not.toContain('<button');
      expect(text).not.toMatch(/undefined|\[object|NaN|\{[a-z]+\}/);
      expect(copyProblems(text.replace(/\s{2,}/g, ' '))).toEqual([]);
      // every game of a plan is a link to the game's own page
      for (const m of html.matchAll(/class="k-steps"[\s\S]*?<\/ol>/g)) expect(m[0]).toMatch(/href="[^"]*\/games\/[a-z-]+\/"/);
    });

    it(`${lang}: a free player can start the desk break, and every other plan leads to Pro`, () => {
      const arcade = arcadeFor(FREE_ONLY);
      const { html } = draw(lang, url, {}, { ...EMPTY_STATE, plans: { cards: arcade.plans.list(), active: null } });
      expect((html.match(/data-action="plan-start"/g) ?? []).length).toBe(1);
      expect(html).toContain('data-plan="desk-break"');
      expect((html.match(/class="ba-btn ba-btn--secondary" href="[^"]*\/pro\/"/g) ?? []).length).toBe(4);
      expect(textOf(html).match(/Start with Pro|Pro ile başlat/g)).toHaveLength(4);
    });

    it(`${lang}: a Pro player can start every plan`, () => {
      const arcade = arcadeFor(() => true);
      const { html } = draw(lang, url, { plan: 'pro' }, { ...EMPTY_STATE, plans: { cards: arcade.plans.list(), active: null } });
      expect((html.match(/data-action="plan-start"/g) ?? []).length).toBe(5);
    });
  }

  it('says when a plan has been done this week, and which plan is going', () => {
    const arcade = arcadeFor(() => true);
    const started = arcade.plans.start('full-body');
    expect(started.ok).toBe(true);
    const { html, text } = draw('en', '/plans/', { plan: 'pro' }, { ...EMPTY_STATE, plans: { cards: arcade.plans.list(), active: arcade.plans.active() } });
    expect(text).toContain('Your plan today');
    expect(text).toMatch(/Full body: game 1 of 3, Firework Jacks next\./);
    expect(html).toContain('data-action="plan-go"');
    // the plan that is going continues; the others can still be started
    expect(html).toMatch(/Continue Full body/);
  });

  it('the address of a game of a plan carries the level and the seating the plan asks for, and says it is the plan\'s round', () => {
    const arcade = arcadeFor(() => true);
    const r = arcade.plans.start('desk-break');
    if (!r.ok || !r.view.current) throw new Error('the desk break did not start');
    const ctx = makeContext({ lang: 'en', games, url: '/plans/' });
    const href = stepHref(ctx, r.view.current) ?? '';
    expect(href).toMatch(/^\/play\/twist-turbine\/\?/);
    expect(href).toContain('difficulty=easy');
    expect(href).toContain('seated=1');
    expect(href).toContain('players=1');
    expect(href).toMatch(/&plan=1$/);
    expect(stepHref(ctx, { game: 'no-such-game', difficulty: 'easy', seated: false })).toBeNull();
  });
});

describe('the home page with a record', () => {
  const today = (arcade: Arcade) => arcade.today();

  it('shows the challenge of the day: the game, how long, how it stands, and a way to play it', () => {
    const arcade = arcadeFor();
    const t = today(arcade);
    for (const lang of LANGS) {
      const { html, text } = draw(lang, lang === 'en' ? '/' : '/tr/', {}, { ...EMPTY_STATE, home: { ...NO_HOME_DATA, challenge: t.challenge } });
      expect(html).toContain('data-challenge="');
      expect(text).toContain(lang === 'en' ? 'Challenge of the day' : 'Günün görevi');
      expect(text).toContain(lang === 'en' ? '0 of the last 7 days done.' : 'Son 7 günün 0 tanesinde tamamlandı.');
      const game = games.find((g) => g.id === t.challenge.challenge?.game);
      expect(html).toContain(`/games/${game?.seo.slug}/`);
    }
  });

  it('says so when the day is done, and when the player also beat their own best', () => {
    const arcade = arcadeFor();
    const id = arcade.challenge.today().challenge?.game as string;
    arcade.recordRun(id, { score: 5, seconds: 70, complete: true, variant: 'default', difficulty: 'normal' });
    const r2 = arcade.recordRun(id, { score: 9, seconds: 70, complete: true, variant: 'default', difficulty: 'normal' });
    expect(r2.challenge?.bonus).toBe(true);
    const { text } = draw('en', '/', {}, { ...EMPTY_STATE, home: { ...NO_HOME_DATA, challenge: arcade.challenge.today() } });
    expect(text).toContain('Done for today.');
    expect(text).toContain('Bonus: you beat your own best today.');
    expect(text).toContain('1 of the last 7 days done.');
  });

  it('is not on a region page, and not in a page drawn without a visitor', () => {
    const t = arcadeFor().today();
    const home = { ...EMPTY_STATE, home: { ...NO_HOME_DATA, challenge: t.challenge } };
    expect(draw('en', '/workouts/legs/', {}, home).html).not.toContain('data-challenge=');
    expect(draw('en', '/', {}).html).not.toContain('data-challenge=');
  });

  it('shows the week with the goal, the streaks and the line of an active day, and tells a new player how a streak starts', () => {
    const arcade = arcadeFor();
    arcade.recordRun('squat-flap', { score: 12, seconds: 200, complete: true, variant: 'default', difficulty: 'normal' });
    const t = today(arcade);
    const week = weekStats(secondsByDay(arcade, games), t.day, t.habit);
    const home = { ...EMPTY_STATE, home: { ...NO_HOME_DATA, week, recent: recentBests(arcade, games), challenge: t.challenge } };
    const en = draw('en', '/', {}, home).text;
    expect(en).toContain('1 of 3 active days this week.');
    expect(en).toContain('Play on 3 days a week to start a week streak. A day counts after 3 minutes.');
    expect(en).toContain('3 min');
    expect(draw('tr', '/tr/', {}, home).text).toContain('Bu hafta 3 aktif günün 1 tanesi tamam.');
  });

  it('shows the plans on the home page for a player: the cards, the plan that is going and the way to all of them', () => {
    const arcade = arcadeFor(() => true);
    arcade.plans.start('kids-break');
    const plans = { cards: arcade.plans.list(), active: arcade.plans.active() };
    const { html, text } = draw('en', '/', { plan: 'pro' }, { ...EMPTY_STATE, home: { ...NO_HOME_DATA, plans } });
    expect(text).toContain('Workout plans');
    expect(text).toContain('All plans');
    expect(text).toContain('Your plan today');
    expect(html).toContain('href="/plans/"');
    expect((html.match(/class="k-card k-planmini"/g) ?? []).length).toBe(3);
    expect(draw('en', '/workouts/legs/', {}, { ...EMPTY_STATE, home: { ...NO_HOME_DATA, plans } }).html).not.toContain('k-planstrip');
  });
});

describe('the game page', () => {
  it('says when the game is the challenge of the day', () => {
    const g = games.find((x) => x.free) ?? games[0];
    if (!g) throw new Error('no game');
    const ctx = makeContext({ lang: 'en', games, url: `/games/${g.seo.slug}/` });
    const done = textOf(gamePage(ctx, g, { best: null, challenge: { done: true, bonus: false } }).value);
    expect(done).toContain('Challenge of the day: Done for today.');
    expect(textOf(gamePage(ctx, g, { best: null, challenge: { done: false, bonus: false } }).value)).toContain('Challenge of the day');
    expect(gamePage(ctx, g, { best: null, challenge: null }).value).not.toContain('data-challenge-today');
  });
});

describe('the results screen with a record', () => {
  const setup: SetupState = { players: 1, input: 'camera', difficulty: 'normal', seated: false, quiet: false };
  const base = (): RoundResult => ({ gameId: games[0]?.id ?? 'squat-flap', setup, score: 20, seconds: 90, calories: null, personalBest: false, reasons: [] });
  const draw2 = (lang: Lang, r: RoundResult): { html: string; text: string } => {
    const html = resultsPage(makeContext({ lang, games, url: lang === 'en' ? '/results/' : '/tr/results/' }), r).value;
    return { html, text: textOf(html) };
  };

  it('tells what the round did and nothing else', () => {
    const r: RoundResult = { ...base(), progress: { activeDay: true, weekGoalReached: true, weekDays: 3, weekStreak: 2, challengeDone: true, challengeBonus: true, achievements: ['First steps'] } };
    const { text } = draw2('en', r);
    for (const line of ['Today is an active day.', 'Week goal reached: 3 active days.', 'Week streak: 2 weeks.', 'Challenge of the day done.', 'Bonus: a new best in the challenge game.', 'Achievement: First steps.']) expect(text).toContain(line);
    const quiet = draw2('en', { ...base(), progress: { activeDay: false, weekGoalReached: false, weekDays: 1, weekStreak: 0, challengeDone: false, challengeBonus: false, achievements: [] } });
    expect(quiet.html).not.toContain('data-progress');
    expect(draw2('en', base()).html).not.toContain('data-progress');
  });

  it('a week streak is not repeated on a round that changed nothing about the week', () => {
    const r: RoundResult = { ...base(), progress: { activeDay: false, weekGoalReached: false, weekDays: 3, weekStreak: 4, challengeDone: true, challengeBonus: false, achievements: [] } };
    const { text } = draw2('en', r);
    expect(text).toContain('Challenge of the day done.');
    expect(text).not.toContain('Week streak');
  });

  it('says it in Turkish', () => {
    const r: RoundResult = { ...base(), progress: { activeDay: true, weekGoalReached: false, weekDays: 1, weekStreak: 1, challengeDone: true, challengeBonus: false, achievements: [] } };
    const { text } = draw2('tr', r);
    expect(text).toContain('Bugün aktif bir gün.');
    expect(text).toContain('Günün görevi tamam.');
    expect(text).toContain('Hafta serisi: 1 hafta.');
  });
});

describe('the panel between two games of a plan', () => {
  const arcade = arcadeFor(() => true);
  const ctx = (lang: Lang) => makeContext({ lang, games, url: '/results/' });
  const started = arcade.plans.start('full-body');
  if (!started.ok) throw new Error('the plan did not start');
  const progress = arcade.plans.finishStep({ score: 30, seconds: 90 });
  const plan = started.view.plan;

  it('names the plan, the game that is next, the rest, and lets the player start it, skip it or leave the plan', () => {
    const next = progress.view?.current;
    const href = next ? stepHref(ctx('en'), next) : null;
    if (!next || !href) throw new Error('the plan has no second game');
    const panel: PlanPanel = { plan, over: false, done: false, played: 1, skipped: 0, total: 3, minutes: 2, next: { game: next.game, href, number: 2, restSec: 20 } };
    for (const lang of LANGS) {
      const html = planPanel(ctx(lang), panel).value;
      expect(html).toContain('data-plan-panel="next"');
      expect(html).toContain('data-plan-rest="20"');
      expect(html).toContain('data-plan-count');
      expect(html).toContain(`href="${href.replace(/&/g, '&amp;')}"`);
      expect(actions(html)).toEqual(expect.arrayContaining(['plan-go', 'plan-skip', 'plan-leave']));
      expect(textOf(html)).not.toMatch(/undefined|\{[a-z]+\}/);
    }
    expect(textOf(planPanel(ctx('en'), panel).value)).toContain('Full body: game 1 of 3 done');
    expect(textOf(planPanel(ctx('en'), panel).value)).toContain('Rest 20 seconds first.');
    expect(textOf(planPanel(ctx('tr'), panel).value)).toContain('Önce 20 saniye dinlen.');
  });

  it('has no rest line when there is none to take', () => {
    const next = progress.view?.current;
    const href = next ? stepHref(ctx('en'), next) : null;
    if (!next || !href) throw new Error('the plan has no second game');
    const html = planPanel(ctx('en'), { plan, over: false, done: false, played: 1, skipped: 0, total: 3, minutes: 2, next: { game: next.game, href, number: 2, restSec: 0 } }).value;
    expect(html).not.toContain('data-plan-rest');
  });

  it('says how the plan ended: done with the games and the minutes, or closed with too few games to count', () => {
    const done = textOf(planPanel(ctx('en'), { plan, over: true, done: true, played: 3, skipped: 0, total: 3, minutes: 12, next: null }).value);
    expect(done).toContain('Plan done: Full body');
    expect(done).toContain('3 of 3 games played in 12 minutes.');
    const short = textOf(planPanel(ctx('en'), { plan, over: true, done: false, played: 1, skipped: 2, total: 3, minutes: 2, next: null }).value);
    expect(short).toContain('only 1 of 3 games were played');
    const part = textOf(planPanel(ctx('en'), { plan, over: true, done: true, played: 2, skipped: 1, total: 3, minutes: 8, next: null }).value);
    expect(part).toContain('so this day counts for the plan');
    expect(textOf(planPanel(ctx('tr'), { plan, over: true, done: true, played: 3, skipped: 0, total: 3, minutes: 12, next: null }).value)).toContain('Plan bitti: Tüm vücut');
  });
});
