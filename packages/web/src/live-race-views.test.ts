// The results of a race in a room, without a browser: every player with their place and points, the verdict (a win, a loss, a draw,
// a friend who left), the runs of the others that may be kept, and the two ways on (the rematch, which is the room's next race, and
// back to the room). The race itself, in two browsers through the real shell, is tests/e2e/social-ui-race.spec.ts.
import { describe, expect, it } from 'vitest';
import { courseOf, runFromResults, type GhostRun } from '../../core/net/ghost.ts';
import type { MatchResult } from '../../core/types/net.ts';
import { createI18n, type Lang } from '../../core/ui/i18n/index.ts';
import { loadCatalogue } from '../catalogue/load.ts';
import { liveOutcome, type LiveSeat } from './app/live-race.ts';
import { en as lrEn, tr as lrTr, type LrKey } from './app/live-strings.ts';
import { roomOfRoute } from './app/social.ts';
import { makeContext } from './make-context.ts';
import { router } from './routes.ts';
import { liveRaceBlock } from './views/race.ts';
import { resultsPage, type RoundResult } from './views/results.ts';
import { defaultSetup } from './views/setup.ts';

const games = loadCatalogue({ fixtures: 'only', requiredLangs: ['en', 'tr'] }).catalogue.games;
const ctx = (lang: Lang = 'en') => makeContext({ lang, games, url: lang === 'en' ? '/results/?room=K7P2QX' : '/tr/results/?room=K7P2QX' });
const MS = 30_000;

function run(name: string, pass: number): GhostRun {
  const base = { gameId: 'squat-flap', seed: 77, durationMs: MS };
  return runFromResults({ ...base, results: courseOf(base).map((ob, i) => ({ ob: ob.id, k: i < pass ? 'pass' : 'hit' })), name, at: Date.UTC(2026, 9, 25), source: 'friend' });
}

const seat = (over: Partial<LiveSeat> & Pick<LiveSeat, 'seat' | 'name'>): LiveSeat => ({ score: 0, passes: 0, hits: 0, place: null, forfeited: false, you: false, run: null, ...over });

function outcome(o: { reason?: MatchResult['reason']; winner?: string | null; seats: LiveSeat[] }) {
  const r: MatchResult = {
    mid: 'm1', reason: o.reason ?? 'complete', winner: o.winner ?? null, forfeited: o.seats.filter((s) => s.forfeited).map((s) => s.seat),
    places: Object.fromEntries(o.seats.filter((s) => s.place !== null).map((s) => [s.seat, s.place as number])),
    scores: Object.fromEntries(o.seats.map((s) => [s.seat, { score: s.score, hits: s.hits, passes: s.passes, bestCombo: 0 }])),
  };
  return { ...liveOutcome(r, o.seats, 'K7P2QX', 'none'), again: '/play/squat-flap/?room=K7P2QX' };
}

