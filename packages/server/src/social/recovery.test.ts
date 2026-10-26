// The recovery code: a profile back on a new device, and what stops anybody else from doing it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatRecoveryCode, parseRecoveryCode } from '../../../core/social/codes.ts';
import { DAY, HOUR, LIMITS } from '../../../core/social/rules.ts';
import { signRequest, generateDeviceKey } from '../../../core/social/sign.ts';
import type { AgeBand } from '../../../core/social/types.ts';
import { MAX_DEVICES, recoveryHash } from './recovery.ts';
import { createTestApp, TEST_ORIGIN, type TestApp, type TestDevice, type TestPlayer } from './testkit.ts';

// Players are made with real WebCrypto keys and every request is signed and verified; a full-suite run on a busy machine is
// several times slower than a run of this file alone, so the default five seconds is not enough.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const T0 = Date.UTC(2026, 9, 21, 12);
let app: TestApp;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  app = createTestApp();
});
afterEach(() => vi.useRealTimers());

const player = (band: AgeBand = 'adult', name?: string): Promise<TestPlayer> => app.signup(band, name ? { name } : {});

/** A new device asks to be added to the profile of `who`. */
async function recoverOn(dev: TestDevice, who: { me: { code: string }; recovery: string }, over: Record<string, unknown> = {}) {
  return app.call<{ me: { fid: string; code: string; name: string }; error?: string }>('POST', '/api/social/recover', {
    dev, body: { pub: dev.keys.publicRaw, code: who.me.code, recovery: who.recovery, ...over },
  });
}
const devices = (p: TestPlayer): number => (app.db.raw.prepare('SELECT COUNT(*) AS n FROM soc_devices WHERE pid = ?').get(p.pid()) as { n: number }).n;

describe('the code', () => {
  it('is shown once at sign-up in the written form, and the database keeps a hash of it that is not the code', async () => {
    const ada = await player('adult', 'Ada');
    expect(ada.recovery).toMatch(/^[2-9A-HJ-NP-Z]{4}(-[2-9A-HJ-NP-Z]{4}){3}$/);
    const stored = (app.db.raw.prepare('SELECT recovery FROM soc_profiles WHERE pid = ?').get(ada.pid()) as { recovery: string }).recovery;
    const chars = parseRecoveryCode(ada.recovery) as string;
    expect(stored).toBe(await recoveryHash(ada.pid(), chars));
    expect(stored).not.toContain(chars);
    // signing up again with the same key is the same profile and shows no code
    const again = await app.call<{ created: boolean; recovery?: string }>('POST', '/api/social/register', { dev: ada.dev, body: { pub: ada.dev.keys.publicRaw, band: 'adult' } });
    expect(again.status).toBe(200);
    expect(again.body.created).toBe(false);
    expect(again.body.recovery).toBeUndefined();
    // no other answer of the server ever carries it
    for (const path of ['/api/social/me', '/api/social/me/export', '/api/social/friends']) expect(JSON.stringify((await ada.get(path)).body)).not.toContain(chars);
  });

  it('is different for every profile', async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 25; i++) codes.add((await player()).recovery);
    expect(codes.size).toBe(25);
  });

  it('can be renewed: the new one works, the old one does not, three times a day', async () => {
    const ada = await player('adult', 'Ada');
    const first = (await ada.post('/api/social/me/recovery')).body.recovery as string;
    expect(first).not.toBe(ada.recovery);
    expect((await recoverOn(await app.newDevice(), ada)).status).toBe(403);              // the sign-up code is gone
    expect((await recoverOn(await app.newDevice(), { me: ada.me, recovery: first })).status).toBe(200);
    for (let i = 0; i < LIMITS.renewRecovery.max - 1; i++) expect((await ada.post('/api/social/me/recovery')).status).toBe(200);
    const over = await ada.post('/api/social/me/recovery');
    expect(over.status).toBe(429);
    expect(over.body.error).toBe('rate_limited');
    vi.setSystemTime(T0 + DAY + HOUR);
    expect((await ada.post('/api/social/me/recovery')).status).toBe(200);
    expect((await app.call('POST', '/api/social/me/recovery', { body: {} })).status).toBe(401);
  });
});

