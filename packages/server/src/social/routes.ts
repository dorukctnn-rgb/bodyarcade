// HTTP routes of the social module, and the two places they are registered:
//
//   registerSocialRoutes(router)      the Worker: every route below is forwarded to the SocialDirectory object (directory.ts), which
//                                     holds the tables and the sockets; `/f/:code` is served by the Worker itself.
//   registerDirectoryRoutes(router)   the directory (and the handler tests): the handlers themselves.
//
// The routes (all /api/social/..., signed JSON unless said otherwise):
//
//   POST /api/social/register            a new passwordless profile (signed with the key it registers)      -> {me, created}
//   POST /api/social/recover             the profile back on a new device {pub, code, recovery}             -> {me}
//   GET  /api/social/me                  the player's profile                                               -> {me}
//   POST /api/social/me                  change name, region, language, level, appear-offline, band (down)  -> {me}
//   POST /api/social/me/code             a new friend code                                                   -> {me}
//   POST /api/social/me/recovery         a new recovery code                                                 -> {recovery}
//   GET  /api/social/me/export           every stored byte about the player                                  -> {export}
//   POST /api/social/me/delete           erase the profile {confirm: 'delete'}                               -> {deleted}
//   GET  /api/social/friends             friends with presence                                               -> {friends}
//   GET  /api/social/requests            requests received and sent                                          -> {incoming, outgoing}
//   POST /api/social/friends/request     by code or link {code | link}                                       -> {status}
//   POST /api/social/friends/respond     {fid, accept}                                                       -> {status}
//   POST /api/social/friends/cancel      {fid}
//   POST /api/social/friends/remove      {fid}
//   GET  /api/social/blocks, POST /api/social/blocks {fid}, POST /api/social/blocks/remove {fid}
//   POST /api/social/report              {fid, reason, note?, block?}
//   POST /api/social/invite              {fid, room}                                                         -> {id, exp}
//   POST /api/social/invite/decline      {fid, id}
//   GET  /api/social/lobbies             ?game=&region=                                                      -> {lobbies}
//   POST /api/social/match               {game, searchId?, hosting?}                                         -> QuickAction
//   GET  /api/social/sync                the player's synced documents                                       -> {docs}
//   PUT  /api/social/sync/:key           {baseRev, data}                                                     -> {rev, at}
//   POST /api/social/scores/start        {game}                                                              -> {run, game, at}
//   POST /api/social/scores              {run, game, score}                                                  -> {improved, best, week}
//   GET  /api/social/leaderboard         ?game=&scope=friends|country&week=current|previous                  -> {board}
//   GET  /api/social/hub                 WebSocket, ?ba_auth=<signature>                                     (presence and pushes)
//   GET  /f/:code                        the app's start page under a friend link (the page reads the code from its address)
//   GET  /api/admin/social/reports       ?status=open&limit=50      (Authorization: Bearer ADMIN_TOKEN; 404 without the token)
//   POST /api/admin/social/reports/:id   {action: dismiss|warn|mute|suspend|ban|clear, days?, note?}
//   GET  /api/admin/social/stats
//
// Every route except register and the admin routes needs a signed request (core/social/sign.ts: X-BA-Auth). Every answer
// carries `serverTime`; every error is `{error, serverTime}` (src/http.ts fail()).
import type { Fetcher } from '../cf.ts';
import { HttpError, clientIp, fail } from '../http.ts';
import type { Handler, Router } from '../router.ts';
import { directoryOf } from './env.ts';
import { cancel, addBlock, listBlocks, listFriends, listRequests, removeBlock, removeFriend, respond, sendRequest } from './friends.ts';
import { declineInvite, invite, listLobbies, quickMatch } from './lobbies.ts';
import { adminAct, adminReports, adminStats, report } from './moderation.ts';
import { deleteMe, exportMe, getMe, recover, register, renewCode, renewRecovery, updateMe } from './profile.ts';
import { finishRun, leaderboard, startRun } from './scores.ts';
import { getSync, putSync } from './sync.ts';
import { authed, memAllow, open } from './util.ts';
import { GEO_CONTINENT, GEO_COUNTRY, CALLER_IP } from './geo.ts';

/**
 * A friend link `<origin>/f/BA-7K2Q4X` opens the app. The page reads the code from its own address (parseFriendLink(location.href)),
 * so every code gets the same shell: the Worker serves the start page (`/`) under the link's address and keeps it out of search
 * results, the way live play does for its `/r/CODE` invitations. Needs "/f/*" in `assets.run_worker_first` of the wrangler config:
 * without it the static assets answer first, and a shared link is a 404. The code is a key to the player's request inbox, so the
 * page is sent with no referrer.
 */
export const openFriendLink: Handler = async (req, raw) => {
  const assets = raw.ASSETS as Fetcher | undefined;
  if (!assets) return new Response('not found', { status: 404 });
  const shell = await assets.fetch(new Request(new URL('/', req.url), { method: 'GET', headers: { Accept: 'text/html' } }));
  const redirected = shell.status >= 300 && shell.status < 400;
  const headers = new Headers(shell.headers);
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  headers.set('Cache-Control', 'no-cache');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.delete('Location');
  return new Response(redirected ? 'unavailable' : shell.body, { status: redirected ? 503 : shell.status, headers });
};

