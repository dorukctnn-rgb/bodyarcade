// Duel links (sprint arm E) through the real web shell, in two browser contexts (two devices) against the production Worker in
// Miniflare (the real room Durable Object judges the duel, and no SOCIAL_ALLOW_UNSIGNED bridge: a guest is let in only because the
// room is a duel room). Neither player has a profile:
//   1. Ada opens Star Catch (a game without a course: a score duel), makes a duel link as a guest (the age, a generated name, the
//      rules), and sends the link. The duel card says how long it stays open, how it is played and what the friend sees; there is no
//      camera switch and no typed chat. Bo opens the link on his phone, also as a guest. Both get ready: one match starts on both
//      stages (same match, same seed), each stage shows the other as a figure with points that grow (the Room's points), and both
//      result cards show the same two rows, a winner and the two scores. A rematch: Bo's practice player now claims a hundred
//      thousand points a second; the Room keeps him to Star Catch's rate, on both pages. Bo leaves; Ada's card says so.
//   2. Two friends with profiles: Ada asks Bo to a duel from the friends list (the game first); Bo's invitation card takes him into
//      the duel room.
// The players are the practice session of test builds (forceDemo), so no camera is needed; everything else is the real thing.
//   node C:/Users/doruk/apps/_tools/e2e-slot.mjs run -- npx playwright test -c tests/social/playwright.config.ts tests/e2e/social-ui-duel.spec.ts --workers=1
import { expect, test, type Page } from '@playwright/test';
import { SCORE_RATES } from '../../packages/core/net/duel-link.ts';
import { befriend, inspect, online, player, ready, shot, signUp, startShellSite, type Player, type Site } from './social-ui-support.ts';

let site: Site;
test.beforeAll(async () => { test.setTimeout(300_000); site = await startShellSite(); });
test.afterAll(async () => { await site?.stop(); });

/** A duel of fifteen seconds (the shortest a room allows), the practice session as the player, its own clock five times faster. */
const HOOKS = { forceDemo: true, timeScale: 5, raceSeconds: 15, scorePerSec: 100 };
const STAR = SCORE_RATES['star-catch'] as { perSec: number; burst: number };

async function duelist(label: string, o: { phone?: boolean } = {}): Promise<Player> {
  const p = await player(site, label, { ...(o.phone ? { phone: true } : {}), hooks: HOOKS });
  await p.ctx.grantPermissions(['camera', 'clipboard-read', 'clipboard-write']);
  // the camera was explained on this device before (the first round of a device shows what it is for; that panel is tested elsewhere)
  await p.ctx.addInitScript(() => { try { localStorage.setItem('ba2.shell.cameraExplained', JSON.stringify({ v: 1, d: true })); } catch { /* no storage */ } });
  // what the page copies is what the person pastes into a message to a friend: the test keeps it
  await p.ctx.addInitScript(() => {
    const c = navigator.clipboard as (Clipboard & { writeText(t: string): Promise<void> }) | undefined;
    if (!c || typeof c.writeText !== 'function') return;
    const real = c.writeText.bind(c);
    c.writeText = (t: string) => { (window as unknown as { __copied: string }).__copied = String(t); return real(t); };
  });
  return p;
}

const roomCode = (url: string): string => /\/r\/([A-Z0-9]{6})/.exec(url)?.[1] ?? '';

/** The guest window of a duel link: the age, then the generated name, the rules agreed to, and in. */
async function asGuest(page: Page, band: 'adult' | 'teen'): Promise<string> {
  await expect(page.locator('dialog h2')).toContainText('How old are you?', { timeout: 30_000 });
  await page.locator(`label:has(input[name="age"][value="${band}"])`).click();
  await page.locator('[data-action="sheet.age.next"]').click();
  await expect(page.locator('dialog [data-guest-sheet]')).toBeVisible();
  await expect(page.locator('dialog #profile-name')).toHaveCount(0);
  // the rules first: the way in says so while the box is empty
  await page.locator('[data-action="sheet.guest.go"]').click();
  await expect(page.locator('#profile-note')).toContainText('Tick the box');
  const name = ((await page.locator('[data-generated-name]').textContent()) ?? '').trim();
  expect(name).toMatch(/^[A-Za-z]+ [A-Za-z]+ \d+$/);
  await page.locator('#profile-terms').check();
  await page.locator('[data-action="sheet.guest.go"]').click();
  await expect(page.locator('dialog')).toHaveCount(0, { timeout: 20_000 });
  return name;
}

