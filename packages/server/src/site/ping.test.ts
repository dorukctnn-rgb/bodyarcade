import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { Router } from '../router.ts';
import { PINGS_PER_MINUTE, PING_BINDINGS, createLimiter, parseSignal, ping, registerPing, type DatasetLike } from './ping.ts';

const ctx = { waitUntil: () => undefined };
const ORIGIN = 'https://bodyarcade.com';
const ROOT = new URL('../../../../', import.meta.url);

interface Written { blobs?: string[]; doubles?: number[]; indexes?: string[] }
const dataset = (): { ds: DatasetLike; points: Written[] } => {
  const points: Written[] = [];
  return { ds: { writeDataPoint: (p) => { points.push(p); } }, points };
};

const post = (body: unknown, o: { type?: string; origin?: string | null; ip?: string; raw?: string } = {}): Request => {
  const headers: Record<string, string> = { 'Content-Type': o.type ?? 'application/json' };
  if (o.origin !== null) headers['Origin'] = o.origin ?? ORIGIN;
  if (o.ip) headers['CF-Connecting-IP'] = o.ip;
  return new Request(`${ORIGIN}/api/ping`, { method: 'POST', headers, body: o.raw ?? JSON.stringify(body) });
};

describe('parseSignal', () => {
  it('takes exactly the two keys, a known event and a game id written like a game folder', () => {
    expect(parseSignal({ e: 'game_start', g: 'road-run' })).toEqual({ e: 'game_start', g: 'road-run' });
    expect(parseSignal({ g: 'knee-sprint', e: 'run_finished' })).toEqual({ e: 'run_finished', g: 'knee-sprint' });
    expect(parseSignal({ e: 'game_start', g: 'squat-flap2' })).not.toBeNull();
  });

  it('refuses anything else: other events, extra keys, odd game ids, other types', () => {
    for (const bad of [
      null, undefined, 'game_start', 42, [], [{ e: 'game_start', g: 'x' }],
      {}, { e: 'game_start' }, { g: 'road-run' },
      { e: 'page_view', g: 'road-run' }, { e: '', g: 'road-run' }, { e: 'GAME_START', g: 'road-run' }, { e: 1, g: 'road-run' },
      { e: 'game_start', g: '' }, { e: 'game_start', g: 'Road-Run' }, { e: 'game_start', g: 'road run' }, { e: 'game_start', g: '-road' },
      { e: 'game_start', g: 'road--run' }, { e: 'game_start', g: 'road-run-' }, { e: 'game_start', g: '../x' }, { e: 'game_start', g: 'a'.repeat(41) },
      { e: 'game_start', g: 7 }, { e: 'game_start', g: ['road-run'] },
      { e: 'game_start', g: 'road-run', name: 'Ada' }, { e: 'game_start', g: 'road-run', score: 120 },
    ]) expect(parseSignal(bad), JSON.stringify(bad)).toBeNull();
    expect(parseSignal({ e: 'game_start', g: 'a'.repeat(40) })).not.toBeNull();
  });
});

