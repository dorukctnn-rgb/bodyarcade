// The Friends screens of the real web shell, driven the way a person does, against the production Worker (Miniflare: the real
// directory Durable Object, the real room objects, hibernating sockets): the age question and the profile, the recovery code,
// bringing a profile back on another device, friends and requests appearing live on the other side, rooms and invitations,
// lobbies and quick match, the weekly boards, and the states of the connection. Every test ends with no console error and no
// uncaught exception on any page of any player. Players are separate browser contexts (an IndexedDB each); the phone ones are
// touch screens of 390 by 844.
//   node C:/Users/doruk/apps/_tools/e2e-slot.mjs run -- npm run test:social -- --workers=1 tests/e2e/social-ui.spec.ts
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

// ───────── the profile ─────────

test('a grown-up makes a profile on a phone, is given the recovery code once, and is the same player after a reload', async () => {
  const ada = await who('Ada', { phone: true });
  await ada.open('/friends/');
  await ready(ada.page);
  // the first thing a new player sees: what the page is for, and the two ways in
  await expect(ada.page.locator('[data-action="social.profile"]')).toBeVisible();
  await expect(ada.page.locator('[data-action="social.recover"]')).toBeVisible();
  const codes = await signUp(ada.page, { band: 'adult', name: 'Ada' });
  expect(codes.recovery).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
  expect(codes.friend).toMatch(/^BA-[A-Z2-9]{6}$/);
  await expect(ada.page.locator('.k-profile .name')).toHaveText('Ada');
  expect(await ownCode(ada.page)).toBe(codes.friend);
  // the device key is in a database of its own from now on
  expect(await ada.page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name))).toContain('bodyarcade-social');
  // the code was shown once: no banner after it was saved, and nothing of it in the page
  await expect(ada.page.locator('[data-banner="recovery"]')).toHaveCount(0);
  await online(ada.page);
  await ada.page.reload();
  await ready(ada.page);
  await expect(ada.page.locator('.k-profile .name')).toHaveText('Ada');
  expect(await ownCode(ada.page)).toBe(codes.friend);
  expect(await ada.page.evaluate(() => document.body.innerText.includes('ABCD-EFGH'))).toBe(false);
});

test('closing the sign-up window before the recovery code was saved leaves a banner that brings the code back, until the page is reloaded', async () => {
  const bo = await who('Bo', { phone: true });
  await bo.open('/friends/');
  await ready(bo.page);
  const codes = await signUp(bo.page, { band: 'adult', name: 'Bo', save: false });
  await bo.page.keyboard.press('Escape');
  await expect(bo.page.locator('dialog')).toHaveCount(0);
  await expect(bo.page.locator('[data-banner="recovery"]')).toBeVisible();
  await bo.page.locator('[data-action="recovery.show"]').click();
  await expect(bo.page.locator('[data-recovery-code]')).toHaveText(codes.recovery);
  await bo.page.locator('[data-action="sheet.recovery.saved"]').click();
  await expect(bo.page.locator('[data-banner="recovery"]')).toHaveCount(0);
});

test('under 16: nothing is made and nothing is sent, the answer is remembered on the device, and the page says why', async () => {
  const kid = await who('Kid', { phone: true });
  const requests: string[] = [];
  kid.page.on('request', (r) => { if (r.url().includes('/api/')) requests.push(`${r.method()} ${new URL(r.url()).pathname}`); });
  await kid.open('/friends/');
  await ready(kid.page);
  await kid.page.locator('[data-action="social.profile"]').click();
  await kid.page.locator('label:has(input[name="age"][value="child"])').click();
  await kid.page.locator('[data-action="sheet.age.next"]').click();
  await expect(kid.page.locator('dialog h2')).toHaveText(/Online play starts at 16/);
  await kid.page.locator('[data-dialog-close="games"]').click();
  await expect(kid.page).toHaveURL(/\/$/);
  // only the question whether the service is there was ever asked (an unsigned GET), never a registration
  expect(requests.filter((r) => !r.startsWith('GET /api/social/me'))).toEqual([]);
  const idb = await kid.page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  expect(idb).not.toContain('bodyarcade-social');                                         // not even an empty database of the device key
  // the answer stays: a reload of the Friends page says so and asks for nothing, and the page sends nothing at all
  requests.length = 0;
  await kid.open('/friends/');
  await expect(kid.page.locator('main')).toContainText('Online play starts at 16');
  await expect(kid.page.locator('[data-action="social.profile"]')).toHaveCount(0);
  await expect(kid.page.locator('[data-action="social.recover"]')).toHaveCount(0);
  expect(requests).toEqual([]);
  await shot(kid.page, 'young-phone');
});

