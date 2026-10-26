// The Room's view of a race, for the game that plays it (duel.ts) and for the stage that shows it: what the match is, what
// time it is, and what phase it is in, all read from the LiveClient. Nothing is stored here that the client does not hold,
// except the results the Room already had for this player when the page joined (a reload in the middle of a match).
import type { LiveClient } from '../../../core/net/client.ts';
import type { MemberInfo, MatchInfo, MatchResult, ObstacleResult, SeatId } from '../../../core/types/net.ts';
import type { Unsubscribe } from '../../../core/types/index.ts';
import type { DuelFeed } from './duel.ts';

/** One rival as the HUD shows them while the race runs. */
export interface Rival { seat: SeatId; name: string; score: number }

export interface LiveFeed extends DuelFeed {
  /** The rivals with their latest score, in seat order. */
  rivals(): Rival[];
  /** Calls back when a rival's score changes. */
  onRivals(cb: (r: Rival[]) => void): Unsubscribe;
  /** The result of the match once the Room has it, else null. */
  result(): MatchResult | null;
  dispose(): void;
}

export type DuelPhase = ReturnType<DuelFeed['phase']>;

/** The phase of a match from the Room's numbers and the (server) time. Pure, so it can be tested without a client. */
export function phaseOf(m: Pick<MatchInfo, 'phase' | 'startAt' | 'pauseTotal' | 'resumeAt'> | null, serverNow: number): DuelPhase {
  if (!m) return 'wait';
  if (m.phase === 'settling' || m.phase === 'over') return 'over';
  if (m.phase === 'paused') return 'hold';
  if (serverNow < m.startAt + m.pauseTotal) return 'count';
  if (m.resumeAt !== null && serverNow < m.resumeAt) return 'count';
  return 'run';
}

export function liveFeed(c: LiveClient): LiveFeed {
  let rejoin: { id: string; results: ObstacleResult[] } | null = null;
  let result: MatchResult | null = null;
  const scores = new Map<SeatId, number>();
  const cbs = new Set<(r: Rival[]) => void>();
  let lastKey = '';

  const names = (): Map<SeatId, string> => new Map(c.members.map((m: MemberInfo) => [m.seat, m.name]));
  const rivals = (): Rival[] => {
    const n = names();
    const seats = c.match ? c.match.seats : c.members.map((m) => m.seat);
    return seats.filter((s) => s !== c.you && !(c.match?.forfeited.includes(s))).map((seat) => ({ seat, name: n.get(seat) ?? '', score: scores.get(seat) ?? 0 }));
  };
  const changed = (): void => {
    const list = rivals();
    const key = list.map((r) => `${r.seat}:${r.name}:${r.score}`).join('|');
    if (key === lastKey) return;
    lastKey = key;
    for (const cb of [...cbs]) cb(list);
  };

  const offs: Unsubscribe[] = [
    c.on('match', (d) => {
      if (d.why === 'start') { result = null; scores.clear(); }
      rejoin = { id: d.match.id, results: d.mine.map((e) => ({ ob: e.ob, k: e.k })) };
      changed();
    }),
    c.on('result', (r) => { result = r; for (const [seat, s] of Object.entries(r.scores)) scores.set(seat, s.score); changed(); }),
    c.on('presence', () => changed()),
    c.on('forfeit', () => changed()),
    c.on('state', (s) => {
      const d = s.d as { sc?: unknown } | null;
      if (d && typeof d.sc === 'number' && Number.isFinite(d.sc)) { scores.set(s.from, d.sc); changed(); }
    }),
  ];

  return {
    match() {
      const m = c.match;
      if (!m || m.phase === 'over' || !c.playing) return null;
      return { id: m.id, seed: m.seed, durationMs: m.duration, gameId: m.gameId, results: rejoin && rejoin.id === m.id ? rejoin.results : [] };
    },
    time: () => c.matchTime(),
    phase: () => phaseOf(c.match, c.serverNow()),
    report: (ob, k) => c.reportResult(ob, k),
    finish: (results) => c.finish(results),
    state: (d) => c.sendState(d),
    rivals,
    onRivals(cb) { cbs.add(cb); return () => { cbs.delete(cb); }; },
    result: () => result,
    dispose() { for (const off of offs.splice(0)) off(); cbs.clear(); },
  };
}
