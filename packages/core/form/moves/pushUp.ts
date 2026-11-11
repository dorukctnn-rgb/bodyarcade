// Push-up (and the knee push-up). SPEC.md 5.4 row 27-28, rules ELB-DEP, LINE, HANDS, TEMPO. Camera from the side, on the floor.
//
// Progress: the near elbow's angle, p = (165 - elbow) / 60 (target 105 degrees), or the shoulder's drop towards the hands,
// whichever is deeper (see progress()). Counted only while the body lies along the
// picture (shoulder-to-feet line within 40 degrees of level), so bending the arms while standing never counts.
// The body line is the bend at the hip between the shoulder and the ankle (the knee when the knees are down): below 160 the
// hips sag, above 200 they are piked up. From the side only: at an angle the bend looks sharper than it is.
// Not measured: elbows flaring out (a front-view thing), the head (Faz 2), the shoulder blades.
import { angleAt, bendFromFloor, fromHorizontal, type Side } from '../geometry.ts';
import type { BodyCtx, FormMoveId, MoveDef } from '../types.ts';
import { forearm, thigh, upperArm } from '../segments.ts';
import { all, at } from './kit.ts';

type B = Pick<BodyCtx, 'pts' | 'near' | 'view'>;

/** The end of the body line: the ankle, or the knee when the knees are on the floor (knee bent under 130 degrees). */
function lineEnd(b: B, s: Side, count = false) {
  const hip = at(b, s, 'hip', count), knee = at(b, s, 'knee', count), ankle = at(b, s, 'ankle', count);
  if (hip && knee && ankle && angleAt(hip, knee, ankle) < 130) return knee;
  return ankle ?? null;
}

/** The body lies along the picture (a plank position), from the near shoulder to the feet or knees (`maxTilt`: how steep it may be). */
export function inPlank(b: B, count = true, maxTilt = 40): boolean {
  const sh = at(b, b.near, 'shoulder', count), end = lineEnd(b, b.near, count);
  return !!sh && !!end && fromHorizontal(sh, end) < maxTilt;
}

export function bodyLine(b: B, maxTilt = 40): number | null {
  const sh = at(b, b.near, 'shoulder'), hip = at(b, b.near, 'hip'), end = lineEnd(b, b.near);
  if (!sh || !hip || !end || fromHorizontal(sh, end) >= maxTilt) return null;
  return bendFromFloor(sh, hip, end);
}

export interface PushUpOpts {
  id: FormMoveId;
  equipment?: MoveDef['equipment'];
  /** How steep the body may be (an incline push-up with the hands on a high surface). */
  maxTilt?: number;
  /** The elbow angle that counts as the bottom (105 on the floor, 110 on an incline). */
  bottom?: number;
}

/** The push-up family on the floor: the same measurements, one definition per variant (SPEC.md 5.4 rows 27-33). */
export function makePushUp(o: PushUpOpts): MoveDef {
  const maxTilt = o.maxTilt ?? 40, span = 165 - (o.bottom ?? 105);
  return {
    id: o.id,
    label: 'F',
    group: 'floor',
    ...(o.equipment ? { equipment: o.equipment } : {}),
    views: ['side', 'diag'],
    lying: true,
    parts: ['head', 'shoulders', 'elbows', 'hands', 'hips', 'knees', 'feet'],
    rep: { countAt: 0.45, upAt: 0.2, fullAt: 1, minMs: 500 },
    progress(b) {
      if (!inPlank(b, true, maxTilt)) return null;
      const a = all(b, b.near, ['shoulder', 'elbow', 'wrist'], true);
      if (!a) return null;
      // two views of the same depth, the larger wins: the elbow's bend, and how far the shoulder came down to the hands (in arm
      // lengths; 0.5 is what a 90-degree elbow gives). On real video a close grip hid the elbow behind the body and its angle read
      // 120-130 degrees at a full-depth bottom, while the shoulder-to-hand drop read it right (pu-tf-crush-side, 11 Nov 2026).
      // The drop counts only with the elbow bent (under 150): walking the hands out into the plank tilts straight arms and
      // shortens the drop without any push-up (pu-cdc-knee-45 counted one that way).
      const elbow = angleAt(a[0]!, a[1]!, a[2]!);
      const byElbow = (165 - elbow) / span;
      const armLen = b.len.upperArm + b.len.forearm;
      const byDrop = armLen > 0 && elbow < 150 ? (0.95 - (a[2]!.y - a[0]!.y) / armLen) / 0.45 : 0;
      return Math.max(0, Math.min(1.5, Math.max(byElbow, byDrop)));
    },
    rules: [
      {
        kind: 'rep', id: 'pushUp.depth', severity: 'error', views: ['side', 'diag'],
        judge: (r) => r.maxP < 1,
        segments: (b) => [upperArm(b.near), forearm(b.near)],
        cue: 'pushUp.lower',
      },
      {
        kind: 'live', id: 'pushUp.line', severity: 'error', views: ['side'], phases: ['top', 'down', 'bottom', 'up'],
        measure: (b) => (inPlank(b, true, maxTilt) ? bodyLine(b, maxTilt) : null),
        bad: (v) => v < 160 || v > 200, clear: (v) => v >= 165 && v <= 195,
        segments: (b) => ['torso', thigh(b.near)],
        cue: (v) => (v < 180 ? 'pushUp.hipsUp' : 'pushUp.hipsDown'),
        holdMs: 200,
      },
      {
        kind: 'live', id: 'pushUp.hands', severity: 'tip', views: ['side'], phases: ['top'],
        measure(b) {
          if (!inPlank(b, true, maxTilt)) return null;
          const sh = at(b, b.near, 'shoulder'), wr = at(b, b.near, 'wrist');
          const armLen = b.len.upperArm + b.len.forearm;
          if (!sh || !wr || armLen <= 0) return null;
          return Math.abs(wr.x - sh.x) / armLen;
        },
        bad: (v) => v > 0.35, clear: (v) => v < 0.25,
        segments: (b) => [forearm(b.near)],
        cue: 'pushUp.handsUnder',
        holdMs: 400,
      },
      {
        kind: 'rep', id: 'pushUp.tempo', severity: 'tip', views: ['side', 'diag'],
        judge: (r) => r.bottomT - r.startT < 350,
        segments: () => [],
        cue: 'tempo.slower',
      },
    ],
    returnCue: 'pushUp.armsStraight',
  };
}

export const pushUp: MoveDef = makePushUp({ id: 'pushUp' });
