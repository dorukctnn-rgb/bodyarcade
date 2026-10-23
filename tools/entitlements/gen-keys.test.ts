// The key tool makes keys the token code accepts, and prints nothing when it is only imported.
import { describe, expect, it } from 'vitest';
import { importSigningKey, parsePrivateJwk, publicKeyOf, signToken, thumbprint } from '../../packages/core/entitlements/sign.ts';
import { MAX_TOKEN_TTL_S, TOKEN_AUD, TOKEN_ISS, verifyToken, type TokenKey } from '../../packages/core/entitlements/token.ts';

interface Tool { generate(): Promise<{ kid: string; privateJwk: Record<string, string>; publicKey: TokenKey }>; thumbprint(j: JsonWebKey): Promise<string> }

describe('tools/entitlements/gen-keys.mjs', () => {
  it('makes a pair that signs and verifies tokens, with the same key name the Worker computes', async () => {
    const tool = (await import(/* @vite-ignore */ new URL('./gen-keys.mjs', import.meta.url).href)) as Tool;
    const { kid, privateJwk, publicKey } = await tool.generate();
    expect(kid).toBe(await thumbprint(publicKey.jwk));
    expect(kid).toBe(publicKey.kid);
    const parsed = parsePrivateJwk(JSON.stringify(privateJwk));
    expect(parsed).not.toBeNull();
    expect(publicKeyOf(parsed as NonNullable<typeof parsed>)).toEqual(publicKey);
    expect(JSON.stringify(publicKey)).not.toContain('"d"');

    const nowS = Math.floor(Date.now() / 1000);
    const token = await signToken({ iss: TOKEN_ISS, aud: TOKEN_AUD, sub: 'a'.repeat(64), did: 'b'.repeat(32), plan: 'pro-monthly', src: 'gumroad', feat: ['pro'], chk: nowS, iat: nowS, exp: nowS + MAX_TOKEN_TTL_S - 60 },
      await importSigningKey(parsed as NonNullable<typeof parsed>), kid);
    expect((await verifyToken(token, { keys: [publicKey], now: Date.now() })).ok).toBe(true);
  });

  it('makes a different pair every time', async () => {
    const tool = (await import(/* @vite-ignore */ new URL('./gen-keys.mjs', import.meta.url).href)) as Tool;
    expect((await tool.generate()).kid).not.toBe((await tool.generate()).kid);
  });
});
