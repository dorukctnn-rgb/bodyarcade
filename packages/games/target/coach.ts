// The coach's calls (game-design.md card 7: "Antrenör kombinasyonu seslenir: bir-iki-üç!"): what is called and when, as plain data on
// the game clock. Pure, and the same in every language: the schedule says "n2 at 41 230 ms", never a word; the words and the clips
// belong to the voice (coach-voice.ts) and the captions to the strings (strings.ts).
//
// The schedule is a function of the plan and the timeline, so it is made once, from the seed, with the plan, and a snapshot only has
// to remember how far it has got. A call is due at a time on the game clock, not "so long after the previous call", so nothing
// piles up and nothing drifts, however long the round is or however late a frame comes.
import type { Timeline } from './timeline.ts';

/** Every call of the coach. A number is the place of a pad in its combination, as the pad itself shows it (1-2-3). */
export const CALL_IDS = [
  'n1', 'n2', 'n3', 'n4', 'n5', 'n6',
  'slipL', 'slipR', 'duck',
  'round1', 'round2', 'round3', 'roundFinal',
  'last10',
  'rest',
] as const;
export type CallId = (typeof CALL_IDS)[number];
export type CallKind = 'number' | 'defence' | 'round' | 'warn' | 'rest';

export const callKind = (id: CallId): CallKind => {
  if (id[0] === 'n') return 'number';
  if (id === 'slipL' || id === 'slipR' || id === 'duck') return 'defence';
  if (id === 'last10') return 'warn';
  if (id === 'rest') return 'rest';
  return 'round';
};

/** A call that is due: when (ms on the game clock) and, for a pad or a bag, the plan entry it announces. */
export interface Call { id: CallId; t: number; plan?: number }

/**
 * The longest a clip of each kind may be (ms). The schedule keeps calls from overlapping on the strength of these, and the voice
 * pack's tests hold every clip of every language to them.
 */
export const MAX_CLIP_MS: Readonly<Record<CallKind, number>> = { number: 360, defence: 760, round: 1100, warn: 780, rest: 1800 };
/** How long the caption of a call stays on the picture (ms). */
export const CAPTION_MS: Readonly<Record<CallKind, number>> = { number: 560, defence: 1100, round: 1500, warn: 1300, rest: 1800 };

/**
 * A number is called one beat before its pad lights: on the beat of the punch before it (the first of a combination, on the beat
 * before the first punch), the way a trainer calls the next punch while you throw this one.
 */
export const NUMBER_LEAD_BEATS = 1;
/** A bag's call (slip left, slip right, duck) is over 290 ms before the player's window opens, whichever language it is in. */
export const DEFENCE_LEAD_MS = 1050;
/** The round's name is called this long after the bell, so it follows the bell sound instead of covering it. */
export const ROUND_CALL_AFTER_MS = 300;
/** "Ten seconds" is called when this much of a round is left (earlier by a moment when a combination is being called then). */
export const WARN_LEFT_MS = 10000;
/** A round shorter than this gets no warning. */
export const WARN_MIN_ROUND_MS = 25000;
/** The rest is called this long after it begins: the "done" jingle that opens it is about 0.7 s long. */
export const REST_CALL_AFTER_MS = 750;
/** Silence kept between two calls (ms). */
export const MIN_GAP_MS = 40;

export const numberId = (k: number): CallId | null => (Number.isInteger(k) && k >= 0 && k < 6 ? (`n${k + 1}` as CallId) : null);

/** The name of round `n` (1-based) of `of`: the last of several is "final round"; past the third there is only the caption's number. */
export function roundId(n: number, of: number): CallId | null {
  if (of > 1 && n === of) return 'roundFinal';
  return n === 1 ? 'round1' : n === 2 ? 'round2' : n === 3 ? 'round3' : null;
}

const endOf = (c: Call): number => c.t + MAX_CLIP_MS[callKind(c.id)] + MIN_GAP_MS;

