// Labels of the synthetic clips, measured on the true 3D joints of every rendered frame with the definitions of the movement
// library (game-design.md 0.5; the header of each detector in packages/core/moves). A label is placed at the moment the
// definition of the movement is met, so a detector's event comes at the label time plus its own delay (scoreEvents in
// replay.ts looks for the label before the event). Nothing here looks at what the pose model found.
//
// Units and signs follow the movement library: lengths in torso lengths T and shoulder widths W, angles in degrees,
// positive toward the player's RIGHT (seen in the mirror). The rig's world has the person's left on +X, so the right is -X.
import type { TraceLabel } from '../../packages/core/types/index.ts';
import type { TruthJoint, TruthPerson } from './render.page.ts';
import type { Clip } from './moves.ts';

export interface Dims { T: number; W: number; A: number; U: number; restHipY: number; restHipX: number }
export interface TruthFrame { /** ms from the first frame */ t: number; people: TruthPerson[] }

type J = TruthJoint;
const at = (p: TruthPerson, n: keyof TruthPerson): J => {
  const j = p[n];
  if (!j) throw new Error(`no truth for ${String(n)}`);
  return j;
};
const mid = (a: J, b: J): { x: number; y: number } => ({ x: (a.wx + b.wx) / 2, y: (a.wy + b.wy) / 2 });
const hipMid = (p: TruthPerson): { x: number; y: number } => mid(at(p, 'upLegL'), at(p, 'upLegR'));
const shoulderMid = (p: TruthPerson): { x: number; y: number } => mid(at(p, 'armL'), at(p, 'armR'));

/** Times (ms) at which a series crosses `level` going up (or down), interpolated between frames. */
export function crossings(t: readonly number[], v: readonly number[], level: number, dir: 'up' | 'down'): number[] {
  const out: number[] = [];
  for (let i = 1; i < v.length; i++) {
    const a = v[i - 1] as number;
    const b = v[i] as number;
    const hit = dir === 'up' ? a < level && b >= level : a >= level && b < level;
    if (hit) out.push((t[i - 1] as number) + (((level - a) / (b - a)) * ((t[i] as number) - (t[i - 1] as number))));
  }
  return out;
}

/**
 * Local maxima of a series that reach `min`, as [time, value]: a maximum counts once the series has fallen `drop` below it (or
 * under `min`), and the next one only after the series has been under `min` again, so the slope down is not a peak of its own.
 */
export function peaks(t: readonly number[], v: readonly number[], min: number, drop: number): [number, number][] {
  const out: [number, number][] = [];
  let best = -Infinity;
  let bestT = 0;
  let armed = true;
  for (let i = 0; i < v.length; i++) {
    const x = v[i] as number;
    if (x < min) {
      if (armed && best >= min) out.push([bestT, best]);
      armed = true;
      best = -Infinity;
      continue;
    }
    if (!armed) continue;
    if (x > best) { best = x; bestT = t[i] as number; }
    else if (x < best - drop) { out.push([bestT, best]); armed = false; best = -Infinity; }
  }
  if (armed && best >= min) out.push([bestT, best]);
  return out;
}

const round = (x: number): number => Math.round(x * 10) / 10;
const label = (t: number, id: TraceLabel['id'], kind: TraceLabel['kind'], extra: Partial<TraceLabel> = {}): TraceLabel => ({ t: round(t), id, kind, ...extra });

function squatLabels(f: TruthFrame[], d: Dims, who: number, note?: string): TraceLabel[] {
  const t = f.map((x) => x.t);
  const drop = f.map((x) => (d.restHipY - hipMid(x.people[who] as TruthPerson).y) / d.T);
  const out: TraceLabel[] = [];
  // down at 0.35 T, counted when it comes back under 0.12 T (squat.ts)
  let down = false;
  for (let i = 0; i < drop.length; i++) {
    const v = drop[i] as number;
    if (!down && v >= 0.35) down = true;
    else if (down && v < 0.12) {
      const x = (t[i - 1] as number) + (((0.12 - (drop[i - 1] as number)) / (v - (drop[i - 1] as number))) * ((t[i] as number) - (t[i - 1] as number)));
      out.push(label(x, 'squat', 'rep', note ? { note } : {}));
      down = false;
    }
  }
  return out;
}

