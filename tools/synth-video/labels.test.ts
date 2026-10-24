import { describe, expect, it } from 'vitest';
import { CLIPS, bump, clipById, repeat } from './moves.ts';
import { crossings, labelsFor, peaks, type Dims, type TruthFrame } from './labels.ts';
import type { TruthJoint, TruthPerson } from './render.page.ts';

const D: Dims = { T: 0.5, W: 0.4, A: 0.7, U: 0.45, restHipY: 1, restHipX: 0 };
const j = (wx: number, wy: number): TruthJoint => ({ x: 0.5, y: 0.5, wx, wy, wz: 0 });

/** Frames at 30 per second of a person made of hips and shoulders only, as a function of time. */
function frames(seconds: number, f: (t: number) => { hipY?: number; hipX?: number; shX?: number; lowL?: number }): TruthFrame[] {
  const out: TruthFrame[] = [];
  for (let i = 0; i <= seconds * 30; i++) {
    const t = i / 30;
    const s = f(t);
    const hipY = s.hipY ?? 1;
    const person: TruthPerson = {
      upLegL: j((s.hipX ?? 0) + 0.1, hipY), upLegR: j((s.hipX ?? 0) - 0.1, hipY),
      armL: j((s.shX ?? 0) + 0.2, hipY + D.T), armR: j((s.shX ?? 0) - 0.2, hipY + D.T),
      lowLegL: j(0.1, s.lowL ?? 1 - D.U), lowLegR: j(-0.1, 1 - D.U),
    };
    out.push({ t: Math.round(t * 1000), people: [person] });
  }
  return out;
}

describe('series helpers', () => {
  it('finds crossings in both directions with the time between frames', () => {
    const t = [0, 100, 200, 300, 400];
    const v = [0, 1, 3, 1, 0];
    expect(crossings(t, v, 2, 'up')).toEqual([150]);
    expect(crossings(t, v, 2, 'down')).toEqual([250]);
    expect(crossings(t, v, 5, 'up')).toEqual([]);
  });

  it('finds peaks that reach a height and stand out from what follows', () => {
    const t = Array.from({ length: 12 }, (_, i) => i * 100);
    const v = [0, 0.4, 0.9, 0.5, 0.1, 0.3, 0.45, 0.4, 0.1, 0.2, 0.8, 0.7];
    expect(peaks(t, v, 0.5, 0.08)).toEqual([[200, 0.9], [1000, 0.8]]);
  });
});

describe('moves', () => {
  it('has a bump that rises, holds and falls, and repeats it', () => {
    expect([0, 1, 1.5, 2.2, 3].map((x) => Math.round(bump(x, 1, 0.5, 0.5, 0.5) * 100) / 100)).toEqual([0, 0, 1, 0.65, 0]);
    expect(repeat(3.5, 1, 2, 3, 0.5, 0.5, 0.5)).toBe(bump(1.5, 1, 0.5, 0.5, 0.5));
    expect(repeat(7.5, 1, 2, 3, 0.5, 0.5, 0.5)).toBe(0);
  });

  it('has a clip for every label rule and every one is a pure function of time', () => {
    expect(new Set(CLIPS.map((c) => c.rule)).size).toBe(CLIPS.length);
    for (const c of CLIPS) {
      for (let i = 0; i < c.people; i++) expect(JSON.stringify(c.pose(2.3, i))).toBe(JSON.stringify(c.pose(2.3, i)));
      expect(c.seconds).toBeGreaterThan(5);
    }
    expect(clipById('squat-6x')?.people).toBe(1);
    expect(clipById('pair-squat')?.people).toBe(2);
  });
});

describe('labels', () => {
  it('a rep of the squat is counted when the hips come back under 0.12 T after 0.35 T', () => {
    // hips drop 0.5 T (0.25 m) between 1 and 2 s and come back by 3 s: counted at the crossing of 0.12 T = 0.06 m on the way up.
    const f = frames(5, (t) => ({ hipY: 1 - 0.25 * (t < 1 ? 0 : t < 2 ? (t - 1) : t < 3 ? 3 - t : 0) }));
    const l = labelsFor(clipById('squat-6x')!, f, [D], 30);
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ id: 'squat', kind: 'rep' });
    // y = 1 - 0.25 (3 - t) = 1 - 0.06  ->  t = 3 - 0.24 = 2.76 s
    expect(l[0]?.t).toBeGreaterThan(2740);
    expect(l[0]?.t).toBeLessThan(2790);
  });

  it('a dip under 0.35 T gives no rep', () => {
    const f = frames(5, (t) => ({ hipY: 1 - 0.1 * (t < 1 ? 0 : t < 2 ? (t - 1) : t < 3 ? 3 - t : 0) }));
    expect(labelsFor(clipById('squat-6x')!, f, [D], 30)).toEqual([]);
  });

  it('a jump is the hips rising 0.20 T above rest, once per rise', () => {
    const f = frames(5, (t) => ({ hipY: 1 + 0.4 * Math.max(0, Math.sin(Math.PI * (t - 1))) * (t > 1 && t < 2 ? 1 : 0) }));
    const l = labelsFor(clipById('jump-5x')!, f, [D], 30);
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ id: 'jump', kind: 'rep' });
  });

  it('a lean enters the lane at 0.30 W and leaves it under 0.16 W, on the player\'s right when the shoulders go to -X', () => {
    // 0.3 W = 0.12 m. The shoulders move to -X (the person's right) by up to 0.2 m between 1 and 2 s and back by 3 s.
    const f = frames(5, (t) => ({ shX: -0.2 * (t < 1 ? 0 : t < 2 ? (t - 1) : t < 3 ? 3 - t : 0) }));
    const l = labelsFor(clipById('lean-lr')!, f, [D], 30);
    expect(l.map((x) => `${x.kind}:${x.side}`)).toEqual(['holdStart:R', 'holdEnd:R']);
    expect(l[0]!.t).toBeGreaterThan(1550);
    expect(l[0]!.t).toBeLessThan(1650);
  });

  it('a stand-still clip is one marker', () => {
    expect(labelsFor(clipById('idle-10s')!, frames(2, () => ({})), [D], 30)).toMatchObject([{ id: 'still', kind: 'marker', t: 0 }]);
  });

  it('says which leg lifted for a march', () => {
    // The left knee rises to hip height (k = 1) between 1 and 1.5 s and comes down by 2 s.
    const f = frames(3, (t) => ({ lowL: 1 - D.U + D.U * (t < 1 ? 0 : t < 1.5 ? (t - 1) / 0.5 : t < 2 ? (2 - t) / 0.5 : 0) }));
    const l = labelsFor(clipById('march-10x')!, f, [D], 30);
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ id: 'kneeLift', kind: 'rep', side: 'L' });
    expect(l[0]!.t).toBeGreaterThan(1450);
    expect(l[0]!.t).toBeLessThan(1550);
  });
});
