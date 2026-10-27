// The page errors of the release layout check (tests/release/support.ts watchErrors): the page's own errors count; the 404 page's
// own 404 does not. A 401 counts wherever it comes from: since release 3 the friends probe (GET /api/social/status) answers 200, so a
// visitor without a profile meets no 401 at all.
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

  it('counts every 401, the old unsigned GET /api/social/me included: no answer of the friends service may print an error any more', () => {
    const p = fakePage();
    const w = watchErrors(p.page);
    p.response('https://example.test/api/social/me', 401);
    p.console(LINE_401);
    expect(w.list()).toEqual([`console: ${LINE_401}`]);
  });
});
