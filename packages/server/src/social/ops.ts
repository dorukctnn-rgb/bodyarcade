// What live play (the Room objects and the Worker's room routes) asks of the social module, as calls to the directory.
//
// Live play reaches the module through seven hooks (live/hooks.ts, installed by hooks.ts). Each is one call to the SocialDirectory
// object, `POST https://directory.internal/op/<name>` with a JSON input, answered `{ok: true, value}` or `{ok: false, status, code,
// extra?}`: the work runs where the tables are, in one object, with no further call. This file is the object's side (the
// operations themselves and the answer format); hooks.ts is the caller's side.
import { HttpError, isRecord, json } from '../http.ts';
import type { RoomSummary } from '../../../core/types/net.ts';
import { LIMITS, MAX_BLOCKS } from '../../../core/social/rules.ts';
import { AUTH_HEADER } from '../../../core/social/sign.ts';
import type { LivePlayer, RoomReport } from '../live/hooks.ts';
import { authenticate } from './auth.ts';
import { one, rows } from './db.ts';
import type { SocialEnv } from './env.ts';
import { bump, used } from './limits.ts';
import { mayJoinPublic, publishRoomChange, removeRoom } from './lobbies.ts';
import { fileReport } from './moderation.ts';
import { blockPlayer, byPid } from './people.ts';
import { hubSend, pushPresence, setRoomState } from './presence.ts';

export const OP_NAMES = ['verify', 'gate', 'publish', 'remove', 'playing', 'report', 'block'] as const;
export type OpName = typeof OP_NAMES[number];

export interface OpContext {
  env: SocialEnv;
  now: number;
  /** Runs `p` after the answer is sent; errors are logged, never thrown. */
  wait(p: Promise<unknown>): void;
}

type Input = Record<string, unknown>;

const str = (v: unknown, field: string): string => {
  if (typeof v !== 'string') throw new HttpError(400, 'bad_request', { field });
  return v;
};
const record = (v: unknown, field: string): Input => {
  if (!isRecord(v)) throw new HttpError(400, 'bad_request', { field });
  return v;
};

/**
 * `verify`: who is calling a room route. The request's signature is checked against the stored device (the caller sends what the
 * signature covers: the method, the full address, the header, the parsed body), and the name, the band and the mute come from the
 * stored profile, never from the body. A player suspended from public lobbies cannot open a public room either.
 */
async function verify(c: OpContext, input: Input): Promise<LivePlayer> {
  const url = str(input.url, 'url');
  const method = str(input.method, 'method');
  const body = record(input.body, 'body');
  const auth = typeof input.auth === 'string' ? input.auth : null;
  const req = new Request(url, { method, headers: auth ? { [AUTH_HEADER]: auth } : {} });
  const pending: Promise<unknown>[] = [];
  const me = await authenticate({ req, db: c.env.DB, now: c.now, wait: (p) => { pending.push(p); } }, body);
  await Promise.allSettled(pending);
  if (me.publicBlockedUntil > c.now && body.kind === 'public' && new URL(url).pathname === '/api/rooms') {
    throw new HttpError(403, 'public_suspended', { until: me.publicBlockedUntil });
  }
  return { pid: me.pid, name: me.name, age: me.band, ...(me.mutedUntil > c.now ? { mutedUntil: me.mutedUntil } : {}) };
}

/** `gate`: may this player take a seat in this public room (age group, suspension, blocks)? */
async function gate(c: OpContext, input: Input): Promise<boolean> {
  const summary = record(input.summary, 'summary');
  const audience = summary.audience === 'teen' || summary.audience === 'adult' ? summary.audience : null;
  return mayJoinPublic(c.env.DB, { code: str(summary.code, 'code'), audience }, str(input.pid, 'pid'), c.now);
}

/**
 * `publish`: a room was created or changed. The Room reports "a player is in this room" (`playing`) and "this is the room"
 * (`publish`) separately, in either order. A friend's list shows the room code only while the lobby row says the room can be
 * joined, so when that changes the friends of the members who are already marked as being in the room hear the new picture,
 * whichever report came last (a member the presence report has not reached yet is told by that report).
 */
