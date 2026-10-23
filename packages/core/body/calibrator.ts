// Calibrator v2 (game-design.md 0.3, code-audit B7): a still stance measured over TIME, not a frame count, so it
// finishes at 4 Hz as well as at 30 Hz; framing checks with a reason the UI can say out loud; 'too_slow' instead of
// waiting for ever on a device that cannot keep up.
import {
  LM, type BodyProfile, type CalibrationCode, type CalibrationStatus, type Calibrator, type CalibratorOptions, type Framing,
  type Landmark, type PoseFrame,
} from '../types/index.ts';
import { clamp, dist, isVisible, median, mid, viewOf } from './geometry.ts';

export const CALIBRATION_DEFAULTS = { holdSeconds: 1.2, minSamples: 5, maxSeconds: 20 } as const;

/** Below this pose rate a timeout means the device is too slow (tech.md 3.2: below 10 Hz pause jump games). */
export const SLOW_HZ = 10;

/** Starting values; tune on real recordings. Raw image units unless noted. */
export const FRAMING_LIMITS = {
  /** Shoulders wider than this share of the image width: too close (today's rule). */
  maxShoulderWidth: 0.45,
  /** Hip midpoint lower than this: hips about to leave the image (today's rule). */
  maxHipY: 0.97,
  /** Full framing: nose-to-ankle span as a share of the image height. */
  minFullSpan: 0.35,
  maxFullSpan: 0.92,
  /** Upper framing: torso shorter than this (image heights) is too far for stable landmarks. */
  minTorso: 0.06,
  /** Stillness: hip and shoulder positions must stay within this many torso lengths during the hold. */
  stillSpreadT: 0.2,
} as const;

interface Sample {
  t: number;
  hipX: number; hipY: number; shoulderX: number; shoulderY: number; noseY: number;
  T: number; W: number; A?: number; U?: number;
}

export interface CalibratorDeps {
  /** Epoch clock for BodyProfile.capturedAt (tests pass a fixed one). */
  now?: () => number;
}

function framingProblem(lm: Landmark[] | null, framing: Framing): CalibrationCode | null {
  if (!lm) return 'no_person';
  const shoulders = isVisible(lm, LM.leftShoulder) && isVisible(lm, LM.rightShoulder);
  const hips = isVisible(lm, LM.leftHip) && isVisible(lm, LM.rightHip);
  if (framing === 'side') {
    const side = (s: 'left' | 'right'): boolean => isVisible(lm, s === 'left' ? LM.leftShoulder : LM.rightShoulder)
      && isVisible(lm, s === 'left' ? LM.leftHip : LM.rightHip);
    if (!side('left') && !side('right')) return isVisible(lm, LM.leftShoulder) || isVisible(lm, LM.rightShoulder) ? 'hips_out' : 'no_person';
    if (!isVisible(lm, LM.leftAnkle) && !isVisible(lm, LM.rightAnkle)) return 'feet_out';
    return null;
  }
  if (!shoulders) return hips ? 'head_out' : 'no_person';
  if (!isVisible(lm, LM.nose)) return 'head_out';
  const ls = lm[LM.leftShoulder] as Landmark, rs = lm[LM.rightShoulder] as Landmark;
  if (Math.abs(ls.x - rs.x) > FRAMING_LIMITS.maxShoulderWidth) return 'too_close';
  if (!hips) return 'hips_out';
  const hipY = ((lm[LM.leftHip] as Landmark).y + (lm[LM.rightHip] as Landmark).y) / 2;
  if (hipY > FRAMING_LIMITS.maxHipY) return 'hips_out';
  if (framing === 'full') {
    if (!isVisible(lm, LM.leftKnee) || !isVisible(lm, LM.rightKnee)) return 'knees_out';
    if (!isVisible(lm, LM.leftAnkle) || !isVisible(lm, LM.rightAnkle)) return 'feet_out';
    const ankleY = Math.max((lm[LM.leftAnkle] as Landmark).y, (lm[LM.rightAnkle] as Landmark).y);
    const span = ankleY - (lm[LM.nose] as Landmark).y;
    if (span > FRAMING_LIMITS.maxFullSpan) return 'too_close';
    if (span < FRAMING_LIMITS.minFullSpan) return 'too_far';
  } else {
    const shY = (ls.y + rs.y) / 2;
    if (hipY - shY < FRAMING_LIMITS.minTorso) return 'too_far';
  }
  return null;
}

