// What a race in a room draws on the stage (live-stage.ts), with a small fake document and a fake race: a tile for each of the others
// (the skeleton from their frames, or their camera while it flows; their name and points; the line and the retry button of a camera
// that did not connect; who left), the line of the stage and the Room's 3-2-1 in big numbers, the bubbles of what the others say,
// the reactions that go to the room, the language of the page, the way everything gives way to a panel of the round, and that the
// layer is gone without a trace when the stage is left. The race behind it, on the real Room, is live-race.test.ts; in two browsers
// through the real shell, tests/e2e/social-ui-race.spec.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Landmark } from '../../../core/types/index.ts';
import type { ReactionId, SeatId } from '../../../core/types/net.ts';
import { createI18n, type I18n } from '../../../core/ui/i18n/index.ts';
import { standInBody, type LiveMessage, type LiveSource, type LiveTile, type LiveView } from './live-race.ts';
import { clearOf, mountLiveStage } from './live-stage.ts';
import type { RaceStageMount } from './race.ts';

// ---- a fake document: just what the layer uses ----------------------------------------------------------------------------

type Listener = (e: { target: El; preventDefault(): void }) => void;

/** `data-lr-react` -> `lrReact`; null for an attribute that is not a data-* one. */
const dataKey = (n: string): string | null => (n.startsWith('data-') ? n.slice(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()) : null);

class El {
  readonly tagName: string;
  children: El[] = [];
  parent: El | null = null;
  className = '';
  hidden = false;
  type = '';
  width = 0;
  height = 0;
  muted = false;
  autoplay = false;
  playsInline = false;
  srcObject: unknown = null;
  plays = 0;
  readonly dataset: Record<string, string> = {};
  readonly attrs = new Map<string, string>();
  readonly listeners = new Map<string, Set<Listener>>();
  /** What was drawn on a canvas since it was last read: the names of the calls. */
  drawn: string[] = [];
  private text = '';
  private markup = '';
  constructor(tag: string) { this.tagName = tag.toUpperCase(); }

  get textContent(): string { return this.children.length > 0 ? this.children.map((c) => c.textContent).join('') : this.text; }
  set textContent(v: string | null) { this.children = []; this.text = v ?? ''; this.markup = ''; }
  get innerHTML(): string { return this.markup; }
  set innerHTML(v: string) { this.children = []; this.markup = v; this.text = ''; }
  get childElementCount(): number { return this.children.length; }
  readonly classList = {
    toggle: (c: string, on?: boolean): boolean => {
      const set = new Set(this.className.split(' ').filter(Boolean));
      const want = on ?? !set.has(c);
      if (want) set.add(c); else set.delete(c);
      this.className = [...set].join(' ');
      return want;
    },
    contains: (c: string): boolean => this.className.split(' ').includes(c),
  };
  // data-* attributes are the dataset, as in a real document
  setAttribute(n: string, v: string): void { const d = dataKey(n); if (d) this.dataset[d] = String(v); else this.attrs.set(n, String(v)); }
  getAttribute(n: string): string | null { const d = dataKey(n); return d ? (this.dataset[d] ?? null) : (this.attrs.get(n) ?? null); }
  removeAttribute(n: string): void { const d = dataKey(n); if (d) delete this.dataset[d]; else this.attrs.delete(n); }
  hasAttribute(n: string): boolean { const d = dataKey(n); return d ? this.dataset[d] !== undefined : this.attrs.has(n); }
  append(...els: El[]): void { for (const e of els) { e.parent?.children.splice(e.parent.children.indexOf(e), 1); e.parent = this; this.children.push(e); } }
  replaceChildren(...els: El[]): void { for (const c of this.children) c.parent = null; this.children = []; this.text = ''; this.markup = ''; this.append(...els); }
  remove(): void { if (this.parent) { this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; } }
  addEventListener(t: string, cb: Listener): void { const s = this.listeners.get(t) ?? new Set(); s.add(cb); this.listeners.set(t, s); }
  removeEventListener(t: string, cb: Listener): void { this.listeners.get(t)?.delete(cb); }
  /** `[data-lr-react], [data-lr-retry]`: the attribute selectors of data-* names the layer asks for. */
  closest(sel: string): El | null {
    const keys = sel.split(',').map((s) => s.trim().replace(/^\[data-|\]$/g, '').replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()));
    for (let n: El | null = this; n; n = n.parent) if (keys.some((k) => n?.dataset[k] !== undefined)) return n;
    return null;
  }
  getContext(): unknown {
    // a 2D context that keeps the names of the calls and the values set on it
    const store: Record<string, unknown> = {};
    return new Proxy(store, {
      get: (t, k) => (typeof k === 'string' && k in t ? t[k] : (..._args: unknown[]) => { this.drawn.push(String(k)); }),
      set: (t, k, v) => { t[k as string] = v; return true; },
    });
  }
  play(): Promise<void> { this.plays += 1; return Promise.resolve(); }
  /** Every element under this one (not itself) that passes the test. */
  all(test: (e: El) => boolean): El[] { return this.children.flatMap((c) => [...(test(c) ? [c] : []), ...c.all(test)]); }
  one(test: (e: El) => boolean): El | null { return this.all(test)[0] ?? null; }
  click(): void {
    let stopped = false;
    for (let n: El | null = this; n && !stopped; n = n.parent) {
      for (const cb of n.listeners.get('click') ?? []) cb({ target: this, preventDefault() { stopped = true; } });
    }
  }
}

