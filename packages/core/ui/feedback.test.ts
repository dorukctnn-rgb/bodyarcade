// The live region and the toaster, with a fake document and a fake clock.
import { describe, expect, it } from 'vitest';
import { createLiveRegion, LIVE_TEXT_MS, type LiveElement } from './live-region.ts';
import { createToaster, LEAVE_MS, MAX_TOASTS, toastDuration, type ToastElement } from './toast.ts';

class El implements LiveElement, ToastElement {
  className = '';
  textContent: string | null = '';
  attrs: Record<string, string> = {};
  children: El[] = [];
  removed = false;
  setAttribute(n: string, v: string): void { this.attrs[n] = v; }
  appendChild(c: ToastElement): void { this.children.push(c as El); }
  remove(): void { this.removed = true; }
}

function world() {
  const body = new El();
  const doc = { createElement: (_t: 'div') => new El(), body: { appendChild: (e: LiveElement | ToastElement) => { body.children.push(e as El); } } };
  let now = 0;
  const pending = new Map<number, { at: number; cb: () => void }>();
  let next = 1;
  const timers = {
    set: (cb: () => void, ms: number) => { const id = next++; pending.set(id, { at: now + ms, cb }); return id; },
    clear: (h: unknown) => { pending.delete(h as number); },
  };
  const advance = (ms: number): void => {
    const end = now + ms;
    for (;;) {
      const due = [...pending.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      pending.delete(due[0]);
      now = due[1].at;
      due[1].cb();
    }
    now = end;
  };
  return { body, doc, timers, advance };
}

describe('live region', () => {
  it('creates a polite and an assertive region up front, hidden from the eye', () => {
    const w = world();
    createLiveRegion(w.doc, w.timers);
    const [polite, assertive] = w.body.children as [El, El];
    expect(polite.attrs).toMatchObject({ role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
    expect(assertive.attrs).toMatchObject({ role: 'alert', 'aria-live': 'assertive' });
    expect(polite.className).toBe('ba-visually-hidden');
    expect(polite.textContent).toBe('');
  });

  it('speaks politely by default and assertively on request', () => {
    const w = world();
    const live = createLiveRegion(w.doc, w.timers);
    const [polite, assertive] = w.body.children as [El, El];
    live.announce('Paused');
    live.announce('The camera stopped', { assertive: true });
    expect(polite.textContent).toBe('Paused');
    expect(assertive.textContent).toBe('The camera stopped');
  });

  it('ignores empty text and trims', () => {
    const w = world();
    const live = createLiveRegion(w.doc, w.timers);
    const [polite] = w.body.children as [El];
    live.announce('   ');
    expect(polite.textContent).toBe('');
    live.announce('  Resumed ');
    expect(polite.textContent).toBe('Resumed');
  });

  it('says the same sentence twice by changing it invisibly', () => {
    const w = world();
    const live = createLiveRegion(w.doc, w.timers);
    const [polite] = w.body.children as [El];
    live.announce('Paused');
    live.announce('Paused');
    expect(polite.textContent).toBe('Paused ');
    live.announce('Paused');
    expect(polite.textContent).not.toBe('Paused ');
  });

  it('empties itself after a while and on request, and removes itself on dispose', () => {
    const w = world();
    const live = createLiveRegion(w.doc, w.timers);
    const [polite, assertive] = w.body.children as [El, El];
    live.announce('Saved');
    w.advance(LIVE_TEXT_MS - 1);
    expect(polite.textContent).toBe('Saved');
    w.advance(1);
    expect(polite.textContent).toBe('');
    live.announce('Again');
    live.clear();
    expect(polite.textContent).toBe('');
    live.dispose();
    expect(polite.removed && assertive.removed).toBe(true);
  });
});

describe('toaster', () => {
  const setup = () => {
    const w = world();
    const said: string[] = [];
    const toaster = createToaster(w.doc, { announce: (t) => { said.push(t); } }, w.timers);
    const host = w.body.children[0] as El;
    return { w, said, toaster, host };
  };

  it('keeps the picture out of the accessibility tree and speaks through the live region once', () => {
    const { said, toaster, host } = setup();
    toaster.show('Saved');
    expect(host.attrs['aria-hidden']).toBe('true');
    expect(host.children).toHaveLength(1);
    expect((host.children[0] as El).textContent).toBe('Saved');
    expect(said).toEqual(['Saved']);
  });

  it('uses a kind class and ignores empty text', () => {
    const { toaster, host } = setup();
    toaster.show('   ');
    expect(host.children).toHaveLength(0);
    toaster.show('You are offline', { kind: 'warn' });
    expect((host.children[0] as El).className).toContain('ba-toast--warn');
  });

  it('leaves after a time that grows with the length of the text, then is removed', () => {
    const { w, toaster, host } = setup();
    expect(toastDuration('Saved')).toBe(2800);
    expect(toastDuration('x'.repeat(100))).toBe(2800 + 80 * 45);
    expect(toastDuration('x'.repeat(1000))).toBe(8000);
    toaster.show('Saved');
    const el = host.children[0] as El;
    w.advance(2799);
    expect(el.className).not.toContain('is-leaving');
    w.advance(1);
    expect(el.className).toContain('is-leaving');
    expect(el.removed).toBe(false);
    w.advance(LEAVE_MS);
    expect(el.removed).toBe(true);
  });

  it('shows at most three and lets the oldest go first', () => {
    const { w, toaster, host } = setup();
    for (let i = 1; i <= MAX_TOASTS + 1; i++) toaster.show(`Message ${i}`);
    const first = host.children[0] as El;
    expect(first.className).toContain('is-leaving');
    w.advance(LEAVE_MS);
    expect(first.removed).toBe(true);
    expect(host.children.filter((c) => !c.className.includes('is-leaving'))).toHaveLength(MAX_TOASTS);
  });

  it('dismisses everything and cleans up', () => {
    const { w, toaster, host } = setup();
    toaster.show('One'); toaster.show('Two');
    toaster.dismissAll();
    w.advance(LEAVE_MS);
    expect(host.children.every((c) => c.removed)).toBe(true);
    toaster.dispose();
    expect(host.removed).toBe(true);
  });
});
