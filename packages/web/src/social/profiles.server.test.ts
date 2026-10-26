// Family profiles and the online identity (the contract of NOTLAR-store.md "AILE PROFILLERI" and the inbox note of NOTLAR-social.md):
// the device has one social identity, the owner's. While a kid's profile plays nothing online runs: the connection is closed, every
// call of the port answers child_no_online and sends no request, no key is made, and the profile of the owner is not shown. The
// owner coming back (through the parent gate) opens the connection again, with the friends and the recovery code where they were.
// The real profile book, the real client and the real routes, in process.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SocialClient, type WebSocketLike } from '../../../core/social/client.ts';
import { MemoryKeyStore } from '../../../core/social/keystore.ts';
import { createProfileBook, watchOnline, type ProfileBook } from '../../../core/store/profiles.ts';
import { memoryStorage } from '../../../core/store/store.ts';
import type { ExecutionContextLike } from '../../../server/src/cf.ts';
import { createTestApp, TEST_ORIGIN, type TestApp } from '../../../server/src/social/testkit.ts';
import { createSocialPort, type SocialPortHandle } from './adapter.ts';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

class IdleWs implements WebSocketLike {
  static opened = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor() { IdleWs.opened++; }
  send(): void { /* the hub is not under test here */ }
  close(): void { /* nothing is open */ }
}

let app: TestApp;
let calls: string[] = [];
const ports: SocialPortHandle[] = [];
beforeEach(() => { app = createTestApp(); calls = []; IdleWs.opened = 0; });
afterEach(() => { for (const p of ports.splice(0)) { p.close(); p.dispose(); } });

function family(): { book: ProfileBook; kidId: string; ownerId: string } {
  const book = createProfileBook({ storage: memoryStorage(), can: () => true, random: () => 0 });
  const ownerId = book.active().id;
  const made = book.create({ name: 'Kid', kid: true });
  if (!made.ok) throw new Error(`no kid profile: ${made.code}`);
  return { book, kidId: made.profile.id, ownerId };
}

/** The way back from a kid's profile: the parent gate (the question is a multiplication). */
function backToOwner(book: ProfileBook, ownerId: string): void {
  const asked = book.gate.ask();
  if (!asked.ok) throw new Error('the gate is closed');
  expect(book.gate.answer(asked.question.id, asked.question.a * asked.question.b)).toMatchObject({ ok: true });
  expect(book.switchTo(ownerId)).toMatchObject({ ok: true });
}

function device(book: ProfileBook, store = new MemoryKeyStore()): { port: SocialPortHandle; client: SocialClient; store: MemoryKeyStore } {
  const pending: Promise<unknown>[] = [];
  const ctx: ExecutionContextLike = { waitUntil: (p) => { pending.push(p); } };
  const net = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const req = new Request(url, init);
    req.headers.set('CF-Connecting-IP', '10.90.0.1');
    calls.push(`${req.method} ${new URL(url).pathname}`);
    const res = await app.router.handle(req, app.env, ctx);
    while (pending.length > 0) await Promise.allSettled(pending.splice(0));
    if (!res) throw new Error(`no route for ${req.method} ${url}`);
    return res;
  };
  const client = new SocialClient({ origin: TEST_ORIGIN, keys: store, fetch: net as typeof fetch, WebSocket: IdleWs as never });
  const port = createSocialPort({ client, age: { tooYoung: () => false, remember: () => undefined }, kidProfile: () => !book.online() });
  ports.push(port);
  return { port, client, store };
}

