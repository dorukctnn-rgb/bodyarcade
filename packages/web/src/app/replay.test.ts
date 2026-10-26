// The one second replay of a miss: the ring of landmarks, the window a miss keeps, the choice of the miss to show, the game that is watched
// for them, the skeleton that is drawn from a window and played, and the promise of the screen: only landmarks, in memory, gone with the screen.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SHAPE, synthPose } from '../../../core/pose/synth.ts';
import { recorder } from '../../../core/render2d/testing/recorder.ts';
import { LM, type Game, type GameManifest, type GameModule, type InputFrame, type Landmark, type RunSummary } from '../../../core/types/index.ts';
import {
  boneCount, chooseReplay, MAX_KINDS, MIN_FRAMES, POLL_MS, PoseRing, REPLAY_MS, RING_FRAMES, RING_MS, ReplayRecorder, usable, watchGame, watchModule,
  type ReplayClip,
} from './replay.ts';
import { boundsOf, DRAW_EVERY_MS, fitTo, MARGIN, poseAt, ReplayPlayer, type ReplayHost, type ReplayState } from './replay-view.ts';

const SHAPE = { ...DEFAULT_SHAPE, aspect: 16 / 9 };
const pose = (drop = 0, shiftX = 0): Landmark[] => synthPose(SHAPE, { drop, shiftX });
const HZ = 30;
const STEP = 1000 / HZ;

/** A recorder on a clock of its own, with `reason` knowing the codes in `known`. */
function rig(known: string[] = ['hips_not_low', 'hips_not_up', 'arms_not_up']): { rec: ReplayRecorder; clock: { t: number }; feed(ms: number, drop?: (t: number) => number): void } {
  const clock = { t: 10_000 };
  const rec = new ReplayRecorder({ now: () => clock.t, reason: (k) => known.includes(k) });
  rec.running(true);
  const feed = (ms: number, drop: (t: number) => number = () => 0): void => {
    const end = clock.t + ms;
    while (clock.t < end) { clock.t += STEP; rec.frame(pose(drop(clock.t)), 16 / 9); }
  };
  return { rec, clock, feed };
}

const miss = (kind: string, t = 0, extra: Partial<RunSummary['log'][number]> = {}): RunSummary['log'][number] => ({ t, kind, ok: false, ...extra });
const hit = (kind = 'squat', t = 0): RunSummary['log'][number] => ({ t, kind, ok: true });
const summaryOf = (log: RunSummary['log']): RunSummary => ({ score: 10, seconds: 20, metSeconds: 100, log });

