// The social rules as numbers and pure decisions, so the Worker, the client and the tests share one source.
// Anything that costs a database write is counted here too: the free Cloudflare plans allow 100,000 D1 row writes and
// 100,000 Worker requests a day, and the design has to stay well inside them at 1,000 daily players (see the budget test).
import { policyFor } from './age.ts';
import { isFriendChars } from './codes.ts';
import type { AgeBand, FriendPresence, PresenceStatus, ReportReason, Region } from './types.ts';
import { REGIONS } from './types.ts';

export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

// ───────── presence ─────────
export const PRESENCE = {
  /** The client sends the text 'ping' this often: the platform answers 'pong' without waking the hub (no cost). */
  pingEveryMs: 45_000,
  /** One 'beat' (one D1 write) this often while the page is visible. */
  beatEveryMs: 4 * MINUTE,
  /** No beat for this long and the player counts as offline (closed lid, dead network). */
  ttlMs: 9 * MINUTE,
  /** Most friends told about one status change. */
  pushMax: 30,
  /** Hub messages per second; above it the socket is dropped (close 4008). */
  maxMessagesPerSec: 20,
  /** A status change is written at most this often per player (a flapping client costs nothing). */
  minGapMs: 1500,
} as const;

// ───────── abuse limits: fixed windows ─────────
export interface LimitSpec { readonly name: string; readonly max: number; readonly windowMs: number }

export const LIMITS = {
  /** Friend codes tried (found or not) per player. */
  lookup: { name: 'lk', max: 30, windowMs: HOUR },
  /** Friend codes that did not exist, per player: a guesser is stopped long before a hit is likely. */
  lookupMiss: { name: 'lm', max: 8, windowMs: HOUR },
  invite: { name: 'iv', max: 20, windowMs: HOUR },
  /** To one friend: three invitations in ten minutes. */
  invitePair: { name: 'ip', max: 3, windowMs: 10 * MINUTE },
  report: { name: 'rp', max: 10, windowMs: DAY },
  rename: { name: 'rn', max: 3, windowMs: DAY },
  renewCode: { name: 'rc', max: 3, windowMs: DAY },
  levelUpdate: { name: 'lv', max: 12, windowMs: DAY },
  /** New profiles per network address (a hash of it): a family shares one, a script does not. */
  registerHour: { name: 'rg', max: 20, windowMs: HOUR },
  registerDay: { name: 'rd', max: 60, windowMs: DAY },
  /** All new profiles per day: the free-plan budget breaker (the server can raise it with SOCIAL_MAX_SIGNUPS_PER_DAY). */
  signupsDay: { name: 'sg', max: 4000, windowMs: DAY },
  deleteMe: { name: 'dl', max: 5, windowMs: DAY },
} as const satisfies Record<string, LimitSpec>;

/** Per-player friend requests per day come from the age policy (age.ts requestsPerDay). */
export const requestsPerDay = (band: AgeBand): LimitSpec => ({ name: 'rq', max: policyFor(band).requestsPerDay, windowMs: DAY });

export interface Window { id: number; start: number; end: number }

export function windowOf(now: number, windowMs: number): Window {
  const id = Math.floor(now / windowMs);
  return { id, start: id * windowMs, end: (id + 1) * windowMs };
}

/** The D1 key of a counter: `<scope>:<limit>:<window id>`. Scope is a player id or a hashed address. */
export const limitKey = (scope: string, spec: Pick<LimitSpec, 'name' | 'windowMs'>, now: number): string => `${scope}:${spec.name}:${windowOf(now, spec.windowMs).id}`;

/** Milliseconds until the window of a spec ends (what the client is told to wait). */
export const retryAfterMs = (spec: Pick<LimitSpec, 'windowMs'>, now: number): number => windowOf(now, spec.windowMs).end - now;

// ───────── requests and friends ─────────
/** A declined request keeps the same sender out for this long. */
export const DECLINE_COOLDOWN_MS = 7 * DAY;
/** An unanswered request disappears after this long (it also frees the sender's outgoing slot). */
export const REQUEST_TTL_MS = 30 * DAY;
export const INVITE_TTL_MS = 2 * MINUTE;

export interface RequestFacts {
  from: { band: AgeBand; friends: number; outgoing: number; sentToday: number };
  to: { band: AgeBand; friends: number; incoming: number };
  relation: {
    self: boolean;
    alreadyFriends: boolean;
    /** The sender blocked the target. */
    fromBlockedTo: boolean;
    /** The target blocked the sender. */
    toBlockedFrom: boolean;
    declinedRecently: boolean;
    alreadyRequested: boolean;
    /** The target already asked the sender: two requests make a friendship. */
    reverseRequest: boolean;
  };
}

export type RequestDecision =
  | { kind: 'error'; code: 'self' | 'already_friends' | 'you_blocked' | 'friends_full' | 'requests_full' | 'rate_limited' }
  /** Nothing changes; the answer is still "sent". */
  | { kind: 'noop' }
  | { kind: 'befriend' }
  | { kind: 'create' }
  /** Dropped without telling the sender why (see RequestResult). */
  | { kind: 'silent' };

/**
 * What happens to a friend request. Mistakes about the sender's own state are told truthfully (own list full, own daily
 * limit). Everything that depends on the other player (they blocked you, they are under 18 and you are an adult, they
 * declined you, their inbox is full) is dropped silently, and the daily limit is checked first, so a sender over the limit
 * hears "rate_limited" for every target: nobody can use the answer to learn something about another player.
 */