/** The stage of the duel: the layer of the room, past the camera explainer if this browser shows it. */
async function onStage(p: Player, code: string, slug = 'star-catch'): Promise<void> {
  await expect(p.page).toHaveURL(new RegExp(`/play/${slug}/\\?(.*&)?room=${code}`), { timeout: 30_000 });
  const layer = p.page.locator('[data-live-race]');
  const explainer = p.page.locator('[data-action="camera-continue"]');
  await expect(layer.or(explainer).first()).toBeAttached({ timeout: 30_000 });
  if (await explainer.isVisible().catch(() => false)) await explainer.click();
  await expect(layer).toHaveAttribute('data-room', code, { timeout: 30_000 });
}

async function stageMatch(p: Player): Promise<{ match: string; seed: string }> {
  const layer = p.page.locator('[data-live-race]');
  return { match: (await layer.getAttribute('data-match')) ?? '', seed: (await layer.getAttribute('data-seed')) ?? '' };
}

/** Both stages play the same match (one seed: one round of the game for both). */
async function sameMatch(a: Player, b: Player): Promise<string> {
  await expect.poll(async () => (await stageMatch(a)).match, { timeout: 30_000 }).not.toBe('');
  await expect.poll(async () => (await stageMatch(b)).match, { timeout: 30_000 }).not.toBe('');
  const [sa, sb] = [await stageMatch(a), await stageMatch(b)];
  expect(sa.match).toBe(sb.match);
  expect(sa.seed).not.toBe('');
  expect(sa.seed).toBe(sb.seed);
  return sa.match;
}

/** The other player is on this stage: their tile with their name, their pose drawn (a 3D figure where WebGL is there), points that grow. */
async function seesTheOther(p: Player, name: string): Promise<void> {
  const tile = p.page.locator('[data-lr-tiles] .lr-tile', { has: p.page.locator('.lr-name', { hasText: name }) });
  await expect(tile).toHaveCount(1, { timeout: 20_000 });
  await expect(tile).toHaveAttribute('data-skeleton', '1', { timeout: 20_000 });
  await expect.poll(async () => Number(await tile.getAttribute('data-score')), { timeout: 30_000 }).toBeGreaterThan(0);
  // never a camera picture in a duel
  await expect(tile.locator('video')).toBeHidden();
  await expect(tile).not.toHaveAttribute('data-show', 'video');
}

/** The duel is over on this page: its result card, with both players, in the same order on both pages. */
async function results(p: Player, code: string): Promise<{ rows: string[]; verdict: string }> {
  await expect(p.page).toHaveURL(new RegExp(`/results/\\?(.*&)?room=${code}`), { timeout: 60_000 });
  const card = p.page.locator('[data-duel-result]');
  await expect(card).toHaveAttribute('data-room', code);
  await expect(card.locator('.lr-places li')).toHaveCount(2);
  await expect(card.locator('[data-race-verdict]')).not.toBeEmpty();
  const rows = (await card.locator('.lr-places li').allTextContents()).map((x) => x.replace(/\s+/g, ' ').replace(' (you)', '').trim());
  return { rows, verdict: ((await card.locator('[data-race-verdict]').textContent()) ?? '').trim() };
}

const pointsOf = (row: string): number => Number(/(\d[\d,]*) points?/.exec(row)?.[1]?.replace(/,/g, '') ?? NaN);

