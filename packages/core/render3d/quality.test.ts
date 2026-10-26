// QualityGovernor: B11 (the level yo-yoed 8 times in 70 s) and B12 (the level rose while paused) from code-audit.md,
// plus the tier table and the first-guess rules of graphics-maps.md 3.3.
import { describe, expect, it } from 'vitest';
import type { QualityLevel } from '../types/index.ts';
import { createQualityGovernor, initialQualityLevel, QUALITY_TIERS, tierFor } from './quality.ts';

/** A pretend device: how long a frame takes at each level. */
type Device = (level: QualityLevel) => number;

function run(gov: ReturnType<typeof createQualityGovernor>, device: Device, seconds: number) {
  const changes: { atSec: number; level: QualityLevel }[] = [];
  let clock = 0;
  while (clock < seconds * 1000) {
    const ms = device(gov.level);
    clock += ms;
    const r = gov.sample(ms, { paused: false });
    if (r !== null) changes.push({ atSec: clock / 1000, level: r });
  }
  return changes;
}

describe('QualityGovernor: dropping', () => {
  it('starts where it is told and says nothing while the first window fills', () => {
    const g = createQualityGovernor({ level: 2 });
    expect(g.level).toBe(2);
    for (let i = 0; i < 20; i++) expect(g.sample(40, { paused: false })).toBeNull();
    expect(g.level).toBe(2);
  });

  it('drops one level after a slow first window (about a second, not three)', () => {
    const g = createQualityGovernor({ level: 2 });
    const changes = run(g, () => 40, 5);
    expect(changes[0]?.level).toBe(1);
    expect(changes[0]!.atSec).toBeLessThan(2);
  });

  it('never goes below level 0 and reports nothing there', () => {
    const g = createQualityGovernor({ level: 0 });
    expect(run(g, () => 80, 30)).toEqual([]);
    expect(g.level).toBe(0);
  });

  it('keeps dropping one level at a time while the device stays too slow', () => {
    const g = createQualityGovernor({ level: 2 });
    const changes = run(g, () => 60, 20);
    expect(changes.map((c) => c.level)).toEqual([1, 0]);
    expect(changes[1]!.atSec - changes[0]!.atSec).toBeGreaterThanOrEqual(2.5);
  });

  it('one long first frame (shader compile, 2.6 s) does not cause a drop', () => {
    const g = createQualityGovernor({ level: 2 });
    expect(g.sample(2617, { paused: false })).toBeNull();
    const changes = run(g, () => 10, 20);
    expect(changes).toEqual([]);
    expect(g.level).toBe(2);
  });

  it('ignores impossible frame times', () => {
    const g = createQualityGovernor({ level: 2 });
    for (const bad of [NaN, -5, 0, Infinity]) expect(g.sample(bad, { paused: false })).toBeNull();
    expect(g.stats().frames).toBe(0);
  });
});

describe('QualityGovernor: paused frames (B12)', () => {
  it('ten thousand paused frames at 1 ms change nothing and feed nothing', () => {
    const g = createQualityGovernor({ level: 1 });
    for (let i = 0; i < 10_000; i++) expect(g.sample(1, { paused: true })).toBeNull();
    expect(g.level).toBe(1);
    expect(g.stats().frames).toBe(0);
  });

  it('the old bug: a slow device that was paused for a while must not rise', () => {
    const g = createQualityGovernor({ level: 0 });
    run(g, () => 66, 5); // slow device at level 0 for a few seconds
    for (let i = 0; i < 20_000; i++) g.sample(1, { paused: true }); // 20 s of paused animation frames
    expect(g.level).toBe(0);
    expect(run(g, () => 66, 30)).toEqual([]);
  });

  it('after a pause the first frames are slow (resume stall) and are not judged', () => {
    const g = createQualityGovernor({ level: 2 });
    run(g, () => 12, 10);
    g.sample(1, { paused: true });
    // 8 slow frames right after resume, then fast frames: no drop
    for (let i = 0; i < 8; i++) expect(g.sample(120, { paused: false })).toBeNull();
    const changes = run(g, () => 12, 20);
    expect(changes).toEqual([]);
  });
});

