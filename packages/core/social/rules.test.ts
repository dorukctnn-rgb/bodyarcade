import { describe, expect, it } from 'vitest';
import { policyFor } from './age.ts';
import {
  DAY, HOUR, LIMITS, MOD, PRESENCE, decideAccept, decideRequest, escalate, isGameId, isLang, isRegion, isUrgentReason,
  limitKey, regionFromContinent, requestsPerDay, retryAfterMs, viewPresence, windowOf, type PresenceRow, type RequestFacts,
} from './rules.ts';
import { AGE_BANDS, REGIONS, type AgeBand } from './types.ts';

function facts(over: { from?: Partial<RequestFacts['from']>; to?: Partial<RequestFacts['to']>; relation?: Partial<RequestFacts['relation']> } = {}): RequestFacts {
  return {
    from: { band: 'adult', friends: 0, outgoing: 0, sentToday: 0, ...over.from },
    to: { band: 'adult', friends: 0, incoming: 0, ...over.to },
    relation: {
      self: false, alreadyFriends: false, fromBlockedTo: false, toBlockedFrom: false, declinedRecently: false,
      alreadyRequested: false, reverseRequest: false, ...over.relation,
    },
  };
}

describe('friend request decisions', () => {
  it('creates a request between two free adults', () => {
    expect(decideRequest(facts())).toEqual({ kind: 'create' });
  });

  it('tells the sender the truth about their own state', () => {
    expect(decideRequest(facts({ relation: { self: true } }))).toEqual({ kind: 'error', code: 'self' });
    expect(decideRequest(facts({ relation: { alreadyFriends: true } }))).toEqual({ kind: 'error', code: 'already_friends' });
    expect(decideRequest(facts({ relation: { fromBlockedTo: true } }))).toEqual({ kind: 'error', code: 'you_blocked' });
    expect(decideRequest(facts({ from: { friends: policyFor('adult').maxFriends } }))).toEqual({ kind: 'error', code: 'friends_full' });
    expect(decideRequest(facts({ from: { outgoing: policyFor('adult').maxOutgoingRequests } }))).toEqual({ kind: 'error', code: 'requests_full' });
    expect(decideRequest(facts({ from: { sentToday: policyFor('adult').requestsPerDay } }))).toEqual({ kind: 'error', code: 'rate_limited' });
  });

  it('answers a repeated request with no change', () => {
    expect(decideRequest(facts({ relation: { alreadyRequested: true } }))).toEqual({ kind: 'noop' });
  });

  it('turns two requests into a friendship', () => {
    expect(decideRequest(facts({ relation: { reverseRequest: true } }))).toEqual({ kind: 'befriend' });
    // even an adult may answer the request an under-18 player sent first
    expect(decideRequest(facts({ to: { band: 'teen' }, relation: { reverseRequest: true } }))).toEqual({ kind: 'befriend' });
    // but not when the other list is full
    expect(decideRequest(facts({ to: { friends: policyFor('adult').maxFriends }, relation: { reverseRequest: true } }))).toEqual({ kind: 'silent' });
  });

  it('drops everything that depends on the other player without telling the sender why', () => {
    expect(decideRequest(facts({ relation: { toBlockedFrom: true } }))).toEqual({ kind: 'silent' });
    expect(decideRequest(facts({ relation: { declinedRecently: true } }))).toEqual({ kind: 'silent' });
    expect(decideRequest(facts({ to: { incoming: policyFor('adult').maxIncomingRequests } }))).toEqual({ kind: 'silent' });
    for (const to of ['child', 'teen'] as const) expect(decideRequest(facts({ to: { band: to } }))).toEqual({ kind: 'silent' });
  });

  it('lets under-18 players send requests to adults and to each other', () => {
    for (const from of ['child', 'teen'] as const) for (const to of AGE_BANDS) expect(decideRequest(facts({ from: { band: from }, to: { band: to } }))).toEqual({ kind: 'create' });
  });

  it('gives the same answer for every target once the sender is over the daily limit (no probing by answer)', () => {
    for (const from of AGE_BANDS) {
      const over = { band: from, sentToday: policyFor(from).requestsPerDay };
      for (const to of AGE_BANDS) {
        for (const relation of [{}, { toBlockedFrom: true }, { declinedRecently: true }] as const) {
          expect(decideRequest(facts({ from: over, to: { band: to }, relation }))).toEqual({ kind: 'error', code: 'rate_limited' });
        }
      }
    }
  });

  it('never reveals the target band: for a sender who is within limits an adult gets the same answer for a minor and for a blocker', () => {
    const toMinor = decideRequest(facts({ to: { band: 'teen' } }));
    const toBlocker = decideRequest(facts({ relation: { toBlockedFrom: true } }));
    expect(toMinor).toEqual(toBlocker);
  });

  it('accepts only when both lists have room, and says whose is full', () => {
    const full = (band: AgeBand) => ({ band, friends: policyFor(band).maxFriends });
    expect(decideAccept({ band: 'adult', friends: 3 }, { band: 'teen', friends: 3 })).toEqual({ kind: 'ok' });
    expect(decideAccept(full('child'), { band: 'adult', friends: 0 })).toEqual({ kind: 'error', code: 'friends_full', who: 'me' });
    expect(decideAccept({ band: 'adult', friends: 0 }, full('child'))).toEqual({ kind: 'error', code: 'friends_full', who: 'them' });
  });
});

