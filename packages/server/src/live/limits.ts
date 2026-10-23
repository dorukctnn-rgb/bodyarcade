// Per-IP limits for the HTTP side of live play (room creation, joins, ICE). Counters live in the Worker isolate's memory:
// a best-effort guard that stops a script from one address creating rooms in a loop. It is not shared between isolates,
// so Cloudflare's own rate limiting rules stay the second line (dashboard, per path). The Room has its own caps on
// what a seated player can send.

interface Bucket { start: number; n: number }

const buckets = new Map<string, Bucket>();
let lastSweep = 0;

/** True when this call is within `max` per `windowMs` for `key`; counts the call. */
export function allow(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  if (now - lastSweep > 60_000) {
    lastSweep = now;
    for (const [k, b] of buckets) if (now - b.start > 3600_000) buckets.delete(k);
  }
  const b = buckets.get(key);
  if (!b || now - b.start >= windowMs) { buckets.set(key, { start: now, n: 1 }); return true; }
  if (b.n >= max) return false;
  b.n++;
  return true;
}

/** Tests only. */
export function resetLimits(): void {
  buckets.clear();
}

export const LIMITS = {
  /** New rooms per IP per hour. */
  createPerHour: 30,
  /** Join tickets per IP per 10 minutes (one family at one address joins a few rooms, a script joins hundreds). */
  joinPer10Min: 120,
  /** Room lookups per IP per minute (the invite page). */
  previewPerMin: 60,
  /** ICE credentials per IP per 10 minutes. */
  icePer10Min: 40,
} as const;
