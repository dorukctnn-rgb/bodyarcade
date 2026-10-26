// Helpers of the social suite: the site (the harness page next to the production Worker), and players, each a browser
// context with its own storage that holds one SocialClient (tests/social/harness/main.ts).
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { baseLaunchOptions } from '../e2e/support/browser.ts';
import { STACK_ADMIN_TOKEN, startStack, type Stack } from '../../packages/server/src/social/stack.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));

export interface Site {
  stack: Stack;
  origin: string;
  /** Bearer token of the moderation API of this Worker. */
  adminToken: string;
  browser: Browser;
  /** Waits for the browser and the Worker to stop, and removes the folder the harness was built into. */
  stop(): Promise<void>;
}

/** Builds the harness page, starts the Worker with it as the site's assets, and a headless browser. */
export async function startSite(): Promise<Site> {
  const dir = mkdtempSync(join(tmpdir(), 'ba-social-'));
  mkdirSync(dir, { recursive: true });
  await build({
    entryPoints: [join(HERE, 'harness/main.ts')],
    outfile: join(dir, 'harness.js'),
    bundle: true,
    format: 'esm',
    target: 'es2022',
    platform: 'browser',
    logLevel: 'silent',
  });
  copyFileSync(join(HERE, 'harness/index.html'), join(dir, 'index.html'));
  const stack = await startStack({ assetsDir: dir });
  const browser = await chromium.launch({ ...baseLaunchOptions, headless: true });
  return {
    stack,
    origin: stack.origin,
    adminToken: STACK_ADMIN_TOKEN,
    browser,
    async stop() {
      await browser.close().catch(() => undefined);
      await stack.stop().catch(() => undefined);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** What a page's client holds (tests/social/harness/main.ts `snapshot`). */
export interface Snapshot {
  persistent: boolean;
  /** The recovery code the page holds (sign-up, recovery or renewal), null after a reload. */
  recovery: string | null;
  profile: null | {
    fid: string; name: string; band: 'child' | 'teen' | 'adult'; code: string; link: string; level: number; region: string; dnd: boolean;
    can: { freeName: boolean; freeText: boolean; video: boolean; publicPlay: boolean };
  };
  friends: { fid: string; name: string; band: string; presence: { status: string; game?: string; room?: string } }[];
  requests: { incoming: { fid: string; name: string; via: string }[]; outgoing: { fid: string; name: string }[] };
  blocks: { fid: string; name: string }[];
  invites: { id: string; from: { fid: string; name: string }; room: string; game: string; exp: number }[];
  hub: string;
  room: null | { code: string | null; you: string | null; welcomed: boolean; members: number; closed: boolean };
  events: string[];
  errors: string[];
}

export type Me = NonNullable<Snapshot['profile']>;
export type Attempt<T> = { ok: true; value: T } | { ok: false; status: number; code: string };

export interface Player {
  label: string;
  ctx: BrowserContext;
  /** The page that holds the player's client (replaced by open() after it was closed). */
  page: Page;
  /** Console errors and uncaught exceptions of every page of this player (failed resource loads are the API's answers, not errors). */
  problems: string[];
  snap(): Promise<Snapshot>;
  /** Runs `fn(ba, arg)` in the page, with the harness handle `ba`; `arg` must be JSON. */
  run<T, A = undefined>(fn: (ba: any, arg: A) => T | Promise<T>, arg?: A): Promise<T>; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Like run, but a failing call answers { ok: false, status, code } instead of throwing. */
  try<T, A = undefined>(fn: (ba: any, arg: A) => T | Promise<T>, arg?: A): Promise<Attempt<Awaited<T>>>; // eslint-disable-line @typescript-eslint/no-explicit-any
  signUp(input: { band: 'child' | 'teen' | 'adult'; name?: string; region?: string; level?: number }): Promise<Me>;
  /** Waits until `cond` holds for the page's state. */
  until(cond: (s: Snapshot) => boolean, what: string, ms?: number): Promise<Snapshot>;
  /** Opens (or reloads) the harness page, in a new page when the old one was closed, and waits for the device's identity to load. */
  open(): Promise<void>;
  /** Opens the harness page at an address of the site (a friend link /f/BA-XXXXXX), as a link a friend sent would. */
  openAt(path: string): Promise<void>;
  /** A second page of the same device (shared storage): another tab. */
  newTab(): Promise<Page>;
  close(): Promise<void>;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function player(site: Site, label: string): Promise<Player> {
  const context = await site.browser.newContext({ viewport: { width: 420, height: 800 } });
  const problems: string[] = [];
  const watch = (page: Page): Page => {
    page.on('pageerror', (e) => problems.push(`${label} pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(`${label} console: ${m.text()}`);
    });
    return page;
  };
  const load = async (page: Page, path = '/'): Promise<void> => {
    await page.goto(`${site.origin}${path}`);
    await page.waitForFunction(() => 'ba' in window);
    await page.evaluate(() => (window as unknown as { ba: { ready: Promise<unknown> } }).ba.ready);
  };
  const p: Player = {
    label, ctx: context, page: watch(await context.newPage()), problems,
    snap: () => p.page.evaluate(() => (window as unknown as { ba: { snapshot(): unknown } }).ba.snapshot()) as Promise<Snapshot>,
    run: (fn, arg) => p.page.evaluate(`(${fn.toString()})(window.ba, ${JSON.stringify(arg ?? null)})`) as never,
    try: (fn, arg) => p.page.evaluate(`window.ba.attempt(() => (${fn.toString()})(window.ba, ${JSON.stringify(arg ?? null)}))`) as never,
    async signUp(input) {
      return (await p.run((ba, i) => ba.signUp(i), input)) as Me;
    },
    async until(cond, what, ms = 15_000) {
      const t0 = Date.now();
      for (;;) {
        const s = await p.snap();
        if (cond(s)) return s;
        if (Date.now() - t0 > ms) throw new Error(`${label}: timed out waiting for ${what}; last state: ${JSON.stringify({ hub: s.hub, friends: s.friends, requests: s.requests, invites: s.invites, room: s.room, events: s.events.slice(-8) })}`);
        await sleep(60);
      }
    },
    async open() {
      if (p.page.isClosed()) p.page = watch(await context.newPage());
      await load(p.page);
    },
    async openAt(path) {
      if (p.page.isClosed()) p.page = watch(await context.newPage());
      await load(p.page, path);
    },
    async newTab() {
      const tab = watch(await context.newPage());
      await load(tab);
      return tab;
    },
    async close() { await context.close().catch(() => undefined); },
  };
  await load(p.page);
  return p;
}
