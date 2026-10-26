// A judge of core/moves (BendTester, PoseWallJudge) keeps its memory in private fields: a Map of what each gate has seen and
// the time of the last pose frame. A Game must be able to write that down and read it back (restore(snapshot()) continues
// exactly, even in the middle of a hold). This copies every own property with a Map-aware encoder and reads them back, so a
// field the movement library adds later is carried along; a test proves the round trip in the middle of a hold.
const MAP = '$map';
const NUM = '$num';

/** Plain JSON for Maps and the numbers JSON cannot hold (Infinity and NaN, which the judges start their distances with). */
export function encode(v: unknown): unknown {
  if (v instanceof Map) return { [MAP]: [...v.entries()].map(([k, x]) => [encode(k), encode(x)]) };
  if (typeof v === 'number' && !Number.isFinite(v)) return { [NUM]: String(v) };
  if (Array.isArray(v)) return v.map(encode);
  if (v !== null && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, encode(x)]));
  return v;
}

export function decode(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(decode);
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (MAP in o && Array.isArray(o[MAP])) return new Map((o[MAP] as [unknown, unknown][]).map(([k, x]) => [decode(k), decode(x)]));
    if (NUM in o && typeof o[NUM] === 'string') return Number(o[NUM]);
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, decode(x)]));
  }
  return v;
}

/** Everything the object remembers, as plain JSON. */
export function dumpOwn(obj: object): unknown {
  return encode({ ...(obj as Record<string, unknown>) });
}

/** Reads back what dumpOwn wrote; properties the object does not have are ignored. */
export function loadOwn(obj: object, data: unknown): void {
  const own = obj as Record<string, unknown>;
  const d = decode(data);
  if (d === null || typeof d !== 'object') return;
  for (const [k, v] of Object.entries(d as Record<string, unknown>)) if (k in own) own[k] = v;
}
