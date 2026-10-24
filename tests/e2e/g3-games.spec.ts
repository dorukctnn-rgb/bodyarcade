// The four games of builder G3 in headless Chromium: Firework Jacks, Twist Turbine, Limbo Bend and Pose Wall, played by a synthetic
// body through the real Session, detectors, input hub, 2D scene kit, the shell's HUD and the real audio kit (tests/e2e/pages/
// g3-game-harness.ts). At phone and laptop sizes, one player and two, seated and quiet: no console error, the HUD without a problem,
// the key objects clear of the plates and of the self view, the picture really drawn, every sound a sound of the library, the reason
// strip saying what the body got wrong, and the set runs to the results.
// BA_G3_SHOTS=<folder> keeps a screenshot of every run (in play, and when the reason strip says something); with BA_G3_FILM=<ms> also one
// every so many milliseconds.
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DEV_URL } from './support/ports.ts';

// A whole run in real time with the 2D scene, the audio kit and a software-rendered page is a local release gate: the GitHub runners
// are too slow for it (like the other GPU-heavy specs), so the check runs on this machine before a release.
test.skip(!!process.env['CI'], 'whole-chain runs in real time: the local release gate, not the CI runners');

interface Box { x: number; y: number; w: number; h: number }
interface Over { seconds: number; score: number; reps?: number; hits?: number; quality?: number; bestStreak?: number; players?: Record<string, { score: number; reps?: number }>; log: { kind: string; ok: boolean }[] }
interface Ba {
  start(): Promise<void>;
  state(): { session: string; game: { phase: string; k: number; segment: string } | null; seen: { over: Over[]; errors: unknown[]; states: string[] } };
  summary(): Over | null;
  keep(): Box[];
  plates(): ({ name: string } & Box)[];
  reasons(): string[];
  command(): string;
  rects(): { w: number; h: number; play: Box; pip: Box | null; lanes?: [Box, Box] | null };
  problems(): string[];
  frames(): number[];
  audioStats(): { played: number; skipped: { unknown: number }; contextsCreated: number };
  pixelCheck(): number;
}
const ba = <T>(page: Page, fn: (b: Ba) => T): Promise<T> => page.evaluate(`(${fn.toString()})(window.ba)`) as Promise<T>;

async function open(page: Page, params: string, errors: string[]): Promise<void> {
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`console ${m.type()}: ${m.text()}`); });
  await page.goto(`${DEV_URL}/tests/e2e/pages/g3-game.html?${params}`);
  await page.waitForFunction(() => (window as unknown as { harnessReady?: boolean }).harnessReady === true);
}

async function waitSession(page: Page, want: string, timeout = 90_000): Promise<void> {
  const end = Date.now() + timeout;
  let last = '';
  while (Date.now() < end) {
    last = await ba(page, (b) => b.state().session);
    if (last === want) return;
    if (last === 'error') break;
    await page.waitForTimeout(150);
  }
  throw new Error(`session never reached '${want}' (now '${last}'): ${JSON.stringify(await ba(page, (b) => b.state()))}`);
}

/** Plays to the results, reading the reason strip and the command all the way; with BA_G3_SHOTS set, keeps a picture of the first reason. */
async function playToResults(page: Page, label: string, timeout: number): Promise<{ reasons: Set<string>; commands: Set<string> }> {
  const shots = process.env['BA_G3_SHOTS'];
  const reasons = new Set<string>();
  const commands = new Set<string>();
  let shot = false;
  let film = 0;
  let lastFrame = 0;
  const end = Date.now() + timeout;
  let last = '';
  while (Date.now() < end) {
    const st = await ba(page, (b) => ({ session: b.state().session, reasons: b.reasons(), command: b.command() }));
    last = st.session;
    if (st.session === 'results') return { reasons, commands };
    if (st.session === 'error') break;
    for (const r of st.reasons) reasons.add(r);
    if (st.command) commands.add(st.command);
    if (shots && st.reasons.length && !shot) { shot = true; await page.screenshot({ path: join(shots, `${label}-reason.png`) }); }
    if (shots && process.env['BA_G3_FILM'] && Date.now() - lastFrame > Number(process.env['BA_G3_FILM'])) { lastFrame = Date.now(); await page.screenshot({ path: join(shots, `${label}-film-${String(film++).padStart(2, '0')}.png`) }); }
    await page.waitForTimeout(120);
  }
  throw new Error(`session never reached 'results' (now '${last}'): ${JSON.stringify(await ba(page, (b) => b.state()))}`);
}

