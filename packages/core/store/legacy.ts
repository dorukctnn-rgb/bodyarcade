// Migration from the live site's localStorage keys (site/game/store.js, all 'ba_*').
//
// The live site keeps working next to v2 on the same origin, so this module only READS the v1 keys and never writes,
// renames or deletes one. readLegacyV1() returns a checked snapshot that each owner applies to its own storage:
//   - importLegacyRunner() here: runs, totals, bests, worlds, achievements, the daily goal and its streak
//   - core/entitlements: `license` (the Gumroad key; the rules for a suspicious record are in that module)
//   - core/ui and the profile owner: `profile` and `settings` (name, weight, sound)
// Everything is defensive: a damaged or hand-edited v1 key is skipped, never trusted (B4, B1).
import { dayFromSeed, dayOf, type Day } from './date.ts';
import {
  ActivitySchema, BestsSchema, DailySchema, ID_RE, LEGACY_DIFFICULTY, RunsSchema, TotalsSchema, UnlockedSchema, VariantsSchema,
  bestKey, type DayActivity, type RunRecord, type Totals,
} from './progress.ts';
import { p, schemaOf } from './schema.ts';
import type { BodyArcadeStore, StorageLike, StoreNamespace } from './store.ts';

export const V1_KEYS = [
  'ba_profile', 'ba_settings', 'ba_daily', 'ba_license', 'ba_runs', 'ba_totals', 'ba_best',
  'ba_achievements', 'ba_daily_done', 'ba_daily_streak', 'ba_worlds',
] as const;

export interface LegacyLicense {
  key: string;
  /** 'pro' was the $4.99 monthly membership, 'lifetime' the $99 one-time purchase. */
  product: 'pro' | 'lifetime';
  /** Epoch ms of the last check v1 made; 0 when the stored value could not be trusted (B1: a future time never counts). */
  verifiedAt: number;
  /** End of a cancelled membership's paid period (epoch ms). */
  endsAt?: number;
  /** The record claimed a verification time later than now: the entitlements module must treat it as unverified. */
  futureVerifiedAt: boolean;
}

export interface LegacyV1 {
  profile: { name: string; weight: number | null } | null;
  settings: { world?: string; diff?: string; sound?: boolean; input?: 'camera' | 'keys'; skin?: string } | null;
  runs: RunRecord[];
  totals: Totals | null;
  /** Best score per world, as v1 kept it (over all difficulties). */
  bests: Record<string, number>;
  achievements: string[];
  worlds: string[];
  daily: { done: Day | null; streak: { n: number; last: Day | null } };
  license: LegacyLicense | null;
}

export interface LegacyOptions {
  /** Epoch ms now; defaults to Date.now(). */
  now?: number;
  /** IANA zone for turning a run's time into its day; defaults to the device's own zone. */
  timeZone?: string;
}

const MAX_SKEW = 5 * 60_000;
const LICENSE_KEY_RE = /^[A-Za-z0-9-]{8,80}$/;

function readJson(storage: StorageLike, key: string): unknown {
  let text: string | null;
  try { text = storage.getItem(key); } catch { return undefined; }
  if (text === null) return undefined;
  try { return JSON.parse(text) as unknown; } catch { return undefined; }
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown): number | undefined => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);
const nonNeg = (x: unknown): number => { const n = num(x); return n !== undefined && n >= 0 ? n : 0; };
const id = (x: unknown): string | undefined => (typeof x === 'string' && ID_RE.test(x) ? x : undefined);

function convertRun(x: unknown, tz: string | undefined): RunRecord | null {
  if (!isRecord(x)) return null;
  const ts = num(x['ts']);
  const variant = id(x['world']);
  if (ts === undefined || ts < 0 || ts > 4_102_444_800_000 || variant === undefined) return null;
  const difficulty = id(x['diff']) ?? 'unknown';
  const stats: Record<string, number> = {};
  for (const k of ['cleared', 'hits', 'bestCombo', 'coins', 'kcal', 'dist'] as const) {
    const v = num(x[k]);
    if (v !== undefined && v >= 0 && v <= 1e9) stats[k] = v;
  }
  return {
    t: Math.round(ts),
    day: dayOf(ts, tz),
    score: Math.round(Math.min(1e9, nonNeg(x['score']))),
    seconds: Math.min(86_400, nonNeg(x['seconds'])),
    variant,
    difficulty,
    complete: x['complete'] === true,
    stats,
  };
}

