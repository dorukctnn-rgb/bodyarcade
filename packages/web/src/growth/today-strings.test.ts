// The Today panel's words (kol F): the five site languages with the same keys and the same {placeholders}, no empty text,
// Turkish complete, none of the banned food words of SPEC 4.2 in any language, and every tip, quest, badge and challenge
// code of the engine has its sentence.
import { describe, expect, it } from 'vitest';
import { BANNED_WORDS } from '../../../core/growth/nutrition/guards.ts';
import { badgesOf, questIds, type BadgeId, type ChallengeId, type QuestId } from '../../../core/growth/today/quests.ts';
import type { TipId } from '../../../core/growth/today/today.ts';
import { GROWTH_WORDS } from './strings.ts';
import { TODAY_WORDS, type TodayKey } from './today-strings.ts';

const LANGS = Object.keys(TODAY_WORDS) as (keyof typeof TODAY_WORDS)[];
const vars = (t: string): string[] => [...t.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();

describe('Today panel words', () => {
  it('has the five site languages, the same keys and placeholders, no empty text', () => {
    expect([...LANGS].sort()).toEqual(['de', 'en', 'es', 'fr', 'tr']);
    const keys = Object.keys(TODAY_WORDS.en).sort();
    for (const l of LANGS) {
      expect(Object.keys(TODAY_WORDS[l]).sort(), l).toEqual(keys);
      for (const k of keys as TodayKey[]) {
        expect(TODAY_WORDS[l][k].trim().length, `${l} ${k}`).toBeGreaterThan(0);
        expect(vars(TODAY_WORDS[l][k]), `${l} ${k}`).toEqual(vars(TODAY_WORDS.en[k]));
      }
    }
  });

  it('Turkish is complete: no sentence is left in English', () => {
    const same = (Object.keys(TODAY_WORDS.en) as TodayKey[]).filter((k) => TODAY_WORDS.en[k] === TODAY_WORDS.tr[k] && /[a-z]{4,} [a-z]{3,}/i.test(TODAY_WORDS.en[k]));
    expect(same).toEqual([]);
  });

  it('no banned word in any language (food words, results, guilt)', () => {
    const all = Object.values(BANNED_WORDS).flat().map((w) => w.toLowerCase());
    for (const l of LANGS) for (const [k, t] of Object.entries(TODAY_WORDS[l])) for (const w of all) if (t.toLowerCase().includes(w)) expect.fail(`${l}.${k} has "${w}"`);
  });

  it('no streak-loss pressure and no medical claim', () => {
    const bad = /lose your streak|serini kaybet|verlierst deine serie|pierdes tu racha|perds ta série|heal|iyileş|diagnos|teşhis/i;
    for (const l of LANGS) for (const [k, t] of Object.entries(TODAY_WORDS[l])) expect(bad.test(t), `${l}.${k}`).toBe(false);
  });

  it('every engine code has its sentence: quests, badges, challenges, tips', () => {
    const quests: QuestId[] = ['checkin', 'move10', 'move20', 'game', 'workout', 'new-best', 'easy5'];
    const challenges: ChallengeId[] = ['days', 'minutes', 'games', 'workouts', 'photo', 'measure'];
    const tips: TipId[] = ['checkin-first', 'pain', 'gentle', 'rest-day', 'start', 'record', 'form-first', 'harder', 'week-met', 'week-close', 'steady'];
    const badges = badgesOf({ today: '2026-11-11', sets: [], runs: [], gameSeconds: {}, checkins: [], photoDays: [], measureDays: [] }).map((b) => b.id) as BadgeId[];
    const en = TODAY_WORDS.en as Record<string, string>;
    for (const q of quests) expect(en[`quest_${q}`], q).toBeTruthy();
    for (const c of challenges) expect(en[`ch_${c}`], c).toBeTruthy();
    for (const t of tips) expect(en[`tip_${t}`], t).toBeTruthy();
    for (const b of badges) expect(en[`badge_${b}`], b).toBeTruthy();
    expect(questIds('2026-11-11', null).every((q) => quests.includes(q))).toBe(true);
  });

  it('the progress coach words the panel and the 360 steps use exist in every language', () => {
    for (const l of Object.keys(GROWTH_WORDS) as (keyof typeof GROWTH_WORDS)[]) {
      for (const k of ['adj_pain-fill', 'blk_safe', 'cueTurnTo', 'cueTurnEither', 'cueHold', 'cueCheck', 'holdSign', 'fullNote'] as const) expect(GROWTH_WORDS[l][k], `${l} ${k}`).toBeTruthy();
      if (l !== 'en') expect(GROWTH_WORDS[l]['adj_pain-fill']).not.toBe(GROWTH_WORDS.en['adj_pain-fill']);
      expect(vars(GROWTH_WORDS[l].cueTurnTo)).toEqual(['dir']);
    }
  });
});
