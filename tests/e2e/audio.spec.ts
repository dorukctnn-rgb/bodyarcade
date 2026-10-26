// The audio kit on the browser's real Web Audio, headless. There is no sound card to listen to, so the checks are on
// numbers: every sound is rendered offline through the real builder and measured (loudness, clicks, silence at the
// end, pitch), the master chain is rendered under a pile of loud sounds to see that it does not clip, the audio clock
// is timed on the real context (also at 4x CPU throttling), and the tap-along calibration recovers an offset on it.
import { expect, test, type Page } from '@playwright/test';
import { DEV_URL } from './support/ports.ts';
import type * as Harness from './pages/audio-harness.ts';

type H = typeof Harness;

/** Budget for the callbacks of the audio clock (milliseconds after the scheduled audio time), 12 ms ticks. */
const BUDGET = { p95: 25, max: 60, p95Throttled: 50, maxThrottled: 120 } as const;

async function open(page: Page): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
  (page as unknown as { errors: string[] }).errors = errors;
  await page.goto(`${DEV_URL}/tests/e2e/pages/audio.html`);
  await page.waitForFunction(() => (window as unknown as { harnessReady?: boolean }).harnessReady === true, undefined, { timeout: 60_000 });
}

const errorsOf = (page: Page): string[] => (page as unknown as { errors: string[] }).errors;

function call<K extends keyof H>(page: Page, fn: K, arg?: Parameters<H[K]>[0]): Promise<Awaited<ReturnType<H[K]>>> {
  return page.evaluate(async ([name, a]) => {
    const h = (window as unknown as { audioH: Record<string, (x: unknown) => unknown> }).audioH;
    return await h[name as string]!(a);
  }, [fn as string, arg] as const) as Promise<Awaited<ReturnType<H[K]>>>;
}

test.describe.configure({ mode: 'serial' });

test('every sound, rendered offline: audible, not clipping, no click at the start, silent at the end, the pitch it says', async ({ page }) => {
  test.setTimeout(120_000);
  await open(page);
  const all = await call(page, 'renderAll');
  expect(all.length).toBeGreaterThanOrEqual(25);
  let measuredPitch = 0;
  for (const r of all) {
    expect(r.nan, `${r.name} has no NaN`).toBe(false);
    expect(r.peak, `${r.name} is audible`).toBeGreaterThan(0.02);
    expect(r.peak, `${r.name} does not clip`).toBeLessThan(0.7);
    expect(r.rms, `${r.name} has body`).toBeGreaterThan(0.002);
    expect(r.firstMsPeak, `${r.name} starts without a click (first 0.3 ms)`).toBeLessThan(0.02);
    expect(r.lastMsPeak, `${r.name} ends in silence`).toBeLessThan(0.003);
    if (r.pitch > 0) {
      measuredPitch++;
      expect(r.pitch, `${r.name} pitch ${Math.round(r.pitch)} Hz is in ${Math.round(r.expectedLow)}..${Math.round(r.expectedHigh)}`).toBeGreaterThanOrEqual(r.expectedLow);
      expect(r.pitch, `${r.name} pitch`).toBeLessThanOrEqual(r.expectedHigh);
    }
  }
  expect(measuredPitch).toBeGreaterThanOrEqual(8);
  console.log('loudest sounds [name, peak, rms]', JSON.stringify([...all].sort((a, b) => b.peak - a.peak).slice(0, 5).map((r) => [r.name, +r.peak.toFixed(3), +r.rms.toFixed(3)])));
  expect(errorsOf(page)).toEqual([]);
});

test('fifty sounds at once through the master chain do not clip, and the limiter is what holds them', async ({ page }) => {
  test.setTimeout(60_000);
  await open(page);
  const loud = ['hit', 'go', 'done', 'win', 'lose', 'firework-burst', 'metronome', 'warn', 'perfect', 'coin'];
  const r = await call(page, 'massRender', { names: loud, copies: 5, volume: 1 });
  console.log('mass render', JSON.stringify(r));
  expect(r.unlimitedPeak, 'without the limiter this pile would clip').toBeGreaterThan(1.2);
  expect(r.peak, 'with it the peak stays under full scale').toBeLessThanOrEqual(1);
  expect(r.clipped).toBe(0);
  expect(errorsOf(page)).toEqual([]);
});

test('the real context: nothing before a gesture, then running with a clock that advances and a latency figure', async ({ page }) => {
  test.setTimeout(60_000);
  await open(page);
  const before = await call(page, 'beforeGesture');
  expect(before.state).toBe('none');
  expect(before.stats).toEqual({ locked: 2, contexts: 0 });
  const r = await call(page, 'realContext');
  console.log('real context', JSON.stringify(r));
  expect(r.state).toBe('none');
  expect(r.stateAfterUnlock).toBe('running');
  expect(r.ready, 'the clock started moving within four seconds of the gesture').toBe(true);
  expect(r.advanced).toBeGreaterThan(0.25);
  expect(r.advanced).toBeLessThan(0.8);
  expect(r.played).toBe(5);
  expect(r.skipped).toBe(0);
  expect(r.clockLatencyMs).toBeGreaterThanOrEqual(0);
  expect(r.clockLatencyMs).toBeLessThan(500);
  expect(r.perfPairingErrorMs, "the page clock maps onto the audio clock").toBeLessThan(25);
  expect(errorsOf(page)).toEqual([]);
});

test('clock callbacks run close to their audio time, at normal speed and at 4x CPU throttling', async ({ page }) => {
  test.setTimeout(90_000);
  await open(page);
  const normal = await call(page, 'clockTiming', { count: 60 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const slow = await call(page, 'clockTiming', { count: 60 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  console.log('clock lateness ms [normal, 4x]', JSON.stringify([normal, slow].map((t) => ({ p50: +t.p50.toFixed(1), p95: +t.p95.toFixed(1), max: +t.max.toFixed(1), min: +t.min.toFixed(1) }))));
  expect(normal.n).toBe(60);
  expect(normal.min).toBeGreaterThanOrEqual(-5);
  expect(normal.p95).toBeLessThan(BUDGET.p95);
  expect(normal.max).toBeLessThan(BUDGET.max);
  expect(slow.p95).toBeLessThan(BUDGET.p95Throttled);
  expect(slow.max).toBeLessThan(BUDGET.maxThrottled);
  expect(errorsOf(page)).toEqual([]);
});

test('the tap-along calibration on the real clock finds the offset of a player who taps 120 ms late', async ({ page }) => {
  test.setTimeout(60_000);
  await open(page);
  const r = await call(page, 'calibrationRun', { offsetMs: 120, beats: 6 });
  console.log('calibration', JSON.stringify(r));
  expect(r.ok).toBe(true);
  expect(r.taps).toBe(6);
  expect(Math.abs(r.offsetMs - 120)).toBeLessThan(25);
  expect(r.spreadMs).toBeLessThan(20);
  expect(errorsOf(page)).toEqual([]);
});

test('seven sessions in a row each make and close one context (the browser allows only a few open at once)', async ({ page }) => {
  test.setTimeout(60_000);
  await open(page);
  const r = await call(page, 'sessions', { count: 7 });
  expect(r.states).toEqual(new Array(7).fill('closed'));
  expect(r.created).toEqual(new Array(7).fill(1));
  for (const p of r.played) expect(p).toBeGreaterThanOrEqual(10);   // cooldowns skip the repeats of 12 ms ticks, by design
  expect(errorsOf(page)).toEqual([]);
});
