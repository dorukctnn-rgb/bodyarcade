// Signalling load: many rooms at once, each with two real LiveClients (no browsers, no WebRTC), a full match in each,
// every pair on the Room relay at 15 Hz. It proves correctness under concurrency on workerd, not edge capacity: every
// room must finish with the same result on both sides, every result must be acknowledged, and nothing may error.
import { expect, test } from '@playwright/test';
import { LiveClient, createRoom, joinRoom, makeSchedule, scoreOf, specFor, type Identity } from '../../packages/core/net/index.ts';
import type { MatchInfo, MatchResult, ObstacleResult } from '../../packages/core/types/net.ts';
import { startStack, type Stack } from './support/stack.ts';

let stack: Stack;
test.beforeAll(async () => { test.setTimeout(120_000); stack = await startStack(); });
test.afterAll(async () => { await stack?.stop(); });

const ROOMS = Number(process.env.LIVE_LOAD_ROOMS ?? 40);
const DUR_S = 20;

interface Side { c: LiveClient; seat: string; mine: ObstacleResult[]; results: MatchResult[]; recv: number; errors: string[]; started: Promise<MatchInfo> }

function makeSide(base: string, grant: Awaited<ReturnType<typeof createRoom>>, who: Identity, code: string, seed: number): Side {
  const errors: string[] = [];
  const c = new LiveClient({ grant, origin: base, peers: 'none', refreshTicket: () => joinRoom(base, code, who), log: () => undefined });
  const side: Side = { c, seat: '', mine: [], results: [], recv: 0, errors, started: new Promise((resolve) => c.on('match', (d) => resolve(d.match))) };
  c.on('welcome', (w) => { side.seat = w.you; c.setReady(true); });
  c.on('result', (r) => side.results.push(r));
  c.on('state', () => { side.recv++; });
  c.on('fatal', (f) => errors.push('fatal ' + f.reason));
  c.on('roomError', (e) => errors.push('room error ' + e.code));
  void seed;
  return side;
}

test(`load: ${ROOMS} rooms x 2 players, relay at 15 Hz, every result identical and acknowledged`, async () => {
  test.setTimeout((DUR_S + 90) * 1000);
  const rooms = await Promise.all(Array.from({ length: ROOMS }, async (_, i) => {
    const a: Identity = { pid: `load-a-device-${String(i).padStart(4, '0')}`, name: `A${i}`, age: 'adult' };
    const b: Identity = { pid: `load-b-device-${String(i).padStart(4, '0')}`, name: `B${i}`, age: 'adult' };
    const ga = await createRoom(stack.base, a, { gameId: 'squat-flap', durationMs: DUR_S * 1000 });
    const gb = await joinRoom(stack.base, ga.code, b);
    return { code: ga.code, sa: makeSide(stack.base, ga, a, ga.code, i), sb: makeSide(stack.base, gb, b, ga.code, i) };
  }));
  await Promise.all(rooms.flatMap((r) => [r.sa.c.start(), r.sb.c.start()]));
  const matches = await Promise.all(rooms.map((r) => r.sa.started));
  const t0 = Date.now();
  // each side plays its own course: passes most obstacles, sends state at 15 Hz through the Room
  const timers: ReturnType<typeof setInterval>[] = [];
  rooms.forEach((r, i) => {
    const m = matches[i] as MatchInfo;
    const course = makeSchedule(m.seed, m.duration, specFor(m.gameId));
    for (const [k, s] of [r.sa, r.sb].entries()) {
      let n = 0;
      timers.push(setInterval(() => {
        const mt = s.c.matchTime();
        const phase = (): string | undefined => s.c.match?.phase;
        if (mt < 0 || phase() === 'over') return;
        for (const o of course) {
          if (o.t > mt || s.mine.some((e) => e.ob === o.id)) continue;
          const kind = (o.id + i + k) % 5 === 0 ? 'hit' : 'pass';
          s.mine.push({ ob: o.id, k: kind });
          s.c.reportResult(o.id, kind);
        }
        if (mt >= m.duration && phase() !== 'over') s.c.finish(s.mine);
        s.c.sendState({ n: ++n, mt: Math.round(mt) });
      }, 66));
    }
  });
  await expect.poll(() => rooms.every((r) => r.sa.results.length === 1 && r.sb.results.length === 1), { timeout: (DUR_S + 60) * 1000, intervals: [500] }).toBe(true);
  for (const t of timers) clearInterval(t);
  const elapsed = Date.now() - t0;
  let same = 0; let correct = 0; let relayed = 0;
  for (const [i, r] of rooms.entries()) {
    const m = matches[i] as MatchInfo;
    const course = makeSchedule(m.seed, m.duration, specFor(m.gameId));
    if (JSON.stringify(r.sa.results[0]) === JSON.stringify(r.sb.results[0])) same++;
    const res = r.sa.results[0] as MatchResult;
    if (res.scores[r.sa.seat]?.score === scoreOf(course, r.sa.mine).score && res.scores[r.sb.seat]?.score === scoreOf(course, r.sb.mine).score && res.reason === 'complete') correct++;
    relayed += r.sa.recv + r.sb.recv;
    expect(r.sa.errors).toEqual([]);
    expect(r.sb.errors).toEqual([]);
  }
  console.log(JSON.stringify({ load: { rooms: ROOMS, elapsedMs: elapsed, identical: same, correct, relayedStates: relayed } }));
  expect(same).toBe(ROOMS);
  expect(correct).toBe(ROOMS);
  expect(relayed).toBeGreaterThan(ROOMS * 2 * DUR_S * 10);
  for (const r of rooms) { r.sa.c.stop(); r.sb.c.stop(); }
});
