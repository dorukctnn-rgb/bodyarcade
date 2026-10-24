// Calibrator v3 (game-design.md 0.3, code-audit B7; "make calibration easy and fast", 24 Oct): it measures what the
// camera can see of the player and takes the best profile it can measure instead of failing.
//
// - Profiles (types/body.ts FramingProfile): 'full' head to feet, 'seated' head to hips, 'upper' head and shoulders
//   (a desk: the hips may be missing and the torso length is estimated from the shoulder width), 'side'. Every frame is
//   read for the best profile it measures (reading.ts), and the status says which game kinds that profile can run:
//   seated and upper-body games start at once, full-body games unlock when the player steps back.
// - A hold of about one second once the body fits. Steadiness is judged on a sliding window of samples (a jolt or a
//   glitch frame costs a moment, not the whole hold), with the outliers trimmed.
// - It never blocks the player: a game that wants the full body at a desk ends with the 'upper' profile and outcome
//   'fallback' after the player has stood still for a few seconds (or at once on accept(), the "play at the desk"
//   button); moving about restarts that count, an absolute limit ends it anyway; a long wait sets `escape` so the
//   screen offers keyboard or touch.
// - Every status carries a code and a measured hint (how many steps, which way), and the parts in view. The platform
//   never produces words; the UI turns codes into sentences.
// - Headroom (a game that raises the hands overhead, manifest `headroom: 'arms-up'`, Summit Climb): when the body fits
//   and has been held, the player raises both hands once (code 'raise_hands'); the picture must hold them (headroom.ts).
//   A cut gives code 'headroom' with a measured hint (steps back, or tilt the camera). It never blocks either: after
//   headroomWaitSeconds, or on accept(), the calibration ends with BodyProfile.headroom 'short' or 'unchecked'. A player
//   who steps back to make room is measured again from the start of the hold.
// - Time based and rate aware: it finishes after the hold time with at least minSamples samples, so it finishes at
//   4 Hz as well as at 30 Hz, and says 'too_slow' instead of waiting for ever on a device that cannot keep up.
import {
  LM, type BodyProfile, type CalibrationCode, type CalibrationHint, type CalibrationStatus, type Calibrator, type CalibratorOptions,
  type Framing, type FramingProfile, type HeadroomCode, type HeadroomNeed, type HeadroomState, type Landmark, type PoseFrame, type Vec2,
} from '../types/index.ts';
import { clamp, dist, isVisible, median, mid, viewOf } from './geometry.ts';
import { HEADROOM, readHands } from './headroom.ts';
import { lightProblem, validGrid, type LightCode } from './light.ts';
import { PROFILE_OF, TORSO_PER_SHOULDER, framingOf, supportOf, type Rank } from './profile.ts';
import { othersInView, read, type Reading, type Want } from './reading.ts';

export const CALIBRATION_DEFAULTS = {
  holdSeconds: 1,
  minSamples: 5,
  maxSeconds: 20,
  idleFallbackSeconds: 3.5,
  maxWaitSeconds: 9,
  escapeSeconds: 12,
} as const;

/** Below this pose rate a timeout means the device is too slow (tech.md 3.2: below 10 Hz pause jump games). */
export const SLOW_HZ = 10;

/**
 * Stillness and timing. Measured on the real recordings: a person standing still moves the hips and shoulders 0.02
 * torso lengths over a second; jumping jacks 0.2 to 0.3. The limit sits between, close to the people.
 */
export const STILL = {
  /** Hip and shoulder positions stay within this many torso lengths during the hold (today's rule was 0.2 untrimmed). */
  spreadT: 0.14,
  /** The shoulder width stays within this share of itself: steps toward or away from the camera are movement. */
  spreadScale: 0.12,
  /** One sample in this many is dropped at each end of the spread (a glitch frame is not movement). */
  trimEvery: 10,
  /** A gap in the frames longer than this ends the hold; a lost frame or two does not. */
  gapMs: 400,
  /** Falling back needs this much steady time and this many samples. */
  fallbackMinMs: 500,
  fallbackMinSamples: 3,
  /** The profile on the screen is the lower fifth of the ranks seen in this window (a flicker of one frame does not show). */
  smoothMs: 500,
  /** A light measurement is used for this long. */
  lightMs: 1500,
  /** Another person must be in view this long to count, and blocks the calibration for no more than the grace. */
  manyMs: 500,
  manyGraceMs: 4000,
  /** The longest steady window kept. */
  keepMs: 12_000,
  /** A measured hint on the screen changes only when the distance moves by this many metres (about a third of a step). */
  hintHysteresisM: 0.2,
} as const;

