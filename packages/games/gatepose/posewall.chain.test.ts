// Pose Wall through the real chain: a synthetic figure of the movement library's test rig (articulated arms, bent trunk, legs, hidden
// landmark groups), the real poseMatch detector, and the game's simulation reading the detector's channels at 60 steps a second.
// The scripted bot of posewall.test.ts says what the channels look like; this says that the detector really gives them, that the
// library's angles mean what the figure's arms do (0 = the player's right, 90 = up), that "left" is the player's left, and that a
// seated player whose legs are out of the picture is judged on the upper body only. Synthetic figures prove the code does what the
// thresholds say, not that the thresholds fit real bodies (that is the recording day).
import { describe, expect, it } from 'vitest';
import { mulberry32, streamSeed } from '../../core/loop/rng.ts';
import { createPoseMatchDetector } from '../../core/moves/poseMatch.ts';
import { drive } from '../../core/moves/testing/harness.ts';
import { keyframes, SHAPE_FULL, SHAPE_UPPER, type ArmSpec, type FigureSpec, type RigShape } from '../../core/moves/testing/rig.ts';
import type { FrameIn } from '../_shared/frame.ts';
import type { SimEvent } from '../_shared/host.ts';
import { msOf } from '../_shared/util.ts';
import { LAG_K, PoseWallSim, type PwWall } from './posewall.ts';
import { missText } from './posewall-game.ts';
import { PW_STRINGS } from './strings.ts';

function make(o: { seed?: number; difficulty?: string; seated?: boolean }): PoseWallSim {
  const seed = o.seed ?? 3;
  return new PoseWallSim({
    setup: {
      start: { seed, difficulty: o.difficulty ?? 'normal', seated: o.seated ?? false, mode: 'solo' },
      flags: { reducedMotion: false, silent: false, seated: o.seated ?? false }, players: 1, audioLatencyMs: 0, rng: mulberry32(streamSeed(seed, 'course')),
    },
    met: 4,
  });
}

const up: ArmSpec = { a: 180, f: 180 };
const side: ArmSpec = { a: 90, f: 90 };
const down: ArmSpec = { a: 0, f: 0 };

/** The figure that makes each shape the rig can pose: arms (degrees from straight down, away from the body) and a bent trunk. */
const FIGURES: Readonly<Record<string, FigureSpec>> = {
  tPose: { armL: side, armR: side },
  handsUp: { armL: up, armR: up },
  cactus: { armL: { a: 90, f: 180 }, armR: { a: 90, f: 180 } },
  raiseRight: { armL: down, armR: up },
  raiseLeft: { armL: up, armR: down },
  yPose: { armL: { a: 150, f: 150 }, armR: { a: 150, f: 150 } },
  diagonalRight: { armL: { a: 45, f: 45 }, armR: { a: 135, f: 135 } },
  diagonalLeft: { armL: { a: 135, f: 135 }, armR: { a: 45, f: 45 } },
  bendRight: { bend: 30, armL: up, armR: up },
  bendLeft: { bend: -30, armL: up, armR: up },
};

/** The first wall of a run on the hardest level (all the shapes) that asks for this shape. */
function wallFor(name: string, o: { seated?: boolean } = {}): { sim: PoseWallSim; wall: PwWall } {
  for (let seed = 1; seed < 60; seed++) {
    const sim = make({ seed, difficulty: 'expert', ...(o.seated ? { seated: true } : {}) });
    const wall = sim.plan.walls.find((w) => w.pose === name);
    if (wall) return { sim, wall };
  }
  throw new Error(`No wall asks for ${name}.`);
}

/**
 * The figure stands, goes into `spec` over 0.4 s, `early` ms before the wall arrives (700 by default), and keeps it until the wall is
 * through. The detector is the real one, the pose frames are 30 a second, and the simulation is stepped at 60 with the latest frame.
 */
function chain(sim: PoseWallSim, wall: PwWall, spec: FigureSpec, o: { early?: number; shape?: RigShape; rest?: FigureSpec } = {}): { event: SimEvent; events: SimEvent[]; frames: number } {
  const arrive = msOf(wall.arriveK);
  const start = arrive - (o.early ?? 700);
  const motion = keyframes([[0, o.rest ?? {}], [Math.max(100, start), o.rest ?? {}], [Math.max(500, start + 400), spec], [arrive + 3000, spec]]);
  const verdictK = wall.arriveK + LAG_K + 4;
  const d = drive(createPoseMatchDetector, motion, { durationMs: msOf(verdictK) + 100, ...(o.shape ? { shape: o.shape } : {}) });
  const events: SimEvent[] = [];
  let i = 0;
  for (let k = 1; k <= verdictK; k++) {
    const t = msOf(k);
    while (i + 1 < d.samples.length && (d.samples[i + 1] as { t: number }).t <= t) i++;
    const s = d.samples[i] as { t: number; ch: Record<string, number> };
    const frame: FrameIn = { source: 'pose', players: [{ ok: true, ch: s.t <= t ? { ...s.ch } : {}, events: [] }] };
    for (const e of sim.step(frame)) events.push(e);
  }
  const event = events.find((e) => e.type === 'wall' && e['id'] === wall.id) as SimEvent;
  return { event, events, frames: d.samples.length };
}

