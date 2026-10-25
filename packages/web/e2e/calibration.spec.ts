// The made-up person of the framing screen (the practice session has no camera: the guide draws one, to the scale of its own outline).
// Measured in the page at the ten sizes of the layout rule and at the four tablet sizes of the store pictures (a tablet is held sideways:
// 960 x 600, 1280 x 800, and the pictures at 1920 x 1080 and 2560 x 1440): the figure stands inside its dashed outline, a little smaller,
// in the middle of it, and the pictogram of the small self view is not on this screen. It was larger than its outline on a tablet held sideways.
import { expect, test, type Page } from '@playwright/test';
import { BREAKPOINTS } from '../../core/ui/layout.ts';
import { openScenario, type Scenario } from '../tools/scenarios.ts';
import { WEB_DEV_URL } from './support/ports.ts';

const SIZES = [...BREAKPOINTS.map((b) => ({ id: b.id, w: b.w, h: b.h })), { id: 'play-tablet-7', w: 960, h: 600 }, { id: 'play-tablet-10', w: 1280, h: 800 }, { id: 'tablet-1920', w: 1920, h: 1080 }, { id: 'tablet-2560', w: 2560, h: 1440 }];

interface Box { l: number; t: number; r: number; b: number }

/** The outline (the dashed shapes of the guide) and the made-up person, as boxes in the page, and the pictogram of the self view if it shows. */
async function measure(page: Page): Promise<{ outline: Box; figure: Box; pictogram: boolean; clipped: boolean; view: { w: number; h: number } }> {
  return page.evaluate(() => {
    const union = (els: Element[]): Box => {
      let u: Box | null = null;
      for (const e of els) {
        const r = e.getBoundingClientRect();
        u = u ? { l: Math.min(u.l, r.left), t: Math.min(u.t, r.top), r: Math.max(u.r, r.right), b: Math.max(u.b, r.bottom) } : { l: r.left, t: r.top, r: r.right, b: r.bottom };
      }
      return u ?? { l: 0, t: 0, r: 0, b: 0 };
    };
    const view = document.querySelector('[data-cal-view]') as HTMLElement;
    const dashed = [...view.querySelectorAll('[data-cal-guide] svg path, [data-cal-guide] svg ellipse')].filter((e) => e.getAttribute('stroke-dasharray'));
    const figure = [...view.querySelectorAll('[data-standin-body], [data-standin-head]')];
    const pictogram = [...view.querySelectorAll('.ba-demo-self svg')].some((s) => getComputedStyle(s).display !== 'none');
    // the upper body and the desk are cut off at a line: the boxes of their paths still hold the whole figure, but only the part above the line is seen
    const clipped = !!view.querySelector('[data-cal-guide] clipPath');
    return { outline: union(dashed), figure: union(figure), pictogram, clipped, view: { w: view.clientWidth, h: view.clientHeight } };
  });
}

function checkFigure(label: string, m: { outline: Box; figure: Box; pictogram: boolean; clipped: boolean }): string[] {
  const o = m.outline, f = m.figure;
  const ow = o.r - o.l, oh = o.b - o.t, fw = f.r - f.l, fh = f.b - f.t;
  const found: string[] = [];
  if (ow < 20 || oh < 60) found.push(`${label}: no outline measured (${ow} x ${oh})`);
  if (fw < 10 || fh < 30) found.push(`${label}: no made-up person measured (${fw} x ${fh})`);
  const tol = 1.5;
  if (f.l < o.l - tol || f.r > o.r + tol || f.t < o.t - tol || f.b > o.b + tol) found.push(`${label}: the figure leaves its outline (figure ${Math.round(f.l)},${Math.round(f.t)} to ${Math.round(f.r)},${Math.round(f.b)}; outline ${Math.round(o.l)},${Math.round(o.t)} to ${Math.round(o.r)},${Math.round(o.b)})`);
  if (fw / ow > 1) found.push(`${label}: the figure is wider than its outline (${Math.round((fw / ow) * 100)}%)`);
  if (fh / oh > 0.97 || fh / oh < 0.9) found.push(`${label}: the figure is ${Math.round((fh / oh) * 100)}% of the height of its outline, not about 94%`);
  if (Math.abs((f.l + f.r) / 2 - (o.l + o.r) / 2) > 2) found.push(`${label}: the figure is not in the middle of its outline`);
  // the same room above it as under it, where the outline is whole (a cut-off one has its feet below the line: the room above is all there is to compare)
  if (!m.clipped && Math.abs((f.t - o.t) - (o.b - f.b)) > 3) found.push(`${label}: the room above the figure (${Math.round(f.t - o.t)}) and the room under it (${Math.round(o.b - f.b)}) differ`);
  if (m.clipped && f.t - o.t < 1) found.push(`${label}: the figure of a cut-off outline starts as high as the outline (${Math.round(f.t - o.t)})`);
  if (m.pictogram) found.push(`${label}: the pictogram of the small self view is on the framing screen too`);
  return found;
}

test('the made-up person is inside its outline, a little smaller and in the middle, at the ten sizes and on the tablets', async ({ browser }) => {
  test.setTimeout(420_000);
  const found: string[] = [];
  for (const s of SIZES) {
    const { page, context, errors } = await openScenario(browser, WEB_DEV_URL, 'calibrate', { w: s.w, h: s.h });
    try {
      found.push(...checkFigure(`${s.id} ${s.w}x${s.h}`, await measure(page)));
      for (const e of errors) found.push(`${s.id}: console ${e}`);
    } finally {
      await context.close();
    }
  }
  expect(found, found.join('\n')).toEqual([]);
});

test('the same on the screens of a game that lifts the hands, and of a player at a desk', async ({ browser }) => {
  test.setTimeout(240_000);
  const found: string[] = [];
  for (const scenario of ['calibrate-headroom', 'calibrate-desk'] as Scenario[]) {
    for (const s of [{ id: 'phone', w: 390, h: 844 }, { id: 'laptop', w: 1280, h: 800 }, { id: 'tv', w: 1920, h: 1080 }]) {
      const { page, context } = await openScenario(browser, WEB_DEV_URL, scenario, { w: s.w, h: s.h });
      try {
        found.push(...checkFigure(`${scenario} ${s.id}`, await measure(page)));
      } finally {
        await context.close();
      }
    }
  }
  expect(found, found.join('\n')).toEqual([]);
});
