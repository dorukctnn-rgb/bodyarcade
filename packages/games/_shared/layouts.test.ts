// How much of its play area each game's figure takes on every screen of design/LAYOUT.md (and with two players on the big ones). The
// layouts are pure functions of the play area and the self view window, so this needs no canvas, only the platform's own placement of
// the HUD (the real 2D kit on a fake canvas). Found on the screens: a figure that was a fifth of a TV's height, a landscape phone's
// figure smaller than its play area allowed. Each game's own test says where things stand; this one says they are not small.
import { describe, expect, it } from 'vitest';
import { BREAKPOINTS } from '../../core/ui/layout.ts';
import { lbLayout } from '../gatepose/limbo-view.ts';
import { pwLayout } from '../gatepose/posewall-view.ts';
import { fjLayout, type Geometry } from '../strength/fireworks-view.ts';
import { ttLayout } from '../strength/turbine-view.ts';
import { sceneUnit, stageOf } from './stage.ts';
import { testKit, testKitDuo } from './testing/context.ts';

interface Rect { x: number; y: number; w: number; h: number }

/** The box each game keeps its player figure in, per zone, for a geometry. */
const FIGURES: Record<string, (g: Geometry, players: 1 | 2) => Rect[]> = {
  'Firework Jacks': (g, p) => fjLayout(g, p).zones.map((z) => z.keep[0] as Rect),
  'Twist Turbine': (g) => [ttLayout(g).keep.avatar],
  'Limbo Bend': (g, p) => lbLayout(g, p).zones.map((z) => z.keep),
  'Pose Wall': (g, p) => pwLayout(g, p).zones.map((z) => z.keep),
};

const geometryOf = (t: ReturnType<typeof testKit>): Geometry => {
  const s = stageOf(t.kit) as NonNullable<ReturnType<typeof stageOf>>;
  return { w: s.w, h: s.h, play: s.play, pip: s.pip, lanes: s.lanes };
};

describe.each(Object.entries(FIGURES))('%s: the figure on every screen', (name, boxes) => {
  it.each(BREAKPOINTS.map((b) => [b.id, b.w, b.h] as const))('%s: it fills its play area as far as the width and the self view allow, and stays inside it', (_id, w, h) => {
    for (const corner of ['bottom-left', 'bottom-right'] as const) {
      const t = testKit(w, h, { corner });
      const g = geometryOf(t);
      for (const box of boxes(g, 1)) {
        // inside the play area, never wider than the screen
        expect(box.y, `${corner}: top`).toBeGreaterThanOrEqual(g.play.y - 1);
        expect(box.y + box.h, `${corner}: bottom`).toBeLessThanOrEqual(g.play.y + g.play.h + 0.1 * box.h);   // a foot may touch the ground line
        expect(box.x, `${corner}: left`).toBeGreaterThanOrEqual(-1);
        expect(box.x + box.w, `${corner}: right`).toBeLessThanOrEqual(w + 1);
        // not small: at least a third of the play area's height, or (a phone held upright) as wide as the width gives room for
        const tall = box.h / g.play.h;
        const wide = box.w / g.play.w;
        expect(Math.max(tall, wide * 1.4), `${corner}: ${Math.round(box.w)}x${Math.round(box.h)} in ${Math.round(g.play.w)}x${Math.round(g.play.h)}`).toBeGreaterThanOrEqual(0.33);
      }
    }
  });

  it('grows with the screen: on a TV the figure is taller in pixels than on a laptop, which is taller than on a tablet', () => {
    const hOf = (w: number, h: number): number => Math.max(...boxes(geometryOf(testKit(w, h, { corner: 'bottom-left' })), 1).map((b) => b.h));
    expect(sceneUnit(1920, 1080)).toBeGreaterThan(sceneUnit(1024, 768));
    expect(hOf(1920, 1080)).toBeGreaterThan(hOf(1280, 800));
    expect(hOf(1280, 800)).toBeGreaterThan(hOf(1024, 768) * 0.95);
  });

  it('two players on the four big screens: one figure in each lane, each as tall as its lane allows', () => {
    if (name === 'Twist Turbine') return;            // one player only
    for (const b of BREAKPOINTS.filter((x) => x.w >= 1000 && x.w > x.h)) {
      const t = testKitDuo(b.w, b.h);
      const g = geometryOf(t);
      expect(g.lanes, b.id).not.toBeNull();
      const zones = boxes(g, 2);
      expect(zones, b.id).toHaveLength(2);
      for (const [i, box] of zones.entries()) {
        const lane = (g.lanes as NonNullable<Geometry['lanes']>)[i] as Rect;
        expect(box.x, `${b.id} lane ${i}`).toBeGreaterThanOrEqual(lane.x - 1);
        expect(box.x + box.w, `${b.id} lane ${i}`).toBeLessThanOrEqual(lane.x + lane.w + 1);
        expect(box.h / lane.h, `${b.id} lane ${i}`).toBeGreaterThanOrEqual(0.33);
      }
    }
  });
});
