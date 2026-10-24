// HTTP routes of the social module. Registered on the Worker's router with registerSocialRoutes(router).
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
//   GET  /api/admin/social/reports       ?status=open&limit=50      (Authorization: Bearer ADMIN_TOKEN; 404 without the token)
//   POST /api/admin/social/reports/:id   {action: dismiss|warn|mute|suspend|ban|clear, days?, note?}
//   GET  /api/admin/social/stats
//
// Every route except register and the admin routes needs a signed request (core/social/sign.ts: X-BA-Auth). Every answer
// carries `serverTime`; every error is `{error, serverTime}` (src/http.ts fail()).
import { HUB_CLOSE } from '../../../core/social/types.ts';
import { HttpError, fail } from '../http.ts';
import type { Handler, Router } from '../router.ts';
import { authenticate } from './auth.ts';
import { socialEnv } from './env.ts';
import { cancel, addBlock, listBlocks, listFriends, listRequests, removeBlock, removeFriend, respond, sendRequest } from './friends.ts';
import { HUB_HEADERS, closedSocket } from './hub.ts';
import { declineInvite, invite, listLobbies, quickMatch } from './lobbies.ts';
import { adminAct, adminReports, adminStats, report } from './moderation.ts';
import { deleteMe, exportMe, getMe, recover, register, renewCode, renewRecovery, updateMe } from './profile.ts';
import { finishRun, leaderboard, startRun } from './scores.ts';
import { getSync, putSync } from './sync.ts';
import { authed, guardRequest, open } from './util.ts';

/** GET /api/social/hub: verify the signed request, then hand the socket to the player's PlayerHub. */
const hubConnect: Handler = async (req, raw, ctx) => {
  const env = socialEnv(raw);
  if (req.headers.get('Upgrade') !== 'websocket') return fail('expected_websocket', 426);
  const origin = req.headers.get('Origin');
  if (origin) {
    let same = false;
    try { same = new URL(origin).host === new URL(req.url).host; } catch { same = false; }
    if (!same) return fail('origin', 403);
  }
  const now = Date.now();
  const pending: Promise<unknown>[] = [];
  try {
    guardRequest(env, req, null, now);
    const me = await authenticate({ req, db: env.DB, now, wait: (p) => { pending.push(p); } }, undefined);
    guardRequest(env, req, me.pid, now);
    ctx.waitUntil(Promise.allSettled(pending));
    const stub = env.HUB.get(env.HUB.idFromName(me.pid));
    return await stub.fetch(new Request('https://hub.internal/ws', {
      headers: {
        Upgrade: 'websocket',
        [HUB_HEADERS.pid]: me.pid,
        [HUB_HEADERS.fid]: me.fid,
        [HUB_HEADERS.name]: encodeURIComponent(me.name),
        [HUB_HEADERS.band]: me.band,
      },
    }));
  } catch (e) {
    if (e instanceof HttpError) {
      // The page gets a close code it can act on instead of a bare network error.
      if (e.code === 'banned') return closedSocket(HUB_CLOSE.BANNED, 'banned');
      if (e.status === 401) return closedSocket(HUB_CLOSE.AUTH, e.code);
      if (e.status === 429) return closedSocket(HUB_CLOSE.RATE, 'rate_limited');
    }
    throw e;
  }
};

export function registerSocialRoutes(router: Router): void {
  router.add('POST', '/api/social/register', open(register));
  router.add('POST', '/api/social/recover', open(recover));
  router.add('GET', '/api/social/me', authed(getMe));
  router.add('POST', '/api/social/me', authed(updateMe));
  router.add('POST', '/api/social/me/code', authed(renewCode));
  router.add('POST', '/api/social/me/recovery', authed(renewRecovery));
  router.add('GET', '/api/social/me/export', authed(exportMe, { allowBanned: true }));
  router.add('POST', '/api/social/me/delete', authed(deleteMe, { allowBanned: true }));
  router.add('GET', '/api/social/friends', authed(listFriends));
  router.add('GET', '/api/social/requests', authed(listRequests));
  router.add('POST', '/api/social/friends/request', authed(sendRequest));
  router.add('POST', '/api/social/friends/respond', authed(respond));
  router.add('POST', '/api/social/friends/cancel', authed(cancel));
  router.add('POST', '/api/social/friends/remove', authed(removeFriend));
  router.add('GET', '/api/social/blocks', authed(listBlocks));
  router.add('POST', '/api/social/blocks', authed(addBlock));
  router.add('POST', '/api/social/blocks/remove', authed(removeBlock));
  router.add('POST', '/api/social/report', authed(report));
  router.add('POST', '/api/social/invite', authed(invite));
  router.add('POST', '/api/social/invite/decline', authed(declineInvite));
  router.add('GET', '/api/social/lobbies', authed(listLobbies));
  router.add('POST', '/api/social/match', authed(quickMatch));
  router.add('GET', '/api/social/sync', authed(getSync));
  router.add('PUT', '/api/social/sync/:key', authed(putSync));
  router.add('POST', '/api/social/scores/start', authed(startRun));
  router.add('POST', '/api/social/scores', authed(finishRun));
  router.add('GET', '/api/social/leaderboard', authed(leaderboard));
  router.add('GET', '/api/social/hub', hubConnect);
  router.add('GET', '/api/admin/social/reports', adminReports);
  router.add('POST', '/api/admin/social/reports/:id', adminAct);
  router.add('GET', '/api/admin/social/stats', adminStats);
}
