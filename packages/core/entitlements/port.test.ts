// The shell's port: plan(), onChange only for a change of plan, activate that never throws, and the Android calls only
// in the Android build.
import { beforeAll, describe, expect, it } from 'vitest';
import type { Plan } from '../types/index.ts';
import { createStore, memoryStorage } from '../store/index.ts';
import { createEntitlements, type EntitlementsService } from './manager.ts';
import { toShellPort } from './port.ts';
import { createServerProvider } from './providers/server.ts';
import { DAY, DID_1, KEY_A, Clock, FakeServer, makeKeys, type Keys } from './testkit.ts';

let keys: Keys;
beforeAll(async () => { keys = await makeKeys(); });

async function world() {
  const clock = new Clock();
  const server = new FakeServer(keys, clock);
  const store = createStore({ storage: memoryStorage(), now: clock.now });
  const service = createEntitlements({
    store, keys: [keys.pub], now: clock.now, autoRefresh: false, random: () => Uint8Array.from(DID_1.match(/../g) as string[], (h) => parseInt(h, 16)),
    providers: [createServerProvider({ fetch: server.fetch, did: () => DID_1, keys: [keys.pub], now: clock.now })],
  });
  await service.ready();
  return { clock, server, service };
}

describe('the web port', () => {
  it('answers plan() and takes a key', async () => {
    const { server, service } = await world();
    server.licenses.set(KEY_A, { plan: 'pro-yearly', status: 'active' });
    const port = toShellPort(service, { play: false });
    expect(port.plan()).toBe('free');
    expect(await port.activate(KEY_A)).toEqual({ ok: true, plan: 'pro' });
    expect(port.plan()).toBe('pro');
  });

  it('reports the failure code of a key that does not work, and never throws', async () => {
    const { service } = await world();
    const port = toShellPort(service, { play: false });
    expect(await port.activate('UNKNOWN-KEY-00001')).toEqual({ ok: false, code: 'not_found' });
    expect(await port.activate('x')).toEqual({ ok: false, code: 'not_found' });
    const broken = { ...service, activateKey: () => Promise.reject(new Error('boom')) } as unknown as EntitlementsService;
    expect(await toShellPort(broken, { play: false }).activate(KEY_A)).toEqual({ ok: false, code: 'server' });
  });

  it('tells the screens about a change of plan and not about a renewed token', async () => {
    const { server, service, clock } = await world();
    server.licenses.set(KEY_A, { plan: 'pro-yearly', status: 'active' });
    const port = toShellPort(service, { play: false });
    const seen: Plan[] = [];
    const off = port.onChange((p) => seen.push(p));
    await port.activate(KEY_A);
    expect(seen).toEqual(['pro']);
    clock.advance(2 * DAY);
    expect(await service.refresh()).toBe('renewed');
    expect(seen).toEqual(['pro']);                                           // a new token under the same plan is not news
    server.licenses.set(KEY_A, { plan: 'pro-yearly', status: 'refunded' });
    clock.advance(10 * 60_000);
    await service.refresh();
    expect(seen).toEqual(['pro', 'free']);
    off();
    server.licenses.set(KEY_A, { plan: 'lifetime', status: 'active' });
    await port.activate(KEY_A);
    expect(seen).toEqual(['pro', 'free']);                                   // unsubscribed
  });

  it('has no purchase and no restore outside Android', async () => {
    const { service } = await world();
    const port = toShellPort(service, { play: false });
    expect(port.purchase).toBeUndefined();
    expect(port.restore).toBeUndefined();
  });
});

describe('the Android port', () => {
  it('has purchase and restore, and they answer with a yes or a no, never an error', async () => {
    const { service } = await world();
    const port = toShellPort(service, { play: true });
    expect(await port.purchase?.('bodyarcade_pro_yearly')).toBe(false);       // no Play provider in this rig
    expect(await port.restore?.()).toBe(false);
    const throwing = { ...service, purchase: () => Promise.reject(new Error('x')), restore: () => Promise.reject(new Error('y')) } as unknown as EntitlementsService;
    const p2 = toShellPort(throwing, { play: true });
    expect(await p2.purchase?.('bodyarcade_pro_yearly')).toBe(false);
    expect(await p2.restore?.()).toBe(false);
  });

  it('says why a restore found nothing: no purchase on the account is not the same as a service that could not answer', async () => {
    const { service } = await world();
    const answer = (r: unknown) => toShellPort({ ...service, restore: async () => r } as unknown as EntitlementsService, { play: true });
    const e = { plan: 'pro' } as never;
    expect(await answer({ ok: true, e }).restoreOutcome?.()).toBe('restored');
    expect(await answer({ ok: false, code: 'not_found', message: '' }).restoreOutcome?.()).toBe('none');
    for (const code of ['network', 'server', 'refunded', 'ended', 'limit'] as const) expect(await answer({ ok: false, code, message: '' }).restoreOutcome?.()).toBe(code);
    const throwing = toShellPort({ ...service, restore: () => Promise.reject(new Error('y')) } as unknown as EntitlementsService, { play: true });
    expect(await throwing.restoreOutcome?.()).toBe('server');
    expect(toShellPort(service, { play: false }).restoreOutcome).toBeUndefined();
  });
});