describe('the ring of landmarks', () => {
  it('keeps the last second and a half and nothing older, in memory, as plain numbers', () => {
    const ring = new PoseRing();
    for (let i = 0; i < 90; i++) ring.push(i * STEP, pose());
    // three seconds at 30 a second: only the last RING_MS of it is there
    expect(ring.size).toBeLessThanOrEqual(Math.ceil(RING_MS / STEP) + 1);
    expect(ring.size).toBeGreaterThan(Math.floor(RING_MS / STEP) - 2);
    const w = ring.window(89 * STEP, RING_MS);
    expect(w.length).toBe(ring.size);
    // the oldest first, times counted from the first
    expect(w[0]?.t).toBe(0);
    for (let i = 1; i < w.length; i++) expect((w[i] as { t: number }).t).toBeGreaterThan((w[i - 1] as { t: number }).t);
    // x, y and visibility of the 33 points of the model: 99 numbers, no picture
    for (const f of w) { expect(f.p).toBeInstanceOf(Float32Array); expect(f.p.length).toBe(99); }
  });

  it('never holds more frames than its ring has, however fast they come', () => {
    const ring = new PoseRing();
    for (let i = 0; i < 400; i++) ring.push(1000 + i * 4, pose()); // 250 a second for 1.6 s
    expect(ring.size).toBeLessThanOrEqual(RING_FRAMES);
    const w = ring.window(1000 + 399 * 4, REPLAY_MS);
    expect(w.length).toBeLessThanOrEqual(RING_FRAMES);
    expect(w.length).toBeGreaterThan(40);
  });

  it('copies a window out: what comes after does not change it', () => {
    const ring = new PoseRing();
    for (let i = 0; i < 40; i++) ring.push(i * STEP, pose());
    const w = ring.window(39 * STEP, REPLAY_MS);
    const before = Array.from((w[3] as { p: Float32Array }).p);
    for (let i = 40; i < 200; i++) ring.push(i * STEP, pose(0.8, 0.3)); // writes over every slot
    expect(Array.from((w[3] as { p: Float32Array }).p)).toEqual(before);
  });

  it('takes only frames of the window asked for, and nothing from a frame that has fewer than 33 points', () => {
    const ring = new PoseRing();
    ring.push(0, pose().slice(0, 20));
    expect(ring.size).toBe(0);
    for (let i = 0; i < 60; i++) ring.push(i * STEP, pose());
    const w = ring.window(40 * STEP, 500);
    expect(w.length).toBeGreaterThan(10);
    expect(w.length).toBeLessThanOrEqual(Math.ceil(500 / STEP));
    ring.clear();
    expect(ring.size).toBe(0);
    expect(ring.window(40 * STEP, 500)).toEqual([]);
  });
});

describe('a window is a movement', () => {
  it('needs enough frames over enough time with a body in the last of them', () => {
    const ring = new PoseRing();
    for (let i = 0; i < 40; i++) ring.push(i * STEP, pose());
    const full = ring.window(39 * STEP, REPLAY_MS);
    expect(usable(full)).toBe(true);
    expect(usable(full.slice(0, MIN_FRAMES - 1))).toBe(false);
    expect(usable([])).toBe(false);
    // frames close together (a burst) are not a second of movement
    expect(usable(full.slice(0, 8).map((f, i) => ({ ...f, t: i * 10 })))).toBe(false);
    // a person who is out of view: every joint hidden
    const hidden = full.map((f) => { const p = f.p.slice(); for (let i = 0; i < 33; i++) p[i * 3 + 2] = 0.1; return { ...f, p }; });
    expect(boneCount(hidden[0]!.p)).toBe(0);
    expect(usable(hidden)).toBe(false);
  });
});

