// A mirror game's picture stands still: its box (and the play area) is the same whether the command plate and the reason strip are
// showing or not, whatever their sizes, at the ten screens, for one player and for two; and the plates, when they come, come into the
// room that was kept for them. The browser test (tests/e2e/target-mirror-still.spec.ts) does the same with the real HUD and the real words.
import { describe, expect, it } from 'vitest';
import {
  BREAKPOINTS, duoAvailable, duoReasonRows, hudMetrics, mirrorReasonLines, mirrorStill, placeHud, placeMirrorHud, placeMirrorHudDuo,
  type MeasuredDuo, type MeasuredHud, type Rect, type Size,
} from './layout.ts';
import { layoutDuo, layoutProblems, layoutScene } from '../render2d/layout2d.ts';

const over = (a: Rect, b: Rect): boolean => a.x < b.x + b.w - 0.5 && a.x + a.w > b.x + 0.5 && a.y < b.y + b.h - 0.5 && a.y + a.h > b.y + 0.5;
const key = (a: Rect): string => `${a.x},${a.y} ${a.w}x${a.h}`;

/** The plates of the score and the time as the browser draws them (the numbers of the real HUD at 1280 x 800, in ems of the numeral). */
function status(n: number): { statusLeft: Size; statusRight: Size } {
  return { statusLeft: { w: Math.ceil(1.8 * n), h: Math.ceil(1.86 * n) }, statusRight: { w: Math.ceil(4.4 * n), h: Math.ceil(1.86 * n) } };
}

/** A command plate of one line of this many ems of its font in width (a word and its glyph), or of two lines. */
function commandOf(font: number, em: number, lines: 1 | 2): Size {
  return { w: Math.ceil(em * font), h: Math.ceil((lines === 1 ? 1.29 : 2.25) * font) };
}

/** A reason plate of this width and lines. */
function reasonOf(font: number, w: number, lines: 1 | 2): Size {
  return { w: Math.round(w), h: Math.ceil((lines === 1 ? 2.19 : 3.24) * font) };
}

const HIDDEN: Size = { w: 1, h: 1 };

