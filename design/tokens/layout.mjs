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

  // Reason strip: bottom centre, never over a tile. Shift into the free span or lift above.
  const rs = { ...measured.reason };
  const bottomTiles = tiles.filter((t) => t.corner.startsWith('bottom')).map((t) => rects[t.key]);
  let spanL = left, spanR = right;
  for (const t of bottomTiles) {
    if (t.x <= left + 1) spanL = Math.max(spanL, t.x + t.w + gap);
    else spanR = Math.min(spanR, t.x - gap);
  }
  if (rs.w <= spanR - spanL) {
    const centre = bottomTiles.length ? (spanL + spanR) / 2 : (left + right) / 2;
    const x = clamp(spanL, centre - rs.w / 2, spanR - rs.w);
    rects.reason = { x: r(x), y: bottom - rs.h, w: rs.w, h: rs.h, lifted: false };
  } else {
    const tileTop = Math.min(...bottomTiles.map((t) => t.y));
    rects.reason = { x: r((left + right) / 2 - rs.w / 2), y: tileTop - gap - rs.h, w: rs.w, h: rs.h, lifted: true };
  }

  // Play area: what is left between the HUD bands; games keep key objects inside it.
  const playTop = hudTopBottom + gap;
  const playBottom = Math.min(rects.reason.y, ...bottomTiles.map((t) => t.y)) - gap;
  rects.play = { x: left, y: playTop, w: right - left, h: Math.max(0, playBottom - playTop) };

  if (mode === 'mirror') rects.mirror = mirrorRect(m);
  return { metrics: m, rects };
}

/**
 * Mirror games (target hit, rhythm): the camera mirror is the scene.
 * Portrait screens show the whole camera frame with bands above and below for the HUD;
 * landscape screens fill the screen (cover) and the HUD sits on plates.
 */
export function mirrorRect(m, camAspect) {
  const { w, h, portrait } = m;
  const aspect = camAspect ?? (portrait ? 3 / 4 : 4 / 3);
  if (portrait) {
    const mw = w, mh = r(w / aspect);
    return { x: 0, y: r((h - mh) / 2), w: mw, h: mh, fit: 'contain' };
  }
  const scale = Math.max(w / (h * aspect), 1);
  const mw = r(h * aspect * scale), mh = r(h * scale);
  return { x: r((w - mw) / 2), y: r((h - mh) / 2), w: mw, h: mh, fit: 'cover' };
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
