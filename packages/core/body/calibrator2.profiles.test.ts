// Two players, one camera: what the pair measures (the lower of the two profiles), how it ends when the legs do not fit
// (the desk fallback for the pair), the measured hint of the player the code is about, and the hands-up check for both.
import { describe, expect, it } from 'vitest';
import type { PoseFrame, TwoPlayerCalibrationStatus } from '../types/index.ts';
import { gaussian, mulberry32 } from '../loop/rng.ts';
import { armsUpAt, synthPose, type BodyShape, type PoseParams } from '../pose/synth.ts';
import { createPlayerAssignment } from './players.ts';
import { createTwoPlayerCalibrator } from './calibrator2.ts';
import { HEADROOM } from './headroom.ts';

const ASPECT = 16 / 9;
const body = (cx: number, o: Partial<BodyShape> = {}): BodyShape => ({ cx, hipY: 0.55, T: 0.18, W: 0.14, aspect: ASPECT, ...o });
/** Sitting back from the camera (about 2.3 m): the hips are in the picture, the knees and below are not. */
const sat = (cx: number): BodyShape => body(cx, { hipY: 0.8, T: 0.26, W: 0.2 });

function frames(people: { shape: BodyShape; motion?: (t: number) => PoseParams }[], ms: number, hz = 30): PoseFrame[] {
  const rng = mulberry32(3);
  const out: PoseFrame[] = [];
  for (let t = 0; t <= ms; t += 1000 / hz) {
    const poses = people.map((p) => synthPose(p.shape, p.motion?.(t) ?? {}).map((q) => ({ ...q, x: q.x + gaussian(rng) * 0.0015, y: q.y + gaussian(rng) * 0.0015 })));
    if (rng() < 0.5) poses.reverse();
    out.push({ seq: out.length, t, landmarks: poses[0] ?? null, poses, inferenceMs: 30, source: 'test', aspect: ASPECT });
  }
  return out;
}

function run(fs: PoseFrame[], opts: Parameters<ReturnType<typeof createTwoPlayerCalibrator>['begin']>[1] = {}, want: 'full' | 'upper' = 'full') {
  const assign = createPlayerAssignment();
  const cal = createTwoPlayerCalibrator({ now: () => 0 });
  cal.begin(want, opts);
  const all: TwoPlayerCalibrationStatus[] = [];
  for (const f of fs) {
    const s = cal.push(assign.push(f));
    all.push(s);
    if (s.ready) return { last: s, all, readyAt: f.t, cal };
  }
  return { last: all.at(-1) as TwoPlayerCalibrationStatus, all, readyAt: null as number | null, cal };
}

