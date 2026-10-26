// Ghost races (builder N): a race against a RECORDING instead of a friend who is there. A recording is what one player did with
// every obstacle of one course, so the same race can be run again, alone, at any time, against what that player did. Three kinds,
// always told apart on the screen (BUILD-PLAN: "labelled as a recording"; game-design 0.1: a bot is never taken for a person):
//
//   own      your best run of this game and length, kept on this device, with your skeleton if you had the camera on
//   friend   a friend's run: saved from a match you played together (private rooms only, see MatchResult.runs) or opened from the
//            short code or link they sent (about 50 characters; their name, the course and what they did, never a picture)
//   bot      a practice partner at a level: made on the spot from the seed, no person behind it. The fallback when nobody is there
//            (tech.md 2.10: no opponent in 20 s) and when live play is down
//
// The course of a recording is the Room's own: makeSchedule(seed, durationMs, specFor(gameId)), so every game that can be raced
// can be raced against a recording with no code of its own, through the same duelGame wrapper (see ghost-race.ts).
// Nothing stored here is trusted: checkRun rebuilds the course and checks every field, so a damaged file or a made-up link is
// refused and never a crash, and the score is always recomputed from what happened, never read from a field.
import { rngStream } from '../loop/rng.ts';
import { MAX_DURATION_MS, MIN_DURATION_MS, type MatchInfo, type MatchResult, type ObstacleResult, type Outcome, type SeatId, type SeatScore } from '../types/net.ts';
import { checkName, NAME_MAX_CHARS } from './chat-filter.ts';
import { POSE_NUMBERS } from './pose-frame.ts';
import { makeSchedule, passPoints, scoreOf, specFor, type Obstacle } from './schedule.ts';

export type GhostSource = 'own' | 'friend' | 'bot';
export const GHOST_VERSION = 1;
/** Skeleton frames kept per second in an own recording. */
export const GHOST_HZ = 5;

export interface GhostRun {
  v: 1;
  gameId: string;
  /** The match seed: the course is makeSchedule(seed, durationMs, specFor(gameId)). */
  seed: number;
  durationMs: number;
  /** One character per obstacle of that course, in order: p passed, h hit, . not played. */
  outcomes: string;
  /** Who made it, as written when it was made; empty for a bot (and for an own run made with no name). */
  name: string;
  /** When it was made, epoch ms. */
  at: number;
  source: GhostSource;
  /** Your own skeleton, GHOST_HZ frames a second of 26 bytes in base64. Own runs on this device only; never in a code or link. */
  track?: string;
}

export const courseOf = (run: Pick<GhostRun, 'gameId' | 'seed' | 'durationMs'>): Obstacle[] => makeSchedule(run.seed, run.durationMs, specFor(run.gameId));

/** What happened at each obstacle of a course as the one-character-each string a recording keeps. */
export function outcomeString(course: readonly Obstacle[], results: readonly ObstacleResult[]): string {
  const by = new Map<number, Outcome>();
  for (const e of results) if (!by.has(e.ob)) by.set(e.ob, e.k);
  return course.map((o) => { const k = by.get(o.id); return k === 'pass' ? 'p' : k === 'hit' ? 'h' : '.'; }).join('');
}

/** The results a recording holds, by obstacle id (obstacles it never played are not in the list). */
export function resultsOf(run: Pick<GhostRun, 'gameId' | 'seed' | 'durationMs' | 'outcomes'>): ObstacleResult[] {
  const out: ObstacleResult[] = [];
  courseOf(run).forEach((o, i) => { const c = run.outcomes[i]; if (c === 'p' || c === 'h') out.push({ ob: o.id, k: c === 'p' ? 'pass' : 'hit' }); });
  return out;
}

export const runScore = (run: GhostRun): SeatScore => scoreOf(courseOf(run), resultsOf(run));

export interface Standing { score: number; combo: number; passes: number; hits: number }

/** Where the recording stands at match time `ms`: what it had scored by the obstacles that had come by then. */
export function standingAt(run: GhostRun, ms: number, course: readonly Obstacle[] = courseOf(run)): Standing {
  let score = 0, combo = 0, passes = 0, hits = 0;
  for (let i = 0; i < course.length; i++) {
    if ((course[i] as Obstacle).t > ms) break;
    const c = run.outcomes[i];
    if (c === 'p') { combo++; passes++; score += passPoints(combo); } else if (c === 'h') { combo = 0; hits++; }
  }
  return { score, combo, passes, hits };
}

