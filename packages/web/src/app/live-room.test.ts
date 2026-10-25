import { describe, expect, it } from 'vitest';
import { LiveClient, type LiveClientOptions } from '../../../core/net/client.ts';
import { FakeMediaStream, FakePeerConnection, ManualScheduler } from '../../../core/net/testkit.ts';
import { VIDEO_CONNECT_MS } from '../../../core/net/video.ts';
import type { SocketLike } from '../../../core/net/runtime.ts';
import { NET_PROTOCOL, type JoinGrant, type MatchInfo, type MemberInfo, type RoomInfo, type RoomMessage } from '../../../core/types/net.ts';
import { clampDuration, createLiveRoomPort, problemOf, type Identity } from './live-room.ts';
import { LiveApiError } from '../../../core/net/api.ts';

const ME: Identity = { pid: 'device-0001-abcdef', name: 'Doruk', age: 'adult' };
const ORIGIN = 'http://127.0.0.1:9';

const room = (over: Partial<RoomInfo> = {}): RoomInfo => ({ code: 'K7P2QX', kind: 'private', size: 2, host: 's1', config: { gameId: 'squat-flap', durationMs: 90_000, band: null }, chat: 'text', video: true, phase: 'lobby', ...over });
const member = (seat: string, name: string, over: Partial<MemberInfo> = {}): MemberInfo => ({ seat, name, host: seat === 's1', online: true, ready: false, sess: `sess-${seat}`, video: false, ...over });
const grantFor = (code: string): JoinGrant => ({ code, link: `${ORIGIN}/r/${code}`, ticket: 'ticket', exp: Math.floor(Date.now() / 1000) + 600, room: { code, kind: 'private', gameId: 'squat-flap', size: 2, players: 1, phase: 'lobby' } });

class FakeSocket implements SocketLike {
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  sent: Record<string, unknown>[] = [];
  closedWith: number | null = null;
  send(data: string): void { if (data !== 'ping') this.sent.push(JSON.parse(data) as Record<string, unknown>); }
  close(code = 1000): void { this.readyState = 3; this.closedWith = code; }
  open(): void { this.readyState = 1; this.onopen?.({}); }
  say(m: RoomMessage): void { this.onmessage?.({ data: JSON.stringify(m) }); }
  closeFromServer(code: number): void { this.readyState = 3; this.onclose?.({ code, reason: '' }); }
  messages(t: string): Record<string, unknown>[] { return this.sent.filter((m) => m['t'] === t); }
}

function setup(o: { fetch?: (url: string, init?: RequestInit) => Response | Promise<Response>; identity?: Identity | null; pro?: () => string | null } = {}) {
  const sched = new ManualScheduler();
  const sockets: FakeSocket[] = [];
  const saved: string[][] = [];
  const calls: { url: string; body: unknown }[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    if (o.fetch) return o.fetch(String(url), init);
    const code = /\/api\/rooms\/([A-Z0-9]{6})\/join/.exec(String(url))?.[1] ?? 'K7P2QX';
    return new Response(JSON.stringify(grantFor(code)), { status: 200 });
  }) as unknown as typeof fetch;
  const port = createLiveRoomPort({
    origin: ORIGIN,
    identity: () => (o.identity === undefined ? ME : o.identity),
    fetcher,
    makeClient: (opts: LiveClientOptions) => new LiveClient({ ...opts, peers: 'none', sched, socket: () => { const s = new FakeSocket(); sockets.push(s); return s; } }),
    blocks: { load: () => ['old-key'], save: (k) => { saved.push([...k]); } },
    ...(o.pro ? { pro: o.pro } : {}),
  });
  const welcome = (s: FakeSocket, members: MemberInfo[], info: RoomInfo = room(), match: MatchInfo | null = null): void => {
    s.open();
    s.say({ t: 'welcome', v: NET_PROTOCOL, you: 's2', now: sched.now(), room: info, members, match, mine: [], blocked: [] });
  };
  return { port, sched, sockets, saved, calls, welcome };
}

