// The layout of the 2D scene on the ten screens of the plan: nothing the player must read is covered, nothing is cut
// off, the self view keeps the camera's aspect and stays small, the mirror stays inside the play area.
import { describe, expect, it } from 'vitest';
import { BREAKPOINTS, hudMetrics, hudSlots, typicalInsets, type HudMode, type MeasuredDuo, type MeasuredHud, type PipPlacement } from '../ui/layout.ts';
import { layoutDuo, layoutProblems, layoutScene } from './layout2d.ts';

const CAM_ASPECTS = [4 / 3, 16 / 9, 3 / 4, 9 / 16];
const CORNERS: PipPlacement[] = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];

/**
 * Plates as the HUD would measure them: a score of 8 characters, a timer, a command of up to 9 letters, and a reason
 * that wraps to the room the layout gives it (two lines), never wider than the slot it is placed in.
 */
function measure(w: number, h: number, long = false, mode: HudMode = 'scene', pipCorner: PipPlacement = 'bottom-right'): MeasuredHud {
  const m = hudMetrics({ w, h });
  const f = m.font;
  const statusLeft = { w: Math.round(f.numeral * 4.2), h: Math.round(f.numeral * 1.6) };
  const statusRight = { w: Math.round(f.numeral * 3.4), h: Math.round(f.numeral * 1.6) };
  const command = { w: Math.round(f.command * (long ? 5.2 : 3.2)), h: Math.round(f.command * 1.25) };
  const slots = hudSlots({ w, h }, { statusLeft, statusRight, command }, { mode, pipCorner }).reason;
  const slot = slots[slots.preferred] ?? slots.bottom;
  const wanted = Math.round(Math.min(w * 0.6, f.reason * (long ? 20 : 12)));
  return { statusLeft, statusRight, command, reason: { w: Math.min(wanted, Math.floor(slot.w)), h: Math.round(f.reason * 2.4) } };
}

describe.each(BREAKPOINTS.map((b) => [b.label, b] as const))('on %s', (_label, b) => {
  const modes: HudMode[] = ['scene', 'mirror', 'live'];

  it.each(modes)('mode %s: no problems with any camera shape and any corner', (mode) => {
    for (const camAspect of CAM_ASPECTS) {
      for (const corner of CORNERS) {
        for (const long of [false, true]) {
          const r = layoutScene({ w: b.w, h: b.h, camAspect, mode, pipCorner: corner, measured: measure(b.w, b.h, long, mode, corner) });
          expect(layoutProblems(r), `${mode} ${camAspect.toFixed(2)} ${corner} long=${long}`).toEqual([]);
        }
      }
    }
  });

  it('the self view keeps the aspect of the camera and stays small', () => {
    for (const camAspect of CAM_ASPECTS) {
      const r = layoutScene({ w: b.w, h: b.h, camAspect, mode: 'scene', pipCorner: 'bottom-right', measured: measure(b.w, b.h) });
      expect(r.pip).not.toBeNull();
      const p = r.pip!;
      expect(Math.abs(p.w / p.h - camAspect) / camAspect, `aspect ${camAspect}`).toBeLessThan(0.02);
      // "kendi kamera küçük olsun": at most 30 % of the width, 25 % of the height, and under a ninth of the screen area
      expect(p.w).toBeLessThanOrEqual(b.w * 0.3 + 1);
      expect(p.h).toBeLessThanOrEqual(b.h * 0.25 + 1);
      expect((p.w * p.h) / (b.w * b.h)).toBeLessThan(0.11);
      expect(p.w).toBeGreaterThanOrEqual(48);
    }
  });

  it('a hidden self view takes no space and mirror mode has none', () => {
    const hidden = layoutScene({ w: b.w, h: b.h, camAspect: 4 / 3, mode: 'scene', pipCorner: 'hidden', measured: measure(b.w, b.h) });
    expect(hidden.pip).toBeNull();
    const mirror = layoutScene({ w: b.w, h: b.h, camAspect: 4 / 3, mode: 'mirror', pipCorner: 'bottom-right', measured: measure(b.w, b.h) });
    expect(mirror.pip).toBeNull();
    expect(layoutProblems(hidden)).toEqual([]);
  });

  it('every corner is reachable and the four corners give four different places', () => {
    const spots = new Set(CORNERS.map((c) => {
      const r = layoutScene({ w: b.w, h: b.h, camAspect: 4 / 3, mode: 'scene', pipCorner: c, measured: measure(b.w, b.h) });
      return `${r.pip!.x},${r.pip!.y}`;
    }));
    expect(spots.size).toBe(4);
  });

  it('the mirror sits inside the play area with the camera aspect, centred', () => {
    for (const camAspect of CAM_ASPECTS) {
      const r = layoutScene({ w: b.w, h: b.h, camAspect, mode: 'mirror', pipCorner: 'bottom-right', measured: measure(b.w, b.h) });
      expect(r.mirror.w / r.mirror.h).toBeCloseTo(camAspect, 1);
      expect(r.mirror.x).toBeGreaterThanOrEqual(r.play.x - 1);
      expect(r.mirror.y).toBeGreaterThanOrEqual(r.play.y - 1);
      expect(r.mirror.x + r.mirror.w).toBeLessThanOrEqual(r.play.x + r.play.w + 1);
      expect(r.mirror.y + r.mirror.h).toBeLessThanOrEqual(r.play.y + r.play.h + 1);
    }
  });

  it('live matches: your own view is smaller than the friend, both on screen and clear of the HUD', () => {
    const r = layoutScene({ w: b.w, h: b.h, camAspect: 4 / 3, mode: 'live', pipCorner: 'bottom-right', measured: measure(b.w, b.h, false, 'live') });
    expect(r.own).not.toBeNull();
    expect(r.friend).not.toBeNull();
    expect(r.own!.w).toBeLessThan(r.friend!.w);
    expect(layoutProblems(r)).toEqual([]);
  });
});

