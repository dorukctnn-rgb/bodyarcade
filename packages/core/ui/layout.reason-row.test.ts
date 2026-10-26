// The row of the reason strip. The DOM chooses it after measuring how many lines the text takes in each row (hud/fit.ts), and the
// scene kit lays the play area out from the same layout code but cannot measure text, so the measurement carries the chosen row.
import { describe, expect, it } from 'vitest';
import { hudMetrics, placeHud, type MeasuredHud } from './layout.ts';

// A 360 x 780 phone with the self view in the bottom left corner: the strip beside it is 220 px wide, the lifted row has the whole width.
const measured = (extra: Partial<MeasuredHud> = {}): MeasuredHud => ({
  statusLeft: { w: 50, h: 60 }, statusRight: { w: 147, h: 60 }, command: { w: 245, h: 82 }, reason: { w: 336, h: 75 }, ...extra,
});
const viewport = { w: 360, h: 780 };
const options = { mode: 'scene', pipCorner: 'bottom-left' } as const;

describe('the row of the reason strip', () => {
  it('is the preferred row when nobody says otherwise', () => {
    expect(placeHud(viewport, measured(), options).rects.reason.row).toBe('bottom');
  });

  it('is the row the measurement carries, and the play area ends above the strip when it is lifted', () => {
    const beside = placeHud(viewport, measured(), options).rects;
    const lifted = placeHud(viewport, measured({ reasonRow: 'lifted' }), options).rects;
    expect(lifted.reason.row).toBe('lifted');
    expect(lifted.reason.y + lifted.reason.h).toBeLessThanOrEqual((lifted.pip as { y: number }).y);
    expect(lifted.play.y + lifted.play.h).toBeLessThanOrEqual(lifted.reason.y);
    expect(lifted.play.h).toBeLessThan(beside.play.h);
  });

  it('is the option when there is one: the HUD chooses a row and says so', () => {
    expect(placeHud(viewport, measured({ reasonRow: 'lifted' }), { ...options, reasonRow: 'bottom' }).rects.reason.row).toBe('bottom');
  });

  it('falls back to the bottom row when the layout has no such row (no self view, nothing to lift above)', () => {
    const metrics = hudMetrics(viewport);
    expect(placeHud({ ...viewport, metrics }, measured({ reasonRow: 'lifted' }), { mode: 'scene', pipCorner: 'hidden' }).rects.reason.row).toBe('bottom');
  });
});
