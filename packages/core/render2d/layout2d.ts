// Where the play area, the mirror and the self view go on a screen: the render side of design/LAYOUT.md. The numbers are
// ui/layout.ts (a typed port of design/tokens/layout.mjs, proven against it); this file only adds the real camera
// aspect (the layout code assumes 3:4 and 4:3 until told otherwise) and the contain-fit of the camera frame into the
// play area for scenes that show the player.
//
// Rule from Doruk (23 Oct): "kendi kamera küçük olsun, ekran görünsün, orantısız olmasın". The self view is a small
// window in a corner that never covers the score, the timer, the command or the reason; in mirror games the mirror is
// the scene and there is no window.
import {
  hudMetrics, liveSizes, pipSize, placeHud, placeHudDuo, checkRects,
  type DuoAway, type HudLayout, type HudMode, type Insets, type MeasuredDuo, type MeasuredHud, type PipPlacement,
} from '../ui/layout.ts';
import { fitContain, type Rect } from './view.ts';

export interface SceneRects {
  /** Canvas size in CSS pixels. */
  w: number;
  h: number;
  /** Where the game keeps its key objects. */
  play: Rect;
  /** The whole camera frame, contained in the play area (what the skeleton and `project` are measured against). */
  mirror: Rect;
  /** The self view window, or null (mirror mode, hidden, or no self view in this mode). */
  pip: Rect | null;
  /** Live matches: your own small view and the friend's or the ghost's tile. */
  own: Rect | null;
  friend: Rect | null;
  /** The HUD boxes that must never be covered or cut off, by name, for the overlap check. */
  hud: Record<string, Rect & { font?: number }>;
  /** Mode 'local2': each player's half of the play area. */
  lanes?: [Rect, Rect];
  /** The layout code's own answer, for the HUD to read the rest from. */
  source: HudLayout | null;
}

export interface LayoutInput {
  w: number;
  h: number;
  insets?: Insets;
  /** Width / height of the camera frame as it arrives. */
  camAspect: number;
  mode: HudMode;
  pipCorner: PipPlacement;
  measured: MeasuredHud;
}

const empty: Rect = { x: 0, y: 0, w: 0, h: 0 };

/** One player. */
export function layoutScene(i: LayoutInput): SceneRects {
  const base = hudMetrics({ w: i.w, h: i.h, ...(i.insets ? { insets: i.insets } : {}) });
  const pip = pipSize({ w: i.w, h: i.h, camAspect: i.camAspect });
  const metrics = { ...base, pip, live: liveSizes({ w: i.w, h: i.h, pip }) };
  const layout = placeHud({ w: i.w, h: i.h, insets: metrics.insets, metrics }, i.measured, { mode: i.mode, pipCorner: i.pipCorner });
  const r = layout.rects;
  const play = { x: r.play.x, y: r.play.y, w: r.play.w, h: r.play.h };
  const mirror = fitContain(i.camAspect, play);
  const hud: SceneRects['hud'] = { statusLeft: r.statusLeft, statusRight: r.statusRight, command: { ...r.command, font: r.command.font ?? metrics.font.command }, reason: r.reason };
  const tile = (t: Rect | undefined): Rect | null => (t ? { x: t.x, y: t.y, w: t.w, h: t.h } : null);
  const p = tile(r.pip), own = tile(r.own), friend = tile(r.friend);
  if (p) hud['pip'] = p;
  if (own) hud['own'] = own;
  if (friend) hud['friend'] = friend;
  return { w: i.w, h: i.h, play, mirror: i.mode === 'mirror' && r.mirror ? fitContain(i.camAspect, r.mirror) : mirror, pip: p, own, friend, hud, source: layout };
}

export interface DuoInput {
  w: number;
  h: number;
  insets?: Insets;
  camAspect: number;
  measured: MeasuredDuo;
  away?: DuoAway;
}

/** Two players on one camera: the shared self view at the bottom centre, a lane for each player. */
export function layoutDuo(i: DuoInput): SceneRects {
  const d = placeHudDuo({ w: i.w, h: i.h, ...(i.insets ? { insets: i.insets } : {}) }, i.measured, { camAspect: i.camAspect, ...(i.away !== undefined ? { away: i.away } : {}) });
  const r = d.rects;
  const lanes: [Rect, Rect] = [r.playP1, r.playP2];
  const play: Rect = { x: lanes[0].x, y: lanes[0].y, w: lanes[1].x + lanes[1].w - lanes[0].x, h: Math.max(lanes[0].h, lanes[1].h) };
  const hud: SceneRects['hud'] = { statusP1: r.statusP1, statusP2: r.statusP2, timer: r.timer, command: r.command, pip: r.pip };
  if (r.reasonP1) hud['reasonP1'] = r.reasonP1;
  if (r.reasonP2) hud['reasonP2'] = r.reasonP2;
  return { w: i.w, h: i.h, play, mirror: fitContain(i.camAspect, play), pip: { x: r.pip.x, y: r.pip.y, w: r.pip.w, h: r.pip.h }, own: null, friend: null, hud, lanes, source: null };
}

/**
 * What is wrong with a layout, in words (empty when it is fine): a HUD box cut off or touching another, a window
 * (self view, own view, friend tile) cut off, a play area that leaves the screen, a mirror that leaves the play area.
 * A self view may sit over the corner of the play area (the scenery and the ground), as LAYOUT.md section 4 allows.
 */
export function layoutProblems(r: SceneRects): string[] {
  const out = checkRects(r.hud, { w: r.w, h: r.h });
  const windows: [string, Rect | null][] = [['pip', r.pip], ['own', r.own], ['friend', r.friend]];
  for (const [name, win] of windows) {
    if (win && (win.x < 0 || win.y < 0 || win.x + win.w > r.w + 0.5 || win.y + win.h > r.h + 0.5)) out.push(`${name} is cut off`);
  }
  const p = r.play;
  if (p.w <= 0 || p.h <= 0) out.push('there is no play area');
  else if (p.x < -0.5 || p.y < -0.5 || p.x + p.w > r.w + 0.5 || p.y + p.h > r.h + 0.5) out.push('the play area leaves the screen');
  else {
    const m = r.mirror;
    if (m.x < p.x - 0.5 || m.y < p.y - 0.5 || m.x + m.w > p.x + p.w + 0.5 || m.y + m.h > p.y + p.h + 0.5) out.push('the mirror leaves the play area');
  }
  return out;
}

export { empty as EMPTY_RECT };
