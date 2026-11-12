// The "how it works" scene at the top of the home page (views/how.ts draws it, app/how-scene.ts moves it): one squat of a real person,
// as our pose model read it (how-loop.json, made by tools/how-loop/make.ts), drawn twice from the same points of the same frame: on the
// left the person's body line as the camera picture shows it, on the right the game's character, the Mover (games/_shared/mover.ts:
// a ball head in flush, a chalk body, a sun band on the left wrist and a sky band on the right). The character moves only because the
// person moves. Pure: the page's markup (the still, the first thing a visitor sees) and the moving picture come from these functions.
import loop from './how-loop.json' with { type: 'json' };
import { BUILD_T, MOVER_NIGHT } from '../../games/_shared/mover.ts';

export interface Pt { x: number; y: number }

/** The loop: frames per second, how many, the frame at the bottom of the squat, and each frame's points (x, y pairs in a 400x300 picture). */
export const HOW_LOOP = loop as { source: string; fps: number; frames: number; bottom: number; points: string[]; person: number[][] };

/** The picture's size (SVG viewBox) and the line of its floor. */
export const HOW_W = 400;
export const HOW_H = 300;
export const HOW_FLOOR = 268;

const I = Object.fromEntries(HOW_LOOP.points.map((n, i) => [n, i])) as Record<string, number>;

/** The points of a moment of the loop (`frame` may be fractional and any size: the loop goes round), between the two nearest frames. */
export function framePoints(frame: number): Pt[] {
  const n = HOW_LOOP.frames;
  const f = ((frame % n) + n) % n;
  const a = HOW_LOOP.person[Math.floor(f)]!;
  const b = HOW_LOOP.person[(Math.floor(f) + 1) % n]!;
  const k = f - Math.floor(f);
  const out: Pt[] = [];
  for (let i = 0; i < a.length; i += 2) out.push({ x: a[i]! + (b[i]! - a[i]!) * k, y: a[i + 1]! + (b[i + 1]! - a[i + 1]!) * k });
  return out;
}

/** One SVG shape: its tag, the attributes that move (`geo`) and the ones that stay (`style`). */
export interface Shape { tag: 'line' | 'circle' | 'polygon'; geo: Record<string, number | string>; style: Record<string, string | number> }

const p = (pts: readonly Pt[], name: string): Pt => pts[I[name]!]!;
const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const line = (a: Pt, b: Pt, style: Shape['style']): Shape => ({ tag: 'line', geo: { x1: a.x, y1: a.y, x2: b.x, y2: b.y }, style });
const dot = (c: Pt, style: Shape['style']): Shape => ({ tag: 'circle', geo: { cx: c.x, cy: c.y }, style });
const poly = (ps: readonly Pt[], style: Shape['style']): Shape => ({ tag: 'polygon', geo: { points: ps.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' ') }, style });

/** One torso length (hips to shoulders) of the person standing, in the picture's units: the unit of the Mover's strokes. */
export const HOW_T = ((): number => {
  const f = framePoints(0);
  const s = mid(p(f, 'shoulderL'), p(f, 'shoulderR')), h = mid(p(f, 'hipL'), p(f, 'hipR'));
  return Math.hypot(s.x - h.x, s.y - h.y);
})();

