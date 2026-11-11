// The program tab: build a program from the form coach catalogue, the 30-second check-in, today's plan (getTodayPlan) with
// the reason for every change, and the session runner: the form coach counts each set (or the person types it on a
// camera-free day), a set ends with "how many more could you have done?", then the rest; the progression updates after.
import { createFormCoach, type FormCoach } from '../../../core/form/coach.ts';
import { browserServices } from '../../../core/loop/browser.ts';
import { POSE_MODEL, WASM_BASE } from '../../../core/pose/assets.ts';
import { parseTrace, traceSource } from '../../../core/pose/trace.ts';
import { getTodayPlan, type DailyCheckin, type TodayPlan } from '../../../core/growth/program/checkin.ts';
import { alternatives, generateProgram, spacingOk, swapInProgram, type Equip, type Goal, type Level, type Program, type ProgramInput, type Weekday } from '../../../core/growth/program/generate.ts';
import { AREAS, type Area } from '../../../core/growth/program/moves-meta.ts';
import { applyResult, startState, type MoveState } from '../../../core/growth/program/progress.ts';
import { correct, fromSummary, resultsOf, stepsOf, targetReached, type SetLog, type Step } from '../../../core/growth/program/session.ts';
import { newId } from '../../../core/growth/vault/vault.ts';
import type { FormMoveId } from '../../../core/form/types.ts';
import type { CameraLease, PoseFrame } from '../../../core/types/index.ts';
import { FORM_WORDS } from '../form/strings.ts';
import { chips, field, numberInput, select, type Ctx } from './ctx.ts';
import type { GrowthKey } from './strings.ts';

interface Stored { input: ProgramInput; program: Program; startedAt: number }
type States = Partial<Record<FormMoveId, MoveState>>;

const todayIso = (d = new Date()): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

async function load(c: Ctx): Promise<{ stored: Stored | null; states: States }> {
  return { stored: await c.vault.getJson<Stored>('program', 'current'), states: (await c.vault.getJson<States>('program', 'states')) ?? {} };
}

export async function programSummary(c: Ctx): Promise<string> {
  const { stored } = await load(c);
  if (!stored) return c.W.none;
  const plan = getTodayPlan({ program: stored.program, date: todayIso() });
  return plan.restDay ? c.W.restDay : c.t('todayIs', { what: c.t('session', { id: plan.sessionId ?? '' }) });
}

