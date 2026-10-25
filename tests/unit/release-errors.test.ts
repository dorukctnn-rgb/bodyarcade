// The page errors of the release layout check (tests/release/support.ts watchErrors): the page's own errors count; the 404 page's
// own 404 and the friends probe's 401 (the shell asks GET /api/social/me with no signature; a 401 is the service saying it is there)
// do not. Chromium logs that 401 as a console line without its address, so one line is forgiven per 401 the probe really got.
import { describe, expect, it } from 'vitest';
import { watchErrors } from '../release/support.ts';

type Handler = (arg: never) => void;

function fakePage() {
  const on: Record<string, Handler[]> = {};
  const page = { on: (event: string, cb: Handler) => { (on[event] ??= []).push(cb); return page; } };
  const emit = (event: string, arg: unknown): void => { for (const cb of on[event] ?? []) cb(arg as never); };
  return {
    page,
    console: (text: string, type = 'error') => emit('console', { type: () => type, text: () => text }),
    response: (url: string, status: number, method = 'GET') => emit('response', { status: () => status, url: () => url, request: () => ({ method: () => method }) }),
    pageerror: (message: string) => emit('pageerror', new Error(message)),
  };
}

const LINE_401 = 'Failed to load resource: the server responded with a status of 401 ()';
const LINE_404 = 'Failed to load resource: the server responded with a status of 404 ()';

describe('watchErrors', () => {
  it('keeps uncaught errors and console errors, and ignores other console types', () => {
    const p = fakePage();
    const w = watchErrors(p.page);
    p.pageerror('boom');
    p.console('Uncaught TypeError: x is undefined');
    p.console('just a note', 'warning');
    expect(w.list()).toEqual(['pageerror: boom', 'console: Uncaught TypeError: x is undefined']);
  });

  it('does not count the 404 page answering 404', () => {
    const p = fakePage();
    const w = watchErrors(p.page);
    p.console(LINE_404);
    expect(w.list()).toEqual([]);
  });

  it("forgives the friends probe's 401, whichever comes first, the console line or the answer", () => {
    const p = fakePage();
    const w = watchErrors(p.page);
    p.console(LINE_401);
    p.response('https://example.test/api/social/me', 401);
    p.response('https://example.test/api/social/me', 401);
    p.console(LINE_401);
    expect(w.list()).toEqual([]);
  });

  it('counts a 401 that is not the probe: another address, another method, or more lines than probe answers', () => {
    const other = fakePage();
    const w1 = watchErrors(other.page);
    other.response('https://example.test/api/rooms', 401, 'POST');
    other.response('https://example.test/api/social/me', 401, 'POST');
    other.response('https://example.test/api/social/me/friends', 401);
    other.console(LINE_401);
    expect(w1.list()).toEqual([`console: ${LINE_401}`]);

    const more = fakePage();
    const w2 = watchErrors(more.page);
    more.response('https://example.test/api/social/me?x=1', 401);
    more.console(LINE_401);
    more.console(LINE_401);
    expect(w2.list()).toEqual([`console: ${LINE_401}`]);
  });
});
