// Squat (bodyweight or goblet). SPEC.md 5.1 row 1, rules DEP-F / DEP-S, KNEE-IN, SHIFT, TORSO, TEMPO.
//
// Progress: from the front or at an angle, how far the hips came down towards the knees: h = (knee y - hip y) / thigh length,
// which is 1 standing and 0 with the thighs level, whatever way the player faces (the vertical drop does not depend on the
// camera's direction; the thigh length is the running maximum of the standing thigh). Target (progress 1): h = 0.20 from the
// front (thighs within about 12 degrees of level; the camera cannot see the last bit of depth reliably), so p = (1 - h) / 0.80. From the side the near knee's angle is
// exact: p = (170 - knee) / 70, target 100 degrees.
//
// Not measured (SPEC 5.1): heels lifting (the heel and toe points jitter more than a heel lifts), a rounding back (no points
// on the spine); from the front the forward lean (a side-view thing), from the side the knees caving in (a front-view thing).
import { angleAt, fromVertical, type Side } from '../geometry.ts';
import type { BodyCtx, MoveDef } from '../types.ts';
import { shin, thigh } from '../segments.ts';
import { all, at, pair } from './kit.ts';

const FRONT_TARGET_H = 0.2;

function frontProgress(b: Pick<BodyCtx, 'pts' | 'near' | 'view' | 'len'>): number | null {
  if (b.len.thigh <= 0) return null;
  let sum = 0, n = 0;
  for (const s of ['L', 'R'] as const) {
    const hip = at(b, s, 'hip', true), knee = at(b, s, 'knee', true);
    if (!hip || !knee) continue;
    sum += (knee.y - hip.y) / b.len.thigh; n++;
  }
  if (n === 0) return null;
  const h = sum / n;
  return Math.max(0, Math.min(1.4, (1 - h) / (1 - FRONT_TARGET_H)));
}

function kneeAngle(b: Pick<BodyCtx, 'pts' | 'near' | 'view'>, s: Side, count = false): number | null {
  const p = all(b, s, ['hip', 'knee', 'ankle'], count);
  return p ? angleAt(p[0]!, p[1]!, p[2]!) : null;
}

/** How far the knee of side s sits inside the hip-ankle line, in leg lengths (positive = towards the body's middle). */
export function kneeInside(b: Pick<BodyCtx, 'pts' | 'near' | 'view'>, s: Side): number | null {
  const p = all(b, s, ['hip', 'knee', 'ankle']);
  const hips = pair(b, 'hip');
  if (!p || !hips) return null;
  const [hip, knee, ankle] = p as [typeof p[0], typeof p[0], typeof p[0]];
  const leg = Math.hypot(ankle.x - hip.x, ankle.y - hip.y);
  if (leg <= 0 || Math.abs(ankle.y - hip.y) < 1e-6) return null;
  const u = (knee.y - hip.y) / (ankle.y - hip.y);
  const lineX = hip.x + u * (ankle.x - hip.x);
  const toMiddle = Math.sign(hips.x - lineX) || 1;
  return ((knee.x - lineX) * toMiddle) / leg;
}

export const squat: MoveDef = {
  id: 'squat',
  views: ['front', 'diag', 'side'],
  parts: ['head', 'shoulders', 'hips', 'knees', 'feet'],
  // countAt 0.55: a quarter squat is not counted (the coach says to go deeper); on real video a kettlebell swing's forward
  // bend reached 0.53 and would have counted at 0.45 (sq-tf-frontraise-side)
  rep: { countAt: 0.55, upAt: 0.2, fullAt: 1, minMs: 500 },
  progress(b) {
    if (b.view === 'side') {
      const k = kneeAngle(b, b.near, true);
      return k === null ? null : Math.max(0, Math.min(1.4, (170 - k) / 70));
    }
    return frontProgress(b);
  },
  rules: [
    {
      kind: 'rep', id: 'squat.depth', severity: 'error', views: ['front', 'diag', 'side'],
      judge: (r) => r.maxP < 1,
      segments: (b) => (b.view === 'side' ? [thigh(b.near)] : ['thighL', 'thighR']),
      cue: 'squat.deeper',
    },
    {
      kind: 'live', id: 'squat.kneesIn', severity: 'error', views: ['front'], minP: 0.35,
      measure: (b) => ({ L: kneeInside(b, 'L'), R: kneeInside(b, 'R') }),
      bad: (v) => v > 0.07, clear: (v) => v < 0.04,
      segments: (_b, side) => (side ? [shin(side)] : ['shinL', 'shinR']),
      cue: 'squat.kneesOut',
    },
    {
      kind: 'live', id: 'squat.shift', severity: 'tip', views: ['front'], minP: 0.5,
      measure(b) {
        const hips = pair(b, 'hip'), ankles = pair(b, 'ankle');
        if (!hips || !ankles || b.len.shoulders <= 0) return null;
        return Math.abs(hips.x - ankles.x) / b.len.shoulders;
      },
      bad: (v) => v > 0.25, clear: (v) => v < 0.15,
      segments: () => ['hips'],
      cue: 'squat.even',
      holdMs: 300,
    },
    {
      kind: 'live', id: 'squat.chest', severity: 'tip', views: ['side'], minP: 0.6, phases: ['bottom', 'up'],
      measure(b) {
        const p = all(b, b.near, ['shoulder', 'hip', 'knee', 'ankle']);
        if (!p) return null;
        return fromVertical(p[1]!, p[0]!) - fromVertical(p[3]!, p[2]!);
      },
      bad: (v) => v > 30, clear: (v) => v < 22,
      segments: () => ['torso'],
      cue: 'squat.chestUp',
    },
    {
      kind: 'rep', id: 'squat.tempo', severity: 'tip', views: ['front', 'diag', 'side'],
      judge: (r) => r.bottomT - r.startT < 400,
      segments: () => [],
      cue: 'tempo.slower',
    },
  ],
  returnCue: 'squat.standTall',
};
