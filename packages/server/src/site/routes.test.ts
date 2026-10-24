import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { Router } from '../router.ts';
import { GAME_ALIASES, cspReport, legacyGameTarget, parseCspReports, registerSiteRoutes } from './routes.ts';

const ctx = { waitUntil: () => undefined };
const ROOT = new URL('../../../../', import.meta.url);

describe('old game addresses', () => {
  const r = new Router();
  registerSiteRoutes(r);
  const get = (path: string) => r.handle(new Request(`https://bodyarcade.com${path}`), {}, ctx);

  it('send every old game address to the home page with a permanent redirect, with or without a trailing slash', async () => {
    for (const p of [...GAME_ALIASES, '/bodyarcade/', '/play/', '/app/']) {
      const res = await get(p);
      expect(res?.status, p).toBe(301);
      expect(res?.headers.get('Location'), p).toBe('https://bodyarcade.com/');
    }
  });

  it('route a receipt activation link to the Pro page and a challenge or a world to the running game, keeping the query', () => {
    expect(legacyGameTarget('?license=ABCD-1234')).toBe('/pro/?license=ABCD-1234');
    expect(legacyGameTarget('?c=eyJuIjoiQSJ9&utm_source=x')).toBe('/games/road-run/?c=eyJuIjoiQSJ9&utm_source=x');
    expect(legacyGameTarget('?world=desert')).toBe('/games/road-run/?world=desert');
    expect(legacyGameTarget('?live=1')).toBe('/');
    expect(legacyGameTarget('?pro=1&ref=mail')).toBe('/?ref=mail');
    expect(legacyGameTarget('')).toBe('/');
  });

  it('answer HEAD like GET and leave the new app and the content pages to the static assets', async () => {
    expect((await r.handle(new Request('https://bodyarcade.com/bodyarcade?license=K', { method: 'HEAD' }), {}, ctx))?.headers.get('Location')).toBe('https://bodyarcade.com/pro/?license=K');
    for (const p of ['/', '/play/road-run/', '/games/road-run/', '/privacy', '/blog/', '/tr/']) expect(await get(p), p).toBeNull();
  });

  it('are exactly the paths both wrangler configs run the Worker first for (besides /api/*, and the invitation and friend-link pages)', () => {
    for (const file of ['wrangler.jsonc', 'wrangler.prod.jsonc']) {
      const text = readFileSync(new URL(file, ROOT), 'utf8').replace(/^\s*\/\/.*$/gm, '');
      const cfg = JSON.parse(text) as { assets: { run_worker_first: string[] } };
      // /r/CODE (live play) and /f/BA-XXXXXX (friends): the Worker serves the start page under the address a player shares, so
      // without these two entries every shared link is a 404 from the static assets
      const expected = ['/api/*', '/r/*', '/f/*', ...GAME_ALIASES.flatMap((p) => (p.includes('.') ? [p] : [p, `${p}/`]))];
      expect(cfg.assets.run_worker_first.slice().sort(), file).toEqual(expected.sort());
    }
  });
});

describe('CSP reports', () => {
  const legacy = JSON.stringify({ 'csp-report': { 'document-uri': 'https://bodyarcade.com/games/x/?k=secret', 'violated-directive': 'script-src-elem', 'effective-directive': 'script-src-elem', 'blocked-uri': 'https://evil.example/a.js?q=1', 'source-file': 'https://bodyarcade.com/static/main.js', 'line-number': 12 } });
  const modern = JSON.stringify([
    { type: 'csp-violation', body: { documentURL: 'https://bodyarcade.com/pro/', effectiveDirective: 'connect-src', blockedURL: 'wss://other.example/ws', sourceFile: 'https://bodyarcade.com/static/net.js', lineNumber: 3 } },
    { type: 'deprecation', body: {} },
    { type: 'csp-violation', body: { documentURL: 'https://bodyarcade.com/', effectiveDirective: 'script-src-elem', blockedURL: 'inline' } },
  ]);

  it('keep only the directive, the blocked origin and the page path (no query strings, no full URLs)', () => {
    expect(parseCspReports(legacy)).toEqual([{ directive: 'script-src-elem', blocked: 'https://evil.example', page: '/games/x/', source: '/static/main.js:12' }]);
    expect(parseCspReports(modern)).toEqual([
      { directive: 'connect-src', blocked: 'wss://other.example', page: '/pro/', source: '/static/net.js:3' },
      { directive: 'script-src-elem', blocked: 'inline', page: '/', source: '' },
    ]);
    expect(parseCspReports('not json')).toEqual([]);
    expect(parseCspReports('{"x":1}')).toEqual([]);
  });

  it('answer 204, refuse a body over 16 KB with 413, and log at most 30 lines a minute', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const post = (body: string, now: number) => cspReport(new Request('https://bodyarcade.com/api/csp-report', { method: 'POST', headers: { 'Content-Type': 'application/csp-report' }, body }), now);
      expect((await post(legacy, 1_000_000)).status).toBe(204);
      expect(log).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({ evt: 'csp', directive: 'script-src-elem' });
      expect((await post('x'.repeat(16_385), 1_000_001)).status).toBe(413);
      for (let i = 0; i < 40; i++) await post(legacy, 1_000_002);
      expect(log).toHaveBeenCalledTimes(30);
      await post(legacy, 1_070_000);
      expect(log).toHaveBeenCalledTimes(31);
    } finally {
      log.mockRestore();
    }
  });

  it('is reachable through the router as POST only', async () => {
    const r = new Router();
    registerSiteRoutes(r);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      expect((await r.handle(new Request('https://bodyarcade.com/api/csp-report', { method: 'POST', body: legacy }), {}, ctx))?.status).toBe(204);
      expect((await r.handle(new Request('https://bodyarcade.com/api/csp-report'), {}, ctx))?.status).toBe(405);
    } finally {
      log.mockRestore();
    }
  });
});
