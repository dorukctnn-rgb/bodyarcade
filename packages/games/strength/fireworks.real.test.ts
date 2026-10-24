// Firework Jacks with a real person. The clip is a man doing jumping jacks and then burpees (tests/traces/video/jacks-burpees-21s, from a
// public video, CC BY-SA 4.0; see tests/traces/video/SOURCES.txt). It goes through the real calibration, feature extractor and jumping
// jack detector of core/moves (the movement library's own replay), and what the detector said, a step at a time as the session's hub
// would hand it over (an event when its pose frame comes, the channels as they stand), goes into the simulation.
// The man did not move to our beat, so the run is laid on the clip: the set starts so that his first jack falls on a beat (his three
// jacks are 0.8 s apart, 75 a minute, and the first set of the normal level is about 72 to 76). What this shows is that a real body is
// counted and read by the game: three jacks make three fireworks, six burpees make none, no false hint is given while he works, and the
// seated and the quiet way of playing take the same man. It does not show that the beat and the camera's delay are right (the recording day does).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../core/loop/rng.ts';
import { ALL_DETECTORS } from '../../core/moves/library.ts';
import { replay, type ReplayResult } from '../../core/moves/replay.ts';
import { parseTrace, traceFrames } from '../../core/pose/trace.ts';
import type { DetectorSpec, InputEvent } from '../../core/types/index.ts';
import { frameFrom } from '../_shared/frame.ts';
import type { SimEvent } from '../_shared/host.ts';
import { FireworkSim, POSE_LATENCY_MS, type FjTiming } from './fireworks.ts';

const clip = parseTrace(JSON.parse(readFileSync(new URL('../../../tests/traces/video/jacks-burpees-21s.trace.json', import.meta.url), 'utf8')));

interface Played { sim: FireworkSim; events: SimEvent[]; replayed: ReplayResult; jackTimes: number[]; startAt: number }

/** The clip through the movement library's replay and then through the game: one set, the first jack of the man on the beat `beat` of it. */
function playClip(spec: DetectorSpec, o: { seated?: boolean; silent?: boolean; hz?: number; beat?: number } = {}): Played {
  const replayed = replay(traceFrames(clip, { hz: o.hz ?? 30 }), { calibration: { holdSeconds: 0.5 }, registry: ALL_DETECTORS, detectors: [spec] });
  const reps: InputEvent[] = replayed.events.filter((e) => e.id === 'jumpingJack' && e.kind === 'rep').map((e) => ({ ...e, source: 'trace' as const }));
  const timing: Partial<FjTiming> = { sets: 1, workS: 24, restS: 3, finaleS: 3 };
  const sim = new FireworkSim({
    setup: {
      start: { seed: 7, difficulty: 'normal', seated: o.seated === true, mode: 'solo' },
      flags: { reducedMotion: false, silent: o.silent === true, seated: o.seated === true },
      players: 1, audioLatencyMs: 0, rng: mulberry32(7),
    },
    met: 8, timing,
  });
  const period = 60000 / (sim.plan.segments[0] as { bpm: number }).bpm;
  const first = (reps[0] as InputEvent).t;
  // the set starts where the first jack, less the delay the game assumes, falls on its beat
  const startAt = first - POSE_LATENCY_MS - (o.beat ?? 6) * period;
  const events: SimEvent[] = [];
  let ei = 0, si = 0;
  for (let k = 1; sim.phase === 'running' && k < 60 * 60; k++) {
    const now = startAt + (k * 1000) / 60;
    const here: InputEvent[] = [];
    while (ei < reps.length && (reps[ei] as InputEvent).t <= now) here.push(reps[ei++] as InputEvent);
    while (si + 1 < replayed.samples.length && (replayed.samples[si + 1] as { t: number }).t <= now) si++;
    const sample = replayed.samples[si];
    const ready = !!sample && sample.t <= now;          // before the calibration is through nobody is seen
    events.push(...sim.step(frameFrom([{ ok: ready && sample.ok, ch: ready ? sample.channels : {}, events: here }], 'trace')));
  }
  return { sim, events, replayed, jackTimes: reps.map((e) => e.t), startAt };
}

