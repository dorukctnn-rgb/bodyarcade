// FeatureExtractor: pose frames to body-space features (types/body.ts), One Euro filtered per coordinate.
// The scalar signals keep today's definitions (site/game/pose.js) so the present thresholds still apply:
// rise/drop/headDrop in torso lengths T, lean = shoulder-over-hip tilt + 0.7 x hip shift in shoulder widths W.
// Side framing (profile.framing 'side'): the far half of the body may be hidden. A frame counts (ok) with the
// shoulder and hip of one side; a pair whose one side is hidden takes the seen side's position for both entries, so
// means and midpoints follow the near side; `seen` counts a pair when either side is seen; `near` names the side that
// faces the camera; lean is 0 and shoulderSpan 1 (sideways tilt and shoulder width are not visible from the side).
// Desk profile (profile.hipsEstimated): the hips are under the picture. A frame counts (ok) with both shoulders; the
// hips are held at their rest point, one T below the resting shoulders (a seated player's hips do not move), so rise and
// drop are 0, the lean is the shoulders' sideways shift in W, and the trunk angle of the side bend is the shoulders over
// that fixed point. The slow re-centring keeps the rest point under the shoulders.
import {
  LM, type BodyProfile, type FeatureExtractor, type FeatureExtractorOptions, type Features, type JointName, type Landmark,
  type PoseFrame, type Vec2,
} from '../types/index.ts';
import { OneEuro } from '../pose/one-euro.ts';
import { bodySeen, clamp, isVisible, meanView, nearSide, seenParts, seenPartsSide, viewOf } from './geometry.ts';
import { TORSO_PER_SHOULDER } from './profile.ts';

/** Below this share of the rest shoulder width the shoulders count as turned: the rest is not re-centred on them. */
const DRIFT_MIN_SPAN = 0.93;

/** Points that get their own filter: [L, R] landmark groups (one group for the head). */
const POINTS = {
  head: [[LM.nose]],
  shoulder: [[LM.leftShoulder], [LM.rightShoulder]],
  elbow: [[LM.leftElbow], [LM.rightElbow]],
  wrist: [[LM.leftWrist], [LM.rightWrist]],
  hand: [[LM.leftWrist, LM.leftIndex, LM.leftPinky], [LM.rightWrist, LM.rightIndex, LM.rightPinky]],
  hip: [[LM.leftHip], [LM.rightHip]],
  knee: [[LM.leftKnee], [LM.rightKnee]],
  ankle: [[LM.leftAnkle], [LM.rightAnkle]],
  foot: [[LM.leftAnkle, LM.leftFootIndex], [LM.rightAnkle, LM.rightFootIndex]],
} as const;
type PointName = keyof typeof POINTS;

/** Today's crouch level (pose.js): the deeper of hip drop / 0.55 T and head drop / 0.8 T, 0..1. */
export function crouchLevel(drop: number, headDrop: number, full = 0.55, headFull = 0.8): number {
  return clamp(Math.max(drop / full, headDrop / headFull), 0, 1);
}

/** Stands in for a missing frame so games keep the last positions instead of jumping to zero. */
const ZERO: Vec2 = { x: 0, y: 0 };

/** Features of a frame that cannot be measured (no profile yet, or nobody seen before): ok false, every position 0. */
export function emptyFeatures(f: Pick<PoseFrame, 't' | 'seq' | 'landmarks'>, seen: Features['seen'] = seenParts(f.landmarks)): Features {
  const pair: [Vec2, Vec2] = [ZERO, ZERO];
  return {
    t: f.t, seq: f.seq, ok: false, seen, head: ZERO, shoulder: ZERO, hip: ZERO, shoulders: pair, hips: pair, elbow: pair,
    hand: pair, knee: pair, ankle: pair, foot: pair, rise: 0, drop: 0, headDrop: 0, lean: 0, shoulderSpan: 1, vel: {},
  };
}

