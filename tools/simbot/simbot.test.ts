import { describe, expect, it } from 'vitest';
import type { RunSummary } from '../../packages/core/types/index.ts';
import { PROFILE_IDS, PROFILES } from './profiles.ts';
import { summaryProblems } from './run.ts';

const good = (o: Partial<RunSummary> = {}): RunSummary => ({ score: 120, seconds: 60, metSeconds: 240, log: [{ t: 100, kind: 'a', ok: true }, { t: 900, kind: 'b', ok: false }], ...o });

describe('summary checks', () => {
  it('accepts a sane summary', () => {
    expect(summaryProblems(good(), 60, 'solo')).toEqual([]);
  });

  it('finds numbers that are not numbers, negative scores and a round longer than the manifest says', () => {
    const p = summaryProblems(good({ score: Number.NaN, seconds: 400 }), 60, 'solo').join('\n');
    expect(p).toContain('summary.score is not a number');
    expect(p).toContain('the round lasted 400 s');
    expect(summaryProblems(good({ score: -5 }), 60, 'solo')).toEqual(['negative score -5']);
  });

  it('finds a log out of time order and a counter below zero', () => {
    const p = summaryProblems(good({ reps: -1, log: [{ t: 900, kind: 'a', ok: true }, { t: 100, kind: 'b', ok: true }] }), 60, 'solo').join('\n');
    expect(p).toContain('summary.reps is -1');
    expect(p).toContain('not in time order');
  });

  it('wants a result per player in a two-player round and not in a solo round', () => {
    expect(summaryProblems(good(), 60, 'local2')).toEqual(['local2 round without a result per player']);
    const two = good({ players: { 1: { score: 1, metSeconds: 1 }, 2: { score: 2, metSeconds: 1 } } });
    expect(summaryProblems(two, 60, 'local2')).toEqual([]);
    expect(summaryProblems(two, 60, 'solo')).toEqual(['solo round with a result for two players']);
  });
});

describe('profiles', () => {
  it('has the players it says it has', () => {
    expect(PROFILE_IDS).toEqual(['idle', 'chaos', 'mash', 'blackout', 'pauser']);
    for (const id of PROFILE_IDS) expect(PROFILES[id]?.id).toBe(id);
  });
});