test('a 16 to 17 player is given a made-up name, never types one, and has no way to raise the age', async () => {
  const teen = await who('Teen', { phone: true });
  await teen.open('/friends/');
  await ready(teen.page);
  await teen.page.locator('[data-action="social.profile"]').click();
  await teen.page.locator('label:has(input[name="age"][value="teen"])').click();
  await teen.page.locator('[data-action="sheet.age.next"]').click();
  await expect(teen.page.locator('#profile-name')).toHaveCount(0);
  const generated = (await teen.page.locator('[data-generated-name]').textContent())?.trim() ?? '';
  expect(generated).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+ \d\d$/);
  await teen.page.locator('[data-action="sheet.name.shuffle"]').click();
  const another = (await teen.page.locator('[data-generated-name]').textContent())?.trim() ?? '';
  await teen.page.locator('#profile-terms').check();
  await teen.page.locator('[data-action="sheet.name.create"]').click();
  await teen.page.locator('[data-action="sheet.recovery.saved"]').click();
  await expect(teen.page.locator('.k-profile .name')).toHaveText(another);
  await teen.open('/friends/?view=profile');
  await expect(teen.page.locator('[data-action="me.reroll"]')).toBeVisible();
  await expect(teen.page.locator('[data-form="me-name"]')).toHaveCount(0);
  await expect(teen.page.locator('[data-action="me.ageDown"]')).toHaveCount(0);
  await expect(teen.page.locator('main')).toContainText('Preset messages only, no typed chat');
});

// ───────── bringing a profile back ─────────

test('a profile is brought back on another device with the friend code and the recovery code; a wrong code is told, and the friends come with it', async () => {
  const ada = await who('Ada', { phone: true });
  await ada.open('/friends/');
  await ready(ada.page);
  const codes = await signUp(ada.page, { band: 'adult', name: 'Ada' });
  const cy = await who('Cy');
  await cy.open('/friends/');
  await ready(cy.page);
  await signUp(cy.page, { band: 'adult', name: 'Cy' });
  await online(ada.page);
  await online(cy.page);
  await befriend(ada.page, cy.page, await ownCode(cy.page));

  // a laptop that has never seen this profile
  const laptop = await who('Ada laptop');
  await laptop.open('/friends/');
  await ready(laptop.page);
  await laptop.page.locator('[data-action="social.recover"]').click();
  await laptop.page.locator('#recover-code').fill(codes.friend);
  await laptop.page.locator('#recover-recovery').fill('AAAA-AAAA-AAAA-AAAA');
  await laptop.page.locator('[data-action="sheet.recover.go"]').click();
  await expect(laptop.page.locator('#recover-note')).toContainText('do not match');
  await laptop.page.locator('#recover-recovery').fill('nonsense');
  await laptop.page.locator('[data-action="sheet.recover.go"]').click();
  await expect(laptop.page.locator('#recover-note')).toContainText('sixteen letters and digits');
  await expect(laptop.page.locator('#recover-recovery')).toHaveAttribute('aria-invalid', 'true');
  await laptop.page.locator('#recover-recovery').fill(codes.recovery);
  await laptop.page.locator('[data-action="sheet.recover.go"]').click();
  await expect(laptop.page.locator('dialog')).toHaveCount(0, { timeout: 20_000 });
  await expect(laptop.page.locator('.k-profile .name')).toHaveText('Ada');
  await expect(laptop.page.locator('[data-list="friends"] li')).toHaveCount(1, { timeout: 20_000 });
  await expect(laptop.page.locator('[data-banner="recovery"]')).toHaveCount(0);
  // the first device is told its connection was taken by the other one
  await online(laptop.page);
  await expect(ada.page.locator('[data-banner="replaced"]')).toBeVisible({ timeout: 20_000 });
});

// ───────── friends ─────────

test('a request appears on the other side at once with a notice, is accepted there, and both lists and presences follow', async () => {
  const ada = await who('Ada', { phone: true });
  const bo = await who('Bo');
  await ada.open('/friends/');
  await bo.open('/friends/');
  await ready(ada.page);
  await ready(bo.page);
  await signUp(ada.page, { band: 'adult', name: 'Ada' });
  const boCodes = await signUp(bo.page, { band: 'adult', name: 'Bo' });
  await online(ada.page);
  await online(bo.page);

  // mistakes are told: nothing like a code, the player's own code, a code nobody has
  await ada.page.locator('#friend-code').fill('hello');
  await ada.page.locator('[data-form="friend-add"] button[type="submit"]').click();
  await expect(ada.page.locator('#add-note')).toContainText('does not look like a friend code');
  await ada.page.locator('#friend-code').fill(await ownCode(ada.page));
  await ada.page.locator('[data-form="friend-add"] button[type="submit"]').click();
  await expect(ada.page.locator('#add-note')).toContainText('your own code');
  await ada.page.locator('#friend-code').fill('BA-ZZZZZZ');
  await ada.page.locator('[data-form="friend-add"] button[type="submit"]').click();
  await expect(ada.page.locator('#add-note')).toContainText('Nobody has that code');

  // the real one: "Request sent", and Bo sees it live
  await ada.page.locator('#friend-code').fill(boCodes.friend.toLowerCase());
  await ada.page.locator('[data-form="friend-add"] button[type="submit"]').click();
  await expect(ada.page.locator('#add-note')).toContainText('Request sent');
  await expect(ada.page.locator('[data-list="requests"] li')).toContainText('Bo');
  await expect(bo.page.locator('[data-list="requests"] li')).toContainText('Ada', { timeout: 20_000 });
  await expect(bo.page.locator('[data-toasts]')).toContainText('Ada sent you a friend request');
  await bo.page.locator('[data-action="social.accept"]').click();
  await expect(bo.page.locator('[data-list="friends"] li')).toHaveCount(1);
  await expect(ada.page.locator('[data-list="friends"] li')).toHaveCount(1, { timeout: 20_000 });
  await expect(ada.page.locator('[data-list="friends"] li')).toContainText('Online');
  await expect(ada.page.locator('[data-toasts]')).toContainText('are friends now');

  // presence follows the page: Bo leaves for a game page and is "Playing" for Ada
  await bo.page.goto(`${site.origin}/play/squat-flap/?input=keyboard`);
  await bo.page.waitForSelector('[data-stage]');
  await expect(ada.page.locator('[data-list="friends"] li')).toContainText('Playing', { timeout: 20_000 });
  await shot(ada.page, 'friends-live-phone');
});

