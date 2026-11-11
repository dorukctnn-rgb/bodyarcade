// Stretching (SPEC.md 5.13 rows 110-119): time only. The camera cannot tell a stretch position from other positions and the range
// of a stretch is personal, so there is no form rule and no red or green: the clock runs while the person holds still in view (the
// head, shoulders and hips seen and moving less than 0.15 torso lengths over the last second) and stops while they move about.
import type { FormMoveId, MoveDef } from '../types.ts';
import { at, nose } from './kit.ts';

const STILL_WINDOW_MS = 1000;
const STILL_RANGE = 0.15;

function stretch(id: FormMoveId, parts: MoveDef['parts']): MoveDef {
  return {
    id, label: 'T', group: 'stretch', views: ['front', 'diag', 'side'], parts,
    rep: { countAt: 0.5, upAt: 0.2, fullAt: 1, minMs: 500 },
    hold: { enterAt: 1, leaveAt: 0.5, outCue: 'hold.position' },
    makeProgress() {
      const ring: { t: number; pts: ([number, number] | null)[] }[] = [];
      return (b) => {
        const n = nose(b, true);
        const pts: ([number, number] | null)[] = [n ? [n.x, n.y] : null];
        for (const s of ['L', 'R'] as const) for (const j of ['shoulder', 'hip'] as const) { const p = at(b, s, j, true); pts.push(p ? [p.x, p.y] : null); }
        if (pts.filter((p) => p !== null).length < 2) return null;
        ring.push({ t: b.t, pts });
        while (ring.length && ring[0]!.t < b.t - STILL_WINDOW_MS) ring.shift();
        if (b.t - ring[0]!.t < STILL_WINDOW_MS * 0.8) return 0;
        const unit = Math.max(b.len.torso, 0.12);
        let worst = 0;
        for (let i = 0; i < pts.length; i++) {
          let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, seen = 0;
          for (const r of ring) { const p = r.pts[i]; if (!p) continue; seen++; x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
          if (seen >= ring.length * 0.8) worst = Math.max(worst, Math.hypot(x1 - x0, y1 - y0));
        }
        return worst / unit < STILL_RANGE ? 1 : 0;
      };
    },
    rules: [],
    returnCue: 'hold.position',
  };
}

const LEGS: MoveDef['parts'] = ['head', 'shoulders', 'hips', 'knees', 'feet'];
const UPPER: MoveDef['parts'] = ['head', 'shoulders', 'elbows', 'hands'];

export const hamstringStretch = stretch('hamstringStretch', LEGS);
export const hipFlexorStretch = stretch('hipFlexorStretch', LEGS);
export const catCow = stretch('catCow', LEGS);
export const childsPose = stretch('childsPose', LEGS);
export const chestStretch = stretch('chestStretch', UPPER);
export const quadStretch = stretch('quadStretch', LEGS);
export const shoulderStretch = stretch('shoulderStretch', ['head', 'shoulders', 'elbows']);
export const neckStretch = stretch('neckStretch', ['head', 'shoulders']);
export const butterflyStretch = stretch('butterflyStretch', LEGS);
export const figureFour = stretch('figureFour', LEGS);