function readLicense(raw: unknown, now: number): LegacyLicense | null {
  if (!isRecord(raw)) return null;
  const key = raw['key'];
  if (typeof key !== 'string' || !LICENSE_KEY_RE.test(key)) return null;
  const product = raw['product'] === 'lifetime' ? 'lifetime' : raw['product'] === 'pro' ? 'pro' : null;
  if (product === null) return null;
  const verified = num(raw['verifiedAt']);
  const future = verified !== undefined && verified > now + MAX_SKEW;
  const ends = num(raw['endsAt']);
  const lic: LegacyLicense = {
    key,
    product,
    verifiedAt: verified !== undefined && verified > 0 && !future ? verified : 0,
    futureVerifiedAt: future,
  };
  if (ends !== undefined && ends > 0) lic.endsAt = ends;
  return lic;
}

/** A checked snapshot of the v1 keys, or null when the browser holds none of them. Never writes. */
export function readLegacyV1(storage: StorageLike, o: LegacyOptions = {}): LegacyV1 | null {
  const now = o.now ?? Date.now();
  const raw: Record<string, unknown> = {};
  let any = false;
  for (const k of V1_KEYS) {
    raw[k] = readJson(storage, k);
    if (raw[k] !== undefined) any = true;
  }
  if (!any) return null;

  const profile = ((): LegacyV1['profile'] => {
    const x = raw['ba_profile'];
    if (!isRecord(x)) return null;
    const w = num(x['weight']);
    return { name: typeof x['name'] === 'string' ? x['name'].slice(0, 20) : '', weight: w !== undefined && w >= 20 && w <= 350 ? w : null };
  })();

  const settings = ((): LegacyV1['settings'] => {
    const x = raw['ba_settings'];
    if (!isRecord(x)) return null;
    const out: NonNullable<LegacyV1['settings']> = {};
    const world = id(x['world']); if (world) out.world = world;
    const diff = id(x['diff']); if (diff) out.diff = diff;
    const skin = id(x['skin']); if (skin) out.skin = skin;
    if (typeof x['sound'] === 'boolean') out.sound = x['sound'];
    if (x['input'] === 'camera' || x['input'] === 'keys') out.input = x['input'];
    return out;
  })();

  const runs: RunRecord[] = [];
  if (Array.isArray(raw['ba_runs'])) {
    for (const item of raw['ba_runs'] as unknown[]) {
      const r = convertRun(item, o.timeZone);
      if (r) runs.push(r);
      if (runs.length >= 200) break;
    }
  }

  const totals = ((): Totals | null => {
    const x = raw['ba_totals'];
    if (!isRecord(x)) return null;
    const out: Totals = {};
    for (const [from, to] of [['runs', 'runs'], ['seconds', 'seconds'], ['kcal', 'kcal'], ['cleared', 'cleared']] as const) {
      const v = num(x[from]);
      if (v !== undefined && v >= 0 && v <= 1e12) out[to] = v;
    }
    return Object.keys(out).length ? out : null;
  })();

  const bests: Record<string, number> = {};
  if (isRecord(raw['ba_best'])) {
    for (const [world, v] of Object.entries(raw['ba_best'])) {
      const w = id(world); const n = num(v);
      if (w && n !== undefined && n > 0 && n <= 1e9) bests[w] = Math.round(n);
    }
  }

  const achievements = Array.isArray(raw['ba_achievements'])
    ? [...new Set((raw['ba_achievements'] as unknown[]).filter((a): a is string => typeof a === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(a)))].slice(0, 200)
    : [];
  const worlds = Array.isArray(raw['ba_worlds'])
    ? [...new Set((raw['ba_worlds'] as unknown[]).map(id).filter((w): w is string => w !== undefined))].slice(0, 80)
    : [];

  const streakRaw = raw['ba_daily_streak'];
  const streak = isRecord(streakRaw)
    ? { n: Math.min(100_000, Math.floor(nonNeg(streakRaw['n']))), last: dayFromSeed(streakRaw['last']) }
    : { n: 0, last: null };

  return {
    profile,
    settings,
    runs,
    totals,
    bests,
    achievements,
    worlds,
    daily: { done: dayFromSeed(raw['ba_daily_done']), streak },
    license: readLicense(raw['ba_license'], now),
  };
}

// ── the import into v2 ──
const MarkerSchema = schemaOf(1, p.object({ at: p.epoch(), runs: p.number({ int: true, min: 0 }), from: p.literal('ba_*') }));

