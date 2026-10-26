// InputHub: keyboard, touch, pose, injection, allow() (rule 7), channel priority, draining, local2 streams.
import { describe, expect, it } from 'vitest';
import type { Features, KeyMap, MovementEngine, MovementEvent, TouchMap, Unsubscribe } from '../types/index.ts';
import { createInputHub } from './hub.ts';

const RUNNER_KEYS: KeyMap = {
  ArrowUp: { event: 'jump' }, ' ': { event: 'jump' }, w: { event: 'jump' },
  ArrowDown: { channel: 'crouch', value: 1 }, s: { channel: 'crouch', value: 1 },
  ArrowLeft: { channel: 'lane', value: -1 }, a: { channel: 'lane', value: -1 },
  ArrowRight: { channel: 'lane', value: 1 }, d: { channel: 'lane', value: 1 },
};
const RUNNER_TOUCH: TouchMap = {
  up: { event: 'jump' }, down: { channel: 'crouch', value: 1, holdMs: 900 },
  left: { channel: 'lane', step: -1, min: -1, max: 1 }, right: { channel: 'lane', step: 1, min: -1, max: 1 },
};

function key(target: EventTarget, type: 'keydown' | 'keyup', k: string, extra: Record<string, unknown> = {}): Event {
  const e = Object.assign(new Event(type, { cancelable: true }), { key: k, repeat: false, metaKey: false, ctrlKey: false, altKey: false, ...extra });
  target.dispatchEvent(e);
  return e;
}
function swipe(el: EventTarget, dx: number, dy: number, clock: { t: number }, ms = 120, id = 1): void {
  el.dispatchEvent(Object.assign(new Event('pointerdown'), { pointerId: id, clientX: 200, clientY: 300 }));
  clock.t += ms;
  el.dispatchEvent(Object.assign(new Event('pointerup'), { pointerId: id, clientX: 200 + dx, clientY: 300 + dy }));
}

/** A MovementEngine stand-in: channels and events set by the test. */
function fakeEngine() {
  const ls = new Set<(e: MovementEvent) => void>();
  let ch: Record<string, number> = {};
  let last: Features | null = null;
  const m: MovementEngine & { emit(e: MovementEvent): void; set(c: Record<string, number>, t?: number): void; listeners(): number } = {
    use() {}, setProfile() {}, push() { throw new Error('not used'); },
    onEvent(cb): Unsubscribe { ls.add(cb); return () => { ls.delete(cb); }; },
    channel: (n) => ch[n] ?? 0, channels: () => ch, last: () => last, reset() { ch = {}; },
    emit(e) { for (const cb of ls) cb(e); },
    set(c, t = 0) { ch = c; last = { t } as Features; },
    listeners: () => ls.size,
  };
  return m;
}

function setup(players: 1 | 2 = 1) {
  const clock = { t: 1000 };
  const win = new EventTarget();
  const doc = new EventTarget();
  const el = new EventTarget();
  const hub = createInputHub({ players, now: () => clock.t, window: win });
  return { clock, win, doc, el, hub };
}

