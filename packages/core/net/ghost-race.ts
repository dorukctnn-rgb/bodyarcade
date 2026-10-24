// A race against a recording, run on this device alone (builder N). It is the feed of a live race with the Room taken out: the
// shell's duelGame wrapper (web/app/duel.ts) wraps the game the same way, the course is the recording's (seed, length, game), the
// clock is local and held while the player is held, and the rival is the recording's score at that moment. The wrapper and the
// games know nothing about the difference, so every game that can be raced can be raced against a ghost.
//
//   const book = new GhostBook();
//   const ghost = new GhostRace(book.best('squat-flap', 45_000) ?? botRun({...}), { book, name: me.name });
//   const module = duelModule(inner, ghost);        // the same wrapper as a live race
//   ...                                              // the stage: ghost.start() when the player is ready,
//                                                    // ghost.hold(true/false) while the camera or the pause button holds the player,
//                                                    // ghost.sendPose(landmarks) with every pose frame, ghost.rivals() for the plates,
//                                                    // ghost.countdownMs() for the 3-2-1, ghost.pose() for the ghost's skeleton
//   ghost.result() / ghost.outcome()                 // after the game completes: the same shape of result as a live match
//
// The ghost is labelled wherever it is shown (`ghost.label`): your own best run, the recording of a named friend, or a practice
// partner that is a bot. The player's own run is kept when it beats their best (book), and is theirs to share as a code (encodeRun).
import type { Unsubscribe } from '../types/index.ts';
import type { MatchResult, ObstacleResult, Outcome, SeatScore } from '../types/net.ts';
import type { GhostBook, OfferResult } from './ghost-book.ts';
import { courseOf, ghostLabel, runFromResults, runScore, standingAt, TrackRecorder, trackPoseAt, type GhostLabel, type GhostRun, type Standing } from './ghost.ts';
import { packPose, unpackPose } from './pose-frame.ts';
import { places, scoreOf, winnerOf, type Obstacle } from './schedule.ts';
import type { Landmark } from '../types/index.ts';

export const YOU = 'you';
export const GHOST = 'ghost';

export type GhostPhase = 'wait' | 'count' | 'run' | 'hold' | 'over';

/** One rival as the plates show it (the same shape as the live race's). */
export interface GhostRival { seat: string; name: string; score: number }

export interface GhostRaceOptions {
  /** The clock in ms (default: performance.now); tests pass their own. */
  now?: () => number;
  /** The 3-2-1 before time zero, ms. */
  countdownMs?: number;
  /** The 3-2-1 after a hold, ms. */
  resumeMs?: number;
  /** The player's name on the run that is made (empty when they have none). */
  name?: string;
  /** Where the player's run goes when it ends: it becomes the best of that game and length when it beats the best there is. */
  book?: GhostBook;
}

export interface GhostOutcome {
  you: SeatScore;
  ghost: SeatScore;
  won: boolean;
  lost: boolean;
  draw: boolean;
  /** Your points minus the recording's. */
  margin: number;
  /** Your run as it ended: to keep, to send as a code, to put in the book. */
  run: GhostRun;
  /** 'best': your new best. 'kept': the old best stays. 'none': no book was given. */
  best: OfferResult | 'none';
}

export class GhostRace {
  readonly run: GhostRun;
  readonly course: readonly Obstacle[];
  readonly label: GhostLabel;
  private readonly clock: () => number;
  private readonly countdown: number;
  private readonly resumeMs: number;
  private readonly name: string;
  private readonly book: GhostBook | null;
  private readonly id: string;
  private readonly recorder: TrackRecorder;
  private mode: 'idle' | 'run' | 'hold' | 'over' = 'idle';
  /** The wall time of match time zero, and the wall time the 3-2-1 in front of play ends. */
  private zeroAt = 0;
  private countUntil = 0;
  private resumed = false;
  private frozen = 0;
  private readonly mine = new Map<number, Outcome>();
  private announced = 0;
  private readonly cbs = new Set<(r: GhostRival[]) => void>();
  private res: MatchResult | null = null;
  private out: GhostOutcome | null = null;

  constructor(run: GhostRun, o: GhostRaceOptions = {}) {
    this.run = run;
    this.course = courseOf(run);
    this.label = ghostLabel(run);
    this.clock = o.now ?? (() => performance.now());
    this.countdown = o.countdownMs ?? 3000;
    this.resumeMs = o.resumeMs ?? 3000;
    this.name = o.name ?? '';
    this.book = o.book ?? null;
    this.id = `ghost-${run.seed}-${run.at}`;
    this.recorder = new TrackRecorder(run.durationMs);
  }

  // ───────── the feed of a race (what duelGame reads) ─────────

  /** The match, once the race has been started and until it is over. */
  match(): { id: string; seed: number; durationMs: number; gameId: string; results: readonly ObstacleResult[] } | null {
    if (this.mode === 'idle' || this.mode === 'over') return null;
    return { id: this.id, seed: this.run.seed, durationMs: this.run.durationMs, gameId: this.run.gameId, results: [] };
  }

  /** Match time in ms, negative before time zero; it stands still while the player is held and during the 3-2-1 after it. */
  time(): number {
    const t = this.at();
    this.tell(t);
    return t;
  }

  /** The match time, with no side effect. */
  private at(): number {
    switch (this.mode) {
      case 'idle': return -this.countdown;
      case 'over': return this.run.durationMs;
      case 'hold': return this.frozen;
      default: return this.resumed && this.clock() < this.countUntil ? this.frozen : this.clock() - this.zeroAt;
    }
  }

