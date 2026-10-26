// M13 movement energy (game-design.md 0.5; card 37 Freeze Dance, card 39 Arm Orchestra): how much the body is moving.
//
// energy = the mean speed, in torso lengths per second (T/s), of the thirteen joints (nose, shoulders, elbows, hand centres,
// hips, knees, ankles) over the last `windowMs` (300 ms); a joint's speed is its net displacement over that window. Joints
// of a part that is out of view are left out, so a seated player (hips down are not in view) is judged by what shows.
//   channels  energy (all seen joints), energy.upper (nose, shoulders, elbows, hands: the seated dance), energy.lower
//             (hips, knees, ankles), energy.avg (energy smoothed over about a second: a dance swings between 0.2 and 1.6
//             within one beat, so the dance level is read from this), energy.t (frame time), joints (how many joints were
//             counted), dance (0..1: where energy.avg is between the freeze threshold e0 and the dance threshold e1),
//             dancing (1 when energy.avg is at or over e1, with a little hysteresis), still (1 while frozen)
//   events    holdStart / holdEnd: frozen = the energy stays at or under e0 for `freezeMs` (500 ms); it ends over e0 x
//             `hyst`. value = the energy at holdStart, the time frozen in ms at holdEnd.
// e0 and e1 are NOT measured on people yet ("kayıtla belirlenecek", card 37); the defaults sit well above the jitter of the
// One Euro filtered landmarks and well below arm swinging (energy.test.ts asserts those margins on the rig), and the
// recording day must tune them. The game side is `FreezeRound`: the music stops, the player has `graceMs` to be at or under e0, and is caught moving
// above e0 x hyst until the round ends.
import type { DetectorFactory, Features, MovementEvent, Vec2 } from '../types/index.ts';
import { PersonGate, Track, Visibility, clamp, ev, len, withDefaults, type ExplainingDetector, type Miss } from './kit.ts';

export const ENERGY_DEFAULTS = {
  e0: 0.2,          // T/s: frozen at or under this (unmeasured; filtered standing still reads 0.01 to 0.03 on the rig)
  e1: 0.6,          // T/s: dancing at or over this, on the smoothed energy (unmeasured; arm swinging reads 0.6, a dance 1 to 1.5)
  smoothMs: 700,    // time constant of energy.avg, which `dance` and `dancing` read: one stroke of an oscillation dips to near 0
  windowMs: 300,    // M13
  freezeMs: 500,    // card 37: freeze within 0.5 s
  hyst: 1.4,        // a freeze lets go over e0 x this
  danceHyst: 0.8,   // dancing lets go under e1 x this
  graceMs: 250,
  lostMs: 600,
} as const;

type Group = 'head' | 'shoulders' | 'elbows' | 'hands' | 'hips' | 'knees' | 'ankles';
const UPPER: readonly Group[] = ['head', 'shoulders', 'elbows', 'hands'];
const LOWER: readonly Group[] = ['hips', 'knees', 'ankles'];

function jointsOf(f: Features, g: Group): Vec2[] {
  switch (g) {
    case 'head': return [f.head];
    case 'shoulders': return [...f.shoulders];
    case 'elbows': return [...f.elbow];
    case 'hands': return [...f.hand];
    case 'hips': return [...f.hips];
    case 'knees': return [...f.knee];
    case 'ankles': return [...f.ankle];
  }
}

export const createEnergyDetector: DetectorFactory = (_p, opts): ExplainingDetector => {
  const o = withDefaults(ENERGY_DEFAULTS, opts);
  const gate = new PersonGate(o.lostMs);
  const vis = new Visibility();
  const tracks: Record<Group, Track[]> = { head: [new Track(800)], shoulders: [new Track(800), new Track(800)], elbows: [new Track(800), new Track(800)], hands: [new Track(800), new Track(800)], hips: [new Track(800), new Track(800)], knees: [new Track(800), new Track(800)], ankles: [new Track(800), new Track(800)] };
  const GROUPS = Object.keys(tracks) as Group[];
  let ch: Record<string, number> = {};
  let energy = 0, avg = 0, avgT = -Infinity, nowT = 0, any = false;
  let dancing = false, frozen = false, stillSince: number | null = null, frozenSince = 0, frozenLastT = 0;

  function endFreeze(t: number, out: MovementEvent[]): void {
    if (frozen) out.push(ev('energy', 'holdEnd', t, { value: frozenLastT - frozenSince }));
    frozen = false; stillSince = null;
  }

  return {
    id: 'energy',
    push(f: Features): MovementEvent[] {
      const out: MovementEvent[] = [];
      const g = gate.step(f);
      vis.update(f);
      nowT = f.t;
      any = true;
      if (g === 'lost') { endFreeze(f.t, out); for (const k of GROUPS) for (const tr of tracks[k]) tr.clear(); ch = {}; energy = 0; avg = 0; avgT = -Infinity; dancing = false; return out; }
      if (g !== 'ok') return out;
      const speeds: Partial<Record<Group, number[]>> = {};
      for (const k of GROUPS) {
        const js = jointsOf(f, k);
        const seen = vis.seen(k, f.t, o.graceMs);
        const list: number[] = [];
        for (let i = 0; i < js.length; i++) {
          const tr = tracks[k][i] as Track;
          tr.push(f.t, js[i] as Vec2);
          if (seen) list.push(len(tr.velocity(o.windowMs)));
        }
        speeds[k] = list;
      }
      const mean = (groups: readonly Group[]): { m: number; n: number } => {
        let s = 0, n = 0;
        for (const k of groups) for (const v of speeds[k] ?? []) { s += v; n++; }
        return { m: n ? s / n : 0, n };
      };
      const all = mean(GROUPS), up = mean(UPPER), low = mean(LOWER);
      energy = all.m;
      avg = avgT === -Infinity ? energy : avg + (energy - avg) * (1 - Math.exp(-Math.max(f.t - avgT, 0) / o.smoothMs));
      avgT = f.t;
      dancing = avg >= o.e1 || (dancing && avg >= o.e1 * o.danceHyst);

      // frozen: at or under e0 for freezeMs; it lets go over e0 x hyst
      if (all.n === 0) { endFreeze(f.t, out); }
      else if (!frozen) {
        if (energy <= o.e0) {
          stillSince ??= f.t;
          if (f.t - stillSince >= o.freezeMs) { frozen = true; frozenSince = stillSince; frozenLastT = f.t; out.push(ev('energy', 'holdStart', f.t, { value: energy })); }
        } else stillSince = null;
      } else if (energy > o.e0 * o.hyst) endFreeze(f.t, out);
      else frozenLastT = f.t;

      ch = {
        energy, 'energy.upper': up.m, 'energy.lower': low.m, 'energy.avg': avg, 'energy.t': f.t, joints: all.n,
        dance: clamp((avg - o.e0) / (o.e1 - o.e0), 0, 1), dancing: dancing ? 1 : 0, still: frozen ? 1 : 0,
      };
      return out;
    },
    value: () => (any && Object.keys(ch).length ? energy : undefined),
    channels: () => ch,
    explain(): Miss | null {
      if (!any) return null;
      if (vis.unseenFor('shoulders', nowT) > 500 || vis.unseenFor('hips', nowT) > 500) return { code: 'person_out' };
      return null;
    },
    reset() {
      gate.reset(); vis.reset(); for (const k of GROUPS) for (const tr of tracks[k]) tr.clear();
      ch = {}; energy = 0; avg = 0; avgT = -Infinity; nowT = 0; any = false; dancing = false; frozen = false; stillSince = null; frozenSince = 0; frozenLastT = 0;
    },
  } satisfies ExplainingDetector;
};

