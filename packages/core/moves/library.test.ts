// The movement library as a whole (game-design.md 0.5, M1..M16): every id has a factory in the registry, every detector keeps
// to the Detector contract, survives frames that say nothing, never publishes a number that is not finite, shares no state
// between instances and repeats itself exactly after a reset.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Detector, DetectorSpec, Features, MovementEvent, MovementId } from '../types/index.ts';
import { parseTrace, traceFrames } from '../pose/trace.ts';
import { DETECTORS } from './index.ts';
import { MISS_CODES, canExplain } from './kit.ts';
import { ALL_DETECTORS } from './library.ts';
import { replay } from './replay.ts';
import { feed } from './testing/harness.ts';
import { simulate, type FigureSpec, type Motion } from './testing/rig.ts';

const ALL_IDS: readonly MovementId[] = [
  'squat', 'jump', 'lean', 'kneeLift', 'jumpingJack', 'handHit', 'swipe', 'twist', 'sideBend', 'pull', 'overheadPress', 'poseMatch', 'energy', 'steadiness', 'sideLine', 'armDirection',
];
const KINDS = new Set(['rep', 'hit', 'holdStart', 'holdEnd', 'value']);

/** Options that switch on the variants a game can ask for, so that every code path sees frames. */
const SPECS: readonly DetectorSpec[] = [
  { id: 'squat' }, { id: 'squat', opts: { flap: 1 } }, { id: 'jump' }, { id: 'lean' }, { id: 'kneeLift' }, { id: 'jumpingJack' }, { id: 'jumpingJack', opts: { armsOnly: 1 } },
  { id: 'handHit', opts: { feet: 1 } }, { id: 'swipe', opts: { saber: 1 } }, { id: 'twist', opts: { holdMs: 500 } }, { id: 'sideBend' }, { id: 'pull' }, { id: 'overheadPress' },
  { id: 'poseMatch', opts: { pose: 0 } }, { id: 'energy' }, { id: 'steadiness', opts: { stance: 1 } }, { id: 'sideLine' }, { id: 'sideLine', opts: { plank: 1 } },
  { id: 'armDirection', opts: { holds: 1, flap: 1 } },
];

/** A body that does a bit of everything: sways, squats, bends, turns, swings both arms and lifts the knees. */
const busy: Motion = (t) => {
  const s = (hz: number, ph = 0): number => Math.sin((2 * Math.PI * hz * t) / 1000 + ph);
  const spec: FigureSpec = {
    dx: 0.12 * s(0.4), drop: 0.35 * (1 + s(0.3)), bend: 18 * s(0.5), twist: 25 * s(0.7), rise: 0.1 * Math.max(0, s(0.9)),
    armL: { a: 100 + 80 * s(0.8), f: 100 + 80 * s(0.8, 1) }, armR: { a: 100 + 80 * s(0.6, 2), f: 100 + 80 * s(0.6, 3) },
    legL: { k: 0.5 * (1 + s(0.5)), out: 0.2 * (1 + s(0.4)) }, legR: { k: 0.5 * (1 + s(0.5, Math.PI)), out: 0.2 * (1 + s(0.4, 1)) },
  };
  return spec;
};

const sim = simulate(busy, { durationMs: 14000, noise: 0.002, seed: 11 });

function build(spec: DetectorSpec): Detector {
  const make = ALL_DETECTORS[spec.id];
  if (!make) throw new Error(`no factory for ${spec.id}`);
  return make(sim.profile, spec.opts);
}

const allFinite = (ch: Readonly<Record<string, number>>): boolean => Object.values(ch).every((v) => Number.isFinite(v));
const wellFormed = (e: MovementEvent, id: MovementId): boolean => e.id === id && KINDS.has(e.kind) && Number.isFinite(e.t) && (e.value === undefined || Number.isFinite(e.value)) && (e.q === undefined || Object.values(e.q).every((v) => v === undefined || Number.isFinite(v)));

describe('the registry', () => {
  it('has a factory for each of the sixteen movements, and the runner registry (index.ts) serves them all', () => {
    for (const id of ALL_IDS) {
      expect(typeof ALL_DETECTORS[id], id).toBe('function');
      expect(typeof DETECTORS[id], id).toBe('function');
    }
    expect(Object.keys(ALL_DETECTORS).sort()).toEqual([...ALL_IDS].sort());
  });

  it('builds detectors whose id is the one asked for', () => {
    for (const spec of SPECS) expect(build(spec).id, `${spec.id} ${JSON.stringify(spec.opts ?? {})}`).toBe(spec.id);
  });
});

