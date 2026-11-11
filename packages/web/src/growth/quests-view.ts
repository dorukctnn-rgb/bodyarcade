// Quests, the weekly challenge, points and badges (kol F). All from the facts (core/growth/today/quests.ts): nothing is
// claimed by hand and nothing is lost by missing a day. The friend race joins the link duel (kol E) later; here it is a
// placeholder that says so.
import { badgesOf, dailyQuests, gentle, pointsOf, weeklyChallenge } from '../../../core/growth/today/quests.ts';
import type { DailyCheckin } from '../../../core/growth/program/checkin.ts';
import type { Ctx } from './ctx.ts';
import { collectFacts, todayDay } from './play.ts';
import { fmt, tile, tw } from './today-ui.ts';
import type { TodayKey } from './today-strings.ts';
import { loadWeekGoal, questList } from './today-view.ts';

export async function questsTab(c: Ctx, host: HTMLElement): Promise<() => void> {
  const { el, btn } = c;
  const t = tw(c);
  const day = todayDay();
  const facts = await collectFacts(c, day);
  const goal = await loadWeekGoal(c);
  const minor = c.minor();
  const grid = el('div', 'gc-today'); grid.dataset.questsPage = '';
  host.append(grid);

  // ---- points ----
  const p = pointsOf(facts, { minor });
  const tiles = el('div', 'gc-tiles gc-span');
  tiles.append(tile(c, t('pointsTotal'), fmt(c, p.total), 'points-total'), tile(c, t('pointsWeek'), fmt(c, p.week), 'points-week'), tile(c, t('pointsToday'), fmt(c, p.today), 'points-today'));
  grid.append(tiles);

  // ---- today ----
  const qc = el('section', 'gc-card'); qc.dataset.questsToday = '';
  const checkin: DailyCheckin | null = facts.checkins.find((x) => x.day === day)?.a ?? null;
  qc.append(el('h2', '', t('questsTitle')));
  if (gentle(checkin)) qc.append(el('p', 'gc-note', t('gentleNote')));
  qc.append(questList(c, dailyQuests(facts, day)), el('p', 'gc-note', t('pointsNote')));
  grid.append(qc);

  // ---- the week's challenge ----
  const ch = weeklyChallenge(facts, { minor }, day);
  const cc = el('section', 'gc-card'); cc.dataset.challenge = ch.id; cc.dataset.done = String(ch.done);
  const meter = el('div', 'gc-meter'); meter.setAttribute('role', 'progressbar'); meter.setAttribute('aria-valuemin', '0'); meter.setAttribute('aria-valuemax', String(ch.goal)); meter.setAttribute('aria-valuenow', String(Math.min(ch.value, ch.goal)));
  const fillBar = el('i'); fillBar.style.width = `${Math.round(Math.min(1, ch.value / ch.goal) * 100)}%`; meter.append(fillBar);
  cc.append(el('h2', '', t('challengeTitle')), el('p', 'gc-plan-line', t(`ch_${ch.id}` as TodayKey, { goal: ch.goal })), meter,
    el('p', 'gc-muted', ch.done ? t('challengeDone', { n: ch.points }) : `${Math.min(ch.value, ch.goal)}/${ch.goal}`));
  grid.append(cc);

  // ---- badges ----
  const bc = el('section', 'gc-card gc-span'); bc.dataset.badges = '';
  bc.append(el('h2', '', t('badgesTitle')));
  const box = el('div', 'gc-badges');
  const list = badgesOf(facts, { minor, weekGoalDays: goal.days });
  for (const b of list) {
    const d = el('div', 'gc-badge'); d.dataset.badge = b.id; d.dataset.earned = String(b.earned);
    const name = t(`badge_${b.id}` as TodayKey);
    const medal = el('span', 'gc-medal', b.earned ? '★' : String(list.indexOf(b) + 1)); medal.setAttribute('aria-hidden', 'true');
    d.append(medal, el('b', '', name), el('small', '', b.earned ? t('badgeOpen') : `${b.value}/${b.goal}`));
    d.setAttribute('aria-label', `${name}: ${b.earned ? t('badgeOpen') : `${b.value}/${b.goal}`}`);
    box.append(d);
  }
  bc.append(box);
  grid.append(bc);

  // ---- the friend race (kol E's link duel joins here) ----
  const fc = el('section', 'gc-card'); fc.dataset.friendRace = 'soon';
  const soon = btn(t('friendSoon'), 'gc-btn'); soon.disabled = true;
  fc.append(el('h2', '', t('friendTitle')), el('p', 'gc-muted', t('friendText')), soon);
  grid.append(fc);

  return () => undefined;
}