export function createFeatureExtractor(o: FeatureExtractorOptions = {}): FeatureExtractor {
  const driftSeconds = o.driftSeconds ?? 8;
  let profile: BodyProfile | null = null;
  let rest = { hipX: 0, hipY: 0, shoulderX: 0, shoulderY: 0, noseY: 0, T: 1, W: 1 };
  let filters = new Map<string, OneEuro>();
  let lastOkT = -Infinity;
  let lastT = -Infinity;
  let last: Features | null = null;

  const filterFor = (key: string): OneEuro => {
    let f = filters.get(key);
    if (!f) { f = new OneEuro(o.filter ?? {}, 1 / Math.max(rest.T, 1e-3)); filters.set(key, f); }
    return f;
  };

  const reset = (): void => { filters = new Map(); lastOkT = -Infinity; lastT = -Infinity; last = null; };

  const toBody = (v: Vec2): Vec2 => ({ x: (v.x - rest.hipX) / rest.T, y: (rest.hipY - v.y) / rest.T });

  function empty(f: PoseFrame, seen: Features['seen']): Features {
    if (last) return { ...last, t: f.t, seq: f.seq, ok: false, seen };
    return emptyFeatures(f, seen);
  }

  return {
    push(f: PoseFrame, p: BodyProfile): Features {
      if (p !== profile) {
        profile = p;
        rest = { ...p.rest, T: Math.max(p.T, 1e-3), W: Math.max(p.W, 1e-3) };
        reset();
      }
      const lm = f.landmarks;
      const sideMode = p.framing === 'side';
      const seen = sideMode ? seenPartsSide(lm) : seenParts(lm);
      const estimated = p.hipsEstimated === true;
      const ok = bodySeen(lm, p.framing, estimated);
      if (!ok || !lm) { lastT = f.t; return (last = empty(f, seen)); }
      // A gap of more than half a second: start the filters afresh so stale velocities do not carry over.
      if (f.t - lastOkT > 500) filters = new Map();
      const dtSec = Number.isFinite(lastT) ? clamp((f.t - lastT) / 1000, 0, 0.1) : 0;
      lastOkT = f.t;
      lastT = f.t;

      const view = {} as Record<PointName, Vec2[]>;
      const deriv = {} as Record<PointName, Vec2[]>;
      for (const name of Object.keys(POINTS) as PointName[]) {
        view[name] = [];
        deriv[name] = [];
        const groups: readonly (readonly number[])[] = POINTS[name];
        const raws = groups.map((idx) => (idx.length === 1 ? viewOf(lm as Landmark[], idx[0] as number, f.aspect) : meanView(lm as Landmark[], idx, f.aspect)));
        if (estimated && name === 'hip') {
          // Under the picture: the player's left hip is on the left of the mirror view, 0.19 T either side of the rest point.
          raws[0] = { x: rest.hipX - 0.19 * rest.T, y: rest.hipY };
          raws[1] = { x: rest.hipX + 0.19 * rest.T, y: rest.hipY };
        }
        if (sideMode && groups.length === 2) {
          // One side hidden (from the side, the far one): both entries follow the side that is seen.
          const vis = groups.map((idx) => isVisible(lm as Landmark[], idx[0] as number));
          if (vis[0] !== vis[1]) { const v = raws[vis[0] ? 0 : 1] as Vec2; raws[0] = v; raws[1] = v; }
        }
        raws.forEach((raw, side) => {
          const fx = filterFor(`${name}${side}x`), fy = filterFor(`${name}${side}y`);
          view[name].push({ x: fx.filter(raw.x, f.t), y: fy.filter(raw.y, f.t) });
          deriv[name].push({ x: fx.derivative, y: fy.derivative });
        });
      }
      const pair = (name: PointName): [Vec2, Vec2] => [toBody(view[name][0] as Vec2), toBody(view[name][1] as Vec2)];
      const midView = (name: PointName): Vec2 => {
        const a = view[name][0] as Vec2, b = view[name][1] as Vec2;
        return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      };
      const hipV = midView('hip'), shV = midView('shoulder'), headV = view.head[0] as Vec2;

      const rise = (rest.hipY - hipV.y) / rest.T;
      const headDrop = (headV.y - rest.noseY) / rest.T;
      const lean = sideMode ? 0 : ((shV.x - hipV.x) - (rest.shoulderX - rest.hipX)) / rest.W + 0.7 * (hipV.x - rest.hipX) / rest.W;
      const shoulders = view.shoulder as [Vec2, Vec2];
      const shoulderSpan = sideMode ? 1 : Math.abs(shoulders[1].x - shoulders[0].x) / rest.W;

      const vel: Features['vel'] = {};
      const velOf = (name: PointName): [Vec2, Vec2] => {
        const d = deriv[name];
        const v = (i: number): Vec2 => ({ x: (d[i]?.x ?? 0) / rest.T, y: -(d[i]?.y ?? 0) / rest.T });
        return d.length === 1 ? [v(0), v(0)] : [v(0), v(1)];
      };
      const jointPoint: Record<JointName, PointName> = { nose: 'head', shoulder: 'shoulder', elbow: 'elbow', wrist: 'wrist', hand: 'hand', hip: 'hip', knee: 'knee', ankle: 'ankle', foot: 'foot' };
      for (const j of Object.keys(jointPoint) as JointName[]) vel[j] = velOf(jointPoint[j]);

      const features: Features = {
        t: f.t, seq: f.seq, ok: true, seen,
        head: toBody(headV), shoulder: toBody(shV), hip: toBody(hipV),
        shoulders: pair('shoulder'), hips: pair('hip'), elbow: pair('elbow'), hand: pair('hand'), knee: pair('knee'),
        ankle: pair('ankle'), foot: pair('foot'),
        rise, drop: -rise, headDrop, lean, shoulderSpan, vel,
      };
      if (sideMode) features.near = nearSide(lm);

      // Slow re-centring while standing neutral (today's 8 s drift): camera nudged, player shifted a little. Not while the shoulders
      // are turned (span under 0.93 of the rest width): a twisted body is narrower than its rest width, and re-centring on it makes
      // the twist detector lose every twist after about 15 s of twisting or one overload hold (Twist Turbine; found by G3's browser
      // run on 24 Oct, patch checked by G3 in the real Session).
      if (driftSeconds > 0 && dtSec > 0 && (sideMode || shoulderSpan > DRIFT_MIN_SPAN) && Math.abs(rise) < 0.06 && crouchLevel(-rise, headDrop) < 0.1 && Math.abs(lean) < 0.12) {
        const k = dtSec / driftSeconds;
        rest.shoulderY += (shV.y - rest.shoulderY) * k;
        rest.shoulderX += (shV.x - rest.shoulderX) * k;
        rest.noseY += (headV.y - rest.noseY) * k;
        if (!sideMode) rest.W += (Math.abs(shoulders[1].x - shoulders[0].x) - rest.W) * k;
        if (estimated) {
          // The hips follow the shoulders: one T below them, T tied to the shoulder width.
          rest.T = TORSO_PER_SHOULDER * rest.W;
          rest.hipX = rest.shoulderX;
          rest.hipY = rest.shoulderY + rest.T;
        } else {
          rest.hipY += (hipV.y - rest.hipY) * k;
          rest.hipX += (hipV.x - rest.hipX) * k;
          rest.T += ((hipV.y - shV.y) - rest.T) * k;
        }
      }
      return (last = features);
    },
    reset,
  };
}