describe('InputHub keyboard', () => {
  it('channel keys hold their value while down; the most recent held key of a channel wins', () => {
    const { hub, doc } = setup();
    hub.bindKeyboard(RUNNER_KEYS, doc);
    expect(hub.sample(0).channels.lane ?? 0).toBe(0);
    key(doc, 'keydown', 'ArrowLeft');
    expect(hub.sample(1).channels.lane).toBe(-1);
    key(doc, 'keydown', 'ArrowRight');
    expect(hub.sample(2).channels.lane).toBe(1);
    key(doc, 'keyup', 'ArrowRight');
    expect(hub.sample(3).channels.lane).toBe(-1);   // left is still held
    key(doc, 'keyup', 'ArrowLeft');
    expect(hub.sample(4).channels.lane).toBe(0);
  });

  it('event keys fire once per press, auto-repeat ignored; each event is in exactly one frame', () => {
    const { hub, doc, clock } = setup();
    hub.bindKeyboard(RUNNER_KEYS, doc);
    const e = key(doc, 'keydown', 'ArrowUp');
    expect(e.defaultPrevented).toBe(true);
    key(doc, 'keydown', 'ArrowUp', { repeat: true });
    key(doc, 'keyup', 'ArrowUp');
    clock.t = 1500;
    key(doc, 'keydown', 'W');                       // capital letter matches 'w'
    const f = hub.sample(2000);
    expect(f.events.map((x) => [x.id, x.kind, x.source, x.t])).toEqual([['jump', 'rep', 'keyboard', 1000], ['jump', 'rep', 'keyboard', 1500]]);
    expect(f.source).toBe('keyboard');
    expect(hub.sample(2016).events).toEqual([]);
  });

  it('ignores keys typed into form fields and shortcuts with Ctrl, Cmd or Alt', () => {
    const { hub } = setup();
    const field = Object.assign(new EventTarget(), { tagName: 'input' });
    const editable = Object.assign(new EventTarget(), { tagName: 'DIV', isContentEditable: true });
    hub.bindKeyboard(RUNNER_KEYS, field);
    hub.bindKeyboard(RUNNER_KEYS, editable);
    const e = key(field, 'keydown', ' ');
    key(editable, 'keydown', 'ArrowLeft');
    expect(e.defaultPrevented).toBe(false);
    const doc = new EventTarget();
    hub.bindKeyboard(RUNNER_KEYS, doc);
    key(doc, 'keydown', 'w', { ctrlKey: true });
    key(doc, 'keydown', 'ArrowDown', { metaKey: true });
    const f = hub.sample(1);
    expect(f.events).toEqual([]);
    expect(f.channels.lane ?? 0).toBe(0);
    expect(f.channels.crouch ?? 0).toBe(0);
  });

  it('losing focus releases every held key', () => {
    const { hub, doc, win } = setup();
    hub.bindKeyboard(RUNNER_KEYS, doc);
    key(doc, 'keydown', 's');
    expect(hub.sample(1).channels.crouch).toBe(1);
    win.dispatchEvent(new Event('blur'));
    expect(hub.sample(2).channels.crouch).toBe(0);
  });

  it('unbinding removes the listeners and releases the keys', () => {
    const { hub, doc } = setup();
    const off = hub.bindKeyboard(RUNNER_KEYS, doc);
    key(doc, 'keydown', 'a');
    off();
    expect(hub.sample(1).channels.lane).toBe(0);
    key(doc, 'keydown', 'ArrowUp');
    expect(hub.sample(2).events).toEqual([]);
  });
});

describe('InputHub touch', () => {
  it("swipes: left/right step the lane and keep it (clamped), down crouches for 900 ms, up jumps (today's rules)", () => {
    const { hub, el, clock } = setup();
    hub.bindTouch(el as unknown as HTMLElement, RUNNER_TOUCH);
    swipe(el, 80, 5, clock);
    expect(hub.sample(clock.t).channels.lane).toBe(1);
    swipe(el, 90, -10, clock);
    expect(hub.sample(clock.t).channels.lane).toBe(1);   // clamped at the right lane
    swipe(el, -100, 0, clock);
    swipe(el, -100, 0, clock);
    expect(hub.sample(clock.t).channels.lane).toBe(-1);
    swipe(el, 0, 60, clock);
    const downAt = clock.t;
    expect(hub.sample(downAt + 899).channels.crouch).toBe(1);
    expect(hub.sample(downAt + 900).channels.crouch).toBe(0);
    swipe(el, 3, -70, clock);
    expect(hub.sample(clock.t).events.map((e) => [e.id, e.source])).toEqual([['jump', 'touch']]);
  });

  it('a short movement is a tap only when quick; slow presses do nothing; a cancelled pointer does nothing', () => {
    const { hub, el, clock } = setup();
    hub.bindTouch(el as unknown as HTMLElement, { tap: { event: 'handHit' } });
    swipe(el, 5, 5, clock, 100);
    swipe(el, 5, 5, clock, 600);
    el.dispatchEvent(Object.assign(new Event('pointerdown'), { pointerId: 3, clientX: 0, clientY: 0 }));
    el.dispatchEvent(new Event('pointercancel'));
    el.dispatchEvent(Object.assign(new Event('pointerup'), { pointerId: 3, clientX: 0, clientY: 200 }));
    expect(hub.sample(clock.t).events.map((e) => e.id)).toEqual(['handHit']);
  });

  it('a held key wins over the swiped lane, which comes back when the key is released', () => {
    const { hub, el, doc, clock } = setup();
    hub.bindTouch(el as unknown as HTMLElement, RUNNER_TOUCH);
    hub.bindKeyboard(RUNNER_KEYS, doc);
    swipe(el, 80, 0, clock);
    key(doc, 'keydown', 'ArrowLeft');
    expect(hub.sample(clock.t).channels.lane).toBe(-1);
    key(doc, 'keyup', 'ArrowLeft');
    expect(hub.sample(clock.t).channels.lane).toBe(1);
  });
});

