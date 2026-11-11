// Dumbbell shoulder press, standing or seated. SPEC.md 5.9 row 83, rules ARMS-TOP, SYM, LOCK, STACK, LEAN-F. Camera in front.
//
// Progress: the LOWER hand's height over its shoulder in arm lengths, h = (shoulder y - wrist y) / (upper arm + forearm), so
// both arms must press: p = (h - 0.1) / 0.7, target h = 0.8. The arm length is the running maximum (refreshed at every lockout).
// Not measured: the lower back arching (a side-view thing), the elbows drifting forward (depth), shrugging (Faz 2).
import { angleAt, fromVertical } from '../geometry.ts';
import type { BodyCtx, MoveDef } from '../types.ts';
import { arm } from '../segments.ts';
import { all, at, pair } from './kit.ts';

type B = Pick<BodyCtx, 'pts' | 'near' | 'view' | 'len'>;

/** Each hand's height over its shoulder in arm lengths (counting visibility), or null for a side not seen. */
export function handHeights(b: B, count = true): { L: number | null; R: number | null } {
  const armLen = b.len.upperArm + b.len.forearm;
  const h = (s: 'L' | 'R'): number | null => {
    const sh = at(b, s, 'shoulder', count), wr = at(b, s, 'wrist', count);
    return sh && wr && armLen > 0 ? (sh.y - wr.y) / armLen : null;
  };
  return { L: h('L'), R: h('R') };
}

export const dbShoulderPress: MoveDef = {
  id: 'dbShoulderPress',
  views: ['front', 'diag'],
  parts: ['head', 'shoulders', 'elbows', 'hands'],
  rep: { countAt: 0.45, upAt: 0.25, fullAt: 1, minMs: 500 },
  progress(b) {
    const h = handHeights(b);
    if (h.L === null || h.R === null) return null;
    return Math.max(0, Math.min(1.5, (Math.min(h.L, h.R) - 0.1) / 0.7));
  },
  rules: [
    {
      kind: 'rep', id: 'press.top', severity: 'error', views: ['front', 'diag'],
      judge: (r) => r.maxP < 1,
      segments: () => ['forearmL', 'forearmR'],
      cue: 'press.higher',
    },
    {
      // front only: at an angle the far arm's height differs by perspective (up to 0.2 arm lengths on good presses, measured)
      kind: 'live', id: 'press.together', severity: 'error', views: ['front'], minP: 0.3, phases: ['down', 'bottom'],
      measure(b) {
        const h = handHeights(b, false);
        return h.L === null || h.R === null ? null : Math.abs(h.L - h.R);
      },
      // good presses on real video reached 0.24 (a low camera looking up); a lagging arm shows well above that
      bad: (v) => v > 0.28, clear: (v) => v < 0.18,
      holdMs: 200,
      segments(b) {
        const h = handHeights(b, false);
        if (h.L === null || h.R === null) return [...arm('L'), ...arm('R')];
        return arm(h.L < h.R ? 'L' : 'R');
      },
      cue: 'press.together',
    },
    {
      kind: 'live', id: 'press.lockout', severity: 'tip', views: ['front'], minP: 0.9, phases: ['bottom'],
      measure(b) {
        let worst: number | null = null;
        for (const s of ['L', 'R'] as const) {
          const p = all(b, s, ['shoulder', 'elbow', 'wrist']);
          if (!p) return null;
          const a = angleAt(p[0]!, p[1]!, p[2]!);
          worst = worst === null ? a : Math.min(worst, a);
        }
        return worst;
      },
      bad: (v) => v < 150, clear: (v) => v > 158,
      segments: () => ['forearmL', 'forearmR'],
      cue: 'press.straighten',
      holdMs: 250,
    },
    {
      kind: 'live', id: 'press.stack', severity: 'tip', views: ['front'], phases: ['top'],
      measure(b) {
        let worst: number | null = null;
        for (const s of ['L', 'R'] as const) {
          const el = at(b, s, 'elbow'), wr = at(b, s, 'wrist'), sh = at(b, s, 'shoulder');
          if (!el || !wr || !sh || b.len.forearm <= 0) return null;
          // only in the rack: the hand above the elbow and near shoulder height
          if (wr.y > el.y || Math.abs(wr.y - sh.y) > 0.6 * (b.len.upperArm + b.len.forearm)) return null;
          const off = Math.abs(wr.x - el.x) / b.len.forearm;
          worst = worst === null ? off : Math.max(worst, off);
        }
        return worst;
      },
      bad: (v) => v > 0.45, clear: (v) => v < 0.3,
      segments: () => ['forearmL', 'forearmR'],
      cue: 'press.elbowsUnder',
      holdMs: 400,
    },
    {
      kind: 'live', id: 'press.upright', severity: 'tip', views: ['front'], phases: ['top', 'down', 'bottom', 'up'],
      measure(b) {
        const sh = pair(b, 'shoulder'), hip = pair(b, 'hip');
        return sh && hip ? fromVertical(hip, sh) : null;
      },
      bad: (v) => v > 12, clear: (v) => v < 8,
      segments: () => ['torso'],
      cue: 'press.stayUpright',
      holdMs: 300,
    },
  ],
  returnCue: 'press.lowerToShoulders',
};
