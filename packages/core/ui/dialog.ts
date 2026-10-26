// Modal windows on the browser's own <dialog>: it traps focus, makes the page behind it inert, handles Escape and
// gives focus back to the button that opened it, so none of that is re-implemented here. This adds what a premium
// shell wants on top: close by clicking outside, close buttons by attribute, no scrolling behind, and a promise that
// settles when the window closes. Browser only; covered by the end-to-end tests.
import type { SafeHtml } from './html.ts';

export interface DialogOptions {
  document?: Document;
  /** The content. It must contain an element whose id is `labelledBy`: the dialog's name. */
  html: SafeHtml;
  labelledBy: string;
  describedBy?: string;
  /** Escape and a click outside close it (default true). A step the player must answer sets false. */
  dismissible?: boolean;
  className?: string;
  /** CSS selector of the element that gets focus first; by default the browser picks [autofocus] or the first control. */
  initialFocus?: string;
  onClose?(result: unknown): void;
}

export interface DialogHandle {
  readonly el: HTMLDialogElement;
  /** Closes with a result (default 'dismissed'). Closing twice is harmless. */
  close(result?: unknown): void;
  /** Replaces the content (a step in a wizard). Focus goes to the first control or `initialFocus`. */
  setHtml(html: SafeHtml): void;
  /** Settles with the result when the dialog has closed. */
  readonly closed: Promise<unknown>;
}

const LOCK_CLASS = 'ba-noscroll';
let openCount = 0;

export function openDialog(o: DialogOptions): DialogHandle {
  const doc = o.document ?? document;
  const el = doc.createElement('dialog');
  el.className = ['ba-modal', o.className].filter(Boolean).join(' ');
  el.setAttribute('aria-labelledby', o.labelledBy);
  if (o.describedBy) el.setAttribute('aria-describedby', o.describedBy);
  el.innerHTML = o.html.value;
  doc.body.appendChild(el);

  const dismissible = o.dismissible !== false;
  let result: unknown = 'dismissed';
  let settled = false;
  let resolve!: (v: unknown) => void;
  const closed = new Promise<unknown>((r) => { resolve = r; });

  const focusFirst = (): void => {
    const target = (o.initialFocus ? el.querySelector<HTMLElement>(o.initialFocus) : null) ?? el.querySelector<HTMLElement>('[autofocus]');
    if (target) target.focus({ preventScroll: true });
  };

  const finish = (): void => {
    if (settled) return;
    settled = true;
    openCount = Math.max(0, openCount - 1);
    if (openCount === 0) doc.documentElement.classList.remove(LOCK_CLASS);
    el.remove();
    o.onClose?.(result);
    resolve(result);
  };

  el.addEventListener('cancel', (e) => { if (!dismissible) e.preventDefault(); });
  el.addEventListener('close', finish);
  el.addEventListener('click', (e) => {
    const target = e.target as Element | null;
    const closer = target?.closest?.('[data-dialog-close]');
    if (closer) { result = closer.getAttribute('data-dialog-close') || 'dismissed'; el.close(); return; }
    if (!dismissible || e.target !== el) return;
    // The element itself is the target for both its own padding and the backdrop; only a click outside its box counts.
    const r = el.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) { result = 'dismissed'; el.close(); }
  });

  openCount += 1;
  doc.documentElement.classList.add(LOCK_CLASS);
  el.showModal();
  focusFirst();

  return {
    el,
    closed,
    close(r) {
      if (settled) return;
      if (r !== undefined) result = r;
      if (el.open) el.close(); else finish();
    },
    setHtml(html) {
      // A control that had focus and has a data-key keeps it across the redraw, so keyboard use is not interrupted.
      const active = el.contains(doc.activeElement) ? (doc.activeElement as HTMLElement) : null;
      const key = active?.getAttribute('data-key') ?? '';
      el.innerHTML = html.value;
      const same = key ? el.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`) : null;
      if (same) same.focus({ preventScroll: true });
      else focusFirst();
    },
  };
}
