// Every state of every Friends screen, on the five widths of the layout rule (360, 390, 430, 768 and 1440 wide), in the practice
// ports (`?social=<state>`, which can reach what a real service takes a day to produce: a suspended profile, a connection taken
// by another window, a quick match that finds nobody): the layout rule (nothing sideways, nothing cut off, no two controls over
// each other, nothing under the bar), axe (WCAG 2.2 A and AA plus best practices, the light and the dark theme), no console error,
// and a screenshot of each to open and look at. English on all five widths, Turkish on the smallest and the largest.
//   BA_SHOTS_DIR=... node C:/Users/doruk/apps/_tools/e2e-slot.mjs run -- npm run test:social -- --workers=1 tests/e2e/social-ui-states.spec.ts
import { expect, test, type Page } from '@playwright/test';
import { inspect, player, shot, SIZES, startShellSite, type Site } from './social-ui-support.ts';

let site: Site;
test.beforeAll(async () => { test.setTimeout(300_000); site = await startShellSite(); });
test.afterAll(async () => { await site?.stop(); });

interface State {
  id: string;
  path: string;
  hooks?: Record<string, unknown>;
  /** What is done on the page before it is looked at (a window opened, a state brought about). */
  prepare?: (page: Page) => Promise<void>;
  /** A window is open: the picture is the screen, not the page. */
  window?: boolean;
}

const control = (page: Page, js: string): Promise<unknown> => page.evaluate(`(() => { const c = window.__BA_SOCIAL__; ${js} })()`);
const click = (selector: string) => async (page: Page): Promise<void> => { await page.locator(selector).first().click(); };
const choose = (value: string) => async (page: Page): Promise<void> => { await page.locator(`label:has(input[name="age"][value="${value}"])`).click(); };

