// The hands-up check on single frames: are both arms up, does the picture hold the hands, and what to do when it does not.
// Synthetic figures (core/pose/synth.ts): armsUp 1 puts the wrists 1.1 torso lengths above the shoulder line, the
// fingertips a little more; the real jumping-jacks recording measures the limits (see HEADROOM in headroom.ts).
import { describe, expect, it } from 'vitest';
import { LM, type Landmark } from '../types/index.ts';
import { DEFAULT_SHAPE, DESK_SHAPE, synthPose, type BodyShape } from '../pose/synth.ts';
import { HEADROOM, readHands } from './headroom.ts';

const FULL: BodyShape = DEFAULT_SHAPE;                                  // T 0.2, W 0.16: shoulders at y 0.32
/** Closer to the camera: the shoulders sit at y 0.22 with a torso of 0.3, so straight arms leave the picture. */
const TIGHT: BodyShape = { cx: 0.5, hipY: 0.52, T: 0.3, W: 0.24, aspect: 4 / 3 };
/** Far from the camera and aimed too low: head near the top edge. */
const FAR_LOW: BodyShape = { cx: 0.5, hipY: 0.22, T: 0.12, W: 0.096, aspect: 4 / 3 };

const read = (s: BodyShape, armsUp: number, edit?: (lm: Landmark[]) => void) => {
  const lm = synthPose(s, { armsUp });
  edit?.(lm);
  return readHands(lm, s.T, s.W);
};

describe('are the arms up?', () => {
  it('arms down and arms halfway are not raised', () => {
    expect(read(FULL, 0).state).toBe('down');
    expect(read(FULL, 0.5).state).toBe('down');
  });

  it('arms overhead, or nearly (wrists 0.45 torso lengths above the shoulders), are raised', () => {
    expect(read(FULL, 1).state).toBe('ok');
    expect(read(FULL, 0.75).state).toBe('ok');
  });

  it('one hand up is not enough: the game uses both', () => {
    const lm = synthPose(FULL, {});
    const up = synthPose(FULL, { armsUp: 1 });
    for (const i of [LM.leftElbow, LM.leftWrist, LM.leftPinky, LM.leftIndex, LM.leftThumb]) lm[i] = up[i] as Landmark;
    expect(readHands(lm, FULL.T, FULL.W).state).toBe('down');
  });

  it('elbows up count even when the wrists are lost above the picture', () => {
    const r = read(TIGHT, 1, (lm) => { for (const i of [LM.leftWrist, LM.rightWrist]) lm[i] = { ...(lm[i] as Landmark), visibility: 0.05 }; });
    expect(r.state).toBe('cut');
  });
});

describe('does the picture hold them?', () => {
  it('room to spare: ok, the highest hand point and the hand centre are reported', () => {
    const r = read(FULL, 1);
    expect(r.state).toBe('ok');
    expect(r.top).toBeGreaterThan(HEADROOM.margin);
    expect(r.top).toBeCloseTo(0.32 - 1.22 * 0.2, 2);              // the index fingertips
    expect(r.centreY).toBeCloseTo(0.32 - 1.1733 * 0.2, 2);        // mean of wrist, index and pinky
    expect(r.hint).toBeUndefined();
  });

  it('hands past the top edge: cut, with the distance to step back', () => {
    const r = read(TIGHT, 1);
    expect(r.state).toBe('cut');
    expect(r.top).toBeLessThan(0);
    expect(r.hint).toMatchObject({ action: 'step_back' });
    expect(r.hint!.steps!.min).toBeGreaterThanOrEqual(1);
    expect(r.hint!.steps!.max).toBeLessThanOrEqual(2);
    expect(r.hint!.meters!).toBeGreaterThan(0.3);
  });

  it('a lazy raise that would still fit does not pass when straight arms would not: the picture is too short for the game', () => {
    // wrists only 0.6 T above the shoulders (inside the picture) but the straight arm (1.1 T) would end past the top
    const s: BodyShape = { cx: 0.5, hipY: 0.52, T: 0.28, W: 0.224, aspect: 4 / 3 };       // shoulders at y 0.24, straight arms to -0.068
    const r = read(s, 0.8);
    expect(r.top).toBeGreaterThan(HEADROOM.margin);
    expect(r.state).toBe('cut');
  });

  it('a wrist the model lost although it is inside the picture: cut, and more room is the advice', () => {
    const r = read(FULL, 1, (lm) => { lm[LM.rightWrist] = { ...(lm[LM.rightWrist] as Landmark), visibility: 0.1 }; });
    expect(r.state).toBe('cut');
    expect(r.hint).toEqual({ action: 'step_back', steps: { min: 1, max: 2 } });
  });

  it('a desk: head and shoulders fill the picture, the hands go far out of it; more steps back than at 2 m', () => {
    const lm = synthPose(DESK_SHAPE, { armsUp: 1 });
    const desk = readHands(lm, DESK_SHAPE.T, DESK_SHAPE.W);
    const tight = read(TIGHT, 1);
    expect(desk.state).toBe('cut');
    expect(desk.hint!.action).toBe('step_back');
    expect(desk.hint!.meters!).toBeGreaterThan(tight.hint!.meters!);
    expect(desk.hint!.steps!.max).toBeGreaterThanOrEqual(2);
  });

  it('already far from the camera and still cut: the camera points too low, tilt it up instead of stepping back', () => {
    const r = read(FAR_LOW, 1);
    expect(r.state).toBe('cut');
    expect(r.hint).toEqual({ action: 'tilt_camera_up' });
  });

  it('the shoulder line is read from the frame: a player who shrugs while raising is not misread', () => {
    const r = read(FULL, 1, (lm) => { for (const i of [LM.leftShoulder, LM.rightShoulder]) lm[i] = { ...(lm[i] as Landmark), y: (lm[i] as Landmark).y - 0.01 }; });
    expect(r.state).toBe('ok');
  });
});
