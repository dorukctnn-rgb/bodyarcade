// Helpers shared by the move definitions.
import { LM } from '../../types/index.ts';
import { COUNT_VISIBILITY, RULE_VISIBILITY, SIDE_IDX, mid, seen, type P, type Side } from '../geometry.ts';
import type { BodyCtx } from '../types.ts';

type Body = Pick<BodyCtx, 'pts' | 'near' | 'view'>;
export type Joint = keyof (typeof SIDE_IDX)['L'];

/** A point of one side when it is seen well enough for a rule (or, with `count`, for counting). */
export function at(b: Body, side: Side, j: Joint, count = false): P | null {
  const p = b.pts[SIDE_IDX[side][j]];
  return seen(p, count ? COUNT_VISIBILITY : RULE_VISIBILITY) ? p : null;
}

/** Several points of one side, or null when any of them is not seen. */
export function all(b: Body, side: Side, joints: readonly Joint[], count = false): P[] | null {
  const out: P[] = [];
  for (const j of joints) { const p = at(b, side, j, count); if (!p) return null; out.push(p); }
  return out;
}

/** The midpoint of a left/right pair when both are seen. */
export function pair(b: Body, j: Joint, count = false): P | null {
  const l = at(b, 'L', j, count), r = at(b, 'R', j, count);
  return l && r ? mid(l, r) : null;
}

export const other = (s: Side): Side => (s === 'L' ? 'R' : 'L');

export const nose = (b: Body, count = false): P | null => {
  const p = b.pts[LM.nose];
  return seen(p, count ? COUNT_VISIBILITY : RULE_VISIBILITY) ? p : null;
};

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
