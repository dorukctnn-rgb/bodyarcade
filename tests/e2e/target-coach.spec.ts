// Pad Work's coach in a real headless browser: the real audio kit decodes the real mp3 clips (their lengths come out as made, so the gapless
// header works), each call the game makes is played through the kit on the game clock and shown as a caption on the real canvas, in the
// language of the app (English and Turkish clips; German, Spanish and French hear English and read their own words); a muted app plays
// nothing and shows everything; quiet mode is softer; no console error in any of them.
// The sound of the clips is not heard here (the browser is muted and nobody listens): what is checked is what the game asked the kit to
// play, when, and that the kit accepted it.
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { DEV_URL } from './support/ports.ts';
import type * as Harness from './pages/target-games-harness.ts';

type H = Pick<typeof Harness, 'start' | 'stop' | 'state'>;
type State = NonNullable<Awaited<ReturnType<H['state']>>>;

interface ClipsFile { clips: Record<string, Record<string, { text: string; ms: number }>> }
const CLIPS = JSON.parse(readFileSync(new URL('../../packages/games/pad-work/voice/clips.json', import.meta.url), 'utf8')) as ClipsFile;

const CLIP_GAIN = 0.9, QUIET_GAIN = 0.5;
const errorsOf = (page: Page): string[] => (page as unknown as { errors: string[] }).errors;