describe('the recorder keeps the window of a miss that has a reason', () => {
  it('copies the last second before the miss, when the log shows it', () => {
    const { rec, clock, feed } = rig();
    feed(3000);
    rec.log([hit(), miss('hips_not_low', 2900)]);
    expect(rec.kept).toBe(1);
    const clip = rec.take(summaryOf([hit(), miss('hips_not_low', 2900)]));
    expect(clip?.kind).toBe('hips_not_low');
    expect(clip?.aspect).toBeCloseTo(16 / 9, 5);
    // a second of frames at thirty a second, ending at the moment of the miss
    expect(clip?.frames.length).toBeGreaterThanOrEqual(28);
    expect(clip?.frames.length).toBeLessThanOrEqual(31);
    expect(clip?.ms).toBeGreaterThan(900);
    expect(clip?.ms).toBeLessThanOrEqual(REPLAY_MS);
    expect(clock.t).toBeGreaterThan(0);
  });

  it('shows the movement that came before the miss: the window holds the squat the person did', () => {
    const { rec, feed } = rig();
    // the person squats (hips down) halfway through the second before the miss
    let n = 0;
    feed(2000, () => (n++ < 45 ? 0 : 0.9));
    rec.log([miss('hips_not_low')]);
    const clip = rec.take(summaryOf([miss('hips_not_low')])) as ReplayClip;
    const hipY = (i: number): number => (clip.frames[i] as { p: Float32Array }).p[LM.leftHip * 3 + 1] as number;
    expect(hipY(clip.frames.length - 1)).toBeGreaterThan(hipY(0));
  });

  it('takes a frame at the time it is given, so frames that came late are still a second apart as a camera gave them', () => {
    const { rec, clock } = rig();
    // the clock moved a whole second and a half before the frames were handed over, each with its own time
    const start = clock.t;
    for (let i = 0; i < 45; i++) rec.frame(pose(), 16 / 9, start + i * STEP);
    clock.t = start + 44 * STEP;
    rec.log([miss('hips_not_low')]);
    const clip = rec.take(summaryOf([miss('hips_not_low')])) as ReplayClip;
    expect(clip.frames.length).toBeGreaterThanOrEqual(29);
    expect(clip.frames.length).toBeLessThanOrEqual(31);
    expect(clip.frames[1]?.t).toBeCloseTo(STEP, 3);
  });

  it('ignores a miss without a reason, a move that counted, the other player and a log it has read before', () => {
    const { rec, feed } = rig();
    feed(2000);
    rec.log([miss('dnf'), hit('hips_not_low'), miss('hips_not_low', 0, { player: 2 })]);
    expect(rec.kept).toBe(0);
    const log = [miss('hips_not_low', 1900)];
    rec.log(log);
    expect(rec.kept).toBe(1);
    // the same log again: nothing new
    feed(500);
    rec.log(log);
    const clip = rec.take(summaryOf(log)) as ReplayClip;
    // the window is the one of the first reading, not of the second
    expect(clip.frames.length).toBeGreaterThan(20);
  });

  it('keeps the latest window of each reason', () => {
    const { rec, feed } = rig();
    feed(2000);
    rec.log([miss('hips_not_low')]);
    feed(1500, () => 0.9);
    rec.log([miss('hips_not_low'), miss('hips_not_low')]);
    const clip = rec.take(summaryOf([miss('hips_not_low'), miss('hips_not_low')])) as ReplayClip;
    const hipY = (i: number): number => (clip.frames[i] as { p: Float32Array }).p[LM.leftHip * 3 + 1] as number;
    // the second miss came with the hips down: that is the window kept
    expect(hipY(clip.frames.length - 1)).toBeGreaterThan(0.6);
  });

  it('keeps nothing when no body was in view, and leaves an earlier window of the reason where it was', () => {
    const { rec, clock, feed } = rig();
    feed(2000);
    rec.log([miss('hips_not_low')]);
    expect(rec.kept).toBe(1);
    // the person leaves the picture for two seconds (no frames), then another miss
    clock.t += 2000;
    rec.log([miss('hips_not_low'), miss('hips_not_low')]);
    expect(rec.kept).toBe(1);
    const clip = rec.take(summaryOf([miss('hips_not_low'), miss('hips_not_low')]));
    expect(clip?.frames.length).toBeGreaterThan(20);
  });

  it('takes no frame while the round is not running (counting down, paused), and a pause empties the ring', () => {
    const { rec, feed } = rig();
    rec.running(false);
    feed(2000);
    rec.log([miss('hips_not_low')]);
    expect(rec.kept).toBe(0);
    rec.running(true);
    feed(700);
    rec.running(false); // paused: the second that was there is gone with it
    rec.running(true);
    feed(100);
    rec.log([miss('hips_not_up', 0)]);
    expect(rec.kept).toBe(0);
  });

  it('starts over when the log is shorter than the last one it read (a new run), and on reset', () => {
    const { rec, feed } = rig();
    feed(2000);
    rec.log([hit(), hit(), miss('hips_not_low')]);
    expect(rec.kept).toBe(1);
    rec.reset();
    expect(rec.kept).toBe(0);
    rec.running(true);
    feed(2000);
    rec.log([hit(), hit(), hit(), miss('hips_not_up')]);
    rec.log([miss('arms_not_up')]); // a shorter log: a run of its own, read from its start
    expect(rec.kept).toBe(2);
  });

  it(`never keeps more than ${MAX_KINDS} kinds`, () => {
    const known = Array.from({ length: MAX_KINDS + 10 }, (_, i) => `code_${i}`);
    const { rec, feed } = rig(known);
    feed(2000);
    rec.log(known.map((k) => miss(k)));
    expect(rec.kept).toBe(MAX_KINDS);
  });
});

