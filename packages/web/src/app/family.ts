// Family mode: two players and one camera, three games, and the scores of both added up over the evening.
//
// - Together: both stand in front of the camera at the same time (the session's mode local2: the pose model finds two people,
//   Player 1 on the left, Player 2 on the right) and every round gives two scores. This needs a big screen (a laptop, a desktop,
//   a TV, a tablet on its side: caps.local2), as two players on one camera always have.
// - Turns: where two people do not fit in the picture (a phone, a narrow window, the Android app), they take turns on the same
//   device: Player 1 plays the round, then Player 2 plays the same game, and so on. On a big screen the family may choose it too.
// Every round is a short round of the game (FAMILY_ROUND_SEC, short-round.ts), so three games take three minutes together and six
// in turns. A family round sets no personal record: it is the household's (the minutes count for the device's habit, as two players'
// rounds always do). No names are asked for: the players are Player 1 and Player 2, in the colours of the two-player HUD.
//
// What is kept: the evening that is going (so a page reloaded in the middle goes on with the next round), the same day only.
import type { LocalizedString } from '../../../core/types/index.ts';
import { p, schemaOf, BAD, type Parser } from '../../../core/store/schema.ts';
import type { BodyArcadeStore } from '../../../core/store/store.ts';

export type FamilyMode = 'together' | 'turns';
export type FamilySetId = 'classic' | 'party';
export type Slot = 1 | 2;

export interface FamilySet {
  id: FamilySetId;
  title: LocalizedString;
  /** The games of the evening, in order: games that two players can play on one camera (their manifests list local2). */
  games: readonly string[];
}

const T = (en: string, tr: string, de: string, es: string, fr: string): Record<string, string> => ({ en, tr, de, es, fr });

/** The family sets. The classic one holds free games only, so the mode is free; the party set has Pro games. */
export const FAMILY_SETS: readonly FamilySet[] = [
  { id: 'classic', title: T('Family classic', 'Aile klasiği', 'Familienklassiker', 'Clásico en familia', 'Classique en famille'), games: ['star-catch', 'pose-wall', 'squat-flap'] },
  { id: 'party', title: T('Family party', 'Aile partisi', 'Familienparty', 'Fiesta en familia', 'Fête en famille'), games: ['reaction-tag', 'limbo-bend', 'pad-work'] },
];

export const FAMILY_SET_IDS: readonly FamilySetId[] = FAMILY_SETS.map((s) => s.id);
export const familySetById = (id: unknown): FamilySet | null => FAMILY_SETS.find((s) => s.id === id) ?? null;

/** One round of a family evening lasts a minute. */
export const FAMILY_ROUND_SEC = 60;

/** The way to play that a device offers first: together where two players fit in the picture, else turns. */
export function defaultMode(local2: boolean): FamilyMode {
  return local2 ? 'together' : 'turns';
}

/** The mode that is played: together only where the device offers two players on one camera. */
export function modeFor(asked: unknown, local2: boolean): FamilyMode {
  if (asked === 'turns') return 'turns';
  if (asked === 'together' && local2) return 'together';
  return defaultMode(local2);
}

export interface FamilyScore { game: string; p1: number | null; p2: number | null }

export interface FamilyRun {
  set: FamilySetId;
  mode: FamilyMode;
  day: string;
  games: string[];
  /** The game being played (its place in `games`). */
  index: number;
  /** In turns: whose turn it is. Together: always 1. */
  turn: Slot;
  scores: FamilyScore[];
}

export interface FamilyView {
  run: FamilyRun;
  /** The round to play now, or null once the evening is over. */
  current: { game: string; number: number; total: number; turn: Slot | null } | null;
  totals: { p1: number; p2: number };
  /** Once it is over: who has more points over the evening (null: a draw). */
  over: boolean;
  winner: Slot | null;
}

export type FamilyStart = { ok: true; view: FamilyView } | { ok: false; code: 'unknown' | 'locked' | 'empty' };

export interface FamilyBookOptions {
  /** The games this build has, with whether two can play them on one camera. */
  games: () => readonly { id: string; local2: boolean }[];
  /** The entitlements' can(): 'game:<id>'. */
  can: (feature: string) => boolean;
  isFree: (gameId: string) => boolean;
}

export interface FamilyBook {
  /** The set may be started by this player: every game of it is free or theirs, and this build has it. */
  locked(id: FamilySetId): boolean;
  start(id: FamilySetId, mode: FamilyMode): FamilyStart;
  active(): FamilyView | null;
  /** The round of the evening has ended with these scores (together: both; turns: the score of the player whose turn it was). */
  finishRound(r: { p1: number; p2?: number | null }): FamilyView | null;
  abandon(): void;
}

const MAX_SCORE = 1_000_000_000;
const clampScore = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? Math.round(Math.min(MAX_SCORE, Math.max(0, x))) : 0);