const flush = async (): Promise<void> => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

describe('what a room asks of the Worker', () => {
  it('opens a private room for two with the identity and a match length the Room accepts', async () => {
    const t = setup();
    const r = await t.port.create({ game: 'squat-flap', kind: 'private', size: 4, band: null, durationMs: 400_000 });
    expect(r).toEqual({ ok: true, value: 'K7P2QX' });
    expect(t.calls[0]?.url).toBe(`${ORIGIN}/api/rooms`);
    expect(t.calls[0]?.body).toMatchObject({ kind: 'private', gameId: 'squat-flap', size: 4, durationMs: 180_000, band: null, ...ME });
    expect(t.port.state().phase).toBe('joining');
    expect(t.port.state().link).toBe(`${ORIGIN}/r/K7P2QX`);
  });

  it('joins by the code in any way it is written, and refuses what is no code', async () => {
    const t = setup();
    expect(await t.port.join('k7p-2qx')).toEqual({ ok: true, value: undefined });
    expect(t.calls[0]?.url).toBe(`${ORIGIN}/api/rooms/K7P2QX/join`);
    expect(await t.port.join('nope!')).toEqual({ ok: false, code: 'no_room' });
    expect(t.calls).toHaveLength(1);
  });

  it('does not join the room it is already in a second time', async () => {
    const t = setup();
    await t.port.join('K7P2QX');
    t.welcome(t.sockets[0] as FakeSocket, [member('s1', 'Ayse'), member('s2', 'Doruk')]);
    expect(await t.port.join('K7P2QX')).toEqual({ ok: true, value: undefined });
    expect(t.calls).toHaveLength(1);
  });

  it('asks for the age question first when it does not know who is playing', async () => {
    const t = setup({ identity: null });
    expect(await t.port.create({ game: 'squat-flap', kind: 'private', size: 2, band: null })).toEqual({ ok: false, code: 'not_allowed' });
    expect(await t.port.join('K7P2QX')).toEqual({ ok: false, code: 'not_allowed' });
    expect(t.calls).toHaveLength(0);
  });

  it('says why a room could not be opened', async () => {
    for (const [status, error, want] of [[404, 'no_room', 'no_room'], [409, 'full', 'full'], [403, 'not_allowed', 'not_allowed'], [403, 'age_not_allowed', 'not_allowed'], [503, 'room_unavailable', 'offline'], [429, 'rate_limited', 'offline']] as const) {
      const t = setup({ fetch: () => new Response(JSON.stringify({ error }), { status }) });
      expect(await t.port.join('K7P2QX'), `${status} ${error}`).toEqual({ ok: false, code: want });
      expect(t.port.state().phase).toBe('closed');
      expect(t.port.state().problem).toBe(want);
    }
    expect(problemOf(new LiveApiError(0, 'network'))).toBe('offline');
    expect(problemOf(new Error('boom'))).toBe('offline');
  });

  it('clamps the match length to what the Room allows', () => {
    expect(clampDuration(1)).toBe(15_000);
    expect(clampDuration(90_400)).toBe(90_000);
    expect(clampDuration(9e9)).toBe(180_000);
  });
});

