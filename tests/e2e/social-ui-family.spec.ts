// The friends side on a device of the Family plan, through the real shell and the production Worker in Miniflare: a page opened
// under a child's profile asks the service nothing (no request to the friends or the rooms, no socket, no key database) and says
// who to ask; the main player takes over through the parent gate and the Friends tab appears with a connection that opens; a
// child again closes the connection and nothing signed leaves the page; and the screens of a child keep the layout rule on a phone.
//   BA_SHOTS_DIR=... node C:/Users/doruk/apps/_tools/e2e-slot.mjs run -- npx playwright test -c tests/social/playwright.config.ts tests/e2e/social-ui-family.spec.ts --workers=1
import { expect, test, type Page } from '@playwright/test';
import { inspect, online, player, ready, shot, signUp, startShellSite, type Player, type Site } from './social-ui-support.ts';

let site: Site;
test.beforeAll(async () => { test.setTimeout(300_000); site = await startShellSite(); });
test.afterAll(async () => { await site?.stop(); });

/** A Family device whose child (Mia) is the player who plays when the page opens. */
const CHILD = { plan: 'family' as const, players: [{ name: 'Mia', kid: true, active: true }], timeScale: 40, roundSeconds: 6, forceDemo: true, keyboard: true };

/** The sum on the parent gate's window, solved and sent. */
async function solveGate(page: Page): Promise<void> {
  await expect(page.locator('dialog.pf-gatebox')).toBeVisible();
  const m = /(\d+)\s*×\s*(\d+)/.exec(await page.locator('.pf-sum').innerText());
  if (!m) throw new Error('there is no sum on the gate');
  await page.locator('#gate-answer').fill(String(Number(m[1]) * Number(m[2])));
  await page.getByRole('button', { name: 'Go on' }).click();
  await expect(page.locator('dialog.pf-gatebox')).toHaveCount(0);
}

const bar = (page: Page) => page.getByRole('navigation', { name: 'Main navigation' }).first();

/** Everything the page asks of the server that is not a page of the site: the API, the friends link redirects and the sockets. */
function watchCalls(p: Player): { calls: string[]; signed: string[]; sockets: string[]; closed: Promise<void>[] } {
  const seen = { calls: [] as string[], signed: [] as string[], sockets: [] as string[], closed: [] as Promise<void>[] };
  p.ctx.on('request', (r) => {
    if (r.resourceType() === 'document') return;
    const path = new URL(r.url()).pathname;
    if (!path.startsWith('/api/') && !/^\/(f|r)\//.test(path)) return;
    seen.calls.push(`${r.method()} ${path}`);
    if (r.headers()['x-ba-auth']) seen.signed.push(`${r.method()} ${path}`);
  });
  p.page.on('websocket', (ws) => {
    seen.sockets.push(new URL(ws.url()).pathname);
    seen.closed.push(new Promise<void>((resolve) => { ws.on('close', () => resolve()); }));
  });
  return seen;
}

test('a page opened under a child profile asks the friends service nothing and says who to ask', async () => {
  const kid = await player(site, 'kid', { phone: true, hooks: CHILD });
  const seen = watchCalls(kid);
  for (const path of ['/friends/', '/friends/?view=boards', '/friends/?view=profile', '/lobbies/', '/safety/', '/r/K7Q2MX/']) {
    await kid.open(path, { plain: true });
    await expect(kid.page.locator('main'), path).toContainText('This player is a child');
  }
  // a friend link opened by a child: the code is not kept, no age question, nothing to send
  await kid.open('/f/BA-9PXMR3/', { plain: true });
  await expect(kid.page.locator('main')).toContainText('This player is a child');
  await expect(kid.page.locator('dialog')).toHaveCount(0);
  await expect(kid.page.locator('[data-action="friendlink.send"], [data-action="social.profile"]')).toHaveCount(0);
  await expect(bar(kid.page).getByText('Friends')).toHaveCount(0);
  // nothing went to the service, no socket opened, no device key was made, and nothing about the code was kept
  expect(seen.calls).toEqual([]);
  expect(seen.sockets).toEqual([]);
  const databases = await kid.page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name ?? ''));
  expect(databases).not.toContain('bodyarcade-social');
  const kept = await kid.page.evaluate(() => Object.entries(localStorage).filter(([k, v]) => /BA-9PXMR3|9PXMR3/.test(k + v)).map(([k]) => k));
  expect(kept).toEqual([]);
  expect(kid.problems).toEqual([]);
  await kid.close();
});

