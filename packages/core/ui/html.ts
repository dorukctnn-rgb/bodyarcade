// Safe HTML templating for views. Every interpolation is escaped unless it is already SafeHtml, so a name,
// a challenge link or a translated string can never become markup (the live site's F1 was exactly that).
// Views are plain functions that return SafeHtml; the browser app and the Node page generator call the same ones.

const ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

/** Markup that is already safe to put in a page. Create it with html`` or raw(); never from user input. */
export class SafeHtml {
  readonly value: string;
  constructor(value: string) {
    this.value = value;
  }
  toString(): string {
    return this.value;
  }
}

export const isSafeHtml = (v: unknown): v is SafeHtml => v instanceof SafeHtml;

/** Trusted markup (an SVG from the design kit, a JSON-LD block). Not for strings that contain user text. */
export const raw = (value: string): SafeHtml => new SafeHtml(value);

function render(v: unknown): string {
  if (v === null || v === undefined || v === false || v === true) return '';
  if (v instanceof SafeHtml) return v.value;
  if (Array.isArray(v)) return v.map(render).join('');
  return escapeHtml(v);
}

/**
 * html`<p class="${cls}">${text}</p>`. Strings, numbers and nested values are escaped; SafeHtml and arrays of it
 * pass through; null, undefined, false and true render nothing, so `${cond && html`...`}` works.
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  let out = strings[0] ?? '';
  for (let i = 0; i < values.length; i++) out += render(values[i]) + (strings[i + 1] ?? '');
  return new SafeHtml(out);
}

/**
 * One attribute, written safely: attr('aria-current', 'page') gives  aria-current="page" (with the leading space);
 * false, null and undefined give nothing; true gives the bare name (disabled). The value is escaped.
 */
export function attr(name: string, value: unknown): SafeHtml {
  if (!/^[a-zA-Z_:][a-zA-Z0-9_:.-]*$/.test(name)) throw new Error(`bad attribute name: ${name}`);
  if (value === false || value === null || value === undefined) return new SafeHtml('');
  if (value === true) return new SafeHtml(` ${name}`);
  return new SafeHtml(` ${name}="${escapeHtml(value)}"`);
}

/** Joins class names, skipping anything falsy: cx('a', cond && 'b'). */
export function cx(...parts: unknown[]): string {
  return parts.filter((p) => typeof p === 'string' && p !== '').join(' ');
}

/** A JSON blob for a script tag (JSON-LD, data islands): escapes "<" so "</script>" cannot end the tag early. */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** Plain text of a piece of markup (tests, meta descriptions): tags removed, entities decoded, spaces collapsed. */
export function textOf(h: SafeHtml | string): string {
  const s = typeof h === 'string' ? h : h.value;
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
