// The layout probe: runs INSIDE a page (Playwright serialises the function, so it may use nothing from outside its
// body) and returns what a person would call a layout bug: things wider than the screen, controls and text that are
// cut off, text that spills out of its box, two things drawn on top of each other, a picture hiding text.
//
// What counts as an "atom": a piece of text (one rectangle per line), a control (link, button, field, ...) or a
// picture (img, svg, canvas, video). Atoms are compared in pairs, never with their own ancestors or descendants.
// Intentional layering is allowed in three ways: text or a control drawn ABOVE a picture, anything inside an element
// with data-qa-layer / data-qa-ignore, and decorations (aria-hidden and not clickable). Overlaps are confirmed with
// the browser's own hit test (elementsFromPoint), so something clipped away by an ancestor never counts.
//
// Pages that scroll are walked from the top to the bottom. Fixed bars (tab bar, top bar) sit over the page by design,
// so they are compared with the page only at its two rest positions (top and bottom).

export type FindingKind = 'overflow-x' | 'offscreen' | 'unreachable' | 'clipped' | 'text-cut' | 'spill' | 'overlap' | 'covered' | 'tap-target' | 'below-fold' | 'blank-scene' | 'bad-text';

export interface Finding {
  kind: FindingKind;
  severity: 'error' | 'warn';
  message: string;
  /** The element the finding is about. */
  at: string;
  /** The other element, for overlaps. */
  with?: string;
}

export interface ProbeOptions {
  /** CSS selectors whose elements (and everything inside them) are left out of every check. */
  ignore: string[];
  /** Touch screen: also report controls smaller than minTarget. */
  touch: boolean;
  minTarget: number;
  /** Selectors of the main action of a screen: a warning when it is not fully on the first screen. */
  primary: string[];
}

export interface ProbeResult {
  findings: Finding[];
  stats: { atoms: number; width: number; height: number; pageHeight: number; scrollable: boolean; modal: boolean; positions: number };
}

export const DEFAULT_PROBE: ProbeOptions = { ignore: [], touch: false, minTarget: 24, primary: [] };

