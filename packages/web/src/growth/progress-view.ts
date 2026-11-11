// The progress page (kol F, in the spirit of a lifting log): the week streak, this week against its goal, minutes per week,
// personal records of moves and games, the history of workouts and game rounds, and the tape measurements if the person
// keeps them. Clean and fast: tiles, bars and lists, no chart library, no animation.
import { activeDays, gameRecords, historyOf, moveRecords, totalMinutes, weekOf, weeklyMinutes, weekStreak, WEEK_GOAL_DAYS, WEEK_GOAL_MINUTES, type WeekGoal } from '../../../core/growth/today/history.ts';
import { pointsOf } from '../../../core/growth/today/quests.ts';
import { FORM_WORDS } from '../form/strings.ts';
import { chips, fromCm, fromKg, round1, type Ctx } from './ctx.ts';
import { foodToday } from './food-view.ts';
import { collectFacts, gameTitle, todayDay } from './play.ts';
import { loadMeasures } from './twin-tab.ts';
import { bars, fmt, tile, tw } from './today-ui.ts';
import { loadWeekGoal } from './today-view.ts';

export async function progressTab(c: Ctx, host: HTMLElement): Promise<() => void> {
  const { el, btn, W } = c;
  const t = tw(c);
  const day = todayDay();
  const facts = await collectFacts(c, day);
  const goal = await loadWeekGoal(c);
  const games = c.play?.games ?? [];
  const moveName = (id: keyof (typeof FORM_WORDS)['en']['moves']): string => FORM_WORDS[c.lang].moves[id]?.name ?? id;
  const short = (d: string): string => new Intl.DateTimeFormat(c.tag, { day: 'numeric', month: 'short' }).format(new Date(`${d}T12:00:00`));
  const tiny = (d: string): string => new Intl.DateTimeFormat(c.tag, { day: 'numeric', month: 'numeric' }).format(new Date(`${d}T12:00:00`));

  const grid = el('div', 'gc-today'); grid.dataset.progressPage = '';
  host.append(grid);

  // ---- tiles ----
  const week = weekOf(facts, goal, day);
  const streak = weekStreak(activeDays(facts), day, goal.days);
  const tiles = el('div', 'gc-tiles gc-span');
  tiles.append(
    tile(c, t('tileStreak'), t(streak === 1 ? 'weekOne' : 'weeksN', { n: streak }), 'streak'),
    tile(c, t('tileWeek'), t('tileWeekValue', { n: week.activeDays, goal: goal.days }), 'week'),
    tile(c, t('tileMinutes'), fmt(c, Math.floor(week.seconds / 60)), 'minutes'),
    tile(c, t('tileTotal'), fmt(c, totalMinutes(facts)), 'total'),
    tile(c, t('tilePoints'), fmt(c, pointsOf(facts, { minor: c.minor() }).total), 'points'),
  );
  grid.append(tiles);

  // ---- the weekly goal ----
  const gc = el('section', 'gc-card'); gc.dataset.weekGoal = `${goal.days}/${goal.minutes}`;
  const save = async (patch: Partial<WeekGoal>): Promise<void> => { await c.vault.putJson('program', 'week-goal', { ...goal, ...patch }); c.refresh(); };
  gc.append(el('h2', '', t('goalTitle')),
    el('p', 'gc-q', t('goalDaysQ')), chips(c, WEEK_GOAL_DAYS.map((d) => [String(d), String(d)] as [string, string]), [String(goal.days)], false, (v) => { void save({ days: Number(v[0]) }); }, 'goal-days'),
    el('p', 'gc-q', t('goalMinutesQ')), chips(c, WEEK_GOAL_MINUTES.map((m) => [String(m), String(m)] as [string, string]), [String(goal.minutes)], false, (v) => { void save({ minutes: Number(v[0]) }); }, 'goal-minutes'),
    el('p', 'gc-note', t('goalNote')));
  grid.append(gc);

  // ---- minutes per week, this week day by day ----
  const ch = el('section', 'gc-card'); ch.dataset.chart = 'weeks';
  const wm = weeklyMinutes(facts, 8);
  ch.append(el('h2', '', t('chartWeeks')), bars(c, wm.map((w, i) => ({ value: w.minutes, label: tiny(w.start), title: t('chartAlt', { min: w.minutes, date: short(w.start) }), active: w.minutes >= goal.minutes, now: i === wm.length - 1 })), goal.minutes));
  ch.append(el('h3', '', t('chartDays')));
  const dn = (d: string): string => new Intl.DateTimeFormat(c.tag, { weekday: 'narrow' }).format(new Date(`${d}T12:00:00`));
  ch.append(bars(c, week.days.map((d) => ({ value: Math.round(d.seconds / 60), label: dn(d.day), title: `${short(d.day)}: ${t('minutesN', { n: Math.round(d.seconds / 60) })}`, active: d.active, now: d.day === day }))));
  grid.append(ch);

  // ---- personal records ----
  const rc = el('section', 'gc-card'); rc.dataset.records = '';
  rc.append(el('h2', '', t('recordsTitle')));
  const mr = moveRecords(facts.sets), gr = gameRecords(facts);
  if (!mr.length && !gr.length) rc.append(el('p', 'gc-muted', t('noRecords')));
  if (mr.length) {
    rc.append(el('h3', '', t('recMoves')));
    const ul = el('ul', 'gc-compact');
    for (const r of mr.slice(0, 12)) {
      const li = el('li'); li.dataset.record = r.move;
      const best = t(r.unit === 'seconds' ? 'secondsN' : 'repsN', { n: r.best });
      li.append(el('span', '', moveName(r.move)), el('span', '', r.load ? `${best} · ${t('recLoad', { kg: r.load.kg, v: r.load.value })}` : best));
      ul.append(li);
    }
    rc.append(ul);
  }
  if (gr.length) {
    rc.append(el('h3', '', t('recGames')));
    const ul = el('ul', 'gc-compact');
    for (const g of gr) {
      const li = el('li'); li.dataset.gameRecord = g.game; li.dataset.best = String(g.best);
      li.append(el('span', '', gameTitle(games.find((x) => x.id === g.game), c.lang, g.game)), el('span', '', `${t('recScore', { v: fmt(c, g.best) })}${g.runs ? ` · ${t(g.runs === 1 ? 'roundOne' : 'recRuns', { n: g.runs })}` : ''}`));
      ul.append(li);
    }
    rc.append(ul);
  }
  grid.append(rc);

  // ---- history ----
  const hc = el('section', 'gc-card'); hc.dataset.history = '';
  hc.append(el('h2', '', t('historyTitle')));
  const hist = historyOf(facts, 30);
  if (!hist.length) hc.append(el('p', 'gc-muted', t('noHistory')));
  else {
    const ul = el('ul', 'gc-hist');
    for (const h of hist) {
      const li = el('li'); li.dataset.kind = h.kind;
      const min = Math.max(1, Math.round(h.seconds / 60));
      const text = h.kind === 'workout' ? t(h.sets === 1 ? 'histWorkoutOne' : 'histWorkout', { sets: h.sets, min }) : t('histGame', { game: gameTitle(games.find((g) => g.id === h.game), c.lang, h.game), score: fmt(c, h.score), min });
      li.append(el('span', '', short(h.day)), el('span', '', text));
      ul.append(li);
    }
    hc.append(ul);
  }
  grid.append(hc);

  // ---- measurements (optional) ----
  const mc = el('section', 'gc-card'); mc.dataset.measures = '';
  mc.append(el('h2', '', t('measuresTitle')));
  const ms = await loadMeasures(c);
  const food = await foodToday(c);
  // the weight trend stays off with the eating-concern answer and under 18 (SPEC 4.2), like the food tab's chart
  const weightOk = !c.minor() && !(food.state === 'ready' && food.concern);
  if (!ms.length) mc.append(el('p', 'gc-muted', t('measuresNone')));
  else if (c.settings.hideNumbers) mc.append(el('p', 'gc-muted', t('measuresHidden')));
  else {
    const first = ms[0]!, last = ms.at(-1)!;
    const units = c.settings.units;
    const ul = el('ul', 'gc-compact');
    const line = (key: string, label: string, a: number | null | undefined, b: number | null | undefined, conv: (v: number) => number, unit: string): void => {
      if (b === null || b === undefined) return;
      const li = el('li'); li.dataset.measure = key;
      const now = `${round1(conv(b)).toLocaleString(c.tag)} ${unit}`;
      const diff = a !== null && a !== undefined && ms.length > 1 ? round1(conv(b) - conv(a)) : null;
      li.append(el('span', '', label), el('span', '', diff === null ? now : `${now} · ${t('measureChange', { v: `${diff > 0 ? '+' : ''}${diff.toLocaleString(c.tag)}`, date: c.date(first.at) })}`));
      ul.append(li);
    };
    const cm = (v: number): number => fromCm(v, units), kg = (v: number): number => fromKg(v, units);
    const uL = units === 'imperial' ? W.unitIn : W.unitCm, uW = units === 'imperial' ? W.unitLb : W.unitKg;
    line('waist', W.part_waist, first.tape.waist, last.tape.waist, cm, uL);
    line('hips', W.part_hips, first.tape.hips, last.tape.hips, cm, uL);
    line('chest', W.part_chest, first.tape.chest, last.tape.chest, cm, uL);
    if (weightOk) line('weight', W.weight, first.weightKg, last.weightKg, kg, uW);
    mc.append(ul, el('p', 'gc-note', c.t('measuredOn', { date: c.date(last.at) })));
  }
  mc.append(btn(t('measuresOpen'), 'gc-btn', () => c.go('twin')));
  grid.append(mc);

  return () => undefined;
}
