// Typed port of design/tokens/layout.mjs (the art director's reference for design/LAYOUT.md). The numbers are
// identical on purpose: layout.test.ts runs both implementations on the ten breakpoints and compares them.
// Pure functions, no DOM: the Hud measures its plates in the browser and passes the sizes in.

export interface Size { w: number; h: number }
export interface Rect extends Size { x: number; y: number }
export interface Insets { top: number; right: number; bottom: number; left: number }
export type DeviceClass = 'phone' | 'medium' | 'large';
export type PipCorner = 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';
export type PipPlacement = PipCorner | 'hidden';
export type HudMode = 'scene' | 'live' | 'mirror';

export interface Viewport { w: number; h: number; insets?: Insets }

export interface Breakpoint { id: string; w: number; h: number; label: string }

/** The ten screens every screen of the product is checked on (BUILD-PLAN, LAYOUT.md section 9). */
export const BREAKPOINTS: readonly Breakpoint[] = [
  { id: 'phone-360', w: 360, h: 780, label: 'Phone portrait 360 x 780' },
  { id: 'phone-390', w: 390, h: 844, label: 'Phone portrait 390 x 844' },
  { id: 'phone-412', w: 412, h: 915, label: 'Phone portrait 412 x 915' },
  { id: 'phone-land-844', w: 844, h: 390, label: 'Phone landscape 844 x 390' },
  { id: 'phone-land-915', w: 915, h: 412, label: 'Phone landscape 915 x 412' },
  { id: 'tablet-768', w: 768, h: 1024, label: 'Tablet portrait 768 x 1024' },
  { id: 'tablet-land-1024', w: 1024, h: 768, label: 'Tablet landscape 1024 x 768' },
  { id: 'laptop-1280', w: 1280, h: 800, label: 'Laptop 1280 x 800' },
  { id: 'laptop-1440', w: 1440, h: 900, label: 'Laptop 1440 x 900' },
  { id: 'tv-1920', w: 1920, h: 1080, label: 'TV 1920 x 1080 at 2.5 m' },
];

