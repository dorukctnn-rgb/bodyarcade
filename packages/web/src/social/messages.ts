// What a failed call says to the player: one sentence for each failure code, with the wait, the date and the name the answer
// carried where the sentence has them. Pure functions of the page's words; the controller and the views both use them.
import type { I18n } from '../../../core/ui/i18n/index.ts';
import type { Failed, SocialFailure } from './port.ts';
import { ux, type UxKey } from './strings.ts';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

type Ctx = { i18n: I18n };

/** "in 3 minutes": the wait the answer asked for, in the unit that reads best; "in a moment" when it did not say. */
export function waitText(ctx: Ctx, ms: number | undefined): string {
  const u = ux(ctx);
  if (ms === undefined || !(ms > 0)) return u('wait.soon');
  if (ms < 90 * SECOND) return u('wait.seconds', { n: Math.max(1, Math.ceil(ms / SECOND)) });
  if (ms < 90 * MINUTE) return u('wait.minutes', { n: Math.ceil(ms / MINUTE) });
  return u('wait.hours', { n: Math.ceil(ms / HOUR) });
}

/** A date and time in the page's language: "24 Oct 2026, 18:30". */
export const dateTimeText = (ctx: Ctx, ms: number): string => ctx.i18n.date(ms, { dateStyle: 'medium', timeStyle: 'short' });
/** A date in the page's language: "24 Oct 2026". */
export const dateText = (ctx: Ctx, ms: number): string => ctx.i18n.date(ms, { dateStyle: 'medium' });

/** The sentence of each code. A code the table lacks is a compile error. */
const KEY: Record<SocialFailure, UxKey> = {
  network: 'err.network', unavailable: 'err.unavailable', rate_limited: 'err.rate_limited', too_many_attempts: 'err.too_many_attempts', bad_request: 'err.bad_request',
  payload_too_large: 'err.payload_too_large', unauthorized: 'err.unauthorized', clock_skew: 'err.clock_skew', replayed: 'err.replayed', unknown_device: 'err.unknown_device',
  forbidden: 'err.forbidden', banned: 'err.banned', not_found: 'err.not_found', name_rejected: 'err.name_rejected', band_locked: 'err.band_locked',
  already_friends: 'err.already_friends', self: 'err.self', friends_full: 'err.friends_full', requests_full: 'err.requests_full', blocks_full: 'err.blocks_full',
  you_blocked: 'err.you_blocked', not_friends: 'err.not_friends', child_no_public: 'err.child_no_public', child_no_online: 'err.child_no_online',
  public_suspended: 'err.public_suspended', not_joinable: 'err.not_joinable', not_in_room: 'err.not_in_room', offline: 'err.offline', conflict: 'err.conflict',
  closed: 'err.closed', recovery_failed: 'err.recovery_failed', unknown_game: 'err.unknown_game', bad_run: 'err.bad_run', bad_score: 'err.bad_score',
  run_expired: 'err.run_expired', run_too_short: 'err.run_too_short', score_implausible: 'err.score_implausible',
};

const NAME_REASON: Readonly<Record<string, UxKey>> = {
  too_long: 'name.tooLong', empty: 'name.empty', handle: 'name.chars', link: 'name.contact', email: 'name.contact', phone: 'name.contact', profanity: 'name.profanity',
};

export interface FailTextOptions {
  /** The person the call was about (a friend whose list is full, a friend who is offline). */
  name?: string;
  /** A missing code means the thing is gone (a friend you already know), not that the code was mistyped. */
  gone?: boolean;
}

/** The sentence for a failed call. */
export function failText(ctx: Ctx, f: Failed, o: FailTextOptions = {}): string {
  const u = ux(ctx);
  switch (f.code) {
    case 'banned': return f.until ? u('err.banned', { until: dateTimeText(ctx, f.until) }) : u('err.bannedNoDate');
    case 'public_suspended': return f.until ? u('err.public_suspended', { until: dateTimeText(ctx, f.until) }) : ctx.i18n.t('lobby.suspended');
    case 'friends_full': return f.who === 'them' ? u('err.friends_full_them', { name: o.name ?? '' }) : u('err.friends_full');
    case 'not_found': return o.gone ? u('err.not_found_gone') : u('err.not_found');
    case 'rate_limited': case 'too_many_attempts': return u(KEY[f.code], { wait: waitText(ctx, f.retryAfterMs) });
    case 'name_rejected': return u(NAME_REASON[f.reason ?? ''] ?? 'err.name_rejected');
    case 'bad_request': return f.field === 'code' ? u('recover.badCode') : f.field === 'recovery' ? u('recover.badRecovery') : u('err.bad_request');
    case 'recovery_failed': return u('recover.failed');
    default: return u(KEY[f.code]);
  }
}
