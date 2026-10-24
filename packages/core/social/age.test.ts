// The under-13 rule (BUILD-PLAN, decided 24 Oct, COPPA-safe): no online identity at all. The only switch is POLICY[band].online
// in age.ts; with it off the client makes no device key and sends nothing, the Worker refuses the registration and a profile
// cannot be lowered to that band. These tests are the production setting: the suites that exercise every band (the Worker's
// test kit and bundle, the browser harness) turn the switch on for themselves.
import { describe, expect, it } from 'vitest';
import { POLICY, canGoOnline, lowerBand, policyFor } from './age.ts';
import { SocialApiError, SocialClient } from './client.ts';
import type { KeyStore, StoredIdentity } from './keystore.ts';
import { AGE_BANDS } from './types.ts';

/** A key store that remembers every call, so a test can show that nothing was read, made or written. */
class WatchedStore implements KeyStore {
  readonly persistent = true;
  readonly calls: string[] = [];
  async load(): Promise<StoredIdentity | null> { this.calls.push('load'); return null; }
  async save(): Promise<void> { this.calls.push('save'); }
  async clear(): Promise<void> { this.calls.push('clear'); }
}

describe('under 13 has no online identity', () => {
  it('is one switch in POLICY: off for the child band, on for the others', () => {
    expect(POLICY.child.online).toBe(false);
    expect(POLICY.teen.online).toBe(true);
    expect(POLICY.adult.online).toBe(true);
    expect(AGE_BANDS.map(canGoOnline)).toEqual([false, true, true]);
    expect(policyFor('child').online).toBe(false);
  });

  it('keeps what the band would be allowed the day the switch is turned on (names, friends, requests) and nothing reads it now', () => {
    expect(POLICY.child).toMatchObject({ presetNameOnly: true, freeText: false, video: false, publicPlay: false, lobbyGroup: null });
    expect(POLICY.child.maxFriends).toBeLessThan(POLICY.teen.maxFriends);
  });

  it('stops the client before it makes a key, reads the device or sends a request', async () => {
    const keys = new WatchedStore();
    let sent = 0;
    const client = new SocialClient({ origin: 'https://bodyarcade.test', keys, fetch: async () => { sent++; throw new Error('a request was sent'); } });
    const err = await client.signUp({ band: 'child' }).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(SocialApiError);
    expect(err).toMatchObject({ status: 403, code: 'child_no_online' });
    expect(sent).toBe(0);
    expect(keys.calls).toEqual([]);
    expect(client.profile).toBeNull();
    expect(client.recoveryCode).toBeNull();
    // a name makes no difference: the band decides
    expect(await client.signUp({ band: 'child', name: 'Mia' }).then(() => 'made', (e: SocialApiError) => e.code)).toBe('child_no_online');
    expect(sent).toBe(0);
    expect(keys.calls).toEqual([]);
  });

  it('still lets the band be named in a lowering, and a profile steps down to it by deleting itself, not by changing', () => {
    // lowerBand only says which direction is allowed; the Worker refuses the step to a band without an identity (child_no_online)
    expect(lowerBand('teen', 'child')).toBe('child');
    expect(canGoOnline(lowerBand('teen', 'child') ?? 'adult')).toBe(false);
  });
});
