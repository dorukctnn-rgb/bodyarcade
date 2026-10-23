import { describe, expect, it } from 'vitest';
import { decideQuick, isOlder, lobbyFits, newSearchId, rankLobbies, searchStart, waited, MAX_SEARCH_MS, REGION_WIDEN_AFTER_MS, type LobbyCandidate, type Seeker } from './quickmatch.ts';
import type { LevelBand, Region } from './types.ts';

const T = 1_800_000_000_000;

function lobby(code: string, over: Partial<LobbyCandidate> = {}): LobbyCandidate {
  return { code, game: 'squat-flap', region: 'eu', band: 'medium', open: 1, players: 1, phase: 'lobby', createdAt: T, ...over };
}

function me(over: Partial<Seeker> = {}): Seeker {
  return { game: 'squat-flap', band: 'medium', region: 'eu', hosting: null, ...over };
}

describe('which lobbies fit', () => {
  it('needs an open seat, the waiting phase and the same game', () => {
    expect(lobbyFits(lobby('AAAAAA'), me(), 0)).toBe(true);
    expect(lobbyFits(lobby('AAAAAA', { open: 0 }), me(), 0)).toBe(false);
    expect(lobbyFits(lobby('AAAAAA', { phase: 'playing' }), me(), 0)).toBe(false);
    expect(lobbyFits(lobby('AAAAAA', { game: 'knee-sprint' }), me(), 0)).toBe(false);
  });

  it('keeps to the same band at first and widens with waiting', () => {
    const easy = lobby('AAAAAA', { band: 'easy' });
    const hard = lobby('BBBBBB', { band: 'hard' });
    expect(lobbyFits(easy, me(), 0)).toBe(false);
    expect(lobbyFits(hard, me(), 0)).toBe(false);
    expect(lobbyFits(easy, me(), 8_000)).toBe(true);
    expect(lobbyFits(hard, me(), 8_000)).toBe(true);
    expect(lobbyFits(lobby('CCCCCC', { band: null }), me({ band: 'hard' }), 0)).toBe(true);
    // an easy player waits 16 seconds before a hard lobby may take them
    expect(lobbyFits(hard, me({ band: 'easy' }), 8_000)).toBe(false);
    expect(lobbyFits(hard, me({ band: 'easy' }), 16_000)).toBe(true);
  });

  it('stays in the own region until it has waited a while', () => {
    const far = lobby('AAAAAA', { region: 'na' });
    expect(lobbyFits(far, me(), 0)).toBe(false);
    expect(lobbyFits(far, me(), REGION_WIDEN_AFTER_MS - 1)).toBe(false);
    expect(lobbyFits(far, me(), REGION_WIDEN_AFTER_MS)).toBe(true);
  });

  it('never counts the lobby the seeker sits in', () => {
    const own = lobby('AAAAAA');
    expect(lobbyFits(own, me({ hosting: { code: 'AAAAAA', players: 1, createdAt: T } }), 0)).toBe(false);
  });
});

describe('ranking', () => {
  it('prefers the own region, then the nearest band, then the fuller lobby, then the older one', () => {
    const list = [
      lobby('FARFAR', { region: 'na' as Region }),
      lobby('NEWEST', { createdAt: T + 5000 }),
      lobby('OLDEST', { createdAt: T - 5000 }),
      lobby('FULLER', { players: 2, createdAt: T + 9000 }),
      lobby('NEARBD', { band: 'easy' as LevelBand }),
    ];
    const ranked = rankLobbies(list, me(), REGION_WIDEN_AFTER_MS + 8_000).map((c) => c.code);
    expect(ranked).toEqual(['FULLER', 'OLDEST', 'NEWEST', 'NEARBD', 'FARFAR']);
  });

  it('breaks exact ties by code, so every server instance picks the same lobby', () => {
    const a = rankLobbies([lobby('BBBBBB'), lobby('AAAAAA')], me(), 0).map((c) => c.code);
    const b = rankLobbies([lobby('AAAAAA'), lobby('BBBBBB')], me(), 0).map((c) => c.code);
    expect(a).toEqual(['AAAAAA', 'BBBBBB']);
    expect(b).toEqual(a);
  });
});

