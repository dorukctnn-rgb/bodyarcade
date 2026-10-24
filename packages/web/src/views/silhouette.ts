// The guide over the camera picture on the calibration screen: an outline of a person where the player should stand, and
// an amber band, with its word, on each part of the body that is not in view yet. Plain SVG at the size of the view, so
// nothing is stretched. Pure: the words are handed in.
import type { CalibPart, ScreenFraming } from './play.ts';

/** The right half of the outline, from the neck down to the heel; the left half is its mirror. Units: the figure is 100 tall. */
const FRONT: readonly (readonly [number, number])[] = [
  [2.0, 11.6], [2.2, 14.0], [8.0, 15.8], [12.6, 17.0], [14.7, 19.6], [15.3, 23.5], [16.2, 33.0], [17.0, 41.0], [17.6, 46.4],
  [16.4, 49.2], [14.0, 49.2], [13.4, 45.0], [12.4, 35.0], [11.2, 29.0], [9.4, 25.0], [8.6, 33.0], [7.8, 41.0], [9.2, 49.0],
  [9.9, 57.0], [9.2, 70.0], [7.9, 82.0], [6.6, 94.0], [8.5, 97.6], [8.3, 100], [1.4, 100], [2.0, 94.0], [2.6, 82.0],
  [2.7, 70.0], [2.1, 58.0], [0.9, 52.0],
];

/** The same figure with both arms raised, hands above the head: for the games that lift the hands and need room above the head. */
const FRONT_UP: readonly (readonly [number, number])[] = [
  [2.0, 11.6], [2.2, 14.0], [8.0, 15.8], [12.4, 16.4], [16.6, 10.8], [19.0, 3.0], [18.6, -5.0], [15.6, -6.4], [13.4, -3.6], [13.8, 3.8],
  [11.0, 12.2], [10.0, 22.0], [9.2, 36.0], [9.8, 48.0], [9.9, 57.0], [9.2, 70.0], [7.9, 82.0], [6.6, 94.0], [8.5, 97.6], [8.3, 100],
  [1.4, 100], [2.0, 94.0], [2.6, 82.0], [2.7, 70.0], [2.1, 58.0], [0.9, 52.0],
];

/** Room above the head for the raised hands, in figure units (the figure is 100 tall). */
const LIFT = 7.5;

/** Standing sideways to the camera, facing right: back first, then the front. */
const SIDE: readonly (readonly [number, number])[] = [
  [-1.8, 11.8], [-3.2, 15.0], [-5.0, 24.0], [-5.6, 36.0], [-5.8, 47.0], [-5.1, 54.0], [-4.4, 70.0], [-3.8, 84.0], [-3.6, 94.0],
  [-4.2, 99.0], [-4.0, 100], [7.0, 100], [6.4, 97.0], [3.6, 94.0], [3.4, 84.0], [4.4, 70.0], [4.8, 56.0], [5.2, 48.0],
  [5.4, 38.0], [5.9, 28.0], [5.2, 18.0], [2.4, 13.0],
];

const HEAD = { cx: 0, cy: 6.2, rx: 4.5, ry: 5.5 } as const;

/** Where a part of the body sits on the figure, as a band (top and bottom) in figure units. */
const BAND: Readonly<Record<CalibPart, readonly [number, number]>> = {
  head: [0.4, 12.2], shoulders: [14.6, 21.6], hips: [45.5, 54.5], knees: [66.0, 75.0], feet: [92.5, 100],
};

/** How much of the figure each framing shows (figure units from the top). The rest is cut off with a line. */
const SHOWN: Readonly<Record<ScreenFraming, number>> = { full: 100, side: 100, upper: 56, desk: 38 };

// The words on the bands take the display font of the page (app.css: `.cal .guide text`), the system stack of the tokens.

const f =(n: number): string => (Math.round(n * 10) / 10).toString();