function jumpLabels(f: TruthFrame[], d: Dims): TraceLabel[] {
  const t = f.map((x) => x.t);
  const p = f.map((x) => x.people[0] as TruthPerson);
  const rise = p.map((q) => (hipMid(q).y - d.restHipY) / d.T);
  const crouch = p.map((q) => Math.max(0, (d.restHipY - hipMid(q).y) / d.T) / 0.55);
  // The hips rise more than 0.20 T above rest while not crouching (jump.ts); one jump per rise.
  return crossings(t, rise, 0.2, 'up').filter((x) => {
    const i = t.findIndex((v) => v >= x);
    return (crouch[Math.max(0, i)] as number) < 0.35;
  }).map((x) => label(x, 'jump', 'rep'));
}

function jackLabels(f: TruthFrame[], d: Dims): TraceLabel[] {
  const out: TraceLabel[] = [];
  let closed = false;
  for (const fr of f) {
    const p = fr.people[0] as TruthPerson;
    const nose = at(p, 'noseTip').wy;
    const sh = shoulderMid(p).y;
    const gap = Math.abs(at(p, 'footL').wx - at(p, 'footR').wx) / d.W;
    const handsUp = Math.min(at(p, 'handL').wy, at(p, 'handR').wy) >= nose;
    const handsDown = Math.max(at(p, 'handL').wy, at(p, 'handR').wy) <= sh - 0.3 * d.T;
    const open = handsUp && gap >= 1.5;
    const shut = handsDown && gap <= 1.1;
    if (shut) closed = true;
    else if (open && closed) { out.push(label(fr.t, 'jumpingJack', 'rep')); closed = false; }
  }
  return out;
}

function marchLabels(f: TruthFrame[], d: Dims): TraceLabel[] {
  const t = f.map((x) => x.t);
  const out: TraceLabel[] = [];
  for (const side of ['L', 'R'] as const) {
    // k = 0 where the knee stands at rest, 1 with the knee at hip height (kneeLift.ts): k = (knee height above the rest hip + U) / U.
    const k = f.map((x) => (at(x.people[0] as TruthPerson, side === 'L' ? 'lowLegL' : 'lowLegR').wy - d.restHipY + d.U) / d.U);
    for (const [time, peak] of peaks(t, k, 0.5, 0.08)) out.push(label(time, 'kneeLift', 'rep', { side, note: `k ${peak.toFixed(2)}` }));
  }
  return out.sort((a, b) => a.t - b.t);
}

function leanLabels(f: TruthFrame[], d: Dims): TraceLabel[] {
  const t = f.map((x) => x.t);
  const lean = f.map((x) => { const p = x.people[0] as TruthPerson; return (hipMid(p).x - shoulderMid(p).x) / d.W; });
  const out: TraceLabel[] = [];
  // From the centre, beyond 0.30 W enters that side's lane; back under 0.16 W leaves it (lean.ts).
  for (const [sign, side] of [[1, 'R'], [-1, 'L']] as const) {
    const v = lean.map((x) => x * sign);
    const ins = crossings(t, v, 0.3, 'up');
    const outs = crossings(t, v, 0.16, 'down');
    for (const x of ins) out.push(label(x, 'lean', 'holdStart', { side }));
    for (const x of outs) if (ins.some((i) => i < x)) out.push(label(x, 'lean', 'holdEnd', { side }));
  }
  return out.sort((a, b) => a.t - b.t);
}

function twistLabels(f: TruthFrame[], d: Dims): TraceLabel[] {
  const out: TraceLabel[] = [];
  let lastSide = 0;
  let lastT = -Infinity;
  for (const fr of f) {
    const p = fr.people[0] as TruthPerson;
    const hm = mid(at(p, 'handL'), at(p, 'handR'));
    const tau = (hipMid(p).x - hm.x) / d.W;
    const span = Math.abs(at(p, 'armL').wx - at(p, 'armR').wx) / d.W;
    const apart = Math.abs(at(p, 'handL').wx - at(p, 'handR').wx) / d.W;
    if (apart > 0.5 || Math.abs(tau) < 0.6 || span >= 0.9) continue;
    const side = tau > 0 ? 1 : -1;
    // A rep: twisted to one side after having been twisted to the other, 400 to 2500 ms after the last frame there (twist.ts).
    if (lastSide !== 0 && side !== lastSide && fr.t - lastT >= 400 && fr.t - lastT <= 2500) out.push(label(fr.t, 'twist', 'rep', { side: side > 0 ? 'R' : 'L' }));
    if (side !== lastSide || fr.t - lastT > 0) { lastSide = side; lastT = fr.t; }
  }
  return out;
}