/** The bones of the body line, as the game draws a player (core/render2d/body.ts: shoulders, arms, trunk, hips, legs). */
const BONES: readonly [string, string][] = [
  ['shoulderL', 'shoulderR'], ['shoulderL', 'elbowL'], ['elbowL', 'wristL'], ['shoulderR', 'elbowR'], ['elbowR', 'wristR'],
  ['shoulderL', 'hipL'], ['shoulderR', 'hipR'], ['hipL', 'hipR'], ['hipL', 'kneeL'], ['kneeL', 'ankleL'], ['hipR', 'kneeR'], ['kneeR', 'ankleR'],
];
const JOINTS = ['shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'wristL', 'wristR', 'hipL', 'hipR', 'kneeL', 'kneeR', 'ankleL', 'ankleR'];

/** The body's shape under the line (a soft figure, as a person in a dim room), its strokes in the Mover's proportions but wider. */
function body(pts: readonly Pt[], T: number, colour: string, fat: number): Shape[] {
  const limb = BUILD_T.limb * T * fat;
  const st = (w: number): Shape['style'] => ({ stroke: colour, 'stroke-width': +w.toFixed(2), 'stroke-linecap': 'round' });
  return [
    line(p(pts, 'hipL'), p(pts, 'kneeL'), st(limb)), line(p(pts, 'kneeL'), p(pts, 'ankleL'), st(limb * 0.92)),
    line(p(pts, 'hipR'), p(pts, 'kneeR'), st(limb)), line(p(pts, 'kneeR'), p(pts, 'ankleR'), st(limb * 0.92)),
    poly([p(pts, 'shoulderL'), p(pts, 'shoulderR'), p(pts, 'hipR'), p(pts, 'hipL')], { fill: colour, stroke: colour, 'stroke-width': +(BUILD_T.torso * T * 0.5 * fat).toFixed(2), 'stroke-linejoin': 'round' }),
    line(p(pts, 'shoulderL'), p(pts, 'elbowL'), st(limb * 0.9)), line(p(pts, 'elbowL'), p(pts, 'wristL'), st(limb * 0.8)),
    line(p(pts, 'shoulderR'), p(pts, 'elbowR'), st(limb * 0.9)), line(p(pts, 'elbowR'), p(pts, 'wristR'), st(limb * 0.8)),
  ];
}

/** The head: on the line from the shoulders to the nose, a little above the nose. */
const headAt = (pts: readonly Pt[], T: number): Pt => {
  const s = mid(p(pts, 'shoulderL'), p(pts, 'shoulderR'));
  const n = p(pts, 'nose');
  const d = Math.hypot(n.x - s.x, n.y - s.y) || 1;
  return { x: n.x + ((n.x - s.x) / d) * T * 0.04, y: n.y + ((n.y - s.y) / d) * T * 0.04 };
};

/** The green of the body line (the form coach's "good form" mint) and the camera picture's soft figure. */
export const HOW_LINE = '#22C383';
const PERSON = 'rgba(244, 242, 248, 0.16)';

/** The left picture: the person (a soft figure) with our body line over it, bones and joints. */
export function personShapes(pts: readonly Pt[], T: number = HOW_T): Shape[] {
  const head = headAt(pts, T);
  return [
    ...body(pts, T, PERSON, 1.7),
    dot(head, { r: +(BUILD_T.head * T * 1.25).toFixed(2), fill: PERSON }),
    ...BONES.map(([a, b]) => line(p(pts, a), p(pts, b), { stroke: HOW_LINE, 'stroke-width': 3, 'stroke-linecap': 'round' })),
    ...JOINTS.map((j) => dot(p(pts, j), { r: 3.6, fill: '#EFFFF7', stroke: HOW_LINE, 'stroke-width': 1.6 })),
    dot(p(pts, 'nose'), { r: 3.6, fill: '#EFFFF7', stroke: HOW_LINE, 'stroke-width': 1.6 }),
  ];
}

/** The right picture: the Mover on the same points, as Pose Wall draws it at night (a thin dark edge, the chalk body, the bands, the head). */
export function moverShapes(pts: readonly Pt[], T: number = HOW_T): Shape[] {
  const s = MOVER_NIGHT;
  const edge = Math.max(1.5, T * 0.05);
  const band = (e: Pt, w: Pt, colour: string): Shape => line({ x: e.x + (w.x - e.x) * 0.66, y: e.y + (w.y - e.y) * 0.66 }, w, { stroke: colour, 'stroke-width': +(BUILD_T.limb * T * 0.8 + 0.5).toFixed(2), 'stroke-linecap': 'round' });
  const outline = body(pts, T, s.edge ?? 'rgba(20, 15, 39, 0.6)', 1).map((sh) => ({ ...sh, style: { ...sh.style, 'stroke-width': +(Number(sh.style['stroke-width']) + edge).toFixed(2) } }));
  return [
    ...outline,
    ...body(pts, T, s.body, 1),
    band(p(pts, 'elbowL'), p(pts, 'wristL'), s.bandL),
    band(p(pts, 'elbowR'), p(pts, 'wristR'), s.bandR),
    dot(headAt(pts, T), { r: +(BUILD_T.head * T).toFixed(2), fill: s.head }),
  ];
}

/** The frame the still shows (and the moving picture starts from): the bottom of the squat, where both are plainly squatting. */
export const HOW_STILL = HOW_LOOP.bottom;
