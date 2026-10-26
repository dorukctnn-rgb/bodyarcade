// Every public address of bodyarcade.com on the deployed build: the app's pages, the old content pages, the files
// search engines and the Android app read, the old addresses that moved (301 with the query kept), the 404 page,
// the header rules and the API. Writes tests/release/out/urls.json as evidence.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { chooseMode, openPlayers, type RacePlayer } from './players.ts';
import { BASE, IDENTITIES, IS_PREVIEW, KEEP_PROFILES, OUT, SIGNING, localBuild, sitemapUrls } from './support.ts';

const rows: { path: string; status: number; location?: string; note?: string }[] = [];
let api: APIRequestContext;
let checker: RacePlayer | null = null;
test.beforeAll(async () => { api = await request.newContext({ baseURL: BASE, maxRedirects: 0 }); });
test.afterAll(async () => {
  await api.dispose();
  writeFileSync(join(OUT, 'urls.json'), JSON.stringify(rows, null, 1));
  // bodyarcade.com keeps no test profile: one that could not be deleted is said, and its key stays so the next run can try again
  if (checker && !KEEP_PROFILES) await checker.retire().catch((e: unknown) => console.warn(`test profile left on ${BASE}: ${String(e)}`));
});

async function get(path: string, init?: { method?: 'GET' | 'POST' | 'HEAD'; data?: unknown; headers?: Record<string, string> }) {
  const res = await api.fetch(path, { method: init?.method ?? 'GET', ...(init?.data !== undefined ? { data: init.data } : {}), ...(init?.headers ? { headers: init.headers } : {}), maxRedirects: 0 });
  const location = res.headers()['location'];
  rows.push({ path, status: res.status(), ...(location ? { location } : {}) });
  return res;
}

test('the deployed build is the one built here', async () => {
  const local = localBuild();
  test.skip(!local, 'no local dist/version.json');
  const res = await get('/version.json');
  expect(res.status()).toBe(200);
  const remote = (await res.json()) as { build: string; target: string };
  expect(remote.build).toBe(local?.build);
  expect(remote.target).toBe(IS_PREVIEW ? 'preview' : 'production');
});

test('every page in the sitemap answers 200 with its canonical address, and the player pages answer too', async () => {
  const paths = sitemapUrls();
  expect(paths.length).toBeGreaterThan(20);
  const extra = ['/pro/', '/settings/', '/results/', '/welcome/', '/tr/pro/', '/play/road-run/', '/tr/play/road-run/'];
  for (const p of [...paths, ...extra]) {
    const res = await get(p);
    expect(res.status(), p).toBe(200);
    const html = await res.text();
    if (paths.includes(p)) {
      const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];
      expect(canonical && new URL(canonical).pathname, `${p} canonical`).toBe(p);
    }
  }
});

test('the old content pages, the files crawlers and the Android app read, and the icons', async () => {
  for (const p of ['/webcam-fitness-games', '/ring-fit-adventure-alternative', '/blog/', '/blog/why-browser-fitness-games-are-the-future', '/privacy', '/terms']) {
    const res = await get(p);
    expect(res.status(), p).toBe(200);
    expect(await res.text(), p).toContain('BodyArcade');
  }
  const robots = await (await get('/robots.txt')).text();
  expect(robots).toContain(IS_PREVIEW ? 'Disallow: /' : 'Sitemap: https://bodyarcade.com/sitemap.xml');
  const sitemap = await get('/sitemap.xml');
  expect(sitemap.status()).toBe(200);
  expect(await sitemap.text()).toContain('<loc>https://bodyarcade.com/privacy</loc>');
  const key = await get('/06bb4e63d6d4983eed0ac457e2d4a483.txt');
  expect((await key.text()).trim()).toBe('06bb4e63d6d4983eed0ac457e2d4a483');
  const links = await get('/.well-known/assetlinks.json');
  expect(links.headers()['content-type']).toContain('application/json');
  expect(JSON.stringify(await links.json())).toContain('com.peakapps.bodyarcade');
  const manifest = (await (await get('/manifest.json')).json()) as { start_url: string };
  expect(manifest.start_url).toBe('/');
  for (const p of ['/favicon.ico', '/favicon-32.png', '/apple-touch-icon.png', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/og-image.png', '/assets/ba.css', '/sw.js', '/sw-register.js']) {
    expect((await get(p)).status(), p).toBe(200);
  }
});

test('the old addresses move with a 301 to the right place, keeping the query', async () => {
  const cases: [string, string][] = [
    ['/bodyarcade', '/'], ['/bodyarcade/', '/'], ['/BodyArcade.html', '/'], ['/bodyarcade.html', '/'], ['/play', '/'], ['/app', '/'], ['/index.html', '/'],
    ['/bodyarcade?license=ABCD-1234', '/pro/?license=ABCD-1234'], ['/bodyarcade?c=eyJ4IjoxfQ&utm_source=mail', '/games/road-run/?c=eyJ4IjoxfQ&utm_source=mail'],
    ['/bodyarcade?world=desert', '/games/road-run/?world=desert'], ['/bodyarcade?live=1', '/'],
    ['/privacy.html', '/privacy'], ['/terms.html', '/terms'], ['/webcam-fitness-games.html', '/webcam-fitness-games'],
    ['/ring-fit-adventure-alternative.html', '/ring-fit-adventure-alternative'], ['/blog/why-browser-fitness-games-are-the-future.html', '/blog/why-browser-fitness-games-are-the-future'],
    ['/blog', '/blog/'], ['/uploads/old.png', '/'], ['/BodyArcade%20v1.html', '/'], ['/BodyArcade%20v2-neon.html', '/'],
  ];
  for (const [from, to] of cases) {
    const res = await get(from);
    expect(res.status(), from).toBe(301);
    const loc = res.headers()['location'] ?? '';
    expect(new URL(loc, BASE).toString().replace(BASE, ''), from).toBe(to);
  }
});

test('an unknown address answers 404 with the app\'s own page, an unknown API path 404 JSON', async () => {
  const res = await get('/no-such-page-here');
  expect(res.status()).toBe(404);
  const html = await res.text();
  expect(html).toContain('<html');
  expect(html).toContain('/sw-register.js');
  const apiRes = await get('/api/no-such-thing');
  expect(apiRes.status()).toBe(404);
  expect(await apiRes.json()).toEqual({ error: 'not_found' });
});

test('security and cache headers', async () => {
  const h = (await get('/')).headers();
  expect(h['content-security-policy-report-only']).toContain("script-src 'self' 'wasm-unsafe-eval'");
  expect(h['content-security-policy']).toBeUndefined();
  expect(h['x-frame-options']).toBe('SAMEORIGIN');
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['strict-transport-security']).toContain('max-age=31536000');
  expect(h['permissions-policy']).toContain('camera=(self)');
  if (IS_PREVIEW) expect(h['x-robots-tag']).toContain('noindex'); else expect(h['x-robots-tag']).toBeUndefined();
  const sw = (await get('/sw.js')).headers();
  expect(sw['cache-control']).toContain('max-age=0');
  const html = await (await get('/')).text();
  const script = /src="(\/static\/[^"]+\.js)"/.exec(html)?.[1] as string;
  expect((await get(script)).headers()['cache-control']).toContain('immutable');
  const model = await get('/vendor/mediapipe/models/pose_landmarker_lite.f16.v1.task', { method: 'HEAD' });
  expect(model.status()).toBe(200);
  expect(model.headers()['cache-control']).toContain('immutable');
});

