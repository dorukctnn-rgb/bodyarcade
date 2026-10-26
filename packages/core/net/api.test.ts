import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_TIMEOUT_MS, LiveApiError, createRoom, fetchIce, joinRoom, previewRoom } from './api.ts';

const who = { pid: 'device-0001', name: 'Sam', age: 'adult' as const };
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => { vi.useRealTimers(); });

describe('the HTTP side of live play', () => {
  it('posts the identity with the room request and returns the grant', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fetcher = (async (url: string, init: RequestInit) => { seen = { url, init }; return json({ code: 'K7P2QX', ticket: 't' }); }) as unknown as typeof fetch;
    const g = await createRoom('https://x.test', who, { gameId: 'squat-flap', size: 2 }, fetcher);
    expect(g).toMatchObject({ code: 'K7P2QX' });
    expect(seen).not.toBeNull();
    const s = seen as unknown as { url: string; init: RequestInit };
    expect(s.url).toBe('https://x.test/api/rooms');
    expect(s.init.method).toBe('POST');
    expect(JSON.parse(String(s.init.body))).toMatchObject({ gameId: 'squat-flap', size: 2, pid: 'device-0001', name: 'Sam', age: 'adult' });
  });

  it('turns an error body into LiveApiError(status, code) and a bad body into http_<status>', async () => {
    await expect(joinRoom('https://x.test', 'K7P2QX', who, (async () => json({ error: 'full' }, 409)) as unknown as typeof fetch)).rejects.toMatchObject({ status: 409, code: 'full' });
    await expect(previewRoom('https://x.test', 'K7P2QX', (async () => new Response('<html>', { status: 502 })) as unknown as typeof fetch)).rejects.toMatchObject({ status: 502, code: 'http_502' });
  });

  it('reports a network failure as status 0, code network', async () => {
    const e = await fetchIce('https://x.test', (async () => { throw new TypeError('failed to fetch'); }) as unknown as typeof fetch).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(LiveApiError);
    expect(e).toMatchObject({ status: 0, code: 'network' });
  });

  it('gives up on a request that never answers after 15 s, with code timeout', async () => {
    vi.useFakeTimers();
    const hang = ((_url: string, init: RequestInit) => new Promise((_res, rej) => {
      init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
    })) as unknown as typeof fetch;
    const p = joinRoom('https://x.test', 'K7P2QX', who, hang).catch((x: unknown) => x);
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS - 100);
    let settled = false;
    void p.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(10);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(await p).toMatchObject({ status: 0, code: 'timeout' });
  });

  it('a fast answer leaves no timer behind', async () => {
    vi.useFakeTimers();
    await previewRoom('https://x.test', 'K7P2QX', (async () => json({ code: 'K7P2QX' })) as unknown as typeof fetch);
    expect(vi.getTimerCount()).toBe(0);
  });
});