const doc = { createElement: (t: string) => new El(t) };
const byClass = (c: string) => (e: El): boolean => e.classList.contains(c);

// ---- a fake race ----------------------------------------------------------------------------------------------------------

function fakeRace() {
  let v: LiveView = { phase: 'wait', count: 0, waiting: [], alone: false, held: [], online: true, match: null, seed: null, tiles: [] };
  const msgs = new Set<(m: LiveMessage) => void>();
  const reacted: ReactionId[] = [];
  const retried: SeatId[] = [];
  let views = 0;
  const src = {
    kind: 'live', room: 'K7P2QX', label: null,
    view: () => { views += 1; return v; },
    onMessage: (cb: (m: LiveMessage) => void) => { msgs.add(cb); return () => { msgs.delete(cb); }; },
    react: (id: ReactionId) => { reacted.push(id); },
    retryVideo: (seat: SeatId) => { retried.push(seat); },
  } as unknown as LiveSource;
  return {
    src, reacted, retried,
    views: () => views,
    listeners: () => msgs.size,
    set(over: Partial<LiveView>) { v = { ...v, ...over }; },
    say(m: LiveMessage) { for (const cb of [...msgs]) cb(m); },
  };
}

const tile = (over: Partial<LiveTile> & Pick<LiveTile, 'seat' | 'name'>): LiveTile => ({ online: true, show: 'skeleton', note: null, retry: false, score: 0, pose: null, stream: null, out: false, ...over });

function world(lang: 'en' | 'tr' = 'en') {
  const stage = new El('div');
  const overlay = new El('div');
  stage.append(overlay);
  let i18n: I18n = createI18n(lang);
  const said: string[] = [];
  const race = fakeRace();
  const m: RaceStageMount = {
    document: doc as unknown as Document, stage: stage as unknown as HTMLElement, i18n: () => i18n, announce: (t) => { said.push(t); },
    busy: () => overlay.childElementCount > 0,
  };
  const off = mountLiveStage(m, race.src, { everyMs: 100 });
  const layer = stage.one((e) => e.dataset['liveRace'] !== undefined) as El;
  const part = (key: string): El => layer.one((e) => e.dataset[key] !== undefined) as El;
  const tileOf = (seat: string): El | null => layer.one((e) => e.tagName === 'LI' && e.dataset['seat'] === seat);
  return {
    stage, overlay, layer, race, said, off,
    status: () => part('lrStatus'), count: () => part('lrCount'), tiles: () => part('lrTiles'), reacts: () => part('lrReacts'),
    tileOf,
    setLang(l: 'en' | 'tr') { i18n = createI18n(l); },
    tick(ms = 100) { vi.advanceTimersByTime(ms); },
  };
}

