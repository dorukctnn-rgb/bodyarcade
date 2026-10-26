// The guide over the camera picture: a closed outline of a person at every size and framing, inside the picture, with the
// words of the missing parts on amber bands that stay inside the picture too.
import { describe, expect, it } from 'vitest';
import { framingGuide, outline, STAND_IN_SCALE } from './silhouette.ts';

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

  for (const framing of ['full', 'upper', 'desk'] as const) {
    for (const [w, h] of SIZES) {
      it(`headroom, ${framing} at ${w}x${h}: the raised arms and every band stay inside the picture`, () => {
        const svg = framingGuide(w, h, { framing, ready: false, missing: ['head', 'shoulders', 'hips', 'knees', 'feet'], labels: LABELS, headroom: true });
        expect(svg).not.toMatch(/NaN|Infinity|undefined/);
        const path = /<path d="([^"]+)"/.exec(svg)?.[1] ?? '';
        const nums = [...path.matchAll(/-?[\d.]+/g)].map((n) => Number(n[0]));
        let top = Infinity;
        for (let i = 0; i < nums.length; i += 2) {
          const px = nums[i] as number, py = nums[i + 1] as number;
          expect(px, 'x').toBeGreaterThan(-w * 0.02);
          expect(px, 'x').toBeLessThan(w * 1.02);
          top = Math.min(top, py);
        }
        // the hands have room: the highest point of the figure is clear of the top edge
        expect(top, 'the hands are inside the picture').toBeGreaterThan(h * 0.03);
        for (const m of svg.matchAll(/<rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)) {
          const [x, y, rw, rh] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
          expect(x).toBeGreaterThanOrEqual(-0.5);
          expect(y).toBeGreaterThanOrEqual(-0.5);
          expect(x + rw).toBeLessThanOrEqual(w + 0.5);
          expect(y + rh).toBeLessThanOrEqual(h + 0.5);
        }
      });
    }
  }

  it('headroom raises the arms: the outline reaches well above the head, and without it nothing does', () => {
    const measure = (headroom: boolean): { arms: number } => {
      const svg = framingGuide(800, 600, { framing: 'full', ready: false, missing: [], labels: LABELS, headroom });
      const path = /<path d="([^"]+)"/.exec(svg)?.[1] ?? '';
      const ys = [...path.matchAll(/-?[\d.]+/g)].map((n) => Number(n[0])).filter((_, i) => i % 2 === 1);
      const e = /<ellipse cx="[\d.]+" cy="([\d.]+)" rx="[\d.]+" ry="([\d.]+)"/.exec(svg);
      return { arms: Number(e?.[1]) - Number(e?.[2]) - Math.min(...ys) };
    };
    expect(measure(true).arms, 'arms above the head').toBeGreaterThan(15);
    expect(measure(false).arms, 'no arms above the head').toBeLessThan(8);
  });

  /** The box round every number of a path (anchors and control points). */
  const boxOf = (d: string): { l: number; t: number; r: number; b: number } => {
    const n = [...d.matchAll(/-?[\d.]+/g)].map((m) => Number(m[0]));
    const xs = n.filter((_, i) => i % 2 === 0);
    const ys = n.filter((_, i) => i % 2 === 1);
    return { l: Math.min(...xs), t: Math.min(...ys), r: Math.max(...xs), b: Math.max(...ys) };
  };

  for (const framing of FRAMINGS) {
    for (const headroom of [false, true]) {
      for (const [w, h] of [...SIZES, [960, 600], [1280, 800], [1420, 1080], [2060, 1440]] as [number, number][]) {
        if (headroom && framing === 'side') continue;
        it(`a made-up person, ${framing}${headroom ? ' with headroom' : ''} at ${w}x${h}: inside its outline, a little smaller, the same shape`, () => {
          const svg = framingGuide(w, h, { framing, ready: false, missing: [], labels: LABELS, headroom, standIn: true });
          expect(svg).not.toMatch(/NaN|Infinity|undefined/);
          const person = /<path data-standin-body d="([^"]+)"/.exec(svg)?.[1] ?? '';
          const dashed = /<path d="([^"]+)"/.exec(svg)?.[1] ?? '';
          expect(person, 'the made-up person is drawn').not.toBe('');
          const p = boxOf(person);
          const o = boxOf(dashed);
          // inside the outline on every side (the numbers of a path are rounded to a tenth of a pixel)
          expect(p.l).toBeGreaterThanOrEqual(o.l - 0.2);
          expect(p.r).toBeLessThanOrEqual(o.r + 0.2);
          expect(p.t).toBeGreaterThanOrEqual(o.t - 0.2);
          expect(p.b).toBeLessThanOrEqual(o.b + 0.2);
          // smaller by the scale it says, in both directions: never "larger than its outline"
          expect((p.r - p.l) / (o.r - o.l)).toBeCloseTo(STAND_IN_SCALE, 1);
          expect((p.b - p.t) / (o.b - o.t)).toBeCloseTo(STAND_IN_SCALE, 1);
          // the same room above it as under it (where the outline is whole: the upper body is cut at a line)
          if (framing === 'full' || framing === 'side') expect(Math.abs((p.t - o.t) - (o.b - p.b)), 'room above against room under').toBeLessThanOrEqual(Math.max(2, h * 0.02));
          // and the head is inside the outline's head
          const head = /<ellipse data-standin-head cx="([\d.]+)" cy="([\d.]+)" rx="([\d.]+)" ry="([\d.]+)"/.exec(svg);
          const outer = /<ellipse cx="([\d.]+)" cy="([\d.]+)" rx="([\d.]+)" ry="([\d.]+)"/.exec(svg);
          expect(Number(head?.[3])).toBeLessThan(Number(outer?.[3]));
          expect(Number(head?.[4])).toBeLessThan(Number(outer?.[4]));
        });
      }
    }
  }

  it('draws no made-up person unless it is asked to (the player is in the camera picture)', () => {
    for (const framing of FRAMINGS) {
      expect(framingGuide(800, 600, { framing, ready: false, missing: [], labels: LABELS })).not.toContain('data-standin');
      expect(framingGuide(800, 600, { framing, ready: false, missing: [], labels: LABELS, standIn: false })).not.toContain('data-standin');
    }
  });

  it('the made-up person is under the dashes and is clipped at the cut line with the outline', () => {
    const svg = framingGuide(800, 600, { framing: 'upper', ready: false, missing: [], labels: LABELS, standIn: true });
    expect(svg.indexOf('data-standin-body')).toBeLessThan(svg.indexOf('stroke-dasharray'));
    expect(svg.indexOf('clip-path="url(#ba-guide-clip)"')).toBeLessThan(svg.indexOf('data-standin-body'));
  });

  it('skips a band for a part below the cut, and a label with a markup character is the caller\'s to escape', () => {
    const svg = framingGuide(800, 600, { framing: 'desk', ready: false, missing: ['feet', 'knees'], labels: LABELS });
    expect(svg).not.toContain('>Feet<');
    expect(svg).not.toContain('>Knees<');
  });
});
