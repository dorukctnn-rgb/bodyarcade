// My profile, the friend link, the weekly boards, the states of the connection and the Turkish screens, in the real web shell
// against the production Worker in Miniflare: renaming with the filter's answers and the daily limit, the switches of privacy and
// play, a new friend code and a new recovery code, downloading and deleting the data, stepping down an age group, a friend link
// opened by somebody with no profile, boards filled by real rounds, a connection taken by another tab, cut and brought back, a
// service that does not answer, a profile deleted on another device.
//   node C:/Users/doruk/apps/_tools/e2e-slot.mjs run -- npm run test:social -- --workers=1 tests/e2e/social-ui-profile.spec.ts
import { expect, test } from '@playwright/test';
import { befriend, inspect, online, ownCode, player, ready, shot, signUp, startShellSite, type Codes, type Player, type Site } from './social-ui-support.ts';

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

async function member(label: string, name: string, o: Parameters<typeof player>[2] = {}): Promise<Player & Codes & { code: string }> {
  const p = await who(label, o);
  await p.open('/friends/');
  await ready(p.page);
  const codes = await signUp(p.page, { band: 'adult', name });
  await online(p.page);
  return Object.assign(p, codes, { code: await ownCode(p.page) });
}

const profileOf = (p: Player): Promise<{ fid: string; name: string; band: string } | null> => p.page.evaluate(() => (window.__BA_SOCIAL_PORTS__?.social.state().profile ?? null) as never);

// ───────── my profile ─────────

test('rename: the filter\'s answer is told in words, a new name shows everywhere, and the fourth change of a day waits', async () => {
  test.setTimeout(120_000);
  const ada = await member('Ada', 'Ada', { phone: true });
  await ada.open('/friends/?view=profile');
  await expect(ada.page.locator('h1')).toHaveText('My profile');
  await expect(ada.page.locator('.k-me__name')).toHaveText('Ada');
  const rename = async (name: string): Promise<void> => {
    await ada.page.locator('#me-name').fill(name);
    await ada.page.locator('[data-form="me-name"] button[type="submit"]').click();
  };
  await rename('www.example.com');
  await expect(ada.page.locator('[data-form="me-name"] .k-note-line')).toContainText('Names cannot hold links');
  await expect(ada.page.locator('[data-form="me-name"] .k-note-line')).toHaveClass(/is-error/);
  await rename('Ada!!');
  await expect(ada.page.locator('[data-form="me-name"] .k-note-line')).toContainText('letters, digits, spaces');
  await rename('Ada Lovelace');
  await expect(ada.page.locator('[data-form="me-name"] .k-note-line')).toContainText('Name changed to Ada Lovelace');
  await expect(ada.page.locator('.k-me__name')).toHaveText('Ada Lovelace');
  await rename('Ada L');
  await expect(ada.page.locator('.k-me__name')).toHaveText('Ada L');
  await rename('Ada Lo');
  await expect(ada.page.locator('.k-me__name')).toHaveText('Ada Lo');
  await rename('Ada Lov');
  await expect(ada.page.locator('[data-form="me-name"] .k-note-line')).toContainText('too often');
  await expect(ada.page.locator('.k-me__name')).toHaveText('Ada Lo');
  await ada.open('/friends/');
  await expect(ada.page.locator('.k-profile .name')).toHaveText('Ada Lo');
});

test('appearing offline hides the player from friends and brings them back; the region and the usual level are kept', async () => {
  test.setTimeout(120_000);
  const ada = await member('Ada', 'Ada', { phone: true });
  const bo = await member('Bo', 'Bo');
  await befriend(ada.page, bo.page, bo.code);
  await expect(bo.page.locator('[data-list="friends"] li')).toContainText('Online', { timeout: 20_000 });
  await ada.open('/friends/?view=profile');
  await ada.page.locator('label[for="me-dnd"]').click();
  await expect(ada.page.locator('#me-dnd')).toBeChecked();
  await expect(bo.page.locator('[data-list="friends"] li')).toContainText('Offline', { timeout: 20_000 });
  await ada.page.locator('label[for="me-dnd"]').click();
  await expect(bo.page.locator('[data-list="friends"] li')).toContainText('Online', { timeout: 20_000 });
  // region and level
  await ada.page.locator('#me-region').selectOption('na');
  await expect(ada.page.locator('[data-form="me-prefs"] ~ .k-note-line')).toContainText('Saved');
  await ada.page.locator('label:has(input[name="level"][value="hard"])').click();
  await expect(ada.page.locator('input[name="level"][value="hard"]')).toBeChecked();
  await ada.page.reload();
  await ready(ada.page);
  await expect(ada.page.locator('#me-region')).toHaveValue('na');
  await expect(ada.page.locator('input[name="level"][value="hard"]')).toBeChecked();
  // the lobby page starts from the saved level and region
  await ada.open('/lobbies/');
  await expect(ada.page.locator('input[name="band"][value="hard"]')).toBeChecked();
  await expect(ada.page.locator('#lobby-region')).toHaveValue('na');
});

