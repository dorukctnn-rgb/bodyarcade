import { describe, expect, it } from 'vitest';
import type { LiveClient, LiveEvents } from '../../../core/net/client.ts';
import type { MatchInfo, MatchResult, MemberInfo } from '../../../core/types/net.ts';
import { liveFeed, phaseOf } from './live-feed.ts';

const base = (over: Partial<MatchInfo> = {}): MatchInfo => ({ id: 'm1', seed: 9, gameId: 'squat-flap', startAt: 10_000, duration: 90_000, phase: 'running', pausedAt: null, resumeAt: null, pauseTotal: 0, reasons: {}, seats: ['s1', 's2'], forfeited: [], result: null, ...over });
const member = (seat: string, name: string): MemberInfo => ({ seat, name, host: seat === 's1', online: true, ready: true, sess: `x${seat}`, video: false });

describe('the phase of a match', () => {
  it('is waiting before there is a match', () => {
    expect(phaseOf(null, 5)).toBe('wait');
  });
  it('counts down to the start, then runs', () => {
    expect(phaseOf(base(), 6_500)).toBe('count');
    expect(phaseOf(base(), 10_000)).toBe('run');
    expect(phaseOf(base(), 60_000)).toBe('run');
  });
  it('holds while paused, counts the 3-2-1 after it, and runs on', () => {
    expect(phaseOf(base({ phase: 'paused', pausedAt: 20_000 }), 25_000)).toBe('hold');
    // resumed: the countdown is part of the paused time, so the match clock is back at zero of the run until resumeAt
    const resumed = base({ pauseTotal: 8_000, resumeAt: 28_000 });
    expect(phaseOf(resumed, 27_000)).toBe('count');
    expect(phaseOf(resumed, 28_000)).toBe('run');
  });
  it('is over while the Room settles and after', () => {
    expect(phaseOf(base({ phase: 'settling' }), 1e6)).toBe('over');
    expect(phaseOf(base({ phase: 'over' }), 1e6)).toBe('over');
  });
});

/** Just enough of the client for the feed: events, the match, the clock. */
function fakeClient() {
  const handlers = new Map<string, Set<(d: never) => void>>();
  const c = {
    you: 's2' as string | null,
    members: [member('s1', 'Ayse'), member('s2', 'Doruk')],
    match: null as MatchInfo | null,
    now: 0,
    sent: [] as unknown[],
    reported: [] as unknown[],
    finished: [] as unknown[],
    get playing() { return !!c.match && c.match.phase !== 'over' && !!c.you && c.match.seats.includes(c.you) && !c.match.forfeited.includes(c.you); },
    on<K extends keyof LiveEvents>(k: K, fn: (d: LiveEvents[K]) => void) { let s = handlers.get(k); if (!s) { s = new Set(); handlers.set(k, s); } s.add(fn as (d: never) => void); return () => { s?.delete(fn as (d: never) => void); }; },
    emit<K extends keyof LiveEvents>(k: K, d: LiveEvents[K]) { for (const fn of [...(handlers.get(k) ?? [])]) fn(d as never); },
    serverNow: () => c.now,
    matchTime: () => (c.match ? c.now - c.match.startAt - c.match.pauseTotal : 0),
    reportResult: (ob: number, k: string) => { c.reported.push([ob, k]); },
    finish: (r: unknown) => { c.finished.push(r); },
    sendState: (d: unknown) => { c.sent.push(d); },
  };
  return c;
}