describe('limit windows', () => {
  it('cuts time into fixed windows and builds one key per scope, limit and window', () => {
    const t = 10 * DAY + 5 * HOUR + 123;
    const w = windowOf(t, DAY);
    expect(w).toEqual({ id: 10, start: 10 * DAY, end: 11 * DAY });
    expect(limitKey('P1', LIMITS.report, t)).toBe('P1:rp:10');
    expect(limitKey('P1', LIMITS.report, t + 1)).toBe(limitKey('P1', LIMITS.report, t));
    expect(limitKey('P1', LIMITS.report, t + DAY)).not.toBe(limitKey('P1', LIMITS.report, t));
    expect(limitKey('P2', LIMITS.report, t)).not.toBe(limitKey('P1', LIMITS.report, t));
    expect(retryAfterMs(LIMITS.report, t)).toBe(11 * DAY - t);
  });

  it('keeps the guessing limits far below what finds a code (a code has 1.07 billion values)', () => {
    // at the miss limit a guesser tries 8 codes an hour: 1.07e9 / 8 hours is over 15,000 years for one hit on average
    const yearsPerHit = 32 ** 6 / 2 / (LIMITS.lookupMiss.max * 24 * 365);
    expect(yearsPerHit).toBeGreaterThan(5000);
    expect(LIMITS.lookupMiss.max).toBeLessThan(LIMITS.lookup.max);
  });

  it('has one daily request limit per band that grows with age', () => {
    expect(requestsPerDay('child').max).toBeLessThan(requestsPerDay('adult').max);
    expect(requestsPerDay('teen').windowMs).toBe(DAY);
  });

  it('keeps every limit name unique, so one counter never counts two things', () => {
    const names = Object.values(LIMITS).map((l) => l.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).not.toContain(requestsPerDay('adult').name);
  });
});