describe('InputHub pose and priority', () => {
  it("feeds the engine's events (source 'pose') and reads its channels at sample time", () => {
    const { hub } = setup();
    const m = fakeEngine();
    hub.connectPose(m);
    m.set({ crouch: 0.4, lean: 0.1 }, 10);
    m.emit({ id: 'jump', kind: 'rep', t: 10 });
    const f = hub.sample(16);
    expect(f.channels).toEqual({ crouch: 0.4, lean: 0.1 });
    expect(f.events).toEqual([{ id: 'jump', kind: 'rep', t: 10, source: 'pose' }]);
    expect(f.source).toBe('pose');
    m.set({ crouch: 0.9, lean: 0.1 }, 20);
    expect(hub.sample(33).channels.crouch).toBe(0.9);
  });

  it('pose drives; keys only nudge a channel the pose leaves at 0', () => {
    const { hub, doc } = setup();
    const m = fakeEngine();
    hub.connectPose(m);
    hub.bindKeyboard(RUNNER_KEYS, doc);
    m.set({ lane: 1, crouch: 0 });
    key(doc, 'keydown', 'ArrowLeft');
    key(doc, 'keydown', 's');
    const f = hub.sample(1);
    expect(f.channels.lane).toBe(1);
    expect(f.channels.crouch).toBe(1);
  });

  it("test injection comes first; a trace engine is source 'trace'", () => {
    const { hub } = setup();
    const m = fakeEngine();
    hub.connectPose(m, 'trace');
    m.set({ lane: -1 });
    m.emit({ id: 'squat', kind: 'rep', t: 5 });
    expect(hub.inject('test', { channels: { lane: 1 }, events: [{ id: 'jump', kind: 'rep', t: 6 }] })).toBe(true);
    const f = hub.sample(7);
    expect(f.channels.lane).toBe(1);
    expect(f.events.map((e) => `${e.id}:${e.source}`)).toEqual(['squat:trace', 'jump:test']);
    hub.inject('test', { channels: { lane: 0 } });
    expect(hub.sample(8).channels.lane).toBe(-1);
  });

  it('connecting another engine for the same player and source replaces the first; unsubscribe stops it', () => {
    const { hub } = setup();
    const a = fakeEngine(), b = fakeEngine();
    hub.connectPose(a);
    const offB = hub.connectPose(b);
    expect(a.listeners()).toBe(0);
    a.set({ lane: -1 });
    b.set({ lane: 1 });
    expect(hub.sample(1).channels.lane).toBe(1);
    offB();
    expect(b.listeners()).toBe(0);
    b.emit({ id: 'jump', kind: 'rep', t: 2 });
    const f = hub.sample(3);
    expect(f.events).toEqual([]);
    expect(f.channels.lane ?? 0).toBe(0);
  });
});

describe('InputHub allow() (code-audit rule 7)', () => {
  it("allow(['pose']) rejects every other source: keyboard, touch, trace and test", () => {
    const { hub, doc, el, clock } = setup();
    const pose = fakeEngine(), trace = fakeEngine();
    hub.connectPose(pose);
    hub.connectPose(trace, 'trace');
    hub.bindKeyboard(RUNNER_KEYS, doc);
    hub.bindTouch(el as unknown as HTMLElement, RUNNER_TOUCH);
    hub.allow(['pose']);
    expect(hub.allowed('pose')).toBe(true);
    expect(hub.allowed('keyboard')).toBe(false);
    key(doc, 'keydown', 'ArrowUp');
    key(doc, 'keydown', 'ArrowLeft');
    swipe(el, 0, -80, clock);
    trace.set({ lane: 1 });
    trace.emit({ id: 'jump', kind: 'rep', t: 1 });
    expect(hub.inject('test', { channels: { lane: 1 }, events: [{ id: 'jump', kind: 'rep', t: 1 }] })).toBe(false);
    pose.set({ crouch: 0.3 });
    const f = hub.sample(clock.t);
    expect(f.events).toEqual([]);
    expect(f.channels).toEqual({ crouch: 0.3 });
    expect(f.source).toBe('pose');
  });

  it('narrowing allow() drops queued events and channels of sources no longer allowed', () => {
    const { hub, doc } = setup();
    hub.bindKeyboard(RUNNER_KEYS, doc);
    key(doc, 'keydown', 'ArrowUp');
    key(doc, 'keydown', 'ArrowLeft');
    hub.allow(['pose']);
    const f = hub.sample(1);
    expect(f.events).toEqual([]);
    expect(f.channels.lane ?? 0).toBe(0);
    hub.allow(['pose', 'keyboard']);
    expect(hub.sample(2).channels.lane ?? 0).toBe(0);   // the old value is gone; a new press is needed
    key(doc, 'keydown', 'ArrowLeft');
    expect(hub.sample(3).channels.lane).toBe(-1);
  });
});