test('two guests duel by a link: a score duel on both stages, the same result card on both pages, a rematch the Room keeps honest, and a clean leave', async () => {
  test.setTimeout(420_000);
  const ada = await duelist('Ada');
  const bo = await duelist('Bo', { phone: true });
  let ended = false;
  try {
    // ── Ada makes a duel link from Star Catch's page as a guest ──
    await ada.open('/games/star-catch/');
    const duelButton = ada.page.locator('[data-action="race.new"][data-game="star-catch"]');
    await expect(duelButton).toContainText('Duel link');
    await duelButton.click();
    const adaName = await asGuest(ada.page, 'adult');
    await ada.page.waitForURL(/\/r\/[A-Z0-9]{6}/, { timeout: 30_000 });
    const code = roomCode(ada.page.url());
    const card = ada.page.locator('[data-duel-card]');
    await expect(card).toHaveAttribute('data-mode', 'score', { timeout: 20_000 });
    await expect(card).toContainText('Same round for both. The higher score wins.');
    await expect(card).toContainText('Your camera picture never leaves your device.');
    await expect(card).toContainText(`You are playing as a guest: ${adaName}`);
    await expect(card.locator('[data-duel-left]')).toContainText(/The link closes in (9:[0-5]\d|10:00)/);
    // the clock ticks
    const before = await card.locator('[data-duel-left]').textContent();
    await expect.poll(() => card.locator('[data-duel-left]').textContent(), { timeout: 5_000 }).not.toBe(before);
    await expect(ada.page.locator('#room-share')).toHaveCount(0);
    await expect(ada.page.locator('#room-text')).toHaveCount(0);
    await expect(ada.page.locator('[data-duel-nocam]')).toBeVisible();
    await expect(ada.page.locator('.k-seat[data-seat]')).toHaveCount(1, { timeout: 20_000 });
    await expect(ada.page.locator('.k-seat.empty')).toHaveCount(1);
    await ada.page.locator('[data-action="duel.share"]').click();
    await expect(ada.page.locator('[data-toasts]')).toContainText('Invite link copied');
    const link = await ada.page.evaluate(() => (window as unknown as { __copied?: string }).__copied ?? '');
    expect(link).toContain(`/r/${code}`);
    for (const x of await inspect(ada.page, { axe: true, crowding: true })) ada.problems.push(`room layout: ${x}`);
    await shot(ada.page, 'duel-room-host');

    // ── Bo opens the link on his phone, as a guest too ──
    await bo.page.goto(link.replace(/^https?:\/\/[^/]+/, site.origin));
    const boName = await asGuest(bo.page, 'teen');
    await expect(bo.page.locator('.k-seat[data-seat]')).toHaveCount(2, { timeout: 30_000 });
    await expect(ada.page.locator('.k-seat[data-seat]')).toHaveCount(2, { timeout: 20_000 });
    await expect(bo.page.locator('[data-duel-card]')).toContainText(`You are playing as a guest: ${boName}`);
    await expect(ada.page.locator('[data-duel-card] [data-action="duel.share"]')).toHaveCount(0);
    for (const x of await inspect(bo.page, { axe: true, crowding: true })) bo.problems.push(`room layout (phone): ${x}`);
    await shot(bo.page, 'duel-room-guest-phone');
    // preset messages only
    await bo.page.locator('[data-action="room.say"][data-id="hi"]').click();
    await expect(ada.page.locator('.k-feed')).toContainText('Hello', { timeout: 20_000 });

    // ── both get ready: one match on both stages, each sees the other as a figure with growing points ──
    await ada.page.locator('[data-action="room.ready"][data-ready="1"]').click();
    await onStage(ada, code);
    await bo.page.locator('[data-action="room.ready"][data-ready="1"]').click();
    await onStage(bo, code);
    const first = await sameMatch(ada, bo);
    await seesTheOther(ada, boName);
    await seesTheOther(bo, adaName);
    await shot(bo.page, 'duel-stage-phone', { full: false });

    // ── the result cards: the same two rows on both pages, a winner, points for both ──
    const [ra, rb] = await Promise.all([results(ada, code), results(bo, code)]);
    expect(ra.rows).toEqual(rb.rows);
    for (const row of ra.rows) expect(pointsOf(row)).toBeGreaterThan(0);
    // a practice player makes 80 to 120 points a second: fifteen seconds stay well inside Star Catch's rate
    for (const row of ra.rows) expect(pointsOf(row)).toBeLessThanOrEqual(STAR.burst + STAR.perSec * 16);
    expect(ra.verdict).toMatch(/won the duel|draw/);
    await expect(ada.page.locator('[data-duel-result] li[data-you]')).toContainText(`${adaName} (you)`);
    await expect(ada.page.locator('[data-rematch-go]')).toHaveText('Rematch');
    for (const x of await inspect(bo.page, { axe: false, crowding: false })) bo.problems.push(`results layout (phone): ${x}`);
    await shot(ada.page, 'duel-results');
    await shot(bo.page, 'duel-results-phone');

    // ── a rematch in which Bo's page claims a hundred thousand points a second: the Room holds him to the game's rate ──
    await bo.page.evaluate(() => { (window as unknown as { __BA_TEST__: { scorePerSec: number } }).__BA_TEST__.scorePerSec = 100_000; });
    await bo.page.locator('[data-rematch-go]').click();
    await onStage(bo, code);
    await expect(ada.page.locator('[data-rematch]')).toHaveText(`${boName} wants a rematch`, { timeout: 30_000 });
    await ada.page.locator('[data-rematch-go]').click();
    await onStage(ada, code);
    const second = await sameMatch(ada, bo);
    expect(second).not.toBe(first);
    const [ra2, rb2] = await Promise.all([results(ada, code), results(bo, code)]);
    expect(ra2.rows).toEqual(rb2.rows);
    const boRow = ra2.rows.find((r) => r.includes(boName)) ?? '';
    expect(pointsOf(boRow)).toBeGreaterThan(STAR.burst);
    expect(pointsOf(boRow)).toBeLessThanOrEqual(STAR.burst + STAR.perSec * 16);
    expect(site.stack.logs.some((l) => l.includes('score_capped'))).toBe(true);

    // ── Bo leaves: Ada's card says so ──
    await bo.page.locator('[data-duel-result] [data-action="room.leave"]').click();
    await expect(ada.page.locator('[data-rematch]')).toHaveText('Everyone else left the room.', { timeout: 20_000 });
    ended = true;
  } finally {
    const problems = [...ada.problems, ...bo.problems];
    if (problems.length || !ended) {
      console.log('WORKER LOG', site.stack.logs.slice(-15).join(' | '));
      for (const p of [ada, bo]) { console.log(`${p.label} was at ${p.page.url()}`); await shot(p.page, `fail-duel-${p.label}`, { full: false }).catch(() => undefined); }
    }
    await ada.close();
    await bo.close();
    expect(problems).toEqual([]);
  }
});

