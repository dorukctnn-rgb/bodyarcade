// The promise on the paywall, "we will remind you two days before your free trial ends", kept in two ways:
// the notice inside the app on every open of the last two days, and (on the web, only for a person who gave an address)
// one e-mail. On Google Play the store sends its own reminder, so the app asks for no address there.
import { beforeAll, describe, expect, it } from 'vitest';
import { createStore, memoryStorage } from '../store/index.ts';
import { API } from './api.ts';
import { createEntitlements, type EntitlementsService } from './manager.ts';
import { createServerProvider } from './providers/server.ts';
import type { FetchLike } from './providers/shared.ts';
import { Clock, DAY, DID_1, FakeServer, KEY_A, KEY_B, makeKeys, type Keys } from './testkit.ts';
import { NOTICE_LEAD_MS, createTrial, maskEmail, trialNotice, type TrialService } from './trial.ts';

let keys: Keys;
beforeAll(async () => { keys = await makeKeys(); });

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 9, 24, 12);
const web = { source: 'server' as const, paidUntil: null };

describe('the in-app notice', () => {
  it('is two days, as the paywall says', () => {
    expect(NOTICE_LEAD_MS).toBe(2 * DAY);
  });

  it('is not there without a trial, and not before the last two days', () => {
    expect(trialNotice({ ...web, trialEnds: null }, { now: NOW })).toBeNull();
    expect(trialNotice({ ...web, trialEnds: NOW + 7 * DAY }, { now: NOW })).toBeNull();
    expect(trialNotice({ ...web, trialEnds: NOW + 2 * DAY + 1 }, { now: NOW })).toBeNull();
  });

  it('shows from two days before the end until the end, and not after it', () => {
    expect(trialNotice({ ...web, trialEnds: NOW + 2 * DAY }, { now: NOW })).toMatchObject({ endsAt: NOW + 2 * DAY, msLeft: 2 * DAY });
    expect(trialNotice({ ...web, trialEnds: NOW + HOUR }, { now: NOW })).toMatchObject({ msLeft: HOUR });
    expect(trialNotice({ ...web, trialEnds: NOW + 1 }, { now: NOW })).not.toBeNull();
    expect(trialNotice({ ...web, trialEnds: NOW }, { now: NOW })).toBeNull();
    expect(trialNotice({ ...web, trialEnds: NOW - HOUR }, { now: NOW })).toBeNull();
  });

  it('is the same on every open: nothing is remembered between two calls', () => {
    const a = trialNotice({ ...web, trialEnds: NOW + DAY }, { now: NOW });
    const b = trialNotice({ ...web, trialEnds: NOW + DAY }, { now: NOW });
    expect(a).not.toBeNull();
    expect(b).toEqual(a);
  });

  it('counts calendar days in the player\'s own time zone: today, tomorrow, the day after', () => {
    const at = (end: number, timeZone: string) => trialNotice({ ...web, trialEnds: end }, { now: NOW, timeZone })?.dayOffset;
    // 12:00 UTC on 24 Oct.
    expect(at(Date.UTC(2026, 9, 24, 20), 'UTC')).toBe(0);
    expect(at(Date.UTC(2026, 9, 25, 9), 'UTC')).toBe(1);
    expect(at(Date.UTC(2026, 9, 26, 11), 'UTC')).toBe(2);
    // The same instants in Auckland (UTC+13): it is already 01:00 on the 25th there.
    expect(at(Date.UTC(2026, 9, 25, 9), 'Pacific/Auckland')).toBe(0);   // 22:00 on the 25th: still today
    expect(at(Date.UTC(2026, 9, 26, 11), 'Pacific/Auckland')).toBe(1);  // 00:00 on the 27th is not yet: 24:00 of the 26th is tomorrow
  });

  it('says where to cancel: Google Play for a Play purchase, the receipt of the purchase on the web', () => {
    expect(trialNotice({ source: 'play', paidUntil: null, trialEnds: NOW + DAY }, { now: NOW })?.where).toBe('play');
    expect(trialNotice({ source: 'server', paidUntil: null, trialEnds: NOW + DAY }, { now: NOW })?.where).toBe('web');
    expect(trialNotice({ source: 'gumroad', paidUntil: null, trialEnds: NOW + DAY }, { now: NOW })?.where).toBe('web');
  });

  it('says when the membership was already cancelled: the trial runs out and nothing is charged', () => {
    expect(trialNotice({ ...web, trialEnds: NOW + DAY }, { now: NOW })?.cancelled).toBe(false);
    expect(trialNotice({ ...web, paidUntil: NOW + DAY, trialEnds: NOW + DAY }, { now: NOW })?.cancelled).toBe(true);
  });

  it('ignores what cannot be a time', () => {
    for (const trialEnds of [Number.NaN, Number.POSITIVE_INFINITY, -5, 0]) expect(trialNotice({ ...web, trialEnds }, { now: NOW })).toBeNull();
    expect(trialNotice({ ...web, trialEnds: NOW + DAY }, { now: Number.NaN })).toBeNull();
    expect(trialNotice({ source: 'none', paidUntil: null, trialEnds: NOW + DAY }, { now: NOW })).toBeNull();
  });
});