async function open(page: Page): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/willReadFrequently/.test(m.text())) errors.push(`console ${m.type()}: ${m.text()}`); });
  (page as unknown as { errors: string[] }).errors = errors;
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${DEV_URL}/tests/e2e/pages/target-games.html`);
  await page.waitForFunction(() => (window as unknown as { harnessReady?: boolean }).harnessReady === true, undefined, { timeout: 60_000 });
}

function call<K extends keyof H>(page: Page, fn: K, ...arg: Parameters<H[K]>): Promise<Awaited<ReturnType<H[K]>>> {
  return page.evaluate(async ([name, a]) => {
    const tg = (window as unknown as { tg: Record<string, (...x: unknown[]) => unknown> }).tg;
    return await tg[name as string]!(...(a as unknown[]));
  }, [fn as string, arg] as const) as Promise<Awaited<ReturnType<H[K]>>>;
}

async function playFor(page: Page, ms: number, timeout = 60_000): Promise<State> {
  await page.waitForFunction((t) => {
    const s = (window as unknown as { tg: { state(): { t: number; running: boolean } | null } }).tg.state();
    return !!s && (s.t >= t || !s.running);
  }, ms, { timeout, polling: 100 });
  const s = await call(page, 'state');
  expect(s).not.toBeNull();
  return s as State;
}

type Args = Omit<Parameters<H['start']>[0], 'game'>;
const START: Args = { bot: 'perfect', level: 'hard', seed: 4, seconds: 60, rounds: 1 };
const run = async (page: Page, o: Args, ms: number): Promise<State> => {
  await open(page);
  await call(page, 'start', { ...START, ...o, game: 'pad-work' });
  return playFor(page, ms);
};

const idsOf = (names: string[]): string[] => names.map((n) => n.split('/')[2] as string);

test.describe.configure({ mode: 'serial' });

test('English: the clips decode in the browser to the length they were made at, every call is played through the kit and shown on the picture', async ({ page }) => {
  test.setTimeout(90_000);
  const s = await run(page, { lang: 'en', speed: 2 }, 16_000);
  expect(s.audio.state).toBe('running');
  // the 15 clips of the language are in the kit, as long as the manifest says (the mp3's encoder delay is cut by the decoder: gapless)
  expect(Object.keys(s.voice.clips).filter((n) => n.startsWith('coach/en/')).length).toBe(15);
  expect(Object.keys(s.voice.clips).some((n) => n.startsWith('coach/tr/'))).toBe(false);
  for (const [id, c] of Object.entries(CLIPS.clips['en']!)) {
    const seconds = s.voice.clips[`coach/en/${id}`]!;
    expect(seconds * 1000, `en/${id}`).toBeGreaterThanOrEqual(c.ms - 10);
    expect(seconds * 1000, `en/${id}`).toBeLessThanOrEqual(c.ms + 10);
  }
  // each call made so far was asked of the kit, in order, and the kit played it; none was repeated
  const made = s.voice.calls;
  expect(made.length).toBeGreaterThan(15);
  expect(idsOf(s.voice.plays.map((p) => p.name))).toEqual(made.map((c) => c.id).slice(0, s.voice.plays.length));
  expect(s.voice.plays.length).toBeGreaterThanOrEqual(made.length - 2);
  expect(s.voice.plays.every((p) => p.ok), 'the kit accepted every clip').toBe(true);
  expect(s.voice.plays.every((p) => p.gain === CLIP_GAIN)).toBe(true);
  // on the game clock: played within a few frames of the time it was due
  s.voice.plays.forEach((p, i) => expect(p.t - made[i]!.t, `call ${i}`).toBeLessThanOrEqual(120));
  // and drawn: the words of the calls that were made
  for (const id of new Set(made.slice(0, -1).map((c) => c.id))) expect(s.voice.texts, id).toContain(CLIPS.clips['en']![id]!.text);
  expect(s.voice.texts).toContain('Round one');
  expect(s.voice.texts).toContain('One');
  expect(errorsOf(page), 'console and page errors').toEqual([]);
});

test('Turkish: the Turkish clips and the Turkish words', async ({ page }) => {
  test.setTimeout(90_000);
  const s = await run(page, { lang: 'tr', speed: 2 }, 12_000);
  expect(Object.keys(s.voice.clips).filter((n) => n.startsWith('coach/tr/')).length).toBe(15);
  for (const [id, c] of Object.entries(CLIPS.clips['tr']!)) {
    expect(s.voice.clips[`coach/tr/${id}`]! * 1000, `tr/${id}`).toBeGreaterThanOrEqual(c.ms - 10);
    expect(s.voice.clips[`coach/tr/${id}`]! * 1000, `tr/${id}`).toBeLessThanOrEqual(c.ms + 10);
  }
  expect(s.voice.plays.length).toBeGreaterThan(8);
  expect(s.voice.plays.every((p) => p.ok && p.name.startsWith('coach/tr/'))).toBe(true);
  expect(s.voice.texts).toContain('Birinci tur');
  expect(s.voice.texts).toContain('Bir');
  expect(s.voice.texts).toContain('İki');
  expect(s.voice.texts).not.toContain('One');
  expect(errorsOf(page)).toEqual([]);
});

for (const [lang, word] of [['de', 'Zwei'], ['es', 'Dos'], ['fr', 'Deux']] as const) {
  test(`${lang}: the English voice, ${lang} captions`, async ({ page }) => {
    test.setTimeout(90_000);
    const s = await run(page, { lang, speed: 2 }, 9000);
    expect(s.voice.plays.length).toBeGreaterThan(3);
    expect(s.voice.plays.every((p) => p.ok && p.name.startsWith('coach/en/'))).toBe(true);
    expect(s.voice.texts).toContain(word);
    expect(s.voice.texts).not.toContain('Two');
    expect(errorsOf(page)).toEqual([]);
  });
}

test('the sound switched off: no clip is played and nothing else speaks, and every call is still on the picture', async ({ page }) => {
  test.setTimeout(90_000);
  const s = await run(page, { lang: 'en', muted: true, speed: 2 }, 12_000);
  expect(s.voice.muted).toBe(true);
  expect(s.voice.calls.length).toBeGreaterThan(8);
  expect(s.voice.plays.length).toBe(0);
  expect(s.cues['go']).toBeGreaterThan(0);        // the game itself went on asking for its sounds; the kit is what is muted
  expect(s.voice.texts).toContain('One');
  expect(s.voice.texts).toContain('Round one');
  expect(errorsOf(page)).toEqual([]);
});

test('quiet mode: the coach is softer, and the calls and the captions are the same', async ({ page }) => {
  test.setTimeout(90_000);
  const s = await run(page, { lang: 'en', quiet: true, speed: 2 }, 9000);
  expect(s.voice.plays.length).toBeGreaterThan(3);
  expect(s.voice.plays.every((p) => p.ok && p.gain === CLIP_GAIN * QUIET_GAIN)).toBe(true);
  expect(s.voice.texts).toContain('One');
  expect(errorsOf(page)).toEqual([]);
});

test('in real time the calls come on the beat: every call is played within a few frames of its time, and the numbers a beat apart', async ({ page }) => {
  test.setTimeout(90_000);
  const s = await run(page, { lang: 'en', level: 'normal', speed: 1 }, 11_000);
  const made = s.voice.calls;
  expect(s.voice.plays.length).toBeGreaterThan(4);
  s.voice.plays.forEach((p, i) => {
    expect(p.t - made[i]!.t, `call ${i}`).toBeGreaterThanOrEqual(0);
    expect(p.t - made[i]!.t, `call ${i}`).toBeLessThanOrEqual(100);
  });
  expect(errorsOf(page)).toEqual([]);
});

test('a round started again gives everything back and plays on: second run, same clips, no error', async ({ page }) => {
  test.setTimeout(90_000);
  await run(page, { lang: 'en', speed: 4 }, 5000);
  await call(page, 'stop');
  await call(page, 'start', { ...START, seed: 5, lang: 'en', speed: 4, game: 'pad-work' });
  const s = await playFor(page, 8000);
  expect(s.voice.plays.length).toBeGreaterThan(2);
  expect(s.voice.plays.every((p) => p.ok)).toBe(true);
  expect(errorsOf(page)).toEqual([]);
});
