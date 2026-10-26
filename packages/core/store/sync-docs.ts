// The documents a second device needs to go on where the first one stopped: the streak (habit), the daily challenge (daily)
// and the workout plans (plans). The server (src/social/sync.ts) keeps them as they are and never reads them; what is in them
// and how two copies become one is decided here, and it is always a union of facts: a day that either device wrote is a day
// both end up with, whichever one spoke first and however often. So a conflict is never a question of who is right.
//
//   sync()   asks the server for the documents (one request), takes in what another device wrote, and sends back only the
//            documents in which this device knows something the server does not (a write of a day set is a few hundred
//            characters; a device that has nothing new writes nothing, and the server allows sixty writes a day).
//
// The port is the social client's own loadSync and updateSync, so `SocialClient` is passed in as it is. Nothing here throws:
// an offline device, a player without a profile, a server that is busy all give a report that says so, and the next sync tries again.
import { type ChallengeDoc, emptyChallengeDoc, mergeChallengeDocs, readChallengeDoc } from './daily-challenge.ts';
import { type HabitDoc, emptyHabitDoc, mergeHabitDocs, readHabitDoc } from './habit.ts';
import { type PlansDoc, emptyPlansDoc, mergePlansDocs, readPlansDoc } from './workout-plans.ts';

export type DocKey = 'daily' | 'habit' | 'plans';
export const DOC_KEYS: readonly DocKey[] = ['daily', 'habit', 'plans'];

export interface SyncedDocument { rev: number; at: number; data: unknown }

/** What of the social client this module uses (a structural subset: the real one fits). */
export interface SyncPort {
  loadSync(): Promise<Partial<Record<string, SyncedDocument>>>;
  updateSync<T>(key: DocKey, change: (current: T | null) => T, tries?: number): Promise<{ rev: number; at: number; data: T }>;
}

/** The three records on this device, as the sync sees them. */
export interface SyncSources {
  habit: { doc(): HabitDoc; merge(remote: unknown): boolean };
  challenge: { doc(): ChallengeDoc; merge(remote: unknown): boolean };
  plans: { doc(): PlansDoc; merge(remote: unknown): boolean };
}

export type SyncFailure = 'no_port' | 'network' | 'refused' | 'failed';

export interface SyncReport {
  ok: boolean;
  /** Documents in which the server knew something this device did not. */
  pulled: DocKey[];
  /** Documents the server lacked something of. */
  pushed: DocKey[];
  failure?: SyncFailure;
  /** Epoch ms of the end of the attempt. */
  at: number;
}

export interface DocSync {
  /** Never throws. Two calls at once share one attempt. */
  sync(): Promise<SyncReport>;
}

export interface DocSyncOptions {
  /** The social client once there is one (a profile); null until then. */
  port: () => SyncPort | null;
  sources: SyncSources;
  now?: () => number;
}

interface Kind<D> {
  read(raw: unknown): D | null;
  empty(): D;
  merge(a: D, b: D): D;
  local(s: SyncSources): D;
}

const KINDS: { [K in DocKey]: Kind<unknown> } = {
  habit: { read: readHabitDoc, empty: emptyHabitDoc, merge: (a, b) => mergeHabitDocs(a as HabitDoc, b as HabitDoc), local: (s) => s.habit.doc() },
  daily: { read: readChallengeDoc, empty: emptyChallengeDoc, merge: (a, b) => mergeChallengeDocs(a as ChallengeDoc, b as ChallengeDoc), local: (s) => s.challenge.doc() },
  plans: { read: readPlansDoc, empty: emptyPlansDoc, merge: (a, b) => mergePlansDocs(a as PlansDoc, b as PlansDoc), local: (s) => s.plans.doc() },
};

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

class NewerDocument extends Error {}

/** What went wrong, as far as the social client says: its errors carry a status (0 for a request that never got an answer) and a code. */
function failureOf(e: unknown): SyncFailure {
  const status = (e as { status?: unknown } | null)?.status;
  if (typeof status === 'number') return status === 0 ? 'network' : status === 401 || status === 403 || status === 404 ? 'refused' : 'failed';
  const name = (e as { name?: unknown } | null)?.name;
  return name === 'TypeError' || name === 'AbortError' ? 'network' : 'failed';
}

/** A document written by a newer version of the app: this one cannot read it and must not write over it. */
const isNewer = (raw: unknown): boolean => typeof raw === 'object' && raw !== null && typeof (raw as { v?: unknown }).v === 'number' && (raw as { v: number }).v > 1;

export function createDocSync(o: DocSyncOptions): DocSync {
  const now = o.now ?? Date.now;
  let running: Promise<SyncReport> | null = null;

  async function run(): Promise<SyncReport> {
    const port = (() => { try { return o.port(); } catch { return null; } })();
    if (!port) return { ok: false, pulled: [], pushed: [], failure: 'no_port', at: now() };
    const pulled: DocKey[] = [];
    const pushed: DocKey[] = [];
    let remote: Partial<Record<string, SyncedDocument>>;
    try {
      remote = await port.loadSync();
    } catch (e) {
      return { ok: false, pulled, pushed, failure: failureOf(e), at: now() };
    }
    // First take in what the server holds, so that what is sent back is the union and a wrong guess costs nothing.
    for (const key of DOC_KEYS) {
      const data = remote[key]?.data;
      if (data === undefined || isNewer(data)) continue;
      try {
        const source = key === 'habit' ? o.sources.habit : key === 'daily' ? o.sources.challenge : o.sources.plans;
        if (source.merge(data)) pulled.push(key);
      } catch { /* one document that cannot be taken in does not stop the others */ }
    }
    let failure: SyncFailure | undefined;
    for (const key of DOC_KEYS) {
      if (isNewer(remote[key]?.data)) continue;                      // a newer version of the app wrote it: it is left as it is
      const kind = KINDS[key];
      const mine = kind.local(o.sources);
      const theirs = kind.read(remote[key]?.data) ?? kind.empty();
      if (same(kind.merge(theirs, mine), theirs)) continue;          // the server knows everything this device knows
      try {
        await port.updateSync<unknown>(key, (cur) => {
          if (isNewer(cur)) throw new NewerDocument();                // it became a newer document while we were looking
          return kind.merge(kind.read(cur) ?? kind.empty(), kind.local(o.sources));
        });
        pushed.push(key);
      } catch (e) {
        if (e instanceof NewerDocument) continue;
        failure = failureOf(e);
        break;                                                       // the connection or the server is the problem: no use trying the rest now
      }
    }
    return failure ? { ok: false, pulled, pushed, failure, at: now() } : { ok: true, pulled, pushed, at: now() };
  }

  return {
    sync() {
      running ??= run().catch((): SyncReport => ({ ok: false, pulled: [], pushed: [], failure: 'failed', at: now() })).finally(() => { running = null; });
      return running;
    },
  };
}
