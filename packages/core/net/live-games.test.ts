// The Pro games a room checks are the Pro games of the manifests: this reads every manifest of packages/games, so a game that is
// made Pro (or free) there and not here fails the build instead of shipping open to everyone (or locked for no reason).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PRO_GAMES, isProGame } from './live-games.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const GAMES = path.resolve(here, '../../games');

interface Manifest { id: string; free: boolean; modes?: unknown[] }

function manifests(): Manifest[] {
  return readdirSync(GAMES, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(GAMES, d.name, 'manifest.json')))
    .map((d) => JSON.parse(readFileSync(path.join(GAMES, d.name, 'manifest.json'), 'utf8')) as Manifest);
}

describe('the games a room locks', () => {
  it('are exactly the games whose manifest says free: false', () => {
    const all = manifests();
    expect(all.length).toBeGreaterThanOrEqual(11);
    for (const m of all) expect(typeof m.free, `${m.id}: the manifest must say free: true or free: false`).toBe('boolean');
    const pro = all.filter((m) => m.free === false).map((m) => m.id).sort();
    expect([...PRO_GAMES].sort()).toEqual(pro);
  });

  it('say which games need a Pro host, and leave the free games and unknown ids open', () => {
    expect(isProGame('limbo-bend')).toBe(true);
    expect(isProGame('pad-work')).toBe(true);
    expect(isProGame('reaction-tag')).toBe(true);
    for (const m of manifests().filter((x) => x.free)) expect(isProGame(m.id), m.id).toBe(false);
    expect(isProGame('squat-flap')).toBe(false);
    expect(isProGame('knee-sprint')).toBe(false);
    expect(isProGame('jacks')).toBe(false);
    expect(isProGame('')).toBe(false);
    expect(isProGame('__proto__')).toBe(false);
    expect(isProGame('constructor')).toBe(false);
  });
});
