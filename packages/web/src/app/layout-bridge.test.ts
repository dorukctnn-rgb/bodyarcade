// What the HUD hands the scene kit: the plates as the DOM measured them, and the row the reason strip went to.
import { describe, expect, it } from 'vitest';
import { hudMetrics, placeHud, type HudMode, type MeasuredHud } from '../../../core/ui/layout.ts';
import type { HudLayoutInfo } from '../../../core/ui/hud/hud.ts';
import { followHud, measuredHudOf } from './layout-bridge.ts';

const measured: MeasuredHud = { statusLeft: { w: 50, h: 60 }, statusRight: { w: 147, h: 60 }, command: { w: 245, h: 82 }, reason: { w: 336, h: 75 } };

function infoWith(reasonRow: 'bottom' | 'lifted'): HudLayoutInfo {
  const metrics = hudMetrics({ w: 360, h: 780 });
  const layout = placeHud({ w: 360, h: 780, metrics }, measured, { mode: 'scene', pipCorner: 'bottom-left', reasonRow });
  return { metrics, mode: 'scene', pipCorner: 'bottom-left', duo: false, solo: layout, play: layout.rects.play };
}

describe('the plates handed to the scene kit', () => {
  it('carry the sizes as measured and the row the strip is in', () => {
    expect(measuredHudOf(infoWith('bottom'))).toMatchObject({ reason: { w: 336, h: 75 }, reasonRow: 'bottom' });
    expect(measuredHudOf(infoWith('lifted'))).toMatchObject({ reasonRow: 'lifted' });
  });

  it('reach the kit, so that the play area it lays out is the one above a lifted strip', () => {
    const seen: { mode: HudMode; measured?: MeasuredHud }[] = [];
    const kit = { setHud: (h: { mode: HudMode; measured?: MeasuredHud }) => { seen.push(h); }, setHudDuo: () => undefined, setCamera: () => undefined };
    followHud(kit, infoWith('lifted'), 'scene');
    expect(seen).toHaveLength(1);
    expect(seen[0]?.measured?.reasonRow).toBe('lifted');
    // the same layout again is not handed over a second time; a strip that moved to another row is
    followHud(kit, infoWith('lifted'), 'scene');
    expect(seen).toHaveLength(1);
    followHud(kit, infoWith('bottom'), 'scene');
    expect(seen).toHaveLength(2);
  });
});
