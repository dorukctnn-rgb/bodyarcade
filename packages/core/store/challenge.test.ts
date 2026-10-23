// Friend challenge links: they round-trip, they read what the live site (site/game/store.js) wrote, the live site reads
// what they write, and a link from a stranger gives back only a short plain name, a whole score and short ids.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CHALLENGE_NAME_MAX, MAX_CHALLENGE_SCORE, challengeLink, readChallenge } from './challenge.ts';

const BASE = 'https://bodyarcade.com/bodyarcade';
const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '');
const read = (c: string) => readChallenge(`?c=${c}`);
const param = (link: string): string => decodeURIComponent(link.split('c=')[1] as string);
const payloadOf = (link: string): Record<string, unknown> => JSON.parse(Buffer.from(param(link), 'base64').toString('utf8')) as Record<string, unknown>;

interface V1 { challengeLink(c: { name: string; score: number; world: string; diff: string }): string; readChallenge(): { name: string; score: number; world: string; diff: string } | null }
let v1: V1;
beforeAll(async () => {
  const url = new URL('../../../site/game/store.js', import.meta.url).href;
  v1 = (await import(/* @vite-ignore */ url)) as unknown as V1;
});
afterEach(() => { delete (globalThis as { location?: unknown }).location; });
const setLocation = (search: string): void => { (globalThis as unknown as { location: unknown }).location = { search, origin: 'https://bodyarcade.com' }; };

describe('making a link', () => {
  it('round-trips name, score, world, difficulty and game', () => {
    const link = challengeLink(BASE, { name: 'Ayşe', score: 1234, world: 'alps', diff: 'hard', game: 'road-run' });
    expect(link).not.toBeNull();
    expect(readChallenge((link as string).slice((link as string).indexOf('?')))).toEqual({ name: 'Ayşe', score: 1234, world: 'alps', diff: 'hard', game: 'road-run' });
  });

  it('is the page address, then ?c=, with nothing a query string would misread', () => {
    const link = challengeLink(BASE, { name: 'Zoë ☺', score: 99, world: 'alps' }) as string;
    expect(link.startsWith(`${BASE}?c=`)).toBe(true);
    expect(link.slice(BASE.length + 3)).toMatch(/^[A-Za-z0-9%._~-]+$/);    // percent-encoded, no raw + / = & #
    expect(link.length).toBeLessThan(200);
  });

  it('joins an existing query with & and drops a fragment', () => {
    const link = challengeLink('https://bodyarcade.com/play?lang=tr#top', { score: 5 }) as string;
    expect(link.startsWith('https://bodyarcade.com/play?lang=tr&c=')).toBe(true);
    expect(link).not.toContain('#');
    expect(readChallenge(link.slice(link.indexOf('?')))?.score).toBe(5);
  });

  it('leaves out what is not there', () => {
    expect(payloadOf(challengeLink(BASE, { score: 7 }) as string)).toEqual({ s: 7 });
  });

  it('refuses a score that cannot be a challenge', () => {
    for (const score of [0, -3, Number.NaN, Number.POSITIVE_INFINITY, MAX_CHALLENGE_SCORE + 1, 0.4]) expect(challengeLink(BASE, { score }), String(score)).toBeNull();
    expect(challengeLink(BASE, { score: 'x' as unknown as number })).toBeNull();
    expect(readChallenge(`?c=${param(challengeLink(BASE, { score: 1.9 }) as string)}`)?.score).toBe(1);   // a whole number, rounded down
    expect(readChallenge((challengeLink(BASE, { score: MAX_CHALLENGE_SCORE }) as string).slice(BASE.length))?.score).toBe(MAX_CHALLENGE_SCORE);
  });

  it('writes only a clean name and valid ids', () => {
    const p = payloadOf(challengeLink(BASE, { name: ` ${'x'.repeat(30)} `, score: 3, world: '<b>', diff: 'ok-1', game: '' }) as string);
    expect(p['n']).toBe('x'.repeat(CHALLENGE_NAME_MAX));
    expect(p['w']).toBeUndefined();
    expect(p['d']).toBe('ok-1');
    expect(p['g']).toBeUndefined();
  });
});

describe('reading a link (moved from the 12 cases of tests/legacy/store.test.mjs)', () => {
  it('a challenge link round-trips', () => {
    const url = challengeLink(BASE, { name: 'Ayşe', score: 1234, world: 'alps', diff: 'medium' }) as string;
    expect(read(url.split('?c=')[1] as string)).toEqual({ name: 'Ayşe', score: 1234, world: 'alps', diff: 'medium', game: '' });
  });

  it('a challenge whose score is not a whole positive number is ignored', () => {
    expect(read(b64({ n: 'x', s: '<img src=x onerror=alert(1)>', w: 'alps', d: 'medium' }))).toBeNull();
    expect(read(b64({ n: 'x', s: 1.5 }))).toBeNull();
    expect(read(b64({ n: 'x', s: -5 }))).toBeNull();
    expect(read(b64({ n: 'x', s: 1e12 }))).toBeNull();
  });

  it('a broken challenge link is ignored without throwing', () => {
    expect(read('%E0%A4%A')).toBeNull();
    expect(read('not-base64!!')).toBeNull();
    expect(read(b64('just a string'))).toBeNull();
  });

  it('challenge names are cut to 20 characters and ids become strings', () => {
    expect(read(b64({ n: 'A'.repeat(40), s: '250', w: 7, d: null }))).toEqual({ name: 'A'.repeat(20), score: 250, world: '7', diff: '', game: '' });
  });
});

