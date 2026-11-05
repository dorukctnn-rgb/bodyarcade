import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { Router } from '../router.ts';
import {
  ALL_BINDINGS, DETAILS, FUNNEL_BINDING, FUNNEL_EVENTS, LEFT_AT, PINGS_PER_MINUTE, PING_BINDINGS, PING_EVENTS, SOURCE_WORDS, createLimiter, parseSignal, ping, pointOf, registerPing, type DatasetLike,
} from './ping.ts';

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

  it('takes the steps of the funnel, each with the one detail it may carry from its own list', () => {
    expect(parseSignal({ e: 'visit', g: 'home', x: 'google' })).toEqual({ e: 'visit', g: 'home', x: 'google' });
    expect(parseSignal({ e: 'visit', g: 'tr-webcam-fitness-games', x: 'app' })).not.toBeNull();
    expect(parseSignal({ e: 'visit', g: 'home' })).toEqual({ e: 'visit', g: 'home' });
    expect(parseSignal({ e: 'play_open', g: 'squat-flap', x: 'first' })).not.toBeNull();
    expect(parseSignal({ e: 'tracking_ready', g: 'squat-flap', x: 'again' })).not.toBeNull();
    expect(parseSignal({ e: 'game_start', g: 'road-run', x: 'first' })).toEqual({ e: 'game_start', g: 'road-run', x: 'first' });
    expect(parseSignal({ e: 'run_finished', g: 'road-run', x: 'again' })).not.toBeNull();
    for (const where of LEFT_AT) expect(parseSignal({ e: 'play_left', g: 'star-catch', x: where }), where).not.toBeNull();
    expect(parseSignal({ e: 'play_error', g: 'road-run', x: 'denied' })).not.toBeNull();
    expect(parseSignal({ e: 'play_error', g: 'road-run', x: 'pose_load' })).not.toBeNull();
    expect(parseSignal({ e: 'paywall_view', g: 'results' })).toEqual({ e: 'paywall_view', g: 'results' });
    expect(parseSignal({ e: 'buy_click', g: 'pro-yearly', x: 'paddle' })).not.toBeNull();
    expect(parseSignal({ e: 'checkout_open', g: 'lifetime', x: 'gumroad' })).not.toBeNull();
    expect(parseSignal({ e: 'checkout_done', g: 'family-yearly', x: 'paddle' })).not.toBeNull();
    // every event has a rule for its detail, and the events are the round's two plus the funnel's
    expect(Object.keys(DETAILS).sort()).toEqual([...PING_EVENTS].sort());
    expect(PING_EVENTS.length).toBe(2 + FUNNEL_EVENTS.length);
    expect(SOURCE_WORDS).toContain('direct');
  });

  it('refuses a detail the event does not take, a word off its list, and anything that could carry more than a word', () => {
    for (const bad of [
      { e: 'visit', g: 'home', x: 'evil.example' }, { e: 'visit', g: 'home', x: 'https://t.co/x' }, { e: 'visit', g: 'home', x: 'Google' },
      { e: 'paywall_view', g: 'results', x: 'first' }, { e: 'game_start', g: 'road-run', x: 'third' }, { e: 'game_start', g: 'road-run', x: '' },
      { e: 'game_start', g: 'road-run', x: 1 }, { e: 'game_start', g: 'road-run', x: ['first'] }, { e: 'play_left', g: 'road-run', x: 'kitchen' },
      { e: 'play_error', g: 'road-run', x: 'Denied' }, { e: 'play_error', g: 'road-run', x: 'not found' }, { e: 'play_error', g: 'road-run', x: 'x'.repeat(25) },
      { e: 'play_error', g: 'road-run', x: 'ada@example.com' }, { e: 'buy_click', g: 'pro-yearly', x: 'stripe' }, { e: 'checkout_done', g: 'lifetime', x: 'gumroad' },
      { e: 'game_start', g: 'road-run', y: 'first' }, { e: 'visit', g: 'home', x: 'google', n: 1 }, { e: 'visit', g: 'Home/Page' },
    ]) expect(parseSignal(bad), JSON.stringify(bad)).toBeNull();
  });
});

describe('pointOf', () => {
  it('writes a round event to its own dataset as before (the game first) and every other event to the funnel dataset', () => {
    expect(pointOf({ e: 'game_start', g: 'road-run' })).toEqual({ binding: 'PING_START', point: { blobs: ['road-run'], doubles: [1], indexes: ['road-run'] } });
    expect(pointOf({ e: 'run_finished', g: 'road-run', x: 'first' })).toEqual({ binding: 'PING_FINISH', point: { blobs: ['road-run', 'first'], doubles: [1], indexes: ['road-run'] } });
    expect(pointOf({ e: 'visit', g: 'home', x: 'google' })).toEqual({ binding: FUNNEL_BINDING, point: { blobs: ['visit', 'home', 'google'], doubles: [1], indexes: ['visit'] } });
    expect(pointOf({ e: 'paywall_view', g: 'results' })).toEqual({ binding: FUNNEL_BINDING, point: { blobs: ['paywall_view', 'results', ''], doubles: [1], indexes: ['paywall_view'] } });
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

  it('writes a funnel step to the funnel dataset with its detail, and logs the detail too', async () => {
    const spy = log();
    try {
      const start = dataset();
      const funnel = dataset();
      const env = { PING_START: start.ds, PING_FUNNEL: funnel.ds };
      expect((await ping(post({ e: 'visit', g: 'webcam-fitness-games', x: 'google' }, { ip: '203.0.113.8' }), env, createLimiter())).status).toBe(204);
      expect((await ping(post({ e: 'game_start', g: 'squat-flap', x: 'first' }), env, createLimiter())).status).toBe(204);
      expect(funnel.points).toEqual([{ blobs: ['visit', 'webcam-fitness-games', 'google'], doubles: [1], indexes: ['visit'] }]);
      expect(start.points).toEqual([{ blobs: ['squat-flap', 'first'], doubles: [1], indexes: ['squat-flap'] }]);
      expect(spy.mock.calls.map((c) => JSON.parse(String(c[0])))).toEqual([
        { evt: 'ping', e: 'visit', g: 'webcam-fitness-games', x: 'google' }, { evt: 'ping', e: 'game_start', g: 'squat-flap', x: 'first' },
      ]);
      expect(JSON.stringify([funnel.points, start.points, spy.mock.calls])).not.toContain('203.0.113.8');
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

  it('allows a real round many times over (the limit is far above the five signals of a round and the visit before it)', () => {
    expect(PINGS_PER_MINUTE).toBeGreaterThanOrEqual(30);
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
      expect(cfg.analytics_engine_datasets.map((d) => d.binding).sort(), file).toEqual([...ALL_BINDINGS].sort());
      expect(ALL_BINDINGS).toEqual([...Object.values(PING_BINDINGS), FUNNEL_BINDING]);
    }
  });
});
