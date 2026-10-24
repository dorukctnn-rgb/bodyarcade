// The signed players of the release checks (tests/release/players.ts) against the production Worker in Miniflare (workerd, the
// real directory Durable Object, WebCrypto verified by the runtime), with the production rules: no guest bridge
// (SOCIAL_ALLOW_UNSIGNED is not set), the per-address limits on. What the live races of the release suite do on the deployed Worker,
// minus the browsers: make a room as a signed profile, take a seat as another, and see a call with no signature refused.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserContext } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AUTH_HEADER } from '../../packages/core/social/sign.ts';
import { startStack, type Stack } from '../../packages/server/src/social/stack.ts';
import { chooseMode, openPlayers, signRoomCalls, type RacePlayer } from '../release/players.ts';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

let stack: Stack;
let dir = '';
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ba-players-worker-'));
  // the production rules: limits on, links from the request's own origin; TEST_CLOCK stays on only so the test can count the profiles
  stack = await startStack({ vars: { SOCIAL_NO_LIMITS: '0', LIVE_NO_LIMITS: '0', PUBLIC_ORIGIN: '' } });
}, 120_000);
afterAll(async () => {
  await stack?.stop();
  rmSync(dir, { recursive: true, force: true });
}, 30_000);

const profiles = async (): Promise<number> => ((await stack.db.prepare('SELECT COUNT(*) AS n FROM soc_profiles').first<{ n: number }>())?.n ?? -1);
const roomBody = (p: RacePlayer) => ({ kind: 'private', gameId: 'squat-flap', size: 2, durationMs: 25_000, ...p.identity() });

describe('signed release players on the production Worker', () => {
  it('are told apart from a build without the social module: this Worker refuses an unsigned call with 401', async () => {
    const v = await chooseMode(stack.origin);
    expect(v.mode).toBe('signed');
  });

  it('sign up once, keep their keys, and find the same profiles again on the next run', async () => {
    const before = await profiles();
    const first = await openPlayers(stack.origin, ['Release Ana', 'Release Ben'], { mode: 'signed', dir });
    expect(await profiles()).toBe(before + 2);
    const second = await openPlayers(stack.origin, ['Release Ana', 'Release Ben'], { mode: 'signed', dir });
    expect(second.map((p) => p.pid)).toEqual(first.map((p) => p.pid));
    expect(await profiles()).toBe(before + 2);
  });

  it('make a room as a profile and take a seat as another: the Worker checks the signature, and the name comes from the profile', async () => {
    const [ana, ben] = await openPlayers(stack.origin, ['Release Ana', 'Release Ben'], { mode: 'signed', dir }) as [RacePlayer, RacePlayer];
    const made = await ana.post(`${stack.origin}/api/rooms`, { ...roomBody(ana), name: 'Not My Name' });
    expect(made.status, await made.clone().text()).toBe(201);
    const grant = (await made.json()) as { code: string; ticket: string; link: string };
    expect(grant.link).toBe(`${stack.origin}/r/${grant.code}`);
    // the ticket carries the profile's name, not the one in the body
    const claims = JSON.parse(Buffer.from(grant.ticket.split('.')[0] as string, 'base64url').toString('utf8')) as { n: string };
    expect(claims.n).toBe('Release Ana');
    const joined = await ben.post(`${stack.origin}/api/rooms/${grant.code}/join`, ben.identity());
    expect(joined.status, await joined.clone().text()).toBe(200);
    // asking again (a reload, a fresh ticket) is the same player
    const again = await ben.post(`${stack.origin}/api/rooms/${grant.code}/join`, ben.identity());
    expect(again.status).toBe(200);
  });

  it('are the only way in: a call with no signature, a signature for another request, and a guest of the live checks are all refused', async () => {
    const [ana] = await openPlayers(stack.origin, ['Release Ana'], { mode: 'signed', dir }) as [RacePlayer];
    const [guest] = await openPlayers(stack.origin, ['Release Guest'], { mode: 'guest' }) as [RacePlayer];
    const unsigned = await guest.post(`${stack.origin}/api/rooms`, roomBody(guest));
    expect(unsigned.status).toBe(401);
    expect(((await unsigned.json()) as { error: string }).error).toBe('unauthorized');
    // a header made for another body
    const header = (await ana.authFor('POST', `${stack.origin}/api/rooms`, { ...roomBody(ana), size: 3 })) as string;
    const tampered = await fetch(`${stack.origin}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json', [AUTH_HEADER]: header }, body: JSON.stringify(roomBody(ana)) });
    expect(tampered.status).toBe(401);
  });

  it('are signed by the browser context on the way out: the header it adds to what a page sent is accepted', async () => {
    const [ana] = await openPlayers(stack.origin, ['Release Ana'], { mode: 'signed', dir }) as [RacePlayer];
    let matcher: (u: URL) => boolean = () => false;
    let handler: (route: unknown) => Promise<unknown> = async () => undefined;
    const ctx = { route: async (m: unknown, h: unknown) => { matcher = m as typeof matcher; handler = h as typeof handler; } } as unknown as Pick<BrowserContext, 'route'>;
    await signRoomCalls(ctx, stack.origin, ana);
    // what the duel page sends: JSON.stringify of { ...room, ...who }, with no header of ours
    const body = JSON.stringify(roomBody(ana));
    const url = `${stack.origin}/api/rooms`;
    expect(matcher(new URL(url))).toBe(true);
    let sent: Record<string, string> = {};
    await handler({
      request: () => ({ method: () => 'POST', url: () => url, postData: () => body, headers: () => ({ 'content-type': 'application/json' }) }),
      fallback: async () => undefined,
      continue: async (o: { headers: Record<string, string> }) => { sent = o.headers; },
    });
    const res = await fetch(url, { method: 'POST', headers: sent, body });
    expect(res.status, await res.clone().text()).toBe(201);
  });

  it('retire: the profile is gone from the server and the key from the disk, and the same key is a stranger afterwards', async () => {
    const before = await profiles();
    const [ben] = await openPlayers(stack.origin, ['Release Ben'], { mode: 'signed', dir }) as [RacePlayer];
    await ben.retire();
    expect(await profiles()).toBe(before - 1);
    expect(existsSync(join(dir, 'release-ben.json'))).toBe(false);
    const after = await ben.post(`${stack.origin}/api/rooms`, roomBody(ben));
    expect(after.status).toBe(401);
    expect(((await after.json()) as { error: string }).error).toBe('unknown_device');
  });
});
