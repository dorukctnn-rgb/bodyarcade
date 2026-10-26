// The recordings a player keeps on this device (builder N): the best own run of each game and length, and the friends' recordings
// saved from matches played together or opened from a code. Small (a recording is about 50 bytes, an own one with a skeleton about
// 15 KB), read with every field checked, and written with whatever store the page gives (localStorage with a memory fallback by
// default, see identity.ts), so a full or blocked store loses nothing but the saving.
import { browserStore, type KeyValueStore } from './identity.ts';
import { checkRun, runScore, type GhostRun } from './ghost.ts';
import { decide } from './schedule.ts';

const KEY = 'ba.ghosts.v1';
/** Own bests kept (one per game and length); the oldest go first. */
export const OWN_MAX = 40;
/** Friends' recordings kept; the oldest go first. */
export const FRIENDS_MAX = 24;

export type OfferResult = 'best' | 'kept' | 'invalid';

interface Saved { v: 1; own: GhostRun[]; friends: GhostRun[] }

const sameRun = (a: GhostRun, b: GhostRun): boolean => a.gameId === b.gameId && a.seed === b.seed && a.durationMs === b.durationMs && a.name === b.name && a.outcomes === b.outcomes;
const slot = (r: Pick<GhostRun, 'gameId' | 'durationMs'>): string => `${r.gameId}:${r.durationMs}`;

export class GhostBook {
  private readonly store: KeyValueStore;
  private own: GhostRun[] = [];
  private fr: GhostRun[] = [];

  constructor(store: KeyValueStore = browserStore) {
    this.store = store;
    this.load();
  }

  private load(): void {
    let raw: string | null = null;
    try { raw = this.store.get(KEY); } catch { raw = null; }
    if (!raw) return;
    try {
      const o = JSON.parse(raw) as Partial<Saved>;
      const take = (list: unknown, source: GhostRun['source']): GhostRun[] => {
        if (!Array.isArray(list)) return [];
        const out: GhostRun[] = [];
        for (const x of list) { const c = checkRun(x); if (c.ok && c.run.source === source) out.push(c.run); }
        return out;
      };
      this.own = take(o.own, 'own');
      this.fr = take(o.friends, 'friend');
    } catch { /* damaged: start again, the old text is overwritten by the next save */ }
  }

  private save(): void {
    const data: Saved = { v: 1, own: this.own, friends: this.fr };
    try { this.store.set(KEY, JSON.stringify(data)); } catch { /* the store is full or blocked: the book keeps going in memory */ }
  }

  /** Your best run of this game and length, or null. */
  best(gameId: string, durationMs: number): GhostRun | null {
    return this.own.find((r) => r.gameId === gameId && r.durationMs === durationMs) ?? null;
  }

  /** Every own best, newest first. */
  bests(): GhostRun[] { return [...this.own].sort((a, b) => b.at - a.at); }

  /**
   * An own run as it ended. It becomes the best of its game and length when it beats the best there is (score, then fewer hits, then
   * the longer streak; a tie keeps the older one). 'best': it is the new best. 'kept': the old one stays. 'invalid': not a recording.
   */
  offer(run: GhostRun): OfferResult {
    const c = checkRun({ ...run, source: 'own' });
    if (!c.ok) return 'invalid';
    const mine = c.run;
    const i = this.own.findIndex((r) => slot(r) === slot(mine));
    if (i >= 0) {
      if (decide(runScore(mine), runScore(this.own[i] as GhostRun)) <= 0) return 'kept';
      this.own[i] = mine;
    } else {
      this.own.push(mine);
      if (this.own.length > OWN_MAX) { this.own.sort((a, b) => b.at - a.at); this.own.length = OWN_MAX; }
    }
    this.save();
    return 'best';
  }

  /** The friends' recordings, newest first (those of one game when it is given). */
  friends(gameId?: string): GhostRun[] {
    return this.fr.filter((r) => gameId === undefined || r.gameId === gameId).sort((a, b) => b.at - a.at);
  }

  /** Saves a friend's recording (from a match played together or a code). False when it is not a recording or is already kept. */
  addFriend(run: GhostRun): boolean {
    const c = checkRun({ ...run, source: 'friend', track: undefined });
    if (!c.ok) return false;
    if (this.fr.some((r) => sameRun(r, c.run))) return false;
    this.fr.push(c.run);
    if (this.fr.length > FRIENDS_MAX) { this.fr.sort((a, b) => b.at - a.at); this.fr.length = FRIENDS_MAX; }
    this.save();
    return true;
  }

  removeFriend(run: GhostRun): boolean {
    const n = this.fr.length;
    this.fr = this.fr.filter((r) => !sameRun(r, run));
    if (this.fr.length === n) return false;
    this.save();
    return true;
  }

  /** Forgets everything (the player erased their data). */
  clear(): void {
    this.own = [];
    this.fr = [];
    this.save();
  }
}
