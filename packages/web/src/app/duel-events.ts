// What happens in duel links, as events for the rest of the app (sprint arm E). Arm F's daily tasks and badges ("win a duel", "duel a
// friend three days in a row") listen here instead of reaching into the room code:
//
//   import { onDuel } from './duel-events.ts';
//   const off = onDuel((e) => { if (e.type === 'duel.finished' && e.won) tasks.mark('duel-win'); });
//
// The same events go out on the window as a DOM CustomEvent named 'bodyarcade:duel' (detail: the event), for code that has no import
// path to this file. Nothing here is sent anywhere: the events stay on the page.
import type { LiveClient } from '../../../core/net/client.ts';
import type { MatchResult } from '../../../core/types/net.ts';
import type { Unsubscribe } from '../../../core/types/index.ts';
import type { RoomPort } from '../social/port.ts';

interface DuelBase {
  /** The code of the duel room. */
  room: string;
  gameId: string;
  /** How the duel is played: a race over the game's course, or a score duel. */
  mode: 'race' | 'score';
  /** The player is in it as a guest (no profile). */
  guest: boolean;
  /** Epoch ms of the page. */
  at: number;
}

export type DuelEvent =
  /** The player made a duel link (from a game's page, or for a friend: `friend` is the friend's id). */
  | (DuelBase & { type: 'duel.created'; friend?: string })
  /** The player is in a duel room (made it or opened a link), once per room. */
  | (DuelBase & { type: 'duel.joined'; host: boolean })
  /** A round of the duel started on both screens; `round` counts from 1 (2 is the first rematch). */
  | (DuelBase & { type: 'duel.started'; match: string; round: number })
  /** A round ended. `won` is null for a draw or a round that did not count; `you` and `rival` are the Room's points. */
  | (DuelBase & {
    type: 'duel.finished'; match: string; round: number; won: boolean | null; you: number; rival: number;
    reason: MatchResult['reason']; rivalName: string;
  });

export type DuelEventType = DuelEvent['type'];

const listeners = new Set<(e: DuelEvent) => void>();

/** Listens to every duel event of this page; returns the way to stop. */
export function onDuel(cb: (e: DuelEvent) => void): Unsubscribe {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** Sends a duel event to the listeners and the window. A listener that throws never breaks the duel. */
export function emitDuel(e: DuelEvent, win: (EventTarget & { CustomEvent?: typeof CustomEvent }) | null = typeof window === 'undefined' ? null : window): void {
  for (const cb of [...listeners]) { try { cb(e); } catch (err) { console.error(err); } }
  try {
    const Ctor = win?.CustomEvent ?? (typeof CustomEvent === 'undefined' ? undefined : CustomEvent);
    if (win && Ctor) win.dispatchEvent(new Ctor('bodyarcade:duel', { detail: e }));
  } catch { /* no DOM events here */ }
}

/** The result of a round, from where one seat sits: won, lost (false), or null for a draw or a round that did not count. */
export function verdictOf(r: MatchResult, you: string | null): boolean | null {
  if (!you || r.reason === 'abandoned' || r.reason === 'no_contest' || r.winner === null) return null;
  return r.winner === you;
}

/**
 * Watches the room port for duel rooms and sends 'duel.joined', 'duel.started' and 'duel.finished' (the page that makes a link sends
 * 'duel.created' itself). Returns the way to stop.
 */
export function watchDuels(rooms: Pick<RoomPort, 'state' | 'subscribe' | 'client'>, now: () => number = Date.now): Unsubscribe {
  let client: LiveClient | null = null;
  let offs: Unsubscribe[] = [];
  let joined = '';
  let round = 0;
  let started = '';
  let finished = '';

  const base = (c: LiveClient): DuelBase | null => {
    const info = c.room;
    if (!info?.duel) return null;
    return { room: info.code, gameId: c.match?.gameId ?? info.config.gameId, mode: c.match?.mode === 'score' ? 'score' : c.match ? 'race' : info.duel.mode, guest: rooms.state().guest === true, at: now() };
  };

  const watch = (c: LiveClient): void => {
    for (const off of offs.splice(0)) off();
    client = c;
    round = 0;
    offs.push(
      c.on('match', (d) => {
        const b = base(c);
        if (!b || d.match.id === started || !c.playing) return;
        started = d.match.id;
        round++;
        emitDuel({ ...b, type: 'duel.started', match: d.match.id, round });
      }),
      c.on('result', (r) => {
        const b = base(c);
        if (!b || r.mid === finished || r.mid !== started) return;
        finished = r.mid;
        const you = c.you;
        const rival = Object.keys(r.scores).find((s) => s !== you) ?? null;
        emitDuel({
          ...b, type: 'duel.finished', match: r.mid, round, won: verdictOf(r, you), you: you ? r.scores[you]?.score ?? 0 : 0, rival: rival ? r.scores[rival]?.score ?? 0 : 0,
          reason: r.reason, rivalName: rival ? c.members.find((m) => m.seat === rival)?.name ?? '' : '',
        });
      }),
    );
  };

  const check = (): void => {
    const c = rooms.client?.() ?? null;
    if (c !== client) { if (c) watch(c); else { for (const off of offs.splice(0)) off(); client = null; } }
    const st = rooms.state();
    const info = st.info;
    if (c && info?.duel && (st.phase === 'lobby' || st.phase === 'playing') && joined !== info.code) {
      joined = info.code;
      const host = st.members.find((m) => m.seat === st.me)?.host === true;
      const b = base(c);
      if (b) emitDuel({ ...b, type: 'duel.joined', host });
    }
  };

  const off = rooms.subscribe(check);
  check();
  return () => { off(); for (const o of offs.splice(0)) o(); client = null; };
}
