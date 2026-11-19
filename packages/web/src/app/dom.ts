// Small DOM helpers for the app: replace markup without losing the player's place, and keep the document head in step
// with the page. Browser only.
import type { Rendered } from '../pages.ts';

/**
 * Replaces the content of `host` with markup. If a control with a data-key (or an id) had focus, the new control with
 * the same key gets it, with the same text selection, so typing and keyboard use survive a redraw. An element with a
 * data-keep value that the new markup has too stays as it is (the home page hero's poster, clip and canvas: the picture the
 * page drew first is not drawn again, and a clip that plays does not start over).
 */
export function swap(host: HTMLElement, markup: string): void {
  const doc = host.ownerDocument;
  const active = doc.activeElement as HTMLElement | null;
  const inside = !!active && host.contains(active);
  const key = inside ? active.getAttribute('data-key') : null;
  const id = inside && !key ? active.id : '';
  const selection = inside && (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) ? [active.selectionStart, active.selectionEnd] as const : null;
  const kept = new Map<string, Element>();
  for (const el of host.querySelectorAll('[data-keep]')) kept.set(el.getAttribute('data-keep') ?? '', el);
  host.innerHTML = markup;
  if (kept.size) {
    for (const el of host.querySelectorAll('[data-keep]')) {
      const old = kept.get(el.getAttribute('data-keep') ?? '');
      if (old && old !== el) el.replaceWith(old);
    }
  }
  if (!inside) return;
  const next = key ? host.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`) : id ? host.querySelector<HTMLElement>(`#${CSS.escape(id)}`) : null;
  if (!next) return;
  next.focus({ preventScroll: true });
  if (selection && (next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement) && selection[0] !== null && selection[1] !== null) {
    try { next.setSelectionRange(selection[0], selection[1]); } catch { /* number inputs have no selection */ }
  }
}

function meta(doc: Document, name: string): HTMLMetaElement {
  let m = doc.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!m) {
    m = doc.createElement('meta');
    m.name = name;
    doc.head.append(m);
  }
  return m;
}

/** Title, description, robots, language and canonical link of the document, from a rendered page. */
export function applyHead(doc: Document, page: Pick<Rendered, 'title' | 'description' | 'noindex'>, o: { tag: string; canonicalHref: string | null }): void {
  doc.title = page.title;
  doc.documentElement.lang = o.tag;
  meta(doc, 'description').content = page.description;
  const robots = doc.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
  if (page.noindex) meta(doc, 'robots').content = 'noindex, follow';
  else robots?.remove();
  let link = doc.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (o.canonicalHref && !page.noindex) {
    if (!link) {
      link = doc.createElement('link');
      link.rel = 'canonical';
      doc.head.append(link);
    }
    link.href = o.canonicalHref;
  } else link?.remove();
}

/** The asset map the generator writes into the page (development URL to built URL), or an empty one. */
export function readAssetMap(doc: Document): Record<string, string> {
  const node = doc.getElementById('ba-assets');
  if (!node?.textContent) return {};
  try {
    const v = JSON.parse(node.textContent) as unknown;
    if (typeof v !== 'object' || v === null) return {};
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (typeof val === 'string' && val.startsWith('/')) out[k] = val;
    return out;
  } catch {
    return {};
  }
}
