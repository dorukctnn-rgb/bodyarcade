// Hips the model finds right under the shoulders are not hips (a desk edge, a chair back): the profile is then the head and
// shoulders with the torso estimated from the shoulder width, not a seated profile with a torso a third of the real one.
import { describe, expect, it } from 'vitest';
import { DESK_SHAPE, SEATED_SHAPE, synthPose, type BodyShape } from '../pose/synth.ts';
import { createCalibrator } from './calibrator.ts';
import { read } from './reading.ts';
import { synthFrames } from '../pose/synth.ts';

/** A desk where the model puts the hips at the bottom edge of the picture, 0.3 image heights under shoulders 0.6 wide. */
const FALSE_HIPS: BodyShape = { cx: 0.5, hipY: 0.95, T: 0.3, W: 0.6, aspect: 4 / 3 };

describe('hips that are too close under the shoulders', () => {
  it('are not taken for hips: the best profile is head and shoulders, and a whole-body game is told the hips are not in view', () => {
    const lm = synthPose(FALSE_HIPS);
    expect(lm[23]!.visibility).toBeGreaterThan(0.5);            // the model is sure of them
    expect(lm[23]!.y).toBeLessThan(0.97);                       // and they are inside the picture
    const full = read(lm, FALSE_HIPS.aspect, 'full');
    expect(full.best).toBe('upper');
    expect(full.problem).toBe('hips_out');
    expect(full.hint).toMatchObject({ action: 'step_back' });
    expect(read(lm, FALSE_HIPS.aspect, 'upper')).toMatchObject({ best: 'upper', problem: null });
  });

  it('a real torso is not touched: seated and desk shapes keep their profiles', () => {
    expect(read(synthPose(SEATED_SHAPE), SEATED_SHAPE.aspect, 'upper').best).toBe('seated');
    expect(read(synthPose(DESK_SHAPE), DESK_SHAPE.aspect, 'upper').best).toBe('upper');
  });

  it('the calibrator ends with the desk profile and an estimated torso, not the false one', () => {
    const c = createCalibrator({ now: () => 0 });
    c.begin('upper');
    for (const f of synthFrames({ durationMs: 3000, shapeAt: () => FALSE_HIPS, seed: 4 })) if (c.push(f).ready) break;
    const p = c.profile()!;
    expect(p).toMatchObject({ kind: 'upper', hipsEstimated: true });
    expect(p.T).toBeCloseTo(1.45 * 0.6, 1);                     // from the shoulders, not the 0.3 the false hips would give
  });
});