test('a new friend code makes the old link stale; a new recovery code replaces the old and is shown once; the data can be downloaded', async () => {
  test.setTimeout(120_000);
  const ada = await member('Ada', 'Ada', { phone: true });
  const oldCode = ada.code;
  await ada.open('/friends/?view=profile');
  await ada.page.locator('[data-action="me.renewCode"]').click();
  await expect(ada.page.locator('dialog .ba-confirm')).toContainText('The old code and link stop working');
  await ada.page.locator('dialog [data-dialog-close="yes"]').click();
  await expect(ada.page.locator('[data-link]')).not.toContainText(oldCode);
  const newCode = (await ada.page.locator('.k-codebox .k-code span[aria-hidden="true"]').textContent())?.trim() ?? '';
  expect(newCode).toMatch(/^BA-[A-Z2-9]{6}$/);
  expect(newCode).not.toBe(oldCode);
  await expect(ada.page.locator('main')).toContainText(`New friend code: ${newCode}`);

  // somebody with the old link: "no one has this code now"
  const late = await who('Late', { phone: true });
  await late.open('/friends/');
  await ready(late.page);
  await signUp(late.page, { band: 'adult', name: 'Late' });
  await late.open(`/f/${oldCode}`);
  await late.page.locator('[data-action="friendlink.send"]').click();
  await expect(late.page.locator('.k-linkcard .k-note-line')).toContainText('No one has this code now');
  await late.open(`/f/${newCode}`);
  await late.page.locator('[data-action="friendlink.send"]').click();
  await expect(late.page.locator('.k-linkcard .k-note-line')).toContainText('Request sent');

  // a new recovery code: asked first, then shown like the first, and different
  await ada.page.locator('[data-action="me.renewRecovery"]').click();
  await ada.page.locator('dialog [data-dialog-close="yes"]').click();
  await expect(ada.page.locator('[data-recovery-code]')).toBeVisible();
  const next = (await ada.page.locator('[data-recovery-code]').textContent())?.trim() ?? '';
  expect(next).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
  expect(next).not.toBe(ada.recovery);
  await ada.page.locator('[data-action="sheet.recovery.saved"]').click();
  await expect(ada.page.locator('dialog')).toHaveCount(0);

  // download: one JSON file with the profile in it
  const download = ada.page.waitForEvent('download');
  await ada.page.locator('[data-action="me.download"]').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('bodyarcade-data.json');
  const { createReadStream } = await import('node:fs');
  const chunks: Buffer[] = [];
  for await (const c of createReadStream((await file.path()) as string)) chunks.push(c as Buffer);
  const data = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { profile: { name: string; code: string } };
  expect(data.profile).toMatchObject({ name: 'Ada', code: newCode });
});

test('stepping down an age group takes the typed name and the typed chat away; under 13 erases the profile and closes online play on the device', async () => {
  test.setTimeout(120_000);
  const ada = await member('Ada', 'Ada', { phone: true });
  const fid = (await profileOf(ada))?.fid ?? '';
  await ada.open('/friends/?view=profile');
  await expect(ada.page.locator('main')).toContainText('Typed chat in private rooms where everyone is 18 or older');
  await ada.page.locator('[data-action="me.ageDown"]').click();
  await expect(ada.page.locator('dialog .ba-confirm')).toContainText('You cannot move back up');
  await ada.page.locator('dialog [data-dialog-close="yes"]').click();
  await expect(ada.page.locator('main')).toContainText('Moved to the 13 to 17 settings');
  await expect(ada.page.locator('[data-form="me-name"]')).toHaveCount(0);
  await expect(ada.page.locator('[data-action="me.reroll"]')).toBeVisible();
  await expect(ada.page.locator('main')).toContainText('Preset messages only, no typed chat');
  expect(((await profileOf(ada))?.name ?? '')).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+ \d\d$/);
  await expect(ada.page.locator('[data-action="me.ageDown"]')).toHaveCount(0);
  await ada.page.locator('[data-action="me.reroll"]').click();
  await expect(ada.page.locator('main')).toContainText('Name changed to');

  await ada.page.locator('[data-action="me.ageChild"]').click();
  await expect(ada.page.locator('dialog .ba-confirm')).toContainText('Players under 13 have no online profile');
  await ada.page.locator('dialog [data-dialog-close="yes"]').click();
  await expect(ada.page.locator('main')).toContainText('Online play starts at 13', { timeout: 20_000 });
  const left = await site.stack.db.prepare('SELECT COUNT(*) AS n FROM soc_profiles WHERE fid = ?1').bind(fid).first<{ n: number }>();
  expect(left?.n).toBe(0);
  const requests: string[] = [];
  ada.page.on('request', (r) => { if (r.url().includes('/api/')) requests.push(r.url()); });
  await ada.open('/friends/');
  await expect(ada.page.locator('[data-action="social.profile"]')).toHaveCount(0);
  expect(requests).toEqual([]);
});

