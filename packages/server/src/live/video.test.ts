// The optional friend camera when the direct connection does not work, with the real Room engine and the real LiveClient on a
// manual clock and a fake peer connection that the test drives. This is what the product looks like until a TURN relay is paid
// for (and for the pairs of players that even a relay cannot join): the camera link never comes up, the player is told in one
// line, the friend is a skeleton, the race and the chat go through the Room as ever, and "try again" makes a new attempt
// that picks up whatever servers /api/ice offers by then, a TURN key added later included, with no change of code.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveClient, type LiveClientOptions } from '../../../core/net/client.ts';
import { friendTiles } from '../../../core/net/friend-tile.ts';
import { FakeMediaStream, FakePeerConnection as FakePc } from '../../../core/net/testkit.ts';
import { VIDEO_CONNECT_MS, type VideoStatus } from '../../../core/net/video.ts';
import type { IceGrant, MatchResult } from '../../../core/types/net.ts';
import { Net, seeded } from './loopkit.ts';

interface Player {
  c: LiveClient;
  pcs: FakePc[];
  video: VideoStatus[];
  results: MatchResult[];
  ghosts: { path: string; sc: unknown }[];
  ice: { pulls: number; turn: boolean };
  fresh(): FakePc | undefined;
}

function player(net: Net, pid: string, o: Partial<LiveClientOptions> = {}, broken = false): Player {
  const pcs: FakePc[] = [];
  const ice = { pulls: 0, turn: false };
  const c = new LiveClient({
    grant: net.grant(pid), origin: 'http://loop', peers: 'webrtc', video: true, stream: new FakeMediaStream() as unknown as MediaStream, warmup: false,
    sched: net.sched, socket: net.factory, random: seeded(pid),
    // the Worker's /api/ice: STUN only until a TURN key exists
    ice: async (): Promise<IceGrant> => {
      ice.pulls++;
      return { iceServers: [{ urls: 'stun:stun.example:3478' }, ...(ice.turn ? [{ urls: 'turn:turn.example:3478', username: 'u', credential: 'c' }] : [])], turn: ice.turn, exp: 4_000_000_000 };
    },
    createPeerConnection: (cfg) => {
      if (broken) throw new Error('no WebRTC here');
      const pc = new FakePc(cfg);
      pcs.push(pc);
      return pc as unknown as RTCPeerConnection;
    },
    ...o,
  });
  const p: Player = { c, pcs, video: [], results: [], ghosts: [], ice, fresh: () => pcs.filter((x) => !x.closed).at(-1) };
  c.on('video', (s) => { p.video.push(s); });
  c.on('result', (r) => { p.results.push(r); });
  c.on('state', (s) => { p.ghosts.push({ path: s.path, sc: (s.d as { sc?: unknown } | null)?.sc }); });
  void c.start();
  return p;
}

const settle = async (): Promise<void> => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

async function pair(): Promise<{ net: Net; a: Player; b: Player }> {
  const net = await Net.make({ size: 2, config: { gameId: 'squat-flap', durationMs: 15_000, band: null } });
  const a = player(net, 'alice-device-01');
  const b = player(net, 'bob-device-0002');
  await settle();
  net.run(1500);
  await settle();
  return { net, a, b };
}

beforeEach(() => { vi.stubGlobal('RTCPeerConnection', FakePc); });
afterEach(() => { vi.unstubAllGlobals(); });

const states = (p: Player): string[] => p.video.map((s) => s.state);

