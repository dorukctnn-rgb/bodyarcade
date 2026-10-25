import { describe, expect, it } from 'vitest';
import { headersFor, parseHeaders } from './serve.ts';

const FILE = `# a comment
/*
  X-Frame-Options: SAMEORIGIN
  Content-Security-Policy-Report-Only: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'
  Cache-Control: no-cache
/static/*
  Cache-Control: public, max-age=31536000, immutable
/sw.js
  Cache-Control: public, max-age=0, must-revalidate
/*.png
  Cache-Control: public, max-age=2592000
/.well-known/assetlinks.json
  Content-Type: application/json
`;

describe('_headers rules', () => {
  const rules = parseHeaders(FILE);
  it('reads a pattern and the indented header lines under it, a value may hold colons and semicolons', () => {
    expect(rules).toHaveLength(5);
    expect(rules[0]?.headers['Content-Security-Policy-Report-Only']).toBe("default-src 'self'; script-src 'self' 'wasm-unsafe-eval'");
  });
  it('gives a path the rules it matches, later rules over earlier ones', () => {
    expect(headersFor(rules, '/')['X-Frame-Options']).toBe('SAMEORIGIN');
    expect(headersFor(rules, '/static/main-abc.js')['Cache-Control']).toContain('immutable');
    expect(headersFor(rules, '/sw.js')['Cache-Control']).toContain('must-revalidate');
    expect(headersFor(rules, '/icon-192.png')['Cache-Control']).toContain('2592000');
    expect(headersFor(rules, '/privacy')['Cache-Control']).toBe('no-cache');
  });
  it('escapes the dots of a pattern: /sw.js is not /swXjs, and a dot directory is a dot directory', () => {
    expect(headersFor(rules, '/swXjs')['Cache-Control']).toBe('no-cache');
    expect(headersFor(rules, '/.well-known/assetlinks.json')['Content-Type']).toBe('application/json');
    expect(headersFor(rules, '/xwell-known/assetlinks.json')['Content-Type']).toBeUndefined();
  });
});
