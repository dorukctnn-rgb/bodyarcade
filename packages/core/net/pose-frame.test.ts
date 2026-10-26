// The state frame of a race and the skeleton in it (pose-frame.ts).
import { describe, expect, it } from 'vitest';
import { LANDMARK_COUNT, LM, type Landmark } from '../types/index.ts';
import { POSE_JOINTS, POSE_NUMBERS, POSE_STALE_MS, RivalBoard, ghostFrame, packPose, readGhostFrame, unpackPose } from './pose-frame.ts';
import { ManualScheduler } from './testkit.ts';

const body = (over: Partial<Record<number, Partial<Landmark>>> = {}): Landmark[] =>
  Array.from({ length: LANDMARK_COUNT }, (_, i) => ({ x: 0.2 + (i % 7) * 0.1, y: 0.1 + (i / LANDMARK_COUNT) * 0.8, z: 0, visibility: 1, ...(over[i] ?? {}) }));

describe('the pose in a frame', () => {
  it('is 13 joints as 26 whole numbers and comes back within a pixel of 254', () => {
    const lm = body();
    const p = packPose(lm) as number[];
    expect(p).toHaveLength(POSE_NUMBERS);
    expect(p.every((n) => Number.isInteger(n) && n >= 0 && n <= 254)).toBe(true);
    const back = unpackPose(p) as Landmark[];
    expect(back).toHaveLength(LANDMARK_COUNT);
    for (const i of POSE_JOINTS) {
      expect(Math.abs((back[i] as Landmark).x - (lm[i] as Landmark).x)).toBeLessThanOrEqual(0.5 / 254 + 1e-9);
      expect(Math.abs((back[i] as Landmark).y - (lm[i] as Landmark).y)).toBeLessThanOrEqual(0.5 / 254 + 1e-9);
      expect((back[i] as Landmark).visibility).toBe(1);
    }
    // the joints a frame does not carry are not drawn
    expect((back[LM.leftEye] as Landmark).visibility).toBe(0);
    expect((back[LM.leftHeel] as Landmark).visibility).toBe(0);
  });

  it('marks a joint that is not seen and gives up on a body with fewer than four joints', () => {
    const p = packPose(body({ [LM.leftWrist]: { visibility: 0.2 }, [LM.rightKnee]: { x: 1.4 } })) as number[];
    const k = POSE_JOINTS.indexOf(LM.leftWrist);
    expect([p[2 * k], p[2 * k + 1]]).toEqual([255, 255]);
    const back = unpackPose(p) as Landmark[];
    expect((back[LM.leftWrist] as Landmark).visibility).toBe(0);
    expect((back[LM.rightKnee] as Landmark).visibility).toBe(0);
    expect((back[LM.nose] as Landmark).visibility).toBe(1);
    const hidden: Partial<Record<number, Partial<Landmark>>> = {};
    for (const j of POSE_JOINTS.slice(3)) hidden[j] = { visibility: 0 };
    expect(packPose(body(hidden))).toBeNull();
    expect(packPose(null)).toBeNull();
    expect(packPose([])).toBeNull();
  });

  it('refuses anything that is not a packed pose', () => {
    const ok = packPose(body()) as number[];
    expect(unpackPose(ok)).not.toBeNull();
    for (const bad of [null, undefined, 'x', 5, {}, [], ok.slice(1), [...ok, 1], ok.map((n, i) => (i === 3 ? 1.5 : n)), ok.map((n, i) => (i === 3 ? -1 : n)), ok.map((n, i) => (i === 3 ? 256 : n)),
      ok.map((n, i) => (i === 3 ? '12' : n)), ok.map((n, i) => (i === 3 ? Number.NaN : n)), ok.map((n, i) => (i === 3 ? null : n)), new Array(POSE_NUMBERS).fill(255)]) {
      expect(unpackPose(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe('the frame', () => {
  it('carries the match time, the score and the pose in about 150 characters', () => {
    const f = ghostFrame(12_345.6, 1230.4, body());
    expect(f).toMatchObject({ mt: 12_346, sc: 1230 });
    expect(JSON.stringify(f).length).toBeLessThan(200);
    expect(readGhostFrame(JSON.parse(JSON.stringify(f)))).toMatchObject({ mt: 12_346, sc: 1230 });
    expect(readGhostFrame(f)?.pose).toHaveLength(LANDMARK_COUNT);
  });

  it('leaves the pose out when no body is seen (the score and the time still go)', () => {
    expect(ghostFrame(500, 100)).toEqual({ mt: 500, sc: 100 });
    expect(ghostFrame(500, 100, [])).toEqual({ mt: 500, sc: 100 });
    expect(readGhostFrame({ mt: 500, sc: 100 })).toEqual({ mt: 500, sc: 100, pose: null });
  });

  it('is read only when every field is what it should be; a bad pose costs only the pose', () => {
    expect(readGhostFrame({ mt: -3000, sc: 0 })).toEqual({ mt: -3000, sc: 0, pose: null });
    expect(readGhostFrame({ mt: 100, sc: 10, p: [1, 2, 3] })).toEqual({ mt: 100, sc: 10, pose: null });
    for (const bad of [null, undefined, 3, 'x', [], [1, 2], {}, { mt: 1 }, { sc: 1 }, { mt: '1', sc: 1 }, { mt: 1, sc: 1.5 }, { mt: 1, sc: -1 }, { mt: Number.NaN, sc: 1 }, { mt: Infinity, sc: 1 },
      { mt: 1e9, sc: 1 }, { mt: 1, sc: 1e12 }]) {
      expect(readGhostFrame(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('survives whatever a page may send: junk never throws', () => {
    let seed = 7;
    const rnd = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const pick = (depth = 0): unknown => {
      const r = depth > 3 ? rnd() * 0.5 : rnd();
      if (r < 0.15) return null;
      if (r < 0.3) return Math.floor(rnd() * 400) - 50;
      if (r < 0.4) return rnd() * 1e9;
      if (r < 0.5) return 'x'.repeat(Math.floor(rnd() * 5));
      if (r < 0.7) return Array.from({ length: Math.floor(rnd() * 30) }, () => pick(depth + 1));
      if (r < 0.85) return { mt: pick(depth + 1), sc: pick(depth + 1), p: pick(depth + 1) };
      return { [`k${Math.floor(rnd() * 3)}`]: pick(depth + 1) };
    };
    for (let i = 0; i < 3000; i++) {
      const v = pick();
      expect(() => readGhostFrame(v)).not.toThrow();
      expect(() => unpackPose(v)).not.toThrow();
      const f = readGhostFrame(v);
      if (f?.pose) expect(f.pose).toHaveLength(LANDMARK_COUNT);
    }
  });
});

describe('the latest frame of every friend', () => {
  it('keeps a friend\'s score and skeleton, and lets the skeleton go when the frames stop', () => {
    const clock = new ManualScheduler();
    const b = new RivalBoard(() => clock.now());
    expect(b.pose('s2')).toBeNull();
    expect(b.score('s2')).toBeNull();
    expect(b.accept('s2', ghostFrame(1000, 300, body()))).toBe(true);
    expect(b.pose('s2')).toHaveLength(LANDMARK_COUNT);
    expect(b.score('s2')).toBe(300);
    expect(b.matchTime('s2')).toBe(1000);
    clock.advance(POSE_STALE_MS);
    expect(b.pose('s2')).not.toBeNull();
    clock.advance(1);
    expect(b.pose('s2')).toBeNull();                                           // no frozen figure on the tile
    expect(b.score('s2')).toBe(300);                                           // the number stays
  });

  it('keeps the last skeleton through frames that carry only a score, and drops it when they last too long', () => {
    const clock = new ManualScheduler();
    const b = new RivalBoard(() => clock.now());
    b.accept('s2', ghostFrame(1000, 100, body()));
    clock.advance(400);
    b.accept('s2', ghostFrame(1400, 200));
    expect(b.pose('s2')).not.toBeNull();
    expect(b.score('s2')).toBe(200);
    clock.advance(POSE_STALE_MS);
    b.accept('s2', ghostFrame(2600, 300));
    expect(b.pose('s2')).toBeNull();
  });

  it('refuses junk without losing what it has, forgets a seat that left and tells the seats it knows', () => {
    const clock = new ManualScheduler();
    const b = new RivalBoard(() => clock.now());
    b.accept('s2', ghostFrame(1000, 100, body()));
    b.accept('s3', ghostFrame(1000, 50));
    expect(b.accept('s2', { mt: 'x', sc: 1 })).toBe(false);
    expect(b.accept('s2', null)).toBe(false);
    expect(b.score('s2')).toBe(100);
    expect(b.seats().sort()).toEqual(['s2', 's3']);
    b.forget('s2');
    expect(b.seats()).toEqual(['s3']);
    b.clear();
    expect(b.seats()).toEqual([]);
  });
});
