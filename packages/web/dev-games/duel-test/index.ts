// A game that exists only in test builds (packages/web/dev-games is never part of a published build): it keeps the three
// promises of a game that can be raced (see app/duel.ts) so the shell's race flow can be tested end to end with a real
// Room, without waiting for a real game to support it. What the player "does" with each obstacle is the test's choice:
// window.__BA_TEST__.skill is the share of obstacles that are passed (1: all, 0: none).
import { FIXED_DT, type Game, type GameContext, type GameEvent, type GameManifest, type GameModule, type InputFrame, type RunSummary, type StartOptions, type StepResult } from '../../../core/types/index.ts';
import { makeSchedule, specFor, type Obstacle } from '../../../core/net/schedule.ts';
import manifestJson from './manifest.json' with { type: 'json' };

export const manifest = manifestJson as unknown as GameManifest;

const skill = (): number => {
  const t = (globalThis as { __BA_TEST__?: { skill?: number } }).__BA_TEST__;
  return typeof t?.skill === 'number' ? Math.max(0, Math.min(1, t.skill)) : 1;
};

function create(): Game {
  let ctx: GameContext | null = null;
  let schedule: Obstacle[] = [];
  let durationMs = 0;
  let ms = 0;
  const done = new Map<number, 'pass' | 'hit'>();
  let score = 0;
  let shown = -1;

  return {
    manifest,
    async init(c: GameContext): Promise<void> { ctx = c; },
    start(o: StartOptions): void {
      durationMs = o.duel?.durationMs ?? manifest.durationSec * 1000;
      schedule = o.duel ? [...o.duel.schedule] : makeSchedule(o.seed, durationMs, specFor(manifest.id));
      ms = 0;
      done.clear();
      score = 0;
      shown = -1;
    },
    step(_dt: number, _input: InputFrame): StepResult {
      ms += FIXED_DT * 1000;
      const events: GameEvent[] = [];
      for (const ob of schedule) {
        if (ob.t > ms || done.has(ob.id)) continue;
        // a share of the obstacles, by their order, so the same skill always gives the same result
        const k = (ob.id * 0.6180339887) % 1 < skill() ? 'pass' : 'hit';
        done.set(ob.id, k);
        if (k === 'pass') score += 10;
        events.push({ type: 'duel', t: ms, ob: ob.id, k });
      }
      return { events, phase: ms >= durationMs ? 'complete' : 'running' };
    },
    render(): void {
      if (!ctx) return;
      const left = Math.max(0, Math.ceil((durationMs - ms) / 1000));
      ctx.hud.set('timer', left);
      if (score !== shown) { shown = score; ctx.hud.set('score', score); }
      const g = ctx.scene2d?.ctx;
      if (g) {
        g.fillStyle = '#1A1430';
        g.fillRect(0, 0, 4000, 4000);
        g.fillStyle = '#FF4F6E';
        g.beginPath();
        g.arc(200 + ((ms / 10) % 300), 300, 24, 0, Math.PI * 2);
        g.fill();
      }
    },
    snapshot: () => ({ ms, score, done: [...done] }),
    restore(s: unknown): void {
      const x = s as { ms: number; score: number; done: [number, 'pass' | 'hit'][] };
      ms = x.ms; score = x.score; done.clear();
      for (const [k, v] of x.done) done.set(k, v);
    },
    summary(): RunSummary {
      return { score, seconds: ms / 1000, metSeconds: (ms / 1000) * manifest.met, log: [...done].map(([ob, k]) => ({ t: ob, kind: 'obstacle', ok: k === 'pass' })) };
    },
    dispose(): void { ctx = null; },
  };
}

const module: GameModule = { manifest, create };
export default module;