describe('maskEmail', () => {
  it('keeps the first letter and the domain', () => {
    expect(maskEmail('alice@example.com')).toBe('a***@example.com');
    expect(maskEmail('x@example.com')).toBe('x***@example.com');
    expect(maskEmail('not an address')).toBe('***');
  });
});

// ───────── with the manager and the pretend server ─────────

const hexBytes = (hex: string): Uint8Array => Uint8Array.from(hex.match(/../g) as string[], (h) => parseInt(h, 16));

interface Rig {
  clock: Clock;
  storage: ReturnType<typeof memoryStorage>;
  server: FakeServer;
  service: EntitlementsService;
  trial: TrialService;
  /** The app closed and opened again: the same storage, a new service and a new trial service. */
  restart(over?: { mode?: 'web' | 'play'; fetch?: FetchLike }): Promise<Rig>;
}

async function rig(o: { mode?: 'web' | 'play'; trialDays?: number | null; fetch?: FetchLike; cancelled?: boolean; shared?: Pick<Rig, 'clock' | 'storage' | 'server'> } = {}): Promise<Rig> {
  const clock = o.shared?.clock ?? new Clock();
  const storage = o.shared?.storage ?? memoryStorage();
  const server = o.shared?.server ?? new FakeServer(keys, clock);
  if (!o.shared) {
    const trialEnd = o.trialDays === null ? undefined : clock.now() + (o.trialDays ?? 7) * DAY;
    server.licenses.set(KEY_A, { plan: 'pro-yearly', status: 'active', ...(trialEnd ? { trialEnd } : {}), ...(o.cancelled ? { paidUntil: clock.now() + 7 * DAY } : {}) });
  }
  const store = createStore({ storage, now: clock.now, timeZone: 'UTC' });
  let didOf = (): string => '';
  const f: FetchLike = o.fetch ?? server.fetch;
  const service = createEntitlements({
    store, keys: [keys.pub], now: clock.now, random: () => hexBytes(DID_1), autoRefresh: false,
    providers: [createServerProvider({ fetch: f, did: () => didOf(), keys: [keys.pub], now: clock.now })],
    setTimer: () => 0, clearTimer: () => undefined,
  });
  didOf = service.deviceId;
  await service.ready();
  const trial = createTrial({ service, store, mode: o.mode ?? 'web', fetch: f, now: clock.now, timeZone: 'UTC' });
  return { clock, storage, server, service, trial, restart: (over) => rig({ ...(over ?? {}), shared: { clock, storage, server } }) };
}

const reminderCalls = (r: Rig): string[] => r.server.calls.map((c) => c.path).filter((p) => p === API.reminder || p === API.key);

describe('a trial on the web', () => {
  it('has no notice in the first days and offers the address box', async () => {
    const r = await rig();
    expect((await r.service.activateKey(KEY_A)).ok).toBe(true);
    const v = await r.trial.view();
    expect(v.notice).toBeNull();
    expect(v.email).toBe('offer');
    expect(v.trialEnds).toBe(r.clock.now() + 7 * DAY);
  });

  it('shows the notice on every open of the last two days, also after the app was closed and opened again', async () => {
    const r = await rig();
    await r.service.activateKey(KEY_A);
    r.clock.advance(5 * DAY + HOUR);
    const first = (await r.trial.view()).notice;
    expect(first).toMatchObject({ where: 'web', cancelled: false, dayOffset: 2 });
    expect((await r.trial.view()).notice).toEqual(first);
    const again = await r.restart();
    expect((await again.trial.view()).notice).toEqual(first);
    again.clock.advance(DAY);
    expect((await again.trial.view()).notice).toMatchObject({ dayOffset: 1 });
    again.clock.advance(DAY - 2 * HOUR);
    expect((await again.trial.view()).notice).toMatchObject({ dayOffset: 0 });
    expect(again.trial.notice()).toMatchObject({ dayOffset: 0 });
  });

  it('has no notice and no box once the trial is over, and a Pro plan that never had a trial has neither', async () => {
    const r = await rig();
    await r.service.activateKey(KEY_A);
    r.clock.advance(7 * DAY + HOUR);
    expect(await r.trial.view()).toMatchObject({ notice: null, email: 'none' });
    const none = await rig({ trialDays: null });
    await none.service.activateKey(KEY_A);
    expect(await none.trial.view()).toMatchObject({ notice: null, email: 'none', trialEnds: null });
  });

  it('has nothing to say to a player without a purchase', async () => {
    const r = await rig();
    expect(await r.trial.view()).toMatchObject({ notice: null, email: 'none', trialEnds: null });
    expect(r.trial.notice()).toBeNull();
  });

  it('says the trial was cancelled, and takes no address (the server would refuse it)', async () => {
    const r = await rig({ cancelled: true });
    await r.service.activateKey(KEY_A);
    r.clock.advance(6 * DAY);
    expect(await r.trial.view()).toMatchObject({ notice: { cancelled: true }, email: 'none' });
  });
});