const clamp = (lo: number, v: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const r = Math.round;

/** phone: short side under 500 px; large: TV-sized browsers (short side 1000 px and up). */
export function deviceClass(w: number, h: number): DeviceClass {
  const s = Math.min(w, h);
  if (s < 500) return 'phone';
  if (s >= 1000) return 'large';
  return 'medium';
}

/**
 * Safe insets used by the mockups and the tests. In the app read env(safe-area-inset-*) and add the TV
 * title-safe margin (5 % per side, the Android TV overscan guideline) on large screens.
 */
export function typicalInsets(w: number, h: number): Insets {
  const cls = deviceClass(w, h);
  if (cls === 'phone') {
    return h > w ? { top: 28, right: 0, bottom: 20, left: 0 } : { top: 0, right: 32, bottom: 16, left: 32 };
  }
  if (cls === 'large') return { top: r(0.05 * h), right: r(0.05 * w), bottom: r(0.05 * h), left: r(0.05 * w) };
  return { top: 0, right: 0, bottom: 0, left: 0 };
}

export interface HudFonts { command: number; numeral: number; label: number; reason: number }

export interface HudMetrics {
  w: number;
  h: number;
  cls: DeviceClass;
  portrait: boolean;
  insets: Insets;
  margin: number;
  gap: number;
  font: HudFonts;
  commandShrinkFloor: number;
  pip: PipSize;
  live: LiveSizes;
  safe: Rect;
}

export interface PipSize extends Size { aspect: number }
export interface LiveSizes { friend: Size; own: Size }

/**
 * Sizes for the in-game HUD. Everything derives from the viewport (CSS px).
 * The command is never smaller than 8 % of the screen height; on phones it has a physical floor.
 */
export function hudMetrics(v: Viewport): HudMetrics {
  const { w, h } = v;
  const insets = v.insets ?? typicalInsets(w, h);
  const s = Math.min(w, h);
  const portrait = h > w;
  const cls = deviceClass(w, h);
  const margin = r(clamp(12, 0.03 * s, 40));
  const gap = r(clamp(8, 0.015 * s, 20));
  const commandFloor = cls === 'phone' ? (portrait ? 44 : 52) : 0;
  const command = Math.ceil(Math.max(0.08 * h, commandFloor));
  const numeral = r(clamp(28, 0.042 * h, 60));
  const label = r(clamp(13, 0.4 * numeral, 22));
  const reason = r(clamp(18, 0.03 * h, 36));
  const pip = pipSize({ w, h });
  return {
    w, h, cls, portrait, insets, margin, gap,
    font: { command, numeral, label, reason },
    commandShrinkFloor: Math.ceil(Math.max(0.08 * h, commandFloor * 0.9)),
    pip,
    live: liveSizes({ w, h, pip }),
    safe: {
      x: insets.left + margin,
      y: insets.top + margin,
      w: w - insets.left - insets.right - 2 * margin,
      h: h - insets.top - insets.bottom - 2 * margin,
    },
  };
}

/**
 * Picture-in-picture self view for scene games. The camera aspect is kept.
 * Portrait: width = clamp(96, 30 vw, 240), height capped at 22 % of the screen height.
 * Landscape: height = clamp(72, 24 vh, 220), width capped at 24 % of the screen width.
 */
export function pipSize(v: { w: number; h: number; camAspect?: number }): PipSize {
  const { w, h } = v;
  const portrait = h > w;
  const aspect = v.camAspect ?? (portrait ? 3 / 4 : 4 / 3); // width / height of the camera frame
  let pw: number;
  let ph: number;
  if (portrait) {
    pw = clamp(96, 0.3 * w, 240);
    ph = pw / aspect;
    if (ph > 0.22 * h) { ph = 0.22 * h; pw = ph * aspect; }
  } else {
    ph = clamp(72, 0.24 * h, 220);
    pw = ph * aspect;
    if (pw > 0.24 * w) { pw = 0.24 * w; ph = pw / aspect; }
  }
  return { w: r(pw), h: r(ph), aspect };
}

/** Live match tiles: the friend (or a stranger's skeleton ghost) is larger than your own view. */
export function liveSizes(v: { w: number; h: number; pip: PipSize }): LiveSizes {
  const { w, pip } = v;
  const friend = { w: r(pip.w * 1.15), h: r(pip.h * 1.15) };
  const own = { w: r(pip.w * 0.72), h: r(pip.h * 0.72) };
  // Cap the friend tile so both tiles and a gap fit side by side on narrow portrait screens.
  const maxFriendW = 0.5 * w - 24;
  if (friend.w > maxFriendW) {
    const k = maxFriendW / friend.w;
    friend.w = r(friend.w * k);
    friend.h = r(friend.h * k);
  }
  return { friend, own };
}

const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export interface MeasuredHud {
  statusLeft: Size;
  statusRight: Size;
  command: Size;
  reason: Size;
}

export interface PlaceOptions {
  mode?: HudMode;
  pipCorner?: PipPlacement;
  reasonRow?: ReasonRow;
}

export type ReasonRow = 'bottom' | 'lifted' | 'side';

export interface PlacedRect extends Rect { corner?: string; row?: string; font?: number }

export interface HudRects {
  statusLeft: PlacedRect;
  statusRight: PlacedRect;
  command: PlacedRect & { row: 'top' | 'below' };
  reason: PlacedRect & { row: ReasonRow };
  play: Rect;
  pip?: PlacedRect;
  own?: PlacedRect;
  friend?: PlacedRect;
  mirror?: Rect & { fit: 'contain' };
}

export interface HudLayout { metrics: HudMetrics; rects: HudRects }

interface Tile extends Size { key: 'pip' | 'own' | 'friend'; corner: PipCorner }

interface ReasonSlot { row: ReasonRow; x: number; w: number; centre: number; bottomY?: number }
export interface ReasonSlots { bottom: ReasonSlot; lifted?: ReasonSlot; side?: ReasonSlot; preferred: ReasonRow }

/**
 * Place the HUD. `measured` holds the rendered sizes of the text plates. options.mode: 'scene' (PiP self view),
 * 'live' (own view + friend or ghost tile), 'mirror' (no PiP). options.pipCorner: any corner or 'hidden'.
 * Returns rects in CSS px and the play area the game keeps its key objects inside.
 */
export function placeHud(viewport: Viewport & { metrics?: HudMetrics }, measured: MeasuredHud, options: PlaceOptions = {}): HudLayout {
  const m = viewport.metrics ?? hudMetrics(viewport);
  const { w, h, insets, margin, gap } = m;
  const mode = options.mode ?? 'scene';
  const corner = options.pipCorner ?? 'bottom-right';
  const left = insets.left + margin;
  const right = w - insets.right - margin;
  const top = insets.top + margin;
  const bottom = h - insets.bottom - margin;

  const statusLeft: PlacedRect = { x: left, y: top, ...measured.statusLeft };
  const statusRight: PlacedRect = { x: right - measured.statusRight.w, y: top, ...measured.statusRight };
  const statusBottom = top + Math.max(measured.statusLeft.h, measured.statusRight.h);

  // Command: inside the top row when it fits between the two clusters, otherwise under it.
  const between = statusRight.x - (statusLeft.x + statusLeft.w) - 2 * gap;
  const cmd = measured.command;
  let command: HudRects['command'];
  if (cmd.w <= between) {
    const cx = (statusLeft.x + statusLeft.w + statusRight.x) / 2;
    command = { x: r(cx - cmd.w / 2), y: top, w: cmd.w, h: cmd.h, row: 'top' };
  } else {
    command = { x: r((left + right) / 2 - cmd.w / 2), y: statusBottom + gap, w: cmd.w, h: cmd.h, row: 'below' };
  }
  const hudTopBottom = Math.max(statusBottom, command.y + command.h);

  // Self view and live tiles.
  const tiles: Tile[] = [];
  if (mode === 'scene' && corner !== 'hidden') {
    tiles.push({ key: 'pip', ...m.pip, corner });
  } else if (mode === 'live') {
    tiles.push({ key: 'own', ...m.live.own, corner: 'bottom-left' });
    tiles.push({ key: 'friend', ...m.live.friend, corner: 'bottom-right' });
  }
  const placed: Partial<Record<Tile['key'], PlacedRect>> = {};
  for (const t of tiles) {
    const isLeft = t.corner.endsWith('left');
    const x = isLeft ? left : right - t.w;
    let y: number;
    if (t.corner.startsWith('bottom')) y = bottom - t.h;
    else {
      y = statusBottom + gap;
      const probe: Rect = { x, y, w: t.w, h: t.h };
      if (overlaps(probe, command)) y = command.y + command.h + gap;
    }
    placed[t.key] = { x: r(x), y: r(y), w: t.w, h: t.h, corner: t.corner };
  }

  // Reason strip: bottom centre, never over a tile and never cut short.
  const slots = reasonSlots(m, placed, tiles, { left, right, bottom, mode, hudTopBottom });
  const want = options.reasonRow ?? slots.preferred;
  const slot = slots[want] ?? slots.bottom;
  const rs = measured.reason;
  let reason: HudRects['reason'];
  if (slot.row === 'bottom') {
    const x = clamp(slot.x, slot.centre - rs.w / 2, slot.x + slot.w - rs.w);
    reason = { x: r(x), y: bottom - rs.h, w: rs.w, h: rs.h, row: 'bottom' };
  } else if (slot.row === 'side') {
    reason = { x: r(slot.x + (slot.w - rs.w) / 2), y: bottom - rs.h, w: rs.w, h: rs.h, row: 'side' };
  } else {
    reason = { x: r(slot.centre - rs.w / 2), y: (slot.bottomY ?? bottom) - rs.h, w: rs.w, h: rs.h, row: 'lifted' };
  }
  const bottomTiles = tiles.filter((t) => t.corner.startsWith('bottom')).map((t) => placed[t.key]).filter((t): t is PlacedRect => !!t);

  // Play area: what is left between the HUD bands; games keep key objects inside it.
  const playTop = hudTopBottom + gap;
  const reasonTop = reason.row === 'side' ? bottom + gap : reason.y;
  const playBottom = Math.min(reasonTop, ...bottomTiles.map((t) => t.y)) - gap;
  const play: Rect = { x: left, y: playTop, w: right - left, h: Math.max(0, playBottom - playTop) };

  const rects: HudRects = { statusLeft, statusRight, command, reason, play };
  if (placed.pip) rects.pip = placed.pip;
  if (placed.own) rects.own = placed.own;
  if (placed.friend) rects.friend = placed.friend;
  if (mode === 'mirror') rects.mirror = mirrorRect(m, play);
  return { metrics: m, rects };
}

/**
 * Where the reason strip may go, before it is measured. The DOM sets max-width to the slot width, measures the
 * wrapped plate (two lines at most) and passes the size to placeHud.
 */
export function reasonSlots(
  m: HudMetrics,
  rects: Partial<Record<'pip' | 'own' | 'friend', PlacedRect>>,
  tiles: readonly { key: 'pip' | 'own' | 'friend'; corner: string }[],
  o: { left: number; right: number; bottom: number; mode: HudMode; hudTopBottom: number },
): ReasonSlots {
  const { left, right, bottom, mode, hudTopBottom } = o;
  const bottomTiles = tiles.filter((t) => t.corner.startsWith('bottom')).map((t) => rects[t.key]).filter((t): t is PlacedRect => !!t);
  let spanL = left;
  let spanR = right;
  for (const t of bottomTiles) {
    if (t.x <= left + 1) spanL = Math.max(spanL, t.x + t.w + m.gap);
    else spanR = Math.min(spanR, t.x - m.gap);
  }
  const out: ReasonSlots = {
    bottom: { row: 'bottom', x: spanL, w: spanR - spanL, centre: bottomTiles.length ? (spanL + spanR) / 2 : (left + right) / 2 },
    preferred: 'bottom',
  };
  if (bottomTiles.length) {
    const tileTop = Math.min(...bottomTiles.map((t) => t.y));
    out.lifted = { row: 'lifted', x: left, w: right - left, centre: (left + right) / 2, bottomY: tileTop - m.gap };
  }
  const minSpan = Math.max(220, 0.55 * (right - left));
  out.preferred = !bottomTiles.length || out.bottom.w >= minSpan ? 'bottom' : 'lifted';
  if (mode === 'mirror' && !m.portrait) {
    const area: Rect = { x: left, y: hudTopBottom + m.gap, w: right - left, h: bottom - hudTopBottom - m.gap };
    const mr = mirrorRect(m, area);
    const band = mr.x - left - m.gap;
    if (band >= 180) {
      out.side = { row: 'side', x: mr.x + mr.w + m.gap, w: right - (mr.x + mr.w + m.gap), centre: 0 };
      out.preferred = 'side';
    }
  }
  return out;
}

/** Tile rects and the reason slots for a viewport, used before measuring the text plates. */
export function hudSlots(
  viewport: Viewport & { metrics?: HudMetrics },
  measuredStatus: { statusLeft: Size; statusRight: Size; command?: Size },
  options: PlaceOptions = {},
): { reason: ReasonSlots; commandMaxW: number } {
  const fake: MeasuredHud = {
    statusLeft: measuredStatus.statusLeft,
    statusRight: measuredStatus.statusRight,
    command: measuredStatus.command ?? { w: 1, h: 1 },
    reason: { w: 1, h: 1 },
  };
  const { metrics, rects } = placeHud(viewport, fake, options);
  const left = metrics.insets.left + metrics.margin;
  const right = metrics.w - metrics.insets.right - metrics.margin;
  const bottom = metrics.h - metrics.insets.bottom - metrics.margin;
  const tiles = (['pip', 'own', 'friend'] as const).flatMap((k) => {
    const t = rects[k];
    return t ? [{ key: k, corner: t.corner ?? 'bottom-right' }] : [];
  });
  const hudTopBottom = Math.max(
    rects.statusLeft.y + rects.statusLeft.h,
    rects.statusRight.y + rects.statusRight.h,
    rects.command.y + rects.command.h,
  );
  return {
    reason: reasonSlots(metrics, rects, tiles, { left, right, bottom, mode: options.mode ?? 'scene', hudTopBottom }),
    commandMaxW: right - left,
  };
}

/**
 * Mirror games (target hit, rhythm): the camera mirror is the scene. The whole camera frame is fitted inside the
 * play area, so no HUD plate ever covers the player or a target. The space around it is the stage colour (night).
 */
export function mirrorRect(m: { w: number; h: number; portrait: boolean }, play?: Rect, camAspect?: number): Rect & { fit: 'contain' } {
  const aspect = camAspect ?? (m.portrait ? 3 / 4 : 4 / 3);
  const area: Rect = play && play.h > 0 ? play : { x: 0, y: 0, w: m.w, h: m.h };
  let mw = area.w;
  let mh = mw / aspect;
  if (mh > area.h) { mh = area.h; mw = mh * aspect; }
  return { x: r(area.x + (area.w - mw) / 2), y: r(area.y + (area.h - mh) / 2), w: r(mw), h: r(mh), fit: 'contain' };
}

const fmt = (a: Rect): string => `${r(a.x)},${r(a.y)} ${r(a.w)}x${r(a.h)}`;

/** Problems found in a set of rendered rects. Empty list = pass. */
export function checkRects(rects: Record<string, Rect & { font?: number }>, o: { w: number; h: number; minCommand?: number }): string[] {
  const problems: string[] = [];
  const keys = Object.keys(rects).filter((k) => !['play', 'mirror', 'scene'].includes(k));
  for (const k of keys) {
    const a = rects[k];
    if (!a) continue;
    if (a.x < 0 || a.y < 0 || a.x + a.w > o.w + 0.5 || a.y + a.h > o.h + 0.5) problems.push(`${k} is cut off (${fmt(a)})`);
  }
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = rects[keys[i] as string];
      const b = rects[keys[j] as string];
      if (a && b && overlaps(a, b)) problems.push(`${keys[i]} overlaps ${keys[j]}`);
    }
  }
  const command = rects['command'];
  if (o.minCommand && command && command.font !== undefined && command.font < o.minCommand) {
    problems.push(`command font ${command.font}px is under 8 % of the height (${o.minCommand}px)`);
  }
  return problems;
}

