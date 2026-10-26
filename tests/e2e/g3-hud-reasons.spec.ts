// Every line the reason strip of the four games of builder G3 can say (the cues of games/_shared/cues.ts and the lines of Pose Wall's
// own), in the five languages, on every screen of design/LAYOUT.md, in both bottom corners of the self view, one player and two. The
// strip is the narrowest plate of the HUD, and the shell measures it from where the last layout left it: a box placed with `left` has only
// the room that is left of it, so after the shortest reason of all a longer one is measured in a narrower strip than its row has. That
// is the worst case, and each line is tried right after the narrowest line of its language (as the player meets it: a short reason, then
// a longer one a moment later). What has to hold: no text spills out of the strip, the strip stays in its row beside the self view (the
// scene kit lays the play area out for that row; a lifted strip would sit over it), and a reason takes two lines at most.
//   BA_G3_HUD_LANGS=en,tr  limits the languages;  npx playwright test tests/e2e/g3-hud-reasons.spec.ts --workers=1
import { expect, test } from '@playwright/test';
import { DEV_URL } from './support/ports.ts';
import { PW_STRINGS } from '../../packages/games/gatepose/strings.ts';
import { FJ_STRINGS } from '../../packages/games/strength/strings.ts';

test.skip(!!process.env['CI'], 'a browser measurement of the real HUD: the local release gate, not the CI runners');

const LANGS = (process.env['BA_G3_HUD_LANGS'] ?? 'en,tr,de,es,fr').split(',');
const SOLO: Record<string, readonly [number, number]> = {
  '360x780': [360, 780], '390x844': [390, 844], '412x915': [412, 915], '844x390': [844, 390], '915x412': [915, 412],
  '768x1024': [768, 1024], '1024x768': [1024, 768], '1280x800': [1280, 800], '1440x900': [1440, 900], '1920x1080': [1920, 1080],
};
const DUO: Record<string, readonly [number, number]> = { '1024x768': [1024, 768], '1280x800': [1280, 800], '1440x900': [1440, 900], '1920x1080': [1920, 1080] };

/** The lines a game can put on the strip: its cues, and the lines of its own (Pose Wall's limbs, the fit of a wall and the team bonus). */
const stripKeys = (tables: Record<string, Record<string, string>>): string[] => Object.keys(tables['en'] as Record<string, string>).filter((k) => /^(cue\.|pw\.(off\.|fit$|team$))/.test(k));
const GAMES = [
  { id: 'firework-jacks', keys: stripKeys(FJ_STRINGS as never) },
  { id: 'pose-wall', keys: stripKeys(PW_STRINGS as never) },
];
const VARS = { pct: 100, bonus: 25 };

interface Probe { bad: string[]; tried: number; narrowest: string }

