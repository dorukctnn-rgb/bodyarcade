import { describe, expect, it, vi } from 'vitest';
import { HttpError, json } from './http.ts';
import { Router } from './router.ts';

const ctx = { waitUntil: () => undefined };
const call = (r: Router, method: string, path: string) => r.handle(new Request(`http://x${path}`, { method }), {}, ctx);

describe('Router', () => {
  it('matches literal segments and :params, decoding them', async () => {
    const r = new Router().add('GET', '/api/rooms/:code/seats/:seat', (_req, _env, _ctx, p) => json(p));
    const res = await call(r, 'GET', '/api/rooms/K7P2QX/seats/s%201');
    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({ code: 'K7P2QX', seat: 's 1' });
  });

  it('answers HEAD from GET, 405 with Allow for another method on a known path, 404 JSON for unknown API paths, null for the rest', async () => {
    const r = new Router().add('GET', '/api/a', () => json({ ok: 1 })).add('POST', '/api/a', () => json({ ok: 2 }));
    expect((await call(r, 'HEAD', '/api/a'))?.status).toBe(200);
    const no = await call(r, 'DELETE', '/api/a');
    expect(no?.status).toBe(405);
    expect(no?.headers.get('Allow')).toBe('GET, POST');
    expect(await no?.json()).toEqual({ error: 'method_not_allowed' });
    const unknown = await call(r, 'GET', '/api/nothing');
    expect(unknown?.status).toBe(404);
    expect(await unknown?.json()).toEqual({ error: 'not_found' });
    expect(await call(r, 'GET', '/index.html')).toBeNull();
    expect(await call(r, 'GET', '/')).toBeNull();
  });

  it('turns HttpError into its status and code, any other exception into 500 without leaking it', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const r = new Router()
      .add('GET', '/api/denied', () => { throw new HttpError(403, 'nope', { why: 'x' }); })
      .add('GET', '/api/boom', () => { throw new Error('secret detail'); })
      .add('GET', '/api/late', async () => { await Promise.resolve(); throw new HttpError(409, 'full'); });
    const a = await call(r, 'GET', '/api/denied');
    expect(a?.status).toBe(403);
    expect(await a?.json()).toEqual({ error: 'nope', why: 'x' });
    const b = await call(r, 'GET', '/api/boom');
    expect(b?.status).toBe(500);
    expect(await b?.text()).not.toContain('secret');
    expect((await call(r, 'GET', '/api/late'))?.status).toBe(409);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('refuses two routes for the same method and path, and patterns without a leading slash', () => {
    const r = new Router().add('GET', '/api/a/:x', () => json({}));
    expect(() => r.add('GET', '/api/a/:y', () => json({}))).toThrow(/twice/);
    expect(() => r.add('GET', 'api/b', () => json({}))).toThrow(/start with/);
    expect(r.list()).toEqual(['GET /api/a/:x']);
  });

  it('does not match a bad percent escape or a different segment count', async () => {
    const r = new Router().add('GET', '/api/x/:id', () => json({}));
    expect((await call(r, 'GET', '/api/x/%E0%A4%A'))?.status).toBe(404);
    expect((await call(r, 'GET', '/api/x'))?.status).toBe(404);
    expect((await call(r, 'GET', '/api/x/1/2'))?.status).toBe(404);
  });
});
