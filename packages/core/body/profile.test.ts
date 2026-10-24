// Framing profiles: which profile a frame measures, which game kinds each one runs, the measured advice (steps and
// direction), and the light checks. Pure functions of landmarks and brightness maps; the calibrator tests use them
// over time.
import { describe, expect, it } from 'vitest';
import { LM, type LightGrid, type Landmark } from '../types/index.ts';
import { DESK_SHAPE, FULL_SHAPE, SEATED_SHAPE, synthPose, type BodyShape } from '../pose/synth.ts';
import { DIST_K, STEP_M, distanceM, stepsFor } from './guidance.ts';
import { lightProblem } from './light.ts';
import { framingOf, gameKindOf, kindOf, profileSupports, supportOf } from './profile.ts';
import { read } from './reading.ts';

const pose = (shape: BodyShape, edit?: (lm: Landmark[]) => void): Landmark[] => {
  const lm = synthPose(shape);
  edit?.(lm);
  return lm;
};
const hide = (lm: Landmark[], ...ids: number[]): void => { for (const i of ids) (lm[i] as Landmark).visibility = 0.1; };

describe('which game kinds a profile runs', () => {
  it('full runs everything but side games; seated and upper run upper-body and seated games; nothing runs nothing', () => {
    expect(supportOf('full')).toEqual({ full: true, upper: true, seated: true, side: false });
    expect(supportOf('seated')).toEqual({ full: false, upper: true, seated: true, side: false });
    expect(supportOf('upper')).toEqual({ full: false, upper: true, seated: true, side: false });
    expect(supportOf('side')).toEqual({ full: false, upper: false, seated: false, side: true });
    expect(supportOf(null)).toEqual({ full: false, upper: false, seated: false, side: false });
  });

  it('a game is a seated game when the player plays it seated, otherwise its manifest framing', () => {
    expect(gameKindOf('full', false)).toBe('full');
    expect(gameKindOf('full', true)).toBe('seated');
    expect(gameKindOf('upper', false)).toBe('upper');
    expect(gameKindOf('side', true)).toBe('seated');
    expect(profileSupports('upper', gameKindOf('full', true))).toBe(true);
    expect(profileSupports('upper', gameKindOf('full', false))).toBe(false);
  });

  it('a profile is stored under the framing the feature extractor understands', () => {
    expect(framingOf('full')).toBe('full');
    expect(framingOf('seated')).toBe('upper');
    expect(framingOf('upper')).toBe('upper');
    expect(framingOf('side')).toBe('side');
    expect(kindOf({ framing: 'full' })).toBe('full');
    expect(kindOf({ framing: 'upper', kind: 'seated' })).toBe('seated');
  });
});