describe.each(SPECS.map((s) => [`${s.id} ${JSON.stringify(s.opts ?? {})}`, s] as const))('%s', (_name, spec) => {
  it('takes a long busy session without throwing, publishes only finite numbers and well-formed events', () => {
    const d = build(spec);
    const r = feed(d, sim.features);
    expect(r.samples).toHaveLength(sim.features.length);
    for (const s of r.samples) {
      expect(allFinite(s.ch)).toBe(true);
      expect(s.value === undefined || Number.isFinite(s.value)).toBe(true);
    }
    for (const e of r.events) expect(wellFormed(e, spec.id)).toBe(true);
  });

  it('survives frames that say nothing: nobody in view, parts out of view, a pose frame with no landmarks', () => {
    const d = build(spec);
    const base = sim.features[200] as Features;
    const seenNone = { head: false, shoulders: false, elbows: false, hands: false, hips: false, knees: false, ankles: false, feet: false };
    const frames: Features[] = [];
    let t = 0;
    for (let i = 0; i < 30; i++) frames.push({ ...base, t: (t += 33), ok: true });
    for (let i = 0; i < 40; i++) frames.push({ ...base, t: (t += 33), ok: false, seen: seenNone });
    for (let i = 0; i < 30; i++) frames.push({ ...base, t: (t += 33), ok: true, seen: { ...seenNone, shoulders: true, hips: true } });
    for (let i = 0; i < 30; i++) frames.push({ ...base, t: (t += 33), ok: true });
    const r = feed(d, frames);
    for (const s of r.samples) expect(allFinite(s.ch)).toBe(true);
    for (const e of r.events) expect(wellFormed(e, spec.id)).toBe(true);
  });

  it('shares no state between instances: a detector built after another has run behaves like the first one did', () => {
    const a = build(spec), b = build(spec);
    feed(a, sim.features);
    const head = sim.features.slice(0, 60);
    const used = feed(b, head), fresh = feed(build(spec), head);
    expect(used.events).toEqual(fresh.events);
    expect(used.samples.map((s) => s.ch)).toEqual(fresh.samples.map((s) => s.ch));
  });

  it('repeats itself exactly after a reset (same events, same channels, same value)', () => {
    const d = build(spec);
    const first = feed(d, sim.features);
    d.reset();
    const second = feed(d, sim.features);
    expect(second.events).toEqual(first.events);
    expect(second.samples.map((s) => s.ch)).toEqual(first.samples.map((s) => s.ch));
    expect(second.samples.map((s) => s.value)).toEqual(first.samples.map((s) => s.value));
    const fresh = feed(build(spec), sim.features);
    expect(fresh.events).toEqual(first.events);
  });

  it('is not sensitive to the pose rate: the same session at 10 Hz gives well-formed output too', () => {
    const slow = simulate(busy, { durationMs: 14000, noise: 0.002, seed: 11, fps: 10 });
    const d = build(spec);
    const r = feed(d, slow.features);
    for (const s of r.samples) expect(allFinite(s.ch)).toBe(true);
    for (const e of r.events) expect(wellFormed(e, spec.id)).toBe(true);
  });
});

describe('the reasons a detector can give', () => {
  it('lists every miss code once, in snake_case words the interface text can key on', () => {
    expect(new Set(MISS_CODES).size).toBe(MISS_CODES.length);
    for (const c of MISS_CODES) expect(c).toMatch(/^[a-z]+(_[a-z]+)*$/);
    expect(MISS_CODES.length).toBeGreaterThanOrEqual(40);
  });

  it('every explanation the library produced in these sessions uses a listed code', () => {
    const known = new Set<string>(MISS_CODES);
    for (const spec of SPECS) {
      const d = build(spec);
      for (const f of sim.features) { d.push(f); if (canExplain(d)) { const m = d.explain(); if (m) expect(known.has(m.code), `${spec.id}: ${m.code}`).toBe(true); } }
    }
  });
});

describe('a real person (recorded video, tests/traces/video)', () => {
  const real = (name: string) => parseTrace(JSON.parse(readFileSync(new URL(`../../../tests/traces/video/${name}.trace.json`, import.meta.url), 'utf8')));

  it.each([30, 10])('standing still for twelve seconds (U.S. Army clip) at %i Hz sets off nothing but the freeze and the arms-down pointing hold', (hz) => {
    const r = replay(traceFrames(real('army-standing-12s'), { hz }), { registry: ALL_DETECTORS, detectors: SPECS.filter((s) => s.id !== 'sideLine') });
    expect(r.calibratedAt).not.toBeNull();
    const seen = new Set(r.events.map((e) => `${e.id}.${e.kind}`));
    expect([...seen].sort()).toEqual(['armDirection.holdStart', 'energy.holdStart']);
    const after = r.samples.filter((s) => s.t > (r.calibratedAt as number) + 500);
    expect(Math.max(...after.map((s) => s.channels.energy ?? 0))).toBeLessThan(0.05);      // the rig reads 0.01 to 0.03: a real person is as still as the model of one
    expect(Math.max(...after.map((s) => s.channels.sway ?? 0))).toBeLessThan(0.05);
    expect(Math.max(...after.map((s) => Math.abs(s.channels.bend ?? 0)))).toBeLessThan(3);
    expect(Math.max(...after.map((s) => s.channels.kneeMax ?? 0))).toBeLessThan(0.2);
    expect(Math.max(...after.map((s) => s.channels['swipe.R.speed'] ?? 0))).toBeLessThan(0.5);
    expect(Math.max(...after.map((s) => s.channels['hand.R.speed'] ?? 0))).toBeLessThan(0.5);
  });

  it.each([30, 10])('jumping jacks and burpees at %i Hz: the three jacks after calibration are three reps, the burpees none', (hz) => {
    const r = replay(traceFrames(real('jacks-burpees-21s'), { hz }), { calibration: { holdSeconds: 0.5 }, registry: ALL_DETECTORS, detectors: [{ id: 'jumpingJack' }] });
    expect(r.calibratedAt).not.toBeNull();
    const reps = r.events.filter((e) => e.kind === 'rep').map((e) => e.t);
    // an independent count of "both hands above the nose" in the raw landmarks finds the jacks at 11.1, 11.9 and 12.7 s (the first three, before 2.1 s, come before the calibration)
    expect(reps).toHaveLength(3);
    expect(reps[0]!).toBeGreaterThan(10800);
    expect(reps[2]!).toBeLessThan(13500);
  });
});
