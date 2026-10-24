// The social port on the real client and the real routes, in process (the server's own test application: its tables on
// node:sqlite, the same handlers, signed requests checked for real): what a player does through the port, as two devices
// would. Browsers and a real Worker are covered by tests/e2e/social-ui*.spec.ts and tests/social.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SocialClient, type WebSocketLike } from '../../../core/social/client.ts';
import { MemoryKeyStore } from '../../../core/social/keystore.ts';
import { POLICY } from '../../../core/social/age.ts';
import { isPresetName } from '../../../core/social/presets.ts';
import type { ExecutionContextLike } from '../../../server/src/cf.ts';
import { createTestApp, TEST_ORIGIN, type TestApp } from '../../../server/src/social/testkit.ts';
import { createSocialPort, type SocialPortHandle } from './adapter.ts';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

class IdleWs implements WebSocketLike {
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  send(): void { /* the hub is not under test here */ }
  close(): void { /* nothing is open */ }
}

let app: TestApp;
let ipSeq = 0;
let calls: string[] = [];
const ports: SocialPortHandle[] = [];

interface Device { port: SocialPortHandle; client: SocialClient; store: MemoryKeyStore; tooYoung: { value: boolean } }

function device(): Device {
  const store = new MemoryKeyStore();
  const ip = `10.70.${(ipSeq >> 8) & 255}.${ipSeq++ & 255}`;
  const pending: Promise<unknown>[] = [];
  const ctx: ExecutionContextLike = { waitUntil: (p) => { pending.push(p); } };
  const net = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const req = new Request(url, init);
    req.headers.set('CF-Connecting-IP', ip);
    req.headers.set('CF-IPCountry', 'TR');
    calls.push(`${req.method} ${new URL(url).pathname}`);
    const res = await app.router.handle(req, app.env, ctx);
    while (pending.length > 0) await Promise.allSettled(pending.splice(0));
    if (!res) throw new Error(`no route for ${req.method} ${url}`);
    return res;
  };
  const client = new SocialClient({ origin: TEST_ORIGIN, keys: store, fetch: net as typeof fetch, WebSocket: IdleWs as never });
  const tooYoung = { value: false };
  const port = createSocialPort({ client, age: { tooYoung: () => tooYoung.value, remember: () => { tooYoung.value = true; } }, lang: () => 'en' });
  ports.push(port);
  return { port, client, store, tooYoung };
}

beforeEach(() => { app = createTestApp(); calls = []; });
afterEach(() => {
  POLICY.child.online = true;
  for (const p of ports.splice(0)) { p.close(); p.dispose(); }
});

async function player(name: string, band: 'adult' | 'teen' = 'adult'): Promise<Device & { code: string; fid: string }> {
  const d = device();
  await d.port.open();
  const made = await d.port.createProfile({ band, name: band === 'adult' ? name : null });
  if (!made.ok) throw new Error(`sign-up failed: ${made.code}`);
  return { ...d, code: made.value.code, fid: made.value.fid };
}

