// The guide over the camera picture: a closed outline of a person at every size and framing, inside the picture, with the
// words of the missing parts on amber bands that stay inside the picture too.
import { describe, expect, it } from 'vitest';
import { framingGuide, outline } from './silhouette.ts';

const SIZES: [number, number][] = [[360, 420], [390, 540], [412, 600], [700, 360], [915, 330], [768, 700], [1024, 600], [1440, 780], [1920, 960]];
const FRAMINGS = ['full', 'upper', 'side', 'desk'] as const;
const LABELS = { head: 'Head', shoulders: 'Shoulders', hips: 'Hips', knees: 'Knees', feet: 'Feet' };

describe('the outline of a person', () => {
  it('is a closed smooth path with no broken numbers', () => {
    const d = outline([[1, 1], [3, 2], [2, 6]], true, (x, y) => [10 + x, 5 + y]);
    expect(d.startsWith('M')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    expect(d).not.toMatch(/NaN|Infinity|undefined/);
    expect(d.match(/C/g)?.length).toBe(6);
  });
});

describe('the framing guide', () => {
  for (const framing of FRAMINGS) {
    for (const [w, h] of SIZES) {
      it(`${framing} at ${w}x${h}: the outline and every band lie inside the picture`, () => {
        const svg = framingGuide(w, h, { framing, ready: false, missing: ['head', 'shoulders', 'hips', 'knees', 'feet'], labels: LABELS });
        expect(svg).toContain('aria-hidden="true"');
        expect(svg).not.toMatch(/NaN|Infinity|undefined/);
        for (const m of svg.matchAll(/<rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)) {
          const [x, y, rw, rh] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
          expect(x, 'band left').toBeGreaterThanOrEqual(-0.5);
          expect(y, 'band top').toBeGreaterThanOrEqual(-0.5);
          expect(x + rw, 'band right').toBeLessThanOrEqual(w + 0.5);
          expect(y + rh, 'band bottom').toBeLessThanOrEqual(h + 0.5);
        }
        // every point of the outline is inside the picture
        const path = /<path d="([^"]+)"/.exec(svg)?.[1] ?? '';
        const nums = [...path.matchAll(/-?[\d.]+/g)].map((n) => Number(n[0]));
        for (let i = 0; i < nums.length; i += 2) {
          const px = nums[i] as number, py = nums[i + 1] as number;
          // control points may swing a little past the body; the picture edge is the limit
          expect(px, 'x').toBeGreaterThan(-w * 0.02);
          expect(px, 'x').toBeLessThan(w * 1.02);
          expect(py, 'y').toBeGreaterThan(-h * 0.02);
          // the upper body and the desk draw the whole figure and clip it at the cut line: that line is the limit
          if (framing === 'full' || framing === 'side') expect(py, 'y').toBeLessThan(h * 1.02);
        }
        const cutAt = /<line [^>]*y1="([\d.]+)"/.exec(svg)?.[1];
        if (framing === 'upper' || framing === 'desk') {
          expect(cutAt, 'a cut line').toBeDefined();
          expect(Number(cutAt)).toBeLessThanOrEqual(h);
          expect(Number(cutAt)).toBeGreaterThan(h * 0.5);
        }
      });
    }
  }

  it('names only the parts that are missing, with the words it was given', () => {
    const svg = framingGuide(800, 600, { framing: 'full', ready: false, missing: ['hips'], labels: LABELS });
    expect(svg).toContain('>Hips<');
    expect(svg).not.toContain('>Feet<');
    expect(svg).not.toContain('>Knees<');
  });

  it('turns green when the whole body that is asked for is in view', () => {
    expect(framingGuide(800, 600, { framing: 'full', ready: true, missing: [], labels: LABELS })).toContain('#22C383');
    expect(framingGuide(800, 600, { framing: 'full', ready: false, missing: [], labels: LABELS })).not.toContain('#22C383');
  });

  it('the upper body and the desk are cut off with a line, the whole body is not', () => {
    expect(framingGuide(800, 600, { framing: 'full', ready: false, missing: [], labels: LABELS })).not.toContain('<line');
    expect(framingGuide(800, 600, { framing: 'upper', ready: false, missing: [], labels: LABELS })).toContain('<line');
    expect(framingGuide(800, 600, { framing: 'desk', ready: false, missing: [], labels: LABELS })).toContain('<line');
  });

  it('skips a band for a part below the cut, and a label with a markup character is the caller\'s to escape', () => {
    const svg = framingGuide(800, 600, { framing: 'desk', ready: false, missing: ['feet', 'knees'], labels: LABELS });
    expect(svg).not.toContain('>Feet<');
    expect(svg).not.toContain('>Knees<');
  });
});
