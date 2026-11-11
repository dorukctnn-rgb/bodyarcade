// The Today panel (kol F): the page a person opens every day. Today's goal, the 30-second check-in, today's plan from the
// program engine (warm-up, the workout with a BodyArcade game, the stretch), the coach's one short tip, today's food from
// the food plan, the week so far and today's quests. A tracking screen: plain, fast, no 3D (that belongs to the exercise).
import { getTodayPlan, type DailyCheckin } from '../../../core/growth/program/checkin.ts';
import { generateProgram, type ProgramInput, type Weekday } from '../../../core/growth/program/generate.ts';
import { MOVE_META } from '../../../core/growth/program/moves-meta.ts';
import type { MoveState } from '../../../core/growth/program/progress.ts';
import type { FormMoveId } from '../../../core/form/types.ts';
import { activeDays, DEFAULT_WEEK_GOAL, recordsOn, secondsByDay, weekOf, weekStreak, type WeekGoal } from '../../../core/growth/today/history.ts';
import { dailyQuests, gentle, pointsOf } from '../../../core/growth/today/quests.ts';
import { coachTip, gameRounds, goalMinutes, pickGame, planSplit, type Tip } from '../../../core/growth/today/today.ts';
import { addDays } from '../../../core/store/date.ts';
import { FORM_WORDS } from '../form/strings.ts';
import { checkinForm, checkinSummary, defaultCheckin } from './checkin-form.ts';
import type { Ctx } from './ctx.ts';
import { foodToday } from './food-view.ts';
import { collectFacts, gameTitle, saveCheckin, todayDay } from './play.ts';
import { loadProgram, programWeek, startProgram } from './program-view.ts';
import type { GrowthKey } from './strings.ts';
import { bars, ring, tw } from './today-ui.ts';
import type { TodayKey } from './today-strings.ts';

export async function loadWeekGoal(c: Pick<Ctx, 'vault'>): Promise<WeekGoal> {
  return { ...DEFAULT_WEEK_GOAL, ...((await c.vault.getJson<WeekGoal>('program', 'week-goal')) ?? {}) };
}

/** The sample program of a person who has none yet: general fitness, beginner, no equipment, today a training day. */
export const sampleInput = (c: Pick<Ctx, 'minor'>, weekday: number): ProgramInput => ({ goal: 'general', level: 'beginner', equipment: [], dumbbellsKg: [], days: [weekday as Weekday], minutes: 20, avoid: { areas: [] }, gameBlock: true, minor: c.minor() });