describe('the results of a race in a room', () => {
  const ada = seat({ seat: 's1', name: 'Ada', score: 48, place: 1, run: run('Ada', 9) });
  const me = seat({ seat: 's2', name: 'Bo', score: 30, place: 2, you: true, run: run('Bo', 5) });

  it('lists every player with their place and points, says who won by how much, and offers to keep a friend\'s run', () => {
    const html = liveRaceBlock(ctx(), outcome({ winner: 's1', seats: [ada, me] }), { keep: true }).value;
    expect(html).toContain('Ada won by 18 points.');
    expect(html).toMatch(/data-seat="s1"[\s\S]*Ada[\s\S]*48 points/);
    expect(html).toMatch(/data-seat="s2" data-you[\s\S]*Bo \(you\)[\s\S]*30 points/);
    expect(html).toContain('Place 1');
    expect(html).toContain('data-action="race-keep" data-seat="s1"');
    expect(html).toContain('Keep the run of Ada');
    expect(html).not.toContain('data-seat="s2" data-action');
    expect(html).toContain('data-rematch');
    expect(html).toContain('data-action="room.leave"');
    // a child's screens never keep a stranger's run
    expect(liveRaceBlock(ctx(), outcome({ winner: 's1', seats: [ada, me] }), { keep: false }).value).not.toContain('race-keep');
    // a run that is kept says so instead of the button
    const kept = liveRaceBlock(ctx(), outcome({ winner: 's1', seats: [{ ...ada, kept: true }, me] }), { keep: true }).value;
    expect(kept).toContain('The run of Ada is kept.');
    expect(kept).not.toContain('race-keep');
  });

  it('a win, a draw, a friend who left (late and early), in English and Turkish', () => {
    const win = outcome({ winner: 's2', seats: [{ ...me, score: 50, place: 1 }, { ...ada, score: 40, place: 2 }] });
    expect(liveRaceBlock(ctx(), win, { keep: true }).value).toContain('You won by 10 points.');
    const draw = outcome({ winner: null, seats: [{ ...me, score: 40, place: 1 }, { ...ada, score: 40, place: 1 }] });
    expect(liveRaceBlock(ctx(), draw, { keep: true }).value).toContain('A draw.');
    const left = outcome({ reason: 'forfeit', winner: 's2', seats: [{ ...me, place: 1 }, { ...ada, place: null, forfeited: true }] });
    const html = liveRaceBlock(ctx(), left, { keep: true }).value;
    expect(html).toContain('Ada left the race. You win.');
    expect(html).toMatch(/data-seat="s1" data-left[\s\S]*Left/);
    expect(html).not.toContain('race-keep');                          // a run of a player who left is not offered
    expect(liveRaceBlock(ctx('tr'), left, { keep: true }).value).toContain('Ada yarıştan ayrıldı. Sen kazandın.');
    const early = outcome({ reason: 'no_contest', seats: [me, { ...ada, place: null, forfeited: true }] });
    expect(liveRaceBlock(ctx(), early, { keep: true }).value).toContain('Ada left early, so this race does not count.');
  });

  it('the page of the results leads to the rematch (the room\'s next race) and back to the room, not to a round alone', () => {
    const c = ctx();
    const g = games.find((x) => x.id === 'squat-flap') ?? games[0];
    if (!g) throw new Error('no game');
    const race = { ...outcome({ winner: 's1', seats: [ada, me] }), live: { ...outcome({ winner: 's1', seats: [ada, me] }).live!, roomHref: '/r/K7P2QX' } };
    const r: RoundResult = { gameId: g.id, setup: defaultSetup(c, g), score: 30, seconds: 30, calories: null, personalBest: false, reasons: [], race };
    const html = resultsPage(c, r).value;
    expect(html).toContain('href="/play/squat-flap/?room=K7P2QX" data-action="again" data-rematch-go');
    expect(html).toContain('>Rematch<');
    expect(html).toContain('href="/r/K7P2QX" data-room-back');
    expect(html).toContain('Back to the room');
    expect(html).not.toContain('>Play again<');
    expect(resultsPage(ctx('tr'), r).value).toContain('Rövanş');
  });

  it('keeps the room open under its results: the results page belongs to the room its address names', () => {
    expect(roomOfRoute(router.match('/results/?room=K7P2QX'))).toBe('K7P2QX');
    expect(roomOfRoute(router.match('/results/'))).toBeNull();
    expect(roomOfRoute(router.match('/play/squat-flap/?room=K7P2QX'))).toBe('K7P2QX');
  });
});

describe('the words of a race in a room', () => {
  const keys = Object.keys(lrEn) as LrKey[];
  it('both languages have the same keys and the same variables, and keep to the copy rules', () => {
    expect(Object.keys(lrTr).sort()).toEqual([...keys].sort());
    const vars = (s: string): string[] => [...s.matchAll(/\{(\w+)/g)].map((m) => m[1] as string).sort();
    for (const k of keys) expect(vars(lrTr[k]), k).toEqual(vars(lrEn[k]));
    const banned = [/—/, /\s–\s/, /[→←]/, /[✓✔✗✘]/, /\p{Extended_Pictographic}/u, /!/];
    for (const table of [lrEn, lrTr] as Record<LrKey, string>[]) for (const k of keys) for (const re of banned) expect(table[k], k).not.toMatch(re);
    for (const k of keys) { const t = lrTr[k].replace(/\{[^}]*\}/g, ''); if (t.length > 40) expect(t, k).toMatch(/[çğıöşüÇĞİÖŞÜ]/); }
  });
  it('are found through the shell\'s words in both languages', () => {
    expect(createI18n('en').tx('lr.result.rematch')).toBe('Rematch');
    expect(createI18n('tr').tx('lr.result.room')).toBe('Odaya dön');
    expect(createI18n('de').tx('lr.result.rematch')).toBe('Rematch');
  });
});