describe('the owner and a kid on one device', () => {
  it('the connection follows the profile that plays: closed for the kid, open again for the owner, with nothing sent for the kid in between', async () => {
    const { book, kidId, ownerId } = family();
    const { port, client } = device(book);
    const stop = watchOnline(book, { open: () => port.open(), close: () => port.close() });
    await vi.waitFor(() => expect(port.state().status).toBe('ready'));
    const made = await port.createProfile({ band: 'adult', name: 'Mia' });
    expect(made.ok).toBe(true);
    expect(client.hub).toBe('connecting');                                   // the owner is connected (the test socket never opens)
    expect(port.state()).toMatchObject({ profile: { name: 'Mia' }, noOnline: null });

    // the kid plays: the connection is closed, the owner's profile is not shown, and every call is refused without a request
    expect(book.switchTo(kidId)).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(client.hub).toBe('idle'));
    expect(port.state()).toMatchObject({ noOnline: 'kid', profile: null, friends: [], hub: 'idle', recovery: null });
    expect(port.syncPort()).toBeNull();
    calls.length = 0;
    const answers = await Promise.all([
      port.addByCode('BA-7K2Q4X'), port.answer('FRIEND2345', true), port.cancelRequest('FRIEND2345'), port.unfriend('FRIEND2345'), port.block('FRIEND2345'), port.unblock('FRIEND2345'),
      port.report({ fid: 'FRIEND2345', reason: 'abuse', details: '', alsoBlock: false }), port.invite('FRIEND2345', 'ROOM22'), port.lobbies({ game: 'squat-flap', region: 'eu' }),
      port.quickMatch({ game: 'squat-flap', driver: { create: async () => ({ code: 'X' }), join: async () => undefined, leave: async () => undefined }, signal: new AbortController().signal, onProgress: () => undefined }),
      port.leaderboard({ game: 'squat-flap', scope: 'friends', week: 'current' }), port.startRun('squat-flap'), port.finishRun({ run: 'r', game: 'squat-flap', at: 1 }, 1),
      port.updateProfile({ name: 'Zed' }), port.renewCode(), port.renewRecovery(), port.exportData(), port.deleteProfile(), port.createProfile({ band: 'adult', name: 'Kid' }),
      port.recoverProfile({ code: 'BA-7K2Q4X', recovery: '7K2Q-4XMV-ABCD-EFGH' }), port.answerInvite({ id: 'i', from: { fid: 'F', name: 'F' }, room: 'ROOM22', game: 'squat-flap', exp: Date.now() + 1000 }, true),
    ]);
    for (const a of answers) expect(a).toEqual({ ok: false, code: 'child_no_online' });
    port.setStatus('playing', 'squat-flap');
    port.setActive(true);
    port.takeOver();
    expect(calls).toEqual([]);                                                // not one request left the page
    expect(client.hub).toBe('idle');

    // the owner is back (through the gate): the connection opens again and the profile, the friends and the code are where they were
    backToOwner(book, ownerId);
    await vi.waitFor(() => expect(client.hub).toBe('connecting'));
    expect(port.state()).toMatchObject({ profile: { name: 'Mia' }, noOnline: null });
    expect(calls.some((c) => c.startsWith('GET /api/social/me'))).toBe(true);
    stop();
  });

  it('a page that opens on a kid\'s profile never starts the client: no request, no database of keys, no socket', async () => {
    const { book, kidId } = family();
    book.switchTo(kidId);
    const { port, store } = device(book);
    const stop = watchOnline(book, { open: () => port.open(), close: () => port.close() });
    await vi.waitFor(() => expect(port.state()).toMatchObject({ status: 'ready', noOnline: 'kid' }));
    expect(calls).toEqual([]);
    expect(IdleWs.opened).toBe(0);
    expect(await store.load()).toBeNull();
    expect(await port.createProfile({ band: 'adult', name: 'Kid' })).toEqual({ ok: false, code: 'child_no_online' });
    expect(calls).toEqual([]);
    expect(await store.load()).toBeNull();                                    // not even a device key was made
    stop();
  });

  it('a kid\'s profile has no online identity even when the owner never made one: nothing is created behind the owner\'s back', async () => {
    const { book, kidId } = family();
    const { port, store } = device(book);
    await port.open();
    expect(port.state().noOnline).toBeNull();                                 // the owner plays: the sign-up is theirs to start
    book.switchTo(kidId);
    port.recheck();
    expect(port.state().noOnline).toBe('kid');
    expect(await port.createProfile({ band: 'teen', name: null })).toEqual({ ok: false, code: 'child_no_online' });
    expect(await store.load()).toBeNull();
    expect(calls.filter((c) => c.includes('register'))).toEqual([]);
  });
});
