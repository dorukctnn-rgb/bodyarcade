// What live play (builder N's Rooms) asks of the social module, through the seams in ../live/hooks.ts.
//
// Every hook checks that the Worker has the social bindings (DB and HUB). Without them (the live play test Worker, a local
// run of live play alone) each hook does nothing and verifyPlayer falls back to the anonymous identity live play uses on its own,
// so the two modules stay independent.
import { lobbyGroupOf } from '../../../core/social/age.ts';
import { checkName } from '../../../core/net/chat-filter.ts';
import { LIMITS, MAX_BLOCKS } from '../../../core/social/rules.ts';
import type { AgeBand, RoomSummary } from '../../../core/types/net.ts';
import { HttpError } from '../http.ts';
import { setLiveHooks, type LiveHooks, type LivePlayer, type RoomReport } from '../live/hooks.ts';
import type { LiveEnv } from '../live/env.ts';
import { authenticate } from './auth.ts';
import { one, rows } from './db.ts';
import { hasSocial, type SocialEnv } from './env.ts';
import { bump, used } from './limits.ts';
import { mayJoinPublic, publishRoomChange, removeRoom } from './lobbies.ts';
import { fileReport } from './moderation.ts';
import { blockPlayer, byPid } from './people.ts';
import { hubSend, pushPresence, setRoomState } from './presence.ts';

const AGES: readonly AgeBand[] = ['child', 'teen', 'adult'];
const PID_RE = /^[A-Za-z0-9_-]{8,64}$/;

function social(env: LiveEnv): SocialEnv | null {
  return hasSocial(env as unknown as Record<string, unknown>) ? (env as unknown as SocialEnv) : null;
}

/** The anonymous identity live play accepts when this module is not bound: same checks as the live routes make. */
export function anonymousPlayer(body: Record<string, unknown>): LivePlayer {
  const pid = body.pid;
  if (typeof pid !== 'string' || !PID_RE.test(pid)) throw new HttpError(400, 'bad_pid');
  const age = body.age;
  if (typeof age !== 'string' || !AGES.includes(age as AgeBand)) throw new HttpError(400, 'bad_age');
  const name = checkName(typeof body.name === 'string' ? body.name : '');
  if (!name.ok) throw new HttpError(400, 'bad_name', { reason: name.reason });
  return { pid, name: name.text, age: age as AgeBand };
}

export const socialHooks: LiveHooks = {
  /** Signed device requests and the stored profile: the name, the band and the mute come from the profile, never from the body. */
  async verifyPlayer(req: Request, env: LiveEnv, body: Record<string, unknown>): Promise<LivePlayer | null> {
    const s = social(env);
    if (!s) return anonymousPlayer(body);
    const now = Date.now();
    const pending: Promise<unknown>[] = [];
    try {
      const me = await authenticate({ req, db: s.DB, now, wait: (p) => { pending.push(p); } }, body);
      await Promise.allSettled(pending);
      // A player suspended from public lobbies cannot open a public room either (joining one is refused by gateJoin).
      if (me.publicBlockedUntil > now && body.kind === 'public' && new URL(req.url).pathname === '/api/rooms') {
        throw new HttpError(403, 'public_suspended', { until: me.publicBlockedUntil });
      }
      return { pid: me.pid, name: me.name, age: me.band, ...(me.mutedUntil > now ? { mutedUntil: me.mutedUntil } : {}) };
    } catch (e) {
      if (e instanceof HttpError) throw new HttpError(e.status, e.code, { serverTime: Date.now(), ...e.extra });
      throw e;
    }
  },

  async gateJoin(env: LiveEnv, summary: RoomSummary, player: LivePlayer): Promise<boolean> {
    const s = social(env);
    if (!s) return true;
    return mayJoinPublic(s.DB, summary, player.pid, Date.now());
  },

  async publishRoom(env: LiveEnv, summary: RoomSummary, pids: string[]): Promise<void> {
    const s = social(env);
    if (!s) return;
    const now = Date.now();
    const r = await publishRoomChange(s.DB, summary, pids, now);
    // The Room reports "a player is in this room" (setPlaying) and "this is the room" (here) separately, in either order. A
    // friend's list shows the room code only while the lobby row says the room can be joined, so when that changes the
    // friends of the members who are already marked as being in the room hear the new picture, whichever report came last
    // (a member the presence report has not reached yet is told by that report).
    if (r.joinabilityChanged) {
      const members = await rows<{ pid: string }>(s.DB, 'SELECT pid FROM soc_presence WHERE room = ?1 AND pid IN (SELECT value FROM json_each(?2))', summary.code, JSON.stringify(pids.slice(0, 4)));
      await Promise.all(members.map((m) => pushPresence(s, m.pid, now)));
    }
  },

  async removeRoom(env: LiveEnv, code: string): Promise<void> {
    const s = social(env);
    if (s) await removeRoom(s.DB, code);
  },

  async setPlaying(env: LiveEnv, ev: { code: string; pid: string; inRoom: boolean; playing: boolean; gameId: string }): Promise<void> {
    const s = social(env);
    if (!s) return;
    const now = Date.now();
    const changed = ev.inRoom
      ? await setRoomState(s.DB, ev.pid, null, { room: ev.code, state: ev.playing ? 'playing' : 'lobby', game: ev.gameId }, now)
      : await setRoomState(s.DB, ev.pid, ev.code, null, now);
    if (changed) await pushPresence(s, ev.pid, now);
  },

  async submitReport(env: LiveEnv, r: RoomReport): Promise<void> {
    const s = social(env);
    if (!s) return;
    const now = Date.now();
    if ((await used(s.DB, r.reporterPid, LIMITS.report, now)) >= LIMITS.report.max) return;
    await bump(s.DB, r.reporterPid, LIMITS.report, now);
    await fileReport(s.DB, {
      reporter: r.reporterPid, target: r.targetPid, reason: r.reason, source: 'room', room: r.code, matchId: r.matchId,
      evidence: r.chat, at: Math.min(r.at, now),
    });
  },

  async blockByPid(env: LiveEnv, pid: string, targetPid: string): Promise<void> {
    const s = social(env);
    if (!s || pid === targetPid) return;
    const [me, target] = await Promise.all([byPid(s.DB, pid), byPid(s.DB, targetPid)]);
    if (!me || !target) return;
    const n = await one<{ n: number }>(s.DB, 'SELECT COUNT(*) AS n FROM soc_blocks WHERE pid = ?1', pid);
    if ((n?.n ?? 0) >= MAX_BLOCKS) return;
    const { wasFriends } = await blockPlayer(s.DB, pid, targetPid, Date.now());
    if (wasFriends) await hubSend(s, targetPid, { t: 'friend_removed', fid: me.fid });
  },
};

/** The group a public room of a band belongs to ('teen' or 'adult'; null for children, who have none). */
export const groupOf = lobbyGroupOf;

/** Registers the hooks with live play (called once, from the Worker entry). */
export function installSocialHooks(): void {
  setLiveHooks(socialHooks);
}