/**
 * The stretch of a round that a plan keeps free of calls for "ten seconds" (from the moment it is called to the moment the next call may
 * begin), or null for a round too short to have it. A game that makes a plan with calls in it (pad-work.ts) moves whatever would be called
 * in this stretch to after it, so that the warning is said when it is due and never has to move. Game clock, ms.
 */
export function warningHole(seg: { start: number; end: number }): { from: number; to: number } | null {
  if (seg.end - seg.start < WARN_MIN_ROUND_MS) return null;
  const from = seg.end - WARN_LEFT_MS;
  return { from, to: from + MAX_CLIP_MS.warn + MIN_GAP_MS };
}

/** True when calls that run from `from` to `to` (to: the end of the last one and the gap after it) would be in the way of the warning. */
export const inTheWay = (hole: { from: number; to: number } | null, from: number, to: number): boolean => hole !== null && from < hole.to && to > hole.from;

/** How long a number's call takes up, counting the gap after it, and a defence call's. */
export const NUMBER_SPAN_MS = MAX_CLIP_MS.number + MIN_GAP_MS;
export const DEFENCE_SPAN_MS = MAX_CLIP_MS.defence + MIN_GAP_MS;

/** True when no call is still being spoken at its time: the calls are in order and each one has finished before the next begins. */
export function noOverlap(calls: readonly Call[]): boolean {
  for (let i = 1; i < calls.length; i++) if ((calls[i] as Call).t < endOf(calls[i - 1] as Call) || (calls[i] as Call).t < (calls[i - 1] as Call).t) return false;
  return true;
}

/**
 * The calls of the rounds themselves, added to the calls a game made from its own plan (the numbers and the defence calls): the
 * name of each round after the bell, "ten seconds" before the end of each round, and the rest. All in order of time.
 *
 * "Ten seconds" yields to the other calls: if one is being made then, it is moved to the nearest quiet moment (up to four seconds earlier
 * or under a second later), and left out if there is none. A plan made with `warningHole` leaves it exactly where it is due.
 */
export function withRoundCalls(own: readonly Call[], tl: Timeline): Call[] {
  const calls: Call[] = [...own];
  const fixed: Call[] = [];
  const warns: Call[] = [];
  for (const seg of tl.segments) {
    if (seg.kind === 'rest') {
      // a breather too short to say it in is left unnamed
      if (seg.end - seg.start >= REST_CALL_AFTER_MS + MAX_CLIP_MS.rest + 400) fixed.push({ id: 'rest', t: seg.start + REST_CALL_AFTER_MS });
      continue;
    }
    const id = roundId(seg.round + 1, tl.rounds);
    if (id) fixed.push({ id, t: seg.start + ROUND_CALL_AFTER_MS });
    if (seg.end - seg.start >= WARN_MIN_ROUND_MS) warns.push({ id: 'last10', t: seg.end - WARN_LEFT_MS });
  }
  const placed = [...calls, ...fixed].sort((a, b) => a.t - b.t);
  const free = (t: number, id: CallId): boolean => {
    const end = t + MAX_CLIP_MS[callKind(id)] + MIN_GAP_MS;
    return placed.every((c) => end <= c.t || t >= endOf(c));
  };
  for (const w of warns) {
    // where it is due, else the nearest quiet moment (a plan made with warningHole has one right there; another game's may not)
    const dur = MAX_CLIP_MS[callKind(w.id)] + MIN_GAP_MS;
    const wanted = [w.t, ...placed.flatMap((c) => [endOf(c), c.t - dur])]
      .filter((t) => t >= w.t - 4000 && t <= w.t + 800 && free(t, w.id))
      .sort((a, b) => Math.abs(a - w.t) - Math.abs(b - w.t) || a - b);
    if (wanted.length > 0) { placed.push({ id: w.id, t: wanted[0] as number }); placed.sort((a, b) => a.t - b.t); }
  }
  return placed;
}
