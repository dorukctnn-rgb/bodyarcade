import { describe, expect, it } from 'vitest';
import { iceGrant, withoutPort53 } from './ice.ts';
import type { LiveEnv } from './env.ts';

const env = (over: Partial<LiveEnv> = {}): LiveEnv => ({ ROOMS: undefined as never, TICKET_SECRET: 'x'.repeat(40), ...over });
const NOW = 1_800_000_000_000;

describe('iceGrant', () => {
  it('offers STUN only when no TURN key is configured', async () => {
    const g = await iceGrant(env(), NOW, () => { throw new Error('must not be called'); });
    expect(g).toEqual({ iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }], turn: false, exp: NOW / 1000 + 4 * 3600 });
  });

  it('adds the local TURN server of the test suite', async () => {
    const g = await iceGrant(env({ ICE_LOCAL_TURN: 'turn:192.168.1.7:3478?transport=udp', ICE_LOCAL_USER: 'ba', ICE_LOCAL_PASS: 'pw' }), NOW);
    expect(g.turn).toBe(true);
    expect(g.iceServers[1]).toEqual({ urls: ['turn:192.168.1.7:3478?transport=udp'], username: 'ba', credential: 'pw' });
  });

  it('mints Cloudflare credentials with the key and removes the port browsers refuse', async () => {
    let seen: { url: string; auth: string | null; body: string } | null = null;
    const fake = (async (url: string, init: RequestInit) => {
      seen = { url, auth: new Headers(init.headers).get('Authorization'), body: String(init.body) };
      return new Response(JSON.stringify({
        iceServers: [
          { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
          { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp', 'turns:turn.cloudflare.com:5349?transport=tcp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'u', credential: 'c' },
        ],
      }), { status: 200 });
    }) as unknown as typeof fetch;
    const g = await iceGrant(env({ TURN_KEY_ID: 'key id', TURN_KEY_API_TOKEN: 'tok' }), NOW, fake);
    expect(seen).toEqual({ url: 'https://rtc.live.cloudflare.com/v1/turn/keys/key%20id/credentials/generate-ice-servers', auth: 'Bearer tok', body: JSON.stringify({ ttl: 14400 }) });
    expect(g.turn).toBe(true);
    expect(g.iceServers[0]?.urls).toEqual(['stun:stun.cloudflare.com:3478']);
    expect(g.iceServers[1]).toEqual({ urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:5349?transport=tcp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'u', credential: 'c' });
  });

  it('falls back to STUN when the key is refused, the answer is empty or the call fails', async () => {
    const e = env({ TURN_KEY_ID: 'k', TURN_KEY_API_TOKEN: 't' });
    const stun = { iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }], turn: false, exp: NOW / 1000 + 4 * 3600 };
    expect(await iceGrant(e, NOW, (async () => new Response('nope', { status: 403 })) as unknown as typeof fetch)).toEqual(stun);
    expect(await iceGrant(e, NOW, (async () => new Response('{"iceServers":[]}', { status: 200 })) as unknown as typeof fetch)).toEqual(stun);
    expect(await iceGrant(e, NOW, (async () => { throw new Error('offline'); }) as unknown as typeof fetch)).toEqual(stun);
    expect(await iceGrant(e, NOW, (async () => new Response('not json', { status: 200 })) as unknown as typeof fetch)).toEqual(stun);
  });

  it('withoutPort53 keeps every other port', () => {
    expect(withoutPort53(['turn:a:53?transport=udp', 'turn:a:5349', 'turn:a:3478?transport=tcp', 'turns:a:443'])).toEqual(['turn:a:5349', 'turn:a:3478?transport=tcp', 'turns:a:443']);
    expect(withoutPort53('stun:a:53')).toEqual([]);
    expect(withoutPort53('stun:a:3478')).toBe('stun:a:3478');
  });
});