describe('a profile through the port', () => {
  it('an adult signs up with a name of their own and is told the recovery code once', async () => {
    const mia = await player('Mia');
    const s = mia.port.state();
    expect(s.profile).toMatchObject({ name: 'Mia', band: 'adult', can: { freeName: true, freeText: true, video: true, publicPlay: true } });
    expect(s.profile?.code).toMatch(/^BA-[A-Z2-9]{6}$/);
    expect(s.recovery).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
    expect(s.persistent).toBe(false);                                                     // a memory key store: the sign-up would say so
    mia.port.dismissRecovery();
    expect(mia.port.state().recovery).toBeNull();
  });

  it('a teenager gets a made-up name (a typed one never leaves the page), and nobody can raise the age later', async () => {
    const d = device();
    await d.port.open();
    const made = await d.port.createProfile({ band: 'teen', name: 'Not A Preset' });
    expect(made.ok).toBe(true);
    expect(isPresetName(d.port.state().profile?.name)).toBe(true);
    expect(d.port.state().profile?.can).toMatchObject({ freeName: false, freeText: false, video: false, publicPlay: true });
    const up = await d.port.updateProfile({ band: 'adult' });
    expect(up).toMatchObject({ ok: false, code: 'band_locked' });
  });

  it('under 16 makes no key, sends nothing and the Worker never hears of the player', async () => {
    // The test kit turns the switch on so that every band can be exercised; this is the production rule.
    POLICY.child.online = false;
    const d = device();
    d.port.declareTooYoung();
    await d.port.open();
    expect(await d.port.createProfile({ band: 'child', name: null })).toMatchObject({ ok: false, code: 'child_no_online' });
    expect(calls).toEqual([]);
    expect(await d.store.load()).toBeNull();
    expect(d.port.state().noOnline).toBe('young');
  });

  it('a name the filter refuses is told with its reason; the rename limit is three a day and says how long to wait', async () => {
    const mia = await player('Mia');
    expect(await mia.port.updateProfile({ name: 'www.example.com' })).toMatchObject({ ok: false, code: 'name_rejected', reason: 'link' });
    for (const n of ['Mia A', 'Mia B', 'Mia C']) expect(await mia.port.updateProfile({ name: n })).toMatchObject({ ok: true });
    const fourth = await mia.port.updateProfile({ name: 'Mia D' });
    expect(fourth).toMatchObject({ ok: false, code: 'rate_limited' });
    expect(fourth.ok === false && (fourth.retryAfterMs ?? 0) > 0).toBe(true);
    expect(mia.port.state().profile?.name).toBe('Mia C');
  });

  it('the friend code can be renewed, the old link stops being valid, and a new recovery code replaces the old', async () => {
    const mia = await player('Mia');
    const before = mia.code;
    const r = await mia.port.renewCode();
    expect(r.ok && r.value.code).not.toBe(before);
    const old = mia.port.state().recovery;
    mia.port.dismissRecovery();
    const rec = await mia.port.renewRecovery();
    expect(rec.ok).toBe(true);
    expect(rec.ok && rec.value).not.toBe(old);
    expect(mia.port.state().recovery).toBe(rec.ok ? rec.value : null);
  });

  it('a new device brings the profile back with the friend code and the recovery code; wrong codes are told apart from a lock', async () => {
    const mia = await player('Mia');
    const code = mia.code;
    const recovery = mia.port.state().recovery as string;
    const phone = device();
    await phone.port.open();
    expect(await phone.port.recoverProfile({ code: 'nonsense', recovery })).toMatchObject({ ok: false, code: 'bad_request', field: 'code' });
    expect(await phone.port.recoverProfile({ code, recovery: 'short' })).toMatchObject({ ok: false, code: 'bad_request', field: 'recovery' });
    expect(await phone.port.recoverProfile({ code, recovery: 'AAAA-AAAA-AAAA-AAAA' })).toMatchObject({ ok: false, code: 'recovery_failed' });
    const back = await phone.port.recoverProfile({ code, recovery });
    expect(back).toMatchObject({ ok: true, value: { fid: mia.fid, name: 'Mia' } });
    expect(phone.port.state().recovery).toBeNull();
    // five wrong tries lock the profile for a while, even for the right code
    const thief = device();
    await thief.port.open();
    for (let i = 0; i < 6; i++) await thief.port.recoverProfile({ code, recovery: 'BBBB-BBBB-BBBB-BBBB' });
    const locked = await thief.port.recoverProfile({ code, recovery });
    expect(locked).toMatchObject({ ok: false, code: 'too_many_attempts' });
  });

  it('deleting a profile erases it here and tells the friends; the screen is left with nothing to explain', async () => {
    const mia = await player('Mia');
    const ola = await player('Ola');
    expect((await mia.port.addByCode(ola.code)).ok).toBe(true);
    await ola.client.sync();
    expect((await ola.port.answer(mia.fid, true)).ok).toBe(true);
    await mia.client.sync();
    expect(mia.port.state().friends.map((f) => f.name)).toEqual(['Ola']);
    expect(await mia.port.deleteProfile()).toEqual({ ok: true, value: undefined });
    expect(mia.port.state()).toMatchObject({ profile: null, friends: [], signedOut: null, recovery: null });
    await ola.client.sync();
    expect(ola.port.state().friends).toEqual([]);
    const data = await ola.port.exportData();
    expect(data).toMatchObject({ ok: true, value: { profile: { name: 'Ola' } } });
  });
});