function sampleOf(lm: Landmark[], aspect: number, t: number, framing: Framing): Sample {
  const v = (i: number) => viewOf(lm, i, aspect);
  const hip = mid(v(LM.leftHip), v(LM.rightHip));
  const sh = mid(v(LM.leftShoulder), v(LM.rightShoulder));
  const s: Sample = {
    t, hipX: hip.x, hipY: hip.y, shoulderX: sh.x, shoulderY: sh.y, noseY: v(LM.nose).y,
    T: hip.y - sh.y,
    W: framing === 'side' ? Math.max(0.01, Math.abs(v(LM.leftShoulder).x - v(LM.rightShoulder).x)) : Math.abs(v(LM.leftShoulder).x - v(LM.rightShoulder).x),
  };
  const arm = (sI: number, eI: number, wI: number): number | null =>
    isVisible(lm, sI) && isVisible(lm, eI) && isVisible(lm, wI) ? dist(v(sI), v(eI)) + dist(v(eI), v(wI)) : null;
  const arms = [arm(LM.leftShoulder, LM.leftElbow, LM.leftWrist), arm(LM.rightShoulder, LM.rightElbow, LM.rightWrist)].filter((a): a is number => a !== null);
  if (arms.length) s.A = arms.reduce((a, b) => a + b, 0) / arms.length;
  if (isVisible(lm, LM.leftKnee) && isVisible(lm, LM.rightKnee)) s.U = mid(v(LM.leftKnee), v(LM.rightKnee)).y - hip.y;
  return s;
}

export function createCalibrator(deps: CalibratorDeps = {}): Calibrator {
  const now = deps.now ?? (() => Date.now());
  let framing: Framing = 'full';
  let opts: Required<CalibratorOptions> = { ...CALIBRATION_DEFAULTS };
  let tBegin: number | null = null;
  let times: number[] = [];
  let hold: Sample[] = [];
  let result: BodyProfile | null = null;

  const hzNow = (): number => {
    if (times.length < 2) return 0;
    const span = (times[times.length - 1] as number) - (times[0] as number);
    return span > 0 ? Math.round(((times.length - 1) * 1000 / span) * 10) / 10 : 0;
  };

  const status = (code: CalibrationCode, progress: number): CalibrationStatus => {
    return { progress: clamp(progress, 0, 1), ready: result !== null, samples: hold.length, code, hz: hzNow() };
  };

  const steady = (s: Sample): boolean => {
    if (hold.length === 0) return true;
    const T = median(hold.map((h) => h.T));
    const lim = FRAMING_LIMITS.stillSpreadT * Math.max(T, 1e-3);
    for (const k of ['hipX', 'hipY', 'shoulderX', 'shoulderY'] as const) {
      let lo = s[k], hi = s[k];
      for (const h of hold) { lo = Math.min(lo, h[k]); hi = Math.max(hi, h[k]); }
      if (hi - lo > lim) return false;
    }
    return true;
  };

  const finish = (aspect: number): BodyProfile => {
    const m = (k: keyof Omit<Sample, 't' | 'A' | 'U'>) => median(hold.map((h) => h[k]));
    const As = hold.map((h) => h.A).filter((a): a is number => a !== undefined);
    const Us = hold.map((h) => h.U).filter((u): u is number => u !== undefined);
    const p: BodyProfile = {
      v: 2, framing, capturedAt: now(), aspect,
      T: m('T'), W: m('W'),
      rest: { hipX: m('hipX'), hipY: m('hipY'), shoulderX: m('shoulderX'), shoulderY: m('shoulderY'), noseY: m('noseY') },
      hz: hzNow(),
    };
    if (As.length >= Math.ceil(hold.length / 2)) p.A = median(As);
    if (Us.length >= Math.ceil(hold.length / 2)) p.U = median(Us);
    return p;
  };

  const calibrator: Calibrator = {
    begin(f: Framing, o: CalibratorOptions = {}): void {
      framing = f;
      opts = { ...CALIBRATION_DEFAULTS, ...o };
      calibrator.reset();
    },

    push(f: PoseFrame): CalibrationStatus {
      if (result) return status('ok', 1);
      if (tBegin === null) tBegin = f.t;
      times.push(f.t);
      while (times.length > 2 && (times[0] as number) < f.t - 3000) times.shift();
      const elapsed = f.t - tBegin;
      const slow = elapsed > opts.maxSeconds * 1000 && hzNow() < SLOW_HZ;

      const problem = framingProblem(f.landmarks, framing);
      if (problem) {
        hold = [];
        return status(slow ? 'too_slow' : problem, 0);
      }
      const s = sampleOf(f.landmarks as Landmark[], f.aspect, f.t, framing);
      let moved = false;
      if (!steady(s)) { hold = []; moved = true; }
      hold.push(s);
      const heldMs = s.t - (hold[0] as Sample).t;
      const progress = Math.min(heldMs / (opts.holdSeconds * 1000), hold.length / opts.minSamples);
      if (heldMs >= opts.holdSeconds * 1000 && hold.length >= opts.minSamples) {
        result = finish(f.aspect);
        return status('ok', 1);
      }
      if (slow) return status('too_slow', progress);
      return status(moved ? 'move_still' : 'hold', progress);
    },

    profile(): BodyProfile | null { return result; },

    reset(): void {
      tBegin = null; times = []; hold = []; result = null;
    },
  };
  return calibrator;
}
