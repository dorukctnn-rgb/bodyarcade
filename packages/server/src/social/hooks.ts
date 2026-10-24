// What live play (builder N's Rooms) asks of the social module, through the seams in ../live/hooks.ts.
//
// The hooks run in the Worker (the room routes) and in the Room objects, which hold no social tables: each one is a call to the
// SocialDirectory object (ops.ts has the other side). Every hook checks that the Worker has the SOCIAL binding. Without it (the
// live play test Worker, a local run of live play alone) each hook does nothing and verifyPlayer falls back to the anonymous
// identity live play uses on its own, so the two modules stay independent.
import { lobbyGroupOf } from '../../../core/social/age.ts';
import { checkName } from '../../../core/net/chat-filter.ts';
import { AUTH_HEADER, AUTH_QUERY } from '../../../core/social/sign.ts';
import type { AgeBand, RoomSummary } from '../../../core/types/net.ts';
import { HttpError, isRecord } from '../http.ts';
import { setLiveHooks, type LiveHooks, type LivePlayer, type RoomReport } from '../live/hooks.ts';
import type { LiveEnv } from '../live/env.ts';
import { directoryOf, hasSocial, INTERNAL_HOST } from './env.ts';
import type { OpName } from './ops.ts';

const AGES: readonly AgeBand[] = ['child', 'teen', 'adult'];
const PID_RE = /^[A-Za-z0-9_-]{8,64}$/;

const raw = (env: LiveEnv): Record<string, unknown> => env as unknown as Record<string, unknown>;

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

/**
 * One call to the directory. The answer is `{ok: true, value}`, or `{ok: false, status, code, extra?}`, which is thrown as the
 * HttpError the room routes know how to answer. A directory that cannot be reached is a 503 `unavailable` (a hook that fails
 * never breaks a match: the Room catches, logs and carries on).
 */
export async function callOp<T>(env: LiveEnv, op: OpName, input: Record<string, unknown>): Promise<T> {
  let out: unknown;
  try {
    const res = await directoryOf(raw(env)).fetch(new Request(`https://${INTERNAL_HOST}/op/${op}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    }));
    out = await res.json();
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(503, 'unavailable');
  }
  if (!isRecord(out)) throw new HttpError(503, 'unavailable');
  if (out.ok === true) return out.value as T;
  throw new HttpError(typeof out.status === 'number' ? out.status : 500, typeof out.code === 'string' ? out.code : 'internal', isRecord(out.extra) ? out.extra : undefined);
}

export const socialHooks: LiveHooks = {
  /** Signed device requests and the stored profile: the name, the band and the mute come from the profile, never from the body. */
  async verifyPlayer(req: Request, env: LiveEnv, body: Record<string, unknown>): Promise<LivePlayer | null> {
    if (!hasSocial(raw(env))) return anonymousPlayer(body);
    const auth = req.headers.get(AUTH_HEADER) ?? new URL(req.url).searchParams.get(AUTH_QUERY);
    return callOp<LivePlayer>(env, 'verify', { method: req.method, url: req.url, auth, body });
  },

  async gateJoin(env: LiveEnv, summary: RoomSummary, player: LivePlayer): Promise<boolean> {
    if (!hasSocial(raw(env))) return true;
    return callOp<boolean>(env, 'gate', { summary: { code: summary.code, audience: summary.audience }, pid: player.pid });
  },

  async publishRoom(env: LiveEnv, summary: RoomSummary, pids: string[]): Promise<void> {
    if (!hasSocial(raw(env))) return;
    await callOp(env, 'publish', { summary, pids });
  },

  async removeRoom(env: LiveEnv, code: string): Promise<void> {
    if (!hasSocial(raw(env))) return;
    await callOp(env, 'remove', { code });
  },

  async setPlaying(env: LiveEnv, ev: { code: string; pid: string; inRoom: boolean; playing: boolean; gameId: string }): Promise<void> {
    if (!hasSocial(raw(env))) return;
    await callOp(env, 'playing', ev);
  },

  async submitReport(env: LiveEnv, r: RoomReport): Promise<void> {
    if (!hasSocial(raw(env))) return;
    await callOp(env, 'report', { ...r });
  },

  async blockByPid(env: LiveEnv, pid: string, targetPid: string): Promise<void> {
    if (!hasSocial(raw(env)) || pid === targetPid) return;
    await callOp(env, 'block', { pid, targetPid });
  },
};

/** The group a public room of a band belongs to ('teen' or 'adult'; null for children, who have none). */
export const groupOf = lobbyGroupOf;

/** Registers the hooks with live play (called once, from the Worker entry). */
export function installSocialHooks(): void {
  setLiveHooks(socialHooks);
}
