// The words of the HUD in every language, on all ten sizes: every reason a game can say ("Squat lower", "Feet not wide enough")
// fits its plate in two lines at most, every command a game puts on the screen fits at its size or loses its glyph or wraps,
// the score, timer, lives and combo plates never touch, and nothing spills out of a plate. The self view is tried in each corner
// and away, in a mirror game and, where the screen allows it, with two players. A language added later is checked the day its
// table has a "miss." or "prompt." line.
import { test, expect } from '@playwright/test';
import { BREAKPOINTS, duoAvailable, type HudMode, type PipPlacement } from '../../core/ui/layout.ts';
import { LANGS } from '../../core/ui/i18n/index.ts';
import { WEB_DEV_URL } from './support/ports.ts';

interface Config { mode: HudMode; corner: PipPlacement; duo: boolean }

const SOLO: Config[] = [
  { mode: 'scene', corner: 'bottom-left', duo: false },
  { mode: 'scene', corner: 'bottom-right', duo: false },
  { mode: 'scene', corner: 'top-left', duo: false },
  { mode: 'scene', corner: 'top-right', duo: false },
  { mode: 'scene', corner: 'hidden', duo: false },
  { mode: 'mirror', corner: 'hidden', duo: false },
];
const DUO: Config = { mode: 'scene', corner: 'bottom-right', duo: true };

for (const bp of BREAKPOINTS) {
  test(`${bp.label}: every reason and command a game can show fits, in every language`, async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: bp.w, height: bp.h });
    await page.goto(`${WEB_DEV_URL}/e2e/pages/hud.html`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const configs = duoAvailable({ w: bp.w, h: bp.h }) ? [...SOLO, DUO] : SOLO;
    const found: string[] = [];
    for (const lang of LANGS) {
      // every language says every reason and command: the draft languages fall back to English for the lines they lack
      const [reasons, commands] = await page.evaluate((l) => [window.__HUD__.reasons(l).length, window.__HUD__.commands(l).length] as const, lang);
      expect(reasons, `${lang} has reasons`).toBeGreaterThan(40);
      expect(commands, `${lang} has commands`).toBeGreaterThan(10);
      for (const c of configs) {
        const bad = await page.evaluate((x) => window.__HUD__.check(x), { lang, ...c });
        for (const b of bad) found.push(`${lang} ${c.duo ? 'duo' : `${c.mode} ${c.corner}`} ${b.kind} "${b.text}": ${b.problems.join('; ')}`);
      }
    }
    expect(found, found.join('\n')).toEqual([]);
  });
}