const STATES: State[] = [
  // the friends page
  ...(['ready', 'teen', 'alone', 'fresh', 'offline', 'under13', 'kid', 'banned', 'replaced', 'reconnecting', 'recovery', 'deleted', 'unknown', 'muted', 'suspended'] as const).map((m) => ({ id: `friends-${m}`, path: `/friends/?social=${m}` })),
  { id: 'friends-offline-saved', path: '/friends/?social=ready', prepare: async (p) => { await control(p, 'c.offline(true);'); await p.waitForSelector('[data-banner="offline"]'); } },
  { id: 'friends-add-error', path: '/friends/?social=ready', prepare: async (p) => { await p.locator('#friend-code').fill('BA-DDDDDD'); await p.locator('[data-form="friend-add"] button[type="submit"]').click(); await p.waitForSelector('#add-note.is-error'); } },
  { id: 'friends-tray', path: '/friends/?social=ready', window: true, prepare: async (p) => { await control(p, "c.invite('Elif', 'squat-flap');"); await p.waitForSelector('.k-tray__card'); } },
  { id: 'friends-toast', path: '/friends/?social=ready', window: true, prepare: async (p) => { await control(p, "c.request('Zed');"); await p.waitForSelector('.ba-toast'); } },
  // my profile
  ...(['ready', 'teen', 'banned', 'fresh', 'under13', 'recovery', 'muted'] as const).map((m) => ({ id: `profile-${m}`, path: `/friends/?view=profile&social=${m}` })),
  { id: 'profile-notes', path: '/friends/?view=profile&social=ready', prepare: async (p) => { await p.locator('#me-name').fill('www.example.com'); await p.locator('[data-form="me-name"] button[type="submit"]').click(); await p.waitForSelector('[data-form="me-name"] .is-error'); } },
  { id: 'profile-delete-confirm', path: '/friends/?view=profile&social=ready', window: true, prepare: click('[data-action="me.delete"]') },
  // the weekly boards
  ...(['ready', 'fresh', 'under13', 'teen'] as const).map((m) => ({ id: `boards-${m}`, path: `/friends/?view=boards&social=${m}` })),
  { id: 'boards-country', path: '/friends/?view=boards&social=ready', prepare: async (p) => { await p.locator('label:has(input[name="scope"][value="country"])').click(); await p.waitForSelector('[data-board="country"]'); } },
  { id: 'boards-previous', path: '/friends/?view=boards&social=ready', prepare: async (p) => { await p.locator('label:has(input[name="week"][value="previous"])').click(); await p.waitForSelector('[data-board]'); } },
  // lobbies and quick match
  ...(['ready', 'fresh', 'under13', 'suspended', 'teen', 'offline'] as const).map((m) => ({ id: `lobbies-${m}`, path: `/lobbies/?social=${m}` })),
  { id: 'lobbies-searching', path: '/lobbies/?social=ready&quick=never', hooks: { timeScale: 1 }, prepare: async (p) => { await p.locator('[data-action="lobby.quick"]').click(); await p.waitForSelector('.k-searching'); } },
  { id: 'lobbies-hosting', path: '/lobbies/?social=ready&quick=never', hooks: { timeScale: 2 }, prepare: async (p) => { await p.locator('[data-action="lobby.quick"]').click(); await p.waitForSelector('.k-searching p', { timeout: 20_000 }); } },
  { id: 'lobbies-ghost', path: '/lobbies/?social=ready&quick=never', hooks: { timeScale: 40 }, prepare: async (p) => { await p.locator('[data-action="lobby.quick"]').click(); await p.waitForSelector('[data-action="lobby.ghost"]', { timeout: 20_000 }); } },
  { id: 'lobbies-timeout', path: '/lobbies/?social=ready&quick=never', hooks: { timeScale: 100 }, prepare: async (p) => { await p.locator('[data-action="lobby.quick"]').click(); await p.waitForSelector('.k-ghostcard [data-action="lobby.quick"]', { timeout: 30_000 }); } },
  // rooms
  { id: 'room-guest', path: '/r/K7Q2MX/?social=ready' },
  { id: 'room-host', path: '/friends/?social=ready', prepare: async (p) => { await p.locator('[data-action="room.new"]').click(); await p.waitForURL(/\/r\//); await p.waitForSelector('.k-seat'); } },
  { id: 'room-full', path: '/r/FULL22/?social=ready' },
  { id: 'room-seat-menu', path: '/r/K7Q2MX/?social=ready', window: true, prepare: click('[data-action="room.seat"]') },
  { id: 'room-under13', path: '/r/K7Q2MX/?social=under13' },
  // the friend link
  { id: 'link-member', path: '/f/BA-9PXMR3/?social=ready' },
  { id: 'link-new', path: '/f/BA-9PXMR3/?social=fresh' },
  { id: 'link-bad', path: '/f/BA-12/?social=ready' },
  { id: 'link-own', path: '/f/BA-7K2Q4X/?social=ready' },
  { id: 'link-under13', path: '/f/BA-9PXMR3/?social=under13' },
  { id: 'link-offline', path: '/f/BA-9PXMR3/?social=offline' },
  { id: 'link-sent', path: '/f/BA-9PXMR3/?social=ready', prepare: async (p) => { await p.locator('[data-action="friendlink.send"]').click(); await p.waitForSelector('.k-linkcard .k-note-line:not(:empty)'); } },
  { id: 'safety', path: '/safety/?social=ready' },
  // the windows
  { id: 'sheet-age', path: '/friends/?social=fresh', window: true, prepare: click('[data-action="social.profile"]') },
  { id: 'sheet-age-adult', path: '/friends/?social=fresh', window: true, prepare: async (p) => { await p.locator('[data-action="social.profile"]').click(); await choose('adult')(p); } },
  { id: 'sheet-under13', path: '/friends/?social=fresh', window: true, prepare: async (p) => { await p.locator('[data-action="social.profile"]').click(); await choose('child')(p); await p.locator('[data-action="sheet.age.next"]').click(); } },
  { id: 'sheet-name-adult', path: '/friends/?social=fresh', window: true, prepare: async (p) => { await p.locator('[data-action="social.profile"]').click(); await choose('adult')(p); await p.locator('[data-action="sheet.age.next"]').click(); await p.locator('#profile-name').fill('www.example.com'); await p.locator('[data-action="sheet.name.create"]').click(); await p.waitForSelector('#profile-note:not(:empty)'); } },
  { id: 'sheet-name-teen', path: '/friends/?social=fresh', window: true, prepare: async (p) => { await p.locator('[data-action="social.profile"]').click(); await choose('teen')(p); await p.locator('[data-action="sheet.age.next"]').click(); } },
  { id: 'sheet-recovery', path: '/friends/?social=fresh', window: true, prepare: async (p) => { await p.locator('[data-action="social.profile"]').click(); await choose('adult')(p); await p.locator('[data-action="sheet.age.next"]').click(); await p.locator('#profile-name').fill('Ada'); await p.locator('[data-action="sheet.name.create"]').click(); await p.waitForSelector('[data-recovery-code]'); } },
  { id: 'sheet-recover', path: '/friends/?social=fresh', window: true, prepare: async (p) => { await p.locator('[data-action="social.recover"]').click(); await p.locator('#recover-code').fill('BA-7K2Q4X'); await p.locator('#recover-recovery').fill('AAAA-AAAA-AAAA-AAAA'); await p.locator('[data-action="sheet.recover.go"]').click(); await p.waitForSelector('#recover-note:not(:empty)'); } },
  { id: 'sheet-friend-menu', path: '/friends/?social=ready', window: true, prepare: click('[data-action="social.menu"]') },
  { id: 'sheet-report', path: '/friends/?social=ready', window: true, prepare: async (p) => { await p.locator('[data-action="social.menu"]').first().click(); await p.locator('dialog [data-dialog-close="report"]').click(); await p.waitForSelector('[data-action="sheet.report.send"]'); } },
  { id: 'sheet-block', path: '/friends/?social=ready', window: true, prepare: async (p) => { await p.locator('[data-action="social.menu"]').first().click(); await p.locator('dialog [data-dialog-close="block"]').click(); await p.waitForSelector('dialog .ba-btn--danger'); } },
  { id: 'sheet-recovery-again', path: '/friends/?social=recovery', window: true, prepare: click('[data-action="recovery.show"]') },
  { id: 'sheet-qr', path: '/r/K7Q2MX/?social=ready', window: true, prepare: click('[data-action="room.qr"]') },
];

const settle = async (page: Page): Promise<void> => {
  await page.waitForSelector('main h1, main h2', { timeout: 20_000 });
  await page.waitForFunction(() => document.documentElement.dataset['socialStatus'] !== undefined || !!document.querySelector('main'), undefined, { timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
};

async function look(s: State, size: { w: number; h: number }, o: { lang?: 'en' | 'tr'; dark?: boolean } = {}): Promise<string[]> {
  const p = await player(site, s.id, { w: size.w, h: size.h, phone: size.w < 800, ...(o.lang ? { lang: o.lang } : {}), ...(o.dark !== undefined ? { dark: o.dark } : {}), hooks: { timeScale: 40, roundSeconds: 6, forceDemo: true, keyboard: true, ...s.hooks } });
  const found: string[] = [];
  try {
    const prefix = o.lang === 'tr' ? '/tr' : '';
    await p.page.goto(`${site.origin}${prefix}${s.path}`);
    await settle(p.page);
    if (s.prepare) await s.prepare(p.page);
    await p.page.waitForTimeout(350);
    await p.page.evaluate(() => window.scrollTo(0, 0));
    for (const x of await inspect(p.page)) found.push(`${s.id} ${size.w}${o.lang === 'tr' ? ' tr' : ''}${o.dark ? ' dark' : ''}: ${x}`);
    await shot(p.page, `${s.id}-${size.w}${o.lang === 'tr' ? '-tr' : ''}${o.dark ? '-dark' : ''}`, { full: !s.window });
    for (const x of p.problems) found.push(`${s.id} ${size.w}: ${x}`);
  } finally {
    await p.close();
  }
  return found;
}

for (const size of SIZES) {
  test(`${size.w} wide: every state of every friends screen keeps the layout rule and passes axe (English)`, async () => {
    test.setTimeout(1_200_000);
    const found: string[] = [];
    for (const s of STATES) found.push(...(await look(s, size)));
    expect(found, found.join('\n')).toEqual([]);
  });
}

for (const size of [SIZES[0], SIZES[4]]) {
  test(`${size.w} wide: the Turkish screens keep the layout rule too (longer words)`, async () => {
    test.setTimeout(1_200_000);
    const found: string[] = [];
    for (const s of STATES) found.push(...(await look(s, size, { lang: 'tr' })));
    expect(found, found.join('\n')).toEqual([]);
  });
}

test('the main screens in the dark theme on a phone and on a laptop', async () => {
  test.setTimeout(600_000);
  const found: string[] = [];
  const main = STATES.filter((s) => ['friends-ready', 'friends-fresh', 'profile-ready', 'boards-ready', 'lobbies-ready', 'room-host', 'link-member', 'safety', 'sheet-recovery', 'friends-tray'].includes(s.id));
  for (const size of [SIZES[1], SIZES[4]]) for (const s of main) found.push(...(await look(s, size, { dark: true })));
  expect(found, found.join('\n')).toEqual([]);
});
