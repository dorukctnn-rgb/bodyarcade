// The daily challenge: one game a day, the same game for everybody, and the player's own bonus on top of it.
//
//   Which game     drawn from the FREE games, so there is never a day on which the challenge is locked for somebody. The draw
//                  is a pure function of the date and the list of games (nothing is stored to make it, nothing is asked of a
//                  server), so friends who open the app on the same date are told the same game and can compare their week
//                  on its board (core/social). It is kept steady while the catalogue grows: a new game takes over only the
//                  days on which it wins the draw (rendezvous hashing, not a position in a list), and two days in a row never
//                  have the same game (the games are put in two even halves by the hash of their names; the even days draw
//                  from one half, the odd days from the other).
//   Done           a round of the game of the day that lasted at least a minute (the same "real round" as the paywall's
//                  rule). Any difficulty counts: nobody is turned away for playing it easy.
//   Bonus          beating your own best in that game on the same day. It is nobody else's number, so it cannot be compared,
//                  faked or bought; it is a tick next to the day.
//
// What is kept are facts, the days that were done and the days with a bonus (dayset.ts), so that the record of a second device
// merges as a union. The challenge itself is recomputed whenever it is asked for.
import { daySeed, daysBetween, addDays, type Day } from './date.ts';
import { EMPTY_DAYS, countDays, daySetParser, dropAfter, hasDay, mergeDays, pruneDays, sameDays, withDay, type DaySet } from './dayset.ts';
import { p, schemaOf, type Parser } from './schema.ts';
import type { BodyArcadeStore } from './store.ts';

export const CHALLENGE = {
  /** A round must last this long to count: a real round, not a game opened and closed. */
  minSeconds: 60,
  /** What the challenge suggests; a run on any difficulty counts. */
  difficulty: 'normal',
  keepMonths: 14,
} as const;

/** What the draw needs of a game: its name and whether everybody may play it. */
export interface ChallengeGame { id: string; free: boolean }

export interface DailyChallenge {
  day: Day;
  game: string;
  difficulty: string;
  minSeconds: number;
}

/** 32-bit FNV-1a with a final mix: the same number on every machine, and well spread even for names that differ in one letter. */
export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * The two halves the even and the odd days draw from: the games in the order of their names' hashes, cut in the middle. The
 * halves are as even as they can be (so every game gets about the same number of days), and a game that joins moves at most
 * one other game over the cut.
 */
function halves(ids: readonly string[]): [string[], string[]] {
  if (ids.length < 2) return [[...ids], [...ids]];
  const ordered = [...ids].sort((a, b) => hash32(a) - hash32(b) || (a < b ? -1 : 1));
  const cut = Math.ceil(ordered.length / 2);
  return [ordered.slice(0, cut), ordered.slice(cut)];
}

/**
 * The game of a day, or null when there is no free game. The same for the same date and the same free games, whatever
 * order the list comes in and whatever else it holds.
 */
export function dailyChallengeFor(day: Day, games: readonly ChallengeGame[]): DailyChallenge | null {
  const ids = [...new Set(games.filter((g) => g.free === true && typeof g.id === 'string' && g.id !== '').map((g) => g.id))].sort();
  if (ids.length === 0) return null;
  const parity = ((daysBetween('1970-01-01', day) % 2) + 2) % 2;
  const pool = halves(ids)[parity] as string[];
  const seed = daySeed(day);
  let best = pool[0] as string;
  let bestWeight = -1;
  for (const id of pool) {
    const w = hash32(`${seed}|${id}`);
    if (w > bestWeight) { best = id; bestWeight = w; }
  }
  return { day, game: best, difficulty: CHALLENGE.difficulty, minSeconds: CHALLENGE.minSeconds };
}

/** What the book is told about a round that has just ended. */
export interface ChallengeRun {
  game: string;
  seconds: number;
  /** The round beat the player's own best on this game and difficulty (progress.record says so). */
  newBest?: boolean;
}

/** Whether the round is the game of the day, played for long enough. */
export function meetsChallenge(c: DailyChallenge, run: { game: string; seconds: number }): boolean {
  return run.game === c.game && typeof run.seconds === 'number' && Number.isFinite(run.seconds) && run.seconds >= c.minSeconds;
}

export interface ChallengeToday {
  /** Null when the catalogue has no free game at all. */
  challenge: DailyChallenge | null;
  done: boolean;
  bonus: boolean;
  /** Days of the last seven (today included) on which the challenge was done. */
  doneThisWeek: number;
}

export interface ChallengeResult {
  challenge: DailyChallenge | null;
  /** This round is a round of the game of the day, long enough. */
  counted: boolean;
  done: boolean;
  /** The day became done with this round. */
  justDone: boolean;
  bonus: boolean;
  justBonus: boolean;
}

export interface ChallengeDay { day: Day; game: string | null; done: boolean; bonus: boolean }

