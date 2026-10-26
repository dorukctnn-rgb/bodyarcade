// How well the real pose model found the synthetic person: for every frame the landmarks it returned are compared with the
// true joints of the rig, projected into the same picture. Errors are in torso lengths of the picture (the distance from the
// middle of the shoulders to the middle of the hips), so a close and a far camera can be compared.
//
// What this does and does not say: the people are cartoon characters (Kenney, CC0) with big heads and flat shading. The
// model finding them, and how closely, is evidence about the movement library's thresholds on a clean, well-lit, full-body
// picture. It is not evidence about real bodies, clothes, rooms, webcams or compression; real traces stay the reference.
import type { TraceFile } from '../../packages/core/types/index.ts';
import type { JointName } from './rig.ts';
import type { TruthPerson } from './render.page.ts';
import type { Dims, TruthFrame } from './labels.ts';

/** MediaPipe landmark index -> the rig joint that stands for it (the nose is the rig's estimate, see render.page.ts). */
export const LANDMARKS: [number, string, JointName][] = [
  [0, 'nose', 'noseTip'], [11, 'leftShoulder', 'armL'], [12, 'rightShoulder', 'armR'], [13, 'leftElbow', 'foreL'], [14, 'rightElbow', 'foreR'],
  [15, 'leftWrist', 'handL'], [16, 'rightWrist', 'handR'], [19, 'leftIndex', 'indexL'], [20, 'rightIndex', 'indexR'], [21, 'leftThumb', 'thumbL'], [22, 'rightThumb', 'thumbR'],
  [23, 'leftHip', 'upLegL'], [24, 'rightHip', 'upLegR'], [25, 'leftKnee', 'lowLegL'], [26, 'rightKnee', 'lowLegR'], [27, 'leftAnkle', 'footL'], [28, 'rightAnkle', 'footR'],
  [31, 'leftFootIndex', 'toesEndL'], [32, 'rightFootIndex', 'toesEndR'],
];

export interface LandmarkError { n: number; median: number; p90: number; meanVisibility: number }

export interface ClipQuality {
  clip: string;
  variant: string;
  frames: number;
  people: number;
  /** Share of the frames in which every person of the picture was found. */
  detectionRate: number;
  /** Share of the frames in which at least one person was found. */
  anyRate: number;
  /** The longest run of frames without a person found (seconds). */
  longestGapSeconds: number;
  /** Landmark error over all landmarks and frames, in picture torso lengths (T). */
  errorMedian: number;
  errorP90: number;
  /** Error of the landmarks the movement detectors rely on, by landmark name. */
  byLandmark: Record<string, LandmarkError>;
  /** How much the landmarks of a person who stands still move from frame to frame (median, in T): the noise the detectors see. */
  stillJitter: number | null;
  /** Mean time the model took per frame (ms) on this machine. */
  inferenceMs: number;
  note: string;
}

const pct = (v: number[], q: number): number => { if (!v.length) return 0; const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))] as number; };
const r3 = (x: number): number => Math.round(x * 1000) / 1000;

interface Pt { x: number; y: number; v: number }
const unpack = (flat: readonly number[]): Pt[] => { const out: Pt[] = []; for (let i = 0; i + 3 < flat.length; i += 4) out.push({ x: flat[i] as number, y: flat[i + 1] as number, v: flat[i + 3] as number }); return out; };

