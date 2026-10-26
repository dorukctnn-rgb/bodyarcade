// A Pro game in a room, through the practice ports of the real shell (the real Worker and its Room have their own suite, tests/live/pro.spec.ts):
// what the host sees when a room cannot be made for want of Pro, where that leads, what the room says when the Room or the Worker will not
// take a Pro game, and what everybody sees when the host's proof runs out while the room waits.
//   BA_SHOTS_DIR=... node C:/Users/doruk/apps/_tools/e2e-slot.mjs run -- npx playwright test -c tests/social/playwright.config.ts tests/e2e/social-ui-pro.spec.ts --workers=1
import { expect, test, type Page } from '@playwright/test';
import { inspect, player, shot, startShellSite, type Player, type Site } from './social-ui-support.ts';

let site: Site;
test.beforeAll(async () => { test.setTimeout(300_000); site = await startShellSite(); });
test.afterAll(async () => { await site?.stop(); });

const open: Player[] = [];
test.afterEach(async () => {
  const problems = open.flatMap((p) => p.problems);
  await Promise.all(open.splice(0).map((p) => p.close()));
  expect(problems).toEqual([]);
});

const control = (page: Page, js: string): Promise<unknown> => page.evaluate(`(() => { const c = window.__BA_SOCIAL__; ${js} })()`);

async function host(label: string, o: Parameters<typeof player>[2] = {}, path = '/friends/?social=ready'): Promise<Player> {
  const p = await player(site, label, { phone: true, ...o });
  open.push(p);
  await p.open(path);
  return p;
}

async function inRoom(p: Player): Promise<void> {
  await p.page.locator('[data-action="room.new"]').click();
  await p.page.waitForURL(/\/r\//);
  await p.page.waitForSelector('.k-seat');
}

test('a room that cannot be made for want of Pro says why in a window, and the window leads to the Pro page of the game or back', async () => {
  const p = await host('host');
  await control(p.page, "c.refuseCreate('expired');");
  await p.page.locator('[data-action="room.new"]').click();
  const dialog = p.page.locator('dialog[open]');
  await expect(dialog).toContainText('This game needs Pro');
  await expect(dialog).toContainText('renews online');
  await expect(dialog).toContainText('Squat Flap');
  expect(await inspect(p.page)).toEqual([]);
  await shot(p.page, 'pro-sheet-390', { full: false });
  // not now: the window closes, the player stays where they were, and the refusal is spent
  await dialog.getByRole('button', { name: 'Not now' }).click();
  await expect(p.page.locator('dialog')).toHaveCount(0);
  expect(new URL(p.page.url()).pathname).toBe('/friends/');
  // again, and this time to the Pro page of the game
  await p.page.locator('[data-action="room.new"]').click();
  await p.page.locator('dialog[open]').getByRole('button', { name: 'See Pro' }).click();
  await p.page.waitForURL(/\/pro\/\?game=squat-flap/);
  await expect(p.page.locator('main h1')).toBeVisible();
  // rooms open again once the refusal is lifted
  await p.page.goBack();
  await p.page.waitForSelector('[data-action="room.new"]');
  await control(p.page, 'c.refuseCreate(null);');
  await inRoom(p);
  await expect(p.page.locator('.k-pronote')).toHaveCount(0);
});

test('in a room, a refused Pro game is told to the host with a way to a free game, and gone once it is dismissed; a proof that ran out is told to everybody', async () => {
  const p = await host('host');
  await inRoom(p);
  const note = p.page.locator('.k-pronote');
  await expect(note).toHaveCount(0);

  await control(p.page, "c.pro('refused', 'pad-work');");
  await expect(note).toBeVisible();
  await expect(note).toContainText('This game needs Pro');
  await expect(note).toContainText('did not take this game');
  await expect(note.getByRole('link', { name: 'See Pro' })).toHaveAttribute('href', '/pro/?game=pad-work');
  expect(await inspect(p.page)).toEqual([]);
  await shot(p.page, 'pro-note-390');

  // the way to a free game: the picker of the host opens, and cancelling leaves the note where it is
  await note.getByRole('button', { name: 'Pick a free game' }).click();
  await expect(p.page.locator('dialog[open]')).toContainText('The host picks the game');
  await p.page.locator('dialog[open]').getByRole('button', { name: 'Cancel' }).click();
  await expect(p.page.locator('dialog')).toHaveCount(0);
  await expect(note).toBeVisible();

  // each reason has its own words
  for (const [reason, words] of [['none', 'when its host has Pro'], ['expired', 'renews online'], ['invalid', 'could not be checked on this device']] as const) {
    await control(p.page, `c.pro('${reason}', 'pad-work');`);
    await expect(note).toContainText(words);
  }

  // picking a free game, or not now, ends it
  await note.getByRole('button', { name: 'Not now' }).click();
  await expect(note).toHaveCount(0);

  // the proof of the host ran out while the room waits: one line for everybody, gone when it is renewed
  const line = p.page.locator('[data-banner="pro-waiting"]');
  await control(p.page, 'c.proWaiting(true);');
  await expect(line).toContainText('being confirmed again');
  expect(await inspect(p.page)).toEqual([]);
  await shot(p.page, 'pro-waiting-390');
  await control(p.page, 'c.proWaiting(false);');
  await expect(line).toHaveCount(0);
});

test('the same in Turkish on a small phone: the window, the note and the waiting line keep the layout rule', async () => {
  const p = await host('host-tr', { lang: 'tr', w: 360, h: 780 }, '/tr/friends/?social=ready');
  const found: string[] = [];
  await control(p.page, "c.refuseCreate('none');");
  await p.page.locator('[data-action="room.new"]').click();
  await expect(p.page.locator('dialog[open]')).toContainText('Bu oyun için Pro gerekir');
  found.push(...(await inspect(p.page)));
  await shot(p.page, 'pro-sheet-360-tr', { full: false });
  await p.page.locator('dialog[open]').getByRole('button', { name: 'Şimdi değil' }).click();
  await control(p.page, "c.refuseCreate(null);");
  await inRoom(p);
  await control(p.page, "c.pro('expired', 'pad-work');");
  await expect(p.page.locator('.k-pronote')).toContainText('çevrimiçi yenileniyor');
  found.push(...(await inspect(p.page)));
  await shot(p.page, 'pro-note-360-tr');
  await control(p.page, 'c.proWaiting(true);');
  await expect(p.page.locator('[data-banner="pro-waiting"]')).toContainText('yeniden doğrulanıyor');
  found.push(...(await inspect(p.page)));
  expect(found, found.join('\n')).toEqual([]);
});
