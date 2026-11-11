// Camera placement guide for a move: is the person there, are the parts the move needs in the picture, is the camera on the
// right side, is the distance right, and (lying moves) is the body lying along the picture. Codes only; the page words them.
import { LM } from '../types/index.ts';
import { COUNT_VISIBILITY, fromHorizontal, seen, type P, type Side, type View } from './geometry.ts';
import type { GuideCheck, GuideState, MoveDef } from './types.ts';

const PART_POINTS: Record<MoveDef['parts'][number], readonly [number, number]> = {
  head: [LM.nose, LM.nose],
  shoulders: [LM.leftShoulder, LM.rightShoulder],
  elbows: [LM.leftElbow, LM.rightElbow],
  hands: [LM.leftWrist, LM.rightWrist],
  hips: [LM.leftHip, LM.rightHip],
  knees: [LM.leftKnee, LM.rightKnee],
  feet: [LM.leftAnkle, LM.rightAnkle],
};

const inside = (p: P | undefined, aspect: number): boolean => !!p && p.y > 0.01 && p.y < 0.99 && p.x > 0.01 * aspect && p.x < 0.99 * aspect;

export function checkPlacement(move: MoveDef, pts: readonly P[] | null, view: View | null, near: Side, aspect: number): GuideState {
  const checks: GuideCheck[] = [];
  const present = !!pts && view !== null;
  checks.push({ id: 'person', ok: present });
  if (!pts || !present) {
    checks.push({ id: 'parts', ok: false, missing: [...move.parts] });
    checks.push({ id: 'view', ok: false, want: move.views[0]!, got: null });
    checks.push({ id: 'distance', ok: false, hint: null });
    return { ready: false, checks };
  }
  // side views see one side: a pair counts when its near point is in the picture
  const side = view === 'side';
  const missing = move.parts.filter((part) => {
    const [l, r] = PART_POINTS[part];
    const ok = (i: number): boolean => seen(pts[i], COUNT_VISIBILITY) && inside(pts[i], aspect);
    if (l === r) return !ok(l);
    if (side) return !(ok(l) || ok(r));
    return !(ok(l) && ok(r));
  });
  checks.push({ id: 'parts', ok: missing.length === 0, missing });
  checks.push({ id: 'view', ok: move.views.includes(view), want: move.views[0]!, got: view });

  // distance: the needed points' extent along the body (height standing, width lying)
  const idx = move.parts.flatMap((part) => [...PART_POINTS[part]]);
  const vis = idx.map((i) => pts[i]).filter((p): p is P => seen(p, COUNT_VISIBILITY));
  let hint: 'closer' | 'farther' | null = null;
  if (vis.length >= 2) {
    const xs = vis.map((p) => p.x), ys = vis.map((p) => p.y);
    const extent = move.lying ? (Math.max(...xs) - Math.min(...xs)) / aspect : Math.max(...ys) - Math.min(...ys);
    const edge = vis.some((p) => !inside(p, aspect));
    const small = move.parts.includes('feet') ? 0.35 : 0.25;
    if (edge || extent > 0.96) hint = 'farther';
    else if (extent < small) hint = 'closer';
  }
  let flat = true;
  if (move.lying) {
    const sh = pts[near === 'L' ? LM.leftShoulder : LM.rightShoulder], an = pts[near === 'L' ? LM.leftAnkle : LM.rightAnkle];
    flat = seen(sh, COUNT_VISIBILITY) && seen(an, COUNT_VISIBILITY) && fromHorizontal(sh, an) < 40;
  }
  // a lying move's distance is judged once the person lies down (standing, the body is narrow and would read as "too far")
  if (flat) checks.push({ id: 'distance', ok: hint === null && vis.length >= 2, hint });
  if (move.lying) checks.push({ id: 'pose', ok: flat });
  return { ready: checks.every((c) => c.ok), checks };
}
