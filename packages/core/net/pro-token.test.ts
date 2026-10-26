import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MAX_PRO_TOKEN_CHARS, currentProToken } from './pro-token.ts';

describe('the Pro token as live play reads it', () => {
  it('is the text the app holds, and nothing when the app holds none', () => {
    expect(currentProToken(() => 'a.b.c')).toBe('a.b.c');
    for (const none of [null, undefined, '']) expect(currentProToken(() => none)).toBeNull();
    expect(currentProToken(undefined)).toBeNull();
  });

  it('is nothing for a reader that throws or answers with what is no token text, so a room never breaks on the entitlement layer', () => {
    expect(currentProToken(() => { throw new Error('the entitlement layer is down'); })).toBeNull();
    for (const odd of [true, 1, {}, ['x'], Symbol('x')]) expect(currentProToken((() => odd) as never)).toBeNull();
  });

  it('is nothing for a text no entitlement token can be (it would not fit a request body)', () => {
    expect(currentProToken(() => 'x'.repeat(MAX_PRO_TOKEN_CHARS))).toHaveLength(MAX_PRO_TOKEN_CHARS);
    expect(currentProToken(() => 'x'.repeat(MAX_PRO_TOKEN_CHARS + 1))).toBeNull();
    expect(currentProToken(() => 'x'.repeat(1_000_000))).toBeNull();
  });

  it('agrees with the longest token the entitlement module accepts', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(path.resolve(here, '../entitlements/token.ts'), 'utf8');
    const limit = /const MAX_TOKEN_CHARS = (\d+);/.exec(source)?.[1];
    expect(limit, 'MAX_TOKEN_CHARS in core/entitlements/token.ts').toBeDefined();
    expect(MAX_PRO_TOKEN_CHARS).toBe(Number(limit));
  });
});
