// The TypeScript port must give the same numbers as the art director's reference (design/tokens/layout.mjs) on
// every breakpoint. If the reference changes, this test fails and the port is updated on purpose.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BREAKPOINTS, checkRects, deviceClass, hudMetrics, hudSlots, mirrorRect, pipSize, placeHud, shellGrid, typicalInsets,
  type HudMode, type MeasuredHud, type PipPlacement,
} from './layout.ts';

type Ref = Record<string, (...a: unknown[]) => unknown> & { BREAKPOINTS: typeof BREAKPOINTS };
const refPath = pathToFileURL(resolve(__dirname, '../../../design/tokens/layout.mjs')).href;
const ref = (await import(/* @vite-ignore */ refPath)) as Ref;

const measured = (kind: 'short' | 'long'): MeasuredHud => ({
  statusLeft: { w: 150, h: 58 },
  statusRight: { w: 118, h: 58 },
  command: kind === 'short' ? { w: 220, h: 72 } : { w: 900, h: 90 },
  reason: { w: 300, h: 46 },
});

describe('layout port matches design/tokens/layout.mjs', () => {
  it('has the same ten breakpoints', () => {
    expect(BREAKPOINTS).toEqual(ref.BREAKPOINTS);
    expect(BREAKPOINTS).toHaveLength(10);
  });

  for (const bp of BREAKPOINTS) {
    it(`${bp.id}: device class, insets, HUD metrics, shell grid`, () => {
      expect(deviceClass(bp.w, bp.h)).toBe(ref['deviceClass']?.(bp.w, bp.h));
      expect(typicalInsets(bp.w, bp.h)).toEqual(ref['typicalInsets']?.(bp.w, bp.h));
      expect(hudMetrics({ w: bp.w, h: bp.h })).toEqual(ref['hudMetrics']?.({ w: bp.w, h: bp.h }));
      expect(shellGrid({ w: bp.w, h: bp.h })).toEqual(ref['shellGrid']?.({ w: bp.w, h: bp.h }));
      expect(pipSize({ w: bp.w, h: bp.h })).toEqual(ref['pipSize']?.({ w: bp.w, h: bp.h }));
    });

    it(`${bp.id}: placeHud in every mode and corner`, () => {
      const modes: HudMode[] = ['scene', 'live', 'mirror'];
      const corners: PipPlacement[] = ['bottom-right', 'bottom-left', 'top-left', 'top-right', 'hidden'];
      for (const mode of modes) {
        for (const pipCorner of corners) {
          for (const kind of ['short', 'long'] as const) {
            const a = placeHud({ w: bp.w, h: bp.h }, measured(kind), { mode, pipCorner });
            const b = ref['placeHud']?.({ w: bp.w, h: bp.h }, measured(kind), { mode, pipCorner });
            expect(a, `${bp.id} ${mode} ${pipCorner} ${kind}`).toEqual(b);
          }
        }
      }
    });
  }

  it('mirrorRect and checkRects agree', () => {
    const m = hudMetrics({ w: 1280, h: 800 });
    const play = { x: 24, y: 120, w: 1232, h: 560 };
    expect(mirrorRect(m, play)).toEqual(ref['mirrorRect']?.(m, play));
    const rects = { a: { x: 0, y: 0, w: 100, h: 50 }, b: { x: 90, y: 10, w: 100, h: 50 }, c: { x: 1250, y: 0, w: 100, h: 50 } };
    expect(checkRects(rects, { w: 1280, h: 800 })).toEqual(ref['checkRects']?.(rects, { w: 1280, h: 800 }));
  });
});

describe('the rules in LAYOUT.md hold on every breakpoint', () => {
  for (const bp of BREAKPOINTS) {
    it(`${bp.id}: command is at least 8 percent of the height and the HUD has no overlap`, () => {
      const m = hudMetrics({ w: bp.w, h: bp.h });
      expect(m.font.command).toBeGreaterThanOrEqual(Math.ceil(0.08 * bp.h));
      for (const mode of ['scene', 'live', 'mirror'] as const) {
        // Like the browser: the reason plate gets the width of its slot (two lines at most) before it is measured.
        const base = measured('short');
        const slots = hudSlots({ w: bp.w, h: bp.h }, base, { mode, pipCorner: 'bottom-right' }).reason;
        const slot = slots[slots.preferred] ?? slots.bottom;
        const reason = slot.w < base.reason.w ? { w: Math.floor(slot.w), h: base.reason.h * 2 } : base.reason;
        const { rects } = placeHud({ w: bp.w, h: bp.h }, { ...base, reason }, { mode, pipCorner: 'bottom-right', reasonRow: slots.preferred });
        const flat: Record<string, { x: number; y: number; w: number; h: number; font?: number }> = {};
        for (const [k, v] of Object.entries(rects)) if (v && k !== 'play' && k !== 'mirror') flat[k] = v as never;
        expect(checkRects(flat, { w: bp.w, h: bp.h }), `${bp.id} ${mode}`).toEqual([]);
      }
    });
  }
});
