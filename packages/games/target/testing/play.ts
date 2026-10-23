// Plays a whole round of an engine with bots: the virtual bodies steer toward what the game shows, the real handHit
// detector turns their pose frames into channels, and the engine steps once per 1/60 s. Test support only.
import type { BodyProfile, GameEvent, InputFrame } from '../../../core/types/index.ts';
import { rngStream } from '../../../core/loop/rng.ts';
import { TargetEngine, type EngineConfig } from '../engine.ts';
import type { BaseSpec, Level, Rules, ViewLane } from '../types.ts';
import { frame2, frameOf, VirtualBody, type Hand } from './body.ts';
import { Chaser, type BotMode, type Seen } from './bots.ts';

export interface SetupOptions {
  /** Whole run, seconds. */
  duration?: number;
  rounds?: number;
  restSec?: number;
  level?: Level;
  seed?: number;
  seated?: boolean;
  quiet?: boolean;
  bots?: BotMode | [BotMode, BotMode];
  hz?: number;
  feet?: boolean;
  /** No camera: the engine makes the hands from cursors and the bots are not used. */
  keyboard?: boolean;
  met?: number;
  profiles?: [BodyProfile?, BodyProfile?];
}

export interface Run<S extends BaseSpec> {
  engine: TargetEngine<S>;
  bodies: VirtualBody[];
  chasers: Chaser[];
  k: number;
  events: GameEvent[];
  /** Pose rate and clock offset of each body (the two players' clocks differ in the product too). */
  steer(lane: ViewLane, chaser: Chaser, body: VirtualBody): void;
}

/** What a Chaser sees of a target of any of the three games. */
export function seenOf(lane: ViewLane): Seen[] {
  return lane.targets.map((t) => {
    const s = t.spec as BaseSpec & { side?: Hand; hand?: Hand; trap?: boolean };
    return {
      id: t.id, x: t.x, y: t.y, age: t.age * s.life, life: s.life,
      ...((s.side ?? s.hand) ? { side: (s.side ?? s.hand) as Hand } : {}),
      ...(s.trap ? { avoid: true } : {}),
    };
  });
}

export function setup<S extends BaseSpec>(rules: Rules<S>, o: SetupOptions = {}): Run<S> {
  const cfg: EngineConfig = { durationSec: o.duration ?? 20, met: o.met ?? rules.met };
  if (o.rounds !== undefined) cfg.rounds = o.rounds;
  if (o.restSec !== undefined) cfg.restSec = o.restSec;
  const engine = new TargetEngine<S>(rules, cfg);
  const two = Array.isArray(o.bots);
  const modes: BotMode[] = Array.isArray(o.bots) ? o.bots : [o.bots ?? 'perfect'];
  const bodies = modes.map((_, i) => new VirtualBody({
    ...(o.profiles?.[i] ? { profile: o.profiles[i] as BodyProfile } : {}), ...(o.hz !== undefined ? { hz: o.hz } : {}),
    clockOffset: 50_000 + i * 777, feet: o.feet ?? false,
  }));
  const chasers = modes.map((m, i) => new Chaser(m, (o.seed ?? 1) + i));
  const profiles: [BodyProfile | null, (BodyProfile | null)?] = o.keyboard
    ? [null]
    : two ? [(bodies[0] as VirtualBody).profile, (bodies[1] as VirtualBody).profile] : [(bodies[0] as VirtualBody).profile];
  engine.start({ rng: rngStream(o.seed ?? 1, 'course'), level: o.level ?? 'normal', seated: o.seated ?? false, quiet: o.quiet ?? false, profiles });
  return { engine, bodies, chasers, k: 0, events: [], steer: (lane, chaser, body) => chaser.steer(body, seenOf(lane)) };
}

/** One step of the whole table: bots decide, bodies move, the engine steps. Returns what it returned. */
export function tick<S extends BaseSpec>(r: Run<S>, o: { keyboard?: boolean; tracked?: [boolean, boolean] } = {}): ReturnType<TargetEngine<S>['step']> {
  r.k++;
  const view = r.engine.view();
  const chans = r.bodies.map((b, i) => {
    const lane = view.lanes[i];
    const chaser = r.chasers[i];
    if (lane && chaser) r.steer(lane, chaser, b);
    return b.step(r.k);
  });
  const ok = o.tracked ?? [true, true];
  const input: InputFrame = r.bodies.length === 2
    ? frame2(r.k, chans[0] ?? {}, chans[1] ?? {}, { ok1: ok[0], ok2: ok[1] })
    : frameOf(r.k, chans[0] ?? {}, { ok: ok[0] });
  const out = r.engine.step(input);
  r.events.push(...out.events);
  return out;
}

/** Plays until the engine says it is over, or `max` steps. */
export function play<S extends BaseSpec>(r: Run<S>, max = 60 * 60 * 10): void {
  for (let i = 0; i < max && r.engine.phase === 'running'; i++) tick(r);
}

export const count = (events: readonly GameEvent[], type: string): number => events.filter((e) => e.type === type).length;
