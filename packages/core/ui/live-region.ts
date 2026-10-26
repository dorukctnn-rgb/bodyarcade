// The one place the page speaks to screen readers (B17): a polite region for status ("Paused", "Round starts in 3")
// and, when something needs interrupting, an assertive one. Visual toasts stay out of the accessibility tree and the
// words come from here, so nothing is announced twice. The regions exist from the start, empty, because a region
// that is created at the same moment as its text is often not announced at all.

export interface LiveElement {
  className: string;
  textContent: string | null;
  setAttribute(name: string, value: string): void;
  remove(): void;
}

export interface LiveDocument {
  createElement(tag: 'div'): LiveElement;
  body: { appendChild(el: LiveElement): unknown };
}

export interface Timers {
  set(cb: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface LiveRegion {
  /** Says the text. The same sentence twice in a row is still spoken twice. */
  announce(text: string, o?: { assertive?: boolean }): void;
  /** Empties both regions. */
  clear(): void;
  dispose(): void;
}

/** Text stays in the region this long, then is removed so it cannot be read again in browse mode. */
export const LIVE_TEXT_MS = 6000;

const NBSP = ' ';

export function createLiveRegion(doc: LiveDocument, timers: Timers = { set: (cb, ms) => setTimeout(cb, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) }): LiveRegion {
  const make = (role: 'status' | 'alert', live: 'polite' | 'assertive'): { el: LiveElement; last: string; timer: unknown } => {
    const el = doc.createElement('div');
    el.className = 'ba-visually-hidden';
    el.setAttribute('role', role);
    el.setAttribute('aria-live', live);
    el.setAttribute('aria-atomic', 'true');
    el.setAttribute('data-live', live);
    doc.body.appendChild(el);
    return { el, last: '', timer: null };
  };
  const polite = make('status', 'polite');
  const assertive = make('alert', 'assertive');

  const say = (r: typeof polite, text: string): void => {
    if (r.timer !== null) timers.clear(r.timer);
    // A region only speaks when its text changes, so repeat a sentence with an invisible difference.
    r.el.textContent = text === r.last ? text + NBSP : text;
    r.last = r.el.textContent;
    r.timer = timers.set(() => { r.el.textContent = ''; r.last = ''; r.timer = null; }, LIVE_TEXT_MS);
  };

  const wipe = (r: typeof polite): void => {
    if (r.timer !== null) timers.clear(r.timer);
    r.timer = null; r.last = ''; r.el.textContent = '';
  };

  return {
    announce(text, o) {
      const t = text.trim();
      if (!t) return;
      say(o?.assertive ? assertive : polite, t);
    },
    clear() { wipe(polite); wipe(assertive); },
    dispose() { wipe(polite); wipe(assertive); polite.el.remove(); assertive.el.remove(); },
  };
}
