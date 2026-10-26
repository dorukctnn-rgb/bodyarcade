import { describe, expect, it } from 'vitest';
import { PRESETS, REACTIONS } from '../types/net.ts';
import {
  CODE_ALPHABET, FRIEND_CODE_LEN, fromB64u, friendLink, isFid, isFriendChars, parseFriendCode, parseFriendLink,
  randomFid, randomFriendChars, randomToken, toB64u, formatFriendCode, RECOVERY_LEN, formatRecoveryCode, parseRecoveryCode, randomRecoveryChars,
} from './codes.ts';
import {
  NAME_ADJECTIVES, NAME_ANIMALS, PRESET_MESSAGES, REACTION_IDS, isPresetMessage, isPresetName, isReaction,
  parsePresetName, presetName, randomPresetName,
} from './presets.ts';
import { BAND_STARTS, bandDistance, bandsFit, clampLevel, isLevelBand, levelBand, searchWindow } from './levels.ts';
import {
  POLICY, canSendFriendRequest, isAgeBand, isMinor, lobbyGroupOf, lowerBand, policyFor, roomChatMode, roomVideoAllowed,
  sameLobbyGroup,
} from './age.ts';
import { nameAfterBandChange, resolveName } from './names.ts';
import { seeded } from './test-utils.ts';
import { AGE_BANDS, type AgeBand } from './types.ts';

describe('friend codes', () => {
  it('uses 32 look-alike-free characters, so one random byte maps without bias', () => {
    expect(CODE_ALPHABET).toHaveLength(32);
    for (const bad of ['0', 'O', '1', 'I']) expect(CODE_ALPHABET).not.toContain(bad);
  });

  it('makes six-character codes that only use the alphabet, and spreads them', () => {
    const rb = seeded(7);
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const c = randomFriendChars(rb);
      expect(c).toHaveLength(FRIEND_CODE_LEN);
      expect(isFriendChars(c)).toBe(true);
      seen.add(c);
    }
    expect(seen.size).toBeGreaterThan(1990);
  });

  it('gives every alphabet character about the same share (no modulo bias)', () => {
    const rb = seeded(99);
    const counts = new Map<string, number>();
    for (let i = 0; i < 6000; i++) for (const ch of randomFriendChars(rb)) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    const expected = (6000 * FRIEND_CODE_LEN) / 32;
    for (const ch of CODE_ALPHABET) expect(Math.abs((counts.get(ch) ?? 0) - expected) / expected).toBeLessThan(0.1);
  });

  it('parses what people type or paste', () => {
    const want = '7K2Q4X';
    for (const text of ['BA-7K2Q4X', 'ba-7k2q4x', ' BA 7K2Q4X ', '7K2Q4X', '7k2q-4x', 'BA_7K2Q4X', 'ＢＡ－７Ｋ２Ｑ４Ｘ', 'BA-7K2Q4X​', 'BA.7K2.Q4X']) {
      expect(parseFriendCode(text), text).toBe(want);
    }
  });

  it('rejects anything that is not a code', () => {
    for (const bad of ['', 'BA-7K2Q4', 'BA-7K2Q4XX', 'BA-7K2Q40', 'BA-7K2QI4', 'BA-7K2QO4', 'XX-7K2Q4X', 'BA-7K2Q4X-1', 'x'.repeat(100)]) {
      expect(parseFriendCode(bad), bad).toBeNull();
    }
    for (const nope of [null, undefined, 42, {}, []]) expect(parseFriendCode(nope)).toBeNull();
  });

  it('writes and reads links, and ignores everything else', () => {
    const link = friendLink('https://bodyarcade.com/', '7K2Q4X');
    expect(link).toBe('https://bodyarcade.com/f/BA-7K2Q4X');
    expect(formatFriendCode('7K2Q4X')).toBe('BA-7K2Q4X');
    expect(parseFriendLink(link)).toBe('7K2Q4X');
    expect(parseFriendLink('http://localhost:8787/f/ba-7k2q4x/')).toBe('7K2Q4X');
    expect(parseFriendLink('BA-7K2Q4X')).toBe('7K2Q4X');
    for (const bad of ['https://bodyarcade.com/r/K7P2QX', 'https://bodyarcade.com/f/', 'javascript:alert(1)', 'https://x.com/f/BA-7K2Q4X/extra', 'a/b', 'https://x.com/f/BA-7K2Q4?x=1']) {
      expect(parseFriendLink(bad), bad).toBeNull();
    }
  });

  it('makes friend ids of ten alphabet characters', () => {
    const f = randomFid(seeded(3));
    expect(isFid(f)).toBe(true);
    expect(isFid('abc')).toBe(false);
    expect(isFid('0000000000')).toBe(false);
  });
});

