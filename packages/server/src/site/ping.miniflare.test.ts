// The game signal on the production Worker in Miniflare (workerd): the real router and entry, with the three Analytics Engine datasets
// bound the way wrangler.prod.jsonc binds them. The rule-by-rule cases are in ping.test.ts; this proves the route and the bindings work in the platform.
// The Worker's log lines reach the test a moment after the answer (workerd hands them over on its own schedule), so the test waits for them.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startStack, type Stack } from '../social/stack.ts';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

let stack: Stack;
beforeAll(async () => {
  stack = await startStack({ analyticsDatasets: { PING_START: { dataset: 'bodyarcade_game_start' }, PING_FINISH: { dataset: 'bodyarcade_run_finished' }, PING_FUNNEL: { dataset: 'bodyarcade_funnel' } } });
}, 120_000);
afterAll(async () => { await stack?.stop(); }, 30_000);

const send = (body: string, headers: Record<string, string> = {}) =>
  fetch(`${stack.origin}/api/ping`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: stack.origin, ...headers }, body });

describe('POST /api/ping on the Worker', () => {
  it('counts a started and a finished round and a step of the funnel: 204, one log line each, no address in them', async () => {
    const a = await send(JSON.stringify({ e: 'game_start', g: 'road-run' }), { 'CF-Connecting-IP': '203.0.113.9' });
    expect(a.status).toBe(204);
    const b = await send(JSON.stringify({ e: 'run_finished', g: 'road-run' }));
    expect(b.status).toBe(204);
    const c = await send(JSON.stringify({ e: 'visit', g: 'home', x: 'google' }), { 'CF-Connecting-IP': '203.0.113.9' });
    expect(c.status).toBe(204);
    await vi.waitFor(() => { expect(stack.events('ping').length).toBeGreaterThanOrEqual(3); }, { timeout: 10_000, interval: 50 });
    const lines = stack.events('ping');
    expect(lines).toEqual([{ evt: 'ping', e: 'game_start', g: 'road-run' }, { evt: 'ping', e: 'run_finished', g: 'road-run' }, { evt: 'ping', e: 'visit', g: 'home', x: 'google' }]);
    expect(stack.logs.join('\n')).not.toContain('203.0.113.9');
    expect(stack.events('ping_error')).toEqual([]);
  });

  it('refuses a body that is not a signal, a page of another site and a GET', async () => {
    const before = stack.events('ping').length;
    expect((await send('{"e":"game_start","g":"road-run","name":"Ada"}')).status).toBe(400);
    expect((await send('{"e":"page_view","g":"road-run"}')).status).toBe(400);
    expect((await send('not json')).status).toBe(400);
    expect((await send('{"e":"game_start","g":"road-run"}', { Origin: 'https://evil.example' })).status).toBe(403);
    expect((await fetch(`${stack.origin}/api/ping`)).status).toBe(405);
    expect((await send('{"e":"visit","g":"home","x":"evil.example"}')).status).toBe(400);
    // a good signal after the refused ones: once its line is in, no line of the refused ones can still be on its way
    expect((await send('{"e":"paywall_view","g":"results"}')).status).toBe(204);
    await vi.waitFor(() => { expect(stack.events('ping').length).toBe(before + 1); }, { timeout: 10_000, interval: 50 });
    expect(stack.events('ping').at(-1)).toEqual({ evt: 'ping', e: 'paywall_view', g: 'results' });
  });

  it('holds a sender to its limit and answers 429 after that', async () => {
    const ip = { 'CF-Connecting-IP': '198.51.100.77' };
    let last = 0;
    for (let i = 0; i < 50; i++) last = (await send(JSON.stringify({ e: 'game_start', g: 'knee-sprint' }), ip)).status;
    expect(last).toBe(429);
  });
});