interface Sample {
  t: number;
  rank: Rank;
  shoulderX: number; shoulderY: number; noseY: number; W: number;
  hipX?: number; hipY?: number; T?: number;
  A?: number; U?: number;
}

/** The options with their defaults filled in. */
interface Settings {
  holdSeconds: number; minSamples: number; maxSeconds: number; idleFallbackSeconds: number; maxWaitSeconds: number; escapeSeconds: number;
  fallback: boolean; headroom?: HeadroomNeed; headroomWaitSeconds?: number;
}

export interface CalibratorDeps {
  /** Epoch clock for BodyProfile.capturedAt (tests pass a fixed one). */
  now?: () => number;
}

/** One sample of a frame that measures at least head and shoulders; null for a frame that measures nothing. */
function sampleOf(lm: Landmark[], aspect: number, t: number, rank: Rank, side: boolean): Sample {
  const v = (i: number): Vec2 => viewOf(lm, i, aspect);
  const sh = mid(v(LM.leftShoulder), v(LM.rightShoulder));
  const s: Sample = {
    t, rank, shoulderX: sh.x, shoulderY: sh.y, noseY: v(LM.nose).y,
    W: Math.abs(v(LM.leftShoulder).x - v(LM.rightShoulder).x),
  };
  if (rank < 2) return s;
  // Side framing: a hidden far side takes the seen side's position, as in the feature extractor.
  const pair = (l: number, r: number): [Vec2, Vec2] => {
    if (side && isVisible(lm, l) !== isVisible(lm, r)) { const seen = isVisible(lm, l) ? v(l) : v(r); return [seen, seen]; }
    return [v(l), v(r)];
  };
  if (side) {
    const [ls, rs] = pair(LM.leftShoulder, LM.rightShoulder);
    const shs = mid(ls, rs);
    s.shoulderX = shs.x; s.shoulderY = shs.y;
    s.W = Math.max(0.01, Math.abs(v(LM.leftShoulder).x - v(LM.rightShoulder).x));
  }
  const hip = mid(...pair(LM.leftHip, LM.rightHip));
  s.hipX = hip.x; s.hipY = hip.y; s.T = hip.y - s.shoulderY;
  const arm = (a: number, b: number, c: number): number | null =>
    isVisible(lm, a) && isVisible(lm, b) && isVisible(lm, c) ? dist(v(a), v(b)) + dist(v(b), v(c)) : null;
  const arms = [arm(LM.leftShoulder, LM.leftElbow, LM.leftWrist), arm(LM.rightShoulder, LM.rightElbow, LM.rightWrist)].filter((a): a is number => a !== null);
  if (arms.length) s.A = arms.reduce((a, b) => a + b, 0) / arms.length;
  if (isVisible(lm, LM.leftKnee) && isVisible(lm, LM.rightKnee)) s.U = mid(v(LM.leftKnee), v(LM.rightKnee)).y - hip.y;
  else if (side && (isVisible(lm, LM.leftKnee) || isVisible(lm, LM.rightKnee))) s.U = mid(...pair(LM.leftKnee, LM.rightKnee)).y - hip.y;
  return s;
}

const refT = (s: Sample): number => s.T ?? TORSO_PER_SHOULDER * s.W;

/** Range of the values with one in `trimEvery` dropped at each end. */
function trimmedSpread(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const k = Math.floor(n / STILL.trimEvery);
  const s = [...values].sort((a, b) => a - b);
  return (s[n - 1 - k] as number) - (s[k] as number);
}

function steady(w: readonly Sample[]): boolean {
  if (w.length < 2) return true;
  const lim = STILL.spreadT * Math.max(median(w.map(refT)), 1e-3);
  if (trimmedSpread(w.map((s) => s.shoulderX)) > lim || trimmedSpread(w.map((s) => s.shoulderY)) > lim) return false;
  // Walking toward or away from the camera is movement too: the body grows or shrinks in the picture.
  const widths = w.map((s) => s.W);
  if (trimmedSpread(widths) > STILL.spreadScale * Math.max(median(widths), 1e-3)) return false;
  const hipX = w.map((s) => s.hipX).filter((v): v is number => v !== undefined);
  const hipY = w.map((s) => s.hipY).filter((v): v is number => v !== undefined);
  return !(hipX.length >= 2 && trimmedSpread(hipX) > lim) && !(hipY.length >= 2 && trimmedSpread(hipY) > lim);
}

