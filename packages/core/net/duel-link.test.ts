// The shared rules of duel links: which games race and which play a score duel (read from every manifest, so a new game cannot ship
// without a line), and the token bucket that keeps a reported total within what the game can give.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { acceptScore, DEFAULT_SCORE_RATE, duelModeOf, MAX_DUEL_SCORE, newBucket, SCORE_RATES, scoreRateOf, secondsLeft } from './duel-link.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const GAMES = path.resolve(here, '../../games');

interface Manifest { id: string; modes: string[] }

const manifests = (): Manifest[] => readdirSync(GAMES, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(path.join(GAMES, d.name, 'manifest.json')))
  .map((d) => JSON.parse(readFileSync(path.join(GAMES, d.name, 'manifest.json'), 'utf8')) as Manifest);

describe('how each game is played in a duel', () => {
  it('a game with the duel mode is raced over its course; every other game is a score duel with its own rate', () => {
    const all = manifests();
    expect(all.length).toBeGreaterThanOrEqual(11);
    for (const m of all) {
      if (m.modes.includes('duel')) expect(duelModeOf(m.id), m.id).toBe('race');
      else {
        expect(duelModeOf(m.id), m.id).toBe('score');
        expect(Object.hasOwn(SCORE_RATES, m.id), `${m.id} needs a line in SCORE_RATES`).toBe(true);
      }
    }
    // no line for a game that is not there (a renamed game would keep a dead line)
    const ids = new Set(all.map((m) => m.id));
    for (const id of Object.keys(SCORE_RATES)) expect(ids.has(id), id).toBe(true);
  });

  it('an unknown id is a score duel at the default rate, and the names of Object do not count as games', () => {
    expect(duelModeOf('no-such-game')).toBe('score');
    expect(scoreRateOf('no-such-game')).toBe(DEFAULT_SCORE_RATE);
    expect(scoreRateOf('constructor')).toBe(DEFAULT_SCORE_RATE);
    expect(duelModeOf('__proto__')).toBe('score');
  });
});

describe('acceptScore', () => {
  const rate = { perSec: 100, burst: 300 };

  it('takes what fits in the reserve and the time played, and keeps the rest out', () => {
    let b = newBucket(rate);
    b = acceptScore(b, 250, 0, rate);
    expect(b.v).toBe(250);
    b = acceptScore(b, 10_000, 0, rate);
    expect(b.v).toBe(300);
    b = acceptScore(b, 10_000, 1000, rate);
    expect(b.v).toBe(400);
    b = acceptScore(b, 10_000, 60_000, rate);
    expect(b.v).toBe(700);                                 // a minute of nothing fills the reserve to its size, not to a minute's worth
  });

  it('a steady player under the rate keeps every point', () => {
    let b = newBucket(rate);
    for (let s = 1; s <= 90; s++) b = acceptScore(b, s * 90, s * 1000, rate);
    expect(b.v).toBe(8100);
  });

  it('believes a total that goes down, never goes below zero or above the bound, and a clock that goes back gives nothing', () => {
    let b = acceptScore(newBucket(rate), 200, 1000, rate);
    b = acceptScore(b, 150, 2000, rate);
    expect(b.v).toBe(150);
    expect(acceptScore(b, -5, 2000, rate).v).toBe(0);
    const big = acceptScore(newBucket({ perSec: 1e9, burst: 1e9 }), 1e12, 10_000, { perSec: 1e9, burst: 1e9 });
    expect(big.v).toBe(MAX_DUEL_SCORE);
    const back = acceptScore({ v: 100, tokens: 0, mt: 5000 }, 1000, 1000, rate);
    expect(back).toEqual({ v: 100, tokens: 0, mt: 5000 });
  });

  it('counts whole points only', () => {
    expect(acceptScore(newBucket(rate), 12.9, 0, rate).v).toBe(12);
  });
});

describe('secondsLeft', () => {
  it('rounds up and stops at zero', () => {
    expect(secondsLeft(10_500, 10_000)).toBe(1);
    expect(secondsLeft(70_000, 10_000)).toBe(60);
    expect(secondsLeft(9000, 10_000)).toBe(0);
  });
});
