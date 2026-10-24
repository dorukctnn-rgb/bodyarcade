// The public surface keeps its names: the shell and the games import these, and the store satisfies the contract's Store.
import { describe, expect, it } from 'vitest';
import type { Store } from '../types/index.ts';
import * as kit from './index.ts';

describe('store public surface', () => {
  it('exports what games and the shell use', () => {
    for (const name of [
      'createStore', 'memoryStorage', 'browserStorage', 'createProgress', 'importLegacyRunner', 'readLegacyV1', 'challengeLink', 'readChallenge',
      'dayOf', 'addDays', 'prevDay', 'daysBetween', 'daySeed', 'dayFromSeed', 'p', 'schemaOf', 'newlyUnlocked', 'dailyGoalFor',
      'RUNNER_ACHIEVEMENTS', 'RUNNER_DAILY', 'V1_KEYS', 'MAX_RUNS', 'bestKey', 'sanitizeRun',
      'createArcade', 'createHabit', 'createChallengeBook', 'createPlanBook', 'createDocSync', 'dailyChallengeFor', 'resolvePlan',
      'WORKOUT_PLANS', 'FREE_PLAN_ID', 'planFeature', 'HABIT', 'CHALLENGE', 'weekStart', 'mergeDays', 'withDay', 'GAME_NAMESPACE',
      'createProfileBook', 'createParentGate', 'GATE', 'MAX_PROFILES', 'PROFILES_FEATURE', 'OWNER_ID', 'DEVICE_NAMESPACES', 'AVATARS', 'NAME_MAX',
      'rulesFor', 'defaultsFor', 'normalizeName', 'watchOnline',
    ]) {
      expect((kit as Record<string, unknown>)[name], name).toBeDefined();
    }
  });

  it('a store is a contract Store, and one store carries a whole game: progress, import, a challenge', () => {
    const storage = kit.memoryStorage();
    const store: Store = kit.createStore({ storage, now: () => Date.UTC(2026, 9, 24, 12), timeZone: 'UTC' });
    expect(store.day()).toBe('2026-10-24');
    const bodyStore = store as kit.BodyArcadeStore;
    const progress = kit.createProgress(bodyStore, bodyStore.ns('runner'), { achievements: kit.RUNNER_ACHIEVEMENTS, daily: kit.RUNNER_DAILY });
    const out = progress.record({ score: 1200, seconds: 45, complete: true, variant: 'alps', difficulty: 'medium', stats: { cleared: 9, hits: 0 } });
    expect(out.news.map((a) => a.id)).toContain('first-run');
    expect(kit.importLegacyRunner(bodyStore, storage, bodyStore.ns('runner')).status).toBe('nothing');
    const link = kit.challengeLink('https://bodyarcade.com/bodyarcade', { name: 'Test', score: out.run.score, world: 'alps' }) as string;
    expect(kit.readChallenge(link.slice(link.indexOf('?')))?.score).toBe(1200);
  });
});