export async function todayPanel(c: Ctx, host: HTMLElement): Promise<() => void> {
  const { el, btn, W } = c;
  const t = tw(c);
  const day = todayDay();
  const facts = await collectFacts(c, day);
  const { stored, states } = await loadProgram(c);
  const saved = await c.vault.getJson<{ date: string; a: DailyCheckin }>('program', 'checkin');
  const checkin = saved?.date === day ? saved.a : null;
  const goal = await loadWeekGoal(c);
  const sample = sampleInput(c, new Date().getDay());
  const program = stored?.program ?? generateProgram(sample);
  const plan = getTodayPlan({ program, date: day, checkin, ...(stored ? { states, week: programWeek(stored) } : {}) });
  const moveName = (id: FormMoveId): string => FORM_WORDS[c.lang].moves[id]?.name ?? id;
  const games = c.play?.games ?? [];
  const pro = c.access.can('growth:program-full');

  const grid = el('div', 'gc-today'); grid.dataset.todayPanel = '';
  host.append(grid);

  // ---- today's goal ----
  const goalMin = goalMinutes(checkin, stored?.input.minutes ?? null);
  const doneS = secondsByDay(facts).get(day)?.total ?? 0;
  const doneMin = Math.floor(doneS / 60);
  const hero = el('section', 'gc-card gc-span gc-hero'); hero.dataset.todayGoal = String(goalMin); hero.dataset.doneMinutes = String(doneMin);
  const streak = weekStreak(activeDays(facts), day, goal.days);
  const points = pointsOf(facts, { minor: c.minor() });
  const words = el('div');
  words.append(el('h2', '', t('todayTitle')), el('p', 'gc-date', new Intl.DateTimeFormat(c.tag, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())),
    el('p', 'gc-plan-line', t('goalLine', { min: goalMin })),
    el('p', 'gc-muted', doneS >= goalMin * 60 ? t('goalMet') : t('goalDone', { done: doneMin, min: goalMin })));
  const pills = el('div', 'gc-pills');
  const p1 = el('span', 'gc-pill', streak > 0 ? t('streakLine', { n: streak }) : t('streakNone')); p1.dataset.streak = String(streak);
  const p2 = el('span', 'gc-pill', t('pointsLine', { n: points.total })); p2.dataset.points = String(points.total);
  pills.append(p1, p2);
  words.append(pills);
  hero.append(ring(c, doneS / (goalMin * 60), String(doneMin), t('minShort'), t('goalDone', { done: doneMin, min: goalMin })), words);
  grid.append(hero);

  // ---- the check-in ----
  if (checkin) {
    const done = el('section', 'gc-card'); done.dataset.checkinDone = '';
    const change = btn(t('checkinChange'), 'gc-btn', () => { done.replaceWith(form(checkin)); });
    done.append(el('h2', '', t('checkinDone')), el('p', 'gc-muted', checkinSummary(c, checkin)), change);
    grid.append(done);
  } else grid.append(form(defaultCheckin(stored?.input.minutes ?? 20)));
  function form(a: DailyCheckin): HTMLElement {
    return checkinForm(c, a, async (ans) => { await saveCheckin(c, day, ans); c.refresh(); });
  }

  // ---- today's plan ----
  const pc = el('section', 'gc-card'); pc.dataset.todayPlan = String(plan.minutes); pc.dataset.intensity = plan.intensity;
  const game = pickGame(games, { day, focus: plan.focus, low: plan.intensity === 'low', painAreas: checkin?.body === 'pain' ? checkin.painAreas ?? [] : [], pro });
  // the game's rounds fill the minutes the program's plan leaves (the workout "with a game")
  const rounds = game && c.play ? gameRounds(game, plan.minutes, goalMin) : 0;
  const gameMin = game ? Math.max(1, Math.round((Math.max(1, rounds) * game.durationSec) / 60)) : 0;
  const base = planSplit(plan);
  const split = rounds ? { ...base, work: base.work + gameMin, total: base.total + gameMin } : base;
  pc.dataset.total = String(split.total);
  const parts = [split.warmup ? t('part_warmup', { n: split.warmup }) : '', split.work ? t(rounds ? 'part_workGame' : 'part_work', { n: split.work }) : '', split.stretch ? t('part_stretch', { n: split.stretch }) : ''].filter(Boolean);
  const line = el('p', 'gc-plan-line', `${t('planHead', { total: split.total })} ${parts.join(', ')}.`); line.dataset.planLine = '';
  pc.append(el('h2', '', t('planTitle')), line);
  if (!stored) pc.append(el('p', 'gc-note', t('samplePlan')));
  for (const a of plan.adjustments) { const x = el('p', 'gc-muted', W[`adj_${a}` as GrowthKey]); x.dataset.adj = a; pc.append(x); }
  for (const n of plan.notes) { const x = el('p', 'gc-note', W[`note_${n}` as GrowthKey]); x.dataset.note = n; pc.append(x); }
  for (const b of plan.blocks) {
    if (!b.items.length) continue;
    pc.append(el('h3', '', b.safe ? W.blk_safe : W[`blk_${b.kind}` as GrowthKey]));
    const ul = el('ul', 'gc-compact');
    for (const it of b.items) {
      const li = el('li'); li.dataset.move = it.move;
      const amount = b.kind === 'main' ? c.t(it.unit === 'seconds' ? 'setsSec' : 'sets', { sets: it.sets, target: it.target }) : b.kind === 'conditioning' ? `${b.workS ?? it.target} ${W.seconds}` : it.unit === 'seconds' ? `${it.target} ${W.seconds}` : `${it.target}`;
      li.append(el('span', '', moveName(it.move)), el('span', '', amount));
      ul.append(li);
    }
    pc.append(ul);
  }
  if (game && c.play) {
    const g = el('div', 'gc-game'); g.dataset.game = game.id; g.dataset.rounds = String(rounds);
    const a = el('a', 'gc-link', t('play')); a.href = c.play.href(game, c.lang);
    const name = gameTitle(game, c.lang, game.id);
    g.append(el('span', '', rounds > 1 ? t('gameRow', { game: name, n: rounds, min: gameMin }) : rounds === 1 ? t('gameRowOne', { game: name, min: gameMin }) : t('gameExtra', { game: name, min: gameMin })), a);
    pc.append(g);
  }
  const start = btn(stored ? t('startPlan') : t('startSample'), 'gc-btn gc-btn--primary', async () => {
    if (!stored) await startProgram(c, sample);
    c.go('program');
  });
  start.dataset.startToday = stored ? 'program' : 'sample';
  pc.append(start);
  grid.append(pc);

  // ---- the coach's tip ----
  const rec = ((): { move?: FormMoveId; game?: string; value: number } | null => {
    for (const d of [day, addDays(day, -1)]) {
      const r = recordsOn(facts, d);
      if (r.moves[0]) return { move: r.moves[0].move, value: r.moves[0].value };
      if (r.games[0]) return { game: r.games[0].game, value: r.games[0].score };
    }
    return null;
  })();
  const week = weekOf(facts, goal, day);
  const anything = facts.sets.length > 0 || facts.runs.length > 0 || Object.keys(facts.gameSeconds).length > 0;
  const tip = coachTip({ checkin, plan, week, anything, record: rec, states: Object.values(states) as MoveState[] });
  const tc = el('section', 'gc-card gc-tip'); tc.dataset.tip = tip.id;
  tc.append(el('p', 'gc-tip-k', t('tipTitle')), el('p', '', tipText(tip)));
  grid.append(tc);
  function tipText(x: Tip): string {
    const k = `tip_${x.id}` as TodayKey;
    if (x.id === 'record') {
      const what = x.move ? t('recMove', { move: moveName(x.move), value: t(MOVE_META[x.move].unit === 'seconds' ? 'secondsN' : 'repsN', { n: x.value ?? 0 }) }) : t('recGame', { game: gameTitle(games.find((g) => g.id === x.game), c.lang, x.game ?? ''), value: x.value ?? 0 });
      return t(k, { what });
    }
    return t(k, { move: x.move ? moveName(x.move) : '' });
  }

  // ---- food today ----
  const fc = el('section', 'gc-card'); fc.dataset.todayFood = '';
  fc.append(el('h2', '', t('foodTitle')));
  const food = await foodToday(c);
  fc.dataset.state = food.state;
  if (food.state === 'minor') fc.append(el('p', 'gc-muted', W.gate_minor));
  else if (food.state === 'setup') fc.append(el('p', 'gc-muted', W.foodSetup), btn(t('foodCta'), 'gc-btn', () => c.go('food')));
  else {
    for (const g of food.view.gates) { const p = el('p', 'gc-note', W[`gate_${g}` as GrowthKey]); p.dataset.gate = g; fc.append(p); }
    if (food.view.numbers && food.view.target && food.view.macros) {
      const tl = el('p', '', c.t('targetLine', { a: food.view.target.range[0].toLocaleString(c.tag), b: food.view.target.range[1].toLocaleString(c.tag) })); tl.dataset.kcal = String(food.view.target.kcal);
      fc.append(tl);
    }
    const ul = el('ul', 'gc-compact');
    for (const m of food.meals) { const li = el('li'); li.dataset.meal = m.meal.id; li.append(el('span', '', W[`slot_${m.slot}` as GrowthKey]), el('span', '', m.meal.name[c.lang])); ul.append(li); }
    fc.append(ul, el('p', 'gc-note', W.approxValues), btn(W.tabFood, 'gc-btn', () => c.go('food')));
  }
  grid.append(fc);

  // ---- the week ----
  const wc = el('section', 'gc-card'); wc.dataset.weekCard = String(week.activeDays);
  const dn = (d: string): string => new Intl.DateTimeFormat(c.tag, { weekday: 'narrow' }).format(new Date(`${d}T12:00:00`));
  wc.append(el('h2', '', W.week), bars(c, week.days.map((d) => ({ value: Math.round(d.seconds / 60), label: dn(d.day), title: `${new Intl.DateTimeFormat(c.tag, { weekday: 'long' }).format(new Date(`${d.day}T12:00:00`))}: ${t('minutesN', { n: Math.round(d.seconds / 60) })}`, active: d.active, now: d.day === day }))),
    el('p', '', t('weekDays', { n: week.activeDays, goal: goal.days })), el('p', 'gc-muted', t('weekMinutes', { n: Math.floor(week.seconds / 60), goal: goal.minutes })),
    btn(t('tabProgress'), 'gc-btn', () => c.go('progress')));
  grid.append(wc);

  // ---- today's quests ----
  const qc = el('section', 'gc-card'); qc.dataset.todayQuests = '';
  qc.append(el('h2', '', t('questsTitle')));
  if (gentle(checkin)) qc.append(el('p', 'gc-note', t('gentleNote')));
  qc.append(questList(c, dailyQuests(facts, day)), btn(t('allQuests'), 'gc-btn', () => c.go('quests')));
  grid.append(qc);

  return () => undefined;
}

/** The day's quests as a list (the Today panel and the quests page). */
export function questList(c: Ctx, quests: ReturnType<typeof dailyQuests>): HTMLElement {
  const t = tw(c);
  const ul = c.el('ul', 'gc-quests');
  for (const q of quests) {
    const li = c.el('li', 'gc-quest'); li.dataset.quest = q.id; li.dataset.done = String(q.done);
    const mark = c.el('span', 'gc-check', q.done ? '✓' : ''); mark.setAttribute('aria-hidden', 'true');
    const text = c.el('span', '', t(`quest_${q.id}` as TodayKey));
    const side = c.el('small', '', q.done ? t('questPoints', { n: q.points }) : q.goal > 1 ? `${q.value}/${q.goal}` : t('questPoints', { n: q.points }));
    li.append(mark, text, side);
    li.setAttribute('aria-label', `${text.textContent}: ${q.done ? '✓' : `${q.value}/${q.goal}`}`);
    ul.append(li);
  }
  return ul;
}