describe('the e-mail, only for a person who gives an address', () => {
  it('leaves the address with the server and remembers only that it did, in a masked form', async () => {
    const r = await rig();
    await r.service.activateKey(KEY_A);
    const out = await r.trial.setEmail('alice@example.com', 'tr');
    expect(out).toEqual({ ok: true, sendAt: r.clock.now() + 5 * DAY });
    const row = [...r.server.reminders.values()][0];
    expect(row).toEqual({ email: 'alice@example.com', lang: 'tr', sendAt: r.clock.now() + 5 * DAY });
    expect(await r.trial.view()).toMatchObject({ email: 'set', masked: 'a***@example.com', sendAt: r.clock.now() + 5 * DAY });
    expect(JSON.stringify(r.storage.dump())).not.toContain('alice');
  });

  it('is still set after the app was closed and opened again, and can be taken back', async () => {
    const r = await rig();
    await r.service.activateKey(KEY_A);
    await r.trial.setEmail('alice@example.com', 'en');
    const again = await r.restart();
    expect(await again.trial.view()).toMatchObject({ email: 'set', masked: 'a***@example.com' });
    expect(await again.trial.clearEmail()).toEqual({ ok: true, sendAt: null });
    expect(again.server.reminders.size).toBe(0);
    expect(await again.trial.view()).toMatchObject({ email: 'offer', masked: null, sendAt: null });
    expect((await (await again.restart()).trial.view()).email).toBe('offer');
  });

  it('sends the e-mail at once when the address comes in the last two days (the server answers with now)', async () => {
    const r = await rig();
    await r.service.activateKey(KEY_A);
    r.clock.advance(6 * DAY);
    expect(await r.trial.setEmail('bob@example.org', 'en')).toEqual({ ok: true, sendAt: r.clock.now() });
  });

  it('writes to the server in one of the app\'s languages, trimmed', async () => {
    const r = await rig();
    await r.service.activateKey(KEY_A);
    await r.trial.setEmail('  carol@example.com ', 'de-AT');
    expect([...r.server.reminders.values()][0]).toMatchObject({ email: 'carol@example.com', lang: 'de' });
    await r.trial.setEmail('carol@example.com', 'ja');
    expect([...r.server.reminders.values()][0]).toMatchObject({ lang: 'en' });
    await r.trial.setEmail('carol@example.com', '');
    expect([...r.server.reminders.values()][0]).toMatchObject({ lang: 'en' });
  });

  it('refuses what is not an address without asking the server', async () => {
    const r = await rig();
    await r.service.activateKey(KEY_A);
    const before = r.server.calls.length;
    for (const bad of ['', 'not an address', 'a@b', 'x'.repeat(300) + '@example.com', '<script>@example.com']) {
      expect(await r.trial.setEmail(bad, 'en')).toEqual({ ok: false, code: 'bad_email' });
    }
    expect(r.server.calls.length).toBe(before);
    expect((await r.trial.view()).email).toBe('offer');
  });

  it('does not offer the box when the server has no mail service, and says so when asked', async () => {
    const r = await rig();
    r.server.mailEnabled = false;
    await r.service.activateKey(KEY_A);
    expect(await r.trial.view()).toMatchObject({ email: 'none' });
    expect(await r.trial.setEmail('alice@example.com', 'en')).toEqual({ ok: false, code: 'unavailable' });
    expect(r.server.reminders.size).toBe(0);
    expect((await r.trial.view()).notice).toBeNull();   // the in-app notice does not depend on the mail service
    r.clock.advance(6 * DAY);
    expect((await r.trial.view()).notice).not.toBeNull();
  });

  it('answers what went wrong in words the screen can use, and stays "offer" after a failure', async () => {
    const answers: [number | 'offline', unknown, string][] = [
      [409, { error: 'no_trial' }, 'no_trial'],
      [429, { error: 'rate_limited' }, 'rate_limited'],
      [503, { error: 'unavailable' }, 'unavailable'],
      [500, { error: 'internal' }, 'unavailable'],
      [400, { error: 'bad_request' }, 'bad_email'],
      [200, '<html>Sign in to the Wi-Fi</html>', 'unavailable'],
      ['offline', null, 'network'],
    ];
    for (const [status, body, code] of answers) {
      const probe = new FakeServer(keys, new Clock());
      let reminding = false;
      const r = await rig({
        fetch: async (url, init) => {
          if (reminding && url.endsWith(API.reminder)) {
            if (status === 'offline') throw new TypeError('Failed to fetch');
            return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
          }
          return (r0?.server ?? probe).fetch(url, init);
        },
      });
      var r0 = r;   // eslint-disable-line no-var
      await r.service.activateKey(KEY_A);
      reminding = true;
      expect(await r.trial.setEmail('alice@example.com', 'en'), `${status}`).toEqual({ ok: false, code });
      expect((await r.trial.view()).email, `${status}`).toBe('offer');
    }
  });

  it('forgets a stored "set" that belongs to another trial', async () => {
    const r = await rig();
    await r.service.activateKey(KEY_A);
    await r.trial.setEmail('alice@example.com', 'en');
    r.server.licenses.set(KEY_B, { plan: 'pro-yearly', status: 'active', trialEnd: r.clock.now() + 9 * DAY });
    await r.service.activateKey(KEY_B);
    expect(await r.trial.view()).toMatchObject({ email: 'offer', masked: null });
  });

  it('does not ask the server to take back an address that was never given', async () => {
    const r = await rig();
    await r.service.activateKey(KEY_A);
    expect(await r.trial.clearEmail()).toEqual({ ok: true, sendAt: null });
    expect(r.server.calls.filter((c) => c.path === API.reminder)).toEqual([]);
    expect((await r.trial.view()).email).toBe('offer');
  });

  it('keeps the address, and says so, when the server could not be asked to take it back', async () => {
    let down = false;
    const r = await rig({ fetch: async (url, init) => { if (down && url.endsWith(API.reminder)) throw new TypeError('Failed to fetch'); return r2.server.fetch(url, init); } });
    var r2 = r;   // eslint-disable-line no-var
    await r.service.activateKey(KEY_A);
    await r.trial.setEmail('alice@example.com', 'en');
    down = true;
    expect(await r.trial.clearEmail()).toEqual({ ok: false, code: 'network' });
    expect(await r.trial.view()).toMatchObject({ email: 'set', masked: 'a***@example.com' });   // not pretended to be gone
    expect(r.server.reminders.size).toBe(1);
    down = false;
    expect(await r.trial.clearEmail()).toEqual({ ok: true, sendAt: null });
    expect(r.server.reminders.size).toBe(0);
  });
});