describe('the choice of the miss to show', () => {
  const clipOf = (kind: string): { clip: ReplayClip } => ({ clip: { kind, ms: 900, aspect: 16 / 9, frames: [] } });
  const caught = (...kinds: string[]): Map<string, { clip: ReplayClip }> => new Map(kinds.map((k) => [k, clipOf(k)]));
  const any = (): boolean => true;

  it('is the reason that missed most, as the list of reasons has it first', () => {
    const log = [miss('a'), miss('b'), miss('b'), miss('c'), miss('c'), hit()];
    // b and c tie: the first in the alphabet, which is the first row of the results
    expect(chooseReplay(log, caught('a', 'b', 'c'), any)?.kind).toBe('b');
    expect(chooseReplay([miss('a'), miss('b'), miss('b'), miss('b')], caught('a', 'b'), any)?.kind).toBe('b');
  });

  it('gives way to the next reason when the first has no window', () => {
    const log = [miss('person_out'), miss('person_out'), miss('hips_not_low')];
    expect(chooseReplay(log, caught('hips_not_low'), any)?.kind).toBe('hips_not_low');
  });

  it('is nothing when there are no misses with a reason, or no window of any', () => {
    expect(chooseReplay([hit(), hit()], caught('hips_not_low'), any)).toBeNull();
    expect(chooseReplay([miss('dnf')], caught('dnf'), (k) => k !== 'dnf')).toBeNull();
    expect(chooseReplay([miss('hips_not_low')], caught(), any)).toBeNull();
    expect(chooseReplay([], caught('hips_not_low'), any)).toBeNull();
    expect(chooseReplay([miss('hips_not_low', 0, { player: 2 })], caught('hips_not_low'), any)).toBeNull();
  });

  it('is what the round hands over, and a round without a miss hands over nothing', () => {
    const { rec, feed } = rig();
    feed(2000);
    rec.log([miss('hips_not_up')]);
    rec.log([miss('hips_not_up'), miss('hips_not_low'), miss('hips_not_low')]);
    expect(rec.take(summaryOf([miss('hips_not_up'), miss('hips_not_low'), miss('hips_not_low')]))?.kind).toBe('hips_not_low');
    const none = rig();
    none.feed(3000);
    expect(none.rec.take(summaryOf([hit(), hit()]))).toBeNull();
  });
});

describe('nothing is kept after the round', () => {
  it('empties the recorder when the window is taken, and takes no more frames', () => {
    const { rec, feed } = rig();
    feed(2000);
    rec.log([miss('hips_not_low')]);
    expect(rec.take(summaryOf([miss('hips_not_low')]))).not.toBeNull();
    expect(rec.kept).toBe(0);
    feed(2000);
    rec.log([miss('hips_not_low'), miss('hips_not_low')]);
    expect(rec.kept).toBe(0);
    expect(rec.take(summaryOf([miss('hips_not_low')]))).toBeNull();
  });

  it('empties the ring and the windows when it is let go of at any moment', () => {
    const { rec, feed } = rig();
    feed(2000);
    rec.log([miss('hips_not_low')]);
    rec.dispose();
    expect(rec.kept).toBe(0);
    feed(1000);
    rec.log([miss('hips_not_low'), miss('hips_not_low')]);
    expect(rec.kept).toBe(0);
    expect(rec.take(summaryOf([miss('hips_not_low')]))).toBeNull();
  });

  it('never writes anywhere: no storage, no network, no picture, no file in the code that keeps and draws the replay', () => {
    for (const file of ['replay.ts', 'replay-view.ts']) {
      const code = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const word of ['localStorage', 'sessionStorage', 'indexedDB', 'fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'toDataURL', 'toBlob', 'captureStream', 'MediaRecorder', 'createObjectURL', 'getUserMedia', 'drawImage']) {
        expect(code.includes(word), `${file} uses ${word}`).toBe(false);
      }
    }
  });
});

