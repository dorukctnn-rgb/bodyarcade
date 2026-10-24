// A live race on the games' own code. The Room (builder N) is the clock and the judge: it starts the match for everybody at
// the same moment, pauses it for everybody, and scores it from one result per obstacle. A game that can be raced says so
// in its manifest (`modes` has 'duel') and keeps three promises (see DuelSetup in core/types):
//   1. start(o) with o.mode 'duel' builds its obstacles from o.duel.schedule: the obstacle with id n arrives at schedule[n].t
//      ms of play time, whatever the player does (the same course for both, so a slow player is never given an easier one);
//   2. when an obstacle is settled it emits { type: 'duel', ob, k: 'pass' | 'hit' } among the events of that step;
//   3. it completes after o.duel.durationMs of play time.
// This wraps such a game so the Room's time rules the play, without the session knowing anything about rooms:
//   - nothing is played until the Room has started a match (the player is calibrated and waiting);
//   - the game's play time follows the Room's match time: held while the match is paused or counting down, caught up
//     (without a result for what passed unseen) when this page joins a match that is already running;
//   - the results go to the Room as they happen, and the full list when the game completes;
//   - the score on the HUD is the Room's own formula over those results, so what the player sees is what the Room will say.
import { FIXED_DT, type Game, type GameContext, type GameEvent, type GameManifest, type GameModule, type Hud, type InputFrame, type RunSummary, type StartOptions, type StepResult } from '../../../core/types/index.ts';
import { makeSchedule, scoreOf, specFor, type Obstacle } from '../../../core/net/schedule.ts';
import type { ObstacleResult, Outcome } from '../../../core/types/net.ts';

/** What the race needs from the room, as the stage sees it. LiveFeed (live-feed.ts) fills it from the LiveClient. */
export interface DuelFeed {
  /** The match the Room has started, or null. `results` are the ones the Room already holds for this player (a page that was reloaded). */
  match(): { id: string; seed: number; durationMs: number; gameId: string; results: readonly ObstacleResult[] } | null;
  /** Match time in ms; negative before time zero. */
  time(): number;
  /** wait: no match yet. count: the start or the 3-2-1 after a pause. run. hold: paused. over: settling or over. */
  phase(): 'wait' | 'count' | 'run' | 'hold' | 'over';
  report(ob: number, k: Outcome): void;
  finish(results: readonly ObstacleResult[]): void;
  /** This player's match time and score for the others, at most about 15 times a second. */
  state(d: { mt: number; sc: number }): void;
}

/** A step's worth of play time in ms. */
export const STEP_MS = FIXED_DT * 1000;
/** More than this behind the Room: catch up (a step or more per frame). More than this ahead: wait. */
const SLACK_MS = 50;
/** A gap this big is a page that joined a running match (or woke from a long freeze): the steps are made, the results are not sent. */
const CATCH_UP_MS = 250;
/** Steps made in one frame while catching up. */
const MAX_STEPS = 600;
const STATE_EVERY_MS = 66;

const IDLE: StepResult = { events: [], phase: 'running' };

const emptySummary = (): RunSummary => ({ score: 0, seconds: 0, metSeconds: 0, log: [] });

const isDuelEvent = (e: GameEvent): e is GameEvent & { ob: number; k: Outcome } =>
  e.type === 'duel' && typeof e['ob'] === 'number' && (e['k'] === 'pass' || e['k'] === 'hit');