export function totalsOf(run: Pick<FamilyRun, 'scores'>): { p1: number; p2: number } {
  return run.scores.reduce((t, s) => ({ p1: t.p1 + (s.p1 ?? 0), p2: t.p2 + (s.p2 ?? 0) }), { p1: 0, p2: 0 });
}

export function viewOf(run: FamilyRun): FamilyView {
  const totals = totalsOf(run);
  const over = run.index >= run.games.length;
  const game = run.games[run.index];
  return {
    run,
    current: !over && game ? { game, number: run.index + 1, total: run.games.length, turn: run.mode === 'turns' ? run.turn : null } : null,
    totals,
    over,
    winner: !over || totals.p1 === totals.p2 ? null : totals.p1 > totals.p2 ? 1 : 2,
  };
}

/** The run after a round: pure, so the rules have tests. */
export function afterRound(run: FamilyRun, r: { p1: number; p2?: number | null }): FamilyRun {
  if (run.index >= run.games.length) return run;
  const game = run.games[run.index] as string;
  const scores = run.scores.slice();
  const cur: FamilyScore = scores[run.index] ?? { game, p1: null, p2: null };
  if (run.mode === 'together') {
    scores[run.index] = { game, p1: clampScore(r.p1), p2: clampScore(r.p2 ?? 0) };
    return { ...run, scores, index: run.index + 1, turn: 1 };
  }
  // turns: the score is the player's whose turn it was; after Player 2 the next game begins
  scores[run.index] = run.turn === 1 ? { ...cur, game, p1: clampScore(r.p1) } : { ...cur, game, p2: clampScore(r.p1) };
  return run.turn === 1 ? { ...run, scores, turn: 2 } : { ...run, scores, index: run.index + 1, turn: 1 };
}

const scoreP = p.object({
  game: p.string({ pattern: /^[a-z0-9][a-z0-9-]{0,39}$/ }),
  p1: p.nullable(p.number({ min: 0, max: MAX_SCORE })),
  p2: p.nullable(p.number({ min: 0, max: MAX_SCORE })),
});
const runP = p.nullable(p.object({
  set: p.oneOf(FAMILY_SET_IDS),
  mode: p.oneOf(['together', 'turns'] as const),
  day: p.day(),
  games: p.array(p.string({ pattern: /^[a-z0-9][a-z0-9-]{0,39}$/ }), { max: 6 }),
  index: p.number({ int: true, min: 0, max: 6 }),
  turn: p.number({ int: true, min: 1, max: 2 }),
  scores: p.array(scoreP, { max: 6 }),
}));
const runParser: Parser<FamilyRun | null> = (raw) => {
  const r = runP(raw);
  if (r === BAD) return BAD;
  if (r === null) return null;
  // a run that does not add up is not trusted
  if (r.games.length === 0 || r.index > r.games.length || r.scores.length > r.games.length) return BAD;
  return { ...r, turn: r.turn === 2 ? 2 : 1 } as FamilyRun;
};
const RunSchema = schemaOf<FamilyRun | null>(1, runParser);

export function createFamilyBook(store: BodyArcadeStore, o: FamilyBookOptions): FamilyBook {
  const slot = store.ns('family').slot<FamilyRun | null>('run', RunSchema, null);
  const can = (f: string): boolean => { try { return o.can(f) === true; } catch { return false; } };
  const known = (): Map<string, { id: string; local2: boolean }> => {
    try { return new Map(o.games().map((g) => [g.id, g] as const)); } catch { return new Map(); }
  };
  const playable = (set: FamilySet): string[] => { const k = known(); return set.games.filter((id) => k.get(id)?.local2 === true); };
  const locked = (id: FamilySetId): boolean => {
    const set = familySetById(id);
    if (!set) return true;
    return playable(set).some((g) => !o.isFree(g) && !can(`game:${g}`));
  };

  function active(): FamilyView | null {
    const run = slot.get();
    if (!run) return null;
    if (run.day !== store.day()) { slot.remove(); return null; }
    return viewOf(run);
  }

  return {
    locked,
    start(id, mode) {
      const set = familySetById(id);
      if (!set) return { ok: false, code: 'unknown' };
      const games = playable(set);
      if (games.length === 0) return { ok: false, code: 'empty' };
      if (locked(id)) return { ok: false, code: 'locked' };
      const run: FamilyRun = { set: set.id, mode, day: store.day(), games, index: 0, turn: 1, scores: [] };
      slot.set(run);
      return { ok: true, view: viewOf(run) };
    },
    active,
    finishRound(r) {
      const v = active();
      if (!v || v.over) return null;
      const next = afterRound(v.run, r);
      slot.set(next);
      return viewOf(next);
    },
    abandon: () => { slot.remove(); },
  };
}