for (const g of GAMES) {
  for (const lang of LANGS) {
    test(`one player: ${g.id} ${lang}`, async ({ page }) => {
      test.setTimeout(240_000);
      const bad: string[] = [];
      let tried = 0;
      await page.goto(`${DEV_URL}/tests/e2e/pages/g3-game.html?game=${g.id}&mode=solo&lang=${lang}&tile=1`);
      await page.waitForFunction(() => (window as unknown as { harnessReady?: boolean }).harnessReady === true);
      for (const [screen, [w, h]] of Object.entries(SOLO)) {
        await page.setViewportSize({ width: w, height: h });
        for (const corner of ['bottom-left', 'bottom-right'] as const) {
          const r = await page.evaluate(([keys, vars, corner]) => {
            type Hud = { setPhase(p: string): void; set(s: string, v: string): void; setPipCorner(c: string): void; relayout(): void; problems(): string[]; layoutInfo(): { solo?: { rects: { reason: { row: string } } } } | null };
            const ba = (window as unknown as { ba: { hud: Hud; say(k: string, v?: Record<string, number>): string } }).ba;
            const hud = ba.hud;
            hud.setPhase('play');
            hud.set('prompt', 'Jack');
            hud.setPipCorner(corner as string);
            const plate = document.querySelector<HTMLElement>('[data-hud="reason"]') as HTMLElement;
            const span = plate.querySelector('span') as HTMLElement;
            const lines = (): number => {
              const clamp = span.style.webkitLineClamp;
              span.style.webkitLineClamp = 'unset';
              const lh = Number.parseFloat(getComputedStyle(span).lineHeight) || 1;
              const n = Math.round(span.getBoundingClientRect().height / lh);
              span.style.webkitLineClamp = clamp;
              return n;
            };
            const text = (k: string): string => ba.say(k, vars as Record<string, number>);
            // the narrowest line of this language on this screen: the plate that leaves its `left` the furthest to the right
            let narrowest = '';
            let min = Infinity;
            for (const k of keys as string[]) {
              hud.set('hint', text(k));
              hud.relayout();
              hud.relayout();
              const wd = plate.getBoundingClientRect().width;
              if (wd < min) { min = wd; narrowest = text(k); }
            }
            const bad: string[] = [];
            for (const k of keys as string[]) {
              hud.set('hint', narrowest);
              hud.relayout();
              hud.relayout();
              hud.set('hint', text(k));
              hud.relayout(); // the first layout after the change: what the player sees first
              const row = hud.layoutInfo()?.solo?.rects.reason.row;
              const first = lines();
              const problems = hud.problems(); // the layout settled (it lays out again, from where the first one put the strip)
              const settled = hud.layoutInfo()?.solo?.rects.reason.row;
              const second = lines();
              const what = `"${text(k)}" (${k}) after "${narrowest}"`;
              if (problems.length) bad.push(`${what}: ${problems.join(', ')}`);
              if (row !== 'bottom' || settled !== 'bottom') bad.push(`${what}: the strip went to the ${row} row, then the ${settled} row`);
              if (first > 2 || second > 2) bad.push(`${what}: ${first} lines, then ${second}`);
            }
            return { bad, tried: (keys as string[]).length, narrowest } as Probe;
          }, [g.keys, VARS, corner] as const);
          tried += r.tried;
          for (const b of r.bad) bad.push(`${lang} ${screen} ${corner}: ${b}`);
        }
      }
      expect(tried, 'it tried the lines').toBeGreaterThan(20 * 20);
      expect(bad).toEqual([]);
    });
  }
}

for (const lang of LANGS) {
  test(`two players: firework-jacks ${lang}`, async ({ page }) => {
    test.setTimeout(240_000);
    const bad: string[] = [];
    await page.goto(`${DEV_URL}/tests/e2e/pages/g3-game.html?game=firework-jacks&mode=local2&lang=${lang}&tile=1`);
    await page.waitForFunction(() => (window as unknown as { harnessReady?: boolean }).harnessReady === true);
    for (const [screen, [w, h]] of Object.entries(DUO)) {
      await page.setViewportSize({ width: w, height: h });
      const r = await page.evaluate(([keys, vars]) => {
        type Hud = { setPhase(p: string): void; set(s: string, v: string): void; setPlayer(n: number, s: string, v: string): void; relayout(): void; problems(): string[] };
        const ba = (window as unknown as { ba: { hud: Hud; say(k: string, v?: Record<string, number>): string } }).ba;
        const hud = ba.hud;
        hud.setPhase('play');
        hud.set('prompt', 'Jack');
        const text = (k: string): string => ba.say(k, vars as Record<string, number>);
        const plates = ['reasonP1', 'reasonP2'].map((n) => document.querySelector<HTMLElement>(`[data-hud="${n}"]`) as HTMLElement);
        let narrowest = '';
        let min = Infinity;
        for (const k of keys as string[]) {
          hud.setPlayer(2, 'hint', text(k));
          hud.relayout();
          hud.relayout();
          const wd = (plates[1] as HTMLElement).getBoundingClientRect().width;
          if (wd < min) { min = wd; narrowest = text(k); }
        }
        const bad: string[] = [];
        for (const k of keys as string[]) {
          for (const n of [1, 2]) { hud.setPlayer(n, 'hint', narrowest); }
          hud.relayout();
          hud.relayout();
          for (const n of [1, 2]) { hud.setPlayer(n, 'hint', text(k)); }
          const problems = hud.problems();
          if (problems.length) bad.push(`"${text(k)}" (${k}) after "${narrowest}": ${problems.join(', ')}`);
        }
        return bad;
      }, [GAMES[0]?.keys ?? [], VARS] as const);
      for (const b of r) bad.push(`${lang} ${screen}: ${b}`);
    }
    expect(bad).toEqual([]);
  });
}
