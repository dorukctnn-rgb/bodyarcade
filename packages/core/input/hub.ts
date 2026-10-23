// InputHub: one input bus for every source (replaces site/game/input.js; code-audit 11.4).
//
// - Sources: 'pose' and 'trace' (a MovementEngine), 'keyboard', 'touch', 'test' (inject()). allow() restricts them:
//   ranked and live play allow ['pose'] only, so a keyboard jump can no longer leak into a camera run (rule 7).
// - Channels: per name, the first non-zero value in the order test, pose, trace, keyboard, touch; 0 when none.
//   That keeps today's rule "keys only nudge when pose is not driving", and a held key over a swiped lane.
// - Events are queued with their source (and player) and drained by sample(), once per fixed step: each event appears
//   in exactly one frame.
// - Mode 'local2' (players: 2): every source writes into one player's stream; sample() returns both under `players`,
//   and the top level mirrors Player 1.
// - No timers: touch holds expire against the time given to sample(), so a run replays identically.
import type {
  InputEvent, InputFrame, InputHub, InputSourceId, KeyMap, MovementEngine, MovementEvent, PlayerInput, PlayerSlot, SwipeName, TouchMap,
  Tracking, Unsubscribe,
} from '../types/index.ts';

/** Channel priority: the first non-zero value wins. */
export const SOURCE_ORDER: readonly InputSourceId[] = ['test', 'pose', 'trace', 'keyboard', 'touch'];

/** Today's swipe rules (input.js): a swipe is 24 px or more; a tap is shorter than that and quicker than 350 ms. */
export const SWIPE = { minPx: 24, tapMaxMs: 350 } as const;

export interface InputHubOptions {
  /** 2 for mode 'local2' (two players, one camera). */
  players?: 1 | 2;
  /** Clock for keyboard and touch events (default performance.now). */
  now?: () => number;
  /** Where blur releases held keys (default globalThis when it is an EventTarget). */
  window?: EventTarget;
}

interface Hold { value: number; until: number }

interface Stream {
  tracking: Tracking;
  events: InputEvent[];
  /** Values set by inject(), keyboard and touch, per source. Pose and trace are read from their engine. */
  set: Map<InputSourceId, Map<string, number>>;
  /** Touch holds (value for holdMs). */
  holds: Map<string, Hold>;
  engines: Map<'pose' | 'trace', MovementEngine>;
}

const OK: Tracking = { ok: true };

const newStream = (): Stream => ({ tracking: OK, events: [], set: new Map(), holds: new Map(), engines: new Map() });

