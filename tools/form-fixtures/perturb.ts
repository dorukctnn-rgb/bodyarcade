// Controlled faults on REAL traces (semi-synthetic): a good-form recording of a real person, changed in one way on purpose, to
// show that each rule fires on the fault it is written for. This is never counted as real-world evidence (SPEC.md 10): the
// real wrong-form measurement needs real wrong repetitions (Doruk's own recording, SPEC.md 7.3).
import { LM, type Landmark, type Trace } from '../../packages/core/types/index.ts';

const clone = (t: Trace): Trace => ({ ...t, frames: t.frames.map((f) => ({ ...f, lm: f.lm ? f.lm.map((p) => ({ ...p })) : null })) });

/** The start position: frame `at` (see restIndex in run-lib.ts), or the first frame with a person. */
function restFrame(t: Trace, at?: number): Landmark[] {
  const f = at !== undefined ? t.frames[at] : t.frames.find((x) => x.lm);
  if (!f?.lm) throw new Error('trace has no person there');
  return f.lm;
}

/** Every landmark (or only `only`) pulled towards the start position: the movement keeps `k` of its range (0.5 = half reps). */
export function shrinkRange(t: Trace, k: number, only?: readonly number[], at?: number): Trace {
  const out = clone(t), rest = restFrame(t, at);
  for (const f of out.frames) {
    if (!f.lm) continue;
    f.lm.forEach((p, i) => {
      if (only && !only.includes(i)) return;
      const r = rest[i]!;
      p.x = r.x + k * (p.x - r.x); p.y = r.y + k * (p.y - r.y);
    });
  }
  return out;
}

/**
 * Knees caving in: at the bottom of each squat the knee is put `amount` leg lengths inside the hip-ankle line (towards the
 * body's middle), blended in with the depth, so the fault grows as the person goes down, like a real one.
 */
export function kneesIn(t: Trace, amount: number, at?: number): Trace {
  const out = clone(t), rest = restFrame(t, at);
  const restHip = (rest[LM.leftHip]!.y + rest[LM.rightHip]!.y) / 2;
  const thigh = Math.abs(rest[LM.leftKnee]!.y - rest[LM.leftHip]!.y) || 0.2;
  for (const f of out.frames) {
    const lm = f.lm;
    if (!lm) continue;
    const hipY = (lm[LM.leftHip]!.y + lm[LM.rightHip]!.y) / 2, midX = (lm[LM.leftHip]!.x + lm[LM.rightHip]!.x) / 2;
    const depth = Math.max(0, Math.min(1, (hipY - restHip) / (0.6 * thigh)));
    for (const [k, h, a] of [[LM.leftKnee, LM.leftHip, LM.leftAnkle], [LM.rightKnee, LM.rightHip, LM.rightAnkle]] as const) {
      const hp = lm[h]!, an = lm[a]!, kn = lm[k]!;
      if (Math.abs(an.y - hp.y) < 1e-6) continue;
      const u = (kn.y - hp.y) / (an.y - hp.y);
      const lineX = hp.x + u * (an.x - hp.x);
      const leg = Math.hypot(an.x - hp.x, an.y - hp.y);
      const target = lineX + Math.sign(midX - lineX) * amount * leg;
      kn.x = (1 - depth) * kn.x + depth * target;
    }
  }
  return out;
}

/** Hips moved down (+) or up (-) by `amount` torso lengths while the body lies along the picture (push-up sag / pike). */
export function hips(t: Trace, amount: number): Trace {
  const out = clone(t);
  for (const f of out.frames) {
    const lm = f.lm;
    if (!lm) continue;
    const left = lm[LM.leftShoulder]!.visibility + lm[LM.leftHip]!.visibility >= lm[LM.rightShoulder]!.visibility + lm[LM.rightHip]!.visibility;
    const sh = lm[left ? LM.leftShoulder : LM.rightShoulder]!, an = lm[left ? LM.leftAnkle : LM.rightAnkle]!, hp = lm[left ? LM.leftHip : LM.rightHip]!;
    const flat = Math.abs(an.y - sh.y) < Math.abs(an.x - sh.x) * 0.8;
    if (!flat) continue;
    const torso = Math.hypot(hp.x - sh.x, hp.y - sh.y);
    for (const i of [LM.leftHip, LM.rightHip]) lm[i]!.y += amount * torso;
  }
  return out;
}

/** The person's left arm runs `frames` frames behind the right one (a lagging arm in a press). */
export function lagArm(t: Trace, frames: number): Trace {
  const out = clone(t);
  const arm = [LM.leftElbow, LM.leftWrist, LM.leftPinky, LM.leftIndex, LM.leftThumb];
  for (let i = out.frames.length - 1; i >= 0; i--) {
    const f = out.frames[i]!, src = t.frames[Math.max(0, i - frames)]!;
    if (!f.lm || !src.lm) continue;
    for (const j of arm) { f.lm[j]!.x = src.lm[j]!.x; f.lm[j]!.y = src.lm[j]!.y; }
  }
  return out;
}

export const ARMS = [LM.leftElbow, LM.rightElbow, LM.leftWrist, LM.rightWrist, LM.leftPinky, LM.rightPinky, LM.leftIndex, LM.rightIndex, LM.leftThumb, LM.rightThumb];
export const LEFT_ARM = [LM.leftElbow, LM.leftWrist, LM.leftPinky, LM.leftIndex, LM.leftThumb];
