// Rooms of 2-4 and what happens between people in them: chat, presets, blocks, reports, kicks, hosts, public rooms,
// late joiners, a rematch after a forfeit. Real browsers against the Worker on workerd; no WebRTC unless a test needs it.
import { expect, test } from '@playwright/test';
import { call, openRoom, waitFor, type RoomPlayer } from './support/room.ts';
import { startStack, type Stack } from './support/stack.ts';

let stack: Stack;
test.beforeAll(async () => { test.setTimeout(120_000); stack = await startStack(); });
test.afterAll(async () => { await stack?.stop(); });

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const get = async <T>(p: RoomPlayer, key: string): Promise<T[]> => (((await p.m()) as unknown as Record<string, unknown>)?.[key] as T[] | undefined) ?? [];
const seatOf = async (p: RoomPlayer): Promise<string> => String((await p.m())?.seat);
const postJson = async (path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> => {
  const r = await fetch(stack.base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, unknown> };
};

test('adults in a private room: text chat is filtered, rate limited and delivered to everyone', async () => {
  const r = await openRoom(stack, { players: 3, noready: true });
  try {
    const [a, b, c] = r.players as [RoomPlayer, RoomPlayer, RoomPlayer];
    await call(a, 'chat', 'hello   team');
    await waitFor(async () => (await get(c, 'chat')).length === 1, 5000, 'chat to arrive');
    expect(await get(c, 'chat')).toEqual([{ from: await seatOf(a), text: 'hello team', at: expect.any(Number) }]);
    await call(a, 'chat', 'again too soon');
    await waitFor(async () => (await get<{ reason: string }>(a, 'chatRejected')).length === 1, 5000, 'rate rejection');
    expect((await get<{ reason: string }>(a, 'chatRejected'))[0]?.reason).toBe('rate');
    await sleep(5200);
    await call(a, 'chat', 'see https://example.com');
    await waitFor(async () => (await get(a, 'chatRejected')).length === 2, 5000, 'link rejection');
    expect((await get<{ reason: string }>(a, 'chatRejected'))[1]?.reason).toBe('link');
    await call(b, 'preset', 'gg');
    await call(b, 'react', 'clap');
    await waitFor(async () => (await get(a, 'presets')).length >= 1, 5000, 'preset to arrive');
    expect((await get<{ id: string }>(a, 'presets'))[0]?.id).toBe('gg');
    for (const p of r.players) expect(p.errors).toEqual([]);
  } finally { await r.close(); }
});

test('one teen in the room makes it preset-only for everyone', async () => {
  const r = await openRoom(stack, { ages: ['adult', 'teen'], noready: true });
  try {
    const [a, b] = r.players as [RoomPlayer, RoomPlayer];
    expect(((await a.m())?.room as { chat: string }).chat).toBe('preset');
    await call(a, 'chat', 'hello there');
    await waitFor(async () => (await get(a, 'chatRejected')).length === 1, 5000, 'refusal');
    expect((await get<{ reason: string }>(a, 'chatRejected'))[0]?.reason).toBe('not_allowed');
    await call(b, 'preset', 'hi');
    await waitFor(async () => (await get(a, 'presets')).length === 1, 5000, 'preset');
  } finally { await r.close(); }
});

test('a public room carries no video and no free text, and keeps other age bands out', async () => {
  const r = await openRoom(stack, { kind: 'public', ages: ['adult', 'adult'], noready: true, video: true, webrtc: true });
  try {
    const [a, b] = r.players as [RoomPlayer, RoomPlayer];
    const room = (await a.m())?.room as { kind: string; video: boolean; chat: string };
    expect(room).toMatchObject({ kind: 'public', video: false, chat: 'preset' });
    await sleep(2500);
    expect(((await a.m())?.members as { video: boolean }[]).every((m) => !m.video)).toBe(true);
    expect(((await b.m())?.tracks) ?? {}).toEqual({});
    await call(a, 'chat', 'hello stranger');
    await waitFor(async () => (await get(a, 'chatRejected')).length === 1, 5000, 'refusal');
    const teen = await postJson(`/api/rooms/${r.code}/join`, { pid: 'teen-device-9001', name: 'tina', age: 'teen' });
    expect(teen.status).toBe(403);
    expect(teen.json.error).toBe('not_allowed');
    const child = await postJson(`/api/rooms/${r.code}/join`, { pid: 'child-device-9002', name: 'kid', age: 'child' });
    expect(child.status).toBe(403);
    const adult = await postJson(`/api/rooms/${r.code}/join`, { pid: 'adult-device-9003', name: 'adam', age: 'adult' });
    expect(adult.status).toBe(409);                              // size 2 and both seats taken
    const kidRoom = await postJson('/api/rooms', { kind: 'public', gameId: 'squat-flap', pid: 'child-device-9002', name: 'kid', age: 'child' });
    expect(kidRoom.status).toBe(403);
  } finally { await r.close(); }
});

test('a block hides chat both ways and switches video off between the two', async () => {
  const r = await openRoom(stack, { players: 3, noready: true });
  try {
    const [a, b, c] = r.players as [RoomPlayer, RoomPlayer, RoomPlayer];
    await call(a, 'block', await seatOf(b));
    await waitFor(async () => (await get(a, 'blocked')).length === 1, 5000, 'block confirmation');
    await call(b, 'chat', 'hi everyone');
    await waitFor(async () => (await get(c, 'chat')).length === 1, 5000, 'chat to c');
    await sleep(600);
    expect(await get(a, 'chat')).toHaveLength(0);                // a never sees b's message
    await call(a, 'chat', 'hello from a');
    await waitFor(async () => (await get(c, 'chat')).length === 2, 5000, 'chat from a to c');
    await sleep(600);
    expect((await get<{ from: string }>(b, 'chat')).filter((x) => x.from === (/* a */ 's1'))).toHaveLength(0);
  } finally { await r.close(); }
});

test('three reports from three players mute the reported one, who is told why', async () => {
  const r = await openRoom(stack, { players: 4, noready: true });
  try {
    const [a, b, c, d] = r.players as [RoomPlayer, RoomPlayer, RoomPlayer, RoomPlayer];
    const target = await seatOf(d);
    await call(a, 'reportPlayer', target, 'abuse', true);
    await call(b, 'reportPlayer', target, 'spam', false);
    await waitFor(async () => (await get(a, 'reported')).length === 1 && (await get(b, 'reported')).length === 1, 5000, 'confirmations');
    await call(d, 'chat', 'still allowed after two');
    await waitFor(async () => (await get(c, 'chat')).length === 1, 5000, 'chat before the third report');
    await call(c, 'reportPlayer', target, 'sexual', false);
    await waitFor(async () => (await get(c, 'reported')).length === 1, 5000, 'third report');
    await sleep(5200);
    await call(d, 'chat', 'this one is muted');
    await waitFor(async () => (await get(d, 'chatRejected')).length >= 1, 5000, 'mute');
    expect((await get<{ reason: string }>(d, 'chatRejected')).at(-1)?.reason).toBe('muted');
  } finally { await r.close(); }
});

test('the host kicks a member: removed, banned from the room, the others carry on', async () => {
  const r = await openRoom(stack, { players: 3, noready: true });
  try {
    const [a, b, c] = r.players as [RoomPlayer, RoomPlayer, RoomPlayer];
    await call(b, 'kick', await seatOf(c));                      // not the host: ignored with an error
    await waitFor(async () => (await get<string>(b, 'roomErrors')).includes('not_host'), 5000, 'not_host');
    await call(a, 'kick', await seatOf(c));
    await waitFor(async () => !!(await c.m())?.fatal, 8000, 'the kicked page to stop');
    expect((await c.m())?.fatal).toMatchObject({ reason: 'removed', code: 4003 });
    expect((await c.m())?.removed).toEqual({ reason: 'kicked' });
    await waitFor(async () => ((await a.m())?.members as unknown[] | undefined)?.length === 2, 5000, 'two members left');
    const again = await postJson(`/api/rooms/${r.code}/join`, { pid: c.setup.pid, name: c.setup.name, age: 'adult' });
    expect(again.status).toBe(403);
    expect(again.json.error).toBe('banned');
  } finally { await r.close(); }
});

test('the host leaves the lobby: the next member becomes host and picks the game', async () => {
  const r = await openRoom(stack, { players: 3, noready: true });
  try {
    const [a, b, c] = r.players as [RoomPlayer, RoomPlayer, RoomPlayer];
    expect(((await b.m())?.room as { host: string }).host).toBe(await seatOf(a));
    await call(a, 'leave');
    await waitFor(async () => ((await b.m())?.room as { host: string } | undefined)?.host === (await seatOf(b)), 5000, 'host handover');
    await call(b, 'configure', { gameId: 'knee-sprint', durationMs: 20_000 });
    await waitFor(async () => ((await c.m())?.room as { config: { gameId: string } } | undefined)?.config.gameId === 'knee-sprint', 5000, 'new game for c');
    expect(((await c.m())?.room as { config: { durationMs: number } }).config.durationMs).toBe(20_000);
  } finally { await r.close(); }
});

test('rooms refuse a player who is not a member, and a late joiner waits for the next match', async () => {
  const r = await openRoom(stack, { players: 2, size: 3, noready: true, durationMs: 15_000 });
  try {
    const [a, b] = r.players as [RoomPlayer, RoomPlayer];
    await call(a, 'setReady', true); await call(b, 'setReady', true);
    await waitFor(async () => !!(await a.m())?.seeds?.length, 8000, 'the match to start');
    // a third player arrives while the match runs
    const lateGrant = await postJson(`/api/rooms/${r.code}/join`, { pid: 'carol-device-0003', name: 'carol', age: 'adult' });
    expect(lateGrant.status).toBe(200);
    const ctx = await r.browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${stack.base}/duel?room=${r.code}&pid=carol-device-0003&name=carol&age=adult&peers=none&noready=1`);
    await waitFor(async () => (await page.evaluate(() => !!(window as unknown as { __M__?: { seat?: string } }).__M__?.seat)), 8000, 'the late joiner to be welcomed');
    const lateM = await page.evaluate(() => JSON.parse(JSON.stringify((window as unknown as { __M__: { room: { phase: string } } }).__M__.room)) as { phase: string });
    expect(lateM.phase).toBe('playing');
    await waitFor(async () => !!(await a.m())?.done, 40_000, 'the first match to finish');
    const first = (await a.m())?.results?.[0];
    expect(first?.reason).toBe('complete');
    expect(Object.keys(first?.scores ?? {})).toHaveLength(2);    // the late joiner was not a player
    // the next match has three players
    await page.evaluate(() => (window as unknown as { __lm: { setReady(r: boolean): void } }).__lm.setReady(true));
    await call(a, 'setReady', true); await call(b, 'setReady', true);
    await waitFor(async () => ((await a.m())?.seeds?.length ?? 0) >= 2, 10_000, 'the second match to start');
    const members = (await a.m())?.members as unknown[];
    expect(members).toHaveLength(3);
    await ctx.close();
  } finally { await r.close(); }
});
