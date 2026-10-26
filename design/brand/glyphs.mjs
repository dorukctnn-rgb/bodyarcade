// BodyArcade move glyphs: the same figure as the logo (ball head, capsule limbs, floor line).
// Each pose lists joints on a 100 x 100 grid. `highlight` names the segments drawn in the
// accent colour, so a region chip lights up the part of the body that works.
// Used by the UI kit pages and exported as SVG files by design/tools/build-glyphs.mjs.

const P = (x, y) => [x, y];

// Segment names: torso, armL1 (upper), armL2 (fore), armR1, armR2, legL1 (thigh), legL2 (shin), legR1, legR2.
export const POSES = {
  stand: {
    label: 'Stand', view: 'front',
    head: P(50, 15), neck: P(50, 29), hip: P(50, 55),
    elbowL: P(41, 42), handL: P(38, 56), elbowR: P(59, 42), handR: P(62, 56),
    kneeL: P(45, 72), footL: P(44, 88), kneeR: P(55, 72), footR: P(56, 88),
  },
  squat: {
    label: 'Squat', view: 'side',
    head: P(49, 30), neck: P(46, 42), hip: P(32, 62),
    elbowL: P(58, 46), handL: P(72, 45), elbowR: P(58, 46), handR: P(72, 45),
    kneeL: P(55, 66), footL: P(50, 88), kneeR: P(55, 66), footR: P(50, 88),
  },
  highKnee: {
    label: 'High knees', view: 'side',
    head: P(51, 14), neck: P(50, 27), hip: P(49, 53),
    elbowL: P(58, 39), handL: P(64, 29), elbowR: P(42, 41), handR: P(39, 52),
    kneeL: P(49, 70), footL: P(48, 88), kneeR: P(65, 56), footR: P(63, 72),
  },
  jackOpen: {
    label: 'Jumping jack', view: 'front',
    head: P(50, 17), neck: P(50, 30), hip: P(50, 56),
    elbowL: P(39, 22), handL: P(31, 11), elbowR: P(61, 22), handR: P(69, 11),
    kneeL: P(41, 72), footL: P(33, 88), kneeR: P(59, 72), footR: P(67, 88),
  },
  punch: {
    label: 'Punch', view: 'side',
    head: P(44, 17), neck: P(44, 30), hip: P(43, 56),
    elbowL: P(59, 32), handL: P(76, 31), elbowR: P(51, 45), handR: P(55, 33),
    kneeL: P(52, 72), footL: P(57, 88), kneeR: P(37, 72), footR: P(31, 88),
  },
  reach: {
    label: 'Reach', view: 'front',
    head: P(47, 17), neck: P(48, 30), hip: P(49, 56),
    elbowL: P(40, 43), handL: P(37, 56), elbowR: P(60, 21), handR: P(70, 9),
    kneeL: P(44, 72), footL: P(42, 88), kneeR: P(55, 72), footR: P(57, 88),
  },
  twist: {
    label: 'Twist', view: 'front',
    head: P(50, 15), neck: P(50, 29), hip: P(50, 56),
    elbowL: P(62, 37), handL: P(75, 40), elbowR: P(62, 39), handR: P(75, 42),
    kneeL: P(44, 72), footL: P(42, 88), kneeR: P(56, 72), footR: P(58, 88),
    arc: true,
  },
  sideBend: {
    label: 'Side bend', view: 'front',
    head: P(37, 23), neck: P(44, 34), hip: P(52, 58),
    elbowL: P(35, 44), handL: P(36, 58), elbowR: P(52, 18), handR: P(37, 7),
    kneeL: P(47, 73), footL: P(45, 88), kneeR: P(57, 73), footR: P(59, 88),
  },
  pull: {
    label: 'Pull down', view: 'front',
    head: P(50, 19), neck: P(50, 32), hip: P(50, 58),
    elbowL: P(37, 39), handL: P(39, 27), elbowR: P(59, 19), handR: P(61, 5),
    kneeL: P(45, 74), footL: P(44, 89), kneeR: P(55, 74), footR: P(56, 89),
  },
  tPose: {
    label: 'Arms out', view: 'front',
    head: P(50, 16), neck: P(50, 30), hip: P(50, 56),
    elbowL: P(36, 31), handL: P(21, 31), elbowR: P(64, 31), handR: P(79, 31),
    kneeL: P(45, 72), footL: P(44, 88), kneeR: P(55, 72), footR: P(56, 88),
  },
  balance: {
    label: 'One-leg balance', view: 'front',
    head: P(48, 15), neck: P(48, 29), hip: P(48, 55),
    elbowL: P(35, 36), handL: P(24, 42), elbowR: P(61, 36), handR: P(72, 42),
    kneeL: P(47, 72), footL: P(47, 88), kneeR: P(63, 66), footR: P(51, 72),
  },
  seated: {
    label: 'Seated', view: 'side', chair: true,
    head: P(41, 22), neck: P(40, 35), hip: P(38, 60),
    elbowL: P(52, 41), handL: P(62, 30), elbowR: P(52, 43), handR: P(63, 33),
    kneeL: P(58, 62), footL: P(58, 85), kneeR: P(58, 62), footR: P(58, 85),
  },
  leanLeft: {
    label: 'Lean left', view: 'front',
    head: P(36, 18), neck: P(41, 31), hip: P(50, 56),
    elbowL: P(33, 43), handL: P(30, 56), elbowR: P(52, 43), handR: P(58, 55),
    kneeL: P(45, 72), footL: P(44, 88), kneeR: P(55, 72), footR: P(56, 88),
  },
};