describe('the room as the screens see it', () => {
  it('is a lobby with the members once the Room has said hello, and keeps them current', async () => {
    const t = setup();
    await t.port.join('K7P2QX');
    const s = t.sockets[0] as FakeSocket;
    t.welcome(s, [member('s1', 'Ayse'), member('s2', 'Doruk')]);
    expect(t.port.state()).toMatchObject({ phase: 'lobby', me: 's2', connection: 'online', problem: null });
    expect(t.port.state().members.map((m) => m.name)).toEqual(['Ayse', 'Doruk']);
    expect(t.port.state().info?.code).toBe('K7P2QX');
    s.say({ t: 'presence', members: [member('s1', 'Ayse', { ready: true }), member('s2', 'Doruk')] });
    expect(t.port.state().members[0]?.ready).toBe(true);
    s.say({ t: 'room', room: room({ chat: 'preset' }) });
    expect(t.port.state().info?.chat).toBe('preset');
  });

  it('is playing while a match runs and a lobby again at the result', async () => {
    const t = setup();
    await t.port.join('K7P2QX');
    const s = t.sockets[0] as FakeSocket;
    t.welcome(s, [member('s1', 'Ayse'), member('s2', 'Doruk')]);
    const match: MatchInfo = { id: 'm1', seed: 5, gameId: 'squat-flap', startAt: t.sched.now() + 3500, duration: 90_000, phase: 'running', pausedAt: null, resumeAt: null, pauseTotal: 0, reasons: {}, seats: ['s1', 's2'], forfeited: [], result: null };
    s.say({ t: 'start', match });
    expect(t.port.state().phase).toBe('playing');
    s.say({ t: 'result', result: { mid: 'm1', reason: 'complete', winner: 's1', places: { s1: 1, s2: 2 }, scores: { s1: { score: 500, hits: 1, passes: 5, bestCombo: 5 }, s2: { score: 300, hits: 2, passes: 3, bestCombo: 2 } }, forfeited: [] } });
    expect(t.port.state().phase).toBe('lobby');
  });

  it('opens straight into a match that is already running (a reload)', async () => {
    const t = setup();
    await t.port.join('K7P2QX');
    const match: MatchInfo = { id: 'm1', seed: 5, gameId: 'squat-flap', startAt: t.sched.now() - 5000, duration: 90_000, phase: 'running', pausedAt: null, resumeAt: null, pauseTotal: 0, reasons: {}, seats: ['s1', 's2'], forfeited: [], result: null };
    t.welcome(t.sockets[0] as FakeSocket, [member('s1', 'Ayse'), member('s2', 'Doruk')], room({ phase: 'playing' }), match);
    expect(t.port.state().phase).toBe('playing');
  });

  it('keeps what was said, as presets, reactions and text, from the last forty', async () => {
    const t = setup();
    await t.port.join('K7P2QX');
    const s = t.sockets[0] as FakeSocket;
    t.welcome(s, [member('s1', 'Ayse'), member('s2', 'Doruk')]);
    s.say({ t: 'preset', from: 's1', id: 'gg', at: 1 });
    s.say({ t: 'react', from: 's1', id: 'clap', at: 2 });
    s.say({ t: 'chat', from: 's1', text: 'hello', at: 3 });
    expect(t.port.state().feed.map((f) => f.say ?? f.react ?? f.text)).toEqual(['gg', 'clap', 'hello']);
    for (let i = 0; i < 60; i++) s.say({ t: 'chat', from: 's1', text: `m${i}`, at: 10 + i });
    expect(t.port.state().feed).toHaveLength(40);
    expect(t.port.state().feed.at(-1)?.text).toBe('m59');
    const ids = t.port.state().feed.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('says what the Room turned away', async () => {
    const t = setup();
    await t.port.join('K7P2QX');
    const s = t.sockets[0] as FakeSocket;
    t.welcome(s, [member('s1', 'Ayse'), member('s2', 'Doruk')]);
    s.say({ t: 'chat_rejected', reason: 'rate' });
    expect(t.port.state().rejected?.reason).toBe('rate');
  });

  it('shows a closed room with its reason when the Room ends the connection for good', async () => {
    for (const [code, want] of [[4000, 'replaced'], [4001, 'full'], [4003, 'removed'], [4004, 'no_room'], [4005, 'version'], [4006, 'not_allowed']] as const) {
      const t = setup();
      await t.port.join('K7P2QX');
      const s = t.sockets[0] as FakeSocket;
      t.welcome(s, [member('s1', 'Ayse'), member('s2', 'Doruk')]);
      s.closeFromServer(code);
      expect(t.port.state().phase, String(code)).toBe('closed');
      expect(t.port.state().problem, String(code)).toBe(want);
    }
  });

  it('keeps the block keys the Room hands out for the next visit', async () => {
    const t = setup();
    await t.port.join('K7P2QX');
    const s = t.sockets[0] as FakeSocket;
    t.welcome(s, [member('s1', 'Ayse'), member('s2', 'Doruk')]);
    expect(s.messages('hello')[0]?.['blocks']).toEqual(['old-key']);
    s.say({ t: 'blocked', seat: 's1', key: 'new-key' });
    expect(t.saved.at(-1)).toEqual(['old-key', 'new-key']);
  });
});

describe('what the player does in the room', () => {
  it('sends ready, a game choice, presets and reactions', async () => {
    const t = setup();
    await t.port.join('K7P2QX');
    const s = t.sockets[0] as FakeSocket;
    t.welcome(s, [member('s1', 'Ayse'), member('s2', 'Doruk')]);
    t.port.setReady(true);
    t.port.chooseGame('knee-sprint');
    t.port.say('hi');
    t.port.react('fire');
    t.port.remind();
    expect(s.messages('ready').at(-1)).toMatchObject({ ready: true });
    expect(s.messages('config')[0]).toMatchObject({ gameId: 'knee-sprint' });
    expect(s.messages('preset').map((m) => m['id'])).toEqual(['hi', 'ready']);
    expect(s.messages('react')[0]).toMatchObject({ id: 'fire' });
  });

  it('sends free text only in a room that allows it', async () => {
    const t = setup();
    await t.port.join('K7P2QX');
    const s = t.sockets[0] as FakeSocket;
    t.welcome(s, [member('s1', 'Ayse'), member('s2', 'Doruk')], room({ chat: 'preset' }));
    expect(t.port.sendText('hello')).toEqual({ ok: false, reason: 'not_allowed' });
    expect(s.messages('chat')).toHaveLength(0);
    s.say({ t: 'room', room: room({ chat: 'text' }) });
    expect(t.port.sendText('hello')).toEqual({ ok: true });
    expect(s.messages('chat')[0]).toMatchObject({ text: 'hello' });
  });

  it('leaves for good: it says goodbye to the Room and the room is gone from the screens', async () => {
    const t = setup();
    await t.port.join('K7P2QX');
    const s = t.sockets[0] as FakeSocket;
    t.welcome(s, [member('s1', 'Ayse'), member('s2', 'Doruk')]);
    t.port.leave();
    expect(s.messages('bye')).toHaveLength(1);
    expect(s.closedWith).toBe(1000);
    expect(t.port.state().phase).toBe('idle');
    expect(t.port.client()).toBeNull();
    // a message from the room that was left changes nothing
    s.say({ t: 'chat', from: 's1', text: 'late', at: 9 });
    expect(t.port.state().feed).toHaveLength(0);
  });

  it('gives the client of the open room to the stage of a race', async () => {
    const t = setup();
    expect(t.port.client()).toBeNull();
    await t.port.join('K7P2QX');
    expect(t.port.client()).not.toBeNull();
  });

  it('shares the camera only when the player asks, and gives it back when they stop', async () => {
    let stopped = 0;
    const track = { stop: () => { stopped++; } } as unknown as MediaStreamTrack;
    const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
    const sched = new ManualScheduler();
    const sockets: FakeSocket[] = [];
    const port = createLiveRoomPort({
      origin: ORIGIN, identity: () => ME,
      fetcher: (async () => new Response(JSON.stringify(grantFor('K7P2QX')), { status: 200 })) as unknown as typeof fetch,
      makeClient: (o) => new LiveClient({ ...o, peers: 'none', sched, socket: () => { const s = new FakeSocket(); sockets.push(s); return s; } }),
      openCamera: async () => stream,
    });
    await port.join('K7P2QX');
    const s = sockets[0] as FakeSocket;
    s.open();
    s.say({ t: 'welcome', v: NET_PROTOCOL, you: 's2', now: sched.now(), room: room(), members: [member('s1', 'Ayse'), member('s2', 'Doruk')], match: null, mine: [], blocked: [] });
    port.setShareVideo(true);
    expect(port.state().shareVideo).toBe(true);
    await flush();
    expect(port.client()?.stream).toBe(stream);
    expect(s.messages('video').at(-1)).toMatchObject({ on: true });
    port.setShareVideo(false);
    expect(port.state().shareVideo).toBe(false);
    expect(stopped).toBe(1);
    expect(s.messages('video').at(-1)).toMatchObject({ on: false });
  });
});

describe('a friend camera that does not connect', () => {
  // Until a TURN relay is paid for, two players behind strict networks get no camera link: the room page says so and offers a retry.
  function withCamera() {
    const sched = new ManualScheduler();
    const sockets: FakeSocket[] = [];
    const pcs: FakePeerConnection[] = [];
    const port = createLiveRoomPort({
      origin: ORIGIN, identity: () => ME,
      fetcher: (async () => new Response(JSON.stringify(grantFor('K7P2QX')), { status: 200 })) as unknown as typeof fetch,
      makeClient: (o) => new LiveClient({
        ...o, peers: 'webrtc', warmup: false, sched, socket: () => { const s = new FakeSocket(); sockets.push(s); return s; },
        createPeerConnection: () => { const pc = new FakePeerConnection(); pcs.push(pc); return pc as unknown as RTCPeerConnection; },
      }),
      openCamera: async () => new FakeMediaStream() as unknown as MediaStream,
    });
    return { sched, sockets, pcs, port };
  }

  it('shows connecting, then failed with a retry that can work, and goes quiet when the picture comes', async () => {
    const t = withCamera();
    await t.port.join('K7P2QX');
    const s = t.sockets[0] as FakeSocket;
    s.open();
    const both = [member('s1', 'Ayse', { video: true }), member('s2', 'Doruk', { video: true })];
    s.say({ t: 'welcome', v: NET_PROTOCOL, you: 's2', now: t.sched.now(), room: room(), members: both, match: null, mine: [], blocked: [] });
    t.port.setShareVideo(true);
    await flush();
    // the Room says both want video: the link is being made
    s.say({ t: 'presence', members: both });
    expect(t.port.state().videos).toEqual([expect.objectContaining({ seat: 's1', state: 'connecting' })]);
    t.sched.advance(VIDEO_CONNECT_MS + 300);
    expect(t.port.state().videos).toEqual([expect.objectContaining({ seat: 's1', state: 'failed', reason: 'timeout', retryable: true })]);
    // the retry button: a new attempt at once, a new link, the state says connecting again
    const links = t.pcs.length;
    t.port.retryVideo?.();
    expect(t.port.state().videos).toEqual([expect.objectContaining({ seat: 's1', state: 'connecting', attempts: 1 })]);
    await flush();
    t.sched.advance(200);
    await flush();
    expect(t.pcs.length).toBeGreaterThan(links);
    // the picture starts
    const pc = t.pcs.filter((x) => !x.closed).at(-1) as FakePeerConnection;
    pc.connect();
    pc.receive().unmute();
    expect(t.port.state().videos).toEqual([expect.objectContaining({ seat: 's1', state: 'live' })]);
  });

  it('starts the next room without the notes of the last (a failed camera of the room before is not shown in the new one)', async () => {
    const t = withCamera();
    await t.port.join('K7P2QX');
    const s = t.sockets[0] as FakeSocket;
    s.open();
    const both = [member('s1', 'Ayse', { video: true }), member('s2', 'Doruk', { video: true })];
    s.say({ t: 'welcome', v: NET_PROTOCOL, you: 's2', now: t.sched.now(), room: room(), members: both, match: null, mine: [], blocked: [] });
    t.port.setShareVideo(true);
    await flush();
    s.say({ t: 'presence', members: both });
    t.sched.advance(VIDEO_CONNECT_MS + 300);
    expect(t.port.state().videos?.[0]?.state).toBe('failed');
    t.port.leave();
    expect(t.port.state().videos).toBeUndefined();
    await t.port.join('ABCDEF');
    expect(t.port.state().videos).toBeUndefined();
    expect(t.port.state().phase).toBe('joining');
  });

  it('has no video list at all in a room where nobody shares a camera', async () => {
    const t = setup();
    await t.port.join('K7P2QX');
    t.welcome(t.sockets[0] as FakeSocket, [member('s1', 'Ayse'), member('s2', 'Doruk')]);
    expect(t.port.state().videos).toBeUndefined();
  });
});

describe('the Pro games of a room', () => {
  // The paywall promises "rooms where everyone plays the Pro games the host picks": the Worker and the Room check the host's signed
  // Pro token (core/entitlements), so the page hands it over and says what to do when it is not enough.
  const PRO_ROOM = { game: 'limbo-bend', kind: 'private' as const, size: 2, band: null };

  it('sends the token the app holds now with every create and join, and nothing at all for a free player', async () => {
    let token: string | null = 'TOKEN-A';
    const t = setup({ pro: () => token });
    await t.port.create(PRO_ROOM);
    expect(t.calls[0]?.body).toMatchObject({ gameId: 'limbo-bend', pro: 'TOKEN-A' });
    token = 'TOKEN-B';                                              // the app renewed it meanwhile: the newest one goes
    await t.port.join('ABCDEF');
    expect(t.calls[1]?.body).toMatchObject({ pro: 'TOKEN-B', pid: ME.pid });
    token = null;
    await t.port.join('GHJKLM');
    expect('pro' in (t.calls[2]?.body as object)).toBe(false);
    const free = setup();
    await free.port.create(PRO_ROOM);
    expect('pro' in (free.calls[0]?.body as object)).toBe(false);
    for (const c of [...t.calls, ...free.calls]) expect(JSON.stringify(c.body)).not.toMatch(/"(isPro|free|premium)"/);
  });

  it('says why the Worker refused a Pro game (nothing to show, a token that ran out, one that is not valid) and keeps nothing else', async () => {
    for (const reason of ['none', 'expired', 'invalid'] as const) {
      const t = setup({ fetch: () => new Response(JSON.stringify({ error: 'pro_required', reason }), { status: 403 }) });
      expect(t.port.proNeeded()).toBeNull();
      expect(await t.port.create(PRO_ROOM), reason).toEqual({ ok: false, code: 'not_allowed' });
      expect(t.port.state()).toMatchObject({ phase: 'closed', problem: 'not_allowed' });
      expect(t.port.proNeeded()).toMatchObject({ game: 'limbo-bend', reason });
      t.port.dismissProNeeded();
      expect(t.port.proNeeded()).toBeNull();
    }
    const odd = setup({ fetch: () => new Response(JSON.stringify({ error: 'pro_required', reason: 'whatever' }), { status: 403 }) });
    await odd.port.create(PRO_ROOM);
    expect(odd.port.proNeeded()?.reason).toBe('none');
    expect(problemOf(new LiveApiError(403, 'pro_required'))).toBe('not_allowed');
  });

  it('a new try ends the note of the one before, and a refusal for another reason is no Pro note', async () => {
    let answer: Response = new Response(JSON.stringify({ error: 'pro_required', reason: 'none' }), { status: 403 });
    const t = setup({ fetch: () => answer.clone() });
    await t.port.create(PRO_ROOM);
    expect(t.port.proNeeded()).not.toBeNull();
    answer = new Response(JSON.stringify({ error: 'full' }), { status: 409 });
    await t.port.join('K7P2QX');
    expect(t.port.state().problem).toBe('full');
    expect(t.port.proNeeded()).toBeNull();                         // the join failed for its own reason: the Pro note of the create is over
    answer = new Response(JSON.stringify({ error: 'pro_required', reason: 'expired' }), { status: 403 });
    await t.port.create(PRO_ROOM);
    expect(t.port.proNeeded()).toMatchObject({ reason: 'expired' });
    answer = new Response(JSON.stringify(grantFor('K7P2QX')), { status: 200 });
    expect(await t.port.join('K7P2QX')).toEqual({ ok: true, value: undefined });
    expect(t.port.proNeeded()).toBeNull();
  });

  it('shows what the Room said when the host picks a Pro game with no proof, and clears it when the Room takes the game', async () => {
    const t = setup({ pro: () => null });
    await t.port.join('K7P2QX');
    const s = t.sockets[0] as FakeSocket;
    t.welcome(s, [member('s1', 'Doruk'), member('s2', 'Ayse')]);
    let heard = 0;
    t.port.subscribe(() => { heard++; });
    t.port.chooseGame('limbo-bend');
    expect(s.messages('config')[0]).toMatchObject({ gameId: 'limbo-bend' });
    expect(t.port.proNeeded()).toBeNull();
    s.say({ t: 'error', code: 'pro_required' });
    expect(t.port.proNeeded()).toMatchObject({ game: 'limbo-bend', reason: 'refused' });
    expect(heard).toBeGreaterThan(0);
    // the room keeps the game it had; an unrelated update does not clear the note
    s.say({ t: 'room', room: room({ chat: 'preset' }) });
    expect(t.port.proNeeded()).not.toBeNull();
    // a pick the Room takes (the game changed, covered) clears it
    t.port.chooseGame('limbo-bend');
    s.say({ t: 'room', room: room({ config: { gameId: 'limbo-bend', durationMs: 90_000, band: null }, pro: { ok: true } }) });
    expect(t.port.proNeeded()).toBeNull();
    expect(t.port.state().info?.pro).toEqual({ ok: true });
  });

  it('a Pro game the Room cannot start (the proof ran out) keeps the note open: only a covered Pro game or a free one clears it', async () => {
    const t = setup({ pro: () => null });
    await t.port.join('K7P2QX');
    const s = t.sockets[0] as FakeSocket;
    t.welcome(s, [member('s1', 'Doruk'), member('s2', 'Ayse')]);
    t.port.chooseGame('pad-work');
    s.say({ t: 'error', code: 'pro_required' });
    s.say({ t: 'room', room: room({ config: { gameId: 'pad-work', durationMs: 90_000, band: null }, pro: { ok: false } }) });
    expect(t.port.proNeeded()).not.toBeNull();
    expect(t.port.state().info?.pro).toEqual({ ok: false });
    t.port.chooseGame('squat-flap');
    s.say({ t: 'room', room: room() });
    expect(t.port.proNeeded()).toBeNull();
  });

  it('leaving the room clears the note and what was picked', async () => {
    const t = setup();
    await t.port.join('K7P2QX');
    const s = t.sockets[0] as FakeSocket;
    t.welcome(s, [member('s1', 'Doruk'), member('s2', 'Ayse')]);
    t.port.chooseGame('reaction-tag');
    s.say({ t: 'error', code: 'pro_required' });
    expect(t.port.proNeeded()).not.toBeNull();
    t.port.leave();
    expect(t.port.proNeeded()).toBeNull();
    await t.port.join('K7P2QX');
    t.welcome(t.sockets[1] as FakeSocket, [member('s1', 'Doruk'), member('s2', 'Ayse')]);
    t.sockets[1]?.say({ t: 'room', room: room({ config: { gameId: 'reaction-tag', durationMs: 90_000, band: null }, pro: { ok: true } }) });
    expect(t.port.proNeeded()).toBeNull();                         // a late room update does not bring the old note back
  });

  it('a rejected ticket is renewed with the token the app holds at that moment', async () => {
    let token: string | null = 'TOKEN-A';
    const t = setup({ pro: () => token });
    await t.port.join('K7P2QX');
    const s = t.sockets[0] as FakeSocket;
    t.welcome(s, [member('s1', 'Doruk'), member('s2', 'Ayse')]);
    token = 'TOKEN-B';
    s.closeFromServer(4002);
    await flush();
    expect(t.calls.at(-1)).toMatchObject({ url: `${ORIGIN}/api/rooms/K7P2QX/join`, body: { pro: 'TOKEN-B' } });
  });
});