// ───────── the Worker: forward to the directory ─────────

/** Calls per address per minute the Worker lets through to the directory (per isolate: the first line before the object's own limits). */
export const EDGE_PER_MINUTE = 600;

/**
 * The request as the directory should see it. The directory is reached only through the Worker, so what Cloudflare knows about the
 * caller (the address, the country, the continent) is put in headers it can read, replacing anything the caller sent under the same
 * names; the directory's own handlers take the address and the country from there.
 */
export function forwardedHeaders(req: Request): Headers {
  const h = new Headers(req.headers);
  h.delete(CALLER_IP);
  h.delete(GEO_CONTINENT);
  const ip = clientIp(req);
  if (ip) h.set(CALLER_IP, ip);
  const cf = (req as unknown as { cf?: { country?: unknown; continent?: unknown } }).cf;
  if (typeof cf?.country === 'string' && /^[A-Za-z]{2}$/.test(cf.country)) h.set(GEO_COUNTRY, cf.country.toUpperCase());
  if (typeof cf?.continent === 'string' && /^[A-Za-z]{2}$/.test(cf.continent)) h.set(GEO_CONTINENT, cf.continent.toUpperCase());
  return h;
}

/** Hands the request to the directory object and returns its answer (a WebSocket upgrade included). */
export const forwardToDirectory: Handler = async (req, raw) => {
  const dir = directoryOf(raw);
  if (raw.SOCIAL_NO_LIMITS !== '1') {
    const ip = clientIp(req);
    if (ip && !memAllow(`edge:${ip}`, EDGE_PER_MINUTE, 60_000)) throw new HttpError(429, 'rate_limited', { retryAfterMs: 60_000 });
  }
  // An upgrade goes through as it came: the platform pairs the sockets of the request it was given.
  if (req.headers.get('Upgrade')?.toLowerCase() === 'websocket') return dir.fetch(req);
  return dir.fetch(new Request(req, { headers: forwardedHeaders(req) }));
};

// ───────── the table ─────────

interface Deps {
  /** GET /api/social/hub: the directory accepts the player's socket (it needs its own state to do it). */
  connectHub: Handler;
}

type Method = 'GET' | 'POST' | 'PUT';

/** Every route the directory serves: method, pattern, and the handler (given what only the directory has). */
const TABLE: readonly (readonly [Method, string, (d: Deps) => Handler])[] = [
  ['POST', '/api/social/register', () => open(register)],
  ['POST', '/api/social/recover', () => open(recover)],
  ['GET', '/api/social/me', () => authed(getMe)],
  ['POST', '/api/social/me', () => authed(updateMe)],
  ['POST', '/api/social/me/code', () => authed(renewCode)],
  ['POST', '/api/social/me/recovery', () => authed(renewRecovery)],
  ['GET', '/api/social/me/export', () => authed(exportMe, { allowBanned: true })],
  ['POST', '/api/social/me/delete', () => authed(deleteMe, { allowBanned: true })],
  ['GET', '/api/social/friends', () => authed(listFriends)],
  ['GET', '/api/social/requests', () => authed(listRequests)],
  ['POST', '/api/social/friends/request', () => authed(sendRequest)],
  ['POST', '/api/social/friends/respond', () => authed(respond)],
  ['POST', '/api/social/friends/cancel', () => authed(cancel)],
  ['POST', '/api/social/friends/remove', () => authed(removeFriend)],
  ['GET', '/api/social/blocks', () => authed(listBlocks)],
  ['POST', '/api/social/blocks', () => authed(addBlock)],
  ['POST', '/api/social/blocks/remove', () => authed(removeBlock)],
  ['POST', '/api/social/report', () => authed(report)],
  ['POST', '/api/social/invite', () => authed(invite)],
  ['POST', '/api/social/invite/decline', () => authed(declineInvite)],
  ['GET', '/api/social/lobbies', () => authed(listLobbies)],
  ['POST', '/api/social/match', () => authed(quickMatch)],
  ['GET', '/api/social/sync', () => authed(getSync)],
  ['PUT', '/api/social/sync/:key', () => authed(putSync)],
  ['POST', '/api/social/scores/start', () => authed(startRun)],
  ['POST', '/api/social/scores', () => authed(finishRun)],
  ['GET', '/api/social/leaderboard', () => authed(leaderboard)],
  ['GET', '/api/social/hub', (d) => d.connectHub],
  ['GET', '/api/admin/social/reports', () => adminReports],
  ['POST', '/api/admin/social/reports/:id', () => adminAct],
  ['GET', '/api/admin/social/stats', () => adminStats],
];

/** The Worker's routes: all of the table forwarded to the directory, and the friend-link page served here. */
export function registerSocialRoutes(router: Router): void {
  for (const [method, pattern] of TABLE) router.add(method, pattern, forwardToDirectory);
  router.add('GET', '/f/:code', openFriendLink);
}

/** The directory's routes: the handlers (and, in the handler tests, the whole module on one router). */
export function registerDirectoryRoutes(router: Router, deps: Partial<Deps> = {}): void {
  const full: Deps = { connectHub: deps.connectHub ?? (() => fail('unavailable', 503)) };
  for (const [method, pattern, make] of TABLE) router.add(method, pattern, make(full));
}
