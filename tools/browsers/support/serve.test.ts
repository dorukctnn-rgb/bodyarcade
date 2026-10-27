import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { headersFor, parseHeaders, startSite } from './serve.ts';

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

describe('the Worker stand-in of the release site', () => {
  async function ask(standIn: boolean, path: string): Promise<{ status: number; type: string; body: string }> {
    const dir = mkdtempSync(join(tmpdir(), 'ba-serve-'));
    writeFileSync(join(dir, 'index.html'), '<p>home</p>');
    const server = await startSite(dir, 0, '404', undefined, standIn);
    try {
      const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`);
      return { status: res.status, type: res.headers.get('content-type') ?? '', body: await res.text() };
    } finally { server.close(); }
  }
  it('answers the question whether the friends service is there the way the Worker does: 200 {"service":"social"}', async () => {
    const r = await ask(true, '/api/social/status');
    expect(r.status).toBe(200);
    expect(r.type).toContain('json');
    expect(JSON.parse(r.body)).toEqual({ service: 'social' });
  });
  it('answers any other call to the friends service with no signature the way the Worker does: 401 and a JSON error', async () => {
    const r = await ask(true, '/api/social/me');
    expect(r.status).toBe(401);
    expect(r.type).toContain('json');
    expect(JSON.parse(r.body)).toEqual({ error: 'unauthorized' });
  });
  it('is off for the practice site, where a plain 404 is what a static host says and the page takes the service for absent', async () => {
    expect((await ask(false, '/api/social/status')).status).toBe(404);
    expect((await ask(false, '/api/social/me')).status).toBe(404);
  });
  it('leaves every other address to the folder', async () => {
    expect((await ask(true, '/')).body).toContain('home');
    expect((await ask(true, '/api/other')).status).toBe(404);
  });
});
