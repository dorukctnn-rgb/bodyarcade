// Trace files: parse (untrusted JSON), serialise, resample for slow-device tests, replay as a frame source,
// and record from a running pose service. Format: packages/core/types/trace.ts and trace.schema.json.
import {
  LANDMARK_COUNT, TRACE_FORMAT, TRACE_VERSION,
  type Landmark, type LandmarkFrameSource, type ParseTraceFn, type PoseFrame, type RecordTraceFn, type SerializeTraceFn,
  type SourceLandmarks, type Trace, type TraceFile, type TraceFrame, type TraceFramesFn, type TraceLabel, type TraceMeta,
  type TraceSourceFn, type TraceSourceOptions, type Unsubscribe,
} from '../types/index.ts';

export class TraceFormatError extends Error {
  readonly path: string;
  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'TraceFormatError';
    this.path = path;
  }
}

const ORIGINS = ['recorded', 'video', 'synthetic'] as const;
const FRAMINGS = ['full', 'upper', 'side'] as const;
const CONSENTS = ['opt-in', 'licensed', 'own'] as const;
const LABEL_IDS = ['squat', 'jump', 'lean', 'kneeLift', 'jumpingJack', 'handHit', 'swipe', 'twist', 'sideBend', 'pull',
  'overheadPress', 'poseMatch', 'energy', 'steadiness', 'sideLine', 'armDirection', 'still', 'leave', 'enter'] as const;
const LABEL_KINDS = ['rep', 'hit', 'holdStart', 'holdEnd', 'value', 'marker'] as const;
const META_KEYS = ['id', 'origin', 'framing', 'model', 'recordedAt', 'device', 'notes', 'consent'];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function oneOf<T extends string>(v: unknown, allowed: readonly T[], path: string): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) throw new TraceFormatError(path, `must be one of ${allowed.join(', ')}`);
  return v as T;
}

function onlyKeys(o: Record<string, unknown>, keys: string[], path: string): void {
  for (const k of Object.keys(o)) if (!keys.includes(k)) throw new TraceFormatError(`${path}.${k}`, 'unknown field');
}

function optString(o: Record<string, unknown>, k: string, path: string, max: number): string | undefined {
  const v = o[k];
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || v.length > max) throw new TraceFormatError(`${path}.${k}`, `must be a string of at most ${max} characters`);
  return v;
}

function parseMeta(v: unknown): TraceMeta {
  if (!isObj(v)) throw new TraceFormatError('meta', 'must be an object');
  onlyKeys(v, META_KEYS, 'meta');
  if (typeof v.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(v.id)) throw new TraceFormatError('meta.id', 'must be a short lower-case name');
  const meta: TraceMeta = { id: v.id, origin: oneOf(v.origin, ORIGINS, 'meta.origin'), framing: oneOf(v.framing, FRAMINGS, 'meta.framing') };
  const model = optString(v, 'model', 'meta', 200); if (model !== undefined) meta.model = model;
  const recordedAt = optString(v, 'recordedAt', 'meta', 64);
  if (recordedAt !== undefined) {
    if (Number.isNaN(Date.parse(recordedAt))) throw new TraceFormatError('meta.recordedAt', 'must be an ISO date-time');
    meta.recordedAt = recordedAt;
  }
  const device = optString(v, 'device', 'meta', 200); if (device !== undefined) meta.device = device;
  const notes = optString(v, 'notes', 'meta', 2000); if (notes !== undefined) meta.notes = notes;
  if (v.consent !== undefined) meta.consent = oneOf(v.consent, CONSENTS, 'meta.consent');
  return meta;
}

function parseLabel(v: unknown, path: string): TraceLabel {
  if (!isObj(v)) throw new TraceFormatError(path, 'must be an object');
  onlyKeys(v, ['t', 'id', 'kind', 'side', 'note'], path);
  if (!isNum(v.t) || v.t < 0) throw new TraceFormatError(`${path}.t`, 'must be a time in ms, 0 or more');
  const label: TraceLabel = { t: v.t, id: oneOf(v.id, LABEL_IDS, `${path}.id`), kind: oneOf(v.kind, LABEL_KINDS, `${path}.kind`) };
  if (v.side !== undefined) label.side = oneOf(v.side, ['L', 'R'] as const, `${path}.side`);
  const note = optString(v, 'note', path, 200); if (note !== undefined) label.note = note;
  return label;
}

