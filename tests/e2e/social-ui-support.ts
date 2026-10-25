// Support of the friends-screens end-to-end tests (tests/e2e/social-ui*.spec.ts): the real web shell, built once with the
// development fixtures (so the practice ports and the test hooks exist), served by the production Worker run in Miniflare
// (the real directory Durable Object, the real room Durable Objects, sockets that hibernate), and players that are browser
// contexts of their own (an IndexedDB each, as separate devices have), at a phone size or a laptop size.
//
// The tests drive the screens the way a person does (clicks and typing), and read what a person reads. The only thing they reach
// into the page for is the state the shell keeps on <html> (data-social-status, data-social-hub) and the ports of the app
// (window.__BA_SOCIAL_PORTS__), for the few things a person cannot do (cut the connection).
import { chromium, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { generate } from '../../packages/web/generator/generate.ts';
import { checkPage } from '../../packages/web/tools/layout-check.ts';
import { scan } from '../../packages/web/e2e/support/axe.ts';
import { startStack, type Stack } from '../../packages/server/src/social/stack.ts';
import { baseLaunchOptions } from './support/browser.ts';
import type { Hooks } from '../../packages/web/e2e/support/helpers.ts';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
/** Where screenshots go (BA_SHOTS_DIR, else a temporary folder). */
export const SHOTS = process.env['BA_SHOTS_DIR'] ?? join(tmpdir(), 'ba-social-ui-shots');

/** The five widths of the layout check: a small phone, a phone, a large phone, a tablet and a laptop. */
export const SIZES = [{ w: 360, h: 780 }, { w: 390, h: 844 }, { w: 430, h: 932 }, { w: 768, h: 1024 }, { w: 1440, h: 900 }] as const;

/** Builds the web shell with the fixtures as its catalogue into a new folder (the practice session and the test hooks exist in it). */
export async function buildShell(): Promise<string> {
  const out = mkdtempSync(join(tmpdir(), 'ba-shell-'));
  process.env['BA_FIXTURES'] = 'only';
  await build({ configFile: join(ROOT, 'packages', 'web', 'vite.config.ts'), logLevel: 'warn', mode: 'production', build: { outDir: out, emptyOutDir: true } });
  const report = generate({ out, fixtures: 'only' });
  if (report.problems.length > 0) throw new Error(`the shell did not build:\n${report.problems.join('\n')}`);
  return out;
}

export interface Site {
  stack: Stack;
  origin: string;
  browser: Browser;
  stop(): Promise<void>;
}

/** The shell served by the Worker, and a headless browser. */
export async function startShellSite(): Promise<Site> {
  const dist = await buildShell();
  const stack = await startStack({ assetsDir: dist });
  const browser = await chromium.launch({ ...baseLaunchOptions, headless: true });
  return {
    stack, origin: stack.origin, browser,
    async stop() {
      await browser.close().catch(() => undefined);
      await stack.stop().catch(() => undefined);
      rmSync(dist, { recursive: true, force: true });
    },
  };
}

export interface PlayerOptions {
  /** A phone: a touch screen of 390 by 844 (or the size given). */
  phone?: boolean;
  w?: number;
  h?: number;
  lang?: 'en' | 'tr';
  dark?: boolean;
  hooks?: Hooks & Record<string, unknown>;
  /** A context to share the device with (another tab of the same player). */
  context?: BrowserContext;
}

export interface Player {
  label: string;
  ctx: BrowserContext;
  page: Page;
  /** Page errors and console errors of every page of this player (a failed resource load is an answer of the API, not an error). */
  problems: string[];
  /** Goes to an address of the site and waits until the friends side has started (or, with `plain`, only until the page is there). */
  open(path: string, o?: { plain?: boolean }): Promise<void>;
  /** A second tab of the same device. */
  tab(): Promise<Page>;
  close(): Promise<void>;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function player(site: Site, label: string, o: PlayerOptions = {}): Promise<Player> {
  const w = o.w ?? (o.phone ? 390 : 1280);
  const h = o.h ?? (o.phone ? 844 : 800);
  const lang = o.lang ?? 'en';
  const ctx = o.context ?? await site.browser.newContext({
    viewport: { width: w, height: h }, colorScheme: o.dark ? 'dark' : 'light', locale: lang === 'en' ? 'en-US' : 'tr-TR', deviceScaleFactor: o.phone ? 2 : 1,
    ...(o.phone ? { hasTouch: true, isMobile: true } : {}),
    // The recovery code and the links go to the clipboard: a headless page may write there once it has been allowed.
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const problems: string[] = [];
  const watch = (page: Page): Page => {
    page.on('pageerror', (e) => problems.push(`${label} pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(`${label} console: ${m.text()}`); });
    return page;
  };
  const hooks = { keyboard: true, ...o.hooks };
  await ctx.addInitScript((x) => { (window as unknown as { __BA_TEST__: unknown }).__BA_TEST__ = x; }, hooks);
  const page = watch(await ctx.newPage());
  const p: Player = {
    label, ctx, page, problems,
    async open(path, opts = {}) {
      await p.page.goto(`${site.origin}${path}`);
      await p.page.waitForSelector('main h1, main h2', { timeout: 20_000 });
      if (!opts.plain) await p.page.waitForFunction(() => document.documentElement.dataset['socialStatus'] !== undefined, undefined, { timeout: 20_000 });
      await p.page.evaluate(() => document.fonts.ready);
    },
    async tab() { return watch(await ctx.newPage()); },
    async close() { await ctx.close().catch(() => undefined); },
  };
  return p;
}

/** Waits until the friends side of the page is ready (the profile and the lists are read). */
export async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => document.documentElement.dataset['socialStatus'] === 'ready', undefined, { timeout: 20_000 });
}

/** Waits until the connection to the friends is open. */
export async function online(page: Page): Promise<void> {
  await page.waitForFunction(() => document.documentElement.dataset['socialHub'] === 'online', undefined, { timeout: 20_000 });
}

export interface Codes { friend: string; recovery: string }

/**
 * Makes a profile through the sign-up window, the way a person does: the age, the name, the recovery code. Returns the friend code
 * and the recovery code that were on the screen. The page must be on a screen that offers the profile (the Friends page).
 */
export async function signUp(page: Page, o: { band: 'adult' | 'teen'; name?: string; save?: boolean }): Promise<Codes> {
  await page.locator('[data-action="social.profile"]').first().click();
  await page.locator(`label:has(input[name="age"][value="${o.band}"])`).click();
  await page.locator('[data-action="sheet.age.next"]').click();
  if (o.band === 'adult') await page.locator('#profile-name').fill(o.name ?? 'Player');
  await page.locator('[data-action="sheet.name.create"]').click();
  const recovery = (await page.locator('[data-recovery-code]').textContent({ timeout: 20_000 }))?.trim() ?? '';
  const friend = (await page.locator('[data-friend-code]').textContent())?.trim() ?? '';
  if (o.save !== false) {
    await page.locator('[data-action="sheet.recovery.saved"]').click();
    await expect(page.locator('dialog')).toHaveCount(0);
  }
  return { friend, recovery };
}

/** The friend code on the Friends page (the one in the profile card). */
export async function ownCode(page: Page): Promise<string> {
  return (await page.locator('.k-profile .k-code span[aria-hidden="true"]').first().textContent())?.trim() ?? '';
}

/** Friends on both sides: `a` asks, `b` accepts. Both pages must show the Friends page with a profile. */
export async function befriend(a: Page, b: Page, bCode: string): Promise<void> {
  await a.locator('#friend-code').fill(bCode);
  await a.locator('[data-form="friend-add"] button[type="submit"]').click();
  await expect(a.locator('#add-note')).toContainText(/Request sent|İstek gönderildi/);
  await expect(b.locator('[data-action="social.accept"]')).toBeVisible({ timeout: 20_000 });
  await b.locator('[data-action="social.accept"]').click();
  await expect(a.locator('[data-list="friends"] li')).toHaveCount(1, { timeout: 20_000 });
}

/** The problems the layout rule, the crowding check and the accessibility checks find on the page as it is now. */
export async function inspect(page: Page, o: { axe?: boolean; layout?: boolean; crowding?: boolean } = {}): Promise<string[]> {
  const out = o.layout === false ? [] : [...(await checkPage(page))];
  if (o.crowding !== false) out.push(...(await crowding(page)).map((x) => `crowding: ${x}`));
  if (o.axe !== false) out.push(...(await scan(page)).map((x) => `axe: ${x}`));
  return out;
}

/**
 * What the shared layout rule (checkPage) leaves alone: words drawn over other words, a picture (the QR code, an avatar) over a
 * control or over words, a control over a control anywhere on the page (the rule only looks at the first screen), and a paragraph
 * squeezed into a sliver. Each of them was first found by opening a screenshot; the test finds them now. What is fixed to the
 * screen (the bars, the tray of invitations, a toast) lies over the page by design and is left out, and while a window is open
 * only the window counts.
 */
export async function crowding(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    interface Rect { left: number; top: number; right: number; bottom: number }
    interface Box { el: Element; r: Rect; kind: 'text' | 'control' | 'picture' }
    const FIXED = '.ba-tabbar, .ba-topbar, .ba-skip, .ba-invites, .ba-toast, .k-actionbar';
    const open = [...document.querySelectorAll('dialog[open]')];
    const top = open[open.length - 1] ?? null;
    const counts = (el: Element): boolean => (top ? top.contains(el) : !el.closest('dialog')) && !el.closest(FIXED);
    const shown = (el: Element): boolean => {
      for (let n: Element | null = el; n; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
        if (n.hasAttribute('hidden') || n.hasAttribute('inert') || n.classList.contains('ba-visually-hidden')) return false;
      }
      return true;
    };
    /** The part of a rectangle that is not cut off by an ancestor that clips (a row that scrolls, a name that ends in dots). */
    const clip = (r: DOMRect, el: Element, self: boolean): Rect | null => {
      let { left, top: t, right, bottom } = r;
      for (let n: Element | null = self ? el : el.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
        const b = n.getBoundingClientRect();
        if (cs.overflowX !== 'visible') { left = Math.max(left, b.left); right = Math.min(right, b.right); }
        if (cs.overflowY !== 'visible') { t = Math.max(t, b.top); bottom = Math.min(bottom, b.bottom); }
      }
      return right - left > 0.5 && bottom - t > 0.5 ? { left, top: t, right, bottom } : null;
    };
    const label = (el: Element): string => `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className ? `.${el.className.split(' ')[0]}` : ''} "${(el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 28)}"`;

    const boxes: Box[] = [];
    // the words: one box for each line of each run of text
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node.nodeValue ?? '').trim();
      const owner = node.parentElement;
      if (!text || !owner || !counts(owner) || owner.closest('script, style, noscript, option, textarea, select, svg') || !shown(owner)) continue;
      range.selectNodeContents(node);
      const lines: Rect[] = [];
      for (const rect of range.getClientRects()) {
        const c = rect.width >= 1 && rect.height >= 1 ? clip(rect, owner, true) : null;
        if (c) { boxes.push({ el: owner, r: c, kind: 'text' }); lines.push(c); }
      }
      // a paragraph in a sliver: a few words broken into many short lines
      const widest = Math.max(0, ...lines.map((l) => l.right - l.left));
      if (lines.length >= 3 && text.split(/\s+/).length >= 4 && widest < 96) problems.push(`${label(owner)} is squeezed into a column ${Math.round(widest)}px wide`);
    }
    // the controls and the pictures
    for (const el of document.querySelectorAll('a[href], button, input:not([type=hidden]):not([type=radio]):not([type=checkbox]), select, textarea, summary')) {
      if (!counts(el) || !shown(el)) continue;
      const r = el.getBoundingClientRect();
      const c = r.width >= 1 && r.height >= 1 ? clip(r, el, false) : null;
      if (c) boxes.push({ el, r: c, kind: 'control' });
    }
    for (const el of document.querySelectorAll('img, canvas, video, .ba-qr, .ba-avatar')) {
      if (!counts(el) || !shown(el)) continue;
      const r = el.getBoundingClientRect();
      const c = r.width >= 1 && r.height >= 1 ? clip(r, el, false) : null;
      if (c) boxes.push({ el, r: c, kind: 'picture' });
    }

    // a field whose text is under 16px makes iPhone Safari zoom the page into it when it is touched
    if (window.innerWidth < 800) {
      for (const el of document.querySelectorAll('input:not([type=hidden]):not([type=radio]):not([type=checkbox]), select, textarea')) {
        if (!counts(el) || !shown(el)) continue;
        const size = parseFloat(getComputedStyle(el).fontSize);
        if (size < 16) problems.push(`${label(el)} has text of ${size}px: iPhone Safari zooms into a field with text under 16px`);
      }
    }

    const said = new Set<string>();
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i] as Box;
        const b = boxes[j] as Box;
        if (a.kind === 'picture' && b.kind === 'picture') continue;
        if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (w <= 3 || h <= 0) continue;
        // two lines of words that follow each other may touch a little (their boxes are taller than their letters); words on words may not
        if (a.kind === 'text' && b.kind === 'text' ? h < 0.35 * Math.min(a.r.bottom - a.r.top, b.r.bottom - b.r.top) : h <= 4) continue;
        const kinds = a.kind === b.kind ? `${a.kind}s` : `${a.kind} and ${b.kind}`;
        const line = `${kinds} overlap: ${label(a.el)} over ${label(b.el)}`;
        if (!said.has(line)) { said.add(line); problems.push(line); }
      }
    }
    return problems;
  });
}

/** A screenshot of the page as it is (the whole page, or the viewport for a window). */
export async function shot(page: Page, name: string, o: { full?: boolean } = {}): Promise<string> {
  mkdirSync(SHOTS, { recursive: true });
  const file = join(SHOTS, `${name}.png`);
  // A bar fixed to the bottom of the first screen hides what is under it in a full-page picture; for the overview it goes static.
  await page.addStyleTag({ content: '.k-actionbar { position: static !important; }' }).catch(() => undefined);
  await page.screenshot({ path: file, fullPage: o.full !== false });
  return file;
}

export { sleep };
