// The key sync tool: only a public key can pass through it, and what it writes is exactly what keys.ts holds.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PUBLIC_KEYS } from '../../packages/core/entitlements/keys.ts';

interface Key { kid: string; jwk: Record<string, string> }
interface Tool {
  toTokenKey(jwk: unknown): Key;
  render(keys: Record<string, Key[]>): string;
  replaceBlock(source: string, block: string): string;
  TARGETS: string[];
}
const tool = (): Promise<Tool> => import(/* @vite-ignore */ new URL('./sync-public-keys.mjs', import.meta.url).href) as Promise<Tool>;

const GOOD = { kty: 'EC', crv: 'P-256', x: 'QWUk6OCz1Zjblm44Uar36Ynkra31V93h0q-I3aN8Hm0', y: 'wsQUrqs16cujiY0fBScyvmA9xvOAFcuO_NCE9ZT4WAU', alg: 'ES256', use: 'sig', kid: 'Cgb4lPBL' };

describe('tools/entitlements/sync-public-keys.mjs', () => {
  it('turns a public JWK file into the key the app takes, and drops the rest', async () => {
    expect((await tool()).toTokenKey(GOOD)).toEqual({ kid: 'Cgb4lPBL', jwk: { kty: 'EC', crv: 'P-256', x: GOOD.x, y: GOOD.y } });
  });

  it('refuses a private key without printing it', async () => {
    const t = await tool();
    let message = '';
    try { t.toTokenKey({ ...GOOD, d: 'SECRETSECRETSECRETSECRETSECRETSECRETSECRET1' }); } catch (e) { message = String(e); }
    expect(message).toContain('private');
    expect(message).not.toContain('SECRET');
  });

  it.each([
    [null], ['text'], [{ ...GOOD, kty: 'RSA' }], [{ ...GOOD, crv: 'P-384' }], [{ ...GOOD, x: undefined }], [{ ...GOOD, y: '' }], [{ ...GOOD, kid: 'a b' }], [{ ...GOOD, kid: undefined }],
  ])('refuses a file that is not a P-256 public key: %j', async (bad) => {
    const t = await tool();
    expect(() => t.toTokenKey(bad)).toThrow();
  });

  it('writes what keys.ts holds, so the file in the repository is what the tool would make', async () => {
    const t = await tool();
    const block = t.render(PUBLIC_KEYS as unknown as Record<string, Key[]>);
    const source = readFileSync(new URL('../../packages/core/entitlements/keys.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    expect(t.replaceBlock(source, block)).toBe(source);
    expect(source).toContain(block);
  });

  it('replaces only the block between its markers, and keeps the line endings of the file', async () => {
    const t = await tool();
    const keys = { preview: [{ kid: 'AAAA1111', jwk: { kty: 'EC', crv: 'P-256', x: 'xxxx', y: 'yyyy' } }], production: [{ kid: 'BBBB2222', jwk: { kty: 'EC', crv: 'P-256', x: 'xxxx', y: 'yyyy' } }] };
    const src = 'before\n// BEGIN public keys (written by tools/entitlements/sync-public-keys.mjs)\nold\n// END public keys\nafter\n';
    const out = t.replaceBlock(src, t.render(keys));
    expect(out.startsWith('before\n') && out.endsWith('\nafter\n')).toBe(true);
    expect(out).toContain("kid: 'AAAA1111'");
    expect(out).not.toContain('old');
    expect(t.replaceBlock(src.replace(/\n/g, '\r\n'), t.render(keys))).toContain('\r\n');
    expect(() => t.replaceBlock('no markers here', t.render(keys))).toThrow(/markers/);
  });
});