function unflatten(flat: unknown, path: string): Landmark[] | null {
  if (flat === null) return null;
  if (!Array.isArray(flat) || flat.length !== LANDMARK_COUNT * 4) throw new TraceFormatError(path, `must be null or ${LANDMARK_COUNT * 4} numbers`);
  const out: Landmark[] = new Array<Landmark>(LANDMARK_COUNT);
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    const x = flat[i * 4], y = flat[i * 4 + 1], z = flat[i * 4 + 2], visibility = flat[i * 4 + 3];
    if (!isNum(x) || !isNum(y) || !isNum(z) || !isNum(visibility)) throw new TraceFormatError(`${path}[${i * 4}]`, 'landmark values must be finite numbers');
    out[i] = { x, y, z, visibility };
  }
  return out;
}

/** Parses and validates untrusted JSON (the same rules as trace.schema.json, plus frame times must not go back). */
export const parseTrace: ParseTraceFn = (json) => {
  if (!isObj(json)) throw new TraceFormatError('$', 'must be an object');
  onlyKeys(json, ['format', 'version', 'fps', 'aspect', 'meta', 'labels', 'frames'], '$');
  if (json.format !== TRACE_FORMAT) throw new TraceFormatError('format', `must be "${TRACE_FORMAT}"`);
  if (json.version !== TRACE_VERSION) throw new TraceFormatError('version', `must be ${TRACE_VERSION}`);
  if (!isNum(json.fps) || json.fps <= 0 || json.fps > 240) throw new TraceFormatError('fps', 'must be a number in (0, 240]');
  if (!isNum(json.aspect) || json.aspect <= 0 || json.aspect > 4) throw new TraceFormatError('aspect', 'must be a number in (0, 4]');
  const meta = parseMeta(json.meta);
  const labels: TraceLabel[] = [];
  if (json.labels !== undefined) {
    if (!Array.isArray(json.labels)) throw new TraceFormatError('labels', 'must be an array');
    json.labels.forEach((l, i) => labels.push(parseLabel(l, `labels[${i}]`)));
  }
  if (!Array.isArray(json.frames) || json.frames.length === 0) throw new TraceFormatError('frames', 'must be a non-empty array');
  const frames: TraceFrame[] = [];
  let lastT = -Infinity;
  json.frames.forEach((f, i) => {
    const path = `frames[${i}]`;
    if (!isObj(f)) throw new TraceFormatError(path, 'must be an object');
    onlyKeys(f, ['t', 'lm', 'ms'], path);
    if (!isNum(f.t) || f.t < 0) throw new TraceFormatError(`${path}.t`, 'must be a time in ms, 0 or more');
    if (f.t < lastT) throw new TraceFormatError(`${path}.t`, 'frame times must not go back');
    lastT = f.t;
    const frame: TraceFrame = { t: f.t, lm: unflatten(f.lm, `${path}.lm`) };
    if (f.ms !== undefined) {
      if (!isNum(f.ms) || f.ms < 0) throw new TraceFormatError(`${path}.ms`, 'must be a duration in ms');
      frame.inferenceMs = f.ms;
    }
    frames.push(frame);
  });
  return { fps: json.fps, aspect: json.aspect, meta, labels, frames };
};

const round = (v: number, d: number): number => { const k = 10 ** d; return Math.round(v * k) / k; };

/** Compact JSON form; coordinates rounded to `decimals` (default 4), visibility to 3, times to 0.1 ms. */
export const serializeTrace: SerializeTraceFn = (t, o) => {
  const d = o?.decimals ?? 4;
  const frames: TraceFile['frames'] = t.frames.map((f) => {
    const lm = f.lm === null ? null : f.lm.flatMap((p) => [round(p.x, d), round(p.y, d), round(p.z, d), round(p.visibility, 3)]);
    return f.inferenceMs === undefined ? { t: round(f.t, 1), lm } : { t: round(f.t, 1), lm, ms: round(f.inferenceMs, 2) };
  });
  const head = { format: TRACE_FORMAT, version: TRACE_VERSION, fps: t.fps, aspect: round(t.aspect, 6), meta: { ...t.meta } } as const;
  return t.labels.length ? { ...head, labels: t.labels.map((l) => ({ ...l })), frames } : { ...head, frames };
};

/**
 * The frame indices a device running at `hz` would analyse: at each tick it takes the newest frame at or before
 * the tick time and never analyses the same frame twice. Without hz (or hz at or above the trace rate) every frame.
 */
