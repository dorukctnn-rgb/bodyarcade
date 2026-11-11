// The screens of duel links in every language of the site: the button on every game's page, the duel card of a duel room's page (the
// link, the time it has left, the way it is played, what the friend sees, the guest line), no camera switch in a duel room, the guest
// window, the duel button of a friend, the result card with both scores, and an expired room's way to a new link. The words keep the
// copy rules, never say "AI", promise nothing about health, and hold the same placeholders in every language.
import { describe, expect, it } from 'vitest';
import { textOf } from '../../core/ui/html.ts';
import type { Lang } from '../../core/ui/i18n/index.ts';
import { loadCatalogue } from '../catalogue/load.ts';
import { copyProblems } from '../catalogue/copy.ts';
import { makeContext } from './make-context.ts';
import type { RaceOutcome } from './app/race.ts';
import { NO_ROOM_STATE, type RoomState } from './social/port.ts';
import { de, en, es, fr, tr, clockOf, duelText } from './social/duel-strings.ts';
import { duelCard, duelResultBlock, guestNameStep, roundFits } from './social/screens/duel.ts';
import { NEW_PROFILE_SHEET, NO_ROOM_VIEW, profileSheet, roomPage } from './views/social.ts';
import { gamePage } from './views/game.ts';
import { liveRaceBlock } from './views/race.ts';