// ---- the game, watched ----------------------------------------------------------------------------------------------------------------

function toyGame(): { game: Game; calls: string[]; log: RunSummary['log']; manifest: GameManifest } {
  const calls: string[] = [];
  const log: RunSummary['log'] = [];
  const manifest = { id: 'toy', detectors: ['a'] } as unknown as GameManifest;
  let phase: 'running' | 'over' = 'running';
  let summaries = 0;
  const game: Game = {
    manifest,
    init: async () => { calls.push('init'); },
    start: () => { calls.push('start'); },
    step: () => { calls.push('step'); return { events: [], phase }; },
    render: () => { calls.push('render'); },
    snapshot: () => ({ s: 1 }),
    restore: () => { calls.push('restore'); },
    summary: () => { summaries++; calls.push(`summary${summaries}`); return summaryOf(log.slice()); },
    dispose: () => { calls.push('dispose'); },
  };
  return { game, calls, log, manifest: Object.assign(manifest, { setOver: () => { phase = 'over'; } }) };
}

const input = (t: number): InputFrame => ({ t, source: 'pose', tracking: { ok: true }, channels: {}, events: [] });

describe('the game that is watched', () => {
  it('plays as it did: every call goes through, and the manifest is the game\'s own', async () => {
    const { game, calls, manifest } = toyGame();
    const seen: RunSummary['log'][] = [];
    const g = watchGame(game, { log: (l) => seen.push(l) });
    expect(g.manifest).toBe(manifest);
    manifest.detectors = ['b'] as never;
    expect(g.manifest.detectors).toEqual(['b']);
    await g.init({} as never);
    g.start({} as never);
    expect(g.step(1 / 60, input(0)).phase).toBe('running');
    g.render(0.5);
    expect(g.snapshot()).toEqual({ s: 1 });
    g.restore({});
    g.dispose();
    expect(calls).toEqual(['init', 'start', 'step', 'summary1', 'render', 'restore', 'dispose']);
  });

  it(`reads the log at most every ${POLL_MS} ms of the game's time, and once more when the game ends`, () => {
    const { game, log, manifest } = toyGame();
    const reads: number[] = [];
    const g = watchGame(game, { log: (l) => reads.push(l.length) });
    let t = 0;
    for (let i = 0; i < 60; i++) { t += 1000 / 60; g.step(1 / 60, input(t)); if (i === 30) log.push(miss('hips_not_low', t)); }
    // a second of steps at sixty a second: ten readings at most, and the miss is in the later ones
    expect(reads.length).toBeLessThanOrEqual(11);
    expect(reads.length).toBeGreaterThanOrEqual(9);
    expect(reads.at(-1)).toBe(1);
    (manifest as unknown as { setOver(): void }).setOver();
    const n = reads.length;
    g.step(1 / 60, input(t + 1));
    expect(reads.length).toBe(n + 1);
  });

  it('starts counting again when a new run starts, and wraps every game its module makes', () => {
    const { game } = toyGame();
    const reads: number[] = [];
    const g = watchGame(game, { log: (l) => reads.push(l.length) });
    g.step(1 / 60, input(5000));
    g.step(1 / 60, input(5010));
    expect(reads.length).toBe(1);
    g.start({} as never);
    g.step(1 / 60, input(10)); // the new run's clock is back near zero
    expect(reads.length).toBe(2);
    const module: GameModule = { manifest: game.manifest, create: () => game };
    const watched = watchModule(module, { log: (l) => reads.push(l.length) });
    expect(watched.manifest).toBe(module.manifest);
    watched.create().step(1 / 60, input(0));
    expect(reads.length).toBe(3);
  });
});