function schedule(t: Trace, hz?: number): { index: number; at: number }[] {
  const out: { index: number; at: number }[] = [];
  if (!hz || hz >= t.fps) {
    t.frames.forEach((f, index) => out.push({ index, at: f.t }));
    return out;
  }
  const step = 1000 / hz;
  const end = t.frames[t.frames.length - 1]?.t ?? 0;
  let j = 0, last = -1;
  for (let k = 0; k * step <= end + 1e-9; k++) {
    const at = (t.frames[0]?.t ?? 0) + k * step;
    while (j + 1 < t.frames.length && (t.frames[j + 1]?.t ?? Infinity) <= at + 1e-9) j++;
    if (j !== last) { out.push({ index: j, at }); last = j; }
  }
  return out;
}

const copyLm = (lm: Landmark[] | null): Landmark[] | null => (lm === null ? null : lm.map((p) => ({ ...p })));

/** Pure, for Node tests: what a device at `hz` sees, as PoseFrames whose times start at `t0`. */
export const traceFrames: TraceFramesFn = (t, o) => {
  const t0 = o?.t0 ?? 0;
  return schedule(t, o?.hz).map(({ index, at }): PoseFrame => {
    const f = t.frames[index] as TraceFrame;
    return { seq: index, t: t0 + at, landmarks: copyLm(f.lm), inferenceMs: f.inferenceMs ?? 0, source: o?.source ?? 'trace', aspect: t.aspect };
  });
};

/** Plays a trace in real time (or `speed` times faster) through the same path a camera uses. */
export const traceSource: TraceSourceFn = (t: Trace, o: TraceSourceOptions = {}): LandmarkFrameSource => {
  const plan = schedule(t, o.hz);
  const speed = o.speed && o.speed > 0 ? o.speed : 1;
  const listeners = new Set<(f: SourceLandmarks) => void>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let done = false;
  let next = 0;
  let startedAt = 0;
  const firstAt = plan[0]?.at ?? 0;
  const span = (plan[plan.length - 1]?.at ?? 0) - firstAt + 1000 / Math.max(1, o.hz ?? t.fps);

  const tick = (): void => {
    timer = null;
    if (!running) return;
    const now = performance.now();
    // Deliver every planned frame that is due (a busy thread catches up instead of drifting).
    while (next < plan.length) {
      const p = plan[next] as { index: number; at: number };
      if (startedAt + (p.at - firstAt) / speed > now + 0.5) break;
      const f = t.frames[p.index] as TraceFrame;
      const out: SourceLandmarks = { t: now, landmarks: copyLm(f.lm) };
      if (f.inferenceMs !== undefined) out.inferenceMs = f.inferenceMs;
      next++;
      for (const cb of [...listeners]) cb(out);
    }
    if (next >= plan.length) {
      if (o.loop && plan.length > 0) { next = 0; startedAt += span / speed; }
      else { done = true; running = false; return; }
    }
    const p = plan[next] as { index: number; at: number };
    timer = setTimeout(tick, Math.max(0, startedAt + (p.at - firstAt) / speed - performance.now()));
  };

  return {
    kind: 'landmarks',
    source: 'trace',
    aspect: t.aspect,
    get done() { return done; },
    start() {
      if (running) return Promise.resolve();
      running = true; done = false; next = 0; startedAt = performance.now();
      tick();
      return Promise.resolve();
    },
    stop() {
      running = false;
      if (timer !== null) { clearTimeout(timer); timer = null; }
    },
    onFrame(cb): Unsubscribe {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
  };
};

/** Records what a pose service delivers (landmarks only) until stop(). */
export const recordTrace: RecordTraceFn = (pose, meta) => {
  const frames: TraceFrame[] = [];
  let t0: number | null = null;
  let aspect = 4 / 3;
  let stopped = false;
  const off = pose.onFrame((f) => {
    if (stopped) return;
    if (t0 === null) { t0 = f.t; aspect = f.aspect; }
    frames.push({ t: f.t - t0, lm: copyLm(f.landmarks), inferenceMs: f.inferenceMs });
  });
  return {
    get frames() { return frames.length; },
    stop(): Trace {
      if (!stopped) { stopped = true; off(); }
      const last = frames[frames.length - 1];
      const dur = last ? last.t : 0;
      const fps = frames.length > 1 && dur > 0 ? Math.round(((frames.length - 1) * 1000 / dur) * 10) / 10 : 30;
      return { fps, aspect, meta: { origin: 'recorded', ...meta }, labels: [], frames: frames.slice() };
    },
  };
};
