// A short round of a game: the game itself, played for its first seconds only. The desk break plays four seated games for 45 seconds
// each (about four minutes in all), and a family evening plays three games for a minute each, so neither asks for the full length
// of a round (three to seven minutes) of every game in it.
//
// The game is not changed: it starts, plays and draws as always, and the wrapper only ends the round when its time is up (the step
// that reaches the time says 'complete'). The timer on the HUD is the short round's own: what the game writes there (its own length,
// a set and its rest) would say three minutes are left of a round that ends in forty seconds. The summary is the game's, with the
// seconds and the moving time (MET seconds) cut to the time that was played.
import { FIXED_DT, type Game, type GameContext, type GameModule, type Hud, type InputFrame, type RunSummary, type StartOptions, type StepResult } from '../../../core/types/index.ts';

/** The shortest and the longest short round a plan or a family evening may ask for, in seconds. */
export const SHORT_MIN_SEC = 15;
export const SHORT_MAX_SEC = 300;

/** A length that may be played as a short round, or null (no number, out of range: the game's own length is played). */
export function shortSeconds(x: unknown): number | null {
  if (typeof x !== 'number' || !Number.isFinite(x)) return null;
  const s = Math.round(x);
  return s >= SHORT_MIN_SEC && s <= SHORT_MAX_SEC ? s : null;
}

/** The record of a short round is kept apart from the full rounds of the same game: its bests are not the full round's. */
export const SHORT_VARIANT = 'short';

/** The HUD the game writes to in a short round: the timer slot belongs to the short round, whatever the game counts. */
function shortHud(hud: Hud): Hud {
  const set: Hud['set'] = (slot, v) => { if (slot !== 'timer') hud.set(slot, v); };
  return new Proxy(hud, {
    get(target, prop) {
      if (prop === 'set') return set;
      const v = Reflect.get(target, prop, target) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}

export function shortGame(game: Game, seconds: number): Game {
  const limitMs = Math.max(1, Math.round(seconds * 1000));
  let ctx: GameContext | null = null;
  let playedMs = 0;
  let done = false;
  let shown = -1;

  const showTimer = (): void => {
    const left = Math.max(0, Math.ceil((limitMs - playedMs) / 1000));
    if (left !== shown && ctx) { shown = left; ctx.hud.set('timer', left); }
  };

  const short: Game = {
    get manifest() { return game.manifest; },

    async init(c: GameContext): Promise<void> {
      ctx = c;
      await game.init({ ...c, hud: shortHud(c.hud) });
    },

    start(o: StartOptions): void {
      playedMs = 0;
      done = false;
      shown = -1;
      game.start(o);
      showTimer();
    },

    step(dt: number, input: InputFrame): StepResult {
      if (done) return { events: [], phase: 'complete' };
      const r = game.step(dt, input);
      playedMs += (Number.isFinite(dt) && dt > 0 ? dt : FIXED_DT) * 1000;
      showTimer();
      if (r.phase !== 'running') { done = true; return r; }
      if (playedMs >= limitMs - 0.5) { done = true; return { events: r.events, phase: 'complete' }; }
      return r;
    },

    render: (alpha) => game.render(alpha),
    snapshot: () => ({ short: 1, playedMs, done, inner: game.snapshot() }),

    restore(s: unknown): void {
      const snap = s as { short?: number; playedMs?: number; done?: boolean; inner?: unknown } | null;
      if (!snap || snap.short !== 1) { game.restore(s); return; }
      game.restore(snap.inner);
      playedMs = typeof snap.playedMs === 'number' ? snap.playedMs : 0;
      done = snap.done === true;
      shown = -1;
    },

    summary(): RunSummary {
      const s = game.summary();
      const played = Math.round(playedMs / 1000);
      const seconds = Math.min(Number.isFinite(s.seconds) ? s.seconds : played, played);
      // the time moving can be no more than the time played, at the game's own MET
      const met = Number.isFinite(game.manifest.met) && game.manifest.met > 0 ? game.manifest.met : 0;
      const metSeconds = met > 0 ? Math.min(s.metSeconds, met * seconds) : s.metSeconds;
      return { ...s, seconds, metSeconds };
    },

    dispose: () => game.dispose(),
  };
  // tools and tests that look into a game's simulation (game.sim: the bots, the fake camera) see the wrapped game's
  Object.defineProperty(short, 'sim', { get: () => (game as unknown as { sim?: unknown }).sim, enumerable: false });
  return short;
}

/** The game's module, played as a short round of `seconds`; the manifest says the short length, so the session and the page know it. */
export function shortModule(m: GameModule, seconds: number): GameModule {
  const manifest = { ...m.manifest, durationSec: seconds };
  return {
    ...m,
    manifest,
    create: () => shortGame(m.create(), seconds),
  };
}