describe('a link from a stranger', () => {
  it('is ignored when it is missing, huge, not an object or not UTF-8', () => {
    expect(readChallenge('')).toBeNull();
    expect(readChallenge('?x=1')).toBeNull();
    expect(readChallenge('?c=')).toBeNull();
    expect(read('A'.repeat(601))).toBeNull();
    for (const v of [null, 5, true, [1, 2], [{ s: 5 }]]) expect(read(b64(v)), JSON.stringify(v)).toBeNull();
    expect(read(Buffer.from([0xff, 0xfe, 0x7b, 0x7d]).toString('base64'))).toBeNull();
    expect(readChallenge(undefined as unknown as string)).toBeNull();
    expect(readChallenge(42 as unknown as string)).toBeNull();
  });

  it('keeps the score to a whole number from 1 to ten million, as a number or a digit string', () => {
    expect(read(b64({ s: 10_000_000 }))?.score).toBe(10_000_000);
    expect(read(b64({ s: 10_000_001 }))).toBeNull();
    expect(read(b64({ s: 0 }))).toBeNull();
    expect(read(b64({ s: '0012' }))?.score).toBe(12);
    for (const s of ['1e3', ' 5', '5 ', '0x10', '-1', '1.0', 'Infinity', true, null, [], {}, '123456789']) expect(read(b64({ s })), JSON.stringify(s)).toBeNull();
  });

  it('keeps only a short plain name: control characters, runs of spaces, the cut inside an emoji', () => {
    expect(read(b64({ s: 5, n: '  A\u0000B\n\tC   D  ' }))?.name).toBe('A B C D');
    expect(read(b64({ s: 5, n: '😀'.repeat(30) }))?.name).toBe('😀'.repeat(20));
    expect(read(b64({ s: 5, n: '   ' }))?.name).toBe('');
    expect(read(b64({ s: 5, n: { x: 1 } }))?.name).toBe('');
    expect(read(b64({ s: 5, n: ['a'] }))?.name).toBe('');
    expect(read(b64({ s: 5 }))?.name).toBe('');
    expect(read(b64({ s: 5, n: 'Ayşe' }))?.name).toBe('Ayşe');
  });

  it('keeps only ids that look like ids', () => {
    const c = read(b64({ s: 5, w: '<script>alert(1)</script>', d: 'x'.repeat(41), g: '../etc' }));
    expect(c).toEqual({ name: '', score: 5, world: '', diff: '', game: '' });
    expect(read(b64({ s: 5, w: 'alps', d: 'hard', g: 'road-run' }))).toEqual({ name: '', score: 5, world: 'alps', diff: 'hard', game: 'road-run' });
  });

  it('cannot reach into prototypes and ignores unknown fields', () => {
    const c = read(Buffer.from('{"s":5,"__proto__":{"s":1,"polluted":true},"constructor":{"x":1},"extra":"yes"}').toString('base64'));
    expect(c).toEqual({ name: '', score: 5, world: '', diff: '', game: '' });
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('reads the standard and the URL-safe base64 alphabets, with and without padding, among other parameters', () => {
    const json = JSON.stringify({ n: 'Yağız Çelik', s: 77, w: 'alps' });
    const std = Buffer.from(json).toString('base64');
    const safe = std.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    for (const form of [std, std.replace(/=+$/, ''), safe]) {
      expect(readChallenge(`?lang=tr&c=${encodeURIComponent(form)}&x=1`)?.name, form).toBe('Yağız Çelik');
    }
    expect(readChallenge(`?c=${std.replace(/=+$/, '')}`)?.score).toBe(77);   // a bare + is kept, as the live site did
  });
});

describe('the live site and this module read each other', () => {
  it('reads a link the live site made, with its odd characters', () => {
    setLocation('');
    const v1Link = v1.challengeLink({ name: 'Ayşe ✓ Çelik', score: 4321, world: 'canyon', diff: 'insane' });
    expect(v1Link.startsWith('https://bodyarcade.com/bodyarcade?c=')).toBe(true);
    expect(readChallenge(v1Link.slice(v1Link.indexOf('?')))).toEqual({ name: 'Ayşe ✓ Çelik', score: 4321, world: 'canyon', diff: 'insane', game: '' });
  });

  it('the live site reads a link made here, with or without a game id', () => {
    for (const game of [undefined, 'road-run']) {
      const link = challengeLink('https://bodyarcade.com/bodyarcade', { name: 'Zoë', score: 900, world: 'neon', diff: 'easy', ...(game ? { game } : {}) }) as string;
      setLocation(link.slice(link.indexOf('?')));
      expect(v1.readChallenge(), String(game)).toEqual({ name: 'Zoë', score: 900, world: 'neon', diff: 'easy' });
    }
  });
});
