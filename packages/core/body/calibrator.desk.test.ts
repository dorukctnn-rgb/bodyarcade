// Easy and fast calibration (24 Oct: "kamera hips'i algılamadı, daha kolay ve hızlı olmalı"): the calibrator takes the
// best profile it can measure. A desk (head and shoulders, hips under the picture) starts upper-body games at once and
// full-body games after a short wait, with a clear state; a player who steps back gets the full profile; it never
// blocks. Synthetic figures here (core/pose/synth.ts); the real recordings are in calibrator.real.test.ts.
import { describe, expect, it } from 'vitest';
import { LM, type BodyProfile, type CalibrationStatus, type Framing, type Landmark, type LightGrid, type PoseFrame } from '../types/index.ts';
import { DESK_SHAPE, FULL_SHAPE, SEATED_SHAPE, synthFrames, type BodyShape, type PoseParams } from '../pose/synth.ts';
import { createCalibrator, STILL } from './calibrator.ts';
import { TORSO_PER_SHOULDER } from './profile.ts';

interface Run { c: ReturnType<typeof createCalibrator>; seen: CalibrationStatus[]; readyAt: number | null; last: CalibrationStatus; profile: BodyProfile | null }

function run(frames: PoseFrame[], want: Framing, opts: Parameters<ReturnType<typeof createCalibrator>['begin']>[1] = {}): Run {
  const c = createCalibrator({ now: () => 1_700_000_000_000 });
  c.begin(want, opts);
  const seen: CalibrationStatus[] = [];
  const t0 = frames[0]?.t ?? 0;
  for (const f of frames) {
    const s = c.push(f);
    seen.push(s);
    if (s.ready) return { c, seen, readyAt: f.t - t0, last: s, profile: c.profile() };
  }
  return { c, seen, readyAt: null, last: seen[seen.length - 1] as CalibrationStatus, profile: c.profile() };
}

const still = (shape: BodyShape, seconds: number, extra: Partial<Parameters<typeof synthFrames>[0]> = {}): PoseFrame[] =>
  synthFrames({ durationMs: seconds * 1000, shapeAt: () => shape, seed: 5, ...extra });