describe('the best profile one frame measures', () => {
  it('standing in the whole picture: full; upper-body games are served too', () => {
    const lm = pose(FULL_SHAPE);
    expect(read(lm, FULL_SHAPE.aspect, 'full')).toMatchObject({ best: 'full', rank: 3, problem: null });
    expect(read(lm, FULL_SHAPE.aspect, 'upper')).toMatchObject({ best: 'full', problem: null });
  });

  it('at a desk (head and shoulders, the hips under the picture): upper, and a full-body game is told to step back', () => {
    const lm = pose(DESK_SHAPE);
    const upper = read(lm, DESK_SHAPE.aspect, 'upper');
    expect(upper).toMatchObject({ best: 'upper', rank: 1, problem: null });
    const full = read(lm, DESK_SHAPE.aspect, 'full');
    expect(full.best).toBe('upper');
    expect(['too_close', 'hips_out']).toContain(full.problem);
    expect(full.hint?.action).toBe('step_back');
    expect(full.hint?.steps?.min).toBeGreaterThanOrEqual(2);
    expect(full.seen).toEqual({ head: true, shoulders: true, hips: false, knees: false, feet: false });
  });

  it('seated back from the camera (head to hips): seated, T is measured; a full-body game still needs the knees', () => {
    const lm = pose(SEATED_SHAPE);
    expect(read(lm, SEATED_SHAPE.aspect, 'upper')).toMatchObject({ best: 'seated', rank: 2, problem: null });
    const full = read(lm, SEATED_SHAPE.aspect, 'full');
    expect(full.problem).toBe('knees_out');
    expect(full.seen).toMatchObject({ head: true, shoulders: true, hips: true, knees: false });
  });

  it('hips hidden by something while the rest is in view: the frame is upper and the code names the hips', () => {
    const lm = pose(FULL_SHAPE, (l) => hide(l, LM.leftHip, LM.rightHip));
    const r = read(lm, FULL_SHAPE.aspect, 'full');
    expect(r).toMatchObject({ best: 'upper', problem: 'hips_out' });
  });

  it('nobody: no_person with the step-in advice; a head cut off: head_out', () => {
    expect(read(null, 4 / 3, 'full')).toMatchObject({ best: null, rank: 0, problem: 'no_person', hint: { action: 'step_in' } });
    const lm = pose(FULL_SHAPE, (l) => hide(l, LM.nose));
    expect(read(lm, FULL_SHAPE.aspect, 'full').problem).toBe('head_out');
  });

  it('cut by a side of the picture: move toward the other side (as seen in the mirror), with the distance', () => {
    // The raw picture is mirrored for the player: a body cut at the raw right edge is cut at the left of the mirror.
    const right = pose({ ...FULL_SHAPE, cx: 0.93, W: 0.3, T: 0.25, hipY: 0.55 });
    const r = read(right, FULL_SHAPE.aspect, 'full');
    expect(r.problem).toBe('move_right');
    expect(r.hint?.action).toBe('move_right');
    expect(r.hint?.meters).toBeGreaterThan(0);
    const left = pose({ ...FULL_SHAPE, cx: 0.07, W: 0.3, T: 0.25, hipY: 0.55 });
    expect(read(left, FULL_SHAPE.aspect, 'full').problem).toBe('move_left');
    // both sides cut: too close
    const wide = pose({ ...FULL_SHAPE, cx: 0.5, W: 1.3, T: 0.6, hipY: 1.2 });
    expect(read(wide, FULL_SHAPE.aspect, 'upper').problem).toBe('too_close');
  });

  it('too far: a tiny figure gets a step closer; a head and shoulders desk shape never does', () => {
    const tiny = pose({ ...FULL_SHAPE, T: 0.06, W: 0.045, hipY: 0.5 });
    const full = read(tiny, FULL_SHAPE.aspect, 'full');
    expect(full.problem).toBe('too_far');
    expect(full.hint?.action).toBe('step_closer');
    expect(read(pose(DESK_SHAPE), DESK_SHAPE.aspect, 'upper').problem).toBeNull();
  });

  it('the player is far enough but the feet are under the picture: the camera is tilted, not a step back', () => {
    const lm = pose({ ...FULL_SHAPE, hipY: 0.75 });
    const r = read(lm, FULL_SHAPE.aspect, 'full');
    expect(r.problem).toBe('feet_out');
    expect(r.hint).toEqual({ action: 'tilt_camera_down' });
  });

  it('side framing: the shoulder and hip of one side and a foot are enough', () => {
    const lm = pose(FULL_SHAPE, (l) => hide(l, LM.rightShoulder, LM.rightHip, LM.rightKnee, LM.rightAnkle));
    expect(read(lm, FULL_SHAPE.aspect, 'side')).toMatchObject({ best: 'side', problem: null });
    expect(read(pose(FULL_SHAPE, (l) => hide(l, LM.leftHip, LM.rightHip)), FULL_SHAPE.aspect, 'side').problem).toBe('hips_out');
  });
});

describe('measured advice: how far and which way', () => {
  it('steps are the two whole numbers around the distance, never fewer than one, never more than six', () => {
    expect(stepsFor(0.2)).toEqual({ min: 1, max: 1 });
    expect(stepsFor(1.0)).toEqual({ min: 1, max: 2 });
    expect(stepsFor(1.9)).toEqual({ min: 2, max: 3 });
    expect(stepsFor(2 * STEP_M)).toEqual({ min: 2, max: 2 });
    expect(stepsFor(40)).toEqual({ min: 6, max: 6 });
  });

  it('distance from the shoulder width: a desk is about half a metre, a play space about two and a half', () => {
    expect(distanceM(0.9)).toBeGreaterThan(0.4);
    expect(distanceM(0.9)).toBeLessThan(0.65);
    expect(distanceM(DIST_K / 2.5)).toBeCloseTo(2.5, 5);
    expect(distanceM(0.175)).toBeGreaterThan(2.3);
    expect(distanceM(0.175)).toBeLessThan(3);
  });

  it('a desk player wanting the full body is asked for two to three steps back (about 1.9 m)', () => {
    const r = read(pose(DESK_SHAPE), DESK_SHAPE.aspect, 'full');
    expect(r.hint).toMatchObject({ action: 'step_back', steps: { min: 2, max: 3 } });
    expect(r.hint?.meters).toBeGreaterThan(1.5);
    expect(r.hint?.meters).toBeLessThan(2.4);
  });

  it('closer to the goal means fewer steps: a person at 1.5 m with the feet cut is asked for one or two', () => {
    const r = read(pose({ ...FULL_SHAPE, T: 0.3, W: 0.24, hipY: 0.5 }), FULL_SHAPE.aspect, 'full');
    expect(r.problem).toBe('feet_out');
    expect(r.hint?.steps).toEqual({ min: 1, max: 2 });
  });
});