export type NavKind = 'side rail' | 'bottom tab bar' | 'top bar';

export interface ShellGrid {
  gutter: number;
  content: number;
  cols: number;
  gap: number;
  tile: number;
  tileArt: number;
  nav: NavKind;
  rail: number;
}

/**
 * Shell layout (menus, catalogue, results, settings): page gutter, content width and the game grid. Same numbers as
 * the page rules in packages/core/ui/styles/shell.css; the tests compare the CSS result against this function.
 */
export function shellGrid(v: Viewport): ShellGrid {
  const { w, h } = v;
  const insets = v.insets ?? typicalInsets(w, h);
  const gutter = Math.max(clamp(16, 0.04 * w, 48), insets.left, insets.right);
  const nav: NavKind = h < 500 && w > h ? 'side rail' : w < 900 ? 'bottom tab bar' : 'top bar';
  const rail = nav === 'side rail' ? 76 : 0; // landscape phones keep their height for content
  const maxContent = w >= 1680 ? 1560 : 1240;
  const content = Math.min(w - 2 * gutter - rail, maxContent);
  const cols = w < 600 ? 2 : w < 900 ? 3 : w < 1680 ? 4 : 5;
  const gap = clamp(12, 0.02 * w, 24);
  const tile = (content - (cols - 1) * gap) / cols;
  return {
    gutter: Math.round(gutter * 10) / 10,
    content: Math.round(content),
    cols,
    gap: Math.round(gap * 10) / 10,
    tile: Math.round(tile),
    tileArt: Math.round(tile * 0.75),
    nav,
    rail,
  };
}