// ---- the skeleton, drawn ----------------------------------------------------------------------------------------------------------------

/** A clip of a squat, one second at thirty frames a second. */
function squatClip(o: { aspect?: number; frames?: number } = {}): ReplayClip {
  const frames: ReplayClip['frames'] = [];
  const n = o.frames ?? 30;
  const aspect = o.aspect ?? 16 / 9;
  const ring = new PoseRing();
  for (let i = 0; i < n; i++) ring.push(i * STEP, synthPose({ ...DEFAULT_SHAPE, aspect }, { drop: 0.9 * (i / (n - 1)) }));
  frames.push(...ring.window((n - 1) * STEP, REPLAY_MS));
  return { kind: 'hips_not_low', ms: frames[frames.length - 1]?.t ?? 0, aspect, frames };
}

describe('the skeleton of a window', () => {
  it('is mirrored as the game shows the player: the left shoulder is on the left of the picture', () => {
    const clip = squatClip();
    const fit = fitTo(boundsOf(clip), 400, 300);
    const p = poseAt(clip, 0, fit);
    expect(p[LM.leftShoulder * 3] as number).toBeLessThan(p[LM.rightShoulder * 3] as number);
    expect(p[LM.leftHip * 3] as number).toBeLessThan(p[LM.rightHip * 3] as number);
  });

  it('fits the body inside the picture with room around it, whatever the picture and the camera', () => {
    for (const aspect of [16 / 9, 9 / 16, 4 / 3]) {
      const clip = squatClip({ aspect });
      for (const [w, h] of [[240, 180], [400, 300], [1100, 825], [300, 600]] as const) {
        const fit = fitTo(boundsOf(clip), w, h);
        for (const t of [0, 300, 650, clip.ms]) {
          const p = poseAt(clip, t, fit);
          for (let i = 0; i < 33; i++) {
            if ((p[i * 3 + 2] as number) < 0.5) continue;
            expect(p[i * 3] as number, `x of ${i} at ${t} in ${w}x${h} (${aspect})`).toBeGreaterThanOrEqual(w * MARGIN - 1);
            expect(p[i * 3] as number, `x of ${i} at ${t}`).toBeLessThanOrEqual(w * (1 - MARGIN) + 1);
            expect(p[i * 3 + 1] as number, `y of ${i} at ${t}`).toBeGreaterThanOrEqual(h * MARGIN - 1);
            expect(p[i * 3 + 1] as number, `y of ${i} at ${t}`).toBeLessThanOrEqual(h * (1 - MARGIN) + 1);
          }
          // the ring round the head (0.34 of the width of the shoulders) is inside the picture too
          const ring = 0.34 * Math.abs((p[LM.leftShoulder * 3] as number) - (p[LM.rightShoulder * 3] as number));
          expect((p[LM.nose * 3 + 1] as number) - ring, `top of the head at ${t} in ${w}x${h} (${aspect})`).toBeGreaterThanOrEqual(h * MARGIN * 0.5);
          expect((p[LM.nose * 3] as number) - ring, 'left of the head').toBeGreaterThanOrEqual(0);
          expect((p[LM.nose * 3] as number) + ring, 'right of the head').toBeLessThanOrEqual(w);
        }
      }
    }
  });

  it('is not stretched: the same body is the same shape in a wide picture and in a tall one', () => {
    const clip = squatClip();
    const ratio = (w: number, h: number): number => {
      const p = poseAt(clip, 0, fitTo(boundsOf(clip), w, h));
      return Math.abs((p[LM.leftShoulder * 3] as number) - (p[LM.rightShoulder * 3] as number)) / Math.abs((p[LM.leftShoulder * 3 + 1] as number) - (p[LM.leftHip * 3 + 1] as number));
    };
    expect(ratio(800, 300)).toBeCloseTo(ratio(300, 800), 2);
  });

  it('moves between frames: halfway is between the two poses, and past the end is the last pose', () => {
    const clip = squatClip();
    const fit = fitTo(boundsOf(clip), 400, 300);
    const y = (t: number): number => poseAt(clip, t, fit)[LM.leftHip * 3 + 1] as number;
    expect(y(clip.ms / 2)).toBeGreaterThan(y(0));
    expect(y(clip.ms / 2)).toBeLessThan(y(clip.ms));
    expect(y(clip.ms + 500)).toBe(y(clip.ms));
    expect(y(-50)).toBe(y(0));
  });

  it('draws nothing for a joint that was not seen, and does not fail on a window of one frame or none', () => {
    const clip = squatClip();
    const hidden: ReplayClip = { ...clip, frames: clip.frames.map((f) => { const p = f.p.slice(); p[LM.leftWrist * 3 + 2] = 0.1; return { ...f, p }; }) };
    const p = poseAt(hidden, 100, fitTo(boundsOf(hidden), 400, 300));
    expect(p[LM.leftWrist * 3 + 2] as number).toBeLessThan(0.5);
    const one: ReplayClip = { ...clip, frames: [clip.frames[0] as ReplayClip['frames'][number]] };
    expect(() => poseAt(one, 500, fitTo(boundsOf(one), 400, 300))).not.toThrow();
    const none: ReplayClip = { ...clip, frames: [] };
    expect(() => poseAt(none, 0, fitTo(boundsOf(none), 400, 300))).not.toThrow();
  });
});