describe('a new device', () => {
  it('gets the same profile with its friends and its scores, and the old device keeps working beside it', async () => {
    const ada = await player('adult', 'Ada');
    const bo = await player('adult', 'Bo');
    await ada.post('/api/social/friends/request', { code: bo.me.code });
    await bo.post('/api/social/friends/respond', { fid: ada.me.fid, accept: true });
    const phone = await app.newDevice();
    const r = await recoverOn(phone, ada);
    expect(r.status).toBe(200);
    expect(r.body.me).toMatchObject({ fid: ada.me.fid, code: ada.me.code, name: 'Ada' });
    expect(devices(ada)).toBe(2);
    const onPhone = await app.call<{ friends: { name: string }[] }>('GET', '/api/social/friends', { dev: phone });
    expect(onPhone.body.friends.map((f) => f.name)).toEqual(['Bo']);
    expect((await ada.get('/api/social/friends')).body.friends).toHaveLength(1);        // the first device is untouched
    // a change on one device shows on the other: it is one profile
    await app.call('POST', '/api/social/me', { dev: phone, body: { level: 14 } });
    expect((await ada.get('/api/social/me')).body.me.level).toBe(14);
  });

  it('is not given the profile for a wrong recovery code, an unknown friend code or a profile without a code, and nothing is added', async () => {
    const ada = await player('adult', 'Ada');
    const other = await player('adult');
    const dev = await app.newDevice();
    const wrong = await recoverOn(dev, ada, { recovery: other.recovery });
    const unknown = await recoverOn(dev, ada, { code: 'BA-ZZZZZZ' });
    expect(wrong.status).toBe(403);
    expect(unknown.status).toBe(403);
    expect(wrong.body.error).toBe('recovery_failed');
    expect(unknown.body).toEqual({ ...wrong.body, serverTime: expect.any(Number) });  // the same answer: nobody learns which half was wrong
    app.db.raw.prepare("UPDATE soc_profiles SET recovery = '' WHERE pid = ?").run(other.pid());
    expect((await recoverOn(dev, other)).status).toBe(403);                              // a profile that has none cannot be recovered
    expect(devices(ada)).toBe(1);
    expect(devices(other)).toBe(1);
  });

  it('must write the codes the way a code looks; anything else is a malformed request, not a failed guess', async () => {
    const ada = await player('adult');
    const dev = await app.newDevice();
    for (const bad of [{ recovery: 'short' }, { recovery: '' }, { recovery: 12 }, { code: 'nope' }, { code: '' }, { code: null }]) {
      expect((await recoverOn(dev, ada, bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect(app.db.raw.prepare('SELECT COUNT(*) AS n FROM soc_limits WHERE k LIKE ?').get('rc:%')).toEqual({ n: 0 });   // none of that counted as a guess
    // typed any which way, the right codes work
    const sloppy = await recoverOn(dev, { me: { code: ada.me.code.toLowerCase() }, recovery: ada.recovery.toLowerCase().replace(/-/g, ' ') });
    expect(sloppy.status).toBe(200);
  });

  it('five wrong guesses an hour lock the profile for the rest of the hour, even for the right code; other profiles are not affected', async () => {
    const ada = await player('adult', 'Ada');
    const bo = await player('adult', 'Bo');
    const guess = formatRecoveryCode('AAAAAAAAAAAAAAAA');
    for (let i = 0; i < LIMITS.recoverCode.max; i++) expect((await recoverOn(await app.newDevice(`10.5.5.${i}`), ada, { recovery: guess })).status).toBe(403);
    const locked = await recoverOn(await app.newDevice('10.5.6.1'), ada);
    expect(locked.status).toBe(429);
    expect(locked.body.error).toBe('too_many_attempts');
    expect(devices(ada)).toBe(1);
    expect((await recoverOn(await app.newDevice('10.5.6.2'), bo)).status).toBe(200);
    vi.setSystemTime(T0 + 2 * HOUR);
    expect((await recoverOn(await app.newDevice('10.5.6.3'), ada)).status).toBe(200);
  });

  it('ten wrong guesses an hour from one network address stop that address, whichever profiles it tries', async () => {
    const players: TestPlayer[] = [];
    for (let i = 0; i < 12; i++) players.push(await player());
    const guess = formatRecoveryCode('BBBBBBBBBBBBBBBB');
    for (let i = 0; i < LIMITS.recoverAddress.max; i++) expect((await recoverOn(await app.newDevice('10.7.7.7'), players[i] as TestPlayer, { recovery: guess })).status).toBe(403);
    const stopped = await recoverOn(await app.newDevice('10.7.7.7'), players[11] as TestPlayer);
    expect(stopped.status).toBe(429);
    expect((await recoverOn(await app.newDevice('10.7.7.8'), players[11] as TestPlayer)).status).toBe(200);
  });

  it('has to sign its request with the key it brings: unsigned, signed by another key, tampered and replayed requests are refused', async () => {
    const ada = await player('adult');
    const dev = await app.newDevice();
    const body = { pub: dev.keys.publicRaw, code: ada.me.code, recovery: ada.recovery };
    expect((await app.call('POST', '/api/social/recover', { body })).status).toBe(401);
    const other = await generateDeviceKey();
    const url = `${TEST_ORIGIN}/api/social/recover`;
    const header = await signRequest(other, { method: 'POST', url, body }, Date.now());
    expect((await app.call('POST', '/api/social/recover', { body, rawAuth: header, ip: dev.ip })).status).toBe(401);
    const good = await signRequest(dev.keys, { method: 'POST', url, body }, Date.now());
    const tampered = await app.call('POST', '/api/social/recover', { body: { ...body, code: 'BA-ZZZZZZ' }, rawAuth: good, ip: dev.ip });
    expect(tampered.status).toBe(401);
    expect((await app.call('POST', '/api/social/recover', { body, rawAuth: good, ip: dev.ip })).status).toBe(200);
    const replay = await app.call('POST', '/api/social/recover', { body, rawAuth: good, ip: dev.ip });
    expect(replay.status).toBe(401);
    expect(replay.body.error).toBe('replayed');
    expect(devices(ada)).toBe(2);
  });

  it('asking again with the same key (the answer was lost) gives the profile again and adds nothing', async () => {
    const ada = await player('adult', 'Ada');
    const dev = await app.newDevice();
    expect((await recoverOn(dev, ada)).status).toBe(200);
    const again = await recoverOn(dev, ada);
    expect(again.status).toBe(200);
    expect(again.body.me.fid).toBe(ada.me.fid);
    expect(devices(ada)).toBe(2);
    // the key of one profile cannot be moved to another
    const bo = await player('adult');
    const moved = await recoverOn(dev, bo);
    expect(moved.status).toBe(409);
    expect(devices(bo)).toBe(1);
  });

  it('five devices at most: the sixth takes the place of the oldest, whose calls are refused from then on', async () => {
    const ada = await player('adult', 'Ada');
    const added: TestDevice[] = [];
    for (let i = 1; i < MAX_DEVICES; i++) {
      vi.setSystemTime(T0 + i * 1000);
      const dev = await app.newDevice(`10.8.8.${i}`);
      expect((await recoverOn(dev, ada)).status).toBe(200);
      added.push(dev);
    }
    expect(devices(ada)).toBe(MAX_DEVICES);
    vi.setSystemTime(T0 + 10_000);
    const sixth = await app.newDevice('10.8.8.99');
    expect((await recoverOn(sixth, ada)).status).toBe(200);
    expect(devices(ada)).toBe(MAX_DEVICES);
    expect((await app.call('GET', '/api/social/me', { dev: ada.dev })).body.error).toBe('unknown_device');    // the first one is gone
    expect((await app.call('GET', '/api/social/me', { dev: added[0] as TestDevice })).status).toBe(200);
    expect((await app.call('GET', '/api/social/me', { dev: sixth })).status).toBe(200);
  });

  it('a banned player can still get the profile back (to export or erase it), and an erased profile cannot be recovered', async () => {
    const ada = await player('adult', 'Ada');
    const bo = await player('adult', 'Bo');
    app.db.raw.prepare('UPDATE soc_profiles SET banned_until = ? WHERE pid = ?').run(T0 + DAY, ada.pid());
    const dev = await app.newDevice();
    expect((await recoverOn(dev, ada)).status).toBe(200);
    expect((await app.call('GET', '/api/social/me', { dev })).status).toBe(403);
    expect((await app.call('GET', '/api/social/me/export', { dev })).status).toBe(200);
    expect((await bo.post('/api/social/me/delete', { confirm: 'delete' })).status).toBe(200);
    const after = await recoverOn(await app.newDevice(), bo);
    expect(after.status).toBe(403);
    expect(after.body.error).toBe('recovery_failed');
  });

  it('works for a child as for anybody: the recovery is the family\'s way back to the profile', async () => {
    const kid = await player('child');
    const dev = await app.newDevice();
    const r = await recoverOn(dev, kid);
    expect(r.status).toBe(200);
    expect(r.body.me.fid).toBe(kid.me.fid);
    expect((await app.call<{ me: { band: string } }>('GET', '/api/social/me', { dev })).body.me.band).toBe('child');
  });
});