describe('what the pair measures', () => {
  it('both standing in full view: the full profile, every game kind, measured', () => {
    const { last, readyAt } = run(frames([{ shape: body(0.72) }, { shape: body(0.28) }], 5000));
    expect(readyAt).not.toBeNull();
    expect(last).toMatchObject({ ready: true, code: 'ok', profile: 'full', outcome: 'measured', supports: { full: true, upper: true, seated: true, side: false } });
  });

  it('both sitting back (hips in view, legs not): a full-body request waits, the pair falls back to seated after 3.5 s of standing still', () => {
    const { last, readyAt, all, cal } = run(frames([{ shape: sat(0.72) }, { shape: sat(0.28) }], 9000));
    expect(readyAt!).toBeGreaterThanOrEqual(3500);
    expect(readyAt!).toBeLessThan(3700);
    expect(last).toMatchObject({ ready: true, profile: 'seated', outcome: 'fallback', supports: { full: false, upper: true, seated: true } });
    expect(cal.profiles()![1]).toMatchObject({ kind: 'seated' });
    const waiting = all.filter((s) => !s.ready && s.progress === 0 && s.code !== 'no_person' && s.players[1].samples > 20);
    expect(waiting.length).toBeGreaterThan(30);
    // the code is about one player and carries the measured advice for them
    const w = waiting.at(-1)!;
    expect(['knees_out', 'feet_out', 'too_close']).toContain(w.code);
    expect(w.guidance).toMatchObject({ player: 1, action: 'step_back' });
    expect(w.hint).toMatchObject({ action: 'step_back' });
    expect(w.hint!.steps!.min).toBeGreaterThanOrEqual(1);
    expect(w.fallbackInMs).toBeGreaterThan(0);
    expect(w.fallbackInMs).toBeLessThan(3500);
  });

  it('a game without a seated variant (fallback off) is never taken on less; the screen is asked to offer another way after 12 s', () => {
    const { readyAt, all } = run(frames([{ shape: sat(0.72) }, { shape: sat(0.28) }], 14_000), { fallback: false });
    expect(readyAt).toBeNull();
    expect(all.find((s) => s.escape)).toBeDefined();
    const first = all.find((s) => s.escape) as TwoPlayerCalibrationStatus;
    expect(first.players[1].escape).toBe(true);
  });

  it('"play at the desk" ends it for both players at once with what is measured', () => {
    const fs = frames([{ shape: sat(0.72) }, { shape: sat(0.28) }], 9000);
    const assign = createPlayerAssignment();
    const cal = createTwoPlayerCalibrator({ now: () => 0 });
    cal.begin('full');
    for (const f of fs.filter((x) => x.t <= 1500)) cal.push(assign.push(f));
    expect(cal.profiles()).toBeNull();
    expect(cal.accept()).toBe(true);
    expect(cal.profiles()![2]).toMatchObject({ kind: 'seated' });
  });
});

describe('both raise their hands', () => {
  const up = (t0: number) => armsUpAt(t0, 400, 6000, 400);

  it('asked of the first player who has not done it; both pass; the profiles carry headroom ok', () => {
    const { all, last, readyAt, cal } = run(frames([{ shape: body(0.72), motion: up(1500) }, { shape: body(0.28), motion: up(2500) }], 6000), { headroom: 'arms-up' });
    expect(readyAt).not.toBeNull();
    const asks = all.filter((s) => s.code === 'raise_hands');
    expect(asks.length).toBeGreaterThan(5);
    expect(asks[0]).toMatchObject({ guidance: { player: 1, action: 'none' }, hint: { action: 'raise_hands' } });   // the code and the hint say it; no guidance of its own
    expect(last).toMatchObject({ ready: true, code: 'ok', outcome: 'measured' });
    const p = cal.profiles()!;
    expect(p[1].headroom).toBe('ok');
    expect(p[2].headroom).toBe('ok');
    expect(readyAt!).toBeGreaterThan(2500);
  });

  it('a pair that never raises them is not held up for ever', () => {
    const { readyAt, cal } = run(frames([{ shape: body(0.72) }, { shape: body(0.28) }], 12_000), { headroom: 'arms-up' });
    expect(readyAt!).toBeGreaterThanOrEqual(1000 + HEADROOM.waitSeconds * 1000);
    expect(readyAt!).toBeLessThan(1000 + HEADROOM.waitSeconds * 1000 + 300);
    expect(cal.profiles()![1].headroom).toBe('unchecked');
  });

  it('a camera that points too low is a tilt, not a step back: the hint says so, the guidance says nothing of its own', () => {
    // far from the camera (shoulders 0.096 wide in image heights) with the heads near the top edge
    const far = (cx: number): BodyShape => body(cx, { hipY: 0.22, T: 0.12, W: 0.096 });
    const { all } = run(frames([{ shape: far(0.72), motion: up(1500) }, { shape: far(0.28), motion: up(1500) }], 5000), { headroom: 'arms-up' }, 'upper');
    const cut = all.filter((s) => s.code === 'headroom');
    expect(cut.length).toBeGreaterThan(10);
    expect(cut.at(-1)).toMatchObject({ hint: { action: 'tilt_camera_up' }, guidance: { action: 'none' } });
  });
});
