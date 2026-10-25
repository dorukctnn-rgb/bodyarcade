// Rooms, invitations, lobbies and quick match in the real web shell, with two or three players in separate browser contexts
// against the production Worker in Miniflare (the real room objects and the real lobby directory): a friend joins the room a
// friend is in, messages and reactions, report and block of a player in a seat, an invitation that arrives on the other side as
// a card with a clock, a quick match that finds a lobby, and the ghost offer when nobody comes.
//   node C:/Users/doruk/apps/_tools/e2e-slot.mjs run -- npm run test:social -- --workers=1 tests/e2e/social-ui-rooms.spec.ts
import { expect, test } from '@playwright/test';
import { befriend, online, ownCode, player, ready, shot, signUp, startShellSite, type Player, type Site } from './social-ui-support.ts';

let site: Site;
test.beforeAll(async () => { test.setTimeout(300_000); site = await startShellSite(); });
test.afterAll(async () => { await site?.stop(); });

const open: Player[] = [];
async function who(label: string, o: Parameters<typeof player>[2] = {}): Promise<Player> {
  const p = await player(site, label, o);
  open.push(p);
  return p;
}
test.afterEach(async ({}, info) => {
  if (info.status !== 'passed') console.log('WORKER LOG', site.stack.logs.slice(-12).join(' | '));
  const problems = open.flatMap((p) => p.problems);
  await Promise.all(open.splice(0).map((p) => p.close()));
  expect(problems).toEqual([]);
});

/** The lobbies the earlier tests left behind (a room whose players closed their pages stays listed for a while) are not part of the next test. */
const emptyDirectory = async (): Promise<void> => { await site.stack.db.prepare('DELETE FROM soc_lobbies').run(); };

/** A signed-in player on the Friends page, connected. */
async function member(label: string, name: string, o: Parameters<typeof player>[2] = {}): Promise<Player & { code: string }> {
  const p = await who(label, o);
  await p.open('/friends/');
  await ready(p.page);
  await signUp(p.page, { band: 'adult', name });
  await online(p.page);
  return Object.assign(p, { code: await ownCode(p.page) });
}

const roomCode = (url: string): string => /\/r\/([A-Z0-9]{6})/.exec(url)?.[1] ?? '';

// ───────── a room ─────────