describe('what a friend sees of presence', () => {
  const NOW = 2_000_000_000_000;
  const row = (over: Partial<PresenceRow> = {}): PresenceRow => ({ status: 'online', game: null, room: null, seenAt: NOW - 1000, dnd: false, roomJoinable: false, ...over });

  it('shows offline when there is no row, the player hides, closed, or went silent', () => {
    expect(viewPresence(undefined, NOW)).toEqual({ status: 'offline' });
    expect(viewPresence(row({ dnd: true }), NOW)).toEqual({ status: 'offline' });
    expect(viewPresence(row({ status: 'offline' }), NOW)).toEqual({ status: 'offline' });
    expect(viewPresence(row({ seenAt: NOW - PRESENCE.ttlMs - 1 }), NOW)).toEqual({ status: 'offline' });
    expect(viewPresence(row({ seenAt: NOW - PRESENCE.ttlMs }), NOW)).toEqual({ status: 'online' });
  });

  it('shows the game, and the room only while it can be joined', () => {
    expect(viewPresence(row({ status: 'playing', game: 'squat-flap' }), NOW)).toEqual({ status: 'playing', game: 'squat-flap' });
    expect(viewPresence(row({ status: 'in_room', game: 'squat-flap', room: 'ABC234', roomJoinable: true }), NOW)).toEqual({ status: 'in_room', game: 'squat-flap', room: 'ABC234' });
    expect(viewPresence(row({ status: 'in_room', game: 'squat-flap', room: 'ABC234', roomJoinable: false }), NOW)).toEqual({ status: 'in_room', game: 'squat-flap' });
    // a running match never offers its room code
    expect(viewPresence(row({ status: 'playing', game: 'squat-flap', room: 'ABC234', roomJoinable: true }), NOW)).toEqual({ status: 'playing', game: 'squat-flap' });
  });

  it('keeps the heartbeat inside the time-to-live with room for one lost beat', () => {
    expect(PRESENCE.ttlMs).toBeGreaterThanOrEqual(2 * PRESENCE.beatEveryMs);
    expect(PRESENCE.pingEveryMs).toBeLessThan(60_000);
  });
});

describe('moderation escalation', () => {
  it('does nothing for one or two reporters', () => {
    expect(escalate({ reporters24h: 1, reporters7d: 1, urgentReporters24h: 0 })).toEqual({ muteMs: 0, suspendMs: 0, urgent: false });
    expect(escalate({ reporters24h: 2, reporters7d: 2, urgentReporters24h: 0 })).toEqual({ muteMs: 0, suspendMs: 0, urgent: false });
  });

  it('mutes free text for a day at three different reporters', () => {
    expect(escalate({ reporters24h: 3, reporters7d: 3, urgentReporters24h: 0 })).toEqual({ muteMs: MOD.muteMs, suspendMs: 0, urgent: false });
  });

  it('closes public lobbies for three days at six reporters in a week or two serious ones in a day', () => {
    expect(escalate({ reporters24h: 2, reporters7d: 6, urgentReporters24h: 0 })).toEqual({ muteMs: 0, suspendMs: MOD.suspendMs, urgent: true });
    expect(escalate({ reporters24h: 2, reporters7d: 2, urgentReporters24h: 2 })).toEqual({ muteMs: 0, suspendMs: MOD.suspendMs, urgent: true });
  });

  it('puts one serious report on top of the queue without any penalty yet', () => {
    expect(escalate({ reporters24h: 1, reporters7d: 1, urgentReporters24h: 1 })).toEqual({ muteMs: 0, suspendMs: 0, urgent: true });
    expect(isUrgentReason('sexual')).toBe(true);
    expect(isUrgentReason('underage')).toBe(true);
    expect(isUrgentReason('cheating')).toBe(false);
  });
});

describe('validators', () => {
  it('accepts game ids, languages and regions, and nothing odd', () => {
    for (const g of ['squat-flap', 'knee_sprint', 'a', 'Pose2']) expect(isGameId(g), g).toBe(true);
    for (const g of ['', '-a', 'a b', 'a/b', 'x'.repeat(41), 'ş', 5, null]) expect(isGameId(g), String(g)).toBe(false);
    for (const l of ['en', 'tr', 'pt-BR', 'zh-Hans', 'fil']) expect(isLang(l), l).toBe(true);
    for (const l of ['', 'e', 'english', 'en_US', 'tr-', 'x'.repeat(20), 3]) expect(isLang(l), String(l)).toBe(false);
    for (const r of REGIONS) expect(isRegion(r)).toBe(true);
    expect(isRegion('mars')).toBe(false);
  });

  it('maps Cloudflare continents to regions', () => {
    expect(regionFromContinent('EU')).toBe('eu');
    expect(regionFromContinent('NA')).toBe('na');
    expect(regionFromContinent('SA')).toBe('sa');
    expect(regionFromContinent('AS')).toBe('as');
    expect(regionFromContinent('AF')).toBe('af');
    expect(regionFromContinent('OC')).toBe('oc');
    expect(regionFromContinent('AN')).toBe('oc');
    expect(regionFromContinent('T1')).toBeNull();
    expect(regionFromContinent(undefined)).toBeNull();
  });
});
