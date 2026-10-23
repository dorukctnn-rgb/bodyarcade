// Short messages at the bottom of the screen ("Saved", "You are offline"). The picture is hidden from assistive
// technology; the words are spoken once, politely, through the live region. A toast has no buttons: anything the
// player must act on is a dialog or a line on the page instead.
import type { LiveRegion, Timers } from './live-region.ts';

export interface ToastElement {
  className: string;
  textContent: string | null;
  setAttribute(name: string, value: string): void;
  appendChild(child: ToastElement): unknown;
  remove(): void;
}

export interface ToastDocument {
  createElement(tag: 'div'): ToastElement;
  body: { appendChild(el: ToastElement): unknown };
}

export interface ToastOptions {
  /** How long it stays; by default a little longer for longer text. */
  ms?: number;
  /** 'info' is the default; 'warn' uses the warning colour for things like "You are offline". */
  kind?: 'info' | 'warn';
}

export interface Toaster {
  show(text: string, o?: ToastOptions): void;
  dismissAll(): void;
  dispose(): void;
}

export const MAX_TOASTS = 3;
export const LEAVE_MS = 220;

/** 2.8 s plus 45 ms for every character after the first 20, at most 8 s. Honest reading time for a short sentence. */
export function toastDuration(text: string): number {
  return Math.min(8000, 2800 + Math.max(0, text.length - 20) * 45);
}

export function createToaster(doc: ToastDocument, live: Pick<LiveRegion, 'announce'>, timers: Timers = { set: (cb, ms) => setTimeout(cb, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) }): Toaster {
  const host = doc.createElement('div');
  host.className = 'ba-toasts';
  host.setAttribute('aria-hidden', 'true');
  host.setAttribute('data-toasts', '');
  doc.body.appendChild(host);

  interface Live { el: ToastElement; timer: unknown; leaving: unknown; text: string; kind: string }
  const shown: Live[] = [];

  const leave = (t: Live): void => {
    const i = shown.indexOf(t);
    if (i < 0) return;
    shown.splice(i, 1);
    if (t.timer !== null) timers.clear(t.timer);
    t.el.className = `${t.el.className} is-leaving`;
    t.leaving = timers.set(() => t.el.remove(), LEAVE_MS);
  };

  return {
    show(text, o = {}) {
      const t = text.trim();
      if (!t) return;
      const kind = o.kind ?? 'info';
      // The same words are already on the screen (the browser's offline event and ours, a double tap): keep the one, restart its time.
      const same = shown.find((s) => s.text === t && s.kind === kind);
      if (same) {
        if (same.timer !== null) timers.clear(same.timer);
        same.timer = timers.set(() => leave(same), o.ms ?? toastDuration(t));
        return;
      }
      live.announce(t);
      const el = doc.createElement('div');
      el.className = `ba-toast ba-toast--${kind}`;
      el.textContent = t;
      host.appendChild(el);
      const entry: Live = { el, timer: null, leaving: null, text: t, kind };
      entry.timer = timers.set(() => leave(entry), o.ms ?? toastDuration(t));
      shown.push(entry);
      while (shown.length > MAX_TOASTS) leave(shown[0] as Live);
    },
    dismissAll() { for (const t of [...shown]) leave(t); },
    dispose() {
      for (const t of [...shown]) { if (t.timer !== null) timers.clear(t.timer); t.el.remove(); }
      shown.length = 0;
      host.remove();
    },
  };
}