describe('the feed of a race', () => {
  it('has no match until the Room has started one that this player plays', () => {
    const c = fakeClient();
    const f = liveFeed(c as unknown as LiveClient);
    expect(f.match()).toBeNull();
    expect(f.phase()).toBe('wait');
    c.match = base();
    expect(f.match()).toMatchObject({ id: 'm1', seed: 9, durationMs: 90_000, gameId: 'squat-flap', results: [] });
    c.match = base({ forfeited: ['s2'] });
    expect(f.match()).toBeNull();
    c.match = base({ phase: 'over' });
    expect(f.match()).toBeNull();
  });

  it('hands over the results the Room already holds when the page joins a running match', () => {
    const c = fakeClient();
    const f = liveFeed(c as unknown as LiveClient);
    c.match = base();
    c.emit('match', { match: c.match, mine: [{ ob: 1, k: 'pass' }, { ob: 2, k: 'hit' }], why: 'welcome' });
    expect(f.match()?.results).toEqual([{ ob: 1, k: 'pass' }, { ob: 2, k: 'hit' }]);
    // a new match starts clean
    c.match = base({ id: 'm2' });
    c.emit('match', { match: c.match, mine: [], why: 'start' });
    expect(f.match()?.results).toEqual([]);
  });

  it('tells time and phase from the client and passes results, the final list and the state on', () => {
    const c = fakeClient();
    const f = liveFeed(c as unknown as LiveClient);
    c.match = base();
    c.now = 8_000;
    expect(f.time()).toBe(-2_000);
    expect(f.phase()).toBe('count');
    c.now = 12_500;
    expect(f.time()).toBe(2_500);
    expect(f.phase()).toBe('run');
    f.report(3, 'pass');
    f.finish([{ ob: 3, k: 'pass' }]);
    f.state({ mt: 2500, sc: 100 });
    expect(c.reported).toEqual([[3, 'pass']]);
    expect(c.finished).toEqual([[{ ob: 3, k: 'pass' }]]);
    expect(c.sent).toEqual([{ mt: 2500, sc: 100 }]);
  });

  it('follows the rivals: their names, their live scores, and who has left', () => {
    const c = fakeClient();
    const f = liveFeed(c as unknown as LiveClient);
    const seen: string[] = [];
    f.onRivals((r) => seen.push(r.map((x) => `${x.name}:${x.score}`).join(',')));
    c.match = base();
    c.emit('match', { match: c.match, mine: [], why: 'start' });
    c.emit('state', { from: 's1', d: { mt: 3000, sc: 120 }, path: 'dc', latency: 20 });
    c.emit('state', { from: 's1', d: { mt: 3100, sc: 120 }, path: 'dc', latency: 20 });       // same score: nothing new to say
    c.emit('state', { from: 's1', d: { mt: 6000, sc: 330 }, path: 'relay', latency: 90 });
    c.emit('state', { from: 's1', d: { mt: 6000, sc: 'x' }, path: 'dc', latency: 20 });       // not a score: ignored
    expect(seen).toEqual(['Ayse:0', 'Ayse:120', 'Ayse:330']);
    expect(f.rivals()).toEqual([{ seat: 's1', name: 'Ayse', score: 330 }]);
    c.match = base({ forfeited: ['s1'] });
    c.emit('forfeit', { seat: 's1', match: c.match });
    expect(f.rivals()).toEqual([]);
  });

  it('keeps the result, and the final scores of the rivals from it', () => {
    const c = fakeClient();
    const f = liveFeed(c as unknown as LiveClient);
    const res: MatchResult = { mid: 'm1', reason: 'complete', winner: 's1', places: { s1: 1, s2: 2 }, scores: { s1: { score: 700, hits: 1, passes: 9, bestCombo: 6 }, s2: { score: 450, hits: 3, passes: 6, bestCombo: 3 } }, forfeited: [] };
    expect(f.result()).toBeNull();
    c.match = base({ phase: 'over' });
    c.emit('result', res);
    expect(f.result()).toBe(res);
    expect(f.rivals()[0]?.score).toBe(700);
    // the next match forgets it
    c.match = base({ id: 'm2' });
    c.emit('match', { match: c.match, mine: [], why: 'start' });
    expect(f.result()).toBeNull();
  });

  it('stops listening when it is disposed', () => {
    const c = fakeClient();
    const f = liveFeed(c as unknown as LiveClient);
    f.dispose();
    c.match = base();
    c.emit('state', { from: 's1', d: { mt: 1, sc: 5 }, path: 'dc', latency: 1 });
    expect(f.rivals()[0]?.score).toBe(0);
  });
});