describe('what to do', () => {
  it('joins the best lobby, or creates one when nothing fits', () => {
    expect(decideQuick([lobby('AAAAAA')], me(), 0)).toEqual({ action: 'join', code: 'AAAAAA' });
    expect(decideQuick([], me(), 0)).toEqual({ action: 'create', band: 'medium' });
    expect(decideQuick([lobby('AAAAAA', { band: 'hard' })], me(), 0)).toEqual({ action: 'create', band: 'medium' });
  });

  it('waits in its own lobby, and offers a ghost race after 20 seconds', () => {
    const host = me({ hosting: { code: 'MINEMN', players: 1, createdAt: T } });
    expect(decideQuick([], host, 4_000)).toEqual({ action: 'wait', offerGhost: false });
    expect(decideQuick([], host, 20_000)).toEqual({ action: 'wait', offerGhost: true });
  });

  it('moves an empty lobby to an older one, never the other way', () => {
    const host = me({ hosting: { code: 'MINEMN', players: 1, createdAt: T } });
    expect(decideQuick([lobby('OLDERR', { createdAt: T - 1 })], host, 4_000)).toEqual({ action: 'merge', code: 'OLDERR' });
    expect(decideQuick([lobby('YOUNGR', { createdAt: T + 1 })], host, 4_000)).toEqual({ action: 'wait', offerGhost: false });
    // somebody already joined: stay
    const busy = me({ hosting: { code: 'MINEMN', players: 2, createdAt: T } });
    expect(decideQuick([lobby('OLDERR', { createdAt: T - 1 })], busy, 4_000)).toEqual({ action: 'wait', offerGhost: false });
  });

  it('brings two players who open a lobby at the same moment together: exactly one merges', () => {
    for (const [ta, tb, ca, cb] of [[T, T + 40, 'AAAAAA', 'BBBBBB'], [T, T, 'AAAAAA', 'BBBBBB'], [T + 40, T, 'AAAAAA', 'BBBBBB'], [T, T, 'BBBBBB', 'AAAAAA']] as const) {
      const a = decideQuick([lobby(cb, { createdAt: tb })], me({ hosting: { code: ca, players: 1, createdAt: ta } }), 4_000);
      const b = decideQuick([lobby(ca, { createdAt: ta })], me({ hosting: { code: cb, players: 1, createdAt: tb } }), 4_000);
      const merges = [a, b].filter((x) => x.action === 'merge');
      expect(merges, `${ta - T} ${tb - T} ${ca} ${cb}`).toHaveLength(1);
      expect([a, b].filter((x) => x.action === 'wait')).toHaveLength(1);
    }
  });

  it('knows which of two lobbies is older, with the code as the tie breaker', () => {
    expect(isOlder({ createdAt: 1, code: 'B' }, { createdAt: 2, code: 'A' })).toBe(true);
    expect(isOlder({ createdAt: 2, code: 'A' }, { createdAt: 2, code: 'B' })).toBe(true);
    expect(isOlder({ createdAt: 2, code: 'B' }, { createdAt: 2, code: 'A' })).toBe(false);
    expect(isOlder({ createdAt: 2, code: 'A' }, { createdAt: 2, code: 'A' })).toBe(false);
  });
});

describe('search ids', () => {
  it('carry the server start time and no more than 120 seconds of waiting count', () => {
    const id = newSearchId(T, 'abcdefghijklmnop');
    expect(id).toMatch(/^s1\.[0-9a-z]+\.abcdefghijkl$/);
    expect(searchStart(id)).toBe(T);
    expect(waited(id, T)).toBe(0);
    expect(waited(id, T + 5_000)).toBe(5_000);
    expect(waited(id, T + 10 * MAX_SEARCH_MS)).toBe(MAX_SEARCH_MS);
    expect(waited(id, T - 9_000)).toBe(0);
  });

  it('treat a missing or foreign id as a new search', () => {
    for (const bad of [undefined, null, '', 'x', 's2.abc.def', 's1.zzzzzzzzzzzz.aaaa', 's1..aaaa', 42, 's1.' + 'a'.repeat(50) + '.x']) {
      expect(searchStart(bad), String(bad)).toBeNull();
      expect(waited(bad, T)).toBe(0);
    }
  });
});
