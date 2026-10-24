// Small helpers the specs share.
import type { Page } from '@playwright/test';

export interface Hooks {
  /** Speed of the practice session (1 is real time). */
  timeScale?: number;
  /** Length of a practice round, before the time scale. */
  roundSeconds?: number;
  /** Use the practice session even for a game that has real code (Road Run). */
  forceDemo?: boolean;
  social?: boolean | 'fresh' | 'offline';
  plan?: 'free' | 'pro' | 'family';
  /** A keyboard is there even on a phone-sized touch screen (the shell offers it only on laptops and TVs). */
  keyboard?: boolean;
  /** The practice session sees a person at a desk: head and shoulders, no hips, until the round is a seated one. */
  desk?: boolean;
  /** The player is in the last days of a free trial: it ends this many hours from now. */
  trial?: { endsInHours: number; where?: 'web' | 'play'; cancelled?: boolean; email?: 'offer' | 'none' };
  /** What a published build shows while nothing can be bought: no offers, a note. */
  billing?: 'unavailable' | 'checking';
  /** The welcome tour: the stage drawn once and still ('static'), the pre-rendered pictures ('fallback'), or a first visit that is taken to it ('first'). */
  tour?: 'static' | 'fallback' | 'first';
}

/** Sets the test hooks before the page's own scripts run. Development builds only read them. */
export async function withHooks(page: Page, h: Hooks): Promise<void> {
  await page.addInitScript((x) => { window.__BA_TEST__ = x; }, h);
}

/** Everything the page logs as an error, as it happens. */
export function collectErrors(page: Page): string[] {
  const list: string[] = [];
  page.on('pageerror', (e) => list.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') list.push(`console: ${m.text()}`); });
  return list;
}

/** Clicks the label of a radio choice, which is what a person does (the input itself is drawn invisible). */
export async function choose(page: Page, name: string, value: string): Promise<void> {
  await page.locator(`label:has(input[name="${name}"][value="${value}"])`).click();
}

/** Opens a game's page, the "More ways to play" part, and picks keyboard or touch as the controls (no camera needed). */
export async function useKeyboard(page: Page): Promise<void> {
  const more = page.locator('details.k-more');
  if (!(await more.evaluate((d) => (d as HTMLDetailsElement).open))) await more.locator('summary').click();
  await choose(page, 'input', 'keyboard');
}
