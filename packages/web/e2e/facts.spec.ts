// Two lists share the class k-facts: the row of pills on a game page (a ul: what the game measures, in design/ui-kit/pages.css) and the list of
// numbers on the profile screen (a dl, in social/social.css). The profile's rules once hit the pills too, and they stood in a column. At the ten
// screens: the pills of a game page wrap in a row (two of them side by side wherever they fit side by side, none cut off, none spilling out),
// and the profile's list is still a grid of rows with the name on the left and the number on the right.
import { expect, test, type Page } from '@playwright/test';
import { BREAKPOINTS } from '../../core/ui/layout.ts';
import { checkPage } from '../tools/layout-check.ts';
import { collectErrors, withHooks } from './support/helpers.ts';
import { WEB_DEV_URL } from './support/ports.ts';

/** The games with the most and the longest pills (Summit Climb's and Pose Wall's body areas wrap onto two lines in a narrow half page), and one with the shortest. */
const GAMES = ['summit-climb', 'pose-wall', 'squat-flap'] as const;

/** What the pills of the page are doing, read in the page. */
async function pillsOf(page: Page): Promise<{ display: string; wrap: string; margin: string; rects: { x: number; y: number; w: number; h: number; text: string }[]; width: number; gap: number }> {
  return page.locator('ul.k-facts').evaluate((ul: HTMLElement) => {
    const cs = getComputedStyle(ul);
    return {
      display: cs.display, wrap: cs.flexWrap, margin: cs.margin, width: ul.clientWidth, gap: Number.parseFloat(cs.columnGap) || 0,
      rects: [...ul.querySelectorAll('li')].map((li) => { const r = li.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, text: (li.textContent ?? '').trim() }; }),
    };
  });
}

for (const bp of BREAKPOINTS) {
  test(`${bp.label}: the pills of a game page wrap in a row, and the facts of the profile are still rows of a grid`, async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ viewport: { width: bp.w, height: bp.h }, locale: 'en-US', deviceScaleFactor: 1, hasTouch: bp.w < 1000 });
    try {
      const page = await context.newPage();
      const errors = collectErrors(page);
      await withHooks(page, { timeScale: 40, roundSeconds: 6, forceDemo: true, keyboard: true });
      const found: string[] = [];
      for (const game of GAMES) {
        await page.goto(`${WEB_DEV_URL}/games/${game}/`, { waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready);
        const p = await pillsOf(page);
        expect(p.rects.length, `${game}: the pills`).toBeGreaterThan(1);
        if (p.display !== 'flex' || p.wrap !== 'wrap') found.push(`${game}: the pills are display ${p.display}, flex-wrap ${p.wrap} (a wrapping row is wanted)`);
        if (p.margin !== '12px 0px 0px') found.push(`${game}: the row of pills has margin ${p.margin}, 12px above it is wanted`);
        // two pills that fit side by side stand side by side: the second begins on the line of the first when the row is wide enough for both
        const [a, b] = p.rects;
        if (a && b && p.width >= a.w + p.gap + b.w + 1 && Math.abs(a.y - b.y) > 2) found.push(`${game}: "${a.text}" and "${b.text}" fit side by side in ${Math.round(p.width)} px and stand one over the other`);
        // not one pill per line when the row could hold more than one line of them: a column is a row count equal to the pills with room for two
        const rows = new Set(p.rects.map((r) => Math.round(r.y / 4))).size;
        const narrowest = Math.min(...p.rects.map((r) => r.w));
        if (rows === p.rects.length && p.width >= 2 * narrowest + p.gap + 1 && p.rects.length > 2) found.push(`${game}: the ${p.rects.length} pills stand in a column (${rows} lines) in ${Math.round(p.width)} px`);
        for (const f of await checkPage(page)) found.push(`${game}: ${f}`);
      }
      // the profile screen: a grid of rows, the name on the left and the number on the right, with the ten pixels between them it always had
      await page.goto(`${WEB_DEV_URL}/friends/?view=profile&social=1`, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      const dl = await page.locator('dl.k-facts').first().evaluate((el: HTMLElement) => {
        const cs = getComputedStyle(el);
        const rows = [...el.children].map((r) => { const b = r.getBoundingClientRect(); return { y: b.y, h: b.height, dt: (r.querySelector('dt')?.getBoundingClientRect().x ?? 0), dd: (r.querySelector('dd')?.getBoundingClientRect().right ?? 0), right: b.right }; });
        return { display: cs.display, rowGap: cs.rowGap, marginBottom: cs.marginBottom, rows };
      });
      if (dl.display !== 'grid') found.push(`profile: the facts are display ${dl.display}, a grid is wanted`);
      if (dl.rowGap !== '10px') found.push(`profile: the facts have a gap of ${dl.rowGap} between rows, 10px is wanted`);
      if (dl.marginBottom !== '0px') found.push(`profile: the facts have a bottom margin of ${dl.marginBottom}`);
      expect(dl.rows.length, 'the rows of the profile facts').toBeGreaterThan(1);
      for (let i = 1; i < dl.rows.length; i++) {
        const prev = dl.rows[i - 1]!;
        const row = dl.rows[i]!;
        if (row.y < prev.y + prev.h - 0.5) found.push(`profile: row ${i + 1} of the facts begins over row ${i}`);
      }
      for (const r of dl.rows) if (r.dd > r.right + 1) found.push('profile: a number leaves the right edge of its row');
      for (const f of await checkPage(page)) found.push(`profile: ${f}`);
      expect(found, found.join('\n')).toEqual([]);
      expect(errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
    } finally {
      await context.close();
    }
  });
}
