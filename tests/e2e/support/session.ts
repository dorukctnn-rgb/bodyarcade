// Shared steps for the Session e2e tests (tests/e2e/pages/session.html).
import type { Page } from '@playwright/test';
import { DEV_URL } from './ports.ts';

export interface RunView {
  state: string;
  pauseReason: string | null;
  steps: number;
  renders: number;
  starts: { seed: number; mode: string; profile: boolean; profiles: string[] | null }[];
  /** What the session handed the game: the options and the profile it measured. */
  startDetail: { seated: boolean; kind: string | null; framing: string | null; hipsEstimated: boolean; headroom: string | null }[];
  events: string[];
  twoStreams: boolean;
  disposed: number;
  live: number;
  acquired: number;
  seen: {
    states: string[]; pauses: string[]; countdown: number[]; calibration: number; over: { score: number } | null; errors: { code: string }[]; players: { player: number; present: boolean }[];
    /** The 'profile' events and the calibration codes in the order they changed. */
    profile: { profile: string; outcome: string; seated: boolean; supports: Record<string, boolean>; headroom?: string }[]; codes: string[];
  };
  caps: { device: string; local2: boolean; local2Reason: string };
}

/** `seated`: the test game has a seated variant (so a desk can fall back to it); `headroom`: it raises the hands overhead. */
export async function open(page: Page, game: { seated?: boolean; headroom?: 'arms-up' } = {}): Promise<void> {
  await page.goto(`${DEV_URL}/tests/e2e/pages/session.html`);
  await page.waitForFunction(() => (window as unknown as { harnessReady?: boolean }).harnessReady === true);
  await page.evaluate((o) => (window as unknown as { makeRun: (o: unknown) => boolean }).makeRun(o), game);
}

export const view = (page: Page): Promise<RunView> => page.evaluate(() => {
  const r = (window as unknown as { run: any }).run;
  const st = r.camera.stats();
  return {
    state: r.session.state, pauseReason: r.session.pauseReason, steps: r.game.steps, renders: r.game.renders, starts: r.game.starts, startDetail: r.game.startDetail,
    events: r.game.events, twoStreams: r.game.twoStreams, disposed: r.game.disposed, live: st.live, acquired: st.acquired,
    seen: JSON.parse(JSON.stringify(r.seen)), caps: r.caps, lastCal: r.lastCal ?? null,
  };
});

/** Waits for a session state; on timeout the error shows where the session stopped. */
export async function waitState(page: Page, want: string, timeout = 30_000): Promise<void> {
  const end = Date.now() + timeout;
  let v: RunView | null = null;
  while (Date.now() < end) {
    v = await view(page);
    if (v.state === want) return;
    await page.waitForTimeout(100);
  }
  const brief = v && { state: v.state, pauseReason: v.pauseReason, states: v.seen.states, errors: v.seen.errors, calibration: v.seen.calibration, last: (v as unknown as { lastCal?: unknown }).lastCal };
  throw new Error(`Session never reached '${want}': ${JSON.stringify(brief)}`);
}