/** The part of the record that two devices exchange. */
export interface ChallengeDoc { v: 1; d: DaySet; b: DaySet }

export interface ChallengeBook {
  today(): ChallengeToday;
  /** A round has ended. Never throws; what is not a round of the game of the day changes nothing. */
  record(run: ChallengeRun): ChallengeResult;
  /** The last `days` days, newest first, today included. The games are those of the catalogue as it is now. */
  recent(days: number): ChallengeDay[];
  doc(): ChallengeDoc;
  merge(remote: unknown): boolean;
}

const docParser: Parser<ChallengeDoc> = p.object({
  v: p.literal(1),
  d: p.withDefault(daySetParser(CHALLENGE.keepMonths + 2), () => ({})),
  b: p.withDefault(daySetParser(CHALLENGE.keepMonths + 2), () => ({})),
}) as Parser<ChallengeDoc>;

export const emptyChallengeDoc = (): ChallengeDoc => ({ v: 1, d: EMPTY_DAYS, b: EMPTY_DAYS });

export function readChallengeDoc(raw: unknown): ChallengeDoc | null {
  const r = docParser(raw);
  return typeof r === 'symbol' ? null : { v: 1, d: r.d, b: r.b };
}

export function mergeChallengeDocs(x: ChallengeDoc, y: ChallengeDoc): ChallengeDoc {
  return { v: 1, d: pruneDays(mergeDays(x.d, y.d), CHALLENGE.keepMonths), b: pruneDays(mergeDays(x.b, y.b), CHALLENGE.keepMonths) };
}

const SetSchema = schemaOf<DaySet>(1, daySetParser(CHALLENGE.keepMonths + 2));

export interface ChallengeOptions {
  /** The games of the catalogue right now (the manifests: id and free). Asked every time, since the catalogue grows. */
  games: () => readonly ChallengeGame[];
}

export function createChallengeBook(store: BodyArcadeStore, o: ChallengeOptions): ChallengeBook {
  const ns = store.ns('daily-challenge');
  const doneSlot = ns.slot<DaySet>('done', SetSchema, () => ({}));
  const bonusSlot = ns.slot<DaySet>('bonus', SetSchema, () => ({}));
  const games = (): readonly ChallengeGame[] => {
    try { return o.games(); } catch { return []; }
  };
  const horizon = (): Day => addDays(store.day(), 1);

  return {
    today() {
      const day = store.day();
      const done = doneSlot.get();
      return {
        challenge: dailyChallengeFor(day, games()),
        done: hasDay(done, day),
        bonus: hasDay(bonusSlot.get(), day),
        doneThisWeek: countDays(done, addDays(day, -6), day),
      };
    },

    record(run) {
      const day = store.day();
      const challenge = dailyChallengeFor(day, games());
      const wasDone = hasDay(doneSlot.get(), day);
      const wasBonus = hasDay(bonusSlot.get(), day);
      const counted = challenge !== null && run !== null && typeof run === 'object' && meetsChallenge(challenge, run);
      let done = wasDone;
      let bonus = wasBonus;
      if (counted) {
        if (!wasDone) { doneSlot.set(pruneDays(withDay(doneSlot.get(), day), CHALLENGE.keepMonths)); done = true; }
        if (run.newBest === true && !wasBonus) { bonusSlot.set(pruneDays(withDay(bonusSlot.get(), day), CHALLENGE.keepMonths)); bonus = true; }
      }
      return { challenge, counted, done, justDone: done && !wasDone, bonus, justBonus: bonus && !wasBonus };
    },

    recent(days) {
      const today = store.day();
      const n = Math.max(0, Math.min(60, Math.trunc(Number.isFinite(days) ? days : 0)));
      const list = games();
      const out: ChallengeDay[] = [];
      for (let i = 0; i < n; i++) {
        const d = addDays(today, -i);
        out.push({ day: d, game: dailyChallengeFor(d, list)?.game ?? null, done: hasDay(doneSlot.get(), d), bonus: hasDay(bonusSlot.get(), d) });
      }
      return out;
    },

    doc() {
      const h = horizon();
      return { v: 1, d: pruneDays(dropAfter(doneSlot.get(), h), CHALLENGE.keepMonths), b: pruneDays(dropAfter(bonusSlot.get(), h), CHALLENGE.keepMonths) };
    },

    merge(remote) {
      const doc = readChallengeDoc(remote);
      if (!doc) return false;
      const h = horizon();
      const d = pruneDays(dropAfter(mergeDays(doneSlot.get(), doc.d), h), CHALLENGE.keepMonths);
      const b = pruneDays(dropAfter(mergeDays(bonusSlot.get(), doc.b), h), CHALLENGE.keepMonths);
      let changed = false;
      if (!sameDays(d, doneSlot.get())) { doneSlot.set(d); changed = true; }
      if (!sameDays(b, bonusSlot.get())) { bonusSlot.set(b); changed = true; }
      return changed;
    },
  };
}