export function decideRequest(f: RequestFacts): RequestDecision {
  const r = f.relation;
  if (r.self) return { kind: 'error', code: 'self' };
  if (r.alreadyFriends) return { kind: 'error', code: 'already_friends' };
  if (r.fromBlockedTo) return { kind: 'error', code: 'you_blocked' };
  if (f.from.friends >= policyFor(f.from.band).maxFriends) return { kind: 'error', code: 'friends_full' };
  if (f.from.sentToday >= policyFor(f.from.band).requestsPerDay) return { kind: 'error', code: 'rate_limited' };
  if (r.alreadyRequested) return { kind: 'noop' };
  if (r.reverseRequest) return f.to.friends >= policyFor(f.to.band).maxFriends ? { kind: 'silent' } : { kind: 'befriend' };
  if (f.from.outgoing >= policyFor(f.from.band).maxOutgoingRequests) return { kind: 'error', code: 'requests_full' };
  if (r.toBlockedFrom) return { kind: 'silent' };
  if (f.from.band === 'adult' && f.to.band !== 'adult') return { kind: 'silent' };
  if (r.declinedRecently) return { kind: 'silent' };
  if (f.to.incoming >= policyFor(f.to.band).maxIncomingRequests) return { kind: 'silent' };
  return { kind: 'create' };
}

export type AcceptDecision = { kind: 'ok' } | { kind: 'error'; code: 'friends_full'; who: 'me' | 'them' };

/** Accepting needs room in both lists (the player who asked may have filled theirs since). */
export function decideAccept(me: { band: AgeBand; friends: number }, them: { band: AgeBand; friends: number }): AcceptDecision {
  if (me.friends >= policyFor(me.band).maxFriends) return { kind: 'error', code: 'friends_full', who: 'me' };
  if (them.friends >= policyFor(them.band).maxFriends) return { kind: 'error', code: 'friends_full', who: 'them' };
  return { kind: 'ok' };
}

// ───────── presence view ─────────
export interface PresenceRow {
  status: PresenceStatus;
  game: string | null;
  room: string | null;
  seenAt: number;
  /** The owner chose to appear offline. */
  dnd: boolean;
  /** The room of this row is in its lobby phase with a free seat (from the lobby registry). */
  roomJoinable: boolean;
}

/** What a friend sees. Offline when absent, hidden, closed or silent for longer than the TTL; a room code only while it can be joined. */
export function viewPresence(row: PresenceRow | undefined | null, now: number): FriendPresence {
  if (!row || row.dnd || row.status === 'offline' || now - row.seenAt > PRESENCE.ttlMs) return { status: 'offline' };
  const p: FriendPresence = { status: row.status };
  if (row.game) p.game = row.game;
  if (row.status === 'in_room' && row.room && row.roomJoinable) p.room = row.room;
  return p;
}

// ───────── moderation ─────────
export const MOD = {
  /** This many different players reporting one player within 24 h silences their free text for 24 h (same as the Room). */
  reportersToMute: 3,
  muteMs: DAY,
  /** This many different reporters within 7 days close public lobbies to the player for three days, pending review. */
  reportersToSuspend: 6,
  /** Two different reporters for a serious reason within 24 h do the same. */
  urgentReportersToSuspend: 2,
  suspendMs: 3 * DAY,
  /** Serious reasons go to the top of the queue at once. */
  urgentReasons: ['sexual', 'underage'] as readonly ReportReason[],
  /** The report note a player may add. */
  noteMaxChars: 300,
  /** Chat lines kept as evidence per report. */
  evidenceLines: 50,
} as const;

export const isUrgentReason = (r: ReportReason): boolean => (MOD.urgentReasons as readonly string[]).includes(r);

export interface EscalationFacts {
  /** Different players who reported the target in the last 24 h (any reason). */
  reporters24h: number;
  reporters7d: number;
  /** Different players who reported the target for a serious reason in the last 24 h. */
  urgentReporters24h: number;
}

export interface Escalation { muteMs: number; suspendMs: number; urgent: boolean }

export function escalate(f: EscalationFacts): Escalation {
  const muteMs = f.reporters24h >= MOD.reportersToMute ? MOD.muteMs : 0;
  const suspendMs = f.reporters7d >= MOD.reportersToSuspend || f.urgentReporters24h >= MOD.urgentReportersToSuspend ? MOD.suspendMs : 0;
  return { muteMs, suspendMs, urgent: f.urgentReporters24h >= 1 || suspendMs > 0 };
}

// ───────── small validators shared by client and server ─────────
const GAME_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/i;
const LANG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;

export const isGameId = (x: unknown): x is string => typeof x === 'string' && GAME_ID.test(x);
export const isRegion = (x: unknown): x is Region => typeof x === 'string' && (REGIONS as readonly string[]).includes(x);
export const isLang = (x: unknown): x is string => typeof x === 'string' && x.length <= 12 && LANG.test(x);
export { isFriendChars };

/** Continents of Cloudflare's `request.cf.continent` to our regions (Antarctica counts as Oceania). */
export function regionFromContinent(continent: unknown): Region | null {
  switch (continent) {
    case 'EU': return 'eu';
    case 'NA': return 'na';
    case 'SA': return 'sa';
    case 'AS': return 'as';
    case 'AF': return 'af';
    case 'OC': case 'AN': return 'oc';
    default: return null;
  }
}
