// What a failed call of the social client means for a screen: the client throws SocialApiError (status 0 is a network that
// did not answer, otherwise the status and the `error` code of the answer, with the answer's own body); the ports
// answer with a plain value, `{ ok: false, code, ... }`, and never throw. Pure: no DOM, no client.
import { SocialApiError } from '../../../core/social/client.ts';
import type { SocialErrorCode } from '../../../core/social/types.ts';
import type { Failed, SocialFailure } from './port.ts';

/** Every code the server may answer with (types.ts SocialErrorCode); the check below keeps this list whole. */
const CODES = [
  'bad_request', 'payload_too_large', 'unauthorized', 'clock_skew', 'replayed', 'unknown_device', 'forbidden', 'banned', 'not_found', 'rate_limited',
  'too_many_attempts', 'name_rejected', 'band_locked', 'already_friends', 'self', 'friends_full', 'requests_full', 'blocks_full', 'you_blocked',
  'not_friends', 'child_no_public', 'child_no_online', 'public_suspended', 'not_joinable', 'not_in_room', 'offline', 'conflict', 'closed',
  'recovery_failed', 'unknown_game', 'bad_run', 'bad_score', 'run_expired', 'run_too_short', 'score_implausible', 'unavailable',
] as const satisfies readonly SocialErrorCode[];
/** Compile-time: a code added to SocialErrorCode and not to CODES makes this type something other than `never`. */
type Missing = Exclude<SocialErrorCode, (typeof CODES)[number]>;
const complete: [Missing] extends [never] ? true : never = true;
void complete;

const KNOWN: ReadonlySet<string> = new Set<string>(CODES);

/** The failure code of an error answer: the server's own when it is one of ours, else what its status says. */
export function codeOf(status: number, code: string): SocialFailure {
  if (status === 0) return 'network';
  if (KNOWN.has(code)) return code as SocialErrorCode;
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'unavailable';
  return 'bad_request';
}

/**
 * The failure a port answers with. Anything that is not a SocialApiError is a bug of this page, not of the player's: it is
 * logged and the player is told the service is unavailable.
 */
export function failed(e: unknown): Failed {
  if (!(e instanceof SocialApiError)) {
    console.error(e);
    return { ok: false, code: 'unavailable' };
  }
  const body = e.body;
  const out: Failed = { ok: false, code: codeOf(e.status, e.code) };
  if (e.retryAfterMs !== undefined) out.retryAfterMs = e.retryAfterMs;
  if (typeof body?.until === 'number') out.until = body.until;
  if (typeof body?.reason === 'string') out.reason = body.reason;
  if (body?.who === 'me' || body?.who === 'them') out.who = body.who;
  if (typeof body?.field === 'string') out.field = body.field;
  return out;
}

/** Is this failure the network (no answer at all) or the service being down? The page then offers to try again. */
export const isOffline = (code: SocialFailure): boolean => code === 'network' || code === 'unavailable';