describe('POST /api/ping', () => {
  const log = () => vi.spyOn(console, 'log').mockImplementation(() => undefined);

  it('answers 204, writes one data point to the dataset of its event and one log line, and keeps nothing else', async () => {
    const spy = log();
    try {
      const start = dataset();
      const finish = dataset();
      const env = { PING_START: start.ds, PING_FINISH: finish.ds };
      const a = await ping(post({ e: 'game_start', g: 'road-run' }, { ip: '203.0.113.7' }), env, createLimiter());
      expect(a.status).toBe(204);
      expect(a.headers.get('Cache-Control')).toBe('no-store');
      expect(await a.text()).toBe('');
      expect(start.points).toEqual([{ blobs: ['road-run'], doubles: [1], indexes: ['road-run'] }]);
      expect(finish.points).toEqual([]);
      expect((await ping(post({ e: 'run_finished', g: 'knee-sprint' }), env, createLimiter())).status).toBe(204);
      expect(finish.points).toEqual([{ blobs: ['knee-sprint'], doubles: [1], indexes: ['knee-sprint'] }]);
      // no network address, user agent or country anywhere in what was written or logged
      const everything = JSON.stringify([start.points, finish.points, spy.mock.calls]);
      expect(everything).not.toContain('203.0.113.7');
      expect(spy.mock.calls.map((c) => JSON.parse(String(c[0])))).toEqual([{ evt: 'ping', e: 'game_start', g: 'road-run' }, { evt: 'ping', e: 'run_finished', g: 'knee-sprint' }]);
    } finally {
      spy.mockRestore();
    }
  });

  it('still answers 204 with only the log line when there is no dataset, and when the dataset throws', async () => {
    const spy = log();
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect((await ping(post({ e: 'game_start', g: 'road-run' }), {}, createLimiter())).status).toBe(204);
      const broken: DatasetLike = { writeDataPoint: () => { throw new Error('quota'); } };
      expect((await ping(post({ e: 'game_start', g: 'road-run' }), { PING_START: broken }, createLimiter())).status).toBe(204);
      expect(spy).toHaveBeenCalledTimes(2);
      expect(err).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
      err.mockRestore();
    }
  });

  it('refuses a bad body with 400 and writes nothing', async () => {
    const spy = log();
    try {
      const { ds, points } = dataset();
      const env = { PING_START: ds, PING_FINISH: ds };
      for (const body of [{ e: 'game_start' }, { e: 'x', g: 'road-run' }, { e: 'game_start', g: 'road-run', extra: 1 }, [], 'x']) {
        const res = await ping(post(body), env, createLimiter()).catch((e: { status: number; code: string }) => e);
        expect((res as { status: number }).status, JSON.stringify(body)).toBe(400);
      }
      const malformed = await ping(post(null, { raw: '{"e":' }), env, createLimiter()).catch((e: { status: number }) => e);
      expect((malformed as { status: number }).status).toBe(400);
      expect(points).toEqual([]);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('refuses a body over 256 bytes (413) and a body that is not JSON (415)', async () => {
    const big = JSON.stringify({ e: 'game_start', g: 'road-run', pad: 'x'.repeat(300) });
    const tooBig = await ping(post(null, { raw: big }), {}, createLimiter()).catch((e: { status: number }) => e);
    expect((tooBig as { status: number }).status).toBe(413);
    const wrongType = await ping(post({ e: 'game_start', g: 'road-run' }, { type: 'text/html' }), {}, createLimiter()).catch((e: { status: number }) => e);
    expect((wrongType as { status: number }).status).toBe(415);
  });

  it('refuses a page of another site (Origin) and lets a request without an Origin through', async () => {
    const spy = log();
    try {
      const other = await ping(post({ e: 'game_start', g: 'road-run' }, { origin: 'https://evil.example' }), {}, createLimiter()).catch((e: { status: number }) => e);
      expect((other as { status: number }).status).toBe(403);
      expect((await ping(post({ e: 'game_start', g: 'road-run' }, { origin: null }), {}, createLimiter())).status).toBe(204);
    } finally {
      spy.mockRestore();
    }
  });

  it('holds one sender to the limit per minute, counts malformed posts too, and starts again after the minute', async () => {
    const spy = log();
    try {
      const limiter = createLimiter(3, 12345);
      const send = (ip: string, now: number, body: unknown = { e: 'game_start', g: 'road-run' }) =>
        ping(post(body, { ip }), {}, limiter, now).then((r) => r.status, (e: { status: number }) => e.status);
      expect(await send('198.51.100.1', 0)).toBe(204);
      expect(await send('198.51.100.1', 1000, { bad: true })).toBe(400);
      expect(await send('198.51.100.1', 2000)).toBe(204);
      expect(await send('198.51.100.1', 3000)).toBe(429);
      expect(await send('198.51.100.2', 3000)).toBe(204);       // another sender is not held
      expect(await send('198.51.100.1', 60_000)).toBe(204);     // a new minute
    } finally {
      spy.mockRestore();
    }
  });

  it('allows a real round many times over (the limit is far above two signals a round)', () => {
    expect(PINGS_PER_MINUTE).toBeGreaterThanOrEqual(20);
  });
});

describe('createLimiter', () => {
  it('forgets everyone when it holds too many senders, so a flood of addresses cannot grow it', () => {
    const l = createLimiter(1, 7);
    expect(l.allow('a', 0)).toBe(true);
    expect(l.allow('a', 1)).toBe(false);
    for (let i = 0; i < 6000; i++) l.allow(`10.0.${Math.floor(i / 250)}.${i % 250}`, 2);
    // the table was cleared once it filled up: the first sender may send again inside the same minute
    expect(l.allow('a', 3)).toBe(true);
  });

});

describe('the route', () => {
  it('is POST /api/ping on the Worker router; GET answers 405', async () => {
    const r = new Router();
    registerPing(r);
    expect(r.list()).toEqual(['POST /api/ping']);
    expect((await r.handle(new Request(`${ORIGIN}/api/ping`), {}, ctx))?.status).toBe(405);
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const ok = await r.handle(post({ e: 'game_start', g: 'road-run' }, { ip: '192.0.2.1' }), {}, ctx);
      expect(ok?.status).toBe(204);
      const bad = await r.handle(post({ e: 'nope', g: 'road-run' }, { ip: '192.0.2.2' }), {}, ctx);
      expect(bad?.status).toBe(400);
      expect(await bad?.json()).toEqual({ error: 'bad_signal' });
    } finally {
      spy.mockRestore();
    }
  });

  it('is on the real Worker (src/index.ts registers it) and its datasets are bound in every Worker config', () => {
    const entry = readFileSync(new URL('packages/server/src/index.ts', ROOT), 'utf8');
    expect(entry).toContain("import { registerPing } from './site/ping.ts';");
    expect(entry).toContain('registerPing(router);');
    for (const file of ['wrangler.jsonc', 'wrangler.prod.jsonc', 'packages/server/wrangler.jsonc']) {
      const cfg = JSON.parse(readFileSync(new URL(file, ROOT), 'utf8').replace(/^\s*\/\/.*$/gm, '')) as { analytics_engine_datasets: { binding: string; dataset: string }[] };
      expect(cfg.analytics_engine_datasets.map((d) => d.binding).sort(), file).toEqual(Object.values(PING_BINDINGS).sort());
    }
  });
});
