// Where a round of the web shell is, read from the page: shared by the fake-camera runner and the budget and leak runners.
import type { Page } from '@playwright/test';

export type Phase = 'loading' | 'preparing' | 'explainer' | 'calibrating' | 'countdown' | 'running' | 'paused' | 'results' | 'failed';

export interface PageState { path: string; loading: boolean; calib: boolean; countdown: boolean; hud: boolean; explainer: boolean; failed: boolean; overlay: boolean; results: boolean; text: string }

/** One look at the page (the function runs inside it). */
export function readState(page: Page): Promise<PageState | null> {
  return page.evaluate((): PageState => ({
    path: location.pathname,
    loading: !!document.querySelector('.ba-loading'),
    calib: !!document.querySelector('[data-cal-view]'),
    countdown: !!document.querySelector('.ba-countdown'),
    hud: !!document.querySelector('[data-hud]'),
    explainer: !!document.querySelector('[data-action="camera-continue"]'),
    failed: /could not start|başlatılamadı/i.test(document.querySelector('#ov-title')?.textContent ?? '') && !document.querySelector('[data-action="camera-continue"]'),
    overlay: !!document.querySelector('#ov-title, .ba-loading'),
    results: /\/results\/?$/.test(location.pathname),
    text: (document.querySelector('#ov-title')?.textContent ?? '').trim(),
  })).catch(() => null);
}

export function phaseOf(s: PageState): Phase {
  if (s.results) return 'results';
  if (s.failed) return 'failed';
  if (s.explainer) return 'explainer';
  if (s.calib) return 'calibrating';
  if (s.countdown) return 'countdown';
  if (s.hud && s.loading) return 'preparing';
  if (s.hud && !s.overlay) return 'running';
  if (s.hud) return 'paused';
  return 'loading';
}

/**
 * Clicks through the camera explainer and waits until the round runs (or fails). Resolves with the last phase and the time
 * it took; `calibrating` after the timeout means the camera never showed a person the game could use.
 */
export async function startRound(page: Page, o: { timeoutMs: number; onPhase?: (p: Phase, at: number) => void }): Promise<{ phase: Phase; ms: number; text: string }> {
  const t0 = Date.now();
  let last: Phase = 'loading';
  let clicked = 0;
  let text = '';
  while (Date.now() - t0 < o.timeoutMs) {
    const s = await readState(page);
    if (s) {
      const p = phaseOf(s);
      text = s.text;
      if (p !== last) { last = p; o.onPhase?.(p, Date.now()); }
      if (p === 'running' || p === 'failed' || p === 'results') return { phase: p, ms: Date.now() - t0, text };
      if (p === 'explainer' && Date.now() - clicked > 1500) { clicked = Date.now(); await page.locator('[data-action="camera-continue"]').first().click({ timeout: 5000 }).catch(() => undefined); }
    }
    await page.waitForTimeout(80);
  }
  return { phase: last, ms: Date.now() - t0, text };
}