/** Keys typed into form fields never steer the game. */
function inFormField(target: EventTarget | null): boolean {
  const el = target as (Partial<HTMLElement> & { tagName?: string }) | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

export function createInputHub(o: InputHubOptions = {}): InputHub {
  const now = o.now ?? (() => performance.now());
  const two = o.players === 2;
  const streams: Record<PlayerSlot, Stream> = { 1: newStream(), 2: newStream() };
  let allowedSet = new Set<InputSourceId>(SOURCE_ORDER);
  const activity = new Map<InputSourceId, number>();
  const engineSeen = new Map<MovementEngine, number | null>();
  const cleanups = new Set<() => void>();
  /** Forget held keys and touch starts (reset()). */
  const forgets = new Set<() => void>();
  /** One engine per (player, source): connecting another one replaces it. */
  const poseLinks = new Map<string, () => void>();
  let disposed = false;

  const streamOf = (p: PlayerSlot | undefined): Stream => streams[two && p === 2 ? 2 : 1];
  const touch = (src: InputSourceId, t = now()): void => { activity.set(src, t); };

  const setChannel = (s: Stream, src: InputSourceId, name: string, v: number): void => {
    let m = s.set.get(src);
    if (!m) { m = new Map(); s.set.set(src, m); }
    m.set(name, v);
  };

  const queue = (s: Stream, src: InputSourceId, e: MovementEvent, player: PlayerSlot | undefined): void => {
    const ev: InputEvent = { ...e, source: src };
    if (two) ev.player = player === 2 ? 2 : 1;
    s.events.push(ev);
  };

  function merged(s: Stream, t: number): Record<string, number> {
    const out: Record<string, number> = {};
    const offer = (name: string, v: number): void => {
      if (!(name in out)) out[name] = 0;
      if (out[name] === 0 && v !== 0 && Number.isFinite(v)) out[name] = v;
    };
    for (const src of SOURCE_ORDER) {
      if (!allowedSet.has(src)) continue;
      if (src === 'pose' || src === 'trace') {
        const m = s.engines.get(src);
        if (m) for (const [k, v] of Object.entries(m.channels())) offer(k, v);
        continue;
      }
      if (src === 'touch') {
        for (const [k, h] of s.holds) offer(k, t < h.until ? h.value : 0);
      }
      const m = s.set.get(src);
      if (m) for (const [k, v] of m) offer(k, v);
    }
    return out;
  }

  /** Engines whose last frame changed since the previous sample count as activity of their source. */
  function engineActivity(t: number): void {
    for (const s of [streams[1], streams[2]]) {
      for (const [src, m] of s.engines) {
        const lt = m.last()?.t ?? null;
        if (engineSeen.get(m) !== lt) { engineSeen.set(m, lt); if (lt !== null) touch(src, t); }
      }
    }
  }

  function latestSource(): InputSourceId {
    let best: InputSourceId | null = null;
    let bestT = -Infinity;
    for (const src of SOURCE_ORDER) {
      if (!allowedSet.has(src)) continue;
      const t = activity.get(src);
      if (t !== undefined && t > bestT) { bestT = t; best = src; }
    }
    if (best) return best;
    if (allowedSet.has('pose')) return 'pose';
    return SOURCE_ORDER.find((s) => allowedSet.has(s)) ?? 'pose';
  }

  const hub: InputHub = {
    allow(ids: InputSourceId[]): void {
      allowedSet = new Set(ids);
      for (const s of [streams[1], streams[2]]) {
        s.events = s.events.filter((e) => allowedSet.has(e.source));
        for (const src of [...s.set.keys()]) if (!allowedSet.has(src)) s.set.delete(src);
        if (!allowedSet.has('touch')) s.holds.clear();
      }
    },

    allowed(id: InputSourceId): boolean {
      return allowedSet.has(id);
    },

    bindKeyboard(map: KeyMap, target?: EventTarget): Unsubscribe {
      if (disposed) return () => {};
      const tgt = target ?? (globalThis as unknown as EventTarget);
      const win = o.window ?? (typeof (globalThis as { addEventListener?: unknown }).addEventListener === 'function' ? (globalThis as unknown as EventTarget) : null);
      const lookup = (key: string): KeyMap[string] | undefined => map[key] ?? (key.length === 1 ? map[key.toLowerCase()] ?? map[key.toUpperCase()] : undefined);
      /** Held channel keys in press order: the most recent held key of a channel sets it. */
      const held: { key: string; channel: string; value: number; player: PlayerSlot | undefined }[] = [];

      const apply = (channel: string, player: PlayerSlot | undefined): void => {
        const s = streamOf(player);
        const top = [...held].reverse().find((h) => h.channel === channel && streamOf(h.player) === s);
        setChannel(s, 'keyboard', channel, top ? top.value : 0);
      };

      const onDown = (ev: Event): void => {
        const e = ev as KeyboardEvent;
        if (e.metaKey || e.ctrlKey || e.altKey || inFormField(e.target)) return;
        const b = lookup(e.key);
        if (!b) return;
        e.preventDefault?.();
        if (!allowedSet.has('keyboard')) return;
        const t = now();
        if (b.channel !== undefined) {
          const i = held.findIndex((h) => h.key === e.key.toLowerCase());
          if (i >= 0) held.splice(i, 1);
          held.push({ key: e.key.toLowerCase(), channel: b.channel, value: b.value ?? 1, player: b.player });
          apply(b.channel, b.player);
          touch('keyboard', t);
        }
        if (b.event !== undefined && !e.repeat) {
          queue(streamOf(b.player), 'keyboard', { id: b.event, kind: 'rep', t }, b.player);
          touch('keyboard', t);
        }
      };

      const onUp = (ev: Event): void => {
        const e = ev as KeyboardEvent;
        const i = held.findIndex((h) => h.key === e.key.toLowerCase());
        if (i < 0) return;
        const [h] = held.splice(i, 1);
        if (h && allowedSet.has('keyboard')) { apply(h.channel, h.player); touch('keyboard'); }
      };

      const releaseAll = (): void => {
        const was = held.splice(0, held.length);
        for (const h of was) if (allowedSet.has('keyboard')) apply(h.channel, h.player);
      };

      const forget = (): void => { held.length = 0; };

      tgt.addEventListener('keydown', onDown);
      tgt.addEventListener('keyup', onUp);
      win?.addEventListener('blur', releaseAll);
      forgets.add(forget);
      const off = (): void => {
        tgt.removeEventListener('keydown', onDown);
        tgt.removeEventListener('keyup', onUp);
        win?.removeEventListener('blur', releaseAll);
        releaseAll();
        forgets.delete(forget);
        cleanups.delete(off);
      };
      cleanups.add(off);
      return off;
    },

    bindTouch(el: HTMLElement, map: TouchMap): Unsubscribe {
      if (disposed) return () => {};
      let start: { id: number; x: number; y: number; t: number } | null = null;

      const onDown = (ev: Event): void => {
        const e = ev as PointerEvent;
        start = { id: e.pointerId, x: e.clientX, y: e.clientY, t: now() };
      };
      const onUp = (ev: Event): void => {
        const e = ev as PointerEvent;
        if (!start || e.pointerId !== start.id) return;
        const dx = e.clientX - start.x, dy = e.clientY - start.y;
        const t = now();
        const dur = t - start.t;
        start = null;
        let name: SwipeName | null;
        if (Math.hypot(dx, dy) < SWIPE.minPx) name = dur <= SWIPE.tapMaxMs ? 'tap' : null;
        else if (Math.abs(dx) > Math.abs(dy)) name = dx > 0 ? 'right' : 'left';
        else name = dy < 0 ? 'up' : 'down';
        if (!name) return;
        const b = map[name];
        if (!b || !allowedSet.has('touch')) return;
        const s = streams[1];
        if (b.channel !== undefined) {
          if (b.step !== undefined) {
            const cur = s.set.get('touch')?.get(b.channel) ?? 0;
            const lo = b.min ?? -1, hi = b.max ?? 1;
            setChannel(s, 'touch', b.channel, Math.max(lo, Math.min(hi, cur + b.step)));
          } else if (b.holdMs !== undefined) {
            s.holds.set(b.channel, { value: b.value ?? 1, until: t + b.holdMs });
          } else {
            setChannel(s, 'touch', b.channel, b.value ?? 1);
          }
        }
        if (b.event !== undefined) queue(s, 'touch', { id: b.event, kind: 'rep', t }, 1);
        touch('touch', t);
      };
      const onCancel = (): void => { start = null; };

      el.addEventListener('pointerdown', onDown, { passive: true });
      el.addEventListener('pointerup', onUp, { passive: true });
      el.addEventListener('pointercancel', onCancel, { passive: true });
      forgets.add(onCancel);
      const off = (): void => {
        el.removeEventListener('pointerdown', onDown);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('pointercancel', onCancel);
        streams[1].set.delete('touch');
        streams[1].holds.clear();
        forgets.delete(onCancel);
        cleanups.delete(off);
      };
      cleanups.add(off);
      return off;
    },

    connectPose(m: MovementEngine, source: 'pose' | 'trace' = 'pose', player?: PlayerSlot): Unsubscribe {
      if (disposed) return () => {};
      const s = streamOf(player);
      const link = `${s === streams[2] ? 2 : 1}:${source}`;
      poseLinks.get(link)?.();
      s.engines.set(source, m);
      engineSeen.set(m, m.last()?.t ?? null);
      const offEvents = m.onEvent((e) => {
        if (!allowedSet.has(source)) return;
        queue(s, source, e, player);
        touch(source, e.t);
      });
      const off = (): void => {
        offEvents();
        if (s.engines.get(source) === m) s.engines.delete(source);
        engineSeen.delete(m);
        if (poseLinks.get(link) === off) poseLinks.delete(link);
        cleanups.delete(off);
      };
      poseLinks.set(link, off);
      cleanups.add(off);
      return off;
    },

    inject(source: InputSourceId, p: { channels?: Record<string, number>; events?: MovementEvent[] }, player?: PlayerSlot): boolean {
      if (disposed || !allowedSet.has(source)) return false;
      const s = streamOf(player);
      for (const [k, v] of Object.entries(p.channels ?? {})) setChannel(s, source, k, v);
      for (const e of p.events ?? []) queue(s, source, e, player);
      touch(source);
      return true;
    },

    setTracking(t: Tracking, player?: PlayerSlot): void {
      streamOf(player).tracking = t.ok && t.code === undefined ? OK : { ...t };
    },

    sample(t: number): InputFrame {
      engineActivity(t);
      const take = (s: Stream): PlayerInput => {
        const events = s.events;
        s.events = [];
        // An expired hold reads 0 from now on (the channel stays known, like a released key).
        for (const [k, h] of s.holds) if (t >= h.until) { s.holds.delete(k); setChannel(s, 'touch', k, 0); }
        return { tracking: s.tracking, channels: Object.freeze(merged(s, t)), events };
      };
      const p1 = take(streams[1]);
      const frame: InputFrame = { t, source: latestSource(), tracking: p1.tracking, channels: p1.channels, events: p1.events };
      if (two) frame.players = { 1: p1, 2: take(streams[2]) };
      return frame;
    },

    reset(): void {
      for (const forget of forgets) forget();
      for (const s of [streams[1], streams[2]]) {
        s.events = [];
        s.set.clear();
        s.holds.clear();
      }
    },

    dispose(): void {
      if (disposed) return;
      for (const off of [...cleanups]) off();
      hub.reset();
      disposed = true;
    },
  };
  return hub;
}