const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (a: Box, b: Box): boolean => a.x >= b.x - 1 && a.x + a.w <= b.x + b.w + 1 && a.y >= b.y - 1 && a.y + a.h <= b.y + b.h + 1;

const SIZES = {
  'phone-390x844': { width: 390, height: 844 },
  'phone-844x390': { width: 844, height: 390 },
  'laptop-1280x800': { width: 1280, height: 800 },
} as const;

type Body = 'perfect' | 'late' | 'sloppy' | 'idle';
interface Case {
  game: 'firework-jacks' | 'twist-turbine' | 'limbo-bend' | 'pose-wall';
  size: keyof typeof SIZES;
  mode?: 'solo' | 'local2';
  seated?: boolean;
  quiet?: boolean;
  body?: Body;
  difficulty?: string;
  /** Pattern(s) the reason strip must show at some point in the run. */
  reason?: RegExp;
}

/** What a good run of the set has to show at least (the sets are short: 18 s of play, 30 s for the turbine). */
const MIN: Record<Case['game'], { reps: number; seconds: number }> = {
  'firework-jacks': { reps: 12, seconds: 15 },
  'twist-turbine': { reps: 8, seconds: 25 },
  'limbo-bend': { reps: 3, seconds: 15 },
  'pose-wall': { reps: 2, seconds: 15 },
};
const LEVEL: Record<Case['game'], string> = { 'firework-jacks': 'normal', 'twist-turbine': 'normal', 'limbo-bend': 'normal', 'pose-wall': 'easy' };

const CASES: Case[] = [
  { game: 'firework-jacks', size: 'phone-390x844' },
  { game: 'firework-jacks', size: 'phone-844x390' },
  { game: 'firework-jacks', size: 'laptop-1280x800' },
  { game: 'firework-jacks', size: 'laptop-1280x800', mode: 'local2' },
  { game: 'firework-jacks', size: 'phone-390x844', seated: true },
  { game: 'firework-jacks', size: 'phone-390x844', quiet: true },
  { game: 'twist-turbine', size: 'phone-390x844' },
  { game: 'twist-turbine', size: 'phone-844x390' },
  { game: 'twist-turbine', size: 'laptop-1280x800' },
  { game: 'twist-turbine', size: 'phone-390x844', seated: true },
  { game: 'twist-turbine', size: 'phone-390x844', body: 'sloppy', reason: /Hands too far apart/ },
  { game: 'limbo-bend', size: 'phone-390x844' },
  { game: 'limbo-bend', size: 'phone-844x390' },
  { game: 'limbo-bend', size: 'laptop-1280x800' },
  { game: 'limbo-bend', size: 'laptop-1280x800', mode: 'local2' },
  { game: 'limbo-bend', size: 'phone-390x844', seated: true },
  { game: 'limbo-bend', size: 'phone-390x844', body: 'sloppy', reason: /Wrong side/ },
  { game: 'pose-wall', size: 'phone-390x844' },
  { game: 'pose-wall', size: 'phone-844x390' },
  { game: 'pose-wall', size: 'laptop-1280x800' },
  { game: 'pose-wall', size: 'laptop-1280x800', mode: 'local2' },
  { game: 'pose-wall', size: 'phone-390x844', seated: true },
  { game: 'pose-wall', size: 'phone-390x844', body: 'sloppy', reason: /arm off the shape/ },
];

