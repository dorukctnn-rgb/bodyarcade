// Twist Turbine through the real feature extractor (calibration, One Euro filter, the 8 s "slow re-centring") and the real twist
// detector, over a whole set of twisting. Found by the browser run of 24 Oct: the extractor's re-centring (core/body/features.ts,
// the drift while standing neutral) follows the shoulder width of a twisted body, the reference width shrinks, the detector's span
// (shoulder width over the reference) climbs over its 0.9 limit, and after about 15 s of twisting (or one 3 s hold of the overload)
// no twist is counted any more ("Turn from the shoulders" for a player who is turning from the shoulders).
//
// The cure is one condition in the extractor (the drift only while the shoulders face the camera: `shoulderSpan > 0.93`); the patch is
// takip/devir/bodyarcade-build/PATCH-features-drift-twist.diff (checked: 5 5 6 6 6 6 4 twists in 10 s windows instead of 5 5 0 0 0 0 0,
// and the twists go on after a 12 s hold). The extractor belongs to the platform builder, so the tests wait: take the `.skip` off when
// the patch has landed on v2.
import { describe, expect, it } from 'vitest';
import { replayMotion } from '../../core/moves/testing/harness.ts';
import { curve } from '../../core/moves/testing/motions.ts';
import { armTo, type Motion } from '../../core/moves/testing/rig.ts';

const W = 0.8;

const turning = (v: (t: number) => number, turn = 40): Motion => (t) => {
  const s = v(t);
  const phi = turn * s;
  const xh = 0.8 * W * s;
  const half = (W / 2) * Math.cos((phi * Math.PI) / 180);
  const g = 0.02;
  const y = -0.6;
  return { twist: phi, armL: armTo('L', { x: xh - g + half, y }), armR: armTo('R', { x: xh + g - half, y }) };
};

/** Left first, then across every `period` ms (a crossing takes 0.9 s), `count` times from `t0`. */
function swing(t0: number, count: number, period: number): (t: number) => number {
  const keys: [number, number][] = [[0, 0], [t0 - 500, 0], [t0, -1]];
  let side = -1;
  for (let i = 0; i < count; i++) {
    const at = t0 + (i + 1) * period;
    keys.push([at - 450, side], [at + 450, -side]);
    side = -side;
  }
  return curve(keys);
}

const repsPer10s = (events: readonly { kind: string; t: number }[], lead: number, windows: number): number[] =>
  Array.from({ length: windows }, (_, i) => events.filter((e) => e.kind === 'rep' && e.t - lead >= i * 10000 && e.t - lead < (i + 1) * 10000).length);

describe.skip('a whole set of twisting through the real extractor (waits for the drift patch of core/body/features.ts)', () => {
  it('keeps counting twists for a minute, 6 in each 10 seconds at 35 a minute', () => {
    const r = replayMotion(turning(swing(1000, 38, 1700)), { detectors: [{ id: 'twist' }], durationMs: 68000 });
    const per10 = repsPer10s(r.events, r.leadMs, 6);
    for (const [i, n] of per10.entries()) expect(n, `window ${i}: ${per10.join(' ')}`).toBeGreaterThanOrEqual(4);
  });

  it('keeps counting after a hold of the overload: twelve seconds twisted to one side, then twisting again', () => {
    const hold = curve([[0, 0], [500, 0], [1000, -1], [3000, -1], [3900, 1], [5400, 1], [6300, -1], [7800, -1], [8700, 1], [20000, 1], [20900, -1], [22600, -1], [23500, 1], [25200, 1], [26100, -1], [27800, -1], [28700, 1], [30400, 1]]);
    const r = replayMotion(turning(hold), { detectors: [{ id: 'twist' }], durationMs: 33000 });
    const after = r.events.filter((e) => e.kind === 'rep' && e.t - r.leadMs > 21000).length;
    expect(after).toBeGreaterThanOrEqual(3);
  });
});