export async function programTab(c: Ctx, host: HTMLElement): Promise<() => void> {
  const { el, btn, W } = c;
  const disposers: (() => void)[] = [];
  const { stored, states } = await load(c);
  const moveName = (id: FormMoveId): string => FORM_WORDS[c.lang].moves[id]?.name ?? id;
  const full = c.access.can('growth:program-full');

  if (!stored) { host.append(setupForm()); return () => undefined; }

  const wrap = el('div', 'gc-wide'); host.append(wrap);
  const left = el('div', 'gc-grid'); left.style.gridTemplateColumns = '1fr';
  const right = el('div', 'gc-grid'); right.style.gridTemplateColumns = '1fr';
  wrap.append(left, right);
  const week = Math.floor((Date.now() - stored.startedAt) / (7 * 86_400_000)) + 1;

  // ---- check-in ----
  const ci = el('section', 'gc-card'); ci.dataset.checkin = '';
  const ans: DailyCheckin = (await c.vault.getJson<{ date: string; a: DailyCheckin }>('program', 'checkin').then((x) => (x?.date === todayIso() ? x.a : null))) ?? { sleep: 'good', energy: 3, body: 'fine', painAreas: [], minutes: stored.input.minutes, priority: 'any' };
  const q = (label: string, node: HTMLElement): void => { ci.append(el('p', 'gc-q', label), node); };
  ci.append(el('h2', '', W.checkinTitle));
  q(W.sleep, chips(c, [['good', W.sleep_good], ['ok', W.sleep_ok], ['poor', W.sleep_poor]] as const, [ans.sleep], false, (v) => { ans.sleep = v[0] as DailyCheckin['sleep']; }, 'sleep'));
  q(W.energy, chips(c, (['1', '2', '3', '4', '5'] as const).map((n) => [n, n] as [typeof n, string]), [String(ans.energy) as '3'], false, (v) => { ans.energy = Number(v[0]) as DailyCheckin['energy']; }, 'energy'));
  const painBox = el('div'); painBox.hidden = ans.body !== 'pain';
  q(W.bodyFeel, chips(c, [['fine', W.body_fine], ['tired', W.body_tired], ['pain', W.body_pain]] as const, [ans.body], false, (v) => { ans.body = v[0] as DailyCheckin['body']; painBox.hidden = ans.body !== 'pain'; }, 'body'));
  painBox.append(el('p', 'gc-q', W.painWhere), chips(c, AREAS.map((a) => [a, W[`area_${a}` as GrowthKey]] as [Area, string]), ans.painAreas ?? [], true, (v) => { ans.painAreas = v; }, 'pain'));
  ci.append(painBox);
  const mins = numberInput(c, ans.minutes, { min: 5, max: 120, step: 5 }); mins.dataset.minutes = '';
  ci.append(field(c, W.minutesToday, mins));
  q(W.priority, chips(c, [['any', W.prio_any], ['strength', W.prio_strength], ['cardio', W.prio_cardio], ['mobility', W.prio_mobility]] as const, [ans.priority], false, (v) => { ans.priority = v[0] as DailyCheckin['priority']; }, 'priority'));
  const planB = btn(W.planToday, 'gc-btn gc-btn--primary', async () => {
    ans.minutes = Math.max(5, Number(mins.value) || stored.input.minutes);
    await c.vault.putJson('program', 'checkin', { date: todayIso(), a: ans });
    drawToday(getTodayPlan({ program: stored.program, date: todayIso(), checkin: ans, states, week }));
  });
  ci.append(el('div', 'gc-row'), planB);
  left.append(ci);

  // ---- today ----
  const today = el('section', 'gc-card'); today.dataset.today = '';
  left.append(today);
  function drawToday(p: TodayPlan): void {
    today.replaceChildren(el('h2', '', c.t('todayPlan', { min: p.minutes })));
    today.dataset.intensity = p.intensity;
    for (const a of p.adjustments) { const x = el('p', 'gc-muted', W[`adj_${a}` as GrowthKey]); x.dataset.adj = a; today.append(x); }
    for (const n of p.notes) { const x = el('p', 'gc-note', W[`note_${n}` as GrowthKey]); x.dataset.note = n; today.append(x); }
    for (const b of p.blocks) {
      if (!b.items.length) continue;
      today.append(el('h3', '', W[`blk_${b.kind}` as GrowthKey] + (b.kind === 'conditioning' && b.rounds ? ` · ${c.t('rounds', { n: b.rounds, s: b.workS ?? 30 })}` : '')));
      const ul = el('ul', 'gc-list');
      for (const it of b.items) {
        const li = el('li'); li.dataset.move = it.move;
        const why = b.kind === 'main' && states[it.move] ? W[`why_${states[it.move]!.reason}` as GrowthKey].replace('{err}', states[it.move]!.formError ?? '') : '';
        li.append(el('b', '', moveName(it.move)), c.doc.createTextNode(b.kind === 'main' ? `${c.t(it.unit === 'seconds' ? 'setsSec' : 'sets', { sets: it.sets, target: it.target })} · ${c.t('rest', { s: it.restS })}${it.loadKg ? ` · ${c.t('loadKg', { kg: it.loadKg })}` : ''}` : ''));
        if (why) li.append(el('small', 'gc-muted', why));
        if (b.kind === 'main') li.append(btn(`${W.swap}${full ? '' : ` · ${W.proTag}`}`, 'gc-btn', async () => {
          if (!full) { c.toast(W.proLocked); return; }
          const alt = alternatives(it.move, stored!.input)[0];
          if (!alt) return;
          stored!.program = swapInProgram(stored!.program, it.move, alt);
          await c.vault.putJson('program', 'current', stored);
          drawToday(getTodayPlan({ program: stored!.program, date: todayIso(), checkin: ans, states, week }));
        }));
        ul.append(li);
      }
      today.append(ul);
    }
    const go = btn(W.startSession, 'gc-btn gc-btn--primary', () => runSession(p));
    go.dataset.startSession = '';
    today.append(go);
  }
  drawToday(getTodayPlan({ program: stored.program, date: todayIso(), checkin: ans, states, week }));

  // ---- the week ----
  const wk = el('section', 'gc-card'); wk.dataset.week = '';
  wk.append(el('h2', '', W.week));
  const dayNames = Array.from({ length: 7 }, (_, d) => new Intl.DateTimeFormat(c.tag, { weekday: 'short' }).format(new Date(Date.UTC(2026, 10, 1 + d, 12))));
  const ul = el('ul', 'gc-list');
  for (const d of [1, 2, 3, 4, 5, 6, 0] as Weekday[]) {
    const id = stored.program.schedule[d];
    const li = el('li'); li.append(el('b', '', dayNames[d]!), c.doc.createTextNode(id ? c.t('session', { id }) : W.restDay)); ul.append(li);
  }
  wk.append(ul);
  if (!spacingOk(stored.program)) wk.append(el('p', 'gc-note', W.spacing));
  if (stored.program.missingPatterns.length) wk.append(el('p', 'gc-note', c.t('missing', { what: stored.program.missingPatterns.map((m) => W[`pat_${m}` as GrowthKey] ?? m).join(', ') })));
  if ((stored.input.avoid?.areas?.length ?? 0) > 0) wk.append(el('p', 'gc-note', W.avoidNote));
  wk.append(btn(W.rebuild, 'gc-btn', async () => { await c.vault.remove('program', 'current'); await c.vault.remove('program', 'states'); c.refresh(); }));
  right.append(wk);

  // ---- the session runner ----
  const run = el('section', 'gc-card'); run.dataset.session = ''; run.hidden = true;
  right.prepend(run);
  function runSession(p: TodayPlan): void {
    const steps = stepsOf(p.blocks.filter((b) => b.kind === 'main' || b.kind === 'conditioning'));
    const sessionId = newId(), logs: SetLog[] = [];
    let k = 0;
    run.hidden = false; run.scrollIntoView({ block: 'start' });
    const services = browserServices();
    let lease: CameraLease | null = null, offFrame: (() => void) | null = null, stopTrace: (() => void) | null = null;
    let coach: FormCoach | null = null, startedAt = 0, reached = false;
    const stage = el('div', 'gc-stage'); stage.style.aspectRatio = '4/3';
    const vid = el('video'); vid.muted = true; vid.playsInline = true;
    const hud = el('p', 'gc-cue'); hud.dataset.hud = '';
    stage.append(vid, hud);
    const head = el('h2');
    const count = el('div', 'gc-big'); count.dataset.count = '0';
    const panel = el('div');
    run.replaceChildren(head, stage, count, panel);
    const stop = (): void => { offFrame?.(); offFrame = null; stopTrace?.(); stopTrace = null; services.pose.detach(); lease?.release(); lease = null; vid.srcObject = null; };
    disposers.push(stop);
    const onFrame = (f: PoseFrame): void => {
      if (!coach) return;
      const s = coach.push(f);
      const st = steps[k]!;
      const sum = coach.summary();
      const n = st.item.unit === 'seconds' ? Math.floor(s.holdMs / 1000) : s.reps;
      count.textContent = String(n); count.dataset.count = String(n);
      hud.textContent = s.cue ? (FORM_WORDS[c.lang].cues[s.cue] ?? '') : '';
      if (!reached && targetReached({ reps: s.reps, holdMs: s.holdMs, ...(sum.sides ? { sides: sum.sides } : {}) }, st.item)) { reached = true; hud.textContent = '✓'; }
    };
    async function camera(): Promise<void> {
      if (c.traceUrl) {
        const tr = parseTrace(await (await c.win.fetch(c.traceUrl)).json());
        const src = traceSource(tr);
        offFrame = services.pose.onFrame(onFrame); services.pose.attach(src); await src.start(); stopTrace = () => src.stop();
      } else {
        lease = await services.camera.acquire({});
        await lease.start(); vid.srcObject = lease.stream; await vid.play();
        await services.pose.load({ modelUrl: POSE_MODEL.url, wasmBase: WASM_BASE, prefer: 'GPU', maxHz: 30 });
        await services.pose.warmUp();
        offFrame = services.pose.onFrame(onFrame); services.pose.attach(lease);
      }
    }
    function showStep(): void {
      const st: Step | undefined = steps[k];
      if (!st) { void finish(); return; }
      coach = createFormCoach(st.item.move); reached = false; startedAt = Date.now();
      head.textContent = `${moveName(st.item.move)} · ${c.t('setOf', { n: st.setNo, of: st.block === 'main' ? st.item.sets : 1 })} · ${c.t('target', { t: `${st.item.target}${st.item.unit === 'seconds' ? ` ${W.seconds}` : ''}` })}`;
      count.textContent = '0';
      const done = btn(W.setDone, 'gc-btn gc-btn--primary', () => setDone()); done.dataset.setDone = '';
      const manual = numberInput(c, null, { min: 0, max: 500, step: 1 }); manual.dataset.manual = '';
      panel.replaceChildren(el('div', 'gc-row'), field(c, W.manual, manual));
      (panel.firstChild as HTMLElement).append(done);
      function setDone(): void {
        const sum = coach!.summary();
        const typed = manual.value !== '' ? Number(manual.value) : null;
        let log = fromSummary({ sessionId, moveId: st!.item.move, setNo: st!.setNo, sum, rir: 1, startedAt, endedAt: Date.now(), ...(st!.item.loadKg !== undefined ? { loadKg: st!.item.loadKg } : {}) });
        if (typed !== null) log = { ...correct(log, typed), source: sum.reps === 0 ? 'manual' : 'camera' };
        const ask = el('div');
        ask.append(el('p', 'gc-q', W.rirQ));
        const r = el('div', 'gc-row');
        for (const [v, t] of [[0, W.rir0], [1, W.rir1], [3, W.rir3]] as const) r.append(btn(t, 'gc-btn', () => { logs.push({ ...log, rir: v }); void c.vault.putJson('logs', newId(), { ...log, rir: v }); rest(st!.restAfterS); }));
        const fix = el('div', 'gc-row');
        const minus = btn('−', 'gc-btn', () => { log = correct(log, log.reps - 1); count.textContent = String(log.reps); });
        const plus = btn('+', 'gc-btn', () => { log = correct(log, log.reps + 1); count.textContent = String(log.reps); });
        fix.append(el('span', 'gc-muted', W.countWrong), minus, plus);
        ask.append(r, fix);
        panel.replaceChildren(ask);
      }
    }
    function rest(s: number): void {
      k++;
      if (!steps[k] || s <= 0) return showStep();
      let left = s;
      const nextName = moveName(steps[k]!.item.move);
      const line = el('p', 'gc-big', c.t('restLeft', { s: left }));
      const skip = btn(W.skipRest, 'gc-btn', () => { c.win.clearInterval(id); showStep(); });
      panel.replaceChildren(line, el('p', 'gc-muted', c.t('next', { what: nextName })), skip);
      const id = c.win.setInterval(() => { left--; line.textContent = c.t('restLeft', { s: left }); if (left <= 0) { c.win.clearInterval(id); showStep(); } }, 1000);
      disposers.push(() => c.win.clearInterval(id));
    }
    async function finish(): Promise<void> {
      stop();
      const main = p.blocks.filter((b) => b.kind === 'main').flatMap((b) => b.items);
      const res = resultsOf(logs, main, todayIso());
      const dumbbells = stored!.input.dumbbellsKg ?? [];
      const next: States = { ...states };
      for (const r of res) {
        const plan = main.find((m) => m.move === r.move)!;
        const cur = next[r.move] ?? startState(plan);
        next[r.move] = applyResult(cur, r, { dumbbellsKg: dumbbells, beginner: stored!.input.level === 'beginner' });
        if (next[r.move]!.move !== r.move) next[next[r.move]!.move] = next[r.move];
      }
      await c.vault.putJson('program', 'states', next);
      head.textContent = W.sessionDone;
      const list = el('ul', 'gc-list');
      for (const r of res) {
        const s = next[r.move]!;
        const li = el('li'); li.dataset.result = r.move;
        li.append(el('b', '', moveName(r.move)), c.doc.createTextNode(` ${r.done.join(' · ')}`), el('small', 'gc-muted', W[`why_${s.reason}` as GrowthKey].replace('{err}', s.formError ?? '')));
        list.append(li);
      }
      panel.replaceChildren(list);
      stage.remove(); count.remove();
    }
    void camera().catch(() => { hud.textContent = W.cameraError; });
    showStep();
  }

  return () => { for (const d of disposers) d(); };

  // ---- setup ----
  function setupForm(): HTMLElement {
    const f = el('section', 'gc-card'); f.dataset.programSetup = '';
    const input: ProgramInput = { goal: 'general', level: 'beginner', equipment: [], dumbbellsKg: [], days: [1, 3, 5], minutes: 30, avoid: { areas: [] }, gameBlock: false, minor: c.minor() };
    f.append(el('h2', '', W.progSetup));
    const q = (label: string, node: HTMLElement): void => { f.append(el('p', 'gc-q', label), node); };
    q(W.goal, chips(c, (['strength', 'conditioning', 'general', 'mobility'] as Goal[]).map((g) => [g, W[`goal_${g}` as GrowthKey]] as [Goal, string]), [input.goal], false, (v) => { input.goal = v[0]!; }, 'goal'));
    q(W.level, chips(c, (['beginner', 'intermediate', 'advanced'] as Level[]).map((g) => [g, W[`level_${g}` as GrowthKey]] as [Level, string]), [input.level], false, (v) => { input.level = v[0]!; }, 'level'));
    const eqOpts = (['chair', 'wall', 'step', 'dumbbell'] as Equip[]).map((e) => [e, W[`eq_${e}` as GrowthKey] + (e === 'dumbbell' && !full ? ` · ${W.proTag}` : '')] as [Equip, string]);
    q(W.equipment, chips(c, eqOpts, [], true, (v) => { input.equipment = v.filter((e) => e !== 'dumbbell' || full); if (v.includes('dumbbell') && !full) c.toast(W.proLocked); }, 'equipment'));
    const kg = c.el('input'); kg.type = 'text'; kg.inputMode = 'decimal'; kg.dataset.dumbbells = '';
    f.append(field(c, W.dumbbellKg, kg));
    const dayNames = Array.from({ length: 7 }, (_, d) => new Intl.DateTimeFormat(c.tag, { weekday: 'short' }).format(new Date(Date.UTC(2026, 10, 1 + d, 12))));
    q(W.daysLabel, chips(c, ([1, 2, 3, 4, 5, 6, 0] as Weekday[]).map((d) => [String(d), dayNames[d]!] as [string, string]), input.days.map(String), true, (v) => {
      const days = v.map(Number) as Weekday[];
      if (days.length > 3 && !full) { c.toast(W.proLocked); }
      input.days = full ? days : days.slice(0, 3);
    }, 'days'));
    const mins = select(c, ([15, 20, 30, 45, 60] as const).map((m) => [String(m), `${m}${m >= 45 && !full ? ` · ${W.proTag}` : ''}`] as [string, string]), '30'); mins.dataset.minutesSel = '';
    mins.addEventListener('change', () => { const m = Number(mins.value) as ProgramInput['minutes']; if (m >= 45 && !full) { c.toast(W.proLocked); mins.value = '30'; return; } input.minutes = m; });
    f.append(field(c, W.minutes, mins));
    q(W.avoidLabel, chips(c, AREAS.map((a) => [a, W[`area_${a}` as GrowthKey]] as [Area, string]), [], true, (v) => { input.avoid = { ...input.avoid, areas: v }; }, 'avoid'));
    q('', chips(c, [['noJumping', W.noJumping], ['noFloor', W.noFloor], ['noBalance', W.noBalance], ['game', `${W.gameBlock} · ${W.proTag}`]] as const, [], true, (v) => {
      input.avoid = { ...input.avoid, noJumping: v.includes('noJumping'), noFloor: v.includes('noFloor'), noBalance: v.includes('noBalance') };
      input.gameBlock = v.includes('game') && c.access.can('growth:program-full');
    }, 'limits'));
    f.append(el('p', 'gc-note', W.avoidNote));
    f.append(btn(W.build, 'gc-btn gc-btn--primary', async () => {
      input.dumbbellsKg = kg.value.split(/[;,\s]+/).map((x) => Number(x.replace(',', '.'))).filter((x) => x > 0 && x < 100);
      if (input.equipment.includes('dumbbell') && !input.dumbbellsKg.length) input.equipment = input.equipment.filter((e) => e !== 'dumbbell');
      const program = generateProgram(input);
      await c.vault.putJson('program', 'current', { input, program, startedAt: Date.now() } satisfies Stored);
      c.refresh();
    }));
    return f;
  }
}