describe('a desk: head and shoulders, the hips under the picture', () => {
  it('an upper-body game starts after the hold of one second: upper profile, torso estimated from the shoulders', () => {
    const { readyAt, profile, last, seen } = run(still(DESK_SHAPE, 4), 'upper');
    expect(readyAt).not.toBeNull();
    expect(readyAt!).toBeGreaterThanOrEqual(1000);
    expect(readyAt!).toBeLessThan(1100);
    expect(profile).toMatchObject({ v: 2, framing: 'upper', kind: 'upper', hipsEstimated: true, capturedAt: 1_700_000_000_000 });
    expect(profile!.W).toBeCloseTo(DESK_SHAPE.W, 1);
    expect(profile!.T).toBeCloseTo(TORSO_PER_SHOULDER * profile!.W, 6);
    expect(profile!.rest.hipY).toBeCloseTo(profile!.rest.shoulderY + profile!.T, 6);
    expect(profile!.rest.hipX).toBeCloseTo(profile!.rest.shoulderX, 6);
    expect(profile!.U).toBeUndefined();
    expect(last).toMatchObject({ ready: true, code: 'ok', progress: 1, outcome: 'measured', profile: 'upper', supports: { full: false, upper: true, seated: true, side: false } });
    expect(seen.some((s) => s.code === 'hold')).toBe(true);
  });

  it('a full-body game at the desk: it says how far back, and the desk profile is taken on its own after 3.5 s of standing still', () => {
    const { seen, readyAt, profile, last } = run(still(DESK_SHAPE, 8), 'full');
    expect(readyAt!).toBeGreaterThanOrEqual(3500);
    expect(readyAt!).toBeLessThan(3600);
    expect(profile).toMatchObject({ kind: 'upper', hipsEstimated: true, framing: 'upper' });
    expect(last).toMatchObject({ ready: true, outcome: 'fallback', profile: 'upper' });
    // while waiting: a code with a measured hint, the profile it can run, and how long until the fallback
    const waiting = seen.filter((s) => !s.ready && s.samples > 20);
    expect(waiting.length).toBeGreaterThan(50);
    for (const s of waiting) {
      expect(['too_close', 'hips_out']).toContain(s.code);
      expect(s.hint).toMatchObject({ action: 'step_back', steps: { min: 2, max: 3 } });
      expect(s.profile).toBe('upper');
      expect(s.supports).toEqual({ full: false, upper: true, seated: true, side: false });
      expect(s.seen).toMatchObject({ head: true, shoulders: true, hips: false });
    }
    const ins = waiting.map((s) => s.fallbackInMs).filter((v): v is number => v !== undefined);
    expect(ins.length).toBeGreaterThan(40);
    for (let i = 1; i < ins.length; i++) expect(ins[i]!).toBeLessThanOrEqual(ins[i - 1]!);
    expect(ins[0]!).toBeLessThanOrEqual(STILL.fallbackMinMs + 3500);
    expect(ins.at(-1)!).toBeLessThan(100);
  });

  it('"play at the desk" ends it at once with what is measured; before a steady spell it finishes as soon as there is one', () => {
    const frames = still(DESK_SHAPE, 8);
    const early = createCalibrator({ now: () => 0 });
    early.begin('full');
    for (const f of frames.filter((x) => x.t <= 150)) early.push(f);
    expect(early.accept()).toBe(false);                 // 0.15 s is not a steady spell yet
    let readyAt: number | null = null;
    for (const f of frames.filter((x) => x.t > 150)) if (early.push(f).ready) { readyAt = f.t; break; }
    expect(readyAt!).toBeGreaterThanOrEqual(STILL.fallbackMinMs);
    expect(readyAt!).toBeLessThan(STILL.fallbackMinMs + 100);
    expect(early.profile()).toMatchObject({ kind: 'upper' });

    const late = createCalibrator({ now: () => 0 });
    late.begin('full');
    for (const f of frames.filter((x) => x.t <= 1200)) late.push(f);
    expect(late.profile()).toBeNull();
    expect(late.accept()).toBe(true);                   // after 1.2 s of standing still there is a profile to take
    expect(late.profile()).toMatchObject({ kind: 'upper', hipsEstimated: true });
    expect(late.push(frames.find((x) => x.t > 1300) as PoseFrame)).toMatchObject({ ready: true, code: 'ok', outcome: 'fallback' });
  });

  it('a game without a seated variant (fallback off) cannot be taken at the desk; it waits and offers another way to play', () => {
    const frames = still(DESK_SHAPE, 14);
    const c = createCalibrator();
    c.begin('full', { fallback: false });
    for (const f of frames.filter((x) => x.t <= 1500)) c.push(f);
    expect(c.accept()).toBe(false);
    const { seen, readyAt } = run(frames, 'full', { fallback: false });
    expect(readyAt).toBeNull();
    const at = (ms: number): CalibrationStatus => seen.find((s, i) => frames[i]!.t >= ms) as CalibrationStatus;
    expect(at(11_000).escape).toBeUndefined();
    expect(at(12_100).escape).toBe(true);
    expect(at(12_100).fallbackInMs).toBeUndefined();
    expect(['too_close', 'hips_out']).toContain(at(12_100).code);
  });

  it('the absolute limit: a player who does not reach the full profile is not kept longer than maxWaitSeconds', () => {
    const { readyAt, last } = run(still(DESK_SHAPE, 10), 'full', { idleFallbackSeconds: 100, maxWaitSeconds: 5 });
    expect(readyAt!).toBeGreaterThanOrEqual(5000);
    expect(readyAt!).toBeLessThan(5100);
    expect(last.outcome).toBe('fallback');
  });

  it('hips in view but the legs not (sitting back from the camera): the seated profile, torso measured, full-body games wait', () => {
    const { profile, last, seen } = run(still(SEATED_SHAPE, 6), 'upper');
    expect(profile).toMatchObject({ framing: 'upper', kind: 'seated' });
    expect(profile!.hipsEstimated).toBeUndefined();
    expect(profile!.T).toBeCloseTo(SEATED_SHAPE.T, 1);
    expect(last).toMatchObject({ outcome: 'measured', profile: 'seated', supports: { full: false, upper: true, seated: true } });
    const full = run(still(SEATED_SHAPE, 8), 'full');
    expect(full.seen.some((s) => s.code === 'knees_out' || s.code === 'feet_out')).toBe(true);
    expect(full.last).toMatchObject({ outcome: 'fallback', profile: 'seated' });
    void seen;
  });
});