for (const c of CASES) {
  const body = c.body ?? 'perfect';
  const label = `${c.game}-${c.mode ?? 'solo'}${c.seated ? '-seated' : ''}${c.quiet ? '-quiet' : ''}${body === 'perfect' ? '' : `-${body}`}-${c.size}`;
  test(label, async ({ page }) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    await page.setViewportSize(SIZES[c.size]);
    const params = new URLSearchParams({
      game: c.game, mode: c.mode ?? 'solo', difficulty: c.difficulty ?? LEVEL[c.game], seated: c.seated ? '1' : '0', quiet: c.quiet ? '1' : '0', body, workS: c.game === 'twist-turbine' ? '30' : '18',
    });
    await open(page, params.toString(), errors);
    await ba(page, (b) => b.start());
    await waitSession(page, 'running');
    await page.waitForTimeout(4500);

    // Mid-play: the HUD is whole, the picture is drawn, the key objects are clear of the plates and of the self view.
    const mid = await ba(page, (b) => ({ problems: b.problems(), colours: b.pixelCheck(), keep: b.keep(), plates: b.plates(), rects: b.rects(), command: b.command() }));
    if (process.env['BA_G3_SHOTS']) await page.screenshot({ path: join(process.env['BA_G3_SHOTS'], `${label}-play.png`) });
    expect(mid.problems, 'HUD problems').toEqual([]);
    expect(mid.colours, 'colours on the canvas').toBeGreaterThan(5);
    expect(mid.keep.length).toBeGreaterThan(0);
    const screen: Box = { x: 0, y: 0, w: SIZES[c.size].width, h: SIZES[c.size].height };
    // the plates of the HUD, and the self view as the picture the scene kit leaves a window for (the shell's tile around it also
    // holds the small controls; the layout rule is about the picture)
    const plates = mid.plates.filter((p) => p.name !== 'pip');
    if (mid.rects.pip) plates.push({ name: 'pip picture', ...mid.rects.pip });
    for (const k of mid.keep) {
      expect(k.w, 'a key object has a size').toBeGreaterThan(10);
      for (const p of plates) expect(overlaps(k, p), `a key object ${JSON.stringify(k)} under the ${p.name} plate ${JSON.stringify(p)} (rects ${JSON.stringify(mid.rects)})`).toBe(false);
      expect(k.x, 'inside the screen').toBeGreaterThanOrEqual(screen.x - 1);
      expect(k.x + k.w).toBeLessThanOrEqual(screen.x + screen.w + 1);
      expect(k.y).toBeGreaterThanOrEqual(screen.y - 1);
      expect(k.y + k.h).toBeLessThanOrEqual(screen.y + screen.h + 1);
    }
    if (c.mode === 'local2') {
      const lanes = mid.rects.lanes as [Box, Box] | null | undefined;
      expect(lanes, 'two lanes').toBeTruthy();
      // each key object stays inside one of the two lanes
      for (const k of mid.keep) expect(inside(k, (lanes as [Box, Box])[0]) || inside(k, (lanes as [Box, Box])[1]), `a key object ${JSON.stringify(k)} in one lane (lanes ${JSON.stringify(lanes)})`).toBe(true);
    }
    expect(mid.command.length, 'the command is on the screen').toBeGreaterThan(0);

    const seen = await playToResults(page, label, 150_000);
    const end = await ba(page, (b) => ({ state: b.state(), audio: b.audioStats(), frames: b.frames(), summary: b.summary() }));
    const over = end.state.seen.over[0]!;
    expect(over.seconds).toBeGreaterThan(MIN[c.game].seconds);
    if (body === 'perfect') {
      const ft = [...end.frames].sort((a, b) => a - b);
      const gist = JSON.stringify({ score: over.score, reps: over.reps, hits: over.hits, quality: over.quality, seconds: over.seconds, kinds: [...new Set(over.log.map((e) => e.kind))], frames: ft.length, medianFrameMs: Math.round(ft[Math.floor(ft.length / 2)] ?? 0), p95FrameMs: Math.round(ft[Math.floor(ft.length * 0.95)] ?? 0) });
      expect(over.score, gist).toBeGreaterThan(100);
      if (c.mode === 'local2') {
        expect(over.players?.['1']?.score).toBeGreaterThan(50);
        expect(over.players?.['2']?.score).toBeGreaterThan(50);
      } else expect(over.reps ?? 0, gist).toBeGreaterThanOrEqual(MIN[c.game].reps);
    }
    if (c.reason) {
      expect([...seen.reasons].some((r) => c.reason!.test(r)), `the reason strip said ${[...seen.reasons].join(' | ') || 'nothing'}`).toBe(true);
    }
    for (const r of seen.reasons) expect(r.length, `a reason is short: ${r}`).toBeLessThanOrEqual(48);
    expect(end.audio.skipped.unknown, 'sounds that are not in the library').toBe(0);
    expect(end.audio.played).toBeGreaterThan(3);
    expect(end.state.seen.errors).toEqual([]);
    expect(errors).toEqual([]);
    const sorted = [...end.frames].sort((a, b) => a - b);
    if (sorted.length > 30) expect(sorted[Math.floor(sorted.length * 0.5)]!).toBeLessThan(60);
  });
}
