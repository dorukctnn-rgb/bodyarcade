// The "how it works" scene at the top of the home page (how.ts, views/how.ts): the person and the character come from the same points
// of the same frame, the still is the bottom of the squat, the loop goes round without a jump, and the markup has the shapes the
// moving picture paints, in the same order.
import { describe, expect, it } from 'vitest';
import { framePoints, HOW_FLOOR, HOW_H, HOW_LOOP, HOW_STILL, HOW_T, HOW_W, moverShapes, personShapes } from './how.ts';
import { shapesMarkup } from './views/how.ts';

const hipY = (f: number): number => { const p = framePoints(f); const i = HOW_LOOP.points.indexOf('hipL'), j = HOW_LOOP.points.indexOf('hipR'); return (p[i]!.y + p[j]!.y) / 2; };

describe('the how-it-works scene', () => {
  it('is one squat of a real person: standing at the start, the hips at their lowest at the still, standing again at the end', () => {
    expect(HOW_LOOP.frames).toBeGreaterThan(60);
    expect(HOW_LOOP.person).toHaveLength(HOW_LOOP.frames);
    expect(HOW_LOOP.source).toMatch(/mixkit-52106/);
    const drop = hipY(HOW_STILL) - hipY(0);
    expect(drop).toBeGreaterThan(HOW_T * 0.5);
    expect(Math.abs(hipY(HOW_LOOP.frames - 1) - hipY(0))).toBeLessThan(HOW_T * 0.1);
  });

  it('stays in the picture, feet on the floor, and goes round: frame n is frame 0, a half frame lies between its two frames', () => {
    for (let f = 0; f < HOW_LOOP.frames; f += 1) for (const p of framePoints(f)) {
      expect(p.x).toBeGreaterThan(0); expect(p.x).toBeLessThan(HOW_W);
      expect(p.y).toBeGreaterThan(0); expect(p.y).toBeLessThanOrEqual(HOW_FLOOR + 0.5);
    }
    expect(framePoints(HOW_LOOP.frames)).toEqual(framePoints(0));
    expect(framePoints(-1)).toEqual(framePoints(HOW_LOOP.frames - 1));
    const [a, b, m] = [framePoints(10)[0]!, framePoints(11)[0]!, framePoints(10.5)[0]!];
    expect(m.x).toBeCloseTo((a.x + b.x) / 2, 6);
    expect(HOW_H).toBe(300);
  });

  it('draws the character from the same joints as the person: the wrist bands end on the wrists, the legs on the ankles', () => {
    const pts = framePoints(HOW_STILL);
    const at = (n: string) => pts[HOW_LOOP.points.indexOf(n)]!;
    const mover = moverShapes(pts);
    const ends = mover.filter((s) => s.tag === 'line').map((s) => `${s.geo['x2']},${s.geo['y2']}`);
    for (const j of ['wristL', 'wristR', 'ankleL', 'ankleR']) expect(ends).toContain(`${at(j).x},${at(j).y}`);
    const person = personShapes(pts);
    expect(person.filter((s) => s.style['stroke'] === '#22C383' && s.tag === 'line')).toHaveLength(12);
  });

  it('writes every shape once with its moving attributes, in the order the moving picture paints them', () => {
    const shapes = personShapes(framePoints(HOW_STILL));
    const svg = shapesMarkup(shapes);
    expect(svg.match(/ data-g /g)).toHaveLength(shapes.length);
    expect(svg).not.toMatch(/NaN|undefined/);
    expect(shapesMarkup(moverShapes(framePoints(0))).match(/<(line|circle|polygon) data-g/g)).toHaveLength(moverShapes(framePoints(0)).length);
  });
});
