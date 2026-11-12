// The HTTP door of duel links: POST /api/rooms with duel: true makes a private room of two whatever size was asked, and a call
// without a profile's signature is a guest there (making the room or joining it), while every other room still asks the social
// module who is calling. A guest is never a child.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JoinGrant, RoomPreview } from '../../../core/types/net.ts';
import { AUTH_HEADER } from '../../../core/social/sign.ts';
import type { DurableObjectNamespaceLike, Fetcher } from '../cf.ts';
import { Router } from '../router.ts';
import { clearLiveHooks, setLiveHooks, type LivePlayer } from './hooks.ts';
import { resetLimits } from './limits.ts';
import { registerLiveRoutes } from './routes.ts';
import { RoomEngine, type InitInput } from './room-engine.ts';
import { FakeHost, decodeTicketForTest } from './testkit.ts';
import type { LiveEnv } from './env.ts';

const SECRET = 'unit-test-ticket-secret-0123456789abcdef';

class FakeRooms implements DurableObjectNamespaceLike {
  readonly engines = new Map<string, Promise<RoomEngine>>();
  idFromName(name: string) { return { toString: () => name, name }; }
  get(id: { name?: string; toString(): string }): Fetcher {
    const name = id.name ?? id.toString();
    const engine = (): Promise<RoomEngine> => {
      let e = this.engines.get(name);
      if (!e) { e = RoomEngine.create(new FakeHost()); this.engines.set(name, e); }
      return e;
    };
    return {
      fetch: async (req: Request | string): Promise<Response> => {
        const r = typeof req === 'string' ? new Request(req) : req;
        const e = await engine();
        const path = new URL(r.url).pathname;
        if (path === '/init') { const res = e.init((await r.json()) as InitInput); return Response.json(res, { status: res.ok ? 200 : res.error === 'exists' ? 409 : 400 }); }
        if (path === '/preview') { const p = e.preview(); return p ? Response.json(p) : Response.json({ error: 'no_room' }, { status: 404 }); }
        if (path === '/summary') { const s = e.summary(); return s ? Response.json(s) : Response.json({ error: 'no_room' }, { status: 404 }); }
        if (path === '/check') { const c = e.check((await r.json()) as { p: string; a: 'child' | 'teen' | 'adult'; k: string }); return Response.json(c, { status: c.ok ? 200 : 403 }); }
        return new Response('not found', { status: 404 });
      },
    };
  }
}

let router: Router;
let env: LiveEnv;
const ctx = { waitUntil: () => undefined };
/** The identities the social module vouched for (a signed call), and how many calls it was asked about. */
let verified: number;

beforeEach(() => {
  router = new Router();
  registerLiveRoutes(router);
  env = { ROOMS: new FakeRooms(), TICKET_SECRET: SECRET, PUBLIC_ORIGIN: 'https://bodyarcade.test' };
  clearLiveHooks();
  resetLimits();
  verified = 0;
  // the production social module: a signed call is a profile, an unsigned one is nobody (no SOCIAL_ALLOW_UNSIGNED bridge)
  setLiveHooks({
    verifyPlayer: async (req: Request): Promise<LivePlayer | null> => {
      verified++;
      return req.headers.get(AUTH_HEADER) ? { pid: 'profile-of-ada-001', name: 'Ada', age: 'adult' } : null;
    },
  });
});
afterEach(() => { clearLiveHooks(); });