test('deleting the profile erases it on the server and here, and the friends are told', async () => {
  test.setTimeout(120_000);
  const ada = await member('Ada', 'Ada', { phone: true });
  const bo = await member('Bo', 'Bo');
  await befriend(ada.page, bo.page, bo.code);
  const fid = (await profileOf(ada))?.fid ?? '';
  await ada.open('/friends/?view=profile');
  await ada.page.locator('[data-action="me.delete"]').click();
  await expect(ada.page.locator('dialog .ba-confirm')).toContainText('cannot be undone');
  await ada.page.locator('dialog [data-dialog-close="yes"]').click();
  await expect(ada.page).toHaveURL(/\/friends\/$/);
  await expect(ada.page.locator('[data-action="social.profile"]')).toBeVisible({ timeout: 20_000 });
  await expect(ada.page.locator('[data-banner="deleted"]')).toHaveCount(0);
  const left = await site.stack.db.prepare('SELECT COUNT(*) AS n FROM soc_profiles WHERE fid = ?1').bind(fid).first<{ n: number }>();
  expect(left?.n).toBe(0);
  await expect(bo.page.locator('[data-list="friends"]')).toHaveCount(0, { timeout: 30_000 });
});

// ───────── the friend link ─────────

test('a friend link opened by somebody with no profile: the code, never a name; one press asks the age, makes the profile and sends the request', async () => {
  test.setTimeout(120_000);
  const ada = await member('Ada', 'Ada', { phone: true });
  const newcomer = await who('Newcomer', { phone: true });
  await newcomer.open(`/f/${ada.code}`);
  await expect(newcomer.page.locator('.k-linkcode')).toHaveText(ada.code);
  await expect(newcomer.page.locator('main')).not.toContainText('Ada');
  await shot(newcomer.page, 'friend-link-new-phone');
  await newcomer.page.locator('[data-action="friendlink.send"]').click();
  await newcomer.page.locator('label:has(input[name="age"][value="adult"])').click();
  await newcomer.page.locator('[data-action="sheet.age.next"]').click();
  await newcomer.page.locator('#profile-name').fill('Newcomer');
  await newcomer.page.locator('[data-action="sheet.name.create"]').click();
  await newcomer.page.locator('[data-action="sheet.recovery.saved"]').click();
  await expect(newcomer.page.locator('.k-linkcard .k-note-line')).toContainText('Request sent');
  await expect(newcomer.page.locator('main a.ba-btn[href$="/friends/"]')).toBeVisible();
  await expect(newcomer.page.locator('[data-action="friendlink.send"]')).toHaveCount(0);
  await expect(ada.page.locator('[data-list="requests"] li')).toContainText('Newcomer', { timeout: 20_000 });
  await expect(ada.page.locator('[data-list="requests"] li')).toContainText('Opened your invite link');
  // the same link for the owner: their own code
  await ada.open(`/f/${ada.code}`);
  await expect(ada.page.locator('.k-linkcard')).toContainText('This is your own friend code');
  await expect(ada.page.locator('[data-action="friendlink.send"]')).toHaveCount(0);
  // a link with no code in it
  await ada.open('/f/BA-12');
  await expect(ada.page.locator('[role="alert"]')).toContainText('does not hold a valid friend code');
});

// ───────── the weekly boards ─────────

