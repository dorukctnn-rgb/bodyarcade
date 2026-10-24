// The entitlement module as the Worker really has it: the shared router built by src/index.ts (every module registered
// on it, the way production runs), the Durable Object class the migration names, and the two wrangler files that bind it.
// The other test files of this folder use a router of their own; this one is the proof that the module is on the real one.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { API } from '../../../core/entitlements/api.ts';
import type { DurableObjectIdLike, Fetcher } from '../cf.ts';
import worker, { EntitlementsDO } from '../index.ts';
import { router } from '../router.ts';

const ctx = { waitUntil: () => undefined };
const root = (file: string): string => fileURLToPath(new URL(`../../../../${file}`, import.meta.url));

/** wrangler.jsonc as data: its comments and trailing commas removed, strings left alone. */
function readJsonc(file: string): Record<string, unknown> {
  const text = readFileSync(root(file), 'utf8');
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i] as string;
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2) + 2;
    } else {
      out += c;
      i++;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1')) as Record<string, unknown>;
}

/** An ENTITLEMENTS binding that only records what the Worker handed to it. */
function binding(answer: () => Response = () => new Response('{"keys":[],"reminders":false}', { status: 200, headers: { 'Content-Type': 'application/json' } })) {
  const seen: { url: string; method: string; body: unknown }[] = [];
  const names: string[] = [];
  const stub: Fetcher = {
    fetch: async (input, init) => {
      const req = input instanceof Request ? input : new Request(input, init);
      const text = req.method === 'GET' ? '' : await req.text();
      seen.push({ url: req.url, method: req.method, body: text ? JSON.parse(text) : null });
      return answer();
    },
  };
  return {
    seen, names,
    ns: { idFromName: (name: string): DurableObjectIdLike => { names.push(name); return { toString: () => name }; }, get: () => stub },
  };
}

describe('the real router', () => {
  it('carries every route of the contract, with the method the app uses', () => {
    const listed = router.list();
    for (const path of [API.activate, API.refresh, API.play, API.deactivate, API.reset, API.reminder]) expect(listed, path).toContain(`POST ${path}`);
    expect(listed).toContain(`GET ${API.key}`);
  });

  it('has no entitlement route that the contract does not name', () => {
    const mine = router.list().filter((r) => r.includes('/api/entitlements/'));
    expect(mine.map((r) => r.split(' ')[1]).sort()).toEqual(Object.values(API).sort());
  });

  it('sits next to the live and social modules without taking or giving up a path', () => {
    const listed = router.list();
    expect(listed.some((r) => r.includes('/api/rooms'))).toBe(true);
    expect(listed.some((r) => r.includes('/api/social/'))).toBe(true);
    expect(new Set(listed).size).toBe(listed.length);
  });
});

describe('the Worker entry', () => {
  it('hands an activation to the one Durable Object, with the caller\'s address, and returns its answer unchanged', async () => {
    const b = binding(() => new Response('{"token":"t","plan":"pro-yearly","devices":{"used":1,"limit":3}}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const req = new Request(`https://bodyarcade.test${API.activate}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.9' },
      body: JSON.stringify({ key: 'AAAAAAAA-BBBBBBBB-CCCCCCCC-DDDDDDDD', did: '0123456789abcdef0123456789abcdef' }),
    });
    const res = await worker.fetch(req, { ENTITLEMENTS: b.ns }, ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ token: 't', plan: 'pro-yearly', devices: { used: 1, limit: 3 } });
    expect(b.names).toEqual(['main']);
    expect(b.seen).toHaveLength(1);
    expect(b.seen[0]).toMatchObject({ url: 'https://entitlements.internal/activate', method: 'POST', body: { key: 'AAAAAAAA-BBBBBBBB-CCCCCCCC-DDDDDDDD', did: '0123456789abcdef0123456789abcdef', ip: '203.0.113.9' } });
  });

  it('reaches the public keys and the reminder route as well', async () => {
    const b = binding();
    const keys = await worker.fetch(new Request(`https://bodyarcade.test${API.key}`), { ENTITLEMENTS: b.ns }, ctx);
    expect(keys.status).toBe(200);
    expect(b.seen[0]).toMatchObject({ url: 'https://entitlements.internal/key', method: 'GET' });
    const token = `${'a'.repeat(30)}.${'b'.repeat(30)}.${'c'.repeat(30)}`;
    const rem = await worker.fetch(new Request(`https://bodyarcade.test${API.reminder}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, did: '0123456789abcdef0123456789abcdef', email: 'alice@example.com', lang: 'tr' }),
    }), { ENTITLEMENTS: b.ns }, ctx);
    expect(rem.status).toBe(200);
    expect(b.seen[1]).toMatchObject({ url: 'https://entitlements.internal/reminder', body: { email: 'alice@example.com', lang: 'tr' } });
  });

  it('says "unavailable" when the Worker has no binding, and does not fall through to the static assets', async () => {
    let assetsAsked = false;
    const assets: Fetcher = { fetch: async () => { assetsAsked = true; return new Response('<html>asset</html>'); } };
    const res = await worker.fetch(new Request(`https://bodyarcade.test${API.key}`), { ASSETS: assets }, ctx);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'unavailable' });
    expect(assetsAsked).toBe(false);
  });

  it('answers an API path nobody serves with a JSON 404, not with the app', async () => {
    const res = await worker.fetch(new Request('https://bodyarcade.test/api/entitlements/nothing'), { ENTITLEMENTS: binding().ns }, ctx);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('exports the Durable Object class under the name the migration uses', () => {
    expect(typeof EntitlementsDO).toBe('function');
    expect(EntitlementsDO.name).toBe('EntitlementsDO');
  });
});

describe.each(['wrangler.jsonc', 'wrangler.prod.jsonc'])('%s', (file) => {
  const config = readJsonc(file);
  const bindings = ((config['durable_objects'] as { bindings?: { name: string; class_name: string }[] } | undefined)?.bindings ?? []);
  const migrations = (config['migrations'] as { tag: string; new_sqlite_classes?: string[]; new_classes?: string[] }[] | undefined) ?? [];

  it('binds ENTITLEMENTS to the class the Worker exports', () => {
    expect(bindings).toContainEqual({ name: 'ENTITLEMENTS', class_name: 'EntitlementsDO' });
  });

  it('has a migration that creates the class as a SQLite class, once, with a tag no other migration uses', () => {
    const creating = migrations.filter((m) => (m.new_sqlite_classes ?? []).includes('EntitlementsDO'));
    expect(creating).toHaveLength(1);
    expect(migrations.some((m) => (m.new_classes ?? []).includes('EntitlementsDO'))).toBe(false);
    expect(new Set(migrations.map((m) => m.tag)).size).toBe(migrations.length);
  });

  it('sends /api/* to the Worker before the static assets', () => {
    const first = (config['assets'] as { run_worker_first?: unknown } | undefined)?.run_worker_first;
    expect(Array.isArray(first) ? first : []).toContain('/api/*');
  });

  it('keeps the signing key out of the file: it is a secret, never a variable', () => {
    const text = readFileSync(root(file), 'utf8');
    expect(text).not.toMatch(/ENT_PRIV_JWK|PLAY_SA_JSON|ENT_MAIL_TOKEN/);
    const vars = (config['vars'] as Record<string, unknown> | undefined) ?? {};
    for (const k of Object.keys(vars)) expect(k).not.toMatch(/PRIV|SECRET|TOKEN|_SA_/i);
  });
});