describe.each(BREAKPOINTS.map((b) => [b.id, b] as const))('a mirror game for one player, %s', (_id, bp) => {
  const m = hudMetrics({ w: bp.w, h: bp.h });
  const st = status(m.font.numeral);
  const base: MeasuredHud = { ...st, command: HIDDEN, reason: HIDDEN };
  const still = mirrorStill({ w: bp.w, h: bp.h }, st);

  // plates no wider than the room they stand in (the HUD fits them to it)
  const cmd = (em: number, lines: 1 | 2): Size => ({ ...commandOf(m.font.command, em, lines), w: Math.min(Math.ceil(em * m.font.command), Math.floor(still.commandRoom)) });
  const variants: [string, MeasuredHud][] = [
    ['a short command', { ...base, command: cmd(3, 1) }],
    ['a command of two words', { ...base, command: cmd(7.5, 1) }],
    ['a command of two lines', { ...base, command: cmd(5, 2) }],
    ['a reason of one line', { ...base, reason: reasonOf(m.font.reason, Math.min(14 * m.font.reason, still.reasonRoom), 1) }],
    ['a reason of two lines at the width of the room', { ...base, reason: reasonOf(m.font.reason, still.reasonRoom, 2) }],
    ['both', { ...base, command: cmd(6, 1), reason: reasonOf(m.font.reason, Math.min(12 * m.font.reason, still.reasonRoom), 2) }],
    ['a longer score and time', { statusLeft: { ...st.statusLeft, w: st.statusLeft.w + 60 }, statusRight: st.statusRight, command: cmd(6, 1), reason: HIDDEN }],
  ];

  it('keeps the picture and the play area where they are whatever the plates are', () => {
    const none = placeMirrorHud({ w: bp.w, h: bp.h }, base);
    expect(none.rects.mirror).toEqual(still.mirror);
    expect(none.rects.play).toEqual(still.play);
    for (const [what, measured] of variants) {
      const placed = placeMirrorHud({ w: bp.w, h: bp.h }, measured);
      expect(key(placed.rects.mirror as Rect), what).toBe(key(still.mirror));
      expect(key(placed.rects.play), what).toBe(key(still.play));
    }
  });

  it('puts the picture inside the play area, inside the screen, and leaves it the larger part of the play area', () => {
    const { mirror, play } = still;
    expect(mirror.x).toBeGreaterThanOrEqual(play.x - 0.5);
    expect(mirror.y).toBeGreaterThanOrEqual(play.y - 0.5);
    expect(mirror.x + mirror.w).toBeLessThanOrEqual(play.x + play.w + 0.5);
    expect(mirror.y + mirror.h).toBeLessThanOrEqual(play.y + play.h + 0.5);
    expect(play.y + play.h).toBeLessThanOrEqual(bp.h);
    // the room kept for the plates does not eat the picture: it is at least a third of the screen's height, a quarter of its width
    expect(mirror.h).toBeGreaterThan(bp.h / 3);
    expect(mirror.w).toBeGreaterThan(bp.w / 4);
  });

  it('keeps the plates out of the picture, in the rows that were kept for them', () => {
    for (const [what, measured] of variants) {
      const placed = placeMirrorHud({ w: bp.w, h: bp.h }, measured);
      const r = placed.rects;
      // a plate that fits the room kept for it never lies over the picture
      const cmd = measured.command;
      const lines = cmd.h > Math.ceil(1.29 * m.font.command) + 1 ? 2 : 1;
      if (cmd.w > 1 && lines <= placed.still.commandLines) expect(over(r.command, r.mirror as Rect), `${what}: command`).toBe(false);
      if (measured.reason.w > 1) {
        const reasonLines = measured.reason.h > Math.ceil(2.19 * m.font.reason) + 1 ? 2 : 1;
        if (reasonLines <= placed.still.reasonLines) expect(over(r.reason, r.mirror as Rect), `${what}: reason`).toBe(false);
      }
      expect(r.reason.row, what).toBe(placed.still.reasonRow);
      expect(r.command.row, what).toBe(placed.still.commandBelow ? 'below' : 'top');
    }
  });

  it('puts the command in the same row and the reason in the same row for every word', () => {
    const rows = new Set(variants.filter(([, v]) => v.command.w > 1).map(([, v]) => placeMirrorHud({ w: bp.w, h: bp.h }, v).rects.command.row));
    expect([...rows]).toHaveLength(1);
    const reasonRows = new Set(variants.filter(([, v]) => v.reason.w > 1).map(([, v]) => placeMirrorHud({ w: bp.w, h: bp.h }, v).rects.reason.row));
    expect([...reasonRows]).toHaveLength(1);
  });

  it('is what the 2D kit lays out too, so the camera element and the drawn picture are one box', () => {
    for (const [what, measured] of [['none', base] as const, ...variants]) {
      const scene = layoutScene({ w: bp.w, h: bp.h, camAspect: 4 / 3, mode: 'mirror', pipCorner: 'hidden', measured });
      const hud = placeMirrorHud({ w: bp.w, h: bp.h }, measured);
      const box = hud.rects.mirror as Rect;
      // the camera's own aspect fitted in the box the HUD gives the camera element
      expect(scene.mirror.x, what).toBeGreaterThanOrEqual(box.x - 0.5);
      expect(scene.mirror.y, what).toBeGreaterThanOrEqual(box.y - 0.5);
      expect(scene.mirror.x + scene.mirror.w, what).toBeLessThanOrEqual(box.x + box.w + 0.5);
      expect(scene.mirror.y + scene.mirror.h, what).toBeLessThanOrEqual(box.y + box.h + 0.5);
      expect(layoutProblems(scene), what).toEqual([]);
    }
    const first = layoutScene({ w: bp.w, h: bp.h, camAspect: 4 / 3, mode: 'mirror', pipCorner: 'hidden', measured: base }).mirror;
    for (const [what, measured] of variants) {
      expect(layoutScene({ w: bp.w, h: bp.h, camAspect: 4 / 3, mode: 'mirror', pipCorner: 'hidden', measured }).mirror, what).toEqual(first);
    }
  });

  it('is not what the other modes do: a scene game still lets the plates decide its play area', () => {
    const a = placeHud({ w: bp.w, h: bp.h }, base, { mode: 'scene', pipCorner: 'hidden' }).rects.play;
    const b = placeHud({ w: bp.w, h: bp.h }, variants[1]![1], { mode: 'scene', pipCorner: 'hidden' }).rects.play;
    expect(key(b)).not.toBe(key(a));
  });
});