test('boards fill from real rounds: the player\'s best of the week, among friends, with the own line; last week is empty; the country board says why it is not there', async () => {
  test.setTimeout(240_000);
  const hooks = { timeScale: 1, roundSeconds: 4, forceDemo: true, keyboard: true };
  const ada = await member('Ada', 'Ada', { phone: true, hooks });
  const bo = await member('Bo', 'Bo', { hooks });
  await befriend(ada.page, bo.page, bo.code);
  // before any round: the board says so
  await ada.open('/friends/?view=boards');
  await expect(ada.page.locator('main h1')).toHaveText('Weekly boards');
  await expect(ada.page.locator('main')).toContainText('No scores for Squat Flap yet this week');
  // a round of Squat Flap (the practice session): the score reaches the board with the server's own clock on the round
  await ada.page.goto(`${site.origin}/play/squat-flap/?input=keyboard`);
  await ada.page.waitForURL(/\/results\//, { timeout: 60_000 });
  await expect(ada.page.locator('[data-toasts]')).toContainText('New best this week in Squat Flap', { timeout: 20_000 });
  await bo.page.goto(`${site.origin}/play/squat-flap/?input=keyboard`);
  await bo.page.waitForURL(/\/results\//, { timeout: 60_000 });
  await ada.open('/friends/?view=boards');
  const rows = ada.page.locator('[data-board="friends"] li');
  await expect(rows).toHaveCount(2, { timeout: 20_000 });
  await expect(ada.page.locator('[data-board="friends"] li.you')).toContainText('Ada');
  await expect(ada.page.locator('[data-board="friends"] li.you')).toContainText('(You)');
  await expect(ada.page.locator('.k-yours')).toContainText('Your best this week');
  await shot(ada.page, 'boards-friends-phone');
  // last week: nothing, said for last week
  await ada.page.locator('label:has(input[name="week"][value="previous"])').click();
  await expect(ada.page.locator('main')).toContainText('last week', { timeout: 20_000 });
  await expect(rows).toHaveCount(0);
  // the country board: the players who connect from the same country (here, both of them), real players only
  await ada.page.locator('label:has(input[name="week"][value="current"])').click();
  await ada.page.locator('label:has(input[name="scope"][value="country"])').click();
  await expect(ada.page.locator('[data-board="country"] li')).toHaveCount(2, { timeout: 20_000 });
  await expect(ada.page.locator('main')).toContainText('Players in');
  await expect(ada.page.locator('[data-board="country"] .ba-avatar')).toHaveCount(0);                  // a country board never shows who is a friend
});

// ───────── the connection ─────────

test('the same profile open in two tabs: the first is told it is no longer shown online and takes the connection back with one press', async () => {
  test.setTimeout(120_000);
  const ada = await member('Ada', 'Ada', { phone: true });
  const second = await ada.tab();
  await second.goto(`${site.origin}/friends/`);
  await second.waitForFunction(() => document.documentElement.dataset['socialHub'] === 'online');
  await expect(ada.page.locator('[data-banner="replaced"]')).toBeVisible({ timeout: 20_000 });
  await ada.page.locator('[data-action="social.takeover"]').click();
  await expect(ada.page.locator('[data-banner="replaced"]')).toHaveCount(0, { timeout: 20_000 });
  await expect(second.locator('[data-banner="replaced"]')).toBeVisible({ timeout: 20_000 });
  await shot(second, 'banner-replaced-phone', { full: false });
});

test('a connection that drops is made again by itself, with a line while it is gone', async () => {
  test.setTimeout(120_000);
  const ada = await member('Ada', 'Ada', { phone: true });
  await ada.page.evaluate(() => (window.__BA_SOCIAL_PORTS__?.client as { socket: { close(code: number, reason: string): void } }).socket.close(4999, 'test drop'));
  await expect(ada.page.locator('[data-banner="reconnecting"]')).toBeVisible({ timeout: 10_000 });
  await online(ada.page);
  await expect(ada.page.locator('[data-banner="reconnecting"]')).toHaveCount(0);
});

test('a service that does not answer: the saved profile stays on the page with a line, and the first answer after Try again brings the lists back', async () => {
  test.setTimeout(120_000);
  const ada = await member('Ada', 'Ada', { phone: true });
  const bo = await member('Bo', 'Bo');
  await befriend(ada.page, bo.page, bo.code);
  await ada.ctx.route('**/api/social/**', (r) => r.abort());
  await ada.ctx.routeWebSocket(/\/api\/social\/hub/, (ws) => { void ws.close({ code: 1006 }); });
  await ada.page.reload();
  await expect(ada.page.locator('[data-banner="offline"]')).toBeVisible({ timeout: 30_000 });
  await expect(ada.page.locator('.k-profile .name')).toHaveText('Ada');
  await expect(ada.page.locator('[data-list="friends"]')).toHaveCount(0);
  await expect(ada.page.locator('main')).not.toContainText('No friends yet');
  await shot(ada.page, 'friends-offline-phone');
  await ada.ctx.unroute('**/api/social/**');
  await ada.ctx.unrouteAll({ behavior: 'ignoreErrors' });
  await ada.page.locator('[data-banner="offline"] [data-action="social.retry"]').click();
  await expect(ada.page.locator('[data-banner="offline"]')).toHaveCount(0, { timeout: 30_000 });
  await expect(ada.page.locator('[data-list="friends"] li')).toHaveCount(1, { timeout: 30_000 });
});

test('a profile deleted on another device is gone here too, with a line that says so; a device the service forgot is told how to come back', async () => {
  test.setTimeout(150_000);
  const ada = await member('Ada', 'Ada', { phone: true });
  const laptop = await who('Ada laptop');
  await laptop.open('/friends/');
  await ready(laptop.page);
  await laptop.page.locator('[data-action="social.recover"]').click();
  await laptop.page.locator('#recover-code').fill(ada.friend);
  await laptop.page.locator('#recover-recovery').fill(ada.recovery);
  await laptop.page.locator('[data-action="sheet.recover.go"]').click();
  await expect(laptop.page.locator('dialog')).toHaveCount(0, { timeout: 20_000 });
  await online(laptop.page);
  await laptop.page.locator('[data-banner="replaced"]').waitFor({ state: 'detached' }).catch(() => undefined);
  await ada.page.locator('[data-action="social.takeover"]').click().catch(() => undefined);
  // the laptop erases the profile: the phone is signed out
  await ada.page.waitForFunction(() => document.documentElement.dataset['socialHub'] === 'online');
  await laptop.page.evaluate(() => (window.__BA_SOCIAL_PORTS__?.social.deleteProfile() as Promise<unknown>));
  await expect(ada.page.locator('[data-banner="deleted"]')).toBeVisible({ timeout: 30_000 });
  await expect(ada.page.locator('[data-toasts]')).toContainText('Your profile was deleted');
  await expect(ada.page.locator('[data-action="social.profile"]')).toBeVisible();

  // a device the service forgot (its row is gone): the next open says so and offers the way back
  const cy = await member('Cy', 'Cy', { phone: true });
  const fid = (await profileOf(cy))?.fid ?? '';
  const row = await site.stack.db.prepare('SELECT pid FROM soc_profiles WHERE fid = ?1').bind(fid).first<{ pid: string }>();
  await site.stack.db.prepare('DELETE FROM soc_devices WHERE pid = ?1').bind(row?.pid ?? '').run();
  await cy.page.reload();
  await expect(cy.page.locator('[data-banner="unknown"]')).toBeVisible({ timeout: 30_000 });
  await expect(cy.page.locator('[data-banner="unknown"] [data-action="social.recover"]')).toBeVisible();
});

// ───────── Turkish ─────────

test('the screens speak Turkish with Turkish letters, from the age question to the recovery code, and keep the layout rule on a small phone', async () => {
  test.setTimeout(120_000);
  const ada = await who('Ada', { phone: true, w: 360, h: 780, lang: 'tr' });
  await ada.open('/tr/friends/');
  await ready(ada.page);
  await expect(ada.page.locator('h1')).toHaveText('Arkadaşlar');
  expect(await inspect(ada.page)).toEqual([]);
  await ada.page.locator('[data-action="social.profile"]').click();
  await expect(ada.page.locator('dialog h2')).toHaveText('Kaç yaşındasın?');
  await expect(ada.page.locator('dialog')).toContainText('13 yaşından küçük');
  await ada.page.locator('label:has(input[name="age"][value="adult"])').click();
  await ada.page.locator('[data-action="sheet.age.next"]').click();
  await ada.page.locator('#profile-name').fill('Ayşe');
  await ada.page.locator('[data-action="sheet.name.create"]').click();
  await expect(ada.page.locator('dialog h2')).toHaveText('Kurtarma kodunu kaydet');
  await shot(ada.page, 'recovery-tr-360', { full: false });
  await ada.page.locator('[data-action="sheet.recovery.saved"]').click();
  await expect(ada.page.locator('.k-profile .name')).toHaveText('Ayşe');
  expect(await inspect(ada.page)).toEqual([]);
  await ada.open('/tr/friends/?view=profile');
  await expect(ada.page.locator('h1')).toHaveText('Profilim');
  expect(await inspect(ada.page)).toEqual([]);
  await ada.open('/tr/friends/?view=boards');
  await expect(ada.page.locator('h1')).toHaveText('Haftalık sıralamalar');
  expect(await inspect(ada.page)).toEqual([]);
  await ada.open('/tr/lobbies/');
  expect(await inspect(ada.page)).toEqual([]);
  await ada.open('/tr/safety/');
  expect(await inspect(ada.page)).toEqual([]);
});
