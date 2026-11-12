// Glute bridge, lying on the back. SPEC.md 5.3 row 18, rules HIP-EXT, HIP-OVER, FEET. Camera from the side, on the floor.
//
// Progress: the bend at the near hip between the shoulder and the knee, measured on the floor side (bendFromFloor): about 135
// lying flat with the knees up, 180 in a straight line from the shoulders to the knees. p = (hip - 140) / 25, target 165.
// Counted only while the shoulders and the feet are on the floor (their line within 30 degrees of level).
// Not measured: the knees falling in or out (a front-view thing), squeezing the glutes, the lower back on the floor.
// NOTE (11 Nov 2026): no freely licensed real video of a glute bridge was found; this move is tested on geometry only until
// Doruk's own recording arrives (SPEC.md 7.3). It must not ship before that measurement.
import { angleAt, bendFromFloor, fromHorizontal } from '../geometry.ts';
import type { BodyCtx, MoveDef } from '../types.ts';
import { shin, thigh } from '../segments.ts';
import { all, at } from './kit.ts';

type B = Pick<BodyCtx, 'pts' | 'near' | 'view'>;

export function lyingBack(b: B, count = true): boolean {
  const sh = at(b, b.near, 'shoulder', count), an = at(b, b.near, 'ankle', count);
  return !!sh && !!an && fromHorizontal(sh, an) < 30;
}

export function hipBend(b: B, count = false): number | null {
  const p = all(b, b.near, ['shoulder', 'hip', 'knee'], count);
  return p ? bendFromFloor(p[0]!, p[1]!, p[2]!) : null;
}

export const gluteBridge: MoveDef = {
  id: 'gluteBridge',
  label: 'F',
  group: 'floor',
  views: ['side'],
  lying: true,
  parts: ['shoulders', 'hips', 'knees', 'feet'],
  rep: { countAt: 0.45, upAt: 0.25, fullAt: 1, minMs: 600 },
  progress(b) {
    if (!lyingBack(b)) return null;
    const h = hipBend(b, true);
    return h === null ? null : Math.max(0, Math.min(1.6, (h - 140) / 25));
  },
  rules: [
    {
      kind: 'rep', id: 'bridge.height', severity: 'error', views: ['side'],
      judge: (r) => r.maxP < 1,
      segments: (b) => ['torso', thigh(b.near)],
      cue: 'bridge.higher',
    },
    {
      kind: 'live', id: 'bridge.arch', severity: 'tip', views: ['side'], minP: 0.8,
      measure: (b) => hipBend(b),
      bad: (v) => v > 200, clear: (v) => v < 192,
      segments: () => ['torso'],
      cue: 'bridge.ribsDown',
      holdMs: 250,
    },
    {
      kind: 'live', id: 'bridge.feet', severity: 'tip', views: ['side'], minP: 0.8, phases: ['bottom'],
      measure(b) {
        const p = all(b, b.near, ['hip', 'knee', 'ankle']);
        return p ? angleAt(p[0]!, p[1]!, p[2]!) : null;
      },
      bad: (v) => v < 65 || v > 115, clear: (v) => v >= 70 && v <= 110,
      segments: (b) => [shin(b.near)],
      cue: (v) => (v > 110 ? 'bridge.feetCloser' : 'bridge.feetFarther'),
      holdMs: 300,
    },
  ],
  returnCue: 'bridge.lowerFully',
};