describe('light: too dark and the light behind the player', () => {
  const grid = (fn: (c: number, r: number) => number, cols = 16, rows = 12): LightGrid => {
    const luma: number[] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) luma.push(fn(c, r));
    return { cols, rows, luma };
  };
  const person = pose(FULL_SHAPE);

  it('an evenly lit room is fine, with or without a person', () => {
    expect(lightProblem(grid(() => 0.5), person)).toBeNull();
    expect(lightProblem(grid(() => 0.5), null)).toBeNull();
    expect(lightProblem(grid(() => 0.3), person)).toBeNull();
  });

  it('a black picture is too dark, with or without a person', () => {
    expect(lightProblem(grid(() => 0.04), null)).toBe('too_dark');
    expect(lightProblem(grid(() => 0.06), person)).toBe('too_dark');
  });

  it('a dim room where nothing is bright is too dark; a dark face in a room that is not bright around it is too dark too', () => {
    expect(lightProblem(grid(() => 0.17), null)).toBe('too_dark');
    const nose = person[LM.nose] as Landmark;
    const darkFace = grid((c, r) => (Math.abs((c + 0.5) / 16 - nose.x) < 0.08 && Math.abs((r + 0.5) / 12 - nose.y) < 0.12 ? 0.05 : 0.4));
    expect(lightProblem(darkFace, person)).toBe('too_dark');
  });

  it('a near black face in a bright room is the light behind the person, not too little light: the advice is to turn the light', () => {
    const nose = person[LM.nose] as Landmark;
    const silhouette = grid((c, r) => (Math.abs((c + 0.5) / 16 - nose.x) < 0.08 && Math.abs((r + 0.5) / 12 - nose.y) < 0.12 ? 0.05 : 0.6));
    expect(lightProblem(silhouette, person)).toBe('backlit');
  });

  it('a person against a bright window: the face is dark and the sides are bright', () => {
    const nose = person[LM.nose] as Landmark;
    const backlit = grid((c, r) => (Math.abs((c + 0.5) / 16 - nose.x) < 0.1 && Math.abs((r + 0.5) / 12 - nose.y) < 0.14 ? 0.22 : 0.85));
    expect(lightProblem(backlit, person)).toBe('backlit');
  });

  it('a dark shirt in front of a light wall is not backlight (the face is lit)', () => {
    const nose = person[LM.nose] as Landmark;
    const shirt = grid((c, r) => {
      const x = (c + 0.5) / 16, y = (r + 0.5) / 12;
      if (Math.abs(x - nose.x) < 0.1 && Math.abs(y - nose.y) < 0.14) return 0.55;
      return Math.abs(x - 0.5) < 0.12 && y > nose.y + 0.1 ? 0.1 : 0.7;
    });
    expect(lightProblem(shirt, person)).toBeNull();
  });

  it('with nobody found, a dark middle against bright sides is read as a person against a window', () => {
    const silhouette = grid((c, r) => ((c + 0.5) / 16 > 0.35 && (c + 0.5) / 16 < 0.65 && (r + 0.5) / 12 > 0.15 && (r + 0.5) / 12 < 0.65 ? 0.12 : 0.85));
    expect(lightProblem(silhouette, null)).toBe('backlit');
  });

  it('a malformed map says nothing', () => {
    expect(lightProblem({ cols: 4, rows: 4, luma: [0.1] }, null)).toBeNull();
    expect(lightProblem({ cols: 2, rows: 2, luma: [NaN, 0, 0, 0] }, null)).toBeNull();
  });
});
