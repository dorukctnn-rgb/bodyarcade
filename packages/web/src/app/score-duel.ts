// A score duel (duel links, core/net/duel-link.ts): a game without a course for live play, played by two at the same time. The Room
// is the clock and the judge as in a race (duel.ts): it starts the match for both at the same moment, holds it for both, and ends it.
// The game plays its own round from the match's seed (the same round for both), and this wrapper:
//   - holds the game until the Room's match time zero, and keeps its play time in step with the Room's (the same rules as duel.ts);
//   - reads the game's own points from what it writes to the HUD (every game writes its score there as a number);
//   - reports the running total to the Room a few times a second (the Room keeps it within the game's rate), and the last one when
//     the game is over: when its own round ends early (a game with lives), or when the match time runs out (a long round is cut there).
import { FIXED_DT, type Game, type GameContext, type GameManifest, type GameModule, type Hud, type InputFrame, type RunSummary, type StartOptions, type StepResult } from '../../../core/types/index.ts';
import type { DuelFeed } from './duel.ts';

export const STEP_MS = FIXED_DT * 1000;
const SLACK_MS = 50;
const CATCH_UP_MS = 250;
const MAX_STEPS = 600;
/** The running total goes to the Room at most this often (the Room's general cap is far above it). */
export const SCORE_EVERY_MS = 250;
const STATE_EVERY_MS = 66;

const IDLE: StepResult = { events: [], phase: 'running' };
const emptySummary = (): RunSummary => ({ score: 0, seconds: 0, metSeconds: 0, log: [] });

/** The HUD the game writes to: everything passes through, and the score it shows is kept. */
function watchedHud(hud: Hud, seen: (v: number) => void): Hud {
  const set: Hud['set'] = (slot, v) => {
    if (slot === 'score' && typeof v === 'number' && Number.isFinite(v)) seen(v);
    hud.set(slot, v);
  };
  return new Proxy(hud, {
    get(target, prop) {
      if (prop === 'set') return set;
      const v = Reflect.get(target, prop, target) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}

export function scoreDuelGame(game: Game, feed: DuelFeed): Game {
  let pending: StartOptions | null = null;
  let started = false;
  let done = false;
  let matchId = '';
  let durationMs = 0;
  let playMs = 0;
  let total = 0;
  let sentScore = -1;
  let sentAt = -1e9;
  let stateAt = -1e9;

  const begin = (): boolean => {
    const m = feed.match();
    if (!m || !pending) return false;
    game.start({ ...pending, seed: m.seed, mode: 'solo' });
    started = true;
    done = false;
    matchId = m.id;
    durationMs = m.durationMs;
    playMs = 0;
    total = 0;
    sentScore = -1;
    sentAt = -1e9;
    return true;
  };

  const report = (force: boolean): void => {
    if (total === sentScore || (!force && playMs - sentAt < SCORE_EVERY_MS)) return;
    sentScore = total;
    sentAt = playMs;
    feed.score?.(total);
  };

  /** The game's own last word on its points: its summary, else what it showed. */
  const finalScore = (): number => {
    try {
      const s = game.summary().score;
      return Number.isFinite(s) && s >= 0 ? Math.round(s) : total;
    } catch { return total; }
  };

  const end = (): StepResult => {
    done = true;
    total = finalScore();
    feed.finish([], total);
    return { events: [], phase: 'complete' };
  };

  return {
    manifest: game.manifest as GameManifest,

    async init(c: GameContext): Promise<void> {
      await game.init({ ...c, hud: watchedHud(c.hud, (v) => { total = Math.max(0, Math.round(v)); }) });
    },

    start(o: StartOptions): void {
      pending = o;
      started = false;
      done = false;
    },

    step(dt: number, input: InputFrame): StepResult {
      if (!started && !begin()) return IDLE;
      if (done) return { events: [], phase: 'complete' };
      const ph = feed.phase();
      if (ph === 'wait' || ph === 'count' || ph === 'hold') return IDLE;
      // the Room ended the match for this page (the time ran out there, the other player left): what is local is final
      if (ph === 'over') return end();
      const t = feed.time();
      if (t < 0) return IDLE;
      if (t >= durationMs || playMs >= durationMs) return end();
      const behind = t - playMs;
      if (behind < -SLACK_MS) return IDLE;
      const n = behind > SLACK_MS ? Math.min(MAX_STEPS, Math.max(1, Math.round(behind / STEP_MS))) : 1;
      const quiet = behind > CATCH_UP_MS;
      let events: StepResult['events'] = [];
      let last: StepResult = IDLE;
      for (let i = 0; i < n && playMs < durationMs; i++) {
        last = game.step(dt, input);
        playMs += STEP_MS;
        if (last.events.length) events = events.concat(last.events);
        if (last.phase !== 'running') break;
      }
      if (last.phase !== 'running') { const r = end(); return { events, phase: r.phase }; }
      if (!quiet) report(false);
      if (!quiet && playMs - stateAt >= STATE_EVERY_MS) { stateAt = playMs; feed.state({ mt: Math.round(t), sc: total }); }
      return { events, phase: 'running' };
    },

    render(alpha: number): void {
      if (started) game.render(alpha);
    },

    snapshot(): unknown {
      return started ? { scoreDuel: 1, matchId, durationMs, playMs, total, inner: game.snapshot() } : null;
    },

    restore(s: unknown): void {
      const snap = s as { scoreDuel?: number; matchId?: string; durationMs?: number; playMs?: number; total?: number; inner?: unknown } | null;
      if (!snap || snap.scoreDuel !== 1) return;
      game.restore(snap.inner);
      started = true;
      matchId = snap.matchId ?? '';
      durationMs = snap.durationMs ?? durationMs;
      playMs = snap.playMs ?? 0;
      total = snap.total ?? 0;
    },

    summary(): RunSummary {
      if (!started) return emptySummary();
      const s = game.summary();
      // a round cut at the end of the match lasted as long as the match
      return { ...s, score: done ? total : s.score, seconds: Math.min(s.seconds, Math.round(durationMs / 1000)) };
    },

    dispose(): void {
      game.dispose();
    },
  };
}

/** The same module, played as a score duel. */
export function scoreDuelModule(inner: GameModule, feed: DuelFeed): GameModule {
  return { manifest: inner.manifest, create: () => scoreDuelGame(inner.create(), feed) };
}
