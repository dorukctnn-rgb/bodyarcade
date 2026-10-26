// The family of the text the games draw on the canvas. A canvas cannot use a CSS variable, so the design token
// (--ba-font-text: the system stack, SF Pro on Apple devices, Segoe UI on Windows, Roboto on Android) is read from the page
// when there is one, and the same stack is used when there is not (Node tests, a page without the stylesheet). Nothing
// decorative here: commands and numbers must read at a glance (weights 700 to 800).
export const SYSTEM_STACK = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, system-ui, sans-serif';

let read = '';

export function canvasFont(): string {
  if (read) return read;
  try {
    if (typeof document !== 'undefined' && typeof getComputedStyle === 'function') {
      const v = getComputedStyle(document.documentElement).getPropertyValue('--ba-font-text').trim();
      if (v) read = v;
    }
  } catch { /* no page: the stack above */ }
  return read || SYSTEM_STACK;
}
