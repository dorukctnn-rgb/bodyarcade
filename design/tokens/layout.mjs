// BodyArcade layout system: reference implementation of design/LAYOUT.md.
// Pure functions, no DOM. The UI builder ports these into packages/core/ui and keeps the
// numbers identical; design/tools/check-hud.mjs proves them on every breakpoint.

/** The ten screens every HUD and onboarding screen is checked on. */
export const BREAKPOINTS = [
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

const clamp = (lo, v, hi) => Math.min(hi, Math.max(lo, v));
const r = Math.round;

/** phone: short side under 500 px; large: TV-sized browsers (short side 1000 px and up). */
export function deviceClass(w, h) {
  const s = Math.min(w, h);
  if (s < 500) return 'phone';
  if (s >= 1000) return 'large';
  return 'medium';
}

/**
 * Safe insets used by the mockups. In the app read env(safe-area-inset-*) and add the
 * TV title-safe margin (5 % per side, the Android TV overscan guideline) on large screens.
 */
export function typicalInsets(w, h) {
  const cls = deviceClass(w, h);
  if (cls === 'phone') {
    return h > w ? { top: 28, right: 0, bottom: 20, left: 0 } : { top: 0, right: 32, bottom: 16, left: 32 };
  }
  if (cls === 'large') return { top: r(0.05 * h), right: r(0.05 * w), bottom: r(0.05 * h), left: r(0.05 * w) };
  return { top: 0, right: 0, bottom: 0, left: 0 };
}

/**
 * Sizes for the in-game HUD. Everything derives from the viewport (CSS px).
 * The command is never smaller than 8 % of the screen height; on phones it has a
 * physical floor because the phone is the smallest screen at 2 to 3 m.
 */
export function hudMetrics({ w, h, insets = typicalInsets(w, h) }) {
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
export function pipSize({ w, h, camAspect }) {
  const portrait = h > w;
  const aspect = camAspect ?? (portrait ? 3 / 4 : 4 / 3); // width / height of the camera frame
  let pw, ph;
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
export function liveSizes({ w, h, pip }) {
  const friend = { w: r(pip.w * 1.15), h: r(pip.h * 1.15) };
  const own = { w: r(pip.w * 0.72), h: r(pip.h * 0.72) };
  // Cap the friend tile so both tiles and a gap fit side by side on narrow portrait screens.
  const maxFriendW = 0.5 * w - 24;
  if (friend.w > maxFriendW) {
    const k = maxFriendW / friend.w;
    friend.w = r(friend.w * k); friend.h = r(friend.h * k);
  }
  return { friend, own };
}

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Place the HUD. `measured` holds the rendered sizes of the text plates:
 *   { statusLeft: {w,h}, statusRight: {w,h}, command: {w,h}, reason: {w,h} }
 * options.mode: 'scene' (PiP self view), 'live' (own view + friend or ghost tile), 'mirror' (no PiP)
 * options.pipCorner: 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right' | 'hidden'
 * Returns rects in CSS px and the command font size actually used.
 */
export function placeHud(viewport, measured, options = {}) {
  const m = viewport.metrics ?? hudMetrics(viewport);
  const { w, h, insets, margin, gap } = m;
  const mode = options.mode ?? 'scene';
  const corner = options.pipCorner ?? 'bottom-right';
  const left = insets.left + margin;
  const right = w - insets.right - margin;
  const top = insets.top + margin;
  const bottom = h - insets.bottom - margin;
  const rects = {};

  rects.statusLeft = { x: left, y: top, ...measured.statusLeft };
  rects.statusRight = { x: right - measured.statusRight.w, y: top, ...measured.statusRight };
  const statusBottom = top + Math.max(measured.statusLeft.h, measured.statusRight.h);

  // Command: inside the top row when it fits between the two clusters, otherwise under it.
  const between = rects.statusRight.x - (rects.statusLeft.x + rects.statusLeft.w) - 2 * gap;
  const cmd = { ...measured.command };
  if (cmd.w <= between) {
    const cx = (rects.statusLeft.x + rects.statusLeft.w + rects.statusRight.x) / 2;
    rects.command = { x: r(cx - cmd.w / 2), y: top, w: cmd.w, h: cmd.h, row: 'top' };
  } else {
    rects.command = { x: r((left + right) / 2 - cmd.w / 2), y: statusBottom + gap, w: cmd.w, h: cmd.h, row: 'below' };
  }
  const hudTopBottom = Math.max(statusBottom, rects.command.y + rects.command.h);

  // Self view and live tiles.
  const tiles = [];
  if (mode === 'scene' && corner !== 'hidden') {
    tiles.push({ key: 'pip', ...m.pip, corner });
  } else if (mode === 'live') {
    tiles.push({ key: 'own', ...m.live.own, corner: 'bottom-left' });
    tiles.push({ key: 'friend', ...m.live.friend, corner: 'bottom-right' });
  }
  for (const t of tiles) {
    const isLeft = t.corner.endsWith('left');
    const x = isLeft ? left : right - t.w;
    let y;
    if (t.corner.startsWith('bottom')) y = bottom - t.h;
    else {
      y = statusBottom + gap;
      const probe = { x, y, w: t.w, h: t.h };
      if (overlaps(probe, rects.command)) y = rects.command.y + rects.command.h + gap;
    }
    rects[t.key] = { x: r(x), y: r(y), w: t.w, h: t.h, corner: t.corner };
  }

  // Reason strip: bottom centre, never over a tile and never cut short. It sits in the free
  // span next to the bottom tiles when the text fits there in two lines, otherwise it is
  // lifted above the tiles (options.reasonRow = 'lifted'). In landscape mirror games it can
  // sit in the side band beside the mirror (options.reasonRow = 'side').
  const slots = reasonSlots(m, rects, tiles, { left, right, bottom, mode, hudTopBottom });
  const want = options.reasonRow ?? slots.preferred;
  const slot = slots[want] ?? slots.bottom;
  const rs = { ...measured.reason };
  if (slot.row === 'bottom') {
    const x = clamp(slot.x, slot.centre - rs.w / 2, slot.x + slot.w - rs.w);
    rects.reason = { x: r(x), y: bottom - rs.h, w: rs.w, h: rs.h, row: 'bottom' };
  } else if (slot.row === 'side') {
    rects.reason = { x: r(slot.x + (slot.w - rs.w) / 2), y: bottom - rs.h, w: rs.w, h: rs.h, row: 'side' };
  } else {
    rects.reason = { x: r(slot.centre - rs.w / 2), y: slot.bottomY - rs.h, w: rs.w, h: rs.h, row: 'lifted' };
  }
  const bottomTiles = tiles.filter((t) => t.corner.startsWith('bottom')).map((t) => rects[t.key]);

  // Play area: what is left between the HUD bands; games keep key objects inside it.
  const playTop = hudTopBottom + gap;
  const reasonTop = rects.reason.row === 'side' ? bottom + gap : rects.reason.y;
  const playBottom = Math.min(reasonTop, ...bottomTiles.map((t) => t.y)) - gap;
  rects.play = { x: left, y: playTop, w: right - left, h: Math.max(0, playBottom - playTop) };

  if (mode === 'mirror') rects.mirror = mirrorRect(m, rects.play);
  return { metrics: m, rects };
}

/**
 * Where the reason strip may go, before it is measured. The DOM sets max-width to the slot
 * width, measures the wrapped plate (two lines at most) and passes the size to placeHud.
 * bottom: next to the bottom tiles (or centred when there are none)
 * lifted: full width, above the bottom tiles
 * side:   landscape mirror games, in the band beside the mirror
 */
export function reasonSlots(m, rects, tiles, { left, right, bottom, mode, hudTopBottom }) {
  const out = {};
  const bottomTiles = tiles.filter((t) => t.corner.startsWith('bottom')).map((t) => rects[t.key]);
  let spanL = left, spanR = right;
  for (const t of bottomTiles) {
    if (t.x <= left + 1) spanL = Math.max(spanL, t.x + t.w + m.gap);
    else spanR = Math.min(spanR, t.x - m.gap);
  }
  out.bottom = { row: 'bottom', x: spanL, w: spanR - spanL, centre: bottomTiles.length ? (spanL + spanR) / 2 : (left + right) / 2 };
  if (bottomTiles.length) {
    const tileTop = Math.min(...bottomTiles.map((t) => t.y));
    out.lifted = { row: 'lifted', x: left, w: right - left, centre: (left + right) / 2, bottomY: tileTop - m.gap };
  }
  const minSpan = Math.max(220, 0.55 * (right - left));
  out.preferred = !bottomTiles.length || out.bottom.w >= minSpan ? 'bottom' : 'lifted';
  if (mode === 'mirror' && !m.portrait) {
    const area = { x: left, y: hudTopBottom + m.gap, w: right - left, h: bottom - hudTopBottom - m.gap };
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
export function hudSlots(viewport, measuredStatus, options = {}) {
  const fake = { statusLeft: measuredStatus.statusLeft, statusRight: measuredStatus.statusRight, command: measuredStatus.command ?? { w: 1, h: 1 }, reason: { w: 1, h: 1 } };
  const { metrics, rects } = placeHud(viewport, fake, options);
  const left = metrics.insets.left + metrics.margin, right = metrics.w - metrics.insets.right - metrics.margin;
  const bottom = metrics.h - metrics.insets.bottom - metrics.margin;
  const tiles = ['pip', 'own', 'friend'].filter((k) => rects[k]).map((k) => ({ key: k, corner: rects[k].corner }));
  const hudTopBottom = Math.max(rects.statusLeft.y + rects.statusLeft.h, rects.statusRight.y + rects.statusRight.h, rects.command.y + rects.command.h);
  return { reason: reasonSlots(metrics, rects, tiles, { left, right, bottom, mode: options.mode ?? 'scene', hudTopBottom }), commandMaxW: right - left };
}

/**
 * Mirror games (target hit, rhythm): the camera mirror is the scene. The whole camera frame
 * is fitted inside the play area, so no HUD plate ever covers the player or a target.
 * The space around it is the stage colour (night), never a stretched or cropped image.
 */
export function mirrorRect(m, play, camAspect) {
  const aspect = camAspect ?? (m.portrait ? 3 / 4 : 4 / 3);
  const area = play && play.h > 0 ? play : { x: 0, y: 0, w: m.w, h: m.h };
  let mw = area.w, mh = mw / aspect;
  if (mh > area.h) { mh = area.h; mw = mh * aspect; }
  return { x: r(area.x + (area.w - mw) / 2), y: r(area.y + (area.h - mh) / 2), w: r(mw), h: r(mh), fit: 'contain' };
}

/** Problems found in a set of rendered rects. Empty list = pass. */
export function checkRects(rects, { w, h, minCommand }) {
  const problems = [];
  const keys = Object.keys(rects).filter((k) => !['play', 'mirror', 'scene'].includes(k));
  for (const k of keys) {
    const a = rects[k];
    if (a.x < 0 || a.y < 0 || a.x + a.w > w + 0.5 || a.y + a.h > h + 0.5) problems.push(`${k} is cut off (${fmt(a)})`);
  }
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = rects[keys[i]], b = rects[keys[j]];
      if (overlaps(a, b)) problems.push(`${keys[i]} overlaps ${keys[j]}`);
    }
  }
  if (minCommand && rects.command && rects.command.font < minCommand) {
    problems.push(`command font ${rects.command.font}px is under 8 % of the height (${minCommand}px)`);
  }
  return problems;
}

const fmt = (a) => `${r(a.x)},${r(a.y)} ${r(a.w)}x${r(a.h)}`;

/**
 * Shell layout (menus, catalogue, results, settings): page gutter, content width and the
 * game grid. Same numbers as the .ba-shell and .ba-grid rules in ui-kit/kit.css.
 */
export function shellGrid({ w, h, insets = typicalInsets(w, h) }) {
  const gutter = Math.max(clamp(16, 0.04 * w, 48), insets.left, insets.right);
  const nav = h < 500 && w > h ? 'side rail' : w < 900 ? 'bottom tab bar' : 'top bar';
  const rail = nav === 'side rail' ? 76 : 0; // landscape phones keep their height for content
  const maxContent = w >= 1680 ? 1560 : 1240;
  const content = Math.min(w - 2 * gutter - rail, maxContent);
  const cols = w < 600 ? 2 : w < 900 ? 3 : w < 1680 ? 4 : 5;
  const gap = clamp(12, 0.02 * w, 24);
  const tile = (content - (cols - 1) * gap) / cols;
  return {
    gutter: Math.round(gutter * 10) / 10, content: Math.round(content), cols,
    gap: Math.round(gap * 10) / 10, tile: Math.round(tile), tileArt: Math.round(tile * 0.75), nav, rail,
  };
}