describe('the full body is taken when the player gets there', () => {
  it('standing in the picture: full profile after about one second, every game kind supported', () => {
    const { readyAt, profile, last } = run(still(FULL_SHAPE, 4), 'full');
    expect(readyAt!).toBeGreaterThanOrEqual(1000);
    expect(readyAt!).toBeLessThan(1100);
    expect(profile).toMatchObject({ framing: 'full', kind: 'full' });
    expect(profile!.hipsEstimated).toBeUndefined();
    expect(profile!.U).toBeGreaterThan(0);
    expect(last).toMatchObject({ outcome: 'measured', profile: 'full', supports: { full: true, upper: true, seated: true, side: false } });
  });

  it('an upper-body game for a player standing in full view is still an upper-framed profile, and the measurement is the full one', () => {
    const { profile } = run(still(FULL_SHAPE, 4), 'upper');
    expect(profile).toMatchObject({ framing: 'upper', kind: 'full' });
  });

  it('a player stepping back from the desk is never cut off by the fallback: the full profile arrives about a second after they stop', () => {
    // 1 s at the desk, 3 s walking back to the play space, then still.
    const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;
    const shapeAt = (t: number): BodyShape => {
      const u = Math.min(1, Math.max(0, (t - 1000) / 3000));
      return { ...FULL_SHAPE, W: lerp(DESK_SHAPE.W, FULL_SHAPE.W, u), T: lerp(DESK_SHAPE.T, FULL_SHAPE.T, u), hipY: lerp(DESK_SHAPE.hipY, FULL_SHAPE.hipY, u) };
    };
    const { readyAt, last, seen } = run(synthFrames({ durationMs: 9000, shapeAt, seed: 3 }), 'full');
    expect(last).toMatchObject({ outcome: 'measured', profile: 'full' });
    expect(readyAt!).toBeGreaterThan(4000 + 900);
    expect(readyAt!).toBeLessThan(4000 + 1700);
    // on the way the profile rises and the full-body games unlock at the end
    const profiles = seen.map((s) => s.profile);
    expect(profiles.includes('upper')).toBe(true);
    expect(profiles.at(-1)).toBe('full');
    expect(seen.some((s) => s.supports?.full === true && !s.ready)).toBe(true);
  });

  it('a fidgeting player at the desk is not cut off early (movement restarts the steady count) but is not kept for ever either', () => {
    // sways 0.4 image heights side to side with a 1.6 s period: never steady for a hold
    const sway = (t: number): PoseParams => ({ shiftX: 0.2 * Math.sin((t / 1600) * 2 * Math.PI) });
    const { seen, readyAt, last } = run(synthFrames({ durationMs: 14_000, shapeAt: () => DESK_SHAPE, motion: sway, seed: 8 }), 'full');
    // the idle count (3.5 s) never gets there; the absolute limit (9 s) ends it at the first steady half second after it
    expect(readyAt!).toBeGreaterThanOrEqual(9000);
    expect(readyAt!).toBeLessThan(10_500);
    expect(last.outcome).toBe('fallback');
    expect(seen.slice(0, 250).some((s) => s.ready)).toBe(false);          // nothing before 8 s
  });
});

describe('a hold of about one second, tolerant of what is not movement', () => {
  it('one glitch frame in the hold costs nothing', () => {
    const frames = still(FULL_SHAPE, 4);
    const glitch = frames[15] as PoseFrame;
    glitch.landmarks = (glitch.landmarks as Landmark[]).map((p) => ({ ...p, x: p.x + 0.12, y: p.y + 0.1 }));
    const { readyAt } = run(frames, 'full');
    expect(readyAt!).toBeGreaterThanOrEqual(1000);
    expect(readyAt!).toBeLessThan(1100);
  });

  it('two lost frames (nobody found for 70 ms) do not restart it; half a second without a person does', () => {
    const blink = still(FULL_SHAPE, 4);
    for (const i of [14, 15]) (blink[i] as PoseFrame).landmarks = null;
    const a = run(blink, 'full');
    expect(a.readyAt!).toBeLessThan(1100);
    const gone = still(FULL_SHAPE, 5);
    for (let i = 14; i < 14 + 18; i++) (gone[i] as PoseFrame).landmarks = null;   // 0.6 s
    const b = run(gone, 'full');
    expect(b.readyAt!).toBeGreaterThan(14 * 33.3 + 18 * 33.3 + 900);
  });

  it('a person who moves during the hold is asked to hold still, and the hold counts from when they stop', () => {
    const shift = (t: number): PoseParams => (t < 800 ? { shiftX: 0.5 * Math.sin(t / 90) } : {});
    const { seen, readyAt } = run(synthFrames({ durationMs: 5000, shapeAt: () => FULL_SHAPE, motion: shift, seed: 2 }), 'full');
    expect(seen.some((s) => s.code === 'move_still')).toBe(true);
    expect(readyAt!).toBeGreaterThan(800 + 800);
    expect(readyAt!).toBeLessThan(800 + 1500);
  });

  it('works at slow pose rates: 10 Hz and 4 Hz finish in the hold time too', () => {
    for (const hz of [10, 4]) {
      const { readyAt } = run(synthFrames({ durationMs: 5000, fps: hz, shapeAt: () => DESK_SHAPE, seed: 1 }), 'upper');
      expect(readyAt!).toBe(1000);
    }
  });
});