// ---------------- 2 players, same camera (design/LAYOUT.md section 12) ----------------
// Web only, big screens only (tablet landscape, laptop, desktop, TV). Never offered on phones or in the Android app.

/** True when the screen may offer the 2-player same-camera mode: not a phone, landscape, at least 1000 px wide. */
export function duoAvailable(v: { w: number; h: number }): boolean {
  return deviceClass(v.w, v.h) !== 'phone' && v.w > v.h && v.w >= 1000;
}

/** The shared self view of two players: one wide camera frame that shows both (default 16:9, capped at 30 % of the width). */
export function duoPipSize(v: { w: number; h: number; camAspect?: number }): PipSize {
  const aspect = v.camAspect ?? 16 / 9;
  let ph = clamp(90, 0.22 * v.h, 240);
  let pw = ph * aspect;
  if (pw > 0.3 * v.w) { pw = 0.3 * v.w; ph = pw / aspect; }
  return { w: r(pw), h: r(ph), aspect };
}

export interface MeasuredDuo {
  statusP1: Size;
  statusP2: Size;
  timer: Size;
  command: Size;
  reasonP1?: Size;
  reasonP2?: Size;
  away?: Size | null;
}

export type DuoAway = 'p1' | 'p2' | null;

export interface DuoRects {
  statusP1: PlacedRect;
  statusP2: PlacedRect;
  timer: PlacedRect;
  command: PlacedRect;
  pip: PlacedRect;
  reasonP1?: PlacedRect;
  reasonP2?: PlacedRect;
  /** Each player's half of the play area; both lanes run the same seed. */
  playP1: Rect;
  playP2: Rect;
  away?: Rect;
}