function bendLabels(f: TruthFrame[]): TraceLabel[] {
  const t = f.map((x) => x.t);
  const theta = f.map((x) => { const p = x.people[0] as TruthPerson; const h = hipMid(p); const s = shoulderMid(p); return (Math.atan2(h.x - s.x, s.y - h.y) * 180) / Math.PI; });
  const out: TraceLabel[] = [];
  // A hold: at least 10 degrees, steady within 4 degrees for 300 ms (sideBend.ts); the event comes when the hold is 300 ms old.
  let holding = 0;
  let start = -1;
  for (let i = 0; i < theta.length; i++) {
    const side = (theta[i] as number) >= 10 ? 1 : (theta[i] as number) <= -10 ? -1 : 0;
    if (side === 0) { if (holding !== 0) out.push(label(t[i] as number, 'sideBend', 'holdEnd', { side: holding > 0 ? 'R' : 'L' })); holding = 0; start = -1; continue; }
    if (holding !== side) { holding = 0; }
    if (holding === 0) {
      // steady for 300 ms ending here?
      let j = i;
      while (j > 0 && (t[i] as number) - (t[j - 1] as number) <= 300) j--;
      const win = theta.slice(j, i + 1) as number[];
      if ((t[i] as number) - (t[j] as number) >= 290 && Math.max(...win) - Math.min(...win) <= 4 && win.every((x) => (side > 0 ? x >= 10 : x <= -10))) {
        holding = side; start = t[i] as number;
        out.push(label(start, 'sideBend', 'holdStart', { side: side > 0 ? 'R' : 'L' }));
      }
    }
  }
  return out;
}

function pressLabels(f: TruthFrame[], d: Dims): TraceLabel[] {
  const out: TraceLabel[] = [];
  let armed = false;
  const angle = (a: J, b: J, c: J): number => {
    const v1 = [a.wx - b.wx, a.wy - b.wy, a.wz - b.wz];
    const v2 = [c.wx - b.wx, c.wy - b.wy, c.wz - b.wz];
    const dot = (v1[0] as number) * (v2[0] as number) + (v1[1] as number) * (v2[1] as number) + (v1[2] as number) * (v2[2] as number);
    const n = Math.hypot(...(v1 as [number, number, number])) * Math.hypot(...(v2 as [number, number, number]));
    return (Math.acos(Math.max(-1, Math.min(1, dot / n))) * 180) / Math.PI;
  };
  for (const fr of f) {
    const p = fr.people[0] as TruthPerson;
    const sh = shoulderMid(p).y;
    const lower = Math.min(at(p, 'handL').wy, at(p, 'handR').wy);
    const higher = Math.max(at(p, 'handL').wy, at(p, 'handR').wy);
    const rack = Math.abs(lower - sh) <= 0.25 * d.A && Math.abs(higher - sh) <= 0.25 * d.A;
    const elbow = Math.min(angle(at(p, 'armL'), at(p, 'foreL'), at(p, 'handL')), angle(at(p, 'armR'), at(p, 'foreR'), at(p, 'handR')));
    const lockout = (lower - sh) / d.A >= 0.85 && elbow >= 150;
    if (rack) armed = true;
    else if (lockout && armed) { out.push(label(fr.t, 'overheadPress', 'rep')); armed = false; }
  }
  return out;
}

/** The labels of a clip, from its true joints (ms, in trace time). */
export function labelsFor(clip: Clip, f: TruthFrame[], dims: Dims[], _fps: number): TraceLabel[] {
  const d = dims[0] as Dims;
  switch (clip.rule) {
    case 'still': return [label(0, 'still', 'marker', { note: 'standing still: no movement event may come' })];
    case 'shallow': return [label(0, 'still', 'marker', { note: 'dips of 0.2 T stay under the 0.35 T of a squat: no rep may come' })];
    case 'squat': return squatLabels(f, d, 0);
    case 'jump': return jumpLabels(f, d);
    case 'jack': return jackLabels(f, d);
    case 'march': return marchLabels(f, d);
    case 'lean': return leanLabels(f, d);
    case 'twist': return twistLabels(f, d);
    case 'bend': return bendLabels(f);
    case 'press': return pressLabels(f, d);
    case 'pair': return [...squatLabels(f, dims[0] as Dims, 0, 'person on the left of the camera picture'), ...squatLabels(f, dims[1] as Dims, 1, 'person on the right of the camera picture')].sort((a, b) => a.t - b.t);
  }
}
