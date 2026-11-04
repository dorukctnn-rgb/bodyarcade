// The entitlement routes on the Worker's shared router (api.ts is the contract the app shares). Each route checks the
// body, adds the caller's address and hands the call to the one EntitlementsDO; the answer goes back as it is.
//
//   POST /api/entitlements/activate    a licence key on this device
//   POST /api/entitlements/refresh     the same key again, to renew the token
//   POST /api/entitlements/play        Google Play purchases of this device
//   POST /api/entitlements/deactivate  give this device's seat back
//   POST /api/entitlements/reset       give every other seat back
//   POST /api/entitlements/reminder    one e-mail two days before a trial ends (or take the address back)
//   GET  /api/entitlements/key         the public keys that verify tokens
import { API, PADDLE_WEBHOOK_PATH } from '../../../core/entitlements/api.ts';
import { PADDLE_PRICES } from '../../../core/entitlements/paddle.ts';
import { verifyPaddleSignature } from './paddle.ts';
import type { Router } from '../router.ts';
import { HttpError, clientIp, fail, json, readJson } from '../http.ts';
import { entitlementsEnv } from './env.ts';
import {
  parseDeactivateBody, parseKeyBody, parsePaddleClaimBody, parsePaddlePortalBody, parsePaddleRestoreBody, parsePlayBody, parseReminderBody, parseResetBody,
  type Parsed,
} from './parse.ts';

const SMALL = 4096;
/** Ten Play purchase tokens of up to 1024 characters. */
const PLAY_BODY = 16 * 1024;

/** Hands one call to the Durable Object. A refusal to answer at all is "unavailable", which the app treats as "try later". */
async function callDo(env: Record<string, unknown>, op: string, payload: Record<string, unknown> | null, req: Request): Promise<Response> {
  const e = entitlementsEnv(env);
  try {
    const stub = e.ENTITLEMENTS.get(e.ENTITLEMENTS.idFromName('main'));
    const url = `https://entitlements.internal/${op}`;
    return await stub.fetch(payload === null
      ? new Request(url, { method: 'GET' })
      : new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, ip: clientIp(req) }) }));
  } catch (err) {
    console.log(JSON.stringify({ evt: 'ent_do_error', op, error: String((err as { message?: unknown })?.message ?? err).slice(0, 200) }));
    return fail('unavailable', 503);
  }
}

function post<T extends object>(op: string, parse: (x: unknown) => Parsed<T>, maxBytes: number) {
  return async (req: Request, env: Record<string, unknown>): Promise<Response> => {
    entitlementsEnv(env);
    const body = await readJson(req, maxBytes);
    const p = parse(body);
    if (!p.ok) throw new HttpError(400, 'bad_request');
    return callDo(env, op, p.value as unknown as Record<string, unknown>, req);
  };
}

export function registerEntitlementRoutes(router: Router): void {
  router.add('POST', API.activate, post('activate', parseKeyBody, SMALL));
  router.add('POST', API.refresh, post('refresh', parseKeyBody, SMALL));
  router.add('POST', API.play, post('play', parsePlayBody, PLAY_BODY));
  router.add('POST', API.deactivate, post('deactivate', parseDeactivateBody, SMALL));
  router.add('POST', API.reset, post('reset', parseResetBody, PLAY_BODY));
  router.add('POST', API.reminder, post('reminder', parseReminderBody, SMALL));
  router.add('GET', API.key, (req, env) => callDo(env, 'key', null, req));

  // Paddle Billing (paddle.ts): the checkout's completion, the restore e-mail, the customer portal, the page's settings.
  router.add('POST', API.paddle, post('paddle', parsePaddleClaimBody, SMALL));
  router.add('POST', API.paddleRestore, post('paddle-restore', parsePaddleRestoreBody, SMALL));
  router.add('POST', API.paddlePortal, post('paddle-portal', parsePaddlePortalBody, SMALL));
  router.add('GET', API.paddleConfig, (_req, env) => {
    // Paddle's client-side token is public by design (it only opens checkouts); it lives in the Worker's settings, not in the code.
    const token = env['PADDLE_CLIENT_TOKEN'];
    // "ctkn_" + 26 (the dashboard's tokens since 2026) or the older live_/test_ form; the environment is PADDLE_ENV's (an old test_ token is the sandbox).
    if (typeof token !== 'string' || !PADDLE_CLIENT_TOKEN_RE.test(token)) return fail('unavailable', 503);
    const environment = env['PADDLE_ENV'] === 'sandbox' || token.startsWith('test_') ? 'sandbox' : 'production';
    return json({ token, environment, prices: PADDLE_PRICES }, 200, { 'Cache-Control': 'public, max-age=300' });
  });
  router.add('POST', PADDLE_WEBHOOK_PATH, async (req, env) => {
    const secret = env['PADDLE_WEBHOOK_SECRET'];
    if (typeof secret !== 'string' || secret === '') return fail('unavailable', 503);
    const raw = await readText(req, PADDLE_BODY);
    if (raw === null) return fail('too_large', 413);
    const v = await verifyPaddleSignature(req.headers.get('Paddle-Signature'), raw, secret, Math.floor(Date.now() / 1000));
    if (!v.ok) {
      console.log(JSON.stringify({ evt: 'paddle_webhook_refused', reason: v.reason }));
      return fail('bad_signature', 401);
    }
    // A 5xx makes Paddle send it again later, which is what an unavailable store should do.
    return callDo(env, 'paddle-event', { raw }, req);
  });
}

/** A Paddle client-side token: public by design (it can only open checkouts). */
export const PADDLE_CLIENT_TOKEN_RE = /^(?:ctkn_[0-9a-z]{26}|(?:live|test)_[A-Za-z0-9]{10,64})$/;

/** Paddle's notifications are small; a bigger body is not one of them. */
const PADDLE_BODY = 256 * 1024;

/** The body as text, exactly as received (the signature covers these bytes), or null when it is larger than `max`. */
async function readText(req: Request, max: number): Promise<string | null> {
  if (Number(req.headers.get('Content-Length') ?? '0') > max) return null;
  const buf = new Uint8Array(await req.arrayBuffer());
  if (buf.byteLength > max) return null;
  return new TextDecoder().decode(buf);
}

/** The one line src/index.ts needs. */
export const registerEntitlements = registerEntitlementRoutes;