export function runFromResults(o: { gameId: string; seed: number; durationMs: number; results: readonly ObstacleResult[]; name: string; at: number; source: GhostSource; track?: string | undefined }): GhostRun {
  const run: GhostRun = {
    v: 1, gameId: o.gameId, seed: o.seed, durationMs: o.durationMs, outcomes: outcomeString(courseOf(o), o.results),
    name: o.name, at: Math.floor(o.at / 60_000) * 60_000, source: o.source,
  };
  if (o.track) run.track = o.track;
  return run;
}

/**
 * One seat's run of the match a Room result describes (`MatchResult.runs`, which only a private room sends), as a recording: the
 * player's own (it may carry the skeleton their page kept, and is theirs to keep) or a friend's. Null when the result has no runs, belongs to
 * another match, or does not hold a valid run. Pure, so a stage that works on the client directly (not through LiveRace) uses it too.
 */
export function runFromResult(o: {
  result: Pick<MatchResult, 'mid' | 'runs'>;
  match: Pick<MatchInfo, 'id' | 'gameId' | 'seed' | 'duration'>;
  seat: SeatId;
  /** The name to put on it: this player's own, or the friend's as the Room shows it (empty when the friend has left). */
  name: string;
  mine: boolean;
  track?: string | undefined;
  at?: number;
}): GhostRun | null {
  const outcomes = o.result.runs?.[o.seat];
  if (o.result.mid !== o.match.id || typeof outcomes !== 'string') return null;
  const c = checkRun({
    v: 1, gameId: o.match.gameId, seed: o.match.seed, durationMs: o.match.duration, outcomes, name: o.name, at: Math.floor((o.at ?? Date.now()) / 60_000) * 60_000,
    source: o.mine ? 'own' : 'friend', ...(o.mine && o.track ? { track: o.track } : {}),
  });
  return c.ok ? c.run : null;
}

// ───────── checking ─────────

export type RunProblem = 'shape' | 'version' | 'game' | 'seed' | 'duration' | 'outcomes' | 'name' | 'time' | 'source';
export type RunCheck = { ok: true; run: GhostRun } | { ok: false; problem: RunProblem };

const GAME_RE = /^[a-z0-9][a-z0-9-]{1,30}$/;
const SOURCES: readonly GhostSource[] = ['own', 'friend', 'bot'];
const bad = (problem: RunProblem): RunCheck => ({ ok: false, problem });

/** The most skeleton bytes a run of this length can hold. */
const trackBytes = (durationMs: number): number => (Math.ceil((durationMs / 1000) * GHOST_HZ) + 1) * POSE_NUMBERS;
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** Everything about a recording, checked and rebuilt. A damaged skeleton track costs only the track. */
export function checkRun(x: unknown): RunCheck {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return bad('shape');
  const o = x as Record<string, unknown>;
  if (o['v'] !== GHOST_VERSION) return bad('version');
  const { gameId, seed, durationMs, outcomes, name, at, source, track } = o;
  if (typeof gameId !== 'string' || !GAME_RE.test(gameId)) return bad('game');
  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) return bad('seed');
  if (typeof durationMs !== 'number' || !Number.isInteger(durationMs) || durationMs % 1000 !== 0 || durationMs < MIN_DURATION_MS || durationMs > MAX_DURATION_MS) return bad('duration');
  if (typeof source !== 'string' || !SOURCES.includes(source as GhostSource)) return bad('source');
  const course = makeSchedule(seed, durationMs, specFor(gameId));
  if (typeof outcomes !== 'string' || outcomes.length !== course.length || !/^[ph.]*$/.test(outcomes)) return bad('outcomes');
  if (typeof name !== 'string' || name.length > NAME_MAX_CHARS * 2) return bad('name');
  let clean = '';
  if (source === 'bot') { if (name !== '') return bad('name'); }
  else if (name !== '') { const c = checkName(name); if (!c.ok) return bad('name'); clean = c.text; }
  if (typeof at !== 'number' || !Number.isFinite(at) || at < 0 || at > 4e12) return bad('time');
  const run: GhostRun = { v: 1, gameId, seed, durationMs, outcomes, name: clean, at: Math.floor(at), source: source as GhostSource };
  if (typeof track === 'string' && track.length > 0 && track.length <= Math.ceil((trackBytes(durationMs) * 4) / 3) + 4 && B64.test(track)) {
    const n = decodeBase64(track)?.length ?? 0;
    if (n > 0 && n % POSE_NUMBERS === 0 && n <= trackBytes(durationMs)) run.track = track;
  }
  return { ok: true, run };
}

// ───────── a code to send ─────────