describe('base64url', () => {
  it('round-trips every length and refuses non-canonical text', () => {
    const rb = seeded(5);
    for (let n = 0; n < 70; n++) {
      const bytes = rb(n);
      const text = toB64u(bytes);
      expect(text).not.toMatch(/[+/=]/);
      expect(Array.from(fromB64u(text) ?? [])).toEqual(Array.from(bytes));
    }
    expect(fromB64u('a')).toBeNull();
    expect(fromB64u('ab+/')).toBeNull();
    expect(fromB64u('ab==')).toBeNull();
    // non-zero leftover bits are not canonical: 'AB' would have to be 'AA' to decode the same single byte
    expect(fromB64u('AB')).toBeNull();
    expect(randomToken(16, seeded(1))).toHaveLength(22);
  });
});

describe('presets and names', () => {
  it('uses the very same message and reaction ids as the Room protocol', () => {
    expect(PRESET_MESSAGES).toBe(PRESETS);
    expect(REACTION_IDS).toBe(REACTIONS);
    expect(isPresetMessage('gg')).toBe(true);
    expect(isPresetMessage('call me')).toBe(false);
    expect(isReaction('fire')).toBe(true);
    expect(isReaction('😀')).toBe(false);
  });

  it('makes preset names that read back exactly, and nothing else reads as one', () => {
    const rb = seeded(11);
    for (let i = 0; i < 500; i++) {
      const n = randomPresetName(rb);
      expect(isPresetName(n), n).toBe(true);
      const parts = parsePresetName(n);
      expect(parts && presetName(parts)).toBe(n);
      expect(n.length).toBeLessThanOrEqual(20);
    }
    for (const bad of ['Swift Falcon', 'swift falcon 42', 'Swift Falcon 4', 'Swift Falcon 100', 'Swift Falcon 42 ', 'Swift Dragon 42', 'Call Me 12', '']) {
      expect(isPresetName(bad), bad).toBe(false);
    }
    expect(NAME_ADJECTIVES).toHaveLength(32);
    expect(NAME_ANIMALS).toHaveLength(32);
  });

  it('gives under-18 players preset names only, and adults a filtered free name', () => {
    for (const band of ['child', 'teen'] as const) {
      expect(resolveName(band, 'Mehmet').ok).toBe(false);
      expect(resolveName(band, 'Mehmet')).toEqual({ ok: false, reason: 'preset_only' });
      const generated = resolveName(band, undefined, seeded(2));
      expect(generated.ok && isPresetName(generated.name)).toBe(true);
      expect(resolveName(band, 'Swift Falcon 42')).toEqual({ ok: true, name: 'Swift Falcon 42' });
    }
    expect(resolveName('adult', 'Ayşe K.')).toEqual({ ok: true, name: 'Ayşe K.' });
    expect(resolveName('adult', '   ').ok).toBe(true);
    expect(resolveName('adult', 12)).toEqual({ ok: false, reason: 'bad_type' });
    expect(resolveName('adult', 'call 555 123 4567')).toMatchObject({ ok: false });
    expect(resolveName('adult', 'x'.repeat(21))).toEqual({ ok: false, reason: 'too_long' });
    expect(resolveName('adult', 'www.evil.com')).toMatchObject({ ok: false });
    expect(resolveName('adult', 'fuck')).toEqual({ ok: false, reason: 'profanity' });
    expect(resolveName('adult', '<b>x</b>')).toMatchObject({ ok: false });
  });

  it('replaces a free name when a player steps down to an under-18 band', () => {
    expect(nameAfterBandChange('teen', 'Ayşe', seeded(4))).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+ \d\d$/);
    expect(nameAfterBandChange('teen', 'Swift Falcon 42')).toBe('Swift Falcon 42');
    expect(nameAfterBandChange('adult', 'Ayşe')).toBe('Ayşe');
  });
});