/** A host for the player: a clock that is moved by hand, a frame callback that is run by hand, a recording context. */
function stage(o: { ratio?: number } = {}): { host: ReplayHost; ctx: ReturnType<typeof recorder>; clock: { t: number }; tick(ms: number): number; reports: { progress: number; state: ReplayState }[]; pending(): number; canvas: { w: number; h: number } } {
  const ctx = recorder();
  const clock = { t: 0 };
  let cb: (() => void) | null = null;
  let id = 0;
  const canvas = { w: 0, h: 0 };
  const reports: { progress: number; state: ReplayState }[] = [];
  const host: ReplayHost = {
    size: () => ({ w: 400, h: 300, ratio: o.ratio ?? 1 }),
    resize: (w, h) => { canvas.w = w; canvas.h = h; },
    ctx,
    now: () => clock.t,
    raf: (f) => { cb = f; return ++id; },
    caf: () => { cb = null; },
    report: (p) => reports.push(p),
  };
  // moves the clock by `ms` and runs the frame callback that was asked for, if any; how many callbacks run
  const tick = (ms: number): number => { clock.t += ms; const f = cb; cb = null; f?.(); return f ? 1 : 0; };
  return { host, ctx, clock, tick, reports, pending: () => (cb ? 1 : 0), canvas };
}