describe('InputHub local2 (two players, one camera)', () => {
  it('one stream per player: events stamped with the player, the top level mirrors Player 1', () => {
    const { hub } = setup(2);
    const p1 = fakeEngine(), p2 = fakeEngine();
    hub.connectPose(p1, 'pose', 1);
    hub.connectPose(p2, 'pose', 2);
    p1.set({ crouch: 0.2 });
    p2.set({ crouch: 0.8 });
    p2.emit({ id: 'squat', kind: 'rep', t: 4 });
    p1.emit({ id: 'jump', kind: 'rep', t: 5 });
    hub.setTracking({ ok: false, code: 'player_missing' }, 2);
    const f = hub.sample(6);
    expect(f.players?.[1].channels).toEqual({ crouch: 0.2 });
    expect(f.players?.[2].channels).toEqual({ crouch: 0.8 });
    expect(f.players?.[1].events).toEqual([{ id: 'jump', kind: 'rep', t: 5, source: 'pose', player: 1 }]);
    expect(f.players?.[2].events).toEqual([{ id: 'squat', kind: 'rep', t: 4, source: 'pose', player: 2 }]);
    expect(f.players?.[2].tracking).toEqual({ ok: false, code: 'player_missing' });
    expect(f.tracking).toEqual({ ok: true });
    expect(f.channels).toBe(f.players?.[1].channels);
    expect(f.events).toBe(f.players?.[1].events);
  });

  it("keyboard bindings can target Player 2 (two keyboard players for testing without a camera)", () => {
    const { hub, doc } = setup(2);
    hub.bindKeyboard({ w: { event: 'jump', player: 1 }, ArrowUp: { event: 'jump', player: 2 }, ArrowLeft: { channel: 'lane', value: -1, player: 2 } }, doc);
    key(doc, 'keydown', 'ArrowUp');
    key(doc, 'keydown', 'ArrowLeft');
    const f = hub.sample(1);
    expect(f.players?.[1].events).toEqual([]);
    expect(f.players?.[2].events.map((e) => `${e.id}:${e.player}`)).toEqual(['jump:2']);
    expect(f.players?.[2].channels.lane).toBe(-1);
    expect(f.players?.[1].channels.lane ?? 0).toBe(0);
  });

  it('one-player hubs never add players and ignore a player 2 target', () => {
    const { hub } = setup(1);
    hub.inject('test', { events: [{ id: 'jump', kind: 'rep', t: 1 }] }, 2);
    const f = hub.sample(2);
    expect(f.players).toBeUndefined();
    expect(f.events).toEqual([{ id: 'jump', kind: 'rep', t: 1, source: 'test' }]);
  });
});

describe('InputHub reset and dispose', () => {
  it('reset() clears channels, queued events and held keys', () => {
    const { hub, doc } = setup();
    hub.bindKeyboard(RUNNER_KEYS, doc);
    key(doc, 'keydown', 'ArrowLeft');
    key(doc, 'keydown', 'ArrowUp');
    hub.reset();
    const f = hub.sample(1);
    expect(f.events).toEqual([]);
    expect(f.channels.lane ?? 0).toBe(0);
    key(doc, 'keyup', 'ArrowLeft');   // releasing a forgotten key changes nothing
    expect(hub.sample(2).channels.lane ?? 0).toBe(0);
  });

  it('dispose() removes every listener and disconnects engines', () => {
    const { hub, doc, el, clock, win } = setup();
    const m = fakeEngine();
    hub.connectPose(m);
    hub.bindKeyboard(RUNNER_KEYS, doc);
    hub.bindTouch(el as unknown as HTMLElement, RUNNER_TOUCH);
    hub.dispose();
    expect(m.listeners()).toBe(0);
    key(doc, 'keydown', 'ArrowUp');
    swipe(el, 0, -80, clock);
    win.dispatchEvent(new Event('blur'));
    expect(hub.inject('test', { events: [{ id: 'jump', kind: 'rep', t: 1 }] })).toBe(false);
    expect(hub.sample(clock.t).events).toEqual([]);
    expect(hub.bindKeyboard(RUNNER_KEYS, doc)).toBeTypeOf('function');
  });
});