export interface DuoLayout { metrics: HudMetrics; rects: DuoRects; pip: PipSize }

/**
 * The room a reason of one of two players may take, before it is measured (placeHudDuo then puts it where it fits): beside
 * the shared self view ('bottom', the preferred place) or lifted above it ('lifted', up to a half of the safe width each).
 * The same sums as placeHudDuo's own, so a reason fitted to these widths is placed in the row it was fitted for.
 */
export function duoReasonRows(viewport: Viewport & { metrics?: HudMetrics }, options: { camAspect?: number; mirror?: boolean } = {}): { preferred: 'bottom'; bottom: { w: number }; lifted: { w: number } } {
  const m = viewport.metrics ?? hudMetrics(viewport);
  const { w, h, insets, margin, gap } = m;
  const span = w - insets.right - insets.left - 2 * margin;
  const pipW = options.mirror === true ? 0 : duoPipSize({ w, h, ...(options.camAspect !== undefined ? { camAspect: options.camAspect } : {}) }).w;
  return { preferred: 'bottom', bottom: { w: Math.floor((span - pipW) / 2 - gap) }, lifted: { w: Math.floor((span - gap) / 2) } };
}

/**
 * Two players: Player 1's score top left, Player 2's top right, the shared timer top centre, the one command under it,
 * the shared self view at the bottom centre and one reason strip per player. `away` is the player who left the frame.
 */