const guest = { pid: 'guest-device-00001', name: 'Swift Otter', age: 'teen' };
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  router.handle(new Request(`http://site${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4', ...headers }, body: JSON.stringify(body) }), env as unknown as Record<string, unknown>, ctx);
const get = (path: string) => router.handle(new Request(`http://site${path}`, { headers: { 'CF-Connecting-IP': '1.2.3.4' } }), env as unknown as Record<string, unknown>, ctx);

describe('duel links over HTTP', () => {
  it('a guest makes a duel room: two seats whatever size was asked, the preview says duel, the ticket is the guest\'s', async () => {
    const res = await post('/api/rooms', { gameId: 'star-catch', duel: true, size: 4, ...guest });
    expect(res?.status).toBe(201);
    const g = (await res?.json()) as JoinGrant;
    expect(g.room).toMatchObject({ kind: 'private', size: 2, duel: true, gameId: 'star-catch' });
    expect(await decodeTicketForTest(SECRET, g.ticket, g.code)).toMatchObject({ p: guest.pid, n: 'Swift Otter', a: 'teen' });
    expect(verified).toBe(0);
    const pv = (await (await get(`/api/rooms/${g.code}`))?.json()) as RoomPreview;
    expect(pv.duel).toBe(true);
  });

  it('a guest joins a duel room by its link; the same guest is turned away from an ordinary room', async () => {
    const made = (await (await post('/api/rooms', { gameId: 'star-catch', duel: true }, { [AUTH_HEADER]: 'signed-by-ada' }))?.json()) as JoinGrant;
    expect(await decodeTicketForTest(SECRET, made.ticket, made.code)).toMatchObject({ p: 'profile-of-ada-001', n: 'Ada' });
    const join = await post(`/api/rooms/${made.code}/join`, guest);
    expect(join?.status).toBe(200);
    const g = (await join?.json()) as JoinGrant;
    expect(await decodeTicketForTest(SECRET, g.ticket, g.code)).toMatchObject({ p: guest.pid, a: 'teen' });

    const plain = (await (await post('/api/rooms', { gameId: 'star-catch' }, { [AUTH_HEADER]: 'signed-by-ada' }))?.json()) as JoinGrant;
    expect(plain.room.duel).toBeUndefined();
    const refused = await post(`/api/rooms/${plain.code}/join`, guest);
    expect(refused?.status).toBe(401);
    expect((await post('/api/rooms', { gameId: 'star-catch', ...guest }))?.status).toBe(401);
  });

  it('a signed call to a duel room is the profile\'s, never the body\'s say-so', async () => {
    const made = (await (await post('/api/rooms', { gameId: 'star-catch', duel: true }, { [AUTH_HEADER]: 'signed' }))?.json()) as JoinGrant;
    const join = await post(`/api/rooms/${made.code}/join`, guest, { [AUTH_HEADER]: 'signed' });
    const g = (await join?.json()) as JoinGrant;
    expect(await decodeTicketForTest(SECRET, g.ticket, g.code)).toMatchObject({ p: 'profile-of-ada-001' });
    expect(verified).toBe(2);
  });

  it('a guest who says under 16 is not let in, and a duel room cannot be public', async () => {
    const kid = { ...guest, age: 'child' };
    const a = await post('/api/rooms', { gameId: 'star-catch', duel: true, ...kid });
    expect([a?.status, ((await a?.json()) as { error: string }).error]).toEqual([403, 'age_not_allowed']);
    const made = (await (await post('/api/rooms', { gameId: 'star-catch', duel: true, ...guest }))?.json()) as JoinGrant;
    const b = await post(`/api/rooms/${made.code}/join`, { ...kid, pid: 'kid-device-000001' });
    expect([b?.status, ((await b?.json()) as { error: string }).error]).toEqual([403, 'age_not_allowed']);
    const c = await post('/api/rooms', { gameId: 'star-catch', duel: true, kind: 'public', band: 'easy', ...guest });
    expect([c?.status, ((await c?.json()) as { error: string }).error]).toEqual([400, 'bad_kind']);
    const d = await post('/api/rooms', { gameId: 'star-catch', duel: 'yes', ...guest });
    expect(d?.status).toBe(400);
  });

  it('a guest who joins a room that is not there hears no_room', async () => {
    const res = await post('/api/rooms/ZZZZZZ/join', guest);
    expect([res?.status, ((await res?.json()) as { error: string }).error]).toEqual([404, 'no_room']);
  });

  it('a third guest finds the duel full', async () => {
    const made = (await (await post('/api/rooms', { gameId: 'star-catch', duel: true, ...guest }))?.json()) as JoinGrant;
    // the creator's ticket does not seat the creator until the socket says hello: two more tickets are fine at the door,
    // the Room seats two and closes the third socket with "full" (room-engine duel tests)
    expect((await post(`/api/rooms/${made.code}/join`, { ...guest, pid: 'guest-device-00002' }))?.status).toBe(200);
  });
});