describe.each(BREAKPOINTS.filter((b) => Math.min(b.w, b.h) >= 500 && b.w > b.h).map((b) => [b.label, b] as const))('two players on one camera, %s', (_label, b) => {
  const m = hudMetrics({ w: b.w, h: b.h });
  const f = m.font;
  const measured = (long: boolean): MeasuredDuo => ({
    statusP1: { w: Math.round(f.numeral * 4), h: Math.round(f.numeral * 1.6) },
    statusP2: { w: Math.round(f.numeral * 4), h: Math.round(f.numeral * 1.6) },
    timer: { w: Math.round(f.numeral * 3), h: Math.round(f.numeral * 1.6) },
    command: { w: Math.round(f.command * 3.6), h: Math.round(f.command * 1.25) },
    reasonP1: { w: Math.round(f.reason * (long ? 18 : 9)), h: Math.round(f.reason * 2.4) },
    reasonP2: { w: Math.round(f.reason * (long ? 18 : 9)), h: Math.round(f.reason * 2.4) },
  });

  it('one shared self view at the bottom centre, a lane for each player, nothing covered', () => {
    for (const away of [null, 'p1', 'p2'] as const) for (const long of [false, true]) {
      const r = layoutDuo({ w: b.w, h: b.h, camAspect: 16 / 9, measured: measured(long), away });
      expect(layoutProblems(r), `away ${away} long ${long}`).toEqual([]);
      expect(r.lanes).toBeDefined();
      const [a, c] = r.lanes!;
      expect(a.x + a.w).toBeLessThanOrEqual(c.x + 0.5);
      const mid = r.pip!.x + r.pip!.w / 2;
      expect(Math.abs(mid - b.w / 2)).toBeLessThan(b.w * 0.05 + 8);
      expect(r.pip!.w / r.pip!.h).toBeCloseTo(16 / 9, 1);
      expect(r.pip!.w).toBeLessThanOrEqual(b.w * 0.3 + 1);
    }
  });
});

describe('layout details', () => {
  it('safe insets are respected on a phone with a notch', () => {
    const b = BREAKPOINTS[1]!;
    const insets = { top: 47, right: 0, bottom: 34, left: 0 };
    const r = layoutScene({ w: b.w, h: b.h, insets, camAspect: 3 / 4, mode: 'scene', pipCorner: 'bottom-right', measured: measure(b.w, b.h) });
    expect(r.hud['statusLeft']!.y).toBeGreaterThanOrEqual(insets.top);
    expect(r.pip!.y + r.pip!.h).toBeLessThanOrEqual(b.h - insets.bottom);
    expect(layoutProblems(r)).toEqual([]);
  });

  it('an unusual camera shape (a very wide webcam) still fits the window and the play area', () => {
    for (const b of BREAKPOINTS) {
      const r = layoutScene({ w: b.w, h: b.h, camAspect: 2.4, mode: 'scene', pipCorner: 'bottom-right', measured: measure(b.w, b.h) });
      expect(layoutProblems(r)).toEqual([]);
    }
  });

  it('typical insets are used when none are given', () => {
    const b = BREAKPOINTS[0]!;
    const r = layoutScene({ w: b.w, h: b.h, camAspect: 3 / 4, mode: 'scene', pipCorner: 'bottom-right', measured: measure(b.w, b.h) });
    expect(r.hud['statusLeft']!.y).toBeGreaterThanOrEqual(typicalInsets(b.w, b.h).top);
  });
});