export function placeHudDuo(
  viewport: Viewport & { metrics?: HudMetrics },
  measured: MeasuredDuo,
  options: { away?: DuoAway; camAspect?: number; mirror?: boolean } = {},
): DuoLayout {
  const m = viewport.metrics ?? hudMetrics(viewport);
  const { w, h, insets, margin, gap } = m;
  const left = insets.left + margin;
  const right = w - insets.right - margin;
  const top = insets.top + margin;
  const bottom = h - insets.bottom - margin;
  const statusP1: PlacedRect = { x: left, y: top, ...measured.statusP1 };
  const statusP2: PlacedRect = { x: right - measured.statusP2.w, y: top, ...measured.statusP2 };
  const timer: PlacedRect = { x: r((left + right) / 2 - measured.timer.w / 2), y: top, ...measured.timer };
  const rowBottom = top + Math.max(measured.statusP1.h, measured.statusP2.h, measured.timer.h);
  const command: PlacedRect = { x: r((left + right) / 2 - measured.command.w / 2), y: rowBottom + gap, ...measured.command };
  // A mirror game (target hit, rhythm) shows the camera as its scene: there is no shared self view window, the lanes get the room.
  const pipSize2: PipSize = options.mirror === true
    ? { w: 0, h: 0, aspect: options.camAspect ?? 16 / 9 }
    : duoPipSize({ w, h, ...(options.camAspect !== undefined ? { camAspect: options.camAspect } : {}) });
  const pip: PlacedRect = { x: r((left + right) / 2 - pipSize2.w / 2), y: bottom - pipSize2.h, w: pipSize2.w, h: pipSize2.h, corner: 'bottom-centre' };
  const rects: DuoRects = { statusP1, statusP2, timer, command, pip, playP1: { x: 0, y: 0, w: 0, h: 0 }, playP2: { x: 0, y: 0, w: 0, h: 0 } };

  // Reasons: beside the self view when they fit, otherwise lifted above it, one per side.
  const sideW = (right - left - pipSize2.w) / 2 - gap;
  for (const [k, side] of [['reasonP1', 'left'], ['reasonP2', 'right']] as const) {
    const rs = measured[k];
    if (!rs) continue;
    const x = side === 'left' ? left : right - rs.w;
    rects[k] = rs.w <= sideW
      ? { x: r(x), y: bottom - rs.h, ...rs, row: 'bottom' }
      : { x: r(x), y: pip.y - gap - rs.h, ...rs, row: 'lifted' };
  }
  const hudTop = command.y + command.h + gap;
  const lowest = Math.min(pip.y, ...(['reasonP1', 'reasonP2'] as const).flatMap((k) => (rects[k] ? [(rects[k] as PlacedRect).y] : []))) - gap;
  const mid = (left + right) / 2;
  const laneH = Math.max(0, lowest - hudTop);
  rects.playP1 = { x: left, y: hudTop, w: mid - gap / 2 - left, h: laneH };
  rects.playP2 = { x: mid + gap / 2, y: hudTop, w: right - mid - gap / 2, h: laneH };
  if (options.away) {
    const half = options.away === 'p2' ? rects.playP2 : rects.playP1;
    const aw = Math.min(half.w - 2 * gap, measured.away?.w ?? half.w * 0.8);
    const ah = measured.away?.h ?? 120;
    rects.away = { x: r(half.x + (half.w - aw) / 2), y: r(half.y + (half.h - ah) / 2), w: r(aw), h: ah };
  }
  return { metrics: m, rects, pip: pipSize2 };
}