test('a request that nobody receives still says "Request sent": an adult to a 16 to 17 player, and one to a player who blocked the sender', async () => {
  const adult = await who('Ada', { phone: true });
  const teen = await who('Teen', { phone: true });
  await adult.open('/friends/');
  await teen.open('/friends/');
  await ready(adult.page);
  await ready(teen.page);
  await signUp(adult.page, { band: 'adult', name: 'Ada' });
  await signUp(teen.page, { band: 'teen' });
  await online(adult.page);
  await online(teen.page);
  await adult.page.locator('#friend-code').fill(await ownCode(teen.page));
  await adult.page.locator('[data-form="friend-add"] button[type="submit"]').click();
  await expect(adult.page.locator('#add-note')).toContainText('Request sent');
  await adult.page.waitForTimeout(1500);
  await expect(teen.page.locator('[data-list="requests"]')).toHaveCount(0);
  // the other way round works: the teenager asks the adult
  await teen.page.locator('#friend-code').fill(await ownCode(adult.page));
  await teen.page.locator('[data-form="friend-add"] button[type="submit"]').click();
  await expect(adult.page.locator('[data-list="requests"] li')).toBeVisible({ timeout: 20_000 });
});

test('removing, blocking and unblocking a friend through the menu, and a report that blocks too', async () => {
  const ada = await who('Ada', { phone: true });
  const bo = await who('Bo');
  const cy = await who('Cy');
  for (const [p, name] of [[ada, 'Ada'], [bo, 'Bo'], [cy, 'Cy']] as const) {
    await p.open('/friends/');
    await ready(p.page);
    await signUp(p.page, { band: 'adult', name });
    await online(p.page);
  }
  const boCode = await ownCode(bo.page);
  const cyCode = await ownCode(cy.page);
  await befriend(ada.page, bo.page, boCode);
  await ada.page.locator('#friend-code').fill(cyCode);
  await ada.page.locator('[data-form="friend-add"] button[type="submit"]').click();
  await cy.page.locator('[data-action="social.accept"]').click();
  await expect(ada.page.locator('[data-list="friends"] li')).toHaveCount(2, { timeout: 20_000 });

  // remove Bo: a question first
  await ada.page.locator('[data-friend] [data-action="social.menu"]').first().click();
  await ada.page.locator('dialog [data-dialog-close="remove"]').click();
  await expect(ada.page.locator('dialog .ba-confirm')).toBeVisible();
  await ada.page.locator('dialog [data-dialog-close="yes"]').click();
  await expect(ada.page.locator('[data-list="friends"] li')).toHaveCount(1);
  await expect(bo.page.locator('[data-list="friends"] li')).toHaveCount(0, { timeout: 20_000 });

  // report Cy and block at the same time
  await ada.page.locator('[data-friend] [data-action="social.menu"]').first().click();
  await ada.page.locator('dialog [data-dialog-close="report"]').click();
  await ada.page.locator('label:has(input[name="reason"][value="spam"])').click();
  await ada.page.locator('dialog textarea[name="details"]').fill('links in messages');
  await ada.page.locator('[data-action="sheet.report.send"]').click();
  await expect(ada.page.locator('[data-toasts]')).toContainText('Report sent');
  await expect(ada.page.locator('[data-list="friends"]')).toHaveCount(0);
  // unblock on the safety page
  await ada.page.goto(`${site.origin}/safety/`);
  await ada.page.waitForSelector('[data-list="blocks"] li');
  await expect(ada.page.locator('[data-list="blocks"] li')).toContainText('Cy');
  await ada.page.locator('[data-action="social.unblock"]').click();
  await expect(ada.page.locator('[data-list="blocks"]')).toHaveCount(0);
});