test('the social module is deployed: an unsigned call is refused with 401, and the friend-link and invite pages open', async () => {
  // 401 is the edge refusing a call with no signature; 503 means the Worker has no SOCIAL binding, 404 or 500 a build from before the module
  const me = await get('/api/social/me');
  expect(me.status(), 'GET /api/social/me with no signature (redeploy the preview when this is not 401)').toBe(401);
  const friend = await get('/f/BA-ABCDEF');
  expect(friend.status(), '/f/BA-ABCDEF').toBe(200);
  expect(friend.headers()['x-robots-tag'] ?? '', '/f/BA-ABCDEF stays out of search').toContain('noindex');
  const invite = await get('/r/ABCDEF');
  expect(invite.status(), '/r/ABCDEF').toBe(200);
});

test('the API answers: ICE servers, a room made and looked up, a CSP report taken', async () => {
  const ice = await get('/api/ice', { method: 'POST' });
  expect(ice.status()).toBe(200);
  const grant = (await ice.json()) as { iceServers: unknown[]; turn: boolean };
  expect(grant.iceServers.length).toBeGreaterThan(0);
  rows.push({ path: '/api/ice (turn)', status: 200, note: `turn=${grant.turn}` });
  // the room is made by a player who signs the call (bodyarcade.com takes no guests; see players.ts), a guest only on a build from before the social module
  const verdict = await chooseMode(BASE, { want: SIGNING, production: !IS_PREVIEW });
  checker = (await openPlayers(BASE, ['Release Check'], { mode: verdict.mode, dir: IDENTITIES }))[0] ?? null;
  const player = checker as RacePlayer;
  const roomBody = { kind: 'private', gameId: 'squat-flap', size: 2, durationMs: 30_000, ...player.identity() };
  const auth = await player.authFor('POST', `${BASE}/api/rooms`, roomBody);
  const made = await get('/api/rooms', { method: 'POST', data: roomBody, headers: { 'Content-Type': 'application/json', ...(auth ? { 'X-BA-Auth': auth } : {}) } });
  rows.push({ path: '/api/rooms (who made it)', status: made.status(), note: `${verdict.mode}: ${verdict.why}` });
  expect(made.status(), `a room made (${verdict.mode}): ${await made.text()}`).toBe(201);
  const room = (await made.json()) as { code: string; link: string };
  expect(room.link).toContain(room.code);
  expect(new URL(room.link).origin).toBe(BASE);
  const preview = await get(`/api/rooms/${room.code}`);
  expect(preview.status()).toBe(200);
  const report = await get('/api/csp-report', { method: 'POST', data: JSON.stringify({ 'csp-report': { 'document-uri': `${BASE}/`, 'effective-directive': 'script-src-elem', 'blocked-uri': 'inline' } }), headers: { 'Content-Type': 'application/csp-report' } });
  expect(report.status()).toBe(204);
});
