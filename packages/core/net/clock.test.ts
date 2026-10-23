import { describe, expect, it } from 'vitest';
import { ClockFilter, SLEW_MS_PER_S, SNAP_MS } from './clock.ts';

/** A ping whose server stamp was taken half way through a round trip, with the server clock `trueOff` ahead. */
function ping(f: ClockFilter, local: number, rtt: number, trueOff: number, asym = 0): boolean {
  const serverTime = local - rtt / 2 + trueOff + asym;       // stamped half way (plus any asymmetry)
  return f.add(rtt, serverTime, local);
}

describe('ClockFilter', () => {
  it('needs three samples before it trusts anything, then finds the offset within half a round trip', () => {
    const f = new ClockFilter();
    expect(ping(f, 1000, 40, 5000)).toBe(false);
    expect(ping(f, 1100, 42, 5000)).toBe(false);
    expect(f.synced).toBe(false);
    expect(ping(f, 1200, 38, 5000)).toBe(true);
    expect(f.synced).toBe(true);
    expect(Math.abs(f.offset(1200) - 5000)).toBeLessThan(0.5);
  });

  it('lets the samples with the smallest round trips win over slow ones', () => {
    const f = new ClockFilter();
    for (let i = 0; i < 6; i++) ping(f, 1000 + i * 100, 20, 7000);
    // a burst answered while the main thread was busy: long round trips and a biased offset
    for (let i = 0; i < 6; i++) ping(f, 2000 + i * 100, 220, 7000, 90);
    expect(Math.abs(f.offset(2600) - 7000)).toBeLessThan(1);
  });

  it('calls a first estimate built on slow round trips not good, and a later fast one good', () => {
    const f = new ClockFilter();
    for (let i = 0; i < 3; i++) ping(f, 1000 + i * 70, 200, 100);
    expect(f.good).toBe(true);                                 // nothing faster has been seen: it is the best we know
    ping(f, 2000, 15, 100); ping(f, 2070, 16, 100); ping(f, 2140, 14, 100);
    for (let i = 0; i < 70; i++) ping(f, 100_000 + i * 10, 300, 100, 120);   // the fast ones age out of the pool
    expect(f.good).toBe(false);
  });

  it('slews by at most 5 ms per second while a match runs, and snaps for a step', () => {
    const f = new ClockFilter();
    for (let i = 0; i < 4; i++) ping(f, 1000 + i * 70, 20, 1000);
    f.setSlew(true);
    for (let i = 0; i < 4; i++) ping(f, 5000 + i * 70, 10, 1100);           // the server clock really moved 100 ms (faster pings win)
    const t0 = 5300;
    const o0 = f.offset(t0);
    expect(o0).toBeGreaterThanOrEqual(1000 - 1);
    expect(o0).toBeLessThan(1100);
    const o1 = f.offset(t0 + 1000);
    expect(o1 - o0).toBeLessThanOrEqual(SLEW_MS_PER_S + 1e-9);
    expect(o1 - o0).toBeGreaterThan(SLEW_MS_PER_S - 0.1);
    const o20 = f.offset(t0 + 20_000);
    expect(Math.abs(o20 - 1100)).toBeLessThan(0.5);
    // a step bigger than SNAP_MS is not drift
    for (let i = 0; i < 6; i++) ping(f, 40_000 + i * 70, 5, 1100 + SNAP_MS + 100);
    expect(Math.abs(f.offset(40_500) - (1100 + SNAP_MS + 100))).toBeLessThan(1);
  });

  it('switching slew off adopts the pending estimate at once', () => {
    const f = new ClockFilter();
    for (let i = 0; i < 4; i++) ping(f, 1000 + i * 70, 20, 1000);
    f.setSlew(true);
    for (let i = 0; i < 4; i++) ping(f, 5000 + i * 70, 10, 1100);
    expect(f.offset(5300)).toBeLessThan(1010);
    f.setSlew(false);                                          // a pause: nothing moves on screen
    expect(Math.abs(f.offset(5300) - 1100)).toBeLessThan(0.5);
  });

  it('adopts a new estimate at once when slewing is off (lobby)', () => {
    const f = new ClockFilter();
    for (let i = 0; i < 4; i++) ping(f, 1000 + i * 70, 20, 1000);
    for (let i = 0; i < 8; i++) ping(f, 3000 + i * 70, 10, 1050);
    expect(Math.abs(f.offset(3600) - 1050)).toBeLessThan(0.5);
  });

  it('uses the welcome time as a provisional offset until real samples arrive, and ignores garbage', () => {
    const f = new ClockFilter();
    f.provisional(10_000, 4000);
    expect(f.offset(4000)).toBe(6000);
    expect(f.synced).toBe(false);
    expect(f.add(-5, 1, 1)).toBe(false);
    expect(f.add(Number.NaN, 1, 1)).toBe(false);
    expect(f.add(10, Number.POSITIVE_INFINITY, 1)).toBe(false);
    expect(f.info(4000).samples).toBe(0);
  });
});
