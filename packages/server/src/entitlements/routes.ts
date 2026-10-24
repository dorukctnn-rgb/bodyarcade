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
import { API } from '../../../core/entitlements/api.ts';
import type { Router } from '../router.ts';
import { HttpError, clientIp, fail, readJson } from '../http.ts';
import { entitlementsEnv } from './env.ts';
import {
  parseDeactivateBody, parseKeyBody, parsePlayBody, parseReminderBody, parseResetBody, type Parsed,
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
}

/** The one line src/index.ts needs. */
export const registerEntitlements = registerEntitlementRoutes;