  phase(): GhostPhase {
    if (this.mode === 'idle') return 'wait';
    if (this.mode === 'over') return 'over';
    if (this.mode === 'hold') return 'hold';
    return this.clock() < this.countUntil ? 'count' : 'run';
  }

  report(ob: number, k: Outcome): void {
    if (this.mode === 'idle' || this.mode === 'over') return;
    if (!this.mine.has(ob) && this.course.some((o) => o.id === ob)) this.mine.set(ob, k);
  }

  /** The player's list at the end of the race (the first outcome of each obstacle counts, as in the Room). */
  finish(results: readonly ObstacleResult[]): void {
    if (this.mode === 'over') return;
    for (const e of results) if (!this.mine.has(e.ob) && this.course.some((o) => o.id === e.ob)) this.mine.set(e.ob, e.k);
    this.mode = 'over';
    this.settle();
    this.tell(this.run.durationMs);
  }

  /** The page's own frames go nowhere in a ghost race (there is nobody to send them to). */
  state(_d: { mt: number; sc: number }): void { /* nobody to tell */ }

  // ───────── what a stage needs on top ─────────

  /** The player is ready: the 3-2-1 begins. */
  start(): void {
    if (this.mode !== 'idle') return;
    this.mode = 'run';
    this.zeroAt = this.clock() + this.countdown;
    this.countUntil = this.zeroAt;
    this.resumed = false;
  }

  /** The player is held (camera lost, framing, a hidden tab, the pause button) or free again: the ghost waits with them and the 3-2-1 comes after. */
  hold(on: boolean): void {
    if (on) {
      if (this.mode !== 'run') return;
      this.frozen = this.at();
      this.mode = 'hold';
      return;
    }
    if (this.mode !== 'hold') return;
    if (this.frozen < 0) {                         // held before time zero: the first 3-2-1 begins again
      this.zeroAt = this.clock() + this.countdown;
      this.countUntil = this.zeroAt;
      this.resumed = false;
    } else {
      this.countUntil = this.clock() + this.resumeMs;
      this.zeroAt = this.countUntil - this.frozen;
      this.resumed = true;
    }
    this.mode = 'run';
  }

  /** Milliseconds left of the 3-2-1, 0 when the race is on or not started. */
  countdownMs(): number {
    return this.mode === 'run' ? Math.max(0, this.countUntil - this.clock()) : 0;
  }

  /** What the recording has scored by now. */
  standing(): Standing {
    return standingAt(this.run, this.mode === 'over' ? Infinity : Math.max(0, this.at()), this.course);
  }

  /** The recording's skeleton now (an own run made with the camera on), as landmarks to draw; null for the others and when the body was not seen. */
  pose(): Landmark[] | null {
    return unpackPose(trackPoseAt(this.run.track, Math.max(0, this.at())));
  }

  /** The player's own body, for the skeleton their run keeps (own recordings stay on this device). Call it with every pose frame. */
  sendPose(landmarks: readonly Landmark[] | null): void {
    if (this.mode !== 'run' || this.clock() < this.countUntil) return;
    this.recorder.push(this.at(), packPose(landmarks));
  }

  /** The recording as the rival of the plates: its name for the label is `label`, its score is what it had at this moment. */
  rivals(): GhostRival[] {
    return [{ seat: GHOST, name: this.label.name, score: this.standing().score }];
  }

  onRivals(cb: (r: GhostRival[]) => void): Unsubscribe {
    this.cbs.add(cb);
    return () => { this.cbs.delete(cb); };
  }

  /** The result in the shape of a live match's, once the race is over: you and the ghost, places by the Room's own rules. */
  result(): MatchResult | null { return this.res; }

  /** The result with the words around it: who won by how much, and your run to keep. */
  outcome(): GhostOutcome | null { return this.out; }

  /** The race is left (the stage is closed): nothing is kept and nothing is called again. */
  dispose(): void {
    this.mode = 'over';
    this.cbs.clear();
  }

  // ───────── inside ─────────

  private tell(t: number): void {
    const score = standingAt(this.run, this.mode === 'over' ? Infinity : Math.max(0, t), this.course).score;
    if (score === this.announced) return;
    this.announced = score;
    const list: GhostRival[] = [{ seat: GHOST, name: this.label.name, score }];
    for (const cb of [...this.cbs]) cb(list);
  }

  private settle(): void {
    const results: ObstacleResult[] = [...this.mine].map(([ob, k]) => ({ ob, k }));
    const you = scoreOf(this.course, results);
    const ghost = runScore(this.run);
    const pl = places({ [YOU]: you, [GHOST]: ghost }, [YOU, GHOST]);
    const winner = winnerOf(pl);
    this.res = { mid: this.id, reason: 'complete', winner, places: pl, scores: { [YOU]: you, [GHOST]: ghost }, forfeited: [] };
    const run = runFromResults({
      gameId: this.run.gameId, seed: this.run.seed, durationMs: this.run.durationMs, results, name: this.name, at: Date.now(), source: 'own', track: this.recorder.finish(),
    });
    this.out = {
      you, ghost, won: winner === YOU, lost: winner === GHOST, draw: winner === null, margin: you.score - ghost.score, run,
      best: this.book ? this.book.offer(run) : 'none',
    };
  }
}