const SEGMENTS = {
  torso: ['hip', 'neck'],
  armL1: ['neck', 'elbowL'], armL2: ['elbowL', 'handL'],
  armR1: ['neck', 'elbowR'], armR2: ['elbowR', 'handR'],
  legL1: ['hip', 'kneeL'], legL2: ['kneeL', 'footL'],
  legR1: ['hip', 'kneeR'], legR2: ['kneeR', 'footR'],
};
const WIDTH = { torso: 12, armL1: 8, armL2: 8, armR1: 8, armR2: 8, legL1: 9, legL2: 9, legR1: 9, legR2: 9 };

export const GROUPS = {
  legs: ['legL1', 'legL2', 'legR1', 'legR2'],
  arms: ['armL1', 'armL2', 'armR1', 'armR2'],
  torso: ['torso'],
  all: Object.keys(SEGMENTS),
};

// Body regions shown as filter chips: which pose and which part lights up.
export const REGIONS = [
  { id: 'legs', label: 'Legs and hips', pose: 'squat', highlight: GROUPS.legs },
  { id: 'arms', label: 'Arms and shoulders', pose: 'punch', highlight: GROUPS.arms },
  { id: 'chest-back', label: 'Chest and back', pose: 'pull', highlight: ['torso', 'armL1', 'armR1'] },
  { id: 'core', label: 'Core', pose: 'twist', highlight: ['torso'] },
  { id: 'cardio', label: 'Cardio', pose: 'jackOpen', highlight: GROUPS.all },
  { id: 'balance', label: 'Mobility and balance', pose: 'balance', highlight: ['legL1', 'legL2', 'torso'] },
  { id: 'seated', label: 'Seated', pose: 'seated', highlight: GROUPS.arms },
];

/**
 * SVG markup for a pose.
 * opts: { ink, accent, highlight: segment names, floor: true, size, title, ball: head colour }
 */
export function glyph(name, opts = {}) {
  const p = POSES[name];
  if (!p) throw new Error(`unknown pose ${name}`);
  const ink = opts.ink ?? 'currentColor';
  const accent = opts.accent ?? '#FF4F6E';
  const hl = new Set(opts.highlight ?? []);
  const floor = opts.floor ?? true;
  const parts = [];
  if (p.chair) {
    parts.push(`<path d="M28 64 H52 M30 64 V89 M50 64 V89 M28 64 V40" fill="none" stroke="${opts.chairColor ?? ink}" stroke-opacity="${opts.chairColor ? 1 : 0.35}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  if (floor) parts.push(`<line x1="20" y1="94" x2="80" y2="94" stroke="${opts.floorColor ?? ink}" stroke-width="5" stroke-linecap="round"/>`);
  // Draw far-side limbs first so the near side reads on top in side views.
  const order = ['armR1', 'armR2', 'legR1', 'legR2', 'torso', 'legL1', 'legL2', 'armL1', 'armL2'];
  for (const seg of order) {
    const [a, b] = SEGMENTS[seg];
    const [x1, y1] = p[a], [x2, y2] = p[b];
    const col = hl.has(seg) ? accent : ink;
    parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="${WIDTH[seg]}" stroke-linecap="round"/>`);
  }
  const [hx, hy] = p.head;
  parts.push(`<circle cx="${hx}" cy="${hy}" r="8.5" fill="${opts.ball ?? ink}"/>`);
  if (p.arc) {
    parts.push(`<path d="M30 46 A22 10 0 0 0 70 48" fill="none" stroke="${accent}" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="0.1 7"/>`);
  }
  const size = opts.size ?? 100;
  const title = opts.title ?? p.label;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}" role="img" aria-label="${title}"><title>${title}</title>${parts.join('')}</svg>`;
}