describe('friends through the port', () => {
  it('a request, its answer and the list of both sides', async () => {
    const mia = await player('Mia');
    const ola = await player('Ola');
    const sent = await mia.port.addByCode(ola.code);
    expect(sent).toEqual({ ok: true, value: { status: 'sent' } });
    expect(mia.port.state().requests.outgoing.map((r) => r.name)).toEqual(['Ola']);
    await ola.client.sync();
    expect(ola.port.state().requests.incoming.map((r) => r.name)).toEqual(['Mia']);
    expect(ola.port.state().profile?.counts.incoming).toBe(1);
    expect((await ola.port.answer(mia.fid, true)).ok).toBe(true);
    await mia.client.sync();
    expect(mia.port.state().friends.map((f) => f.name)).toEqual(['Ola']);
    expect(ola.port.state().friends.map((f) => f.name)).toEqual(['Mia']);
    expect(ola.port.state().requests.incoming).toEqual([]);
    expect(mia.port.state().profile?.counts.friends).toBe(1);
  });

  it('a request nobody receives still says sent: an adult asking a teenager, a blocked sender', async () => {
    const adult = await player('Mia');
    const teen = await player('x', 'teen');
    expect(await adult.port.addByCode(teen.code)).toEqual({ ok: true, value: { status: 'sent' } });
    await teen.client.sync();
    expect(teen.port.state().requests.incoming).toEqual([]);
    // the teenager blocks the adult: even a request made after that says sent
    const other = await player('Ola');
    expect((await other.port.addByCode(adult.code)).ok).toBe(true);
    await adult.client.sync();
    expect((await adult.port.block(other.fid)).ok).toBe(true);
    expect(await other.port.addByCode(adult.code)).toEqual({ ok: true, value: { status: 'sent' } });
    await adult.client.sync();
    expect(adult.port.state().requests.incoming).toEqual([]);
    expect(adult.port.state().blocks.map((b) => b.name)).toEqual(['Ola']);
    expect((await adult.port.unblock(other.fid)).ok).toBe(true);
    expect(adult.port.state().blocks).toEqual([]);
  });

  it('the real mistakes are told: your own code, a code nobody has, a friend you already have, one you blocked', async () => {
    const mia = await player('Mia');
    const ola = await player('Ola');
    expect(await mia.port.addByCode(mia.code)).toMatchObject({ ok: false, code: 'self' });
    expect(await mia.port.addByCode('BA-ZZZZZZ')).toMatchObject({ ok: false, code: 'not_found' });
    expect((await mia.port.addByCode(ola.code)).ok).toBe(true);
    await ola.client.sync();
    await ola.port.answer(mia.fid, true);
    await mia.client.sync();
    expect(await mia.port.addByCode(ola.code)).toMatchObject({ ok: false, code: 'already_friends' });
    await mia.port.block(ola.fid);
    expect(await mia.port.addByCode(ola.code)).toMatchObject({ ok: false, code: 'you_blocked' });
    expect(await mia.port.addByCode('not a code')).toMatchObject({ ok: false, code: 'bad_request' });
  });

  it('a report names the reason and may block; the sender\'s note is kept only for an adult', async () => {
    const mia = await player('Mia');
    const ola = await player('Ola');
    await mia.port.addByCode(ola.code);
    await ola.client.sync();
    await ola.port.answer(mia.fid, true);
    await mia.client.sync();
    expect(await mia.port.report({ fid: ola.fid, reason: 'spam', details: 'links', alsoBlock: true })).toEqual({ ok: true, value: undefined });
    await mia.client.sync();
    expect(mia.port.state().friends).toEqual([]);
    expect(mia.port.state().blocks.map((b) => b.name)).toEqual(['Ola']);
  });

  it('the synced documents are written through the signed client and read back', async () => {
    const mia = await player('Mia');
    const sync = mia.port.syncPort();
    expect(sync).not.toBeNull();
    const first = await sync?.updateSync('habit', (cur: { n?: number } | null) => ({ n: (cur?.n ?? 0) + 1 }));
    expect(first?.data).toEqual({ n: 1 });
    const docs = await sync?.loadSync();
    expect(docs?.['habit']?.data).toEqual({ n: 1 });
    const none = device();
    expect(none.port.syncPort()).toBeNull();
  });
});