describe('a friend camera that cannot connect (no relay server, strict networks)', () => {
  it('is told within the deadline, once, with the skeleton on the tile, and the race goes on through the Room as if nothing happened', async () => {
    const { net, a, b } = await pair();
    // both opted in: the links are being made, nothing flows
    expect(a.pcs).toHaveLength(1);
    expect(b.pcs).toHaveLength(1);
    expect(a.c.videoStatus('s2')).toMatchObject({ state: 'connecting', retryable: true, attempts: 0 });
    a.pcs[0]!.iceConnectionState = 'checking'; b.pcs[0]!.iceConnectionState = 'checking';

    // the lobby: ready, the Room starts the match by itself
    a.c.setReady(true); b.c.setReady(true);
    net.run(VIDEO_CONNECT_MS - 1500);
    expect(a.c.videoStatus('s2').state).toBe('connecting');
    net.run(1500);
    for (const p of [a, b]) {
      expect(p.c.videoStatus(p === a ? 's2' : 's1')).toMatchObject({ state: 'failed', reason: 'timeout', retryable: true });
      expect(states(p)).toEqual(['connecting', 'failed']);
    }
    // the tile: a skeleton, one line, a retry button
    const tile = friendTiles(a.c.members, a.c.you, a.c.videoStatuses())[0];
    expect(tile).toMatchObject({ seat: 's2', show: 'skeleton', note: 'room.video.failed', retry: true });

    // the match: state frames and results go through the Room relay and every number agrees
    const m = a.c.match!;
    expect(m).toBeTruthy();
    for (let i = 0; i < 60; i++) {
      a.c.sendState({ mt: i * 100, sc: 100 + i });
      net.run(100);
    }
    expect(b.ghosts.length).toBeGreaterThan(30);
    expect(b.ghosts.every((g) => g.path === 'relay')).toBe(true);
    expect(b.ghosts.at(-1)?.sc).toBe(159);
    net.run(20_000);
    await settle();
    expect(a.results).toHaveLength(1);
    expect(b.results).toEqual(a.results);
    expect(a.results[0]?.reason).toBe('complete');
    // the failed state survived the automatic rebuild of the link (12 s without a path) without flicker or a second message
    expect(states(a)).toEqual(['connecting', 'failed']);
    expect(a.c.m.hardResets).toBeGreaterThan(0);
  });

  it('chat and presets still arrive, and nothing waits for the camera (the Room relay is the only road they use)', async () => {
    const { net, a, b } = await pair();
    const heard: string[] = [];
    b.c.on('chat', (m) => { heard.push(m.text); });
    net.run(VIDEO_CONNECT_MS + 500);
    expect(b.c.videoStatus('s1').state).toBe('failed');
    a.c.chat('hello from the other side');
    net.run(500);
    expect(heard).toEqual(['hello from the other side']);
  });

  it('"try again" starts a new attempt at once, with the servers /api/ice offers now, and the camera comes up when a path exists', async () => {
    const { net, a, b } = await pair();
    net.run(VIDEO_CONNECT_MS + 200);
    expect(states(a)).toEqual(['connecting', 'failed']);
    const before = { a: a.pcs.length, b: b.pcs.length, pulls: a.ice.pulls };
    expect(a.pcs[0]!.cfg.iceServers?.some((s) => String(s.urls).startsWith('turn:'))).toBeFalsy();

    // a TURN key is put on the Worker later: nothing changes in the client, the next /api/ice answer has the relay
    a.ice.turn = true; b.ice.turn = true;
    expect(a.c.retryVideo()).toBe(true);
    expect(a.c.videoStatus('s2')).toMatchObject({ state: 'connecting', attempts: 1, reason: null });
    await settle();
    net.run(200);
    await settle();
    expect(a.ice.pulls).toBe(before.pulls + 1);
    expect(a.pcs.length).toBe(before.a + 1);
    expect(b.pcs.length).toBeGreaterThan(before.b);                         // the friend rebuilt its side for the new epoch
    expect(a.pcs[0]!.closed).toBe(true);
    const fresh = a.fresh()!;
    expect(fresh.cfg.iceServers?.some((s) => String(s.urls).startsWith('turn:'))).toBe(true);

    // this time a path exists: both sides connect and the pictures start
    for (const p of [a, b]) { const pc = p.fresh()!; pc.connect(); }
    const ta = a.fresh()!.receive();
    const tb = b.fresh()!.receive();
    net.run(300);
    expect(a.c.videoStatus('s2').state).toBe('connecting');                  // negotiated, not flowing yet
    ta.unmute(); tb.unmute();
    expect(a.c.videoStatus('s2')).toMatchObject({ state: 'live', attempts: 1 });
    expect(b.c.videoStatus('s1').state).toBe('live');
    expect(friendTiles(a.c.members, a.c.you, a.c.videoStatuses())[0]).toMatchObject({ show: 'video', note: null, retry: false });
    expect(states(a)).toEqual(['connecting', 'failed', 'connecting', 'live']);
  });

  it('a retry that fails again fails again within the deadline: never a spinner that stays', async () => {
    const { net, a } = await pair();
    net.run(VIDEO_CONNECT_MS + 200);
    expect(a.c.retryVideo('s2')).toBe(true);
    await settle();
    net.run(VIDEO_CONNECT_MS - 500);
    expect(a.c.videoStatus('s2').state).toBe('connecting');
    net.run(1000);
    expect(a.c.videoStatus('s2')).toMatchObject({ state: 'failed', reason: 'timeout', attempts: 1 });
    // pressing it twice in a row does not make two attempts
    expect(a.c.retryVideo()).toBe(true);
    expect(a.c.retryVideo()).toBe(false);
    expect(states(a)).toEqual(['connecting', 'failed', 'connecting', 'failed', 'connecting']);
  });

  it('a browser that gives up on every path says so at once (ice_failed) instead of at the deadline', async () => {
    const { net, a } = await pair();
    net.run(1000);
    a.pcs[0]!.fail();
    net.run(300);
    expect(a.c.videoStatus('s2')).toMatchObject({ state: 'failed', reason: 'ice_failed', retryable: true });
  });

  it('a link that is up but never brings the friend\'s picture is a failed camera too (no_track)', async () => {
    const { net, a } = await pair();
    net.run(500);
    a.pcs[0]!.connect();
    a.pcs[0]!.receive();                                                    // negotiated and muted: no packets
    net.run(VIDEO_CONNECT_MS);
    expect(a.c.videoStatus('s2')).toMatchObject({ state: 'failed', reason: 'no_track' });
  });

  it('a picture that arrives after the failure takes the failed state away by itself', async () => {
    const { net, a } = await pair();
    net.run(VIDEO_CONNECT_MS + 200);
    expect(a.c.videoStatus('s2').state).toBe('failed');
    const pc = a.fresh()!;
    pc.connect();
    const t = pc.receive();
    t.unmute();
    expect(a.c.videoStatus('s2').state).toBe('live');
    expect(states(a)).toEqual(['connecting', 'failed', 'live']);
  });

  it('switching the camera off in the lobby clears the note on both sides', async () => {
    const { net, a, b } = await pair();
    net.run(VIDEO_CONNECT_MS + 200);
    a.c.setVideo(false);
    net.run(300);
    expect(a.c.videoStatus('s2').state).toBe('off');
    expect(b.c.videoStatus('s1').state).toBe('off');
    expect(friendTiles(b.c.members, b.c.you, b.c.videoStatuses())[0]).toMatchObject({ show: 'skeleton', note: null, retry: false });
  });

  it('a device that cannot make peer links is told at once and is not offered a retry that cannot work; the match is untouched', async () => {
    const net = await Net.make({ size: 2, config: { gameId: 'squat-flap', durationMs: 15_000, band: null } });
    const a = player(net, 'alice-device-01', {}, true);
    const b = player(net, 'bob-device-0002');
    await settle();
    net.run(1500);
    expect(a.c.peersBroken).toBe(true);
    expect(a.c.videoStatus('s2')).toMatchObject({ state: 'failed', reason: 'unsupported', retryable: false });
    expect(a.c.retryVideo()).toBe(false);
    a.c.setReady(true); b.c.setReady(true);
    net.run(40_000);
    await settle();
    expect(a.results).toHaveLength(1);
    expect(b.results).toEqual(a.results);
    expect(friendTiles(a.c.members, a.c.you, a.c.videoStatuses())[0]).toMatchObject({ show: 'skeleton', note: 'room.video.failed', retry: false });
  });

  it('nothing is said about a camera nobody asked for (the default: off on both sides)', async () => {
    const net = await Net.make({ size: 2, config: { gameId: 'squat-flap', durationMs: 15_000, band: null } });
    const a = player(net, 'alice-device-01', { video: false });
    const b = player(net, 'bob-device-0002', { video: false });
    await settle();
    net.run(VIDEO_CONNECT_MS * 3);
    expect(a.video).toEqual([]);
    expect(b.video).toEqual([]);
    expect(a.pcs.length).toBeGreaterThanOrEqual(1);                         // the data link still exists for the fast state
    expect(a.c.videoStatuses()).toEqual([]);
  });
});