export function qualityOf(trace: TraceFile, truth: readonly TruthFrame[], dims: readonly Dims[], id: { clip: string; variant: string }): ClipQuality {
  const aspect = trace.aspect;
  const people = truth[0]?.people.length ?? 1;
  let allFound = 0;
  let anyFound = 0;
  let gap = 0;
  let longest = 0;
  const errors: number[] = [];
  const per = new Map<string, { e: number[]; v: number[] }>();
  const jitter: number[] = [];
  let prev: Pt[] | null = null;
  let infer = 0;
  let inferN = 0;
  const frames = Math.min(trace.frames.length, truth.length);
  for (let i = 0; i < frames; i++) {
    const fr = trace.frames[i] as TraceFile['frames'][number];
    const found = (people > 1 ? (fr.people ?? (fr.lm ? [fr.lm] : [])) : fr.lm ? [fr.lm] : []).map(unpack);
    if (fr.ms !== undefined) { infer += fr.ms; inferN++; }
    if (found.length) { anyFound++; gap = 0; } else { gap++; longest = Math.max(longest, gap); }
    const used = new Set<number>();
    let matched = 0;
    for (let k = 0; k < people; k++) {
      const tp = (truth[i] as TruthFrame).people[k] as TruthPerson;
      const hipT = { x: (((tp.upLegL?.x ?? 0) + (tp.upLegR?.x ?? 0)) / 2) * aspect, y: ((tp.upLegL?.y ?? 0) + (tp.upLegR?.y ?? 0)) / 2 };
      const shT = { x: (((tp.armL?.x ?? 0) + (tp.armR?.x ?? 0)) / 2) * aspect, y: ((tp.armL?.y ?? 0) + (tp.armR?.y ?? 0)) / 2 };
      const torso = Math.hypot(hipT.x - shT.x, hipT.y - shT.y) || 1;
      // The found person whose hips are closest to this one.
      let best = -1;
      let bestD = Infinity;
      found.forEach((pts, j) => {
        if (used.has(j)) return;
        const h = { x: (((pts[23]?.x ?? 0) + (pts[24]?.x ?? 0)) / 2) * aspect, y: ((pts[23]?.y ?? 0) + (pts[24]?.y ?? 0)) / 2 };
        const dd = Math.hypot(h.x - hipT.x, h.y - hipT.y);
        if (dd < bestD) { bestD = dd; best = j; }
      });
      if (best < 0 || bestD > torso * 1.2) continue;
      used.add(best);
      matched++;
      const pts = found[best] as Pt[];
      for (const [idx, name, joint] of LANDMARKS) {
        const t = tp[joint];
        const p = pts[idx];
        if (!t || !p) continue;
        const e = Math.hypot((p.x - t.x) * aspect, p.y - t.y) / torso;
        errors.push(e);
        const rec = per.get(name) ?? { e: [], v: [] };
        rec.e.push(e); rec.v.push(p.v);
        per.set(name, rec);
      }
      if (k === 0 && people === 1 && (id.clip.startsWith('idle') || id.clip.startsWith('squat-shallow')) && i < 60) {
        if (prev) { const d: number[] = []; for (const [idx] of LANDMARKS) { const a = pts[idx]; const b = prev[idx]; if (a && b) d.push(Math.hypot((a.x - b.x) * aspect, a.y - b.y) / torso); } jitter.push(pct(d, 0.5)); }
        prev = pts;
      }
    }
    if (matched === people) allFound++;
  }
  void dims;
  const byLandmark: Record<string, LandmarkError> = {};
  for (const [name, rec] of per) byLandmark[name] = { n: rec.e.length, median: r3(pct(rec.e, 0.5)), p90: r3(pct(rec.e, 0.9)), meanVisibility: r3(rec.v.reduce((a, b) => a + b, 0) / Math.max(1, rec.v.length)) };
  return {
    clip: id.clip, variant: id.variant, frames, people,
    detectionRate: r3(allFound / Math.max(1, frames)), anyRate: r3(anyFound / Math.max(1, frames)), longestGapSeconds: r3((longest / Math.max(1, trace.fps))),
    errorMedian: r3(pct(errors, 0.5)), errorP90: r3(pct(errors, 0.9)), byLandmark, stillJitter: jitter.length ? r3(pct(jitter, 0.5)) : null,
    inferenceMs: r3(infer / Math.max(1, inferN)),
    note: 'Cartoon character, clean picture: evidence about the thresholds, not about real bodies.',
  };
}