describe('QualityGovernor: rising and hysteresis (B11)', () => {
  it('a fast device that started low rises one level at a time, slowly', () => {
    const g = createQualityGovernor({ level: 0 });
    const changes = run(g, () => 11, 120);
    expect(changes.map((c) => c.level)).toEqual([1, 2]);
    expect(changes[0]!.atSec).toBeGreaterThanOrEqual(20); // never within 20 s of the start
    expect(changes[1]!.atSec - changes[0]!.atSec).toBeGreaterThanOrEqual(20);
  });

  it('a device whose frame time sits between the two thresholds never changes level', () => {
    for (const start of [0, 1, 2] as QualityLevel[]) {
      const g = createQualityGovernor({ level: start });
      expect(run(g, () => 20, 600)).toEqual([]);
    }
  });

  it('B11: level 2 costs 30 ms, level 1 costs 14 ms: at most five changes in ten minutes (the old code made 8 in 70 s)', () => {
    const g = createQualityGovernor({ level: 2 });
    const changes = run(g, (l) => [8, 14, 30][l] as number, 600);
    expect(changes.length).toBeLessThanOrEqual(5);
    expect(g.level).toBe(1);
    // and in any 70 second span at most two changes
    for (const c of changes) expect(changes.filter((o) => o.atSec >= c.atSec && o.atSec < c.atSec + 70).length).toBeLessThanOrEqual(2);
  });

  it('after two failed attempts the level is given up for the rest of the session', () => {
    const g = createQualityGovernor({ level: 2 });
    const changes = run(g, (l) => [8, 14, 30][l] as number, 1800);
    const last = changes[changes.length - 1]!;
    expect(last.atSec).toBeLessThan(600);
    expect(changes.filter((c) => c.level === 2).length).toBeLessThanOrEqual(2);
  });

  it('a transient hitch (one slow window in a fast run) drops once and recovers later', () => {
    const g = createQualityGovernor({ level: 2 });
    let t = 0;
    const changes: { atSec: number; level: QualityLevel }[] = [];
    for (let i = 0; i < 100_000 && t < 200_000; i++) {
      const slow = t > 30_000 && t < 33_000; // three slow seconds
      const ms = slow ? 40 : 10;
      t += ms;
      const r = g.sample(ms, { paused: false });
      if (r !== null) changes.push({ atSec: t / 1000, level: r });
    }
    expect(changes.map((c) => c.level)).toEqual([1, 2]);
    expect(changes[1]!.atSec).toBeGreaterThan(30 + 90 - 5); // no return before the 90 s hold
  });
});

describe('control: the old controller really did yo-yo on the same device (engine.js:702-711)', () => {
  /** The old rule, copied: 90 samples of 1/dt, drop under 42 fps, rise over 58 fps and 12 s after the last RISE only. */
  function oldController(device: Device, seconds: number, start: QualityLevel): number {
    let level = start, t = 0, lastQualityCheck = 0, changes = 0;
    const samples: number[] = [];
    while (t < seconds) {
      const dt = device(level) / 1000;
      t += dt;
      samples.push(1 / Math.max(dt, 1e-3));
      if (samples.length >= 90) {
        const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
        samples.length = 0;
        if (avg < 42 && level > 0) { level = (level - 1) as QualityLevel; changes++; }
        else if (avg > 58 && level < 2 && t - lastQualityCheck > 12) { level = (level + 1) as QualityLevel; changes++; lastQualityCheck = t; }
      }
    }
    return changes;
  }

  it('the old rule changes level at least six times in 70 s; the new governor at most two', () => {
    const device: Device = (l) => [8, 14, 30][l] as number;
    expect(oldController(device, 70, 2)).toBeGreaterThanOrEqual(6);
    const g = createQualityGovernor({ level: 2 });
    expect(run(g, device, 70).length).toBeLessThanOrEqual(2);
  });
});

