// The judge of a lane: core/moves HitTester (the movement library's own reading of "did the hand touch the target, for
// how long, how fast, with the right hand") plus the one thing a Game needs and a detector does not: its memory can be
// written down and read back, so `restore(snapshot())` continues exactly, even in the middle of a touch that has lasted
// 40 of the 60 ms a star needs.
//
// HitTester keeps its memory in private fields (a Map of what each target has seen, and the last pose frame time). The
// copy below does not know their names: it writes every own property of the object with a Map-aware encoder and reads
// them back, so a field the movement builder adds later is carried along. A test proves the round trip in the middle of
// a touch, and that this class still judges exactly like HitTester.
import { HitTester } from '../../core/moves/handHit.ts';

const MAP = '$map';
const NUM = '$num';

/** Plain JSON for Maps and the numbers JSON cannot hold (Infinity, which the judge starts its distances with). */
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

export class Judge extends HitTester {
  /** Everything the judge remembers, as plain JSON. (Not called `state`: HitTester has a private method of that name.) */
  dump(): unknown {
    return encode({ ...(this as unknown as Record<string, unknown>) });
  }

  /** Reads back what `dump()` wrote; properties this judge does not have are ignored. */
  load(s: unknown): void {
    const own = this as unknown as Record<string, unknown>;
    const data = decode(s);
    if (data === null || typeof data !== 'object') return;
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) if (k in own) own[k] = v;
  }
}