describe('the player of the replay', () => {
  it('plays the window once when it opens, in the time it took, then stands on the moment of the miss', () => {
    const s = stage();
    const clip = squatClip();
    const p = new ReplayPlayer({ clip, host: s.host, autoplay: true });
    expect(p.current).toBe('playing');
    expect(s.reports[0]).toEqual({ progress: 0, state: 'playing' });
    let ticks = 0;
    while (p.current === 'playing' && ticks < 200) { s.tick(16); ticks++; }
    expect(p.current).toBe('done');
    // about a second of sixteen millisecond frames, and it asked for no more after the end
    expect(ticks * 16).toBeGreaterThanOrEqual(clip.ms);
    expect(ticks * 16).toBeLessThan(clip.ms + 40);
    expect(s.pending()).toBe(0);
    expect(s.reports.at(-1)).toEqual({ progress: 1, state: 'done' });
    // the progress only grows
    const progress = s.reports.map((r) => r.progress);
    for (let i = 1; i < progress.length; i++) expect(progress[i] as number).toBeGreaterThanOrEqual(progress[i - 1] as number);
    // and it drew a skeleton: bones and joints
    expect(s.ctx.count('stroke')).toBeGreaterThan(10);
    expect(s.ctx.count('fill')).toBeGreaterThan(10);
  });

  it(`draws at most once every ${DRAW_EVERY_MS} ms, so a slow phone is not asked for sixty pictures a second`, () => {
    const s = stage();
    const p = new ReplayPlayer({ clip: squatClip(), host: s.host, autoplay: true });
    const before = s.ctx.count('fillRect');
    for (let i = 0; i < 20; i++) s.tick(8);
    // 160 ms of eight millisecond frames: five or six pictures, not twenty
    const drawn = s.ctx.count('fillRect') - before;
    expect(drawn).toBeGreaterThanOrEqual(4);
    expect(drawn).toBeLessThanOrEqual(7);
    p.dispose();
  });

  it('plays again from the start when the button is pressed, and a second press in the middle starts over', () => {
    const s = stage();
    const p = new ReplayPlayer({ clip: squatClip(), host: s.host, autoplay: true });
    for (let i = 0; i < 100 && p.current === 'playing'; i++) s.tick(16);
    expect(p.current).toBe('done');
    p.play();
    expect(p.current).toBe('playing');
    for (let i = 0; i < 20; i++) s.tick(16);
    expect(p.current).toBe('playing');
    s.reports.length = 0;
    p.play();
    expect(s.reports[0]).toEqual({ progress: 0, state: 'playing' });
    expect(s.pending()).toBe(1);
  });

  it('opens on the moment of the miss when it was played already (the screen drawn again), and plays only when asked', () => {
    const s = stage();
    const p = new ReplayPlayer({ clip: squatClip(), host: s.host, autoplay: false });
    expect(p.current).toBe('done');
    expect(s.pending()).toBe(0);
    p.play();
    expect(p.current).toBe('playing');
  });

  it('stands still for a player who asked for less motion: one picture, the way the body came to the miss, and nothing to play', () => {
    const s = stage();
    const p = new ReplayPlayer({ clip: squatClip(), host: s.host, still: true, autoplay: true });
    expect(p.current).toBe('still');
    expect(s.pending()).toBe(0);
    // the pose at the miss in full, the poses before it faint
    const alphas = new Set(s.ctx.log.map((l) => l.globalAlpha));
    expect(alphas.has(1)).toBe(true);
    expect([...alphas].filter((a) => a < 1).length).toBeGreaterThanOrEqual(3);
    const drawn = s.ctx.count('fillRect');
    p.play();
    expect(p.current).toBe('still');
    expect(s.pending()).toBe(0);
    expect(s.ctx.count('fillRect')).toBe(drawn);
  });

  it('follows the size of its picture and the sharpness of the screen, and draws again at the new size', () => {
    const s = stage({ ratio: 2 });
    const p = new ReplayPlayer({ clip: squatClip(), host: s.host, autoplay: false });
    expect(s.canvas).toEqual({ w: 800, h: 600 });
    const drawn = s.ctx.count('fillRect');
    p.measure();
    expect(s.ctx.count('fillRect')).toBeGreaterThan(drawn);
  });

  it('draws nothing more once it is let go of, and its pending frame is cancelled', () => {
    const s = stage();
    let released = 0;
    const p = new ReplayPlayer({ clip: squatClip(), host: s.host, autoplay: true, onDispose: () => { released++; } });
    expect(s.pending()).toBe(1);
    p.dispose();
    p.dispose();
    expect(released).toBe(1);
    expect(s.pending()).toBe(0);
    const drawn = s.ctx.count('fillRect');
    p.play();
    s.tick(100);
    expect(s.ctx.count('fillRect')).toBe(drawn);
  });
});
