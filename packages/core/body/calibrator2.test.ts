// Two-person calibration and framing check (mode 'local2').
import { describe, expect, it } from 'vitest';
import type { PoseFrame, TwoPlayerCalibrationStatus } from '../types/index.ts';
import { gaussian, mulberry32 } from '../loop/rng.ts';
import { synthPose, type BodyShape, type PoseParams } from '../pose/synth.ts';
import { createPlayerAssignment } from './players.ts';
import { createTwoPlayerCalibrator } from './calibrator2.ts';

const ASPECT = 16 / 9;
const body = (cx: number, o: Partial<BodyShape> = {}): BodyShape => ({ cx, hipY: 0.55, T: 0.18, W: 0.14, aspect: ASPECT, ...o });

/** Frames of two (or fewer) people at `hz` for `ms`, each with their own motion. */
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

function run(fs: PoseFrame[]): { last: TwoPlayerCalibrationStatus; all: TwoPlayerCalibrationStatus[]; readyAt: number | null; cal: ReturnType<typeof createTwoPlayerCalibrator> } {
  const assign = createPlayerAssignment();
  const cal = createTwoPlayerCalibrator({ now: () => 0 });
  cal.begin('full');
  const all: TwoPlayerCalibrationStatus[] = [];
  for (const f of fs) {
    const s = cal.push(assign.push(f));
    all.push(s);
    if (s.ready) return { last: s, all, readyAt: f.t, cal };
  }
  return { last: all.at(-1) as TwoPlayerCalibrationStatus, all, readyAt: null, cal };
}

describe('two-person calibration', () => {
  it.each([30, 10, 4])('two people standing apart are both calibrated at %i Hz', (hz) => {
    const { readyAt, cal, last } = run(frames([{ shape: body(0.72) }, { shape: body(0.28, { T: 0.16, W: 0.12 }) }], 5000, hz));
    expect(readyAt).not.toBeNull();
    expect(readyAt!).toBeLessThanOrEqual(1200 + 1000 / hz + 1);
    expect(last).toMatchObject({ ready: true, code: 'ok', progress: 1 });
    const p = cal.profiles()!;
    // Player 1 stands on the mirror's left: the right side of the raw image (raw x 0.72), the taller one
    expect(p[1].T).toBeCloseTo(0.18, 2);
    expect(p[2].T).toBeCloseTo(0.16, 2);
    expect(p[1].rest.hipX).toBeLessThan(p[2].rest.hipX);
  });

  it('one person: asks the missing player to step in', () => {
    const { last } = run(frames([{ shape: body(0.72) }], 2000));
    expect(last).toMatchObject({ ready: false, code: 'one_person', guidance: { player: 2, action: 'step_in' } });
  });

  it('nobody: no_person', () => {
    expect(run(frames([], 1000)).last.code).toBe('no_person');
  });

  it('too close together: the player nearer the middle moves out', () => {
    const { last } = run(frames([{ shape: body(0.53) }, { shape: body(0.45) }], 2000));
    expect(last.code).toBe('too_close_together');
    expect(last.guidance.action).toMatch(/move_left|move_right/);
    expect(last.ready).toBe(false);
  });

  it('a player at the edge of the picture is asked to move in', () => {
    const { last } = run(frames([{ shape: body(0.985) }, { shape: body(0.4) }], 2000));
    expect(last).toMatchObject({ code: 'player_out', guidance: { player: 1, action: 'move_right' } });
  });

  it('distance: a player too close to the camera is asked to step back', () => {
    const { last } = run(frames([{ shape: body(0.75) }, { shape: body(0.27, { T: 0.29, W: 0.2, hipY: 0.46 }) }], 2000));   // nose 0.04 to ankles 0.98
    expect(last).toMatchObject({ code: 'too_close', guidance: { player: 2, action: 'step_back' } });
  });

  it('both have to hold still: a moving player is asked to, and the pair finishes after they stop', () => {
    const moving = (t: number): PoseParams => (t < 1500 ? { drop: 0.25 + 0.25 * Math.sin(t / 120) } : {});
    const { all, readyAt } = run(frames([{ shape: body(0.72) }, { shape: body(0.28), motion: moving }], 5000));
    expect(all.some((s) => s.code === 'move_still' && s.guidance.player === 2)).toBe(true);
    expect(readyAt!).toBeGreaterThan(1500 + 900);
  });

  it('players squeezing together restart the hold for both', () => {
    const squeeze = (t: number): PoseParams => (t > 600 && t < 900 ? { shiftX: 0.5 } : {});
    const { all, readyAt } = run(frames([{ shape: body(0.72) }, { shape: body(0.28), motion: squeeze }], 5000));
    expect(all.some((s) => s.code === 'too_close_together')).toBe(true);
    expect(readyAt!).toBeGreaterThan(900 + 900);
  });
});