export function layoutProbe(opts: ProbeOptions): ProbeResult {
  type R = [number, number, number, number]; // left, top, right, bottom
  type AtomKind = 'text' | 'control' | 'media' | 'surface';
  interface Atom { el: Element; kind: AtomKind; pinned: boolean }

  const findings: Finding[] = [];
  const seen = new Set<string>();
  const add = (f: Finding): void => {
    const key = `${f.kind}|${f.at}|${f.with ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push(f);
  };

  const root = document.documentElement;
  const scroller = document.scrollingElement ?? root;
  const W = root.clientWidth || window.innerWidth;
  const H = window.innerHeight;

  // ---- small helpers ------------------------------------------------------------------------------------------------
  const styleCache = new Map<Element, CSSStyleDeclaration>();
  const cs = (el: Element): CSSStyleDeclaration => {
    let s = styleCache.get(el);
    if (!s) { s = getComputedStyle(el); styleCache.set(el, s); }
    return s;
  };
  const opacityCache = new Map<Element, number>();
  const effOpacity = (el: Element | null): number => {
    if (!el) return 1;
    const c = opacityCache.get(el);
    if (c !== undefined) return c;
    const v = effOpacity(el.parentElement) * Number(cs(el).opacity);
    opacityCache.set(el, v);
    return v;
  };
  const name = (el: Element): string => {
    const tag = el.tagName.toLowerCase();
    const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
    const txt = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 28);
    return `${tag}${el.id ? `#${el.id}` : ''}${cls}${txt ? ` "${txt}"` : ''}`;
  };
  const rectOf = (r: DOMRect): R => [r.left, r.top, r.right, r.bottom];
  const inter = (a: R, b: R): R | null => {
    const l = Math.max(a[0], b[0]); const t = Math.max(a[1], b[1]); const r = Math.min(a[2], b[2]); const bt = Math.min(a[3], b[3]);
    return r > l && bt > t ? [l, t, r, bt] : null;
  };
  const area = (r: R): number => Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1]);
  const union = (rs: R[]): R | null => (rs.length ? [Math.min(...rs.map((r) => r[0])), Math.min(...rs.map((r) => r[1])), Math.max(...rs.map((r) => r[2])), Math.max(...rs.map((r) => r[3]))] : null);

  const pinRoot = (el: Element): Element | null => { for (let e: Element | null = el; e; e = e.parentElement) { const p = cs(e).position; if (p === 'fixed' || p === 'sticky') return e; } return null; };
  const ignoreSel = ['[data-qa-ignore]', '[data-qa-layer]', ...opts.ignore].join(',');
  const ignored = (el: Element): boolean => !!el.closest(ignoreSel);
  const pinnedCache = new Map<Element, boolean>();
  const isPinned = (el: Element | null): boolean => {
    if (!el) return false;
    const c = pinnedCache.get(el);
    if (c !== undefined) return c;
    const p = cs(el).position;
    const v = p === 'fixed' || p === 'sticky' || isPinned(el.parentElement);
    pinnedCache.set(el, v);
    return v;
  };

  // A modal window covers the page under it: only what is inside it is checked.
  const modals = [...document.querySelectorAll('dialog[open], [aria-modal="true"]')].filter((m) => { const r = m.getBoundingClientRect(); return r.width > 1 && r.height > 1 && cs(m).visibility !== 'hidden'; });
  const modal = modals.length ? (modals[modals.length - 1] as Element) : null;

  // ---- collect atoms -------------------------------------------------------------------------------------------------
  const CONTROL = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=tab], [role=menuitem], [role=switch], [role=checkbox], [role=radio], [role=slider]';
  const MEDIA = 'img, svg, canvas, video, iframe, object, embed';
  const SKIP = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'HEAD', 'TITLE', 'NOSCRIPT', 'TEMPLATE', 'BASE', 'OPTION', 'OPTGROUP', 'DATALIST', 'SOURCE', 'TRACK', 'BR', 'WBR']);
  const hasOwnText = (el: Element): boolean => { for (const n of el.childNodes) if (n.nodeType === 3 && (n.nodeValue ?? '').trim()) return true; return false; };
  const decorative = (el: Element): boolean => !!el.closest('[aria-hidden="true"]') && (cs(el).pointerEvents === 'none' || !hasOwnText(el));

  /** Opacity of a computed colour string: rgb(), rgba(), color(... / a), transparent. */
  const alphaOf = (c: string): number => {
    if (c === 'transparent') return 0;
    const slash = /\/\s*([\d.]+)(%?)\s*\)$/.exec(c);
    if (slash) return Number(slash[1]) / (slash[2] ? 100 : 1);
    const m = /^rgba\(([^)]+)\)$/.exec(c);
    if (m) { const parts = (m[1] as string).split(/[,\s]+/).filter(Boolean); return parts.length >= 4 ? Number(parts[3]) : 1; }
    return 1;
  };

  const atoms: Atom[] = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (SKIP.has(el.tagName) || el.closest('svg') !== null && el.tagName.toLowerCase() !== 'svg') continue;
    if (modal && !modal.contains(el)) continue;
    const s = cs(el);
    if (s.visibility !== 'visible' || s.display === 'none' || effOpacity(el) < 0.05) continue;
    // Closed <details> content, content-visibility: hidden and the like: laid out on demand but never drawn.
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true })) continue;
    if (ignored(el) || decorative(el)) continue;
    const r = el.getBoundingClientRect();
    const isControl = el.matches(CONTROL) && !(el instanceof HTMLInputElement && (el.type === 'radio' || el.type === 'checkbox') && el.closest('label'));
    const isMedia = el.matches(MEDIA);
    const isText = hasOwnText(el);
    // A fixed or sticky bar with a (nearly) solid background hides whatever is under it, also between its own words.
    const isSurface = (s.position === 'fixed' || s.position === 'sticky') && alphaOf(s.backgroundColor) >= 0.6 && r.width >= 2 && r.height >= 2;
    if (isSurface) atoms.push({ el, kind: 'surface', pinned: true });
    if (!isControl && !isMedia && !isText) continue;
    if (r.width < 2 || r.height < 2) continue; // also the "visually hidden" pattern (1px box, clipped)
    const pinned = isPinned(el);
    if (isControl) atoms.push({ el, kind: 'control', pinned });
    if (isMedia) atoms.push({ el, kind: 'media', pinned });
    if (isText) atoms.push({ el, kind: 'text', pinned });
  }

  /** One rectangle per line of the text that belongs to el itself. */
  const textRects = (el: Element, inset: boolean): R[] => {
    const out: R[] = [];
    const range = document.createRange();
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !(n.nodeValue ?? '').trim()) continue;
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) {
        if (r.width < 1 || r.height < 1) continue;
        // The line box is taller than the letters; the middle 76 % is where ink is.
        const d = inset ? r.height * 0.12 : 0;
        out.push([r.left, r.top + d, r.right, r.bottom - d]);
      }
    }
    return out;
  };
  const rectsOf = (a: Atom, inset = true): R[] => (a.kind === 'text' ? textRects(a.el, inset) : [rectOf(a.el.getBoundingClientRect())]);

  // ---- page level: sideways overflow, scrolling -----------------------------------------------------------------------
  const overflowAxis = (el: Element, axis: 'x' | 'y'): string => (axis === 'x' ? cs(el).overflowX : cs(el).overflowY);
  /** The nearest ancestor (below body) that clips or scrolls this element on one axis, honouring absolute escapes. */
  const clipperOf = (el: Element, axis: 'x' | 'y'): { el: Element; scrolls: boolean } | null => {
    let escaping = false;
    let cur: Element = el;
    for (;;) {
      const pos = cs(cur).position;
      if (pos === 'fixed') return null;
      if (pos === 'absolute') escaping = true;
      const p: Element | null = cur.parentElement;
      if (!p || p === document.body || p === root) return null;
      const ps = cs(p);
      const positioned = ps.position !== 'static' || ps.transform !== 'none' || ps.filter !== 'none' || ps.contain.includes('paint');
      if (escaping && positioned) escaping = false;
      const ov = overflowAxis(p, axis);
      if (!escaping && ov !== 'visible') return { el: p, scrolls: ov === 'auto' || ov === 'scroll' };
      cur = p;
    }
  };

  const docScrollable = scroller.scrollHeight > scroller.clientHeight + 1 && cs(root).overflowY !== 'hidden' && cs(document.body).overflowY !== 'hidden';
  const pageHeight = Math.max(scroller.scrollHeight, H);

  if (scroller.scrollWidth > W + 1) {
    const culprits: string[] = [];
    for (const a of atoms) {
      if (culprits.length >= 3) break;
      const r = a.el.getBoundingClientRect();
      if (r.right > W + 1 && !clipperOf(a.el, 'x') && !a.pinned) culprits.push(`${name(a.el)} ends at ${Math.round(r.right)}`);
    }
    add({ kind: 'overflow-x', severity: 'error', at: 'page', message: `the page is ${scroller.scrollWidth}px wide on a ${W}px screen${culprits.length ? `: ${culprits.join('; ')}` : ''}` });
  }

  // ---- cut off: by the screen edge or by an ancestor ------------------------------------------------------------------
  const TOL = 1.5;
  for (const a of atoms) {
    const rs = rectsOf(a, false);
    const box = union(rs);
    if (!box) continue;
    const w = box[2] - box[0]; const h = box[3] - box[1];
    const partial = (visible: R | null): boolean => !!visible && area(visible) > 0 && area(visible) < area(box) * 0.985 && (w - (visible[2] - visible[0]) > TOL || h - (visible[3] - visible[1]) > TOL);
    const el = a.el;
    const label = name(el);
    const text = a.kind === 'text';

    // Ancestors that clip.
    for (const axis of ['x', 'y'] as const) {
      const c = clipperOf(el, axis);
      if (c && !c.scrolls) {
        const cr = c.el.getBoundingClientRect();
        // Padding box of the clipper (borders do not clip).
        const cb: R = [cr.left + c.el.clientLeft, cr.top + c.el.clientTop, cr.left + c.el.clientLeft + c.el.clientWidth, cr.top + c.el.clientTop + c.el.clientHeight];
        if (c.el.clientWidth < 2 || c.el.clientHeight < 2) continue; // a collapsed panel hides its content on purpose
        const visible = axis === 'x' ? inter(box, [cb[0], -1e6, cb[2], 1e6]) : inter(box, [-1e6, cb[1], 1e6, cb[3]]);
        const ell = text && (cs(el).textOverflow === 'ellipsis' || cs(c.el).textOverflow === 'ellipsis');
        const clamp = text && (cs(el).webkitLineClamp !== 'none' || cs(c.el).webkitLineClamp !== 'none');
        if (partial(visible) && !ell && !clamp && !c.el.closest('[data-qa-allow-clip]') && !el.closest('[data-qa-allow-clip]')) {
          add({ kind: 'clipped', severity: 'error', at: label, with: name(c.el), message: `${label} is cut off by ${name(c.el)} (${axis === 'x' ? 'sideways' : 'top or bottom'})` });
        }
      }
    }

    // The screen edge, for what no ancestor clips or scrolls. Sideways: always. Up and down: for fixed elements and when
    // the page itself cannot scroll.
    const allowClip = !!el.closest('[data-qa-allow-clip]');
    const root0 = a.pinned ? pinRoot(el) : null;
    const fixedPos = !!root0 && cs(root0).position === 'fixed';
    if (!clipperOf(el, 'x') && !allowClip) {
      const visible = inter(box, [0, -1e6, W, 1e6]);
      if (partial(visible)) add({ kind: 'offscreen', severity: 'error', at: label, message: `${label} reaches past the ${box[0] < 0 ? 'left' : 'right'} edge of the screen (${Math.round(box[0])} to ${Math.round(box[2])} on ${W})` });
    }
    if ((fixedPos || !docScrollable) && !clipperOf(el, 'y') && !allowClip) {
      const visible = inter(box, [-1e6, 0, 1e6, H]);
      if (partial(visible)) add({ kind: 'offscreen', severity: 'error', at: label, message: `${label} is cut off at the ${box[1] < 0 ? 'top' : 'bottom'} of the screen (${Math.round(box[1])} to ${Math.round(box[3])} on ${H}, ${fixedPos ? 'fixed' : 'the page cannot scroll'})` });
      else if (!visible && !fixedPos && a.kind === 'control' && box[1] >= H && !el.closest('[aria-hidden="true"], [inert]')) add({ kind: 'unreachable', severity: 'warn', at: label, message: `${label} is below the bottom of a screen that cannot scroll (${Math.round(box[1])} on ${H})` });
    }

    // Text that is cut by its own overflow rule.
    if (text) {
      const s = cs(el);
      const clipX = s.overflowX === 'hidden' || s.overflowX === 'clip';
      const clipY = s.overflowY === 'hidden' || s.overflowY === 'clip';
      if ((clipX || clipY) && s.textOverflow !== 'ellipsis' && s.webkitLineClamp === 'none' && !el.closest('[data-qa-allow-clip]')) {
        if ((clipX && el.clientWidth > 1 && el.scrollWidth > el.clientWidth + 1) || (clipY && el.clientHeight > 1 && el.scrollHeight > el.clientHeight + 1)) {
          add({ kind: 'text-cut', severity: 'error', at: label, message: `the text of ${label} is longer than its box and is cut (${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight})` });
        }
      }
    }
  }

  // ---- the main action must be on the first screen -----------------------------------------------------------------------
  if (opts.primary.length) {
    const sel = opts.primary.join(',');
    for (const a of atoms) {
      if (a.kind !== 'control' || !a.el.matches(sel)) continue;
      const r = rectOf(a.el.getBoundingClientRect());
      const visible = inter(r, [0, 0, W, H]);
      if (!visible || area(visible) < area(r) * 0.985) add({ kind: 'below-fold', severity: 'warn', at: name(a.el), message: `the main action ${name(a.el)} is not fully on the first screen (${Math.round(r[1])} to ${Math.round(r[3])} on ${H})` });
    }
  }

  // ---- text spilling out of the box it sits in -------------------------------------------------------------------------
  const isBox = (el: Element): boolean => {
    const s = cs(el);
    if (s.display === 'inline' || s.display === 'contents') return false;
    const bg = s.backgroundColor;
    const filled = bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(bg);
    const bordered = ['Top', 'Right', 'Bottom', 'Left'].some((side) => parseFloat((s as unknown as Record<string, string>)[`border${side}Width`] ?? '0') > 0 && (s as unknown as Record<string, string>)[`border${side}Style`] !== 'none');
    return filled || bordered || el.matches(CONTROL);
  };
  for (const a of atoms) {
    if (a.kind !== 'text') continue;
    const tr = union(textRects(a.el, true));
    if (!tr) continue;
    let cur: Element | null = a.el;
    let guard = 0;
    while (cur && cur !== document.body && guard++ < 14) {
      const s = cs(cur);
      if (s.overflowX !== 'visible' || s.overflowY !== 'visible') break; // a clipping box: the clip checks above handle it
      if (isBox(cur) && !cur.closest('[data-qa-allow-clip]')) {
        const b = cur.getBoundingClientRect();
        if (b.width > 1 && b.height > 1 && (tr[2] > b.right + 2 || tr[0] < b.left - 2 || tr[3] > b.bottom + 3 || tr[1] < b.top - 3)) {
          add({ kind: 'spill', severity: 'error', at: name(a.el), ...(cur === a.el ? {} : { with: name(cur) }), message: `the text ${name(a.el)} spills out of ${cur === a.el ? 'its own box' : name(cur)} (text ${Math.round(tr[0])},${Math.round(tr[1])} to ${Math.round(tr[2])},${Math.round(tr[3])}; box ${Math.round(b.left)},${Math.round(b.top)} to ${Math.round(b.right)},${Math.round(b.bottom)})` });
        }
      }
      if (s.position === 'absolute' || s.position === 'fixed') break; // a positioned element leaves its parent's box on purpose
      cur = cur.parentElement;
    }
  }

  // ---- overlaps and covered text, walking down the page ---------------------------------------------------------------
  const startY = scroller.scrollTop;
  const maxY = Math.max(0, scroller.scrollHeight - H);
  const stepY = Math.max(80, Math.floor(H * 0.85));
  const positions: number[] = [];
  if (!docScrollable || maxY < 2) positions.push(0);
  else { for (let y = 0; y < maxY && positions.length < 40; y += stepY) positions.push(y); positions.push(maxY); }
  const scrollTo = (y: number): void => { window.scrollTo({ top: y, left: 0, behavior: 'instant' as ScrollBehavior }); };

  // A fixed or sticky element is attached to one side of the screen. Content scrolls under a bar by design; what must
  // hold is that at the page's rest positions (top, bottom) nothing stays hidden under the bar that is attached there.
  type Anchor = 'top' | 'bottom' | 'side' | 'full' | 'float';
  const anchorOf = (r: R): Anchor => {
    const w = r[2] - r[0]; const h = r[3] - r[1];
    if (w * h > 0.8 * W * H) return 'full';
    if (w < W * 0.6 && h > H * 0.45 && (r[0] <= 2 || r[2] >= W - 2)) return 'side';
    if (r[3] >= H - 2 && r[1] > H * 0.35) return 'bottom';
    if (r[1] <= 2) return 'top';
    return 'float';
  };

  let candidates = 0;
  const last = positions.length - 1;
  for (let pi = 0; pi < positions.length; pi++) {
    scrollTo(positions[pi] as number);
    const items = atoms.map((a) => {
      const pr = a.pinned ? pinRoot(a.el) : null;
      return { a, rs: rectsOf(a), anchor: (pr ? anchorOf(rectOf(pr.getBoundingClientRect())) : null) as Anchor | null };
    }).filter((x) => x.rs.some((r) => r[2] > 0 && r[0] < W && r[3] > 0 && r[1] < H));
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const A = items[i] as (typeof items)[number]; const B = items[j] as (typeof items)[number];
        if (A.a.pinned && B.a.pinned) { if (pi !== 0) continue; }
        else if (A.a.pinned || B.a.pinned) {
          const anchor = A.a.pinned ? A.anchor : B.anchor;
          if (!(anchor === 'side' || (anchor === 'top' && pi === 0) || (anchor === 'bottom' && pi === last))) continue;
        }
        if (A.a.el.contains(B.a.el) || B.a.el.contains(A.a.el)) continue;
        if (A.a.kind === 'media' && B.a.kind === 'media') continue;
        // Two pinned things where one is a surface: only the surface covering the other matters (checked below).
        let hit: R | null = null;
        for (const ra of A.rs) { for (const rb of B.rs) { const x = inter(ra, rb); if (x && x[2] - x[0] > 3 && x[3] - x[1] > 3) { hit = x; break; } } if (hit) break; }
        if (!hit || candidates >= 400) continue;
        candidates += 1;
        // Confirm with the browser's hit test: both must be there, at some point of the shared area.
        const pts: [number, number][] = [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]].map(([fx, fy]) => [hit![0] + (hit![2] - hit![0]) * (fx as number), hit![1] + (hit![3] - hit![1]) * (fy as number)] as [number, number]);
        let order: [number, number] | null = null;
        for (const [x, y] of pts) {
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const stack = document.elementsFromPoint(x, y);
          const ia = stack.findIndex((e) => e === A.a.el || A.a.el.contains(e));
          const ib = stack.findIndex((e) => e === B.a.el || B.a.el.contains(e));
          if (ia >= 0 && ib >= 0) { order = [ia, ib]; break; }
        }
        if (!order) continue;
        const [ia, ib] = order;
        const surf = A.a.kind === 'surface' ? A : B.a.kind === 'surface' ? B : null;
        if (surf) {
          if (A.a.kind === 'surface' && B.a.kind === 'surface') continue;
          const other = surf === A ? B : A;
          const surfaceOnTop = (surf === A ? ia : ib) < (surf === A ? ib : ia);
          if (surfaceOnTop) add({ kind: 'covered', severity: 'error', at: name(other.a.el), with: name(surf.a.el), message: `${name(other.a.el)} is hidden under ${name(surf.a.el)}` });
          continue;
        }
        const media = A.a.kind === 'media' ? A : B.a.kind === 'media' ? B : null;
        if (media) {
          const other = media === A ? B : A;
          const mediaOnTop = (media === A ? ia : ib) < (media === A ? ib : ia);
          if (mediaOnTop) add({ kind: 'covered', severity: 'error', at: name(other.a.el), with: name(media.a.el), message: `${name(other.a.el)} is hidden behind ${name(media.a.el)}` });
          continue;
        }
        add({ kind: 'overlap', severity: 'error', at: name(A.a.el), with: name(B.a.el), message: `${name(A.a.el)} overlaps ${name(B.a.el)} (${Math.round(hit[2] - hit[0])}x${Math.round(hit[3] - hit[1])}px)` });
      }
    }
  }
  scrollTo(startY);

  // ---- tap targets ---------------------------------------------------------------------------------------------------------
  if (opts.touch) {
    for (const a of atoms) {
      if (a.kind !== 'control') continue;
      const el = a.el;
      const s = cs(el);
      if (s.pointerEvents === 'none' || (s.display === 'inline' && el.closest('p, li, dd, blockquote, figcaption'))) continue;
      const r = el.getBoundingClientRect();
      if (Math.min(r.width, r.height) < opts.minTarget) add({ kind: 'tap-target', severity: 'warn', at: name(el), message: `${name(el)} is ${Math.round(r.width)}x${Math.round(r.height)}px, under ${opts.minTarget}px` });
    }
  }

  // ---- broken text ---------------------------------------------------------------------------------------------------------
  // What a person reads must not hold a value that was never filled in ("undefined", "NaN", "{name}") and a sentence must not
  // start with a stray comma or full stop (a name that came out empty: ", step into view.").
  {
    const RAW = /\bundefined\b|\bNaN\b|\[object [A-Za-z]+\]|\{\{|\}\}|\{[a-zA-Z_][\w.]*\}|%[sd]\b/;
    const STRAY = /^[,.;:!?)\]]/;
    const blocky = /^(P|H[1-6]|LI|DIV|UL|OL|SECTION|ARTICLE|BUTTON|A|LABEL|TABLE|MAIN|NAV|HEADER|FOOTER|DIALOG|FORM|DETAILS|SUMMARY)$/;
    const done = new Set<string>();
    for (const el of document.querySelectorAll('p, h1, h2, h3, h4, li, button, a, label, summary, figcaption, td, th, dd, dt, span, div, [role="alert"], [role="status"]')) {
      if (opts.ignore.some((q) => { try { return !!el.closest(q); } catch { return false; } })) continue;
      if (el.closest('script, style, template, [hidden], [data-qa-ignore]')) continue;
      const r = el.getBoundingClientRect();
      const s = cs(el);
      if (r.width < 1 || r.height < 1 || s.display === 'none' || s.visibility === 'hidden') continue;
      if ([...el.children].some((c) => blocky.test(c.tagName))) continue;
      const text = ((el as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length > 400) continue;
      const key = `${name(el)}|${text}`;
      if (done.has(key)) continue;
      done.add(key);
      const raw = RAW.exec(text);
      if (raw) add({ kind: 'bad-text', severity: 'error', at: name(el), message: `the text "${text.slice(0, 60)}" shows "${raw[0]}", a value that was not filled in` });
      else if (STRAY.test(text) && !/^\.{2,}|^…/.test(text) && text.length > 3) add({ kind: 'bad-text', severity: 'error', at: name(el), message: `the sentence "${text.slice(0, 60)}" starts with "${text[0]}": a word before it is missing` });
    }
    for (const el of document.querySelectorAll('[aria-label], img[alt], [title]')) {
      const v = `${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('alt') ?? ''} ${el.getAttribute('title') ?? ''}`;
      const raw = RAW.exec(v);
      if (raw) add({ kind: 'bad-text', severity: 'error', at: name(el), message: `the label "${v.trim().slice(0, 60)}" shows "${raw[0]}", a value that was not filled in` });
    }
  }

  findings.sort((x, y) => (x.severity === y.severity ? 0 : x.severity === 'error' ? -1 : 1));
  return { findings, stats: { atoms: atoms.length, width: W, height: H, pageHeight, scrollable: docScrollable, modal: !!modal, positions: positions.length } };
}
