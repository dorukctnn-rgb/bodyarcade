// The live runner's content as data: its fifteen achievements (site/game/store.js:112-128, rules at 184-208) and its
// daily goal (store.js:135-148). A game folder can import this unchanged or copy it into its own content/ directory;
// the legacy import and the differential tests against the live code use it, so a returning player keeps every
// unlocked id and sees the same goal on the same date.
import type { AchievementDef } from './achievements.ts';
import type { DailyGoalSpec } from './daily.ts';

/** Runner stats the v1 summary carried: cleared, hits, bestCombo, coins, kcal, dist (score and seconds are standard). */
export const RUNNER_ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: 'first-run', name: 'First steps', desc: 'Finish your first run', when: { total: 'runs', gte: 1 } },
  { id: 'clean-run', name: 'Clean run', desc: 'Finish a 90-second run without a hit', when: { all: [{ complete: true }, { run: 'hits', eq: 0 }] } },
  { id: 'combo-10', name: 'Ten in a row', desc: 'Clear 10 obstacles without a miss', when: { run: 'bestCombo', gte: 10 } },
  { id: 'combo-25', name: 'Untouchable', desc: 'Clear 25 obstacles without a miss', when: { run: 'bestCombo', gte: 25 } },
  { id: 'runs-10', name: 'Regular', desc: 'Finish 10 runs', when: { total: 'runs', gte: 10 } },
  { id: 'runs-50', name: 'Dedicated', desc: 'Finish 50 runs', when: { total: 'runs', gte: 50 } },
  { id: 'kcal-100', name: 'Hundred', desc: 'Burn 100 calories in total (estimate)', when: { total: 'kcal', gte: 100 } },
  { id: 'kcal-1000', name: 'Thousand', desc: 'Burn 1,000 calories in total (estimate)', when: { total: 'kcal', gte: 1000 } },
  { id: 'coins-50', name: 'Collector', desc: 'Pick up 50 coins in one run', when: { run: 'coins', gte: 50 } },
  { id: 'daily-3', name: 'Three days', desc: 'Hit the daily goal 3 days running', when: { streak: { gte: 3 } } },
  { id: 'daily-7', name: 'One week', desc: 'Hit the daily goal 7 days running', when: { streak: { gte: 7 } } },
  { id: 'all-free', name: 'Grand tour', desc: 'Run Alps, Desert and Forest', when: { variants: { includes: ['alps', 'desert', 'forest'] } } },
  { id: 'all-worlds', name: 'World tour', desc: 'Run all ten worlds', when: { variants: { gte: 10 } } },
  { id: 'hard-finish', name: 'Hard finish', desc: 'Finish a run on Hard or Insane', when: { all: [{ complete: true }, { difficulty: ['hard', 'insane'] }] } },
  { id: 'beat-friend', name: 'Rival', desc: 'Beat a friend’s challenge score', when: { beatFriend: true } },
];

/** The draw order of v1: score target, cleared target, coins target, then the kind, then the world. */
export const RUNNER_DAILY: DailyGoalSpec = {
  variants: ['alps', 'desert', 'forest'],
  kinds: [
    { kind: 'score', stat: 'score', base: 1500, step: 250, count: 5, text: 'Score {target} in one run' },
    { kind: 'cleared', stat: 'cleared', base: 12, step: 2, count: 6, text: 'Clear {target} obstacles in one run' },
    { kind: 'coins', stat: 'coins', base: 20, step: 5, count: 4, text: 'Collect {target} coins in one run' },
  ],
};