/** The lower trimmed rank of some samples: a few frames of a lesser profile do not lower it. */
function rankOf(w: readonly Sample[]): Rank {
  const ranks = w.map((s) => s.rank).sort((a, b) => a - b);
  return (ranks[Math.floor(ranks.length / STILL.trimEvery)] ?? 1) as Rank;
}

export function createCalibrator(deps: CalibratorDeps = {}): Calibrator {
  const now = deps.now ?? (() => Date.now());
  let want: Want = 'full';
  let opts: Settings = { ...CALIBRATION_DEFAULTS, fallback: true };
  let tBegin: number | null = null;
  let tPerson: number | null = null;
  let times: number[] = [];
  let win: Sample[] = [];
  let history: { t: number; rank: number }[] = [];
  let movedAt = -Infinity;
  let lastSampleT = -Infinity;
  let aspect = 4 / 3;
  let light: { code: LightCode | null; t: number } | null = null;
  let manyFrom: number | null = null;
  let acceptRequested = false;
  let result: BodyProfile | null = null;
  let outcome: 'measured' | 'fallback' = 'measured';
  let lastReading: Reading | null = null;
  let lastT = 0;
  let rankSince = 0;
  let prevRank = 0;
  // The hands-up check: the measured profile waits in `pending` while the player raises their hands.
  let stage: 'framing' | 'hands' = 'framing';
  let pending: { profile: BodyProfile; outcome: 'measured' | 'fallback' } | null = null;
  let handsSince: number | null = null;
  let handsLastT = 0;
  let handsOkMs = 0;
  let handsCut = false;
  let handsCentres: number[] = [];
  let handsGoneSince: number | null = null;

  // The measured hint on the screen: the same advice keeps the numbers shown until the distance changes by a real amount,
  // so "1 step" does not flicker to "1-2 steps" while the estimate wobbles around a whole number.
  let shownHint: CalibrationHint | null = null;
  const steadyHint = (h: CalibrationHint): CalibrationHint => {
    if (h.meters === undefined || !h.steps) { shownHint = null; return h; }
    if (shownHint && shownHint.action === h.action && shownHint.meters !== undefined && shownHint.steps && Math.abs(h.meters - shownHint.meters) < STILL.hintHysteresisM) {
      return { ...h, meters: shownHint.meters, steps: shownHint.steps };
    }
    shownHint = h;
    return h;
  };

  const wantsHands = (): boolean => opts.headroom === 'arms-up' && want !== 'side';
  const wantRank = (): Rank => (want === 'full' ? 3 : want === 'upper' ? 1 : 2);
  const holdMs = (): number => opts.holdSeconds * 1000;

  const hzNow = (): number => {
    if (times.length < 2) return 0;
    const span = (times[times.length - 1] as number) - (times[0] as number);
    return span > 0 ? Math.round(((times.length - 1) * 1000 / span) * 10) / 10 : 0;
  };

  /** The newest samples that cover the hold time and number at least minSamples. */
  const recent = (): Sample[] => {
    if (!win.length) return [];
    const end = (win[win.length - 1] as Sample).t;
    let i = win.length - 1;
    while (i > 0 && ((win[i] as Sample).t > end - holdMs() || win.length - i < opts.minSamples)) i--;
    return win.slice(i);
  };

  const kindOf = (rank: Rank): FramingProfile => (want === 'side' ? 'side' : PROFILE_OF[rank]);

  const build = (w: readonly Sample[], rank: Rank): BodyProfile => {
    const kind = kindOf(rank);
    const m = (k: 'shoulderX' | 'shoulderY' | 'noseY' | 'W' | 'hipX' | 'hipY' | 'T'): number => median(w.map((s) => s[k]).filter((v): v is number => v !== undefined));
    const W = m('W');
    const estimated = kind === 'upper';
    const T = estimated ? TORSO_PER_SHOULDER * W : m('T');
    const shoulderX = m('shoulderX'), shoulderY = m('shoulderY');
    const p: BodyProfile = {
      // The framing is what the game asked for when the body gave it, and what was measured when it gave less.
      v: 2, framing: rank >= wantRank() ? (want as Framing) : framingOf(kind), kind, capturedAt: now(), aspect, T, W,
      rest: {
        hipX: estimated ? shoulderX : m('hipX'), hipY: estimated ? shoulderY + T : m('hipY'),
        shoulderX, shoulderY, noseY: m('noseY'),
      },
      hz: hzNow(),
    };
    if (estimated) p.hipsEstimated = true;
    const As = w.map((s) => s.A).filter((a): a is number => a !== undefined);
    const Us = w.map((s) => s.U).filter((u): u is number => u !== undefined);
    if (As.length >= Math.ceil(w.length / 2)) p.A = median(As);
    if (!estimated && Us.length >= Math.ceil(w.length / 2)) p.U = median(Us);
    return p;
  };

  /** The profile on the screen: the lower fifth of the ranks of the last half second. */
  const shownRank = (): number => {
    if (!history.length) return 0;
    const ranks = history.map((h) => h.rank).sort((a, b) => a - b);
    return ranks[Math.floor((ranks.length - 1) * 0.2)] as number;
  };

  const shownProfile = (): FramingProfile | null => {
    if (result) return result.kind ?? result.framing;
    const r = shownRank();
    if (r === 0) return null;
    return want === 'side' ? 'side' : PROFILE_OF[r as Rank];
  };

  function status(code: CalibrationCode | HeadroomCode, progress: number, o: { hint?: CalibrationHint; fallbackInMs?: number; escape?: boolean } = {}): CalibrationStatus {
    const profile = shownProfile();
    const s: CalibrationStatus = {
      progress: clamp(progress, 0, 1), ready: result !== null, samples: win.length, code, hz: hzNow(),
      profile, supports: supportOf(profile),
    };
    if (lastReading) s.seen = lastReading.seen;
    if (o.hint) s.hint = steadyHint(o.hint); else shownHint = null;
    if (o.fallbackInMs !== undefined) s.fallbackInMs = Math.round(o.fallbackInMs);
    if (result) s.outcome = outcome;
    if (result?.headroom) s.headroom = result.headroom;
    if (o.escape) s.escape = true;
    return s;
  }

  /**
   * Takes the window as the result, or as the profile that waits for the hands-up check. True when the calibration is
   * over; false when the player still has to raise their hands (a game with headroom; "play at the desk" skips that).
   */
  function settle(rank: Rank, t: number): boolean {
    const profile = build(recent(), rank);
    const how = rank >= wantRank() ? 'measured' : 'fallback';
    if (!wantsHands() || acceptRequested) {
      result = wantsHands() ? { ...profile, headroom: handsCut ? 'short' : 'unchecked' } : profile;
      outcome = how;
      return true;
    }
    pending = { profile, outcome: how };
    stage = 'hands';
    handsSince ??= t;
    handsLastT = t;
    handsOkMs = 0;
    handsCentres = [];
    handsGoneSince = null;
    return false;
  }

  function finishHands(state: HeadroomState): CalibrationStatus {
    const p = pending as NonNullable<typeof pending>;
    const profile: BodyProfile = { ...p.profile, headroom: state };
    if (state === 'ok' && handsCentres.length) profile.reachY = median(handsCentres);
    result = profile;
    outcome = p.outcome;
    stage = 'framing';
    pending = null;
    return status('ok', 1);
  }

  /** The player moved away from where they were measured (or left): the hold starts again. */
  function restartFraming(): null {
    stage = 'framing';
    pending = null;
    handsOkMs = 0;
    handsCentres = [];
    handsGoneSince = null;
    win = [];
    return null;
  }

  /**
   * One frame of the hands-up check; null when the framing must be measured again. It ends with 'ok' after the hands have
   * been up and inside the picture for HEADROOM.holdMs, and after the wait anyway ('ok' if half the time was reached,
   * 'short' if the hands were cut, else 'unchecked').
   */
  function handsStep(f: PoseFrame, rd: Reading, escape: boolean): CalibrationStatus | null {
    const p = pending as NonNullable<typeof pending>;
    const lm = f.landmarks;
    if (!lm || rd.rank === 0) {
      handsGoneSince ??= f.t;
      if (f.t - handsGoneSince > 1000) return restartFraming();
    } else {
      handsGoneSince = null;
      const v = (i: number): Vec2 => viewOf(lm, i, f.aspect);
      const sh = mid(v(LM.leftShoulder), v(LM.rightShoulder));
      const W = Math.abs(v(LM.leftShoulder).x - v(LM.rightShoulder).x);
      const r = p.profile.rest;
      if (Math.abs(W - p.profile.W) > 0.1 * p.profile.W || Math.abs(sh.x - r.shoulderX) > 0.4 * p.profile.T || Math.abs(sh.y - r.shoulderY) > 0.4 * p.profile.T) return restartFraming();
    }
    const dt = Math.min(Math.max(f.t - handsLastT, 0), 150);
    handsLastT = f.t;
    const hr = lm && rd.rank > 0 ? readHands(lm, p.profile.T, p.profile.W) : null;
    if (hr?.state === 'ok') { handsOkMs += dt; handsCentres.push(hr.centreY); } else handsOkMs = Math.max(0, handsOkMs - 2 * dt);
    if (hr?.state === 'cut') handsCut = true;
    if (handsOkMs >= HEADROOM.holdMs) return finishHands('ok');
    if (f.t - (handsSince as number) >= (opts.headroomWaitSeconds ?? HEADROOM.waitSeconds) * 1000) {
      return finishHands(handsOkMs >= HEADROOM.holdMs / 2 ? 'ok' : handsCut ? 'short' : 'unchecked');
    }
    const cutNow = hr?.state === 'cut';
    const hint: CalibrationHint = cutNow && hr.hint ? hr.hint : { action: 'raise_hands' };
    return status(cutNow ? 'headroom' : 'raise_hands', 0.6 + 0.39 * Math.min(1, handsOkMs / HEADROOM.holdMs), { hint, ...(escape ? { escape: true } : {}) });
  }

  const calibrator: Calibrator = {
    begin(f: Framing, o: CalibratorOptions = {}): void {
      want = f;
      opts = { ...CALIBRATION_DEFAULTS, fallback: true, ...o } as Settings;
      calibrator.reset();
    },

    push(f: PoseFrame): CalibrationStatus {
      lastT = f.t;
      aspect = f.aspect;
      if (result) return status('ok', 1);
      if (tBegin === null) tBegin = f.t;
      times.push(f.t);
      while (times.length > 2 && (times[0] as number) < f.t - 3000) times.shift();
      const elapsed = f.t - tBegin;
      const slow = elapsed > opts.maxSeconds * 1000 && hzNow() < SLOW_HZ;

      const rd = read(f.landmarks, f.aspect, want);
      lastReading = rd;
      history.push({ t: f.t, rank: rd.rank });
      while (history.length && (history[0] as { t: number }).t < f.t - STILL.smoothMs) history.shift();

      // Light, from the newest brightness map (a few per second); used only to explain a failure.
      if (f.light && validGrid(f.light)) light = { code: lightProblem(f.light, f.landmarks, f.aspect), t: f.t };
      const lightCode = light && f.t - light.t <= STILL.lightMs ? light.code : null;

      // Others in view (solo): counted when present for a while; blocks only for a grace period.
      const others = want !== 'side' && othersInView(f) > 0;
      if (others) manyFrom ??= f.t; else manyFrom = null;
      const manyBlocks = manyFrom !== null && f.t - manyFrom >= STILL.manyMs && f.t - manyFrom < STILL.manyGraceMs;

      // The sliding window of steady samples. A gap longer than a few frame intervals (and 0.4 s) ends the hold.
      const interval = times.length > 1 ? ((times[times.length - 1] as number) - (times[0] as number)) / (times.length - 1) : 0;
      if (f.t - lastSampleT > Math.max(STILL.gapMs, 2.5 * interval)) win = [];
      if (rd.rank > 0 && f.landmarks) {
        tPerson ??= f.t;
        win.push(sampleOf(f.landmarks, f.aspect, f.t, rd.rank as Rank, want === 'side'));
        lastSampleT = f.t;
        let dropped = 0;
        while (win.length > 1 && !steady(win)) { win.shift(); dropped++; }
        if (dropped > 0) movedAt = f.t;
        while (win.length > 1 && f.t - (win[0] as Sample).t > STILL.keepMs) win.shift();
      }

      const last = win.length ? (win[win.length - 1] as Sample) : null;
      const dur = last ? last.t - (win[0] as Sample).t : 0;
      const wantR = wantRank();
      const rec = recent();
      const recRank: 0 | Rank = rec.length ? rankOf(rec) : 0;
      // The profile changing (the hips came into view) is the player moving about, even when the positions are steady.
      if (recRank !== prevRank) { prevRank = recRank; rankSince = f.t; }
      const covers = dur >= holdMs() && win.length >= opts.minSamples;
      const holding = rd.rank >= wantR && last !== null && last.t === f.t;
      const fits = recRank >= wantR;

      const escape = elapsed >= opts.escapeSeconds * 1000;
      // The hands-up check holds the result back; it goes on, or the player moved and the framing starts again.
      if (stage === 'hands') return handsStep(f, rd, escape) ?? status('hold', 0, { ...(escape ? { escape: true } : {}) });

      // Does anything end the calibration now?
      if (holding && covers && fits && !manyBlocks && lightCode !== 'too_dark') {
        if (settle(recRank as Rank, f.t)) return status('ok', 1);
        return handsStep(f, rd, escape) ?? status('hold', 0);
      }
      const canFallBack = opts.fallback && want !== 'side' && wantR > 1 && recRank >= 1 && win.length >= STILL.fallbackMinSamples && dur >= STILL.fallbackMinMs && lightCode !== 'too_dark';
      const idleMs = opts.idleFallbackSeconds * 1000;
      const still = Math.min(dur, f.t - rankSince);
      const waited = tPerson === null ? 0 : f.t - tPerson;
      if (canFallBack && !fits) {
        if (acceptRequested || still >= idleMs || waited >= opts.maxWaitSeconds * 1000) {
          if (settle(recRank as Rank, f.t)) return status('ok', 1);
          return handsStep(f, rd, escape) ?? status('hold', 0);
        }
      }
      if (acceptRequested && win.length >= STILL.fallbackMinSamples && dur >= STILL.fallbackMinMs && lightCode !== 'too_dark' && want !== 'side' && fits) {
        if (settle(recRank as Rank, f.t)) return status('ok', 1);
        return handsStep(f, rd, escape) ?? status('hold', 0);
      }

      // Not yet: say why.
      const fallbackIn = canFallBack && !fits ? Math.max(0, Math.min(idleMs - still, opts.maxWaitSeconds * 1000 - waited)) : undefined;
      const extra = (hint?: CalibrationHint): { hint?: CalibrationHint; fallbackInMs?: number; escape?: boolean } => ({
        ...(hint ? { hint } : {}), ...(fallbackIn !== undefined ? { fallbackInMs: fallbackIn } : {}), ...(escape ? { escape: true } : {}),
      });

      if (slow) return status('too_slow', 0, extra());
      if (lightCode === 'too_dark') return status('too_dark', 0, extra({ action: 'more_light' }));
      if (rd.problem) {
        if (lightCode === 'backlit' || (rd.problem === 'no_person' && lightCode)) {
          return status(lightCode, 0, extra({ action: lightCode === 'backlit' ? 'light_in_front' : 'more_light' }));
        }
        return status(rd.problem, 0, extra(rd.hint));
      }
      if (manyBlocks) return status('many_people', 0, extra({ action: 'one_person' }));
      const progress = fits ? Math.min(dur / holdMs(), win.length / opts.minSamples) : 0;
      const code: CalibrationCode = f.t - movedAt < 300 ? 'move_still' : 'hold';
      // With the hands-up check to come, the hold is the first 60% of the way.
      return status(code, Math.min(progress * (wantsHands() ? 0.6 : 1), 0.99), extra({ action: 'hold_still' }));
    },

    accept(): boolean {
      if (result) return true;
      acceptRequested = true;
      if (stage === 'hands' && pending) {
        // "Play on" during the hands-up check: what was measured stands; the hands count as cut if they were seen cut.
        result = { ...pending.profile, headroom: handsCut ? 'short' : 'unchecked' };
        outcome = pending.outcome;
        stage = 'framing';
        pending = null;
        return true;
      }
      const dur = win.length ? lastT - (win[0] as Sample).t : 0;
      if (want === 'side' || win.length < STILL.fallbackMinSamples || dur < STILL.fallbackMinMs) return false;
      const rank = rankOf(recent());
      if (rank < wantRank() && !opts.fallback) return false;   // a game without a seated variant cannot run on less
      return settle(rank, lastT);                                // acceptRequested: the hands-up check is skipped
    },

    profile(): BodyProfile | null { return result; },

    reset(): void {
      tBegin = null; tPerson = null; times = []; win = []; history = []; movedAt = -Infinity; lastSampleT = -Infinity;
      light = null; manyFrom = null; acceptRequested = false; result = null; outcome = 'measured'; lastReading = null; lastT = 0;
      rankSince = 0; prevRank = 0;
      stage = 'framing'; pending = null; handsSince = null; handsLastT = 0; handsOkMs = 0; handsCut = false; handsCentres = []; handsGoneSince = null;
      shownHint = null;
    },
  };
  return calibrator;
}