const jacksOf = (p: Played): SimEvent[] => p.events.filter((e) => e.type === 'jack' && e['grade'] !== 'warmup' && e['grade'] !== 'rest');
const missesOf = (p: Played): SimEvent[] => p.events.filter((e) => e.type === 'miss');

const WAYS: [string, DetectorSpec, { seated?: boolean; silent?: boolean }][] = [
  ['standard', { id: 'jumpingJack' }, {}],
  ['seated (arm jacks)', { id: 'jumpingJack', opts: { armsOnly: 1 } }, { seated: true }],
  ['quiet (step jacks)', { id: 'jumpingJack', opts: { step: 1 } }, { silent: true }],
];

describe('a real person doing jumping jacks and then burpees', () => {
  it.each(WAYS)('%s: three real jacks make three fireworks and six burpees make none, at 30 and at 10 pose frames a second', (_name, spec, o) => {
    for (const hz of [30, 10]) {
      const p = playClip(spec, { ...o, hz });
      expect(p.jackTimes, `the detector's reps at ${hz} Hz`).toHaveLength(3);
      const jacks = jacksOf(p);
      expect(jacks, `fireworks at ${hz} Hz`).toHaveLength(3);
      const s = p.sim.summary();
      expect(s.reps).toBe(3);
      expect(s.score).toBeGreaterThan(0);
      expect(s.metSeconds).toBeGreaterThan(0);
      // the fireworks are over the three jacks, and nothing is launched while he does burpees
      const lastJackAt = Math.max(...jacks.map((e) => Number(e.t)));
      expect(p.events.filter((e) => e.type === 'jack' && Number(e.t) > lastJackAt + 300)).toEqual([]);
    }
  });

  it('on the beat he is graded as on it: his three jacks at 75 a minute on a set of about 74 are perfect or good, and the streak is three', () => {
    const p = playClip({ id: 'jumpingJack' }, { hz: 30 });
    const jacks = jacksOf(p);
    expect(jacks.map((e) => e['grade'])).toEqual(expect.arrayContaining(['perfect']));
    for (const j of jacks) expect(['perfect', 'good'], `a jack at ${String(j['offsetMs'])} ms off the beat`).toContain(j['grade']);
    const s = p.sim.summary();
    expect(s.hits).toBe(3);
    expect(s.bestStreak).toBe(3);
    expect(s.quality).toBe(1);
  });

  it.each(WAYS)('%s: no false reason while he works; the strip says only that he stood still (after the jacks, while he does burpees)', (_name, spec, o) => {
    const p = playClip(spec, o);
    const last = Math.max(...jacksOf(p).map((e) => Number(e.t)));
    const codes = missesOf(p).map((e) => String(e['code']));
    expect(codes.length).toBeLessThanOrEqual(2);
    for (const e of missesOf(p)) {
      expect(['move_more', 'arms_not_up', 'feet_not_wide'], 'a code the game can give').toContain(e['code']);
      // not a word about arms or feet before his last jack: all three of those were counted
      if (e['code'] !== 'move_more') expect(Number(e.t)).toBeGreaterThan(last);
    }
    expect(codes).toContain('move_more');
  });

  it('a different beat for the same man gives other grades, and still three jacks (the count does not depend on the beat)', () => {
    const early = playClip({ id: 'jumpingJack' }, { beat: 5 });
    const same = jacksOf(early);
    expect(same).toHaveLength(3);
    const s = playClip({ id: 'jumpingJack' }, { beat: 9 }).sim.summary();
    expect(s.reps).toBe(3);
    // half a beat off: his jacks fall between the beats, not on them
    const off = playClip({ id: 'jumpingJack' }, { beat: 6.5 });
    expect(off.sim.summary().reps).toBe(3);
    expect(off.sim.summary().hits).toBeLessThan(3);
  });
});