describe('light: the code that explains why nobody is found', () => {
  const grid = (fn: (c: number, r: number) => number): LightGrid => {
    const luma: number[] = [];
    for (let r = 0; r < 12; r++) for (let c = 0; c < 16; c++) luma.push(fn(c, r));
    return { cols: 16, rows: 12, luma };
  };
  const dark = grid(() => 0.05);
  const window = grid((c, r) => (c / 16 > 0.35 && c / 16 < 0.65 && r / 12 > 0.15 && r / 12 < 0.65 ? 0.12 : 0.85));
  const fine = grid(() => 0.5);
  const everySecond = (g: LightGrid) => (t: number): LightGrid | undefined => (Math.round(t) % 330 < 34 ? g : undefined);

  it('a dark picture with nobody found: too_dark with the more-light advice, never no_person', () => {
    const frames = synthFrames({ durationMs: 3000, motion: () => ({ absent: true }), light: everySecond(dark) });
    const { seen } = run(frames, 'full');
    const codes = new Set(seen.slice(40).map((s) => s.code));
    expect([...codes]).toEqual(['too_dark']);
    expect(seen.at(-1)!.hint).toEqual({ action: 'more_light' });
  });

  it('a person against a window with nobody found: backlit, with the light-in-front advice', () => {
    const frames = synthFrames({ durationMs: 3000, motion: () => ({ absent: true }), light: everySecond(window) });
    const { seen } = run(frames, 'full');
    expect(seen.at(-1)).toMatchObject({ code: 'backlit', hint: { action: 'light_in_front' } });
  });

  it('a person found in an evenly lit picture is not delayed by the light check', () => {
    const { readyAt } = run(synthFrames({ durationMs: 3000, shapeAt: () => FULL_SHAPE, light: everySecond(fine), seed: 4 }), 'full');
    expect(readyAt!).toBeLessThan(1100);
  });

  it('a person found but the picture black: not calibrated on garbage for a few seconds (too_dark), and then not held for ever', () => {
    const { seen, readyAt } = run(synthFrames({ durationMs: 9000, shapeAt: () => FULL_SHAPE, light: everySecond(dark), seed: 4 }), 'full');
    expect(seen.slice(0, 120).every((s) => s.code === 'too_dark')).toBe(true);       // the first four seconds
    expect(seen[120]!.hint).toEqual({ action: 'more_light' });
    expect(readyAt).not.toBeNull();                                                  // a dim room where the model sees the player must be playable
    expect(readyAt!).toBeGreaterThanOrEqual(STILL.darkGraceMs);
    expect(readyAt!).toBeLessThan(STILL.darkGraceMs + 200);
  });

  it('light that comes back ends the block at once', () => {
    const lit = (t: number): LightGrid | undefined => (Math.round(t) % 330 < 34 ? (t < 2000 ? dark : fine) : undefined);
    const { readyAt, seen } = run(synthFrames({ durationMs: 9000, shapeAt: () => FULL_SHAPE, light: lit, seed: 4 }), 'full');
    expect(seen[30]!.code).toBe('too_dark');
    expect(readyAt!).toBeGreaterThanOrEqual(2000);          // the first lit picture ends it: the hold had been going on all along
    expect(readyAt!).toBeLessThan(2100);
  });

  it('a dark picture with nobody found keeps saying too_dark: it is the reason, not a block, so it has no end', () => {
    const { seen } = run(synthFrames({ durationMs: 12_000, motion: () => ({ absent: true }), light: everySecond(dark) }), 'full');
    expect(seen.at(-1)!.code).toBe('too_dark');
    expect(seen.at(-1)!.escape).toBe(true);                                          // after 12 s the screen offers another way to play
  });

  it('the light measurement expires: after 1.5 s without one the old verdict is dropped', () => {
    const once = (t: number): LightGrid | undefined => (t < 50 ? dark : undefined);
    const { seen } = run(synthFrames({ durationMs: 3000, motion: () => ({ absent: true }), light: once }), 'full');
    expect(seen[10]!.code).toBe('too_dark');
    expect(seen.at(-1)!.code).toBe('no_person');
  });
});