// ───────── the game's side: a freeze round ─────────

export interface FreezeRoundOptions {
  /** Pose-clock time the music stops. */
  stopAt: number;
  /** Pose-clock time the music starts again: the freeze must hold until then (omit to judge only the first half second). */
  endAt?: number;
  /** Default e0. */
  e0?: number;
  /** Time to freeze after the music stops (default 500 ms, card 37). */
  graceMs?: number;
  /** Default 1.4: moving is energy over e0 x this. */
  hyst?: number;
  /** Which energy channel to read: 'energy' (default), 'energy.upper' for the seated dance. */
  channel?: 'energy' | 'energy.upper' | 'energy.lower';
}

export interface FreezeResult {
  /** The player got to e0 or under within the grace time. */
  frozen: boolean;
  /** Time from the music stopping to the first frame at or under e0 (ms), or null. */
  freezeMs: number | null;
  /** The first frame of moving after the grace time (the player is out), or null. */
  caughtAt: number | null;
  /** The lowest energy within the grace time and the highest after it. */
  lowest: number;
  highest: number;
  /** Frozen and not caught: the round is won. */
  passed: boolean;
}

export class FreezeRound {
  private readonly o: Required<Omit<FreezeRoundOptions, 'endAt'>> & { endAt: number };
  private lastT = -Infinity;
  private freezeMs: number | null = null;
  private caughtAt: number | null = null;
  private lowest = Infinity;
  private highest = 0;
  private frames = 0;

  constructor(o: FreezeRoundOptions) {
    this.o = { stopAt: o.stopAt, endAt: o.endAt ?? o.stopAt + (o.graceMs ?? ENERGY_DEFAULTS.freezeMs), e0: o.e0 ?? ENERGY_DEFAULTS.e0, graceMs: o.graceMs ?? ENERGY_DEFAULTS.freezeMs, hyst: o.hyst ?? ENERGY_DEFAULTS.hyst, channel: o.channel ?? 'energy' };
  }

  update(ch: Readonly<Record<string, number>>): void {
    const t = ch['energy.t'], e = ch[this.o.channel];
    if (t === undefined || e === undefined || t === this.lastT) return;
    this.lastT = t;
    if (t < this.o.stopAt || t > this.o.endAt) return;
    this.frames++;
    const since = t - this.o.stopAt;
    if (since <= this.o.graceMs) {
      this.lowest = Math.min(this.lowest, e);
      if (this.freezeMs === null && e <= this.o.e0) this.freezeMs = since;
    } else {
      this.highest = Math.max(this.highest, e);
      if (this.caughtAt === null && e > this.o.e0 * this.o.hyst) this.caughtAt = t;
    }
  }

  result(): FreezeResult {
    const frozen = this.freezeMs !== null;
    return { frozen, freezeMs: this.freezeMs, caughtAt: this.caughtAt, lowest: Number.isFinite(this.lowest) ? this.lowest : 0, highest: this.highest, passed: frozen && this.caughtAt === null && this.frames > 0 };
  }

  /** Why the round was lost: hold_still with the energy reached and the threshold. */
  explain(): Miss | null {
    const r = this.result();
    if (this.frames === 0 || r.passed) return null;
    if (!r.frozen) return { code: 'hold_still', got: r.lowest, need: this.o.e0 };
    return { code: 'hold_still', got: r.highest, need: this.o.e0 * this.o.hyst };
  }

  reset(): void { this.lastT = -Infinity; this.freezeMs = null; this.caughtAt = null; this.lowest = Infinity; this.highest = 0; this.frames = 0; }
}
