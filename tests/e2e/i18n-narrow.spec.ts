// German, Spanish and French are the longest words of the site's languages after Turkish. On the narrowest phones the new
// sections (the progress coach with every tab, the form coach before and while the camera is on) must still fit: nothing
// sideways, no control pushed past the edge, no text cut inside a button, a tab or a chip. 360 px is the common small Android
// phone; 320 px is the smallest one still sold. No camera, no network: the same harness pages the other specs use.
import { expect, test, type Page } from '@playwright/test';
import { DEV_URL } from './support/ports.ts';

const LANGS = ['de', 'es', 'fr'] as const;
const WIDTHS = [360, 320] as const;

/** Everything that does not fit, as readable lines (empty: the page fits). */
async function misfits(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const vw = document.documentElement.clientWidth;
    const over = document.documentElement.scrollWidth - vw;
    if (over > 1) out.push(`page scrolls sideways by ${over}px`);
    const controls = document.querySelectorAll('button, [role=tab], a.ba-btn, [data-tab], .gc-chip, .fc-chip, select, label, summary');
    for (const el of controls) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const label = `${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40)}"`;
      // a strip that scrolls on purpose (the tabs of the progress coach) may hold controls past the edge
      let scroller = false;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if ((o === 'auto' || o === 'scroll') && p.scrollWidth > p.clientWidth + 1) { scroller = true; break; }
      }
      if (!scroller && (r.right > vw + 1 || r.left < -1)) out.push(`${label} sits outside the screen (${Math.round(r.left)} to ${Math.round(r.right)} of ${vw})`);
      const style = getComputedStyle(el);
      const clips = style.overflowX !== 'visible' && el.scrollWidth > el.clientWidth + 1 && !(el instanceof HTMLSelectElement);
      if (clips && style.textOverflow !== 'ellipsis' && style.overflowX !== 'auto' && style.overflowX !== 'scroll') out.push(`${label} cuts its text (${el.scrollWidth} in ${el.clientWidth})`);
    }
    return out;
  });
}

for (const lang of LANGS) {
  for (const w of WIDTHS) {
    test(`${lang} ${w}: the progress coach fits on every tab`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: w, height: 780 });
      await page.goto(`${DEV_URL}/tests/e2e/pages/growth.html?lang=${lang}&profile=narrow-${lang}-${w}&play=1&plan=pro#home`);
      await page.waitForFunction(() => (window as unknown as { harnessReady?: boolean }).harnessReady === true);
      const tabs = await page.locator('[data-tab]').evaluateAll((els) => els.map((e) => e.getAttribute('data-tab') ?? ''));
      expect(tabs.length, `${lang}: the tabs`).toBeGreaterThanOrEqual(3);
      const found: string[] = [];
      for (const tab of tabs) {
        await page.locator(`[data-tab="${tab}"]`).first().click();
        await page.waitForTimeout(250);
        for (const m of await misfits(page)) found.push(`${lang} ${w} ${tab}: ${m}`);
        const text = await page.locator('main').first().innerText();
        if (/\{[a-z]+\}|undefined|NaN/.test(text)) found.push(`${lang} ${w} ${tab}: a placeholder or undefined is on the page`);
      }
      expect(found, found.join('\n')).toEqual([]);
    });

    test(`${lang} ${w}: the form coach fits before the camera is on, for the moves with the longest names`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: w, height: 780 });
      const found: string[] = [];
      for (const move of ['squat', 'singleLegRdl', 'overheadTricepsExt', 'dbBulgarian', 'inclinePushUp', 'hipFlexorStretch']) {
        await page.goto(`${DEV_URL}/tests/e2e/pages/form-coach.html?move=${move}&lang=${lang}`);
        await page.locator('main.fc').waitFor({ timeout: 30_000 });
        await page.waitForTimeout(300);
        for (const m of await misfits(page)) found.push(`${lang} ${w} ${move}: ${m}`);
      }
      expect(found, found.join('\n')).toEqual([]);
    });
  }
}