describe('QualityGovernor: set and reset', () => {
  it('set() forces a level and starts a fresh window', () => {
    const g = createQualityGovernor({ level: 2 });
    for (let i = 0; i < 50; i++) g.sample(50, { paused: false });
    expect(g.set(0)).toBe(true);
    expect(g.level).toBe(0);
    expect(g.set(0)).toBe(false);
    // the old slow samples are gone; a fast run at level 0 does not change anything for a while
    expect(run(g, () => 8, 10)).toEqual([]);
  });

  it('counts its work for tests and the perf HUD', () => {
    const g = createQualityGovernor({ level: 2 });
    run(g, () => 40, 5);
    const s = g.stats();
    expect(s.changes).toBeGreaterThanOrEqual(1);
    expect(s.frames).toBeGreaterThan(0);
    expect(s.level).toBe(g.level);
  });
});

describe('quality tiers (graphics-maps.md 3.3)', () => {
  it('has three tiers with falling cost', () => {
    expect(QUALITY_TIERS).toHaveLength(3);
    const [t0, t1, t2] = QUALITY_TIERS;
    expect(t0!.pixelRatioCap.mobile).toBe(1);
    expect(t1!.pixelRatioCap.mobile).toBe(1.25);
    expect(t2!.pixelRatioCap.mobile).toBe(1.6);
    expect(t0!.shadows).toBe('off');
    expect(t0!.blobShadows).toBe(true);
    expect(t1!.shadows).toBe('actors');
    expect(t2!.shadows).toBe('actors+trees');
    expect(t0!.fpsCap).toBe(30);
    expect(t1!.fpsCap).toBe(60);
    expect(t0!.propMaterial).toBe('lambert');
    expect(t1!.propMaterial).toBe('lambert');
    expect(t2!.propMaterial).toBe('standard');
    expect(t0!.shadowMapSize).toBe(0);
    expect(t1!.shadowMapSize).toBe(1024);
    expect(t2!.shadowMapSize).toBe(1024);
    expect(t0!.weatherLight).toBeLessThan(t1!.weatherLight);
    expect(t0!.weatherHeavy).toBeLessThan(t1!.weatherHeavy);
  });

  it('tierFor clamps to the three levels', () => {
    expect(tierFor(0).label).toBe('T0');
    expect(tierFor(2).label).toBe('T2');
    expect(tierFor(7 as QualityLevel).label).toBe('T2');
    expect(tierFor(-1 as QualityLevel).label).toBe('T0');
  });
});

describe('initialQualityLevel (first guess; the governor corrects it in the first seconds)', () => {
  it('software WebGL is level 0', () => {
    expect(initialQualityLevel({ softwareRenderer: true, mobile: false, cores: 16 })).toBe(0);
  });
  it('a pose model slower than 25 ms median at calibration goes straight to level 0', () => {
    expect(initialQualityLevel({ mobile: false, cores: 12, poseMedianMs: 31 })).toBe(0);
    expect(initialQualityLevel({ mobile: false, cores: 12, poseMedianMs: 20 })).toBe(2);
  });
  it('a stored choice wins over the guess unless the pose model is slow', () => {
    expect(initialQualityLevel({ mobile: true, cores: 8, stored: 2 })).toBe(2);
    expect(initialQualityLevel({ mobile: true, cores: 8, stored: 2, poseMedianMs: 40 })).toBe(0);
  });
  it('phones start in the middle, weak phones low, desktops high', () => {
    expect(initialQualityLevel({ mobile: true, cores: 8 })).toBe(1);
    expect(initialQualityLevel({ mobile: true, cores: 4 })).toBe(0);
    expect(initialQualityLevel({ mobile: true, cores: 2 })).toBe(0);
    expect(initialQualityLevel({ mobile: false, cores: 8 })).toBe(2);
    expect(initialQualityLevel({ mobile: false, cores: 2 })).toBe(1);
  });
  it('a GPU tier from a benchmark table overrides the core count', () => {
    expect(initialQualityLevel({ mobile: false, cores: 16, gpuTier: 1 })).toBe(0);
    expect(initialQualityLevel({ mobile: true, cores: 4, gpuTier: 3 })).toBe(2);
  });
  it('knows nothing: middle', () => {
    expect(initialQualityLevel({})).toBe(1);
  });
});
