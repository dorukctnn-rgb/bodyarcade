// The camera link to a friend (video.ts): every state, every way to fail, and the rule that nothing waits for ever.
import { describe, expect, it } from 'vitest';
import type { MemberInfo } from '../types/net.ts';
import { friendTiles } from './friend-tile.ts';
import { ManualScheduler } from './testkit.ts';
import { VIDEO_CONNECT_MS, VIDEO_RETRY_GAP_MS, VIDEO_STALL_MS, VideoTracker, type VideoProbe, type VideoStatus } from './video.ts';

const WANT: VideoProbe = { wanted: true, supported: true, flowing: false, ice: 'checking', track: false };

function tracker(): { t: VideoTracker; clock: ManualScheduler; seen: VideoStatus[] } {
  const clock = new ManualScheduler();
  const seen: VideoStatus[] = [];
  return { t: new VideoTracker(() => clock.now(), (s) => { seen.push(s); }), clock, seen };
}

describe('the state of a friend camera link', () => {
  it('is off, and silent, while nobody asked for a camera', () => {
    const { t, seen } = tracker();
    expect(t.update('s2', { ...WANT, wanted: false }).state).toBe('off');
    expect(t.status('s2').state).toBe('off');
    expect(t.all()).toEqual([]);
    expect(seen).toEqual([]);
  });

  it('goes connecting when both opted in and live when the picture flows', () => {
    const { t, clock, seen } = tracker();
    t.update('s2', WANT);
    clock.advance(1500);
    t.update('s2', { ...WANT, ice: 'connected', track: true });
    expect(t.status('s2')).toMatchObject({ state: 'connecting', reason: null, retryable: true, attempts: 0 });
    clock.advance(500);
    t.update('s2', { ...WANT, ice: 'connected', track: true, flowing: true });
    expect(t.status('s2')).toMatchObject({ state: 'live', reason: null, retryable: true });
    expect(seen.map((s) => s.state)).toEqual(['connecting', 'live']);
  });

  it('fails with "timeout" at the deadline when the link never comes up (no path between the devices, no relay server) and not a moment before', () => {
    const { t, clock, seen } = tracker();
    t.update('s2', WANT);
    clock.advance(VIDEO_CONNECT_MS - 1);
    expect(t.update('s2', WANT).state).toBe('connecting');
    clock.advance(1);
    const s = t.update('s2', WANT);
    expect(s).toMatchObject({ state: 'failed', reason: 'timeout', retryable: true });
    expect(seen.map((x) => x.state)).toEqual(['connecting', 'failed']);
    // and it stays failed without more events while nothing changes
    for (let i = 0; i < 20; i++) { clock.advance(1000); t.update('s2', WANT); }
    expect(seen).toHaveLength(2);
  });

  it('fails at once with "ice_failed" when the browser gives up on every path', () => {
    const { t, clock } = tracker();
    t.update('s2', WANT);
    clock.advance(2000);
    expect(t.update('s2', { ...WANT, ice: 'failed' })).toMatchObject({ state: 'failed', reason: 'ice_failed' });
  });

  it('fails with "no_track" when the link is up but the friend\'s picture never starts', () => {
    const { t, clock } = tracker();
    t.update('s2', WANT);
    clock.advance(VIDEO_CONNECT_MS);
    expect(t.update('s2', { ...WANT, ice: 'connected', track: false })).toMatchObject({ state: 'failed', reason: 'no_track' });
    const u = tracker();
    u.t.update('s2', WANT);
    u.clock.advance(VIDEO_CONNECT_MS);
    expect(u.t.update('s2', { ...WANT, ice: 'checking', track: true })).toMatchObject({ state: 'failed', reason: 'no_track' });
  });

  it('turns back into live by itself when a picture arrives after the failure (the link keeps trying in the background)', () => {
    const { t, clock, seen } = tracker();
    t.update('s2', WANT);
    clock.advance(VIDEO_CONNECT_MS);
    t.update('s2', WANT);
    clock.advance(20_000);
    t.update('s2', { ...WANT, ice: 'connected', track: true, flowing: true });
    expect(seen.map((x) => x.state)).toEqual(['connecting', 'failed', 'live']);
  });

  it('keeps the picture through a short stall and starts a new deadline after a long one', () => {
    const { t, clock, seen } = tracker();
    const FLOW = { ...WANT, ice: 'connected', track: true, flowing: true };
    t.update('s2', FLOW);
    clock.advance(1000);
    t.update('s2', FLOW);
    clock.advance(VIDEO_STALL_MS - 1);
    expect(t.update('s2', { ...FLOW, flowing: false }).state).toBe('live');
    clock.advance(2);
    expect(t.update('s2', { ...FLOW, flowing: false }).state).toBe('connecting');
    clock.advance(VIDEO_CONNECT_MS);
    expect(t.update('s2', { ...FLOW, flowing: false })).toMatchObject({ state: 'failed', reason: 'no_track' });
    expect(seen.map((x) => x.state)).toEqual(['live', 'connecting', 'failed']);
  });

  it('cannot be tried again on a device with no peer links at all, and says so at once', () => {
    const { t, clock } = tracker();
    const s = t.update('s2', { ...WANT, supported: false });
    expect(s).toMatchObject({ state: 'failed', reason: 'unsupported', retryable: false });
    clock.advance(60_000);
    expect(t.retry('s2')).toBe(false);
    expect(t.status('s2').state).toBe('failed');
  });

  it('goes off, and forgets its attempts, when the friend switches the camera off or leaves', () => {
    const { t, clock, seen } = tracker();
    t.update('s2', WANT);
    clock.advance(VIDEO_CONNECT_MS);
    t.update('s2', WANT);
    expect(t.retry('s2')).toBe(true);
    expect(t.status('s2').attempts).toBe(1);
    t.update('s2', { ...WANT, wanted: false });
    expect(t.status('s2')).toMatchObject({ state: 'off', attempts: 0 });
    clock.advance(10_000);
    t.update('s2', WANT);
    expect(t.status('s2')).toMatchObject({ state: 'connecting', attempts: 0 });
    t.forget('s2');
    expect(t.status('s2').state).toBe('off');
    expect(seen.at(-1)?.state).toBe('off');
  });
});