test('the screens a child sees keep the layout rule on a phone and pass axe', async () => {
  const kid = await player(site, 'kid-look', { w: 360, h: 780, phone: true, hooks: CHILD });
  const found: string[] = [];
  for (const [id, path] of [['child-friends', '/friends/'], ['child-lobbies', '/lobbies/'], ['child-link', '/f/BA-9PXMR3/']] as const) {
    await kid.open(path, { plain: true });
    await kid.page.evaluate(() => document.fonts.ready);
    for (const x of await inspect(kid.page)) found.push(`${id}: ${x}`);
    await shot(kid.page, `${id}-360`);
  }
  expect(found, found.join('\n')).toEqual([]);
  await kid.close();
});

test('the main player takes over through the gate and the friends appear; a child again closes the connection', async () => {
  const dev = await player(site, 'family', { w: 1280, h: 800, hooks: CHILD });
  const seen = watchCalls(dev);
  await dev.open('/profiles/', { plain: true });
  await expect(bar(dev.page).getByText('Friends')).toHaveCount(0);
  expect(seen.calls).toEqual([]);

  // the main player, through the gate: now the service is asked, the Friends tab shows, and a profile can be made
  await dev.page.getByRole('button', { name: 'Play as Me', exact: true }).click();
  await solveGate(dev.page);
  await expect(dev.page.locator('.pf-switch').first()).toHaveAttribute('aria-label', 'Playing as Me. Switch player');
  await expect(bar(dev.page).getByText('Friends')).toHaveCount(1, { timeout: 20_000 });
  await dev.page.goto(`${site.origin}/friends/`);
  await ready(dev.page);
  await signUp(dev.page, { band: 'adult', name: 'Ada' });
  await online(dev.page);
  expect(seen.sockets.length).toBeGreaterThan(0);
  expect(seen.signed.length).toBeGreaterThan(0);

  // a child plays again: the connection is closed, nothing signed leaves the page, and the friends pages say who to ask
  await dev.page.locator('.pf-switch').first().click();
  await dev.page.getByRole('button', { name: 'Play as Mia', exact: true }).click();
  await expect(dev.page.locator('.pf-switch').first()).toHaveAttribute('aria-label', 'Playing as Mia. Switch player');
  await Promise.race([Promise.all(seen.closed), new Promise((r) => setTimeout(r, 15_000))]);
  const before = seen.signed.length;
  await dev.page.goto(`${site.origin}/friends/`);
  await expect(dev.page.locator('main')).toContainText('This player is a child');
  await dev.page.waitForTimeout(1500);
  expect(seen.signed.length).toBe(before);
  const hub = await dev.page.evaluate(() => (window as unknown as { __BA_SOCIAL_PORTS__?: { social: { state(): { hub: string; profile: unknown } } } }).__BA_SOCIAL_PORTS__?.social.state());
  if (hub) expect(hub).toMatchObject({ hub: 'idle', profile: null });

  // and the main player again: the connection comes back with the same profile
  await dev.page.locator('.pf-switch').first().click();
  await dev.page.getByRole('button', { name: 'Play as Me', exact: true }).click();
  await solveGate(dev.page);
  await dev.page.goto(`${site.origin}/friends/`);
  await ready(dev.page);
  await online(dev.page);
  await expect(dev.page.locator('main')).toContainText('Ada');
  expect(dev.problems).toEqual([]);
  await dev.close();
});

test('from the friends page of a child to the main player and back: the page waits for the services, it never says it is not there', async () => {
  const dev = await player(site, 'family-flow', { w: 390, h: 844, phone: true, hooks: CHILD });
  await dev.open('/friends/', { plain: true });
  await expect(dev.page.locator('main')).toContainText('This player is a child');
  // from here on, count every moment the page on the screen is the one that says "not found"
  await dev.page.evaluate(() => {
    const w = window as unknown as { __missing?: number };
    w.__missing = 0;
    new MutationObserver(() => { if (document.querySelector('.ba-page--notfound')) w.__missing = (w.__missing ?? 0) + 1; }).observe(document.body, { subtree: true, childList: true, attributes: true });
  });
  await dev.page.getByRole('link', { name: 'Switch player', exact: true }).click();
  await dev.page.getByRole('button', { name: 'Play as Me', exact: true }).click();
  await solveGate(dev.page);
  // the way back leads to the friends page (the address asked for it), which offers the profile once the services have answered
  await expect(dev.page.locator('[data-action="social.profile"]').first()).toBeVisible({ timeout: 20_000 });
  expect(new URL(dev.page.url()).pathname).toBe('/friends/');
  expect(await dev.page.evaluate(() => (window as unknown as { __missing?: number }).__missing)).toBe(0);
  expect(dev.problems).toEqual([]);
  await dev.close();
});
