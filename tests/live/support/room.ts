// A scripted room for the social and group tests: N real browser pages joined to one room, driven through the page's
// LiveClient (window.__lm) and read through its metrics (window.__M__). Faster than a full scenario: no match needed.
import { chromium, type Browser, type Page } from '@playwright/test';
import path from 'node:path';
import { withFakeVideo } from '../../e2e/support/browser.ts';
import { ROOT, type Stack } from './stack.ts';
import { identity, type PlayerM, type PlayerSetup } from './runner.ts';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const FAKE_CAMERA = path.join(ROOT, 'tests/e2e/fixtures/standing-640x360.mjpeg');

export interface RoomPlayer {
  setup: PlayerSetup;
  page: Page;
  m(): Promise<PlayerM | null>;
  errors: string[];
}

export interface OpenRoomOptions {
  kind?: 'private' | 'public';
  ages?: ('adult' | 'teen' | 'child')[];
  size?: number;
  players?: number;
  video?: boolean;
  /** Join WebRTC peer links (default: Room relay only, much faster to set up). */
  webrtc?: boolean;
  noready?: boolean;
  durationMs?: number;
  /** Extra query string for every page. */
  query?: Record<string, string>;
}

export interface OpenRoom {
  code: string;
  players: RoomPlayer[];
  browser: Browser;
  close(): Promise<void>;
}

export async function waitFor(fn: () => Promise<boolean> | boolean, ms = 10_000, what = 'condition'): Promise<void> {
  const t0 = Date.now();
  for (;;) {
    if (await Promise.resolve(fn()).catch(() => false)) return;
    if (Date.now() - t0 > ms) throw new Error(`timed out after ${ms} ms waiting for ${what}`);
    await sleep(100);
  }
}

export async function openRoom(stack: Stack, o: OpenRoomOptions = {}): Promise<OpenRoom> {
  const n = o.players ?? o.ages?.length ?? 2;
  const ages = o.ages ?? Array.from({ length: n }, () => 'adult' as const);
  const who = ages.map((a, i) => identity(i, a));
  const creator = who[0] as PlayerSetup;
  const res = await fetch(`${stack.base}/api/rooms`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: o.kind ?? 'private', gameId: 'squat-flap', size: o.size ?? Math.max(2, n), durationMs: o.durationMs ?? 30_000, pid: creator.pid, name: creator.name, age: creator.age }),
  });
  if (res.status !== 201) throw new Error(`room not created: ${res.status} ${await res.text()}`);
  const code = String(((await res.json()) as { code: string }).code);
  const browser = await chromium.launch(withFakeVideo(FAKE_CAMERA));
  const players: RoomPlayer[] = [];
  for (const [i, w] of who.entries()) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 240)));
    const p = new URLSearchParams({ room: code, pid: w.pid, name: w.name, age: w.age, video: o.video ? '1' : '0', matches: '1', ...(o.webrtc ? {} : { peers: 'none' }), ...(o.noready ? { noready: '1' } : {}), ...(o.query ?? {}) });
    await page.goto(`${stack.base}/duel?${p.toString()}`);
    players.push({
      setup: w, page, errors,
      m: () => page.evaluate(() => {
        const m = (window as unknown as { __M__?: Record<string, unknown> }).__M__;
        if (!m) return null;
        const { log: _l, ...rest } = m;
        void _l;
        return JSON.parse(JSON.stringify(rest)) as never;
      }).catch(() => null),
    });
    void i;
  }
  await waitFor(async () => (await Promise.all(players.map((p) => p.m()))).every((m) => !!m?.seat), 20_000, 'every player welcomed');
  return { code, players, browser, close: async () => { await browser.close().catch(() => undefined); } };
}

/** Calls a LiveClient method in a page: `call(p, 'chat', 'hello')`. Arguments must be JSON. */
export function call(p: RoomPlayer, method: string, ...args: unknown[]): Promise<unknown> {
  return p.page.evaluate(({ method, args }) => (window as unknown as { __lm: Record<string, (...a: unknown[]) => unknown> }).__lm[method]?.(...args), { method, args });
}