/** The HUD the game writes to in a race: its score slot belongs to the race, whatever the game computes. */
function raceHud(hud: Hud): Hud {
  const set: Hud['set'] = (slot, v) => { if (slot !== 'score') hud.set(slot, v); };
  // Everything else (announce, toast, and the plates of a player that a game may write to) passes through to the real HUD.
  return new Proxy(hud, {
    get(target, prop) {
      if (prop === 'set') return set;
      const v = Reflect.get(target, prop, target) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}

export interface RaceScore { score: number; hits: number; passes: number; bestCombo: number; combo: number }

/** The score of a player's results over a match, with the combo that runs now. */
export function raceScore(schedule: readonly Obstacle[], results: readonly ObstacleResult[]): RaceScore {
  const s = scoreOf(schedule, results);
  const byOb = new Map<number, Outcome>();
  for (const e of results) if (!byOb.has(e.ob)) byOb.set(e.ob, e.k);
  let combo = 0;
  for (const o of schedule) {
    const k = byOb.get(o.id);
    if (k === 'pass') combo++; else if (k === 'hit') combo = 0;
  }
  return { ...s, combo };
}

export function duelGame(game: Game, feed: DuelFeed): Game {
  let ctx: GameContext | null = null;
  let pending: StartOptions | null = null;
  let started = false;
  let done = false;
  let schedule: Obstacle[] = [];
  let mine: ObstacleResult[] = [];
  const seen = new Set<number>();
  let matchId = '';
  let playMs = 0;
  let sentAt = -1e9;
  let shownScore = -1;
  let shownCombo = -1;

  const begin = (): boolean => {
    const m = feed.match();
    if (!m || !pending) return false;
    schedule = makeSchedule(m.seed, m.durationMs, specFor(m.gameId));
    game.start({ ...pending, seed: m.seed, mode: 'duel', duel: { schedule, durationMs: m.durationMs } });
    started = true;
    done = false;
    matchId = m.id;
    mine = m.results.map((e) => ({ ob: e.ob, k: e.k }));
    seen.clear();
    for (const e of mine) seen.add(e.ob);
    playMs = 0;
    shownScore = -1;
    shownCombo = -1;
    return true;
  };

  const settle = (events: readonly GameEvent[], quiet: boolean): void => {
    for (const e of events) {
      if (!isDuelEvent(e) || seen.has(e.ob)) continue;
      seen.add(e.ob);
      mine.push({ ob: e.ob, k: e.k });
      if (!quiet) feed.report(e.ob, e.k);
    }
  };

  const showScore = (): void => {
    if (!ctx) return;
    const s = raceScore(schedule, mine);
    if (s.score !== shownScore) { shownScore = s.score; ctx.hud.set('score', s.score); }
    if (s.combo !== shownCombo) { shownCombo = s.combo; if (s.combo > 1) ctx.hud.set('combo', s.combo); }
  };

  return {
    manifest: game.manifest as GameManifest,

    async init(c: GameContext): Promise<void> {
      ctx = c;
      await game.init({ ...c, hud: raceHud(c.hud) });
    },

    start(o: StartOptions): void {
      pending = o;
      started = false;
      done = false;
      mine = [];
      seen.clear();
    },

    step(dt: number, input: InputFrame): StepResult {
      if (!started && !begin()) return IDLE;
      if (done) return { events: [], phase: 'complete' };
      const ph = feed.phase();
      if (ph === 'wait' || ph === 'count' || ph === 'hold') return IDLE;
      if (ph === 'over') {
        // The Room has ended the match for this page (the other player forfeited, the time ran out): finish what is local.
        done = true;
        feed.finish(mine);
        return { events: [], phase: 'complete' };
      }
      const t = feed.time();
      if (t < 0) return IDLE;
      const behind = t - playMs;
      if (behind < -SLACK_MS) return IDLE;                          // ahead of the Room: wait for it
      const quiet = behind > CATCH_UP_MS;                            // joined a running match: the steps are made, nothing is reported for them
      const n = behind > SLACK_MS ? Math.min(MAX_STEPS, Math.max(1, Math.round(behind / STEP_MS))) : 1;
      let events: GameEvent[] = [];
      let last: StepResult = IDLE;
      for (let i = 0; i < n; i++) {
        last = game.step(dt, input);
        playMs += STEP_MS;
        settle(last.events, quiet);
        if (last.events.length) events = events.concat(last.events);
        if (last.phase !== 'running') break;
      }
      showScore();
      if (last.phase !== 'running' && !done) {
        done = true;
        feed.finish(mine);
      }
      const now = playMs;
      if (!quiet && now - sentAt >= STATE_EVERY_MS) {
        sentAt = now;
        feed.state({ mt: Math.round(t), sc: raceScore(schedule, mine).score });
      }
      return { events, phase: last.phase };
    },

    render(alpha: number): void {
      if (started) game.render(alpha);
    },

    snapshot(): unknown {
      return started ? { duel: 1, matchId, playMs, mine: mine.map((e) => ({ ...e })), inner: game.snapshot() } : null;
    },

    restore(s: unknown): void {
      const snap = s as { duel?: number; matchId?: string; playMs?: number; mine?: ObstacleResult[]; inner?: unknown } | null;
      if (!snap || snap.duel !== 1) return;
      game.restore(snap.inner);
      started = true;
      matchId = snap.matchId ?? '';
      playMs = snap.playMs ?? 0;
      mine = (snap.mine ?? []).map((e) => ({ ...e }));
      seen.clear();
      for (const e of mine) seen.add(e.ob);
    },

    summary(): RunSummary {
      return started ? game.summary() : emptySummary();
    },

    dispose(): void {
      game.dispose();
    },
  };
}

/** The same module, raced: its games are wrapped, and it takes no keys or swipes (a race is played with the body). */
export function duelModule(inner: GameModule, feed: DuelFeed): GameModule {
  return { manifest: inner.manifest, create: () => duelGame(inner.create(), feed) };
}

/** Can this game be raced? Its manifest says so. */
export const canRace = (m: Pick<GameManifest, 'modes'>): boolean => m.modes.includes('duel');
