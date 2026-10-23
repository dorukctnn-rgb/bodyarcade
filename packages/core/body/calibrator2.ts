// Two-person calibration and framing check (mode 'local2'): both players fully in view, apart from each other,
// inside the picture, each at a usable distance; then both hold still together and each gets their own profile.
// The guidance names one player and one action so the screen can say "Player 2, step back".
import {
  type BodyProfile, type CalibrationCode, type CalibrationStatus, type CalibratorOptions, type Framing, type Landmark, type PlayerFrame,
  type PlayerSlot, type TwoPlayerCalibrationStatus, type TwoPlayerCalibrator, type TwoPlayerCode, type TwoPlayerGuidance,
} from '../types/index.ts';
import { createCalibrator, type CalibratorDeps } from './calibrator.ts';
import { BODY_PARTS, toView } from './geometry.ts';

/** Starting values; tune on real two-person recordings. View units (image heights). */
export const TWO_PLAYER_LIMITS = {
  /** Clear space between the two bodies (arms down), in the smaller player's shoulder widths (about 40 cm). */
  minGapW: 1.0,
  /** Distance from each body to the side of the picture, in image heights. */
  edgeMargin: 0.02,
} as const;

const EXTENT_POINTS = [...BODY_PARTS.shoulders, ...BODY_PARTS.elbows, ...BODY_PARTS.hands, ...BODY_PARTS.hips, ...BODY_PARTS.knees, ...BODY_PARTS.ankles];

/**
 * Horizontal extent of a body in view space. Every point counts, visible or not: MediaPipe places hidden and
 * out-of-picture points where the body would be, which is what the edge check needs.
 */
function extent(lm: Landmark[], aspect: number): { minX: number; maxX: number; W: number } {
  let minX = Infinity, maxX = -Infinity;
  for (const i of EXTENT_POINTS) {
    const p = lm[i];
    if (!p) continue;
    const x = toView(p, aspect).x;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
  }
  const ls = lm[11], rs = lm[12];
  const W = ls && rs ? Math.abs(ls.x - rs.x) * aspect : 0.1;
  return { minX, maxX, W };
}

const ACTION: Partial<Record<CalibrationCode, TwoPlayerGuidance['action']>> = {
  no_person: 'step_in', too_close: 'step_back', too_far: 'step_closer', head_out: 'step_back', hips_out: 'step_back',
  knees_out: 'step_back', feet_out: 'step_back', move_still: 'hold_still', hold: 'hold_still',
};

const IDLE: CalibrationStatus = { progress: 0, ready: false, samples: 0, code: 'no_person', hz: 0 };

export function createTwoPlayerCalibrator(deps: CalibratorDeps = {}): TwoPlayerCalibrator {
  const cal = { 1: createCalibrator(deps), 2: createCalibrator(deps) } as const;
  let framing: Framing = 'full';
  let opts: CalibratorOptions = {};
  let last: Record<PlayerSlot, CalibrationStatus> = { 1: IDLE, 2: IDLE };
  let times: number[] = [];

  const hz = (): number => {
    if (times.length < 2) return 0;
    const span = (times[times.length - 1] as number) - (times[0] as number);
    return span > 0 ? Math.round(((times.length - 1) * 1000 / span) * 10) / 10 : 0;
  };

  const out = (code: TwoPlayerCode, guidance: TwoPlayerGuidance): TwoPlayerCalibrationStatus => ({
    ready: last[1].ready && last[2].ready,
    progress: Math.min(last[1].progress, last[2].progress),
    code, guidance, players: { 1: last[1], 2: last[2] }, hz: hz(),
  });

  /** A two-person problem: whatever was being held starts again once it is fixed. */
  const problem = (code: TwoPlayerCode, guidance: TwoPlayerGuidance): TwoPlayerCalibrationStatus => {
    if (!(last[1].ready && last[2].ready)) {
      for (const s of [1, 2] as const) { cal[s].begin(framing, opts); last[s] = IDLE; }
    }
    return out(code, guidance);
  };

  return {
    begin(f: Framing, o: CalibratorOptions = {}): void {
      framing = f; opts = o;
      for (const s of [1, 2] as const) cal[s].begin(f, o);
      last = { 1: IDLE, 2: IDLE };
      times = [];
    },

    push(frames: readonly [PlayerFrame, PlayerFrame]): TwoPlayerCalibrationStatus {
      const [f1, f2] = frames;
      times.push(f1.t);
      while (times.length > 2 && (times[0] as number) < f1.t - 3000) times.shift();
      if (last[1].ready && last[2].ready) return out('ok', { action: 'none' });

      const l1 = f1.landmarks, l2 = f2.landmarks;
      if (!l1 && !l2) return problem('no_person', { action: 'step_in' });
      if (!l1 || !l2) return problem('one_person', { player: l1 ? 2 : 1, action: 'step_in' });

      const e1 = extent(l1, f1.aspect), e2 = extent(l2, f2.aspect);
      const gap = e2.minX - e1.maxX;
      if (gap < TWO_PLAYER_LIMITS.minGapW * Math.min(e1.W, e2.W)) {
        // Player 1 is on the left of the mirror view: the one nearer the middle moves out.
        const mid = f1.aspect / 2;
        const p: PlayerSlot = Math.abs(e1.maxX - mid) < Math.abs(e2.minX - mid) ? 1 : 2;
        return problem('too_close_together', { player: p, action: p === 1 ? 'move_left' : 'move_right' });
      }
      if (e1.minX < TWO_PLAYER_LIMITS.edgeMargin) return problem('player_out', { player: 1, action: 'move_right' });
      if (e2.maxX > f2.aspect - TWO_PLAYER_LIMITS.edgeMargin) return problem('player_out', { player: 2, action: 'move_left' });

      last = { 1: cal[1].push(f1), 2: cal[2].push(f2) };
      if (last[1].ready && last[2].ready) return out('ok', { action: 'none' });
      // Report the first player who still needs to do something.
      for (const s of [1, 2] as const) {
        const st = last[s];
        if (st.ready) continue;
        if (st.code === 'too_slow') return out('too_slow', { action: 'none' });
        if (st.code !== 'hold') return out(st.code, { player: s, action: ACTION[st.code] ?? 'hold_still' });
      }
      return out('hold', { action: 'hold_still' });
    },

    profiles(): Record<PlayerSlot, BodyProfile> | null {
      const a = cal[1].profile(), b = cal[2].profile();
      return a && b ? { 1: a, 2: b } : null;
    },

    reset(): void {
      for (const s of [1, 2] as const) cal[s].reset();
      last = { 1: IDLE, 2: IDLE };
      times = [];
    },
  };
}
