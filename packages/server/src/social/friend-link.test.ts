// A friend link opens the app: the Worker serves the start page under /f/<code>. Without this route (and "/f/*" in the
// wrangler config's run_worker_first) every link a player shares is a 404 from the static assets. The page is the Worker's own
// (it never reaches the directory object: nothing in it depends on a player).
import { describe, expect, it, vi } from 'vitest';
import { friendLink, parseFriendLink } from '../../../core/social/codes.ts';
import { createDirectoryHarness, TEST_ORIGIN } from './testkit.ts';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const SHELL = '<!doctype html><title>BodyArcade</title><div id="app"></div>';

/** A stand-in for the ASSETS binding: answers every path with `status`, and remembers what was asked. */
function assets(status = 200, headers: Record<string, string> = { 'Content-Type': 'text/html; charset=utf-8', 'X-Frame-Options': 'DENY' }) {
  const asked: string[] = [];
  const fetcher = {
    fetch: async (input: Request | string): Promise<Response> => {
      asked.push(new URL(typeof input === 'string' ? input : input.url).pathname);
      return new Response(status >= 300 && status < 400 ? null : SHELL, { status, headers });
    },
  };
  return { asked, fetcher };
}

describe('the page under a friend link', () => {
  it('is the start page of the app (asked for as /), kept out of search results and sent without a referrer', async () => {
    const a = assets();
    const h = createDirectoryHarness({ env: { ASSETS: a.fetcher } });
    const link = friendLink(TEST_ORIGIN, 'ABCDEF');
    expect(link).toBe(`${TEST_ORIGIN}/f/BA-ABCDEF`);
    const r = await h.call('GET', new URL(link).pathname);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe(SHELL);
    expect(a.asked).toEqual(['/']);
    expect(r.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    expect(r.headers.get('Cache-Control')).toBe('no-cache');
    expect(r.headers.get('Referrer-Policy')).toBe('no-referrer');
    // what the site's own headers said stays
    expect(r.headers.get('Content-Type')).toContain('text/html');
    expect(r.headers.get('X-Frame-Options')).toBe('DENY');
    // the page finds the code in its own address
    expect(parseFriendLink(link)).toBe('ABCDEF');
    expect(parseFriendLink(`${TEST_ORIGIN}/f/ba-abcdef/`)).toBe('ABCDEF');
    // and the directory was never asked
    expect(h.calls).toHaveLength(0);
  });

  it('is served for any code (the page tells the player when it is not one), with or without a closing slash, and the route is registered once', async () => {
    const a = assets();
    const h = createDirectoryHarness({ env: { ASSETS: a.fetcher } });
    for (const code of ['BA-ZZZZZZ', 'ba-7k2q4x', 'nonsense', '%E2%9C%93', 'BA-ABCDEF/']) {
      const r = await h.call('GET', `/f/${code}`);
      expect(r.status, code).toBe(200);
      expect(await r.text(), code).toBe(SHELL);
    }
    expect(h.worker.list().filter((x) => x === 'GET /f/:code')).toHaveLength(1);
    // a link with nothing after /f/ is no link: the router leaves it to the static assets
    const ctx = { waitUntil: () => undefined };
    expect(await h.worker.handle(new Request(`${TEST_ORIGIN}/f/`), h.env, ctx)).toBeNull();
    expect(await h.worker.handle(new Request(`${TEST_ORIGIN}/f/BA-ABCDEF/more`), h.env, ctx)).toBeNull();
  });

  it('is not made without the static assets, and an answer that redirects is not passed on', async () => {
    const bare = createDirectoryHarness();
    expect((await bare.call('GET', '/f/BA-ABCDEF')).status).toBe(404);
    const moved = assets(301, { Location: '/index.html', 'Content-Type': 'text/html' });
    const h = createDirectoryHarness({ env: { ASSETS: moved.fetcher } });
    const r = await h.call('GET', '/f/BA-ABCDEF');
    expect(r.status).toBe(503);
    expect(await r.text()).toBe('unavailable');
    expect(r.headers.get('Location')).toBeNull();
  });
});
