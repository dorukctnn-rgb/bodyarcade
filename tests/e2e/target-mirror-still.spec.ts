// The camera mirror of the three mirror games (Pad Work, Star Catch, Reaction Tag) stands still: its box does not depend on whether
// the command plate or the reason strip is showing, or on the words in them. At the final test the mirror grew and shrank by about
// 3 % with every command (Pad Work at 1280 x 800: 885 x 664 at x 197 without a command, 859 x 644 at x 211 with one), a visible pulse.
// Each case is read in one synchronous call (the running game cannot change a word in between), after the real HUD has laid itself
// out on the shell's stylesheet and told the real 2D kit; the kit's mirror rectangle and the box the HUD gave the camera element
// must both be the same box in every case, at the ten screens of the plan, for one player and (where the screen allows it) for two,
// and no plate may lie over the picture. The words are the games' own, in the five languages (every command and every reason, alone and the
// longest of each together), and two strings far longer than any game has (they wrap and shrink: the picture must still stand still).
// BA_STILL_LOG=<file> appends every box that was read, one line each, for looking at.
import { appendFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { DEV_URL } from './support/ports.ts';
import { format, TARGET_STRINGS } from '../../packages/games/target/strings.ts';
import type * as Harness from './pages/target-games-harness.ts';

type H = Pick<typeof Harness, 'start' | 'stop' | 'probePlates'>;
type Box = { x: number; y: number; w: number; h: number };
type Row = Harness.PlateProbe;

const GAMES = ['star-catch', 'pad-work', 'reaction-tag'] as const;
const SCREENS: [string, number, number][] = [
  ['phone-360', 360, 780], ['phone-390', 390, 844], ['phone-412', 412, 915], ['phone-land-844', 844, 390], ['phone-land-915', 915, 412],
  ['tablet-768', 768, 1024], ['tablet-land-1024', 1024, 768], ['laptop-1280', 1280, 800], ['laptop-1440', 1440, 900], ['tv-1920', 1920, 1080],
];
/** The screens the split HUD of two players fits (the ones the "2 players" badge is shown on). */
const TWO = ['tablet-land-1024', 'laptop-1280', 'laptop-1440', 'tv-1920'];

/** Every command and every reason the three games have, in the five languages, and the longest command with the longest reason. */
const COMMANDS = [...new Set(Object.values(TARGET_STRINGS).flatMap((t) => ['tap_green', 'slip_left', 'slip_right', 'duck', 'rest', 'round', 'combo'].map((k) => format(t[k] ?? '', { n: 3, seq: '1-2-3' })).filter(Boolean)))];
const REASONS = [...new Set(Object.values(TARGET_STRINGS).flatMap((t) => Object.entries(t).filter(([k]) => k.startsWith('reason.')).map(([, v]) => v)))];
const longest = (list: string[]): string => list.reduce((a, b) => (b.length > a.length ? b : a), '');
/** Far longer than any game has: they wrap and shrink, and may reach over the picture, but the picture must not move. */
const STRESS = [
  { prompt: 'Both hands to the pads, now!', hint: '' },
  { prompt: 'Sol elinle yıldıza dokun, hemen!', hint: 'Your right hand was too low for that pad, lift it up to the line next time' },
];
const CASES = [
  { prompt: '', hint: '' },
  ...COMMANDS.map((prompt) => ({ prompt, hint: '' })),
  ...REASONS.map((hint) => ({ prompt: '', hint })),
  { prompt: longest(COMMANDS), hint: longest(REASONS) },
  ...STRESS,
];
/** The picture must stand still in these, but a plate may reach over it: far longer than the games' words, or (the Spanish "Esquiva izquierda", 17 letters) a command of more than the 14 the room is kept for. */
const isStress = (c: { prompt: string; hint: string }): boolean => c.prompt.length > 14 || STRESS.some((x) => x.prompt === c.prompt && x.hint === c.hint);

const num = (n: number): number => Math.round(n * 10) / 10;
const key = (b: Box): string => `${num(b.x)},${num(b.y)} ${num(b.w)}x${num(b.h)}`;
/** The camera element is the kit's mirror to a pixel (the HUD rounds the box it hands the element; the kit fits the camera's own aspect inside it). */
const near = (a: Box, b: Box): boolean => Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1 && Math.abs(a.w - b.w) <= 1 && Math.abs(a.h - b.h) <= 1;
const over = (a: Box, b: Box): boolean => a.x < b.x + b.w - 0.5 && a.x + a.w > b.x + 0.5 && a.y < b.y + b.h - 0.5 && a.y + a.h > b.y + 0.5;

async function probe(page: Page, label: string, w: number, h: number, game: string, players: 1 | 2): Promise<Row[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.setViewportSize({ width: w, height: h });
  await page.goto(`${DEV_URL}/tests/e2e/pages/target-games.html`);
  await page.waitForFunction(() => (window as unknown as { harnessReady?: boolean }).harnessReady === true, undefined, { timeout: 60_000 });
  await page.evaluate(([g, p]) => (window as unknown as { tg: H }).tg.start({ game: g as 'pad-work', players: p as 1 | 2, bot: 'perfect', level: 'normal', seed: 4, seconds: 60, rounds: 1, speed: 1 }), [game, players] as const);
  const out = (await page.evaluate((cases) => (window as unknown as { tg: H }).tg.probePlates(cases), CASES)) as Row[] | null;
  expect(out, 'the harness has a running game').not.toBeNull();
  await page.evaluate(() => (window as unknown as { tg: H }).tg.stop());
  expect(errors).toEqual([]);
  const log = process.env['BA_STILL_LOG'];
  if (log) for (const r of out!) appendFileSync(log, `${label} ${game} ${players}p command "${r.prompt}" reason "${r.hint}": mirror ${key(r.mirror)} host ${r.host ? key(r.host) : '-'} play ${key(r.play)} plates ${Object.entries(r.plates).map(([k, b]) => `${k} ${key(b)}`).join(' | ')}\n`);
  return out!;
}

/** Everything wrong with the rows, in words (empty when the mirror stood still and nothing lay over it). */
function whatIsWrong(rows: Row[]): string[] {
  const still = rows[0]!.mirror;
  const wrong: string[] = [];
  for (const row of rows) {
    const what = `command "${row.prompt}", reason "${row.hint}"`;
    if (key(row.mirror) !== key(still)) wrong.push(`mirror ${key(row.mirror)} with ${what}, ${key(still)} with neither`);
    if (isStress(row)) continue;
    if (row.host && !near(row.host, row.mirror)) wrong.push(`camera element ${key(row.host)} is not the mirror ${key(row.mirror)} with ${what}`);
    if (row.problems.length) wrong.push(`HUD problems with ${what}: ${row.problems.join('; ')}`);
    for (const [plate, b] of Object.entries(row.plates)) {
      if (plate !== 'pip' && over(b, row.mirror)) wrong.push(`${plate} ${key(b)} lies over the mirror ${key(row.mirror)} with ${what}`);
    }
  }
  return wrong;
}

for (const game of GAMES) {
  for (const [name, w, h] of SCREENS) {
    test(`${game} at ${name} (${w}x${h}): the mirror box is the same with and without the command plate and the reason strip`, async ({ page }) => {
      expect(whatIsWrong(await probe(page, name, w, h, game, 1))).toEqual([]);
    });
  }
}

for (const game of GAMES) {
  for (const [name, w, h] of SCREENS.filter(([n]) => TWO.includes(n))) {
    test(`${game} with two players at ${name} (${w}x${h}): the mirror box is the same with and without the command plate and the reason strips`, async ({ page }) => {
      expect(whatIsWrong(await probe(page, name, w, h, game, 2))).toEqual([]);
    });
  }
}