describe('levels', () => {
  it('maps levels to bands and clamps nonsense', () => {
    expect(levelBand(1)).toBe('easy');
    expect(levelBand(BAND_STARTS.medium - 1)).toBe('easy');
    expect(levelBand(BAND_STARTS.medium)).toBe('medium');
    expect(levelBand(BAND_STARTS.hard - 1)).toBe('medium');
    expect(levelBand(BAND_STARTS.hard)).toBe('hard');
    for (const weird of [NaN, -5, 'x', null, undefined, Infinity]) expect(clampLevel(weird)).toBeGreaterThanOrEqual(1);
    expect(clampLevel(1e9)).toBe(99);
    expect(isLevelBand('easy')).toBe(true);
    expect(isLevelBand('expert')).toBe(false);
  });

  it('widens the search window with waiting time: same band, then neighbours, then everybody', () => {
    expect(searchWindow(0)).toBe(0);
    expect(searchWindow(7_999)).toBe(0);
    expect(searchWindow(8_000)).toBe(1);
    expect(searchWindow(15_999)).toBe(1);
    expect(searchWindow(16_000)).toBe(2);
    expect(searchWindow(NaN)).toBe(0);
    expect(bandDistance('easy', 'hard')).toBe(2);
    expect(bandsFit('easy', 'medium', 0)).toBe(false);
    expect(bandsFit('easy', 'medium', 9_000)).toBe(true);
    expect(bandsFit('easy', 'hard', 9_000)).toBe(false);
    expect(bandsFit('easy', 'hard', 17_000)).toBe(true);
    expect(bandsFit('hard', null, 0)).toBe(true);
  });
});

