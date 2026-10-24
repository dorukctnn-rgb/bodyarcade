// What live play needs from the release, pinned from its side (the release owner's own tests cover the rest): invite links reach the
// Worker, the Room is bound and migrated, the product ships without a TURN relay, and a TURN key can be added later with no change in the code.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SECRETS } from '../../../../release/secrets.ts';
import { iceGrant } from './ice.ts';
import type { LiveEnv } from './env.ts';

const ROOT = new URL('../../../../', import.meta.url);
const jsonc = (file: string): Record<string, unknown> => JSON.parse(readFileSync(new URL(file, ROOT), 'utf8').replace(/^\s*\/\/.*$/gm, '')) as Record<string, unknown>;

interface Cfg {
  assets: { run_worker_first: string[] };
  durable_objects: { bindings: { name: string; class_name: string }[] };
  migrations: { tag: string; new_sqlite_classes?: string[] }[];
  vars?: Record<string, string>;
}

for (const file of ['wrangler.jsonc', 'wrangler.prod.jsonc']) {
  describe(`${file} for live play`, () => {
    const cfg = jsonc(file) as unknown as Cfg;

    it('lets the Worker answer the invite link /r/CODE and the API before the static assets do (without it every shared link is a 404)', () => {
      expect(cfg.assets.run_worker_first).toContain('/api/*');
      expect(cfg.assets.run_worker_first).toContain('/r/*');
    });

    it('binds the Room as ROOMS and migrates it as a SQLite-backed class (Durable Objects work on the free plan)', () => {
      expect(cfg.durable_objects.bindings).toContainEqual({ name: 'ROOMS', class_name: 'Room' });
      expect(cfg.migrations.some((m) => m.new_sqlite_classes?.includes('Room'))).toBe(true);
      expect(new Set(cfg.migrations.map((m) => m.tag)).size).toBe(cfg.migrations.length);          // a migration tag is never used twice
    });

    it('keeps every secret out of the config file (the Worker gets them as secrets, never as vars)', () => {
      const vars = Object.keys(cfg.vars ?? {});
      for (const name of ['TICKET_SECRET', 'TURN_KEY_ID', 'TURN_KEY_API_TOKEN', 'ICE_LOCAL_TURN', 'ICE_LOCAL_PASS']) expect(vars).not.toContain(name);
    });
  });
}

describe('the product without a TURN relay (until Doruk enables Cloudflare Realtime TURN)', () => {
  const spec = (name: string) => SECRETS.find((s) => s.name === name);

  it('needs the ticket secret and nothing else: the TURN key and its token are optional, so the release is never blocked by them', () => {
    expect(spec('TICKET_SECRET')?.required).toBe(true);
    expect(spec('TURN_KEY_ID')?.required).toBe(false);
    expect(spec('TURN_KEY_API_TOKEN')?.required).toBe(false);
  });

  const env = (over: Partial<LiveEnv> = {}): LiveEnv => ({ ROOMS: undefined as never, TICKET_SECRET: 'x'.repeat(40), ...over });
  const NOW = 1_800_000_000_000;

  it('offers STUN only and says so, with no call to any TURN service', async () => {
    const g = await iceGrant(env(), NOW, () => { throw new Error('the TURN service must not be called without a key'); });
    expect(g.turn).toBe(false);
    expect(g.iceServers.every((s) => String(s.urls).startsWith('stun:'))).toBe(true);
  });

  it('turns to a relay the moment the two secrets exist, in the same code: nothing but the secrets changes', async () => {
    let called = 0;
    const turn = (async () => { called++; return new Response(JSON.stringify({ iceServers: [{ urls: ['turn:turn.example:3478?transport=udp'], username: 'u', credential: 'c' }] }), { status: 200 }); }) as unknown as typeof fetch;
    const before = await iceGrant(env(), NOW, turn);
    const after = await iceGrant(env({ TURN_KEY_ID: 'key', TURN_KEY_API_TOKEN: 'token' }), NOW, turn);
    expect(before.turn).toBe(false);
    expect(called).toBe(1);
    expect(after.turn).toBe(true);
    expect(after.iceServers.some((s) => s.credential === 'c')).toBe(true);
    // one secret without the other is no key at all
    expect((await iceGrant(env({ TURN_KEY_ID: 'key' }), NOW, turn)).turn).toBe(false);
    expect((await iceGrant(env({ TURN_KEY_API_TOKEN: 'token' }), NOW, turn)).turn).toBe(false);
  });
});