describe('the rows kept for the plates of a mirror game', () => {
  const rows = (id: string): ReturnType<typeof mirrorStill> => {
    const bp = BREAKPOINTS.find((b) => b.id === id)!;
    return mirrorStill({ w: bp.w, h: bp.h }, status(hudMetrics({ w: bp.w, h: bp.h }).font.numeral));
  };

  it('puts the command between the score and the time on a wide screen and under them on a narrow one', () => {
    for (const id of ['phone-land-844', 'phone-land-915', 'tablet-land-1024', 'laptop-1280', 'laptop-1440', 'tv-1920']) expect(rows(id).commandBelow, id).toBe(false);
    for (const id of ['phone-360', 'phone-390', 'phone-412', 'tablet-768']) expect(rows(id).commandBelow, id).toBe(true);
  });

  it('gives the reason the band beside the picture on a phone held sideways, and the bottom row everywhere else', () => {
    for (const id of ['phone-land-844', 'phone-land-915']) expect(rows(id).reasonRow, id).toBe('side');
    for (const id of ['phone-360', 'phone-390', 'phone-412', 'tablet-768', 'tablet-land-1024', 'laptop-1280', 'laptop-1440', 'tv-1920']) expect(rows(id).reasonRow, id).toBe('bottom');
  });

  it('keeps room for one line of a reason where the row is wide, two where it is narrow', () => {
    for (const id of ['tablet-768', 'tablet-land-1024', 'laptop-1280', 'laptop-1440', 'tv-1920']) expect(rows(id).reasonLines, id).toBe(1);
    for (const id of ['phone-360', 'phone-390', 'phone-412']) expect(rows(id).reasonLines, id).toBe(2);
  });

  it('counts the lines by the letters the longest reason needs at the smallest size the words are made', () => {
    const m = hudMetrics({ w: 1280, h: 800 });
    expect(mirrorReasonLines(m, 1232)).toBe(1);
    expect(mirrorReasonLines(m, 300)).toBe(2);
  });
});

describe.each(BREAKPOINTS.filter((b) => duoAvailable(b)).map((b) => [b.id, b] as const))('a mirror game for two players, %s', (_id, bp) => {
  const m = hudMetrics({ w: bp.w, h: bp.h });
  const n = m.font.numeral;
  const base: MeasuredDuo = {
    statusP1: { w: Math.ceil(4.7 * n), h: Math.ceil(1.86 * n) }, statusP2: { w: Math.ceil(4.7 * n), h: Math.ceil(1.86 * n) }, timer: { w: Math.ceil(4.36 * n), h: Math.ceil(1.86 * n) },
    command: HIDDEN,
  };
  const half = duoReasonRows({ w: bp.w, h: bp.h }, { mirror: true }).bottom.w;
  // the lines of a reason the room is kept for: the longest reason the games allow fits one line of the half row at the smallest size where it is wide
  const lines = mirrorReasonLines(m, half);
  const variants: [string, MeasuredDuo][] = [
    ['a command', { ...base, command: commandOf(m.font.command, 6, 1) }],
    ['a reason for player one', { ...base, reasonP1: reasonOf(m.font.reason, 12 * m.font.reason, 1) }],
    ['two reasons the whole width of their halves', { ...base, reasonP1: reasonOf(m.font.reason, half, lines), reasonP2: reasonOf(m.font.reason, half, lines) }],
    ['everything', { ...base, command: commandOf(m.font.command, 6, 1), reasonP1: reasonOf(m.font.reason, half, lines), reasonP2: reasonOf(m.font.reason, 12 * m.font.reason, 1) }],
  ];

  it('keeps each player\'s half of the play area (and the picture fitted in both) where it is whatever the plates are', () => {
    const none = placeMirrorHudDuo({ w: bp.w, h: bp.h }, base, { away: null });
    for (const [what, measured] of variants) {
      const placed = placeMirrorHudDuo({ w: bp.w, h: bp.h }, measured, { away: null });
      expect(placed.rects.playP1, what).toEqual(none.rects.playP1);
      expect(placed.rects.playP2, what).toEqual(none.rects.playP2);
      const a = layoutDuo({ w: bp.w, h: bp.h, camAspect: 4 / 3, measured, mirror: true });
      const b = layoutDuo({ w: bp.w, h: bp.h, camAspect: 4 / 3, measured: base, mirror: true });
      expect(a.mirror, what).toEqual(b.mirror);
      expect(layoutProblems(a), what).toEqual([]);
    }
  });

  it('keeps the plates out of the lanes, and the away notice where the lane is', () => {
    for (const [what, measured] of variants) {
      const placed = placeMirrorHudDuo({ w: bp.w, h: bp.h }, measured, { away: 'p2' });
      for (const k of ['command', 'reasonP1', 'reasonP2'] as const) {
        const plate = placed.rects[k];
        if (!plate || plate.w <= 1) continue;
        expect(over(plate, placed.rects.playP1), `${what}: ${k} over player one's half`).toBe(false);
        expect(over(plate, placed.rects.playP2), `${what}: ${k} over player two's half`).toBe(false);
      }
    }
    const a = placeMirrorHudDuo({ w: bp.w, h: bp.h }, { ...base, away: { w: 300, h: 120 } }, { away: 'p2' });
    const b = placeMirrorHudDuo({ w: bp.w, h: bp.h }, { ...variants[3]![1], away: { w: 300, h: 120 } }, { away: 'p2' });
    expect(a.rects.away).toEqual(b.rects.away);
  });
});