test('a friend is asked to a duel from the friends list: the game first, then the invitation takes the friend into the duel room', async () => {
  test.setTimeout(240_000);
  const ada = await duelist('Ada', { phone: true });
  const bo = await duelist('Bo');
  try {
    for (const [p, name] of [[ada, 'Ada'], [bo, 'Bo']] as const) {
      await p.open('/friends/');
      await ready(p.page);
      await signUp(p.page, { band: 'adult', name });
      await online(p.page);
    }
    const boCode = ((await bo.page.locator('.k-profile .k-code span[aria-hidden="true"]').first().textContent()) ?? '').trim();
    await befriend(ada.page, bo.page, boCode);
    // Bo is somewhere else in the app
    await bo.page.goto(`${site.origin}/games/squat-flap/`);
    await bo.page.waitForSelector('main h1');

    const row = ada.page.locator('[data-list="friends"] li', { hasText: 'Bo' });
    const duel = row.locator('[data-action="social.duel"]');
    await expect(duel).toBeVisible({ timeout: 30_000 });
    await expect(duel).toHaveAttribute('aria-label', 'Duel Bo');
    for (const x of await inspect(ada.page, { axe: true, crowding: true })) ada.problems.push(`friends layout (phone): ${x}`);
    await duel.click();
    // any game can be a duel: Pose Wall, which has no course (a score duel)
    await ada.page.locator('dialog[open] [data-dialog-close="pose-wall"]').click();
    await ada.page.waitForURL(/\/r\/[A-Z0-9]{6}/, { timeout: 30_000 });
    const code = /\/r\/([A-Z0-9]{6})/.exec(ada.page.url())?.[1] ?? '';
    await expect(ada.page.locator('[data-toasts]')).toContainText('Bo was asked to a duel.', { timeout: 30_000 });
    await expect(ada.page.locator('[data-duel-card]')).toHaveAttribute('data-mode', 'score');
    // a player with a profile is no guest
    await expect(ada.page.locator('[data-duel-guest]')).toHaveCount(0);

    const tray = bo.page.locator('.k-tray__card');
    await expect(tray).toBeVisible({ timeout: 30_000 });
    await expect(tray).toContainText('Ada');
    await tray.locator('[data-action="invite.join"]').click();
    await bo.page.waitForURL(new RegExp(`/r/${code}`));
    await expect(bo.page.locator('.k-seat[data-seat]')).toHaveCount(2, { timeout: 20_000 });
    await expect(bo.page.locator('[data-duel-card]')).toBeVisible();
    await expect(ada.page.locator('.k-seat[data-seat]')).toHaveCount(2, { timeout: 20_000 });
  } finally {
    const problems = [...ada.problems, ...bo.problems];
    await ada.close();
    await bo.close();
    expect(problems).toEqual([]);
  }
});
