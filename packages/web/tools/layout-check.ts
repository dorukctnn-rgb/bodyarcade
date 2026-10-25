// The automated layout check of the screen layout rule (BUILD-PLAN): on the page as it is drawn, nothing is wider than the
// screen, no control is cut off, no two controls overlap, and nothing stays under the fixed navigation at the end of
// the page. Used by the screenshot tool and by the end-to-end tests.
import type { Page } from '@playwright/test';

/** Problems visible on the page right now; an empty list means it passes. */
export async function checkPage(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const de = document.documentElement;
    if (de.scrollWidth > innerWidth + 1) problems.push(`sideways scroll: page is ${de.scrollWidth}px wide on a ${innerWidth}px screen`);
    // What a closed <details> holds under its summary is not drawn, but the engines keep its boxes (content-visibility: hidden), lying
    // over whatever follows: the terms page's folded "On this page" list read as its links over the text under it.
    const folded = (el: Element): boolean => {
      for (let d = el.closest('details:not([open])'); d; d = d.parentElement?.closest('details:not([open])') ?? null) {
        const summary = d.querySelector(':scope > summary');
        if (!summary || !summary.contains(el)) return true;
      }
      return false;
    };
    const vis = (el: Element): DOMRect | null => {
      if (folded(el)) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width < 1 || r.height < 1 || cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return null;
      return r;
    };
    const label = (el: Element): string => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? `.${el.className.split(' ')[0]}` : ''} "${(el.textContent ?? '').trim().slice(0, 24)}"`;
    // A modal window covers everything outside it (and the windows under it).
    const open = [...document.querySelectorAll('dialog[open]')];
    const top = open[open.length - 1] ?? null;
    const controls = [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, summary')].filter((el) =>
      !el.closest('[hidden], [inert], .ba-visually-hidden') && !(el instanceof HTMLInputElement && (el.type === 'radio' || el.type === 'checkbox')) && (!top || top.contains(el)));
    const rects = controls.map((el) => ({ el, r: vis(el) })).filter((x): x is { el: Element; r: DOMRect } => !!x.r);
    for (const { el, r } of rects) {
      const fixed = !!el.closest('.ba-tabbar, .ba-topbar, .ba-skip, dialog');
      if (!fixed && r.left < -1) problems.push(`${label(el)} starts left of the screen`);
      if (r.right > innerWidth + 1 && !el.closest('.ba-filters, .k-msgs')) problems.push(`${label(el)} reaches past the right edge (${Math.round(r.right)} > ${innerWidth})`);
    }
    // The calibration screen is one screen with no scrolling: everything in its panel has to fit under the picture, and the
    // picture has to stay big enough to stand in front of.
    for (const { el, r } of rects) if (el.closest('.cal') && r.bottom > innerHeight + 1) problems.push(`${label(el)} reaches past the bottom edge (${Math.round(r.bottom)} > ${innerHeight})`);
    const cal = document.querySelector('.cal');
    if (cal) {
      const panel = cal.querySelector('.panel');
      const view = cal.querySelector('.view');
      if (panel && panel.scrollHeight > panel.clientHeight + 1) problems.push('calibration panel: its content is taller than the panel');
      if (view) {
        const vr = view.getBoundingClientRect();
        if (vr.width < 160 || vr.height < 160) problems.push(`calibration view is only ${Math.round(vr.width)}x${Math.round(vr.height)}`);
      }
    }
    const inView = rects.filter(({ r }) => r.bottom > 0 && r.top < innerHeight);
    for (let i = 0; i < inView.length; i++) {
      for (let j = i + 1; j < inView.length; j++) {
        const a = inView[i] as { el: Element; r: DOMRect };
        const b = inView[j] as { el: Element; r: DOMRect };
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        // Fixed bars sit over the page by design; what scrolls under them is checked at the end of the page below.
        if (a.el.closest('.ba-tabbar, .ba-topbar, .k-close, .k-actionbar') || b.el.closest('.ba-tabbar, .ba-topbar, .k-close, .k-actionbar')) continue;
        const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (w > 2 && h > 2) problems.push(`${label(a.el)} overlaps ${label(b.el)}`);
      }
    }
    // At the end of the page nothing may stay under the fixed bar.
    const bar = document.querySelector('.ba-tabbar');
    if (bar && getComputedStyle(bar).display !== 'none') {
      window.scrollTo(0, document.documentElement.scrollHeight);
      const bt = bar.getBoundingClientRect();
      const last = [...document.querySelectorAll('main a[href], main button, footer a[href]')].filter((el) => !el.closest('[hidden]') && !folded(el)).map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0);
      for (const r of last) {
        const sideRail = bt.width < bt.height;
        if (!sideRail && r.bottom > bt.top + 1 && r.top < bt.bottom) problems.push('content stays under the tab bar at the end of the page');
        if (sideRail && r.left < bt.right - 1 && r.right > bt.left) problems.push('content stays under the side rail');
      }
      // A phone on its side has the navigation as a rail down the left of the screen: no words may start under it, wherever on the
      // page they are (the notice of a trial, above the page, was drawn from the edge of the screen and its first words were hidden).
      if (bt.width < bt.height) {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const under = new Set<Element>();
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const el = node.parentElement;
          if (!el || under.has(el) || !(node.textContent ?? '').trim()) continue;
          if (el.closest('.ba-tabbar, .ba-skip, dialog, [hidden], [inert], .ba-visually-hidden, script, style, noscript, template') || !vis(el)) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const r of range.getClientRects()) {
            if (r.width < 1 || r.height < 1) continue;
            if (r.left < bt.right - 1 && r.right > bt.left + 1) { under.add(el); problems.push(`${label(el)} starts under the side rail`); break; }
          }
        }
      }
      window.scrollTo(0, 0);
    }
    return problems;
  });
}