describe('trying again', () => {
  it('starts a fresh attempt with a fresh deadline and counts it', () => {
    const { t, clock } = tracker();
    t.update('s2', WANT);
    clock.advance(VIDEO_CONNECT_MS);
    t.update('s2', WANT);
    expect(t.status('s2').state).toBe('failed');
    expect(t.retry('s2')).toBe(true);
    expect(t.status('s2')).toMatchObject({ state: 'connecting', attempts: 1, reason: null });
    clock.advance(VIDEO_CONNECT_MS - 1);
    expect(t.update('s2', WANT).state).toBe('connecting');
    clock.advance(1);
    expect(t.update('s2', WANT)).toMatchObject({ state: 'failed', attempts: 1, reason: 'timeout' });
  });

  it('is refused while the last try is only a moment old, and when there is nothing to try', () => {
    const { t, clock } = tracker();
    expect(t.retry('s2')).toBe(false);                         // nothing known
    t.update('s2', WANT);
    clock.advance(VIDEO_CONNECT_MS);
    t.update('s2', WANT);
    expect(t.retry('s2')).toBe(true);
    clock.advance(VIDEO_RETRY_GAP_MS - 1);
    expect(t.retry('s2')).toBe(false);
    clock.advance(1);
    expect(t.retry('s2')).toBe(true);
    expect(t.status('s2').attempts).toBe(2);
    // a picture that flows is not retried
    t.update('s2', { ...WANT, flowing: true, ice: 'connected', track: true });
    clock.advance(10_000);
    expect(t.retry('s2')).toBe(false);
  });
});

describe('what each friend tile shows', () => {
  const member = (seat: string, name: string, online = true): MemberInfo => ({ seat, name, host: seat === 's1', online, ready: true, sess: seat, video: true });
  const members = [member('s1', 'Ece'), member('s3', 'Can'), member('s2', 'Ada')];
  const st = (seat: string, state: VideoStatus['state'], over: Partial<VideoStatus> = {}): VideoStatus => ({ seat, state, reason: null, retryable: true, attempts: 0, since: 0, ...over });

  it('draws the skeleton unless the picture flows, tells a failed camera in one line and offers the retry only when it can work', () => {
    const tiles = friendTiles(members, 's1', [st('s2', 'live'), st('s3', 'failed', { reason: 'timeout' })]);
    expect(tiles.map((x) => x.seat)).toEqual(['s2', 's3']);
    expect(tiles[0]).toEqual({ seat: 's2', name: 'Ada', online: true, show: 'video', note: null, retry: false });
    expect(tiles[1]).toEqual({ seat: 's3', name: 'Can', online: true, show: 'skeleton', note: 'room.video.failed', retry: true });
    expect(friendTiles(members, 's1', [st('s2', 'connecting')])[0]).toMatchObject({ show: 'skeleton', note: 'room.video.connecting', retry: false });
    expect(friendTiles(members, 's1', [st('s2', 'failed', { reason: 'unsupported', retryable: false })])[0]).toMatchObject({ show: 'skeleton', note: 'room.video.failed', retry: false });
    // nobody shares a camera: skeletons and nothing else
    for (const x of friendTiles(members, 's1', [])) expect(x).toMatchObject({ show: 'skeleton', note: null, retry: false });
  });
});