const pose = (): Landmark[] => standInBody(1234);

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('the stage of a race in a room', () => {
  it('draws a tile for each of the others: the name, the points, the skeleton from their frames, and nothing for the player', () => {
    const w = world();
    expect(w.layer.dataset['room']).toBe('K7P2QX');
    w.race.set({ waiting: ['Bo'], tiles: [tile({ seat: 's2', name: 'Bo', score: 1250, pose: pose() }), tile({ seat: 's3', name: 'Cem' })] });
    w.tick();
    const bo = w.tileOf('s2') as El;
    expect(bo.one(byClass('lr-name'))?.textContent).toBe('Bo');
    expect(bo.one(byClass('lr-score'))?.textContent).toBe('1,250');
    expect(bo.dataset['score']).toBe('1250');
    expect(bo.dataset['skeleton']).toBe('1');
    const canvas = bo.one((e) => e.tagName === 'CANVAS') as El;
    expect(canvas.hidden).toBe(false);
    expect(canvas.drawn).toContain('clearRect');
    expect(canvas.drawn.filter((x) => x === 'lineTo' || x === 'arc' || x === 'stroke').length).toBeGreaterThan(0);
    // no frames from Cem yet: an empty picture, not an old one
    const cem = w.tileOf('s3') as El;
    expect(cem.dataset['skeleton']).toBe('0');
    expect((cem.one((e) => e.tagName === 'CANVAS') as El).drawn).toEqual(['clearRect']);
    expect(w.tiles().children).toHaveLength(2);
    expect(w.tiles().hidden).toBe(false);
    expect(w.tiles().getAttribute('aria-label')).toBe('The others in the race');
    w.off();
  });

  it('says who the start waits for, counts the Room\'s 3-2-1 in big numbers, and is quiet while the race runs', () => {
    const w = world();
    w.race.set({ waiting: ['Bo'], tiles: [tile({ seat: 's2', name: 'Bo' })] });
    w.tick();
    expect(w.layer.dataset['phase']).toBe('wait');
    expect(w.status().textContent).toBe('Waiting for Bo to get ready');
    expect(w.status().hidden).toBe(false);
    expect(w.count().hidden).toBe(true);
    // the reactions are there before the race (nobody taps a screen in the middle of a squat)
    expect(w.reacts().hidden).toBe(false);
    expect(w.reacts().children.length).toBeGreaterThan(0);

    w.race.set({ phase: 'count', count: 2, waiting: [], match: 'm7', seed: 991 });
    w.tick();
    expect(w.layer.dataset['phase']).toBe('count');
    expect(w.layer.dataset['match']).toBe('m7');
    expect(w.layer.dataset['seed']).toBe('991');
    expect(w.count().textContent).toBe('2');
    expect(w.count().hidden).toBe(false);
    expect(w.count().getAttribute('aria-hidden')).toBe('true');
    expect(w.status().textContent).toBe('The race starts in 2');

    w.race.set({ phase: 'run', count: 0 });
    w.tick();
    expect(w.status().hidden).toBe(true);
    expect(w.count().hidden).toBe(true);
    expect(w.reacts().hidden).toBe(true);
    expect(w.tiles().hidden).toBe(false);

    w.race.set({ phase: 'hold', held: [{ name: 'Bo', reason: 'framing' }] });
    w.tick();
    expect(w.status().textContent).toBe('Bo stepped out of the frame');
    w.race.set({ online: false });
    w.tick();
    expect(w.layer.dataset['online']).toBe('0');
    expect(w.status().textContent).toBe('Connection lost. Reconnecting.');
    w.off();
  });

  it('gives way to a panel of the round: nothing of it shows while the calibration, a pause or an error is open', () => {
    const w = world();
    w.race.set({ waiting: ['Bo'], tiles: [tile({ seat: 's2', name: 'Bo' })] });
    w.overlay.append(new El('div'));
    w.tick();
    expect(w.layer.classList.contains('is-busy')).toBe(true);
    expect([w.status().hidden, w.count().hidden, w.tiles().hidden, w.reacts().hidden]).toEqual([true, true, true, true]);
    w.overlay.replaceChildren();
    w.tick();
    expect(w.layer.classList.contains('is-busy')).toBe(false);
    expect([w.status().hidden, w.tiles().hidden, w.reacts().hidden]).toEqual([false, false, false]);
    // alone in the room: nobody to send a reaction to
    w.race.set({ alone: true, waiting: [], tiles: [] });
    w.tick();
    expect(w.reacts().hidden).toBe(true);
    expect(w.tiles().hidden).toBe(true);
    expect(w.status().textContent).toBe('Waiting for a second player. Share the link of the room.');
    w.off();
  });

  it('shows a friend\'s camera only while it flows; a camera that did not connect says so and offers to try again', () => {
    const w = world();
    const stream = { id: 'cam-bo' } as unknown as MediaStream;
    w.race.set({ tiles: [tile({ seat: 's2', name: 'Bo', show: 'video', stream, pose: pose() })] });
    w.tick();
    const bo = w.tileOf('s2') as El;
    const video = bo.one((e) => e.tagName === 'VIDEO') as El;
    const canvas = bo.one((e) => e.tagName === 'CANVAS') as El;
    expect(bo.dataset['show']).toBe('video');
    expect(video.srcObject).toBe(stream);
    expect(video.muted).toBe(true);
    expect(video.hidden).toBe(false);
    expect(canvas.hidden).toBe(true);
    expect(video.plays).toBe(1);
    w.tick();
    expect(video.plays).toBe(1);                                    // the same picture is not started again on every frame

    // the link failed: back to the skeleton, the line under the tile and the retry button
    w.race.set({ tiles: [tile({ seat: 's2', name: 'Bo', note: 'room.video.failed', retry: true, pose: pose() })] });
    w.tick();
    expect(video.srcObject).toBe(null);
    expect(video.hidden).toBe(true);
    expect(canvas.hidden).toBe(false);
    expect(bo.dataset['skeleton']).toBe('1');
    const note = bo.one(byClass('lr-note')) as El;
    expect(note.hidden).toBe(false);
    expect(note.textContent).toBe(createI18n('en').t('room.video.failed'));
    const retry = bo.one(byClass('lr-retry')) as El;
    expect(retry.hidden).toBe(false);
    expect(retry.textContent).toBe(createI18n('en').t('common.retry'));
    retry.click();
    expect(w.race.retried).toEqual(['s2']);
    expect(w.said).toContain(createI18n('en').t('room.video.connecting'));
    w.off();
  });

  it('puts what the others say on their tile for a moment and reads it out; a reaction is a picture with a name', () => {
    const w = world();
    w.race.set({ tiles: [tile({ seat: 's2', name: 'Bo' })] });
    w.tick();
    const bubble = (w.tileOf('s2') as El).one(byClass('lr-bubble')) as El;
    expect(bubble.hidden).toBe(true);
    w.race.say({ seat: 's2', name: 'Bo', preset: 'hi' });
    expect(bubble.hidden).toBe(false);
    expect(bubble.textContent).toBe('Hello');
    expect(bubble.dataset['kind']).toBe('say');
    expect(w.said).toContain('Bo: Hello');
    w.tick(3000);
    expect(bubble.hidden).toBe(false);
    w.tick(300);
    expect(bubble.hidden).toBe(true);

    w.race.say({ seat: 's2', name: 'Bo', react: 'clap' });
    expect(bubble.hidden).toBe(false);
    expect(bubble.dataset['kind']).toBe('react');
    expect(bubble.getAttribute('role')).toBe('img');
    expect(bubble.getAttribute('aria-label')).toBe(createI18n('en').tx('room.react.clap'));
    expect(bubble.innerHTML).toContain('<svg');
    expect(w.said.filter((x) => x.startsWith('Bo:'))).toHaveLength(1);    // a reaction is seen, not read out
    // a typed line (where the room allows it) is text, never markup
    w.race.say({ seat: 's2', name: 'Bo', text: '<b>go</b>' });
    expect(bubble.innerHTML).toBe('');
    expect(bubble.textContent).toBe('<b>go</b>');
    expect(bubble.getAttribute('role')).toBe(null);
    // somebody without a tile (not on this stage) changes nothing
    w.race.say({ seat: 's9', name: 'Zed', preset: 'gg' });
    expect(w.said.some((x) => x.startsWith('Zed'))).toBe(false);
    w.off();
  });

  it('sends a reaction to the room from its row, with words in the page\'s language', () => {
    const w = world();
    w.race.set({ tiles: [tile({ seat: 's2', name: 'Bo' })] });
    w.tick();
    const clap = w.reacts().one((e) => e.dataset['lrReact'] === 'clap') as El;
    expect(clap.tagName).toBe('BUTTON');
    expect(clap.getAttribute('aria-label')).toBe(createI18n('en').t('room.react.send', { name: createI18n('en').tx('room.react.clap') }));
    clap.click();
    expect(w.race.reacted).toEqual(['clap']);
    // a click beside the buttons does nothing
    w.status().click();
    expect(w.race.reacted).toEqual(['clap']);
    // the page's language changes: the words follow at the next frame
    w.setLang('tr');
    w.race.set({ waiting: ['Bo'] });
    w.tick();
    const tr = createI18n('tr');
    expect((w.reacts().one((e) => e.dataset['lrReact'] === 'clap') as El).getAttribute('aria-label')).toBe(tr.t('room.react.send', { name: tr.tx('room.react.clap') }));
    expect(w.tiles().getAttribute('aria-label')).not.toBe('The others in the race');
    expect(w.status().textContent).not.toBe('Waiting for Bo to get ready');
    w.off();
  });

  it('marks a friend who left the race, and takes away the tile of one who left the room', () => {
    const w = world();
    w.race.set({ tiles: [tile({ seat: 's2', name: 'Bo', score: 40 }), tile({ seat: 's3', name: 'Cem', score: 30 })] });
    w.tick();
    w.race.set({ tiles: [tile({ seat: 's2', name: 'Bo', score: 40, out: true }), tile({ seat: 's3', name: 'Cem', score: 30, online: false })] });
    w.tick();
    const bo = w.tileOf('s2') as El;
    expect(bo.classList.contains('is-out')).toBe(true);
    expect(bo.one(byClass('lr-note'))?.textContent).toBe('Bo left the race');
    expect((w.tileOf('s3') as El).classList.contains('is-out')).toBe(true);
    w.race.set({ tiles: [tile({ seat: 's2', name: 'Bo', score: 40, out: true })] });
    w.tick();
    expect(w.tileOf('s3')).toBe(null);
    expect(w.tiles().children).toHaveLength(1);
    w.off();
  });

  it('is gone without a trace when the stage is left: no layer, no timer, no listener, no picture held', () => {
    const w = world();
    const stream = { id: 'cam-bo' } as unknown as MediaStream;
    w.race.set({ tiles: [tile({ seat: 's2', name: 'Bo', show: 'video', stream })] });
    w.tick();
    const video = (w.tileOf('s2') as El).one((e) => e.tagName === 'VIDEO') as El;
    w.race.say({ seat: 's2', name: 'Bo', preset: 'hi' });
    expect(w.race.listeners()).toBe(1);
    w.off();
    expect(w.stage.children).toEqual([w.overlay]);
    expect(w.layer.listeners.get('click')?.size ?? 0).toBe(0);
    expect(w.race.listeners()).toBe(0);
    expect(video.srcObject).toBe(null);
    const seen = w.race.views();
    w.tick(5000);
    expect(w.race.views()).toBe(seen);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the line and the reactions clear of the HUD: past the command at the top, above the hint and the self view at the bottom', () => {
    const box = (left: number, top: number, w: number, h: number) => ({ left, top, right: left + w, bottom: top + h });
    // the line under the command it would cover, then under a plate that the first step ran into
    const line = box(500, 84, 280, 40);
    expect(clearOf(line, [box(490, 24, 300, 88)], 'down')).toBe(112 + 8 - 84);
    expect(clearOf(line, [box(490, 24, 300, 88), box(600, 118, 60, 60)], 'down')).toBe(178 + 8 - 84);
    // the reactions above the hint they would cover; a self view beside them is not in the way
    const row = box(485, 726, 310, 56);
    expect(clearOf(row, [box(336, 723, 340, 52), box(997, 582, 260, 196)], 'up')).toBe(723 - 8 - 782);
    // nothing in the way: nothing moves
    expect(clearOf(row, [box(0, 0, 100, 100)], 'up')).toBe(0);
    expect(clearOf(line, [], 'down')).toBe(0);
    // what a browser measures: a DOMRect, whose sides are getters of its prototype (none of them its own)
    class Rect {
      readonly #b: readonly [number, number, number, number];
      constructor(x: number, y: number, w: number, h: number) { this.#b = [x, y, w, h]; }
      get x(): number { return this.#b[0]; }
      get y(): number { return this.#b[1]; }
      get w(): number { return this.#b[2]; }
      get h(): number { return this.#b[3]; }
      get left(): number { return this.x; }
      get top(): number { return this.y; }
      get right(): number { return this.x + this.w; }
      get bottom(): number { return this.y + this.h; }
    }
    expect(Object.keys(new Rect(1, 2, 3, 4))).not.toContain('left');
    expect(clearOf(new Rect(500, 84, 280, 40), [new Rect(490, 24, 300, 88)], 'down')).toBe(112 + 8 - 84);
    expect(clearOf(new Rect(485, 726, 310, 56), [new Rect(336, 723, 340, 52)], 'up')).toBe(723 - 8 - 782);
  });
});