export interface ImportReport {
  /** imported: data was copied. already: done before. nothing: no v1 data. has-data: v2 already has progress, left alone. */
  status: 'imported' | 'already' | 'nothing' | 'has-data';
  runs: number;
  achievements: number;
  worlds: number;
  bests: number;
}

const report = (status: ImportReport['status'], x: Partial<Omit<ImportReport, 'status'>> = {}): ImportReport =>
  ({ status, runs: 0, achievements: 0, worlds: 0, bests: 0, ...x });

/**
 * Copies the live runner's progress into the runner's v2 namespace, once. Idempotent: a marker in the 'core' namespace
 * stops a second import, so progress made in v2 is never overwritten by an older v1 snapshot, and the v1 keys stay as
 * they were. The totals are the v1 totals when they exist (they count runs beyond the 200 v1 kept), else computed.
 */
export function importLegacyRunner(store: BodyArcadeStore, storage: StorageLike, ns: StoreNamespace, o: LegacyOptions & { snapshot?: LegacyV1 | null } = {}): ImportReport {
  const core = store.ns('core');
  if (core.has('legacy-v1')) return report('already');

  const snap = o.snapshot !== undefined ? o.snapshot : readLegacyV1(storage, o);
  if (!snap) return report('nothing');
  const hasProgress = ns.has('runs') || ns.has('totals') || ns.has('ach');
  const worthImporting = snap.runs.length > 0 || snap.totals !== null || snap.achievements.length > 0 || snap.worlds.length > 0 || Object.keys(snap.bests).length > 0 || snap.daily.done !== null || snap.daily.streak.n > 0;
  if (!worthImporting) return report('nothing');
  if (hasProgress) {
    core.set('legacy-v1', { at: store.now(), runs: 0, from: 'ba_*' }, MarkerSchema);
    return report('has-data');
  }

  if (snap.runs.length) ns.set('runs', snap.runs, RunsSchema);

  const totals: Totals = snap.totals ? { ...snap.totals } : {};
  if (!snap.totals && snap.runs.length) {
    totals['runs'] = snap.runs.length;
    for (const r of snap.runs) {
      totals['seconds'] = (totals['seconds'] ?? 0) + r.seconds;
      for (const [k, v] of Object.entries(r.stats)) if (k !== 'dist') totals[k] = (totals[k] ?? 0) + v;
    }
  }
  if (Object.keys(totals).length) ns.set('totals', totals, TotalsSchema);

  // Bests: exact where a kept run proves the difficulty; a best older than the kept runs is filed under 'legacy'.
  const bests: Record<string, number> = {};
  for (const r of snap.runs) {
    const k = bestKey(r.variant, r.difficulty);
    if (r.score > (bests[k] ?? 0)) bests[k] = r.score;
  }
  for (const [world, best] of Object.entries(snap.bests)) {
    const known = Object.entries(bests).filter(([k]) => k.startsWith(`${world}|`)).reduce((m, [, v]) => Math.max(m, v), 0);
    if (best > known) bests[bestKey(world, LEGACY_DIFFICULTY)] = best;
  }
  if (Object.keys(bests).length) ns.set('bests', bests, BestsSchema);

  const worlds = [...new Set([...snap.worlds, ...snap.runs.map((r) => r.variant)])].slice(0, 80);
  if (worlds.length) ns.set('variants', worlds, VariantsSchema);

  if (snap.achievements.length) ns.set('ach', Object.fromEntries(snap.achievements.map((a) => [a, 0])), UnlockedSchema);

  if (snap.daily.done !== null || snap.daily.streak.n > 0) {
    ns.set('daily', { done: snap.daily.done, n: snap.daily.streak.n, last: snap.daily.streak.last }, DailySchema);
  }

  // The activity log starts from the kept runs, so the history charts are not empty on day one.
  const activity: Record<Day, DayActivity> = {};
  for (const r of snap.runs) {
    const a = activity[r.day] ?? { runs: 0, seconds: 0, best: 0 };
    a.runs += 1; a.seconds += r.seconds; a.best = Math.max(a.best, r.score);
    activity[r.day] = a;
  }
  if (Object.keys(activity).length) ns.set('activity', activity, ActivitySchema);

  core.set('legacy-v1', { at: store.now(), runs: snap.runs.length, from: 'ba_*' }, MarkerSchema);
  return report('imported', { runs: snap.runs.length, achievements: snap.achievements.length, worlds: worlds.length, bests: Object.keys(bests).length });
}