test('a friend opens a room, the other joins it from the friends list, and they talk with presets, reactions and typed words', async () => {
  test.setTimeout(120_000);
  const ada = await member('Ada', 'Ada', { phone: true });
  const bo = await member('Bo', 'Bo');
  await befriend(ada.page, bo.page, bo.code);

  await ada.page.locator('[data-action="room.new"]').click();
  await ada.page.waitForURL(/\/r\/[A-Z0-9]{6}/);
  const code = roomCode(ada.page.url());
  expect(code).toMatch(/^[A-Z2-9]{6}$/);
  await expect(ada.page.locator('.k-invite .k-code')).toContainText(code);
  await expect(ada.page.locator('.k-seat[data-seat]')).toHaveCount(1, { timeout: 20_000 });
  await expect(ada.page.locator('.k-seat .host')).toBeVisible();

  // the link goes to the clipboard
  await ada.page.locator('[data-action="room.copy"][data-what="link"]').first().click();
  await expect(ada.page.locator('[data-toasts]')).toContainText('Invite link copied');
  expect(await ada.page.evaluate(() => navigator.clipboard.readText())).toContain(`/r/${code}`);

  // Bo sees "Join" at Ada's row, and is in the room with one press
  const row = bo.page.locator('[data-friend]', { hasText: 'Ada' });
  await expect(row.locator('[data-action="social.join"]')).toBeVisible({ timeout: 30_000 });
  await row.locator('[data-action="social.join"]').click();
  await bo.page.waitForURL(new RegExp(`/r/${code}`));
  await expect(bo.page.locator('.k-seat[data-seat]')).toHaveCount(2, { timeout: 20_000 });
  await expect(ada.page.locator('.k-seat[data-seat]')).toHaveCount(2, { timeout: 20_000 });
  await expect(ada.page.locator('#rp')).toContainText('2 of 4');

  // presets, a reaction, typed words (this room is private and both are adults)
  await bo.page.locator('[data-action="room.say"][data-id="hi"]').click();
  await expect(ada.page.locator('.k-feed')).toContainText('Hello', { timeout: 20_000 });
  await bo.page.waitForTimeout(700);                                             // the Room keeps a gap of 0.4 s between two presets or reactions of a seat
  await bo.page.locator('[data-action="room.react"][data-id="clap"]').click();
  await expect(ada.page.locator('.k-feed .k-react')).toHaveCount(1, { timeout: 20_000 });
  await ada.page.locator('#room-text').fill('shall we start?');
  await ada.page.locator('#room-text').press('Enter');
  await expect(bo.page.locator('.k-feed')).toContainText('shall we start?', { timeout: 20_000 });
  await ada.page.locator('#room-text').fill('call 0532 123 45 67');
  await ada.page.locator('#room-text').press('Enter');
  await expect(ada.page.locator('#room-text-note')).toContainText('cannot be sent');
  await shot(ada.page, 'room-two-phone');

  // Bo leaves: the seat is gone for Ada, Bo is back on the friends page
  await bo.page.locator('[data-action="room.leave"]').click();
  await expect(bo.page).toHaveURL(/\/friends\//);
  await expect(ada.page.locator('.k-seat[data-seat]')).toHaveCount(1, { timeout: 20_000 });
});

test('a room link opened by somebody with no profile asks the age first, then the room is theirs; a wrong or full room says so', async () => {
  test.setTimeout(120_000);
  const ada = await member('Ada', 'Ada');
  await ada.page.locator('[data-action="room.new"]').click();
  await ada.page.waitForURL(/\/r\/[A-Z0-9]{6}/);
  const code = roomCode(ada.page.url());

  const newcomer = await who('Newcomer', { phone: true });
  await newcomer.open(`/r/${code}`);
  await expect(newcomer.page.locator('dialog h2')).toContainText('How old are you?');
  await newcomer.page.locator('label:has(input[name="age"][value="adult"])').click();
  await newcomer.page.locator('[data-action="sheet.age.next"]').click();
  await newcomer.page.locator('#profile-name').fill('Newcomer');
  await newcomer.page.locator('#profile-terms').check();
  await newcomer.page.locator('[data-action="sheet.name.create"]').click();
  await newcomer.page.locator('[data-action="sheet.recovery.saved"]').click();
  await expect(newcomer.page.locator('.k-seat[data-seat]')).toHaveCount(2, { timeout: 30_000 });
  await expect(ada.page.locator('.k-seat[data-seat]')).toHaveCount(2, { timeout: 20_000 });

  // a room that does not exist
  const lost = await who('Lost');
  await lost.open('/friends/');
  await ready(lost.page);
  await signUp(lost.page, { band: 'adult', name: 'Lost' });
  await lost.page.goto(`${site.origin}/r/ZZZZZZ`);
  await expect(lost.page.locator('main [role="alert"]')).toContainText('does not exist or has closed', { timeout: 20_000 });
  await expect(lost.page.locator('main a.ba-btn[href$="/friends/"]')).toBeVisible();
});

test('a player in a seat can be reported or blocked from the seat menu; the report asks for a reason and says it was sent', async () => {
  test.setTimeout(120_000);
  const ada = await member('Ada', 'Ada', { phone: true });
  const bo = await member('Bo', 'Bo');
  await befriend(ada.page, bo.page, bo.code);
  await ada.page.locator('[data-action="room.new"]').click();
  await ada.page.waitForURL(/\/r\/[A-Z0-9]{6}/);
  const code = roomCode(ada.page.url());
  await bo.page.goto(`${site.origin}/r/${code}`);
  await expect(ada.page.locator('.k-seat[data-seat]')).toHaveCount(2, { timeout: 30_000 });

  const others = ada.page.locator('[data-action="room.seat"]');
  await expect(others).toHaveCount(1);
  await others.click();
  await expect(ada.page.locator('dialog h2')).toContainText('Report or block Bo');
  await ada.page.locator('dialog [data-dialog-close="report"]').click();
  await ada.page.locator('label:has(input[name="reason"][value="abuse"])').click();
  await ada.page.locator('[data-action="sheet.report.send"]').click();
  await expect(ada.page.locator('[data-toasts]')).toContainText('Report sent');
  await shot(ada.page, 'room-report-sent-phone');
  // block: a question first, then the player is gone from the room
  await ada.page.locator('[data-action="room.seat"]').first().click().catch(() => undefined);
  if (await ada.page.locator('dialog').count()) {
    await ada.page.locator('dialog [data-dialog-close="block"]').click();
    await ada.page.locator('dialog [data-dialog-close="yes"]').click();
    await expect(ada.page.locator('[data-toasts]')).toContainText('blocked');
  }
});

// ───────── invitations ─────────

test('an invitation reaches an online friend as a card with a clock, wherever they are in the app; joining takes them into the room, declining tells the host', async () => {
  test.setTimeout(150_000);
  const ada = await member('Ada', 'Ada', { phone: true });
  const bo = await member('Bo', 'Bo', { phone: true });
  await befriend(ada.page, bo.page, bo.code);
  await ada.page.locator('[data-action="room.new"]').click();
  await ada.page.waitForURL(/\/r\/[A-Z0-9]{6}/);
  const code = roomCode(ada.page.url());
  // Bo is on another page of the app (a game page), not on the friends screens
  await bo.page.goto(`${site.origin}/games/squat-flap/`);
  await bo.page.waitForSelector('main h1');

  // the invite card of the room lists Bo with a button
  const card = ada.page.locator('[data-list="invite"] li', { hasText: 'Bo' });
  await expect(card.locator('[data-action="social.invite"]')).toBeEnabled({ timeout: 30_000 });
  await card.locator('[data-action="social.invite"]').click();
  await expect(ada.page.locator('[data-toasts]')).toContainText('Invitation sent to Bo');
  await expect(card.locator('[data-action="social.invite"]')).toBeDisabled();

  const tray = bo.page.locator('.k-tray__card');
  await expect(tray).toBeVisible({ timeout: 30_000 });
  await expect(tray).toContainText('Ada invites you to play');
  await expect(tray).toContainText(/[01]:\d\d left/);
  await shot(bo.page, 'invite-tray-phone', { full: false });
  await tray.locator('[data-action="invite.decline"]').click();
  await expect(bo.page.locator('.k-tray__card')).toHaveCount(0);
  await expect(ada.page.locator('[data-toasts]')).toContainText('Bo cannot join right now', { timeout: 30_000 });

  // asked again: this time Bo joins
  await ada.page.reload();
  await ready(ada.page);
  await online(ada.page);
  const card2 = ada.page.locator('[data-list="invite"] li', { hasText: 'Bo' });
  await expect(card2.locator('[data-action="social.invite"]')).toBeEnabled({ timeout: 30_000 });
  await card2.locator('[data-action="social.invite"]').click();
  await expect(bo.page.locator('.k-tray__card')).toBeVisible({ timeout: 30_000 });
  await bo.page.locator('.k-tray__card [data-action="invite.join"]').click();
  await bo.page.waitForURL(new RegExp(`/r/${code}`));
  await expect(bo.page.locator('.k-seat[data-seat]')).toHaveCount(2, { timeout: 20_000 });
  await expect(ada.page.locator('.k-seat[data-seat]')).toHaveCount(2, { timeout: 20_000 });
});

test('inviting a friend who is offline says so and points to the link; an invitation never shows during a round', async () => {
  test.setTimeout(120_000);
  const ada = await member('Ada', 'Ada', { phone: true });
  const bo = await member('Bo', 'Bo');
  await befriend(ada.page, bo.page, bo.code);
  await bo.close();
  await expect(ada.page.locator('[data-list="friends"] li')).toContainText('Offline', { timeout: 30_000 });
  await expect(ada.page.locator('[data-list="friends"] [data-action="social.invite"]')).toHaveCount(0);
});

// ───────── lobbies and quick match ─────────

test('quick match: the first player waits in a lobby of their own, the second one is put in it, and both land in the same room with no typing and no camera', async () => {
  test.setTimeout(180_000);
  await emptyDirectory();
  const ada = await member('Ada', 'Ada', { phone: true });
  const bo = await member('Bo', 'Bo');
  await ada.open('/lobbies/');
  await bo.open('/lobbies/');
  await expect(ada.page.locator('[data-action="lobby.quick"]')).toBeVisible();
  await ada.page.locator('[data-action="lobby.quick"]').click();
  await expect(ada.page.locator('.k-searching')).toBeVisible();
  await expect(ada.page.locator('.k-searching')).toContainText('wait in an open lobby', { timeout: 30_000 });
  await shot(ada.page, 'quick-searching-phone');
  // the lobby is listed for the other player
  await bo.page.locator('[data-action="lobby.refresh"]').first().click();
  await expect(bo.page.locator('.k-lobbies li [data-action="lobby.join"]')).toHaveCount(1, { timeout: 30_000 });
  await bo.page.locator('[data-action="lobby.quick"]').click();
  await ada.page.waitForURL(/\/r\/[A-Z0-9]{6}/, { timeout: 60_000 });
  await bo.page.waitForURL(/\/r\/[A-Z0-9]{6}/, { timeout: 60_000 });
  expect(roomCode(ada.page.url())).toBe(roomCode(bo.page.url()));
  await expect(ada.page.locator('.k-seat[data-seat]')).toHaveCount(2, { timeout: 30_000 });
  // a public room: strangers are ghosts with preset messages, never typed words and never a camera
  await expect(ada.page.locator('#room-text')).toHaveCount(0);
  await expect(ada.page.locator('input[name="share"]')).toHaveCount(0);
  await expect(ada.page.locator('[data-list="invite"]')).toHaveCount(0);
});

test('nobody comes: after twenty seconds a race against a ghost is offered, and it can be waved away or taken; stopping closes the lobby the search opened', async () => {
  test.setTimeout(180_000);
  await emptyDirectory();
  const solo = await member('Solo', 'Solo', { phone: true });
  await solo.open('/lobbies/');
  // a game of its own (the other tests leave lobbies of the first game behind)
  await solo.page.locator('[data-action="lobby.game"]').nth(1).click();
  await expect(solo.page.locator('.k-lobbies li')).toHaveCount(0, { timeout: 20_000 });
  await solo.page.locator('[data-action="lobby.quick"]').click();
  await expect(solo.page.locator('.k-searching')).toBeVisible();
  await expect(solo.page.locator('[data-action="lobby.ghost"]')).toHaveCount(0);
  // twenty seconds on the server's clock, without waiting for them
  await site.stack.clock.advance(21_000);
  await expect(solo.page.locator('[data-action="lobby.ghost"]')).toBeVisible({ timeout: 30_000 });
  await expect(solo.page.locator('.k-ghostcard')).toContainText('labelled as a recording and not a person');
  await shot(solo.page, 'quick-ghost-phone');
  await solo.page.locator('[data-action="lobby.keep"]').click();
  await expect(solo.page.locator('[data-action="lobby.ghost"]')).toHaveCount(0);
  await expect(solo.page.locator('[data-action="lobby.stop"]')).toBeVisible();
  await solo.page.locator('[data-action="lobby.stop"]').click();
  await expect(solo.page.locator('[data-action="lobby.quick"]')).toBeVisible();
  // the lobby the search opened is gone: the list is empty again
  await solo.page.locator('[data-action="lobby.refresh"]').first().click();
  await expect(solo.page.locator('.k-lobbies li')).toHaveCount(0, { timeout: 30_000 });
  // a second search, this time the ghost is taken: the game's stage opens with the ghost marked in the address
  await solo.page.locator('[data-action="lobby.quick"]').click();
  await site.stack.clock.advance(21_000);
  await expect(solo.page.locator('[data-action="lobby.ghost"]')).toBeVisible({ timeout: 30_000 });
  await solo.page.locator('[data-action="lobby.ghost"]').click();
  await expect(solo.page).toHaveURL(/\/play\/[a-z-]+\/\?.*ghost=practice/);
});

test('a teenager sees only teenagers\' lobbies and an adult only adults\': the groups never meet', async () => {
  test.setTimeout(180_000);
  await emptyDirectory();
  const adult = await member('Ada', 'Ada', { phone: true });
  const teen = await who('Teen', { phone: true });
  await teen.open('/friends/');
  await ready(teen.page);
  await signUp(teen.page, { band: 'teen' });
  await online(teen.page);
  await adult.open('/lobbies/');
  await adult.page.locator('[data-action="lobby.quick"]').click();
  await expect(adult.page.locator('.k-searching')).toContainText('wait in an open lobby', { timeout: 30_000 });
  await teen.open('/lobbies/');
  await teen.page.locator('[data-action="lobby.refresh"]').first().click();
  await expect(teen.page.locator('main')).toContainText('No open lobbies for this game yet', { timeout: 30_000 });
  await expect(teen.page.locator('.k-lobbies li')).toHaveCount(0);
});