describe('age policy', () => {
  it('writes down the three bands', () => {
    expect(AGE_BANDS).toEqual(['child', 'teen', 'adult']);
    for (const b of AGE_BANDS) expect(isAgeBand(b)).toBe(true);
    expect(isAgeBand('senior')).toBe(false);
    expect(isMinor('child') && isMinor('teen') && !isMinor('adult')).toBe(true);
  });

  it('gives under-18 players preset names, no free text, no video', () => {
    for (const b of ['child', 'teen'] as const) {
      const p = policyFor(b);
      expect(p.presetNameOnly).toBe(true);
      expect(p.freeText).toBe(false);
      expect(p.video).toBe(false);
    }
    expect(policyFor('adult')).toMatchObject({ presetNameOnly: false, freeText: true, video: true });
  });

  it('keeps children out of public lobbies and keeps teens and adults apart', () => {
    expect(policyFor('child').publicPlay).toBe(false);
    expect(lobbyGroupOf('child')).toBeNull();
    expect(lobbyGroupOf('teen')).toBe('teen');
    expect(lobbyGroupOf('adult')).toBe('adult');
    expect(sameLobbyGroup('teen', 'teen')).toBe(true);
    expect(sameLobbyGroup('teen', 'adult')).toBe(false);
    expect(sameLobbyGroup('child', 'child')).toBe(false);
  });

  it('lets free text and video exist only in a private room of adults', () => {
    const cases: [readonly AgeBand[], 'private' | 'public', 'text' | 'preset'][] = [
      [['adult', 'adult'], 'private', 'text'],
      [['adult', 'adult'], 'public', 'preset'],
      [['adult', 'teen'], 'private', 'preset'],
      [['child'], 'private', 'preset'],
      [[], 'private', 'preset'],
    ];
    for (const [bands, kind, mode] of cases) {
      expect(roomChatMode(bands, kind)).toBe(mode);
      expect(roomVideoAllowed(bands, kind)).toBe(mode === 'text');
    }
  });

  it('stops an adult from sending a request to an under-18 player, but not the other way', () => {
    for (const to of ['child', 'teen'] as const) {
      expect(canSendFriendRequest('adult', to)).toBe(false);
      expect(canSendFriendRequest(to, 'adult')).toBe(true);
    }
    expect(canSendFriendRequest('adult', 'adult')).toBe(true);
    expect(canSendFriendRequest('child', 'teen')).toBe(true);
  });

  it('only lets a band go down', () => {
    expect(lowerBand('adult', 'teen')).toBe('teen');
    expect(lowerBand('adult', 'child')).toBe('child');
    expect(lowerBand('teen', 'child')).toBe('child');
    expect(lowerBand('teen', 'teen')).toBe('teen');
    expect(lowerBand('child', 'teen')).toBeNull();
    expect(lowerBand('teen', 'adult')).toBeNull();
  });

  it('gets stricter with age going down', () => {
    expect(POLICY.child.maxFriends).toBeLessThan(POLICY.teen.maxFriends);
    expect(POLICY.teen.maxFriends).toBeLessThan(POLICY.adult.maxFriends);
    expect(POLICY.child.requestsPerDay).toBeLessThan(POLICY.adult.requestsPerDay);
  });
});

describe('recovery codes', () => {
  it('are sixteen characters of the alphabet, written in four groups, and read back from any way of typing them', () => {
    const rb = seeded(5);
    for (let i = 0; i < 200; i++) {
      const chars = randomRecoveryChars(rb);
      expect(chars).toHaveLength(RECOVERY_LEN);
      const shown = formatRecoveryCode(chars);
      expect(shown).toMatch(/^[2-9A-HJ-NP-Z]{4}(-[2-9A-HJ-NP-Z]{4}){3}$/);
      expect(parseRecoveryCode(shown)).toBe(chars);
      expect(parseRecoveryCode(shown.toLowerCase())).toBe(chars);
      expect(parseRecoveryCode(shown.replace(/-/g, ' '))).toBe(chars);
      expect(parseRecoveryCode(` ${shown} `)).toBe(chars);
      expect(parseRecoveryCode(chars)).toBe(chars);
    }
  });

  it('spreads like the friend code does: every character about equally often, no repeats in a thousand', () => {
    const rb = seeded(77);
    const seen = new Set<string>();
    const counts = new Map<string, number>();
    for (let i = 0; i < 1000; i++) {
      const c = randomRecoveryChars(rb);
      seen.add(c);
      for (const ch of c) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }
    expect(seen.size).toBe(1000);
    for (const n of counts.values()) expect(Math.abs(n - 500)).toBeLessThan(120);
  });

  it('refuses what is not one: wrong length, the characters the alphabet leaves out, text of any other kind', () => {
    const good = randomRecoveryChars(seeded(1));
    for (const bad of [good.slice(1), good + 'A', good.replace(/^./, '0'), good.replace(/^./, 'O'), good.replace(/^./, 'I'), good.replace(/^./, '1'), '', 'x'.repeat(100), 'BA-7K2Q4X', 5, null, undefined, {}]) {
      expect(parseRecoveryCode(bad), String(bad)).toBeNull();
    }
    expect(parseFriendCode(formatRecoveryCode(good))).toBeNull();     // a recovery code is not a friend code and the other way round
  });
});