describe('the real detector and the figure', () => {
  it.each(Object.keys(FIGURES))('a figure that makes %s passes a wall of that shape on the normal level', (name) => {
    const { sim, wall } = wallFor(name);
    const { event } = chain(sim, wall, FIGURES[name] as FigureSpec);
    expect(event, name).toBeDefined();
    expect(event['ok'], `${name}: ${String(event['code'])} ${String(event['limb'])} ${String(event['got'])}`).toBe(true);
    expect(Number(event['fit'])).toBeGreaterThan(0.7);
  });

  it('a figure standing still misses every shape, and the strip names an arm (the shapes of the rig all ask something of the arms)', () => {
    for (const name of Object.keys(FIGURES)) {
      const { sim, wall } = wallFor(name);
      const { event } = chain(sim, wall, {});
      expect(event['ok'], name).toBe(false);
      expect(event['code'], name).toBe('limb_off');
      const say = (k: string): string => PW_STRINGS.en[k] ?? k;
      if (['tPose', 'handsUp', 'yPose', 'raiseRight', 'raiseLeft', 'cactus', 'diagonalRight', 'diagonalLeft'].includes(name)) {
        expect(missText(say, event as unknown as { code: string; limb?: string }), name).toMatch(/arm off the shape$/);
      }
    }
  });

  it('"left" is the player\'s left: the left arm too low in a T shape says so, and so does the right', () => {
    for (const [limb, spec, words] of [
      ['left', { armL: { a: 20, f: 20 }, armR: side }, 'Left arm off the shape'],
      ['right', { armL: side, armR: { a: 20, f: 20 } }, 'Right arm off the shape'],
    ] as const) {
      const { sim, wall } = wallFor('tPose');
      const { event } = chain(sim, wall, spec);
      expect(event['ok'], limb).toBe(false);
      expect(event['code']).toBe('limb_off');
      const say = (k: string): string => PW_STRINGS.en[k] ?? k;
      expect(missText(say, event as unknown as { code: string; limb?: string })).toBe(words);
    }
  });

  it('a limb a little inside the tolerance passes and a little outside misses (normal: 22 degrees)', () => {
    const near = wallFor('tPose');
    expect(chain(near.sim, near.wall, { armL: side, armR: { a: 90 - 14, f: 90 - 14 } }).event['ok']).toBe(true);
    const far = wallFor('tPose');
    expect(chain(far.sim, far.wall, { armL: side, armR: { a: 90 - 32, f: 90 - 32 } }).event['ok']).toBe(false);
  });

  it('a shape that is reached too late is "hold it longer"', () => {
    const { sim, wall } = wallFor('handsUp');
    const { event } = chain(sim, wall, FIGURES['handsUp'] as FigureSpec, { early: 330 });
    expect(event['ok']).toBe(false);
    expect(['held_too_short', 'limb_off']).toContain(event['code']);
  });

  it('hands out of the picture: "your hands were out of view", not a shape that was wrong', () => {
    const { sim, wall } = wallFor('tPose');
    const { event } = chain(sim, wall, { ...(FIGURES['tPose'] as FigureSpec), hide: ['hands', 'elbows'] }, { rest: { hide: ['hands', 'elbows'] } });
    expect(event['ok']).toBe(false);
    expect(event['code']).toBe('hands_out_of_view');
  });

  it('nobody in the picture: the wall is skipped, nothing is lost', () => {
    const { sim, wall } = wallFor('tPose');
    const { event } = chain(sim, wall, { absent: true }, { rest: { absent: true } });
    expect(event['skipped']).toBe(true);
    expect(sim.playerStates[0]?.missed).toBe(0);
    expect(sim.playerStates[0]?.score).toBe(0);
  });

  it('seated: the legs are out of the picture and the shape has no legs, so the arms decide; the avatar keeps its standing legs', () => {
    const { sim, wall } = wallFor('tPose', { seated: true });
    const { event } = chain(sim, wall, FIGURES['tPose'] as FigureSpec, { shape: SHAPE_UPPER });
    expect(event['ok'], `${String(event['code'])} ${String(event['limb'])}`).toBe(true);
    const l = sim.playerStates[0]!.limbs;
    expect(l.thighL).toBe(-94);
    expect(l.armUpperR).toBeGreaterThan(-12);
    expect(l.armUpperR).toBeLessThan(12);
  });

  it('standing: with the legs out of the picture a shape that asks for them says "your knees were out of view"', () => {
    const { sim, wall } = wallFor('tPose');
    const { event } = chain(sim, wall, FIGURES['tPose'] as FigureSpec, { shape: SHAPE_UPPER });
    expect(event['ok']).toBe(false);
    expect(['knees_out_of_view', 'feet_out_of_view']).toContain(event['code']);
  });

  it('the camera\'s own clock is used: the frames of the detector carry their own times, and the verdict still comes 0.1 s after the arrival', () => {
    const { sim, wall } = wallFor('handsUp');
    const { event, frames } = chain(sim, wall, FIGURES['handsUp'] as FigureSpec, { shape: SHAPE_FULL });
    expect(frames).toBeGreaterThan(30);
    expect(event['ok']).toBe(true);
    expect(Number(event['t'])).toBeCloseTo(msOf(wall.arriveK + LAG_K), 0);
  });
});
