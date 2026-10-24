// One player's side of the social module in a real browser: a SocialClient on the device's IndexedDB key store, the way the
// shell uses it, plus live play's client for sitting in a room. The page shows the client's state as JSON in #out and keeps
// the events it saw, so a test can read what a player would see without any product screen. window.ba is the test's handle.
import { LiveClient } from '../../../packages/core/net/client.ts';
import type { SocketLike } from '../../../packages/core/net/runtime.ts';
import { POLICY } from '../../../packages/core/social/age.ts';
import { SocialClient, type MatchDriver, type SignUp } from '../../../packages/core/social/client.ts';
import { parseFriendLink } from '../../../packages/core/social/codes.ts';
import { openKeyStore } from '../../../packages/core/social/keystore.ts';
import type { JoinGrant } from '../../../packages/core/types/net.ts';

// This suite exercises every age band, the under-13 one included (what it would be allowed the day the switch is turned on), so the
// page's copy of the switch is on, as it is in the Worker of the stack. ba.setOnline turns it off to see the production rule.
POLICY.child.online = true;

const keys = await openKeyStore();
const social = new SocialClient({ origin: '', keys });
const events: string[] = [];
const errors: string[] = [];
let live: LiveClient | null = null;
let welcomed = false;

addEventListener('error', (e) => errors.push(String(e.message)));
addEventListener('unhandledrejection', (e) => errors.push(String((e.reason as { message?: unknown } | undefined)?.message ?? e.reason)));

function snapshot(): Record<string, unknown> {
  return {
    persistent: social.persistent,
    profile: social.profile,
    recovery: social.recoveryCode,
    friends: social.friends,
    requests: social.requests,
    blocks: social.blocks,
    invites: social.invites,
    hub: social.hub,
    room: live ? { code: live.room?.code ?? null, you: live.you, welcomed, members: live.members.length, closed: live.closed } : null,
    events,
    errors,
  };
}

function render(): void {
  const out = document.getElementById('out');
  if (!out) return;
  out.textContent = JSON.stringify(snapshot(), null, 1);
  out.setAttribute('data-hub', social.hub);
}

for (const ev of ['profile', 'friends', 'requests', 'blocks', 'invites', 'hub', 'friendRequest', 'friendAdded', 'inviteDeclined', 'signedOut'] as const) {
  social.on(ev, (value: unknown) => {
    events.push(ev === 'hub' || ev === 'signedOut' ? `${ev}:${typeof value === 'string' ? value : (value as { reason: string }).reason}` : ev);
    render();
  });
}

// The page is visible or hidden: presence beats only while it is visible.
document.addEventListener('visibilitychange', () => social.setActive(!document.hidden));

async function seat(grant: JoinGrant): Promise<void> {
  live?.stop();
  welcomed = false;
  const client = new LiveClient({ grant, origin: location.origin, peers: 'none', socket: (url) => new WebSocket(url) as unknown as SocketLike });
  client.on('welcome', () => { welcomed = true; events.push('welcome'); render(); });
  client.on('fatal', (f) => { events.push(`fatal:${f.reason}`); render(); });
  live = client;
  await client.start();
  const t0 = Date.now();
  while (!welcomed) {
    if (Date.now() - t0 > 15_000) throw new Error('the room never welcomed this player');
    await new Promise((r) => setTimeout(r, 25));
  }
}

const driver: MatchDriver = {
  create: async (game, band) => {
    const grant = await social.createRoom({ kind: 'public', gameId: game, size: 2, band });
    await seat(grant);
    return { code: grant.code };
  },
  join: async (code) => { await seat(await social.joinRoom(code)); },
  leave: async () => { live?.leave(); live = null; },
};

/** Runs a call and answers with its result or with the failure as a page would see it (status and code), never throwing. */
async function attempt<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; status: number; code: string }> {
  try { return { ok: true, value: await fn() }; } catch (e) {
    const x = e as { status?: number; code?: string; message?: string };
    return { ok: false, status: x.status ?? 0, code: x.code ?? String(x.message) };
  }
}

let matchCtl: AbortController | null = null;
let matchRun: Promise<unknown> | null = null;

const ba = {
  social,
  ready: social.init().then((me) => { render(); return me; }),
  snapshot,
  attempt,
  /** The friend code in the page's own address (a friend link /f/BA-XXXXXX), the way the shell reads it. */
  addressCode: (): string | null => parseFriendLink(location.href),
  signUp: async (input: SignUp) => { const me = await social.signUp(input); render(); return me; },
  seat,
  setOnline: (band: 'child' | 'teen' | 'adult', online: boolean): void => { POLICY[band].online = online; },
  leaveRoom: (): void => { live?.leave(); live = null; welcomed = false; render(); },
  driver,
  /** A quick match search that runs until it finds a lobby, times out, or stopQuickMatch() is called. */
  startQuickMatch(game: string): void {
    matchCtl = new AbortController();
    matchRun = social.quickMatch(game, driver, { signal: matchCtl.signal, pollMs: 400 })
      .then((r) => { events.push(`match:${r.outcome}`); render(); return r; })
      .catch((e: unknown) => { const x = e as { status?: number; code?: string }; events.push(`match:error:${x.status}:${x.code}`); render(); return { outcome: 'error', status: x.status, code: x.code }; });
  },
  /** Test only: the connection breaks the way a lost network breaks it (the page did not close it), so the client must reconnect. */
  dropSocket: (): boolean => {
    const ws = (social as unknown as { socket: { close(code?: number, reason?: string): void } | null }).socket;
    ws?.close(4999, 'test drop');
    return ws !== null;
  },
  stopQuickMatch: async (): Promise<unknown> => { matchCtl?.abort(); return matchRun; },
  matchResult: (): Promise<unknown> | null => matchRun,
};
Object.assign(window, { ba });
render();
