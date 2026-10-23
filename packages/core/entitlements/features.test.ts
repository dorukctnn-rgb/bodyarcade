import { describe, expect, it } from 'vitest';
import type { Entitlement } from '../types/index.ts';
import { DEFAULT_FREE_FEATURES, canUse, hasFamilyFeatures } from './features.ts';

const FREE: Entitlement = { plan: 'free', source: 'none' };
const PRO: Entitlement = { plan: 'pro', source: 'server' };
const FAMILY: Entitlement = { plan: 'family', source: 'server' };
const LIFETIME: Entitlement = { plan: 'lifetime', source: 'server' };
const FOUNDER: Entitlement = { plan: 'lifetime', founder: true, source: 'gumroad' };
const rules = { isFreeGame: (id: string) => id === 'road-run' };

describe('a free player', () => {
  it('may play the free games and nothing the manifests did not mark free', () => {
    expect(canUse('game:road-run', FREE, rules)).toBe(true);
    expect(canUse('game:squat-flap', FREE, rules)).toBe(false);
    expect(canUse('game:road-run', FREE)).toBe(false);                        // no catalogue given: nothing is free by guess
    expect(canUse('game:', FREE, rules)).toBe(false);
  });

  it('keeps the free worlds and the two easier difficulties, and not the rest', () => {
    for (const f of DEFAULT_FREE_FEATURES) expect(canUse(f, FREE), f).toBe(true);
    for (const f of ['world:volcano', 'difficulty:hard', 'difficulty:insane', 'history:full', 'live:ranked']) expect(canUse(f, FREE), f).toBe(false);
  });

  it('takes the free set from the caller when it has one', () => {
    expect(canUse('history:week', FREE, { free: new Set(['history:week']) })).toBe(true);
    expect(canUse('world:alps', FREE, { free: new Set(['history:week']) })).toBe(false);
    expect(canUse('history:week', FREE, { free: (f) => f.startsWith('history:') })).toBe(true);
  });

  it('has no family features', () => {
    expect(canUse('family', FREE)).toBe(false);
    expect(canUse('profiles:6', FREE)).toBe(false);
  });
});

describe('a paying player', () => {
  it('has every game, world and difficulty on every paid plan', () => {
    for (const e of [PRO, FAMILY, LIFETIME, FOUNDER]) {
      for (const f of ['game:squat-flap', 'game:anything-new', 'world:volcano', 'difficulty:insane', 'history:full', 'live:ranked']) expect(canUse(f, e, rules), `${e.plan} ${f}`).toBe(true);
    }
  });

  it('has the family features only with the Family plan or a founder purchase', () => {
    expect(canUse('family', FAMILY)).toBe(true);
    expect(canUse('profiles:6', FAMILY)).toBe(true);
    expect(canUse('family', FOUNDER)).toBe(true);
    expect(canUse('family', PRO)).toBe(false);
    expect(canUse('family', LIFETIME)).toBe(false);
    expect(hasFamilyFeatures(FOUNDER)).toBe(true);
    expect(hasFamilyFeatures(PRO)).toBe(false);
  });
});

describe('a feature name that is not one', () => {
  it('is refused for everybody, so a typo or an injected string never opens anything', () => {
    for (const f of ['', ' ', 'Game:x', 'game:', 'game: x', 'game:x y', 'game:../x', '__proto__', 'a'.repeat(100), 'game:' + 'a'.repeat(60), '<b>', 'game:x:y']) {
      expect(canUse(f, FOUNDER, rules), JSON.stringify(f)).toBe(false);
      expect(canUse(f, FREE, rules), JSON.stringify(f)).toBe(false);
    }
    // a well-formed name that nobody asked for is simply not free: it never reaches into prototypes
    expect(canUse('constructor', FREE)).toBe(false);
    expect(canUse('toString', FREE, rules)).toBe(false);
    expect(canUse(undefined as unknown as string, PRO)).toBe(false);
    expect(canUse(5 as unknown as string, PRO)).toBe(false);
  });
});