/** Minutes since 1 January 2026 in four bytes. */
const EPOCH = Date.UTC(2026, 0, 1);
const MAX_CODE_CHARS = 400;

function crc16(u: Uint8Array, end = u.length): number {
  let c = 0xffff;
  for (let i = 0; i < end; i++) {
    c ^= (u[i] as number) << 8;
    for (let b = 0; b < 8; b++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff;
  }
  return c;
}

function encodeBase64(u: Uint8Array): string {
  let s = '';
  for (const b of u) s += String.fromCharCode(b);
  return btoa(s);
}

function decodeBase64(text: string): Uint8Array | null {
  try {
    const s = atob(text);
    const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u;
  } catch { return null; }
}

/**
 * The recording as a short text to send to a friend (about 50 characters for a minute's race): the game, the course, the name, when
 * and what was done at each obstacle, with a check sum. No skeleton and no picture go in it. The page puts it in a link as `?ghost=`.
 */
export function encodeRun(run: GhostRun): string {
  const te = new TextEncoder();
  const game = te.encode(run.gameId);
  const name = te.encode(run.name);
  const n = run.outcomes.length;
  const bytes: number[] = [GHOST_VERSION, game.length, ...game, (run.seed >>> 24) & 255, (run.seed >>> 16) & 255, (run.seed >>> 8) & 255, run.seed & 255];
  const sec = Math.round(run.durationMs / 1000);
  bytes.push((sec >>> 8) & 255, sec & 255);
  const min = Math.max(0, Math.floor((run.at - EPOCH) / 60_000));
  bytes.push((min >>> 24) & 255, (min >>> 16) & 255, (min >>> 8) & 255, min & 255);
  bytes.push(name.length, ...name, n);
  const packed = new Uint8Array(Math.ceil(n / 4));
  for (let i = 0; i < n; i++) packed[i >> 2] = (packed[i >> 2] as number) | ((run.outcomes[i] === 'p' ? 1 : run.outcomes[i] === 'h' ? 0 : 2) << ((i & 3) * 2));
  bytes.push(...packed);
  const u = new Uint8Array(bytes.length + 2);
  u.set(bytes);
  const c = crc16(u, bytes.length);
  u[bytes.length] = c >>> 8;
  u[bytes.length + 1] = c & 255;
  return encodeBase64(u).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A recording from the text `encodeRun` made, as a friend's (or whatever `source` says), or null for anything else: a typo, a cut link, a made-up one. */
export function decodeRun(text: string, source: GhostSource = 'friend'): GhostRun | null {
  const s = String(text ?? '').trim();
  if (!s || s.length > MAX_CODE_CHARS || !/^[A-Za-z0-9_-]+$/.test(s)) return null;
  const u = decodeBase64(s.replace(/-/g, '+').replace(/_/g, '/'));
  if (!u || u.length < 18) return null;
  if (crc16(u, u.length - 2) !== (((u[u.length - 2] as number) << 8) | (u[u.length - 1] as number))) return null;
  let i = 0;
  const take = (): number => (i < u.length - 2 ? (u[i++] as number) : -1);
  if (take() !== GHOST_VERSION) return null;
  const gl = take();
  if (gl < 2 || gl > 31 || i + gl > u.length - 2) return null;
  const gameId = String.fromCharCode(...u.slice(i, i + gl));
  i += gl;
  const word = (): number => { const a = take(), b = take(), c = take(), d = take(); return a < 0 || b < 0 || c < 0 || d < 0 ? -1 : ((a * 16_777_216) + (b << 16) + (c << 8) + d); };
  const seed = word();
  const sh = take(), sl = take();
  const min = word();
  const nl = take();
  if (seed < 0 || sh < 0 || sl < 0 || min < 0 || nl < 0 || i + nl > u.length - 2) return null;
  let name: string;
  try { name = new TextDecoder('utf-8', { fatal: true }).decode(u.slice(i, i + nl)); } catch { return null; }
  i += nl;
  const n = take();
  if (n < 0 || i + Math.ceil(n / 4) !== u.length - 2) return null;
  let outcomes = '';
  for (let k = 0; k < n; k++) {
    const v = ((u[i + (k >> 2)] as number) >> ((k & 3) * 2)) & 3;
    if (v === 3) return null;
    outcomes += v === 1 ? 'p' : v === 0 ? 'h' : '.';
  }
  const r = checkRun({ v: 1, gameId, seed, durationMs: ((sh << 8) | sl) * 1000, outcomes, name, at: EPOCH + min * 60_000, source: source === 'bot' ? 'friend' : source });
  return r.ok ? r.run : null;
}

// ───────── a practice partner ─────────

export type BotLevel = 'easy' | 'medium' | 'hard';
export const BOT_LEVELS: readonly BotLevel[] = ['easy', 'medium', 'hard'];
/** The share of obstacles each level gets past (before the bad luck that follows a hit). */
export const BOT_PASS: Readonly<Record<BotLevel, number>> = { easy: 0.55, medium: 0.75, hard: 0.9 };

/**
 * A practice partner: the same course as everybody, outcomes drawn from the seed at the level's pace. Labelled as a bot wherever it
 * is shown ("Practice partner (a bot)"): it has no name and no person behind it, and it is only ever offered when nobody else is there.
 */
export function botRun(o: { gameId: string; seed: number; durationMs: number; level: BotLevel; at: number }): GhostRun {
  const r = rngStream(o.seed, `ghost-bot-${o.level}`);
  const p = BOT_PASS[o.level];
  let after = 0;                                                  // obstacles since the last hit: a hit shakes a runner for a moment
  const results: ObstacleResult[] = courseOf(o).map((ob) => {
    const odds = after < 2 ? p * (0.85 + 0.075 * after) : p;
    const k: Outcome = r() < odds ? 'pass' : 'hit';
    after = k === 'hit' ? 0 : after + 1;
    return { ob: ob.id, k };
  });
  return runFromResults({ gameId: o.gameId, seed: o.seed, durationMs: o.durationMs, results, name: '', at: o.at, source: 'bot' });
}

// ───────── the skeleton of an own recording ─────────

/** Collects the player's skeleton at GHOST_HZ during a race (own recordings only: it stays on this device). */
export class TrackRecorder {
  private readonly slots: (number[] | null)[];
  private readonly slotMs = 1000 / GHOST_HZ;

  constructor(durationMs: number) {
    this.slots = new Array<number[] | null>(Math.ceil((durationMs / 1000) * GHOST_HZ) + 1).fill(null);
  }

  /** The packed pose (pose-frame.ts) seen at match time `ms`. The latest one in each fifth of a second is kept. */
  push(ms: number, packed: readonly number[] | null): void {
    if (!packed || packed.length !== POSE_NUMBERS || ms < 0) return;
    const i = Math.floor(ms / this.slotMs);
    if (i < this.slots.length) this.slots[i] = [...packed];
  }

  frames(): number { return this.slots.reduce((n, s) => n + (s ? 1 : 0), 0); }

  /** The track as base64, or undefined when too little was seen to be worth keeping (under three seconds of body). */
  finish(): string | undefined {
    if (this.frames() < GHOST_HZ * 3) return undefined;
    const u = new Uint8Array(this.slots.length * POSE_NUMBERS).fill(255);
    this.slots.forEach((s, k) => { if (s) u.set(s, k * POSE_NUMBERS); });
    return encodeBase64(u);
  }
}

const decoded = new Map<string, Uint8Array>();

/** The packed pose of an own recording at match time `ms`, or null when the body was not seen then (or there is no track). */
export function trackPoseAt(track: string | undefined, ms: number): number[] | null {
  if (!track) return null;
  let u = decoded.get(track);
  if (!u) {
    const d = decodeBase64(track);
    if (!d || d.length % POSE_NUMBERS !== 0) return null;
    u = d;
    if (decoded.size >= 4) decoded.delete(decoded.keys().next().value as string);
    decoded.set(track, u);
  }
  const frames = u.length / POSE_NUMBERS;
  const i = Math.min(frames - 1, Math.max(0, Math.floor(ms / (1000 / GHOST_HZ))));
  const out = Array.from(u.subarray(i * POSE_NUMBERS, (i + 1) * POSE_NUMBERS));
  return out.every((n) => n === 255) ? null : out;
}

// ───────── the words around a recording ─────────

export type GhostLabelKey = 'ghost.label.own' | 'ghost.label.friend' | 'ghost.label.recording' | 'ghost.label.bot';

export interface GhostLabel { key: GhostLabelKey; name: string; at: number; source: GhostSource }

/** Which shell string says what this recording is (never a person for a bot): 'Recording of Ada', 'Your best run', 'Practice partner (a bot)'. */
export function ghostLabel(run: Pick<GhostRun, 'source' | 'name' | 'at'>): GhostLabel {
  const key: GhostLabelKey = run.source === 'own' ? 'ghost.label.own' : run.source === 'bot' ? 'ghost.label.bot' : run.name ? 'ghost.label.friend' : 'ghost.label.recording';
  return { key, name: run.name, at: run.at, source: run.source };
}