const games = loadCatalogue({ fixtures: 'only', requiredLangs: ['en', 'tr'] }).catalogue.games;
const LANGS: Lang[] = ['en', 'tr', 'de', 'es', 'fr'];
const NO_LEAK = /undefined|\[object|NaN|\{[a-z]+\}/;
const NOW = 1_800_000_000_000;

function ctxOf(lang: Lang, url = '/r/K7Q2MX/') {
  const missing: string[] = [];
  const ctx = makeContext({ lang, games, url, flags: { social: true }, i18n: { onMissing: (k, l) => { if (k.startsWith('duel.')) missing.push(`${l}:${k}`); } } });
  return { ctx, missing };
}

const duelRoom = (over: Partial<RoomState> = {}, closesIn = 540_000, mode: 'race' | 'score' = 'score'): RoomState => ({
  ...NO_ROOM_STATE, phase: 'lobby', me: 's1', link: 'https://bodyarcade.com/r/K7Q2MX',
  info: { code: 'K7Q2MX', kind: 'private', size: 2, host: 's1', config: { gameId: mode === 'race' ? 'squat-flap' : 'star-catch', durationMs: 90_000, band: null }, chat: 'preset', video: false, phase: 'lobby', duel: { closesAt: NOW + closesIn, mode } },
  members: [{ seat: 's1', name: 'Swift Otter 12', host: true, online: true, ready: false, sess: 'a', video: false }],
  ...over,
});

describe('the words of duel links', () => {
  const tables = { en, tr, de, es, fr } as const;
  const vars = (s: string): string[] => [...s.matchAll(/\{([a-z]+)\}/g)].map((m) => m[1] as string).sort();

  for (const [lang, table] of Object.entries(tables)) {
    it(`${lang}: every key, the same placeholders as English, the copy rules, no "AI" and no health claim`, () => {
      expect(Object.keys(table).sort()).toEqual(Object.keys(en).sort());
      for (const [k, v] of Object.entries(table)) {
        expect(v.trim(), `${lang} ${k}`).not.toBe('');
        expect(vars(v), `${lang} ${k}`).toEqual(vars(en[k as keyof typeof en]));
        expect(copyProblems(v), `${lang} ${k}`).toEqual([]);
        expect(v, `${lang} ${k}`).not.toMatch(/\bA\.?I\b|\bKI\b|\bIA\b|yapay zek/i);
        expect(v, `${lang} ${k}`).not.toMatch(/calorie|kalori|weight loss|kilo ver|burn fat|yağ yak|heal|tedavi/i);
      }
    });
  }

  it('the time left reads as minutes and seconds', () => {
    expect(clockOf(545)).toBe('9:05');
    expect(clockOf(0)).toBe('0:00');
    expect(clockOf(-3)).toBe('0:00');
  });

  it('another round fits while the match, its start and its result fit before the close', () => {
    const info = { duel: { closesAt: NOW + 100_000 }, config: { durationMs: 90_000 } };
    expect(roundFits(info, NOW - 2000)).toBe(true);
    expect(roundFits(info, NOW)).toBe(false);
    expect(roundFits({ config: { durationMs: 90_000 } }, NOW)).toBe(true);
  });
});

describe.each(LANGS)('duel screens in %s', (lang) => {
  it('every game\'s page has the duel link button and its note', () => {
    const { ctx, missing } = ctxOf(lang, '/games/star-catch/');
    let shown = 0;
    for (const g of games) {
      const html = gamePage(ctx, g).value;
      if (!html.includes('data-form="setup"')) continue;                          // a locked Pro game shows the lock instead
      expect(html, g.id).toContain(`data-action="race.new" data-game="${g.id}"`);
      expect(textOf(html), g.id).toContain(duelText(ctx.i18n)('cta'));
      shown++;
    }
    expect(shown).toBeGreaterThanOrEqual(8);
    expect(missing).toEqual([]);
  });

  it('a duel room\'s page: the card with the link, the time left, how it is played and what the friend sees, and no camera switch', () => {
    const { ctx, missing } = ctxOf(lang);
    const game = games.find((g) => g.id === 'star-catch') ?? null;
    const html = roomPage(ctx, { ...NO_ROOM_VIEW, room: duelRoom({ guest: true }), game, now: NOW }).value;
    const text = textOf(html);
    const d = duelText(ctx.i18n);
    expect(html).toContain('data-duel-card');
    expect(html).toContain('data-action="duel.share"');
    expect(text).toContain(d('card.left', { time: '9:00' }));
    expect(text).toContain(d('card.score'));
    expect(text).toContain(d('card.privacy'));
    expect(text).toContain(d('card.guest', { name: 'Swift Otter 12' }));
    expect(html).toContain('data-duel-nocam');
    expect(html).not.toContain('id="room-share"');
    expect(html).not.toContain('id="room-text"');
    // the link stays where every room has it
    expect(html).toContain('data-action="room.copy" data-what="link"');
    expect(text).not.toMatch(NO_LEAK);
    expect(missing).toEqual([]);
  });

  it('a race in a duel room says so; both players there: no share button, the way to get ready', () => {
    const { ctx } = ctxOf(lang);
    const game = games.find((g) => g.id === 'squat-flap') ?? null;
    const r = duelRoom({ members: [...duelRoom().members, { seat: 's2', name: 'Bo', host: false, online: true, ready: false, sess: 'b', video: false }] }, 540_000, 'race');
    const html = roomPage(ctx, { ...NO_ROOM_VIEW, room: r, game, now: NOW }).value;
    expect(textOf(html)).toContain(duelText(ctx.i18n)('card.race'));
    expect(textOf(html)).toContain(duelText(ctx.i18n)('card.leadJoined'));
    expect(html).not.toContain('data-action="duel.share"');
    expect(html).toContain('data-action="room.ready" data-ready="1"');
  });

  it('a duel room with too little time left says so and offers a new link', () => {
    const { ctx } = ctxOf(lang);
    const game = games.find((g) => g.id === 'star-catch') ?? null;
    const html = duelCard(ctx, duelRoom({}, 60_000), game, NOW).value;
    expect(html).toContain('data-duel-closing');
    expect(html).toContain('data-low');
    expect(html).toContain('data-action="race.new" data-game="star-catch"');
  });

  it('a duel room that closed by itself says why and offers a new link for the same game', () => {
    const { ctx } = ctxOf(lang);
    const html = roomPage(ctx, { ...NO_ROOM_VIEW, room: { ...duelRoom(), phase: 'closed', problem: 'expired' } }).value;
    expect(textOf(html)).toContain(ctx.i18n.tx('room.problem.expired'));
    expect(html).toContain('data-action="race.new" data-game="star-catch"');
  });

  it('the guest window: a generated name, the rules to agree to, the way in as a guest or to a profile instead', () => {
    const { ctx, missing } = ctxOf(lang);
    const s = { ...NEW_PROFILE_SHEET, step: 'name' as const, band: 'adult' as const, name: 'Calm Heron 40', guest: 'join' as const };
    const html = profileSheet(ctx, s).value;
    expect(html).toBe(guestNameStep(ctx, s).value);
    expect(html).toContain('data-guest-sheet');
    expect(html).toContain('Calm Heron 40');
    expect(html).not.toContain('id="profile-name"');
    expect(html).toContain('name="terms"');
    expect(html).toContain('data-action="sheet.guest.go"');
    expect(html).toContain('data-action="sheet.guest.profile"');
    expect(textOf(profileSheet(ctx, { ...s, guest: 'new' }).value)).toContain(duelText(ctx.i18n)('guest.goNew'));
    // without the guest way, the name step is the profile's own
    expect(profileSheet(ctx, { ...s, guest: null }).value).toContain('id="profile-name"');
    expect(missing).toEqual([]);
  });

  it('the result card: who won, both scores side by side, the winner marked, the rematch line, a new link once the room has no time', () => {
    const { ctx, missing } = ctxOf(lang, '/results/?room=K7Q2MX');
    const outcome = (won: boolean, closesIn: number): RaceOutcome => ({
      kind: 'live', you: won ? 520 : 310, won, draw: false, lost: !won, rivals: [{ name: 'Bo', score: won ? 310 : 520, label: null }], margin: won ? 210 : -210, best: 'none', code: null,
      live: {
        reason: 'complete', room: 'K7Q2MX',
        seats: [
          { seat: 's1', name: 'Swift Otter 12', score: won ? 520 : 310, passes: 0, hits: 0, place: won ? 1 : 2, forfeited: false, you: true, run: null },
          { seat: 's2', name: 'Bo', score: won ? 310 : 520, passes: 0, hits: 0, place: won ? 2 : 1, forfeited: false, you: false, run: null },
        ],
        duel: { closesAt: Date.now() + closesIn, mode: 'score', game: 'star-catch', durationMs: 90_000 },
      },
    });
    const d = duelText(ctx.i18n);
    const won = liveRaceBlock(ctx, outcome(true, 500_000), { keep: false }).value;
    expect(won).toContain('data-duel-result');
    expect(textOf(won)).toContain(d('result.won'));
    expect(textOf(won)).toContain(d('result.you'));
    expect(won).toMatch(/data-win[^>]*data-seat="s1"/);
    expect(won).toContain('data-rematch');
    expect(won).not.toContain('data-duel-closed');
    const lost = duelResultBlock(ctx, outcome(false, 30_000), Date.now()).value;
    expect(textOf(lost)).toContain(d('result.lost', { name: 'Bo' }));
    expect(lost).toMatch(/data-win[^>]*data-seat="s2"/);
    expect(lost).toContain('data-duel-closed');
    expect(lost).toContain('data-action="race.new" data-game="star-catch"');
    expect(textOf(lost)).not.toMatch(NO_LEAK);
    expect(missing).toEqual([]);
  });
});