describe('Google Play: the store sends its own reminder', () => {
  it('still shows the in-app notice, with Play as the place to cancel, and asks for no address and calls nothing', async () => {
    const r = await rig({ mode: 'play' });
    await r.service.activateKey(KEY_A);
    r.clock.advance(6 * DAY);
    const v = await r.trial.view();
    expect(v.email).toBe('none');
    expect(v.notice).toMatchObject({ dayOffset: 1 });
    expect(await r.trial.setEmail('alice@example.com', 'en')).toEqual({ ok: false, code: 'not_offered' });
    expect(reminderCalls(r)).toEqual([]);
  });

  it('takes the place from the purchase itself: a purchase made on Play says Play even in a web page', () => {
    expect(trialNotice({ source: 'play', paidUntil: null, trialEnds: NOW + DAY }, { now: NOW })).toMatchObject({ where: 'play' });
  });
});

describe('the box is asked of the server once in a while, not on every open', () => {
  it('remembers the answer for a few minutes', async () => {
    const r = await rig();
    await r.service.activateKey(KEY_A);
    await r.trial.view();
    await r.trial.view();
    await r.trial.view();
    expect(r.server.calls.filter((c) => c.path === API.key)).toHaveLength(1);
    r.clock.advance(11 * 60_000);
    await r.trial.view();
    expect(r.server.calls.filter((c) => c.path === API.key)).toHaveLength(2);
  });

  it('does not offer the box while the server cannot be reached, and asks again soon', async () => {
    let up = false;
    const r = await rig({ fetch: async (url, init) => { if (!up && url.endsWith(API.key)) throw new TypeError('Failed to fetch'); return r1.server.fetch(url, init); } });
    var r1 = r;   // eslint-disable-line no-var
    await r.service.activateKey(KEY_A);
    expect((await r.trial.view()).email).toBe('none');
    up = true;
    r.clock.advance(61_000);
    expect((await r.trial.view()).email).toBe('offer');
  });
});
