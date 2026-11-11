// The 30-second daily check-in (kol F): five questions, every answer a ready option (no typing): sleep, energy 1-5, how
// the body feels (and where, for a pain), minutes today, priority. The Today panel and the program tab both use it; the
// answers adapt today's plan by the engine's fixed rules (core/growth/program/checkin.ts).
import type { DailyCheckin } from '../../../core/growth/program/checkin.ts';
import { AREAS, type Area } from '../../../core/growth/program/moves-meta.ts';
import { chips, type Ctx } from './ctx.ts';
import { fill, type GrowthKey } from './strings.ts';
import { TODAY_WORDS } from './today-strings.ts';

/** Minutes a person can pick (the engine makes a mini plan under 10). */
export const CHECKIN_MINUTES: readonly number[] = [5, 10, 15, 20, 30, 45, 60];

export const nearestMinutes = (m: number): number => CHECKIN_MINUTES.reduce((a, b) => (Math.abs(b - m) < Math.abs(a - m) ? b : a));

export const defaultCheckin = (minutes: number): DailyCheckin => ({ sleep: 'good', energy: 3, body: 'fine', painAreas: [], minutes: nearestMinutes(minutes), priority: 'any' });

export function checkinForm(c: Ctx, initial: DailyCheckin, onDone: (a: DailyCheckin) => void | Promise<void>): HTMLElement {
  const { el, btn, W } = c;
  const ans: DailyCheckin = { ...initial, painAreas: [...(initial.painAreas ?? [])], minutes: nearestMinutes(initial.minutes) };
  const ci = el('section', 'gc-card gc-checkin'); ci.dataset.checkin = '';
  const q = (label: string, node: HTMLElement): void => { ci.append(el('p', 'gc-q', label), node); };
  ci.append(el('h2', '', W.checkinTitle));
  q(W.sleep, chips(c, [['good', W.sleep_good], ['ok', W.sleep_ok], ['poor', W.sleep_poor]] as const, [ans.sleep], false, (v) => { ans.sleep = v[0] as DailyCheckin['sleep']; }, 'sleep'));
  q(W.energy, chips(c, (['1', '2', '3', '4', '5'] as const).map((n) => [n, n] as [typeof n, string]), [String(ans.energy) as '3'], false, (v) => { ans.energy = Number(v[0]) as DailyCheckin['energy']; }, 'energy'));
  const painBox = el('div'); painBox.hidden = ans.body !== 'pain';
  q(W.bodyFeel, chips(c, [['fine', W.body_fine], ['tired', W.body_tired], ['pain', W.body_pain]] as const, [ans.body], false, (v) => { ans.body = v[0] as DailyCheckin['body']; painBox.hidden = ans.body !== 'pain'; }, 'body'));
  painBox.append(el('p', 'gc-q', W.painWhere), chips(c, AREAS.map((a) => [a, W[`area_${a}` as GrowthKey]] as [Area, string]), ans.painAreas ?? [], true, (v) => { ans.painAreas = v; }, 'pain'));
  ci.append(painBox);
  const mins = chips(c, CHECKIN_MINUTES.map((m) => [String(m), String(m)] as [string, string]), [String(ans.minutes)], false, (v) => { ans.minutes = Number(v[0]); }, 'minutes');
  mins.dataset.minutes = '';
  q(W.minutesToday, mins);
  q(W.priority, chips(c, [['any', W.prio_any], ['strength', W.prio_strength], ['cardio', W.prio_cardio], ['mobility', W.prio_mobility]] as const, [ans.priority], false, (v) => { ans.priority = v[0] as DailyCheckin['priority']; }, 'priority'));
  const go = btn(W.planToday, 'gc-btn gc-btn--primary', async () => {
    // a pain needs its place: that is what the plan leaves out
    if (ans.body === 'pain' && !ans.painAreas?.length) { c.toast(W.painWhere); painBox.querySelector<HTMLButtonElement>('button')?.focus(); return; }
    go.disabled = true;
    const out: DailyCheckin = { ...ans, painAreas: ans.body === 'pain' ? [...(ans.painAreas ?? [])] : [] };
    try { await onDone(out); } finally { go.disabled = false; }
  });
  go.dataset.planToday = '';
  const row = el('div', 'gc-row'); row.append(go);
  ci.append(row);
  return ci;
}

/** One line of the answers, for the panel once the check-in is done. */
export function checkinSummary(c: Ctx, a: DailyCheckin): string {
  const { W } = c;
  const body = a.body === 'pain' && a.painAreas?.length ? `${W.body_pain}: ${a.painAreas.map((x) => W[`area_${x}` as GrowthKey]).join(', ')}` : W[`body_${a.body}` as GrowthKey];
  return [`${W.sleep}: ${W[`sleep_${a.sleep}` as GrowthKey]}`, `${W.energy}: ${a.energy}`, body, fill(TODAY_WORDS[c.lang].minutesN, { n: a.minutes }), `${W.priority}: ${W[`prio_${a.priority}` as GrowthKey]}`].join(' · ');
}