describe('more than one person in the picture (one player)', () => {
  const other = (share: number) => () => ({ shape: { cx: 0.8, W: FULL_SHAPE.W * share, T: FULL_SHAPE.T * share, hipY: 0.52 } as Partial<BodyShape> });

  it('a second person about as big as the player blocks for a moment (many_people), then never for more than the grace', () => {
    const { seen, readyAt } = run(synthFrames({ durationMs: 8000, shapeAt: () => FULL_SHAPE, other: other(0.9), seed: 6 }), 'full');
    const codes = seen.map((s) => s.code);
    expect(codes).toContain('many_people');
    expect(seen.find((s) => s.code === 'many_people')!.hint).toEqual({ action: 'one_person' });
    expect(readyAt!).toBeGreaterThanOrEqual(STILL.manyGraceMs);
    expect(readyAt!).toBeLessThan(STILL.manyGraceMs + 200);
  });

  it('someone small far behind (a third of the size) does not count', () => {
    const { readyAt, seen } = run(synthFrames({ durationMs: 4000, shapeAt: () => FULL_SHAPE, other: other(0.3), seed: 6 }), 'full');
    expect(seen.some((s) => s.code === 'many_people')).toBe(false);
    expect(readyAt!).toBeLessThan(1100);
  });

  it('the second person leaving ends the block at once', () => {
    const { readyAt } = run(synthFrames({ durationMs: 8000, shapeAt: () => FULL_SHAPE, other: (t) => (t < 1500 ? other(0.9)() : null), seed: 6 }), 'full');
    expect(readyAt!).toBeGreaterThanOrEqual(1500);
    expect(readyAt!).toBeLessThan(2700);
  });
});

describe('the platform says codes, never words', () => {
  const codeLike = /^[a-z][a-z0-9_]*$/;
  const walk = (v: unknown, path: string, out: string[]): void => {
    if (typeof v === 'string') { if (!codeLike.test(v)) out.push(`${path}=${v}`); return; }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`, out)); return; }
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`, out);
  };

  it('every status of every scenario holds only code-like strings and numbers', () => {
    const scenarios: [PoseFrame[], Framing][] = [
      [still(DESK_SHAPE, 6), 'full'],
      [still(DESK_SHAPE, 3), 'upper'],
      [still(FULL_SHAPE, 3), 'full'],
      [still({ ...FULL_SHAPE, cx: 0.93, W: 0.3, T: 0.25, hipY: 0.55 }, 2), 'full'],
      [still({ ...FULL_SHAPE, T: 0.05, W: 0.04 }, 2), 'full'],
      [synthFrames({ durationMs: 2000, motion: () => ({ absent: true }) }), 'full'],
    ];
    const bad: string[] = [];
    for (const [frames, want] of scenarios) {
      const c = createCalibrator({ now: () => 0 });
      c.begin(want);
      for (const f of frames) walk(c.push(f), 'status', bad);
      walk(c.profile(), 'profile', bad);
    }
    expect(bad).toEqual([]);
  });
});

describe('landmark order used by the desk shape', () => {
  it('has the hips outside the picture and low visibility, as a model reports them at a desk', () => {
    const f = still(DESK_SHAPE, 0.1)[0] as PoseFrame;
    const lm = f.landmarks as Landmark[];
    expect((lm[LM.leftHip] as Landmark).y).toBeGreaterThan(1);
    expect((lm[LM.leftHip] as Landmark).visibility).toBeLessThan(0.5);
    expect((lm[LM.nose] as Landmark).visibility).toBeGreaterThan(0.9);
    expect((lm[LM.leftShoulder] as Landmark).visibility).toBeGreaterThan(0.9);
  });
});