async function publish(c: OpContext, input: Input): Promise<null> {
  const summary = record(input.summary, 'summary') as unknown as RoomSummary;
  const pids = Array.isArray(input.pids) ? input.pids.filter((p): p is string => typeof p === 'string') : [];
  const r = await publishRoomChange(c.env.DB, summary, pids, c.now);
  if (r.joinabilityChanged) {
    const members = await rows<{ pid: string }>(c.env.DB, 'SELECT pid FROM soc_presence WHERE room = ?1 AND pid IN (SELECT value FROM json_each(?2))', summary.code, JSON.stringify(pids.slice(0, 4)));
    await Promise.all(members.map((m) => pushPresence(c.env, m.pid, c.now)));
  }
  return null;
}

/** `remove`: the room is gone. */
async function remove(c: OpContext, input: Input): Promise<null> {
  await removeRoom(c.env.DB, str(input.code, 'code'));
  return null;
}

/** `playing`: a player entered or left a room, or started or finished a match. */
async function playing(c: OpContext, input: Input): Promise<null> {
  const code = str(input.code, 'code');
  const pid = str(input.pid, 'pid');
  const changed = input.inRoom === true
    ? await setRoomState(c.env.DB, pid, null, { room: code, state: input.playing === true ? 'playing' : 'lobby', game: str(input.gameId, 'gameId') }, c.now)
    : await setRoomState(c.env.DB, pid, code, null, c.now);
  if (changed) await pushPresence(c.env, pid, c.now);
  return null;
}

/** `report`: a player reported another in a room (the Room's last chat lines are the evidence). */
async function report(c: OpContext, input: Input): Promise<null> {
  const r = input as unknown as RoomReport;
  const reporter = str(r.reporterPid, 'reporterPid');
  if ((await used(c.env.DB, reporter, LIMITS.report, c.now)) >= LIMITS.report.max) return null;
  await bump(c.env.DB, reporter, LIMITS.report, c.now);
  await fileReport(c.env.DB, {
    reporter, target: str(r.targetPid, 'targetPid'), reason: r.reason, source: 'room', room: r.code, matchId: r.matchId,
    evidence: Array.isArray(r.chat) ? r.chat : [], at: Math.min(typeof r.at === 'number' ? r.at : c.now, c.now),
  });
  return null;
}

/** `block`: a player blocked another inside a room: the block goes on their list like any other. */
async function block(c: OpContext, input: Input): Promise<null> {
  const pid = str(input.pid, 'pid');
  const targetPid = str(input.targetPid, 'targetPid');
  if (pid === targetPid) return null;
  const [me, target] = await Promise.all([byPid(c.env.DB, pid), byPid(c.env.DB, targetPid)]);
  if (!me || !target) return null;
  const n = await one<{ n: number }>(c.env.DB, 'SELECT COUNT(*) AS n FROM soc_blocks WHERE pid = ?1', pid);
  if ((n?.n ?? 0) >= MAX_BLOCKS) return null;
  const { wasFriends } = await blockPlayer(c.env.DB, pid, targetPid, c.now);
  if (wasFriends) await hubSend(c.env, targetPid, { t: 'friend_removed', fid: me.fid });
  return null;
}

export const OPS: Readonly<Record<OpName, (c: OpContext, input: Input) => Promise<unknown>>> = { verify, gate, publish, remove, playing, report, block };

export const isOp = (x: string): x is OpName => (OP_NAMES as readonly string[]).includes(x);

/** Runs one operation and writes its answer (the format hooks.ts reads). Never throws. */
export async function runOp(c: OpContext, name: string, input: unknown): Promise<Response> {
  if (!isOp(name)) return json({ ok: false, status: 404, code: 'not_found' }, 404);
  try {
    if (!isRecord(input)) throw new HttpError(400, 'bad_request');
    return json({ ok: true, value: await OPS[name](c, input) });
  } catch (e) {
    // The server's time goes with every refusal, as it does on the social routes: a device whose clock is off learns it from this.
    if (e instanceof HttpError) return json({ ok: false, status: e.status, code: e.code, extra: { serverTime: Date.now(), ...e.extra } });
    console.log(JSON.stringify({ evt: 'social_op_error', op: name, error: String((e as { message?: unknown })?.message ?? e).slice(0, 300) }));
    return json({ ok: false, status: 500, code: 'internal' });
  }
}