/** A closed smooth path through the points (Catmull-Rom turned into curves), the second half mirrored for the front view. */
export function outline(points: readonly (readonly [number, number])[], mirror: boolean, k: (x: number, y: number) => [number, number]): string {
  const right = points.map(([x, y]) => k(x, y));
  const all = mirror ? [...right, ...[...points].reverse().map(([x, y]) => k(-x, y))] : right;
  const n = all.length;
  const at = (i: number): [number, number] => all[((i % n) + n) % n] as [number, number];
  const t = 0.16;
  let d = `M${f(at(0)[0])} ${f(at(0)[1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    d += `C${f(p1[0] + (p2[0] - p0[0]) * t)} ${f(p1[1] + (p2[1] - p0[1]) * t)} ${f(p2[0] - (p3[0] - p1[0]) * t)} ${f(p2[1] - (p3[1] - p1[1]) * t)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return `${d}Z`;
}

export interface GuideOptions {
  framing: ScreenFraming;
  /** The whole of the body that is asked for is in view: the outline turns green. */
  ready: boolean;
  /** The parts that are not in view yet; each gets a band and its word. */
  missing: readonly CalibPart[];
  labels: Readonly<Partial<Record<CalibPart, string>>>;
  /** The game lifts the hands above the head: the figure raises its arms and leaves room above the head. */
  headroom?: boolean;
}

export function framingGuide(w: number, h: number, o: GuideOptions): string {
  const shown = SHOWN[o.framing];
  const lift = o.headroom && o.framing !== 'side' ? LIFT : 0;
  const top = h * 0.12;
  const bottom = h * 0.96;
  // The figure fills the height that is free, and never more than nine tenths of the width.
  const halfWidth = o.framing === 'side' ? 7.2 : lift ? 19.6 : 17.8;
  const scale = Math.min((bottom - top) / (shown + lift), (w * 0.9) / (halfWidth * 2));
  const cx = w / 2;
  const yAt = (v: number): number => top + (v + lift) * scale;
  const k = (x: number, v: number): [number, number] => [cx + x * scale, yAt(v)];
  const stroke = o.ready ? '#22C383' : '#F4F2F8';
  const body = outline(o.framing === 'side' ? SIDE : lift ? FRONT_UP : FRONT, o.framing !== 'side', k);
  const headC = k(HEAD.cx + (o.framing === 'side' ? 0.8 : 0), HEAD.cy);
  const cut = o.framing === 'full' || o.framing === 'side' ? null : yAt(shown);
  const size = Math.max(11, Math.min(17, h * 0.03));
  const bands = o.missing.map((part) => {
    const [a, b] = BAND[part];
    if (a > shown) return '';
    const y0 = yAt(a);
    const y1 = yAt(Math.min(b, shown));
    const label = o.labels[part] ?? '';
    const half = Math.min((part === 'head' ? 8 : 18) * scale, cx - 4);
    const bh = Math.max(y1 - y0, size * 1.9);
    const y = part === 'feet' ? Math.min(y0, h - bh - 2) : y0 + (y1 - y0) / 2 - bh / 2;
    return `<rect x="${f(cx - half)}" y="${f(y)}" width="${f(half * 2)}" height="${f(bh)}" rx="${f(Math.min(12, bh / 2))}" fill="#FFC53A" opacity="0.88"/>`
      + `<text x="${f(cx)}" y="${f(y + bh / 2 + size * 0.36)}" text-anchor="middle" font-weight="800" font-size="${f(size)}" fill="#1C1433">${label}</text>`;
  }).join('');
  const clip = cut === null ? '' : `<clipPath id="ba-guide-clip"><rect x="0" y="0" width="${w}" height="${f(cut)}"/></clipPath>`;
  const shape = `<g${cut === null ? '' : ' clip-path="url(#ba-guide-clip)"'}><path d="${body}" fill="rgba(244,242,248,0.08)" stroke="${stroke}" stroke-width="3" stroke-dasharray="10 8" stroke-linejoin="round" opacity="0.92"/>`
    + `<ellipse cx="${f(headC[0])}" cy="${f(headC[1])}" rx="${f(HEAD.rx * scale)}" ry="${f(HEAD.ry * scale)}" fill="rgba(244,242,248,0.08)" stroke="${stroke}" stroke-width="3" stroke-dasharray="10 8" opacity="0.92"/></g>`;
  const line = cut === null ? '' : `<line x1="${f(cx - 19 * scale)}" y1="${f(cut)}" x2="${f(cx + 19 * scale)}" y2="${f(cut)}" stroke="${stroke}" stroke-width="3" stroke-linecap="round" opacity="0.92"/>`;
  return `<svg viewBox="0 0 ${w} ${h}" aria-hidden="true" focusable="false"><defs>${clip}</defs>${shape}${line}${bands}</svg>`;
}
