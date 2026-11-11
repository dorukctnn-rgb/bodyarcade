// The 3D twin tab: guided tape measuring, the twin shaped only by those numbers (Leano's method, rebuilt for the web),
// then-and-now with a ghost and a heat map, a time-lapse between the first and the latest measurement, and ratios with
// their published references. With "hide numbers" on, the twin still shows (shape, ghost, heat) but no figure does.
import { TAPE_PARTS, type Tape, type TapePart, type TwinBase } from '../../../core/growth/twin/model.ts';
import { ratios } from '../../../core/growth/twin/ratios.ts';
import { newId } from '../../../core/growth/vault/vault.ts';
import { chips, field, fromCm, fromKg, numberInput, round1, toCm, toKg, type Ctx } from './ctx.ts';
import type { GrowthKey } from './strings.ts';

export interface MeasureRecord { at: number; base: TwinBase; heightCm: number; weightKg: number | null; tape: Tape }

const howKey = (p: TapePart): GrowthKey => `how_${p.replace(/[LR]$/, '')}` as GrowthKey;

export async function loadMeasures(c: Ctx): Promise<MeasureRecord[]> {
  return (await c.vault.all<MeasureRecord>('measures')).map((m) => m.value).sort((a, b) => a.at - b.at);
}

export async function twinTab(c: Ctx, host: HTMLElement): Promise<() => void> {
  const { el, btn, W } = c;
  const units = c.settings.units, hide = c.settings.hideNumbers;
  const all = await loadMeasures(c);
  const latest = all.at(-1) ?? null, first = all[0] ?? null;
  const wrap = el('div', 'gc-wide'); host.append(wrap);

  // ---- the twin ----
  const view = el('section', 'gc-card'); view.dataset.twin = '';
  const stage = el('div', 'gc-twin'); stage.dataset.twinStage = '';
  const tag = el('span', 'gc-pro', W.ratiosNote); tag.style.display = 'none';
  view.append(el('h2', '', W.twinTitle), el('p', 'gc-muted', W.twinNote), stage);
  let ghost = false, heatOn = false, morph = 1;
  const toggles = chips(c, [['ghost', W.ghost], ['heat', W.heat]] as const, [], true, (v) => { ghost = v.includes('ghost'); heatOn = v.includes('heat'); void update(); }, 'twin');
  const range = el('input'); range.type = 'range'; range.min = '0'; range.max = '100'; range.value = '100'; range.setAttribute('aria-label', W.thenNow); range.dataset.morph = '';
  range.addEventListener('input', () => { morph = Number(range.value) / 100; void update(); });
  const legend = el('div', 'gc-legend');
  for (const [col, t] of [['#7FD8FF', W.ghost], ['#FF9F43', `${W.heat}: ${W.more}`], ['#3FA9F5', `${W.heat}: ${W.less}`]] as const) { const s = el('span'); const i = el('i'); i.style.background = col; s.append(i, c.doc.createTextNode(t)); legend.append(s); }
  const playB = btn(`${W.timelapse} · ${W.proTag}`, 'gc-btn', () => {
    if (!c.access.can('growth:timelapse')) { c.toast(W.proLocked); return; }
    let t = 0; const id = c.win.setInterval(() => { t += 0.04; morph = Math.min(1, t); range.value = String(Math.round(morph * 100)); void update(); if (t >= 1) c.win.clearInterval(id); }, 60);
  });
  if (all.length >= 2) view.append(toggles, el('p', 'gc-muted', W.thenNow), range, legend, playB);
  wrap.append(view);

  let tv: import('./twin-view.ts').TwinView | null = null;
  async function update(): Promise<void> {
    if (!latest || !tv) return;
    await tv.update({ base: latest.base, heightCm: latest.heightCm, now: latest.tape, then: all.length >= 2 ? first!.tape : null, ghost, heat: heatOn, morph: all.length >= 2 ? morph : 1 });
  }
  if (latest) {
    const { createTwinView } = await import('./twin-view.ts');
    tv = createTwinView(stage);
    tv.canvas.setAttribute('aria-label', W.twinTitle);
    await update();
  } else stage.append(Object.assign(el('p', 'gc-muted', W.none), { style: 'position:absolute;inset:auto 0 45% 0;text-align:center' }));
  (c.win as unknown as { __twin?: unknown }).__twin = { stats: () => tv?.stats() ?? null };

  // ---- ratios ----
  if (latest && !hide) {
    const rs = ratios({ heightCm: latest.heightCm, waist: latest.tape.waist ?? null, hips: latest.tape.hips ?? null, formula: latest.base === 'female' ? 'female' : 'male' });
    if (rs.length) {
      const box = el('div'); box.dataset.ratios = '';
      box.append(el('h3', '', W.ratiosTitle));
      for (const r of rs) {
        const val = r.value.toLocaleString(c.tag);
        box.append(el('p', '', c.t(r.id, { v: val })), el('p', 'gc-note', c.t('refLine', { src: r.source === 'nice-ng246' ? W.srcNice : W.srcWho, ref: r.reference.toLocaleString(c.tag) })));
      }
      box.append(el('p', 'gc-note', W.ratiosNote));
      view.append(box);
    }
  }

  // ---- guided measuring ----
  const form = el('section', 'gc-card'); form.dataset.measure = '';
  form.append(el('h2', '', W.tape));
  let base: TwinBase = latest?.base ?? 'female';
  form.append(el('p', 'gc-q', W.body), chips(c, [['female', W.bodyF], ['male', W.bodyM]] as const, [base], false, (v) => { base = v[0] as TwinBase; }, 'base'));
  const unitL = units === 'imperial' ? W.unitIn : W.unitCm, wUnit = units === 'imperial' ? W.unitLb : W.unitKg;
  const height = numberInput(c, latest ? round1(fromCm(latest.heightCm, units)) : null, { min: 40, max: 250, step: 0.5 }); height.dataset.height = '';
  const weight = numberInput(c, latest?.weightKg ? round1(fromKg(latest.weightKg, units)) : null, { min: 20, max: 400, step: 0.1 }); weight.dataset.weight = '';
  const top = el('div', 'gc-form');
  top.append(field(c, `${W.height} (${unitL})`, height), field(c, `${W.weight} (${wUnit})`, weight));
  if (hide) { height.type = 'password'; weight.type = 'password'; }
  form.append(top);
  const inputs = new Map<TapePart, HTMLInputElement>();
  const grid = el('div', 'gc-form');
  for (const p of TAPE_PARTS) {
    const i = numberInput(c, latest?.tape[p] ? round1(fromCm(latest.tape[p]!, units)) : null, { min: 10, max: 250, step: 0.5 });
    i.dataset.part = p;
    if (hide) i.type = 'password';
    const f = field(c, `${W[`part_${p}` as GrowthKey]} (${unitL})`, i);
    f.title = W[howKey(p)];
    grid.append(f);
    inputs.set(p, i);
  }
  const how = el('details'); how.append(el('summary', '', W.howToMeasure));
  const hl = el('ul', 'gc-list');
  for (const p of ['neck', 'chest', 'waist', 'hips', 'thighL', 'calfL', 'upperArmL'] as TapePart[]) hl.append(el('li', '', `${W[`part_${p}` as GrowthKey].split(',')[0]}: ${W[howKey(p)]}`));
  how.append(hl);
  const save = btn(W.addMeasure, 'gc-btn gc-btn--primary', async () => {
    const h = Number(height.value);
    if (!(h > 0)) { height.focus(); return; }
    const tape: Tape = {};
    for (const [p, i] of inputs) { const v = Number(i.value); if (i.value && v > 0) tape[p] = round1(toCm(v, units)); }
    const rec: MeasureRecord = { at: Date.now(), base, heightCm: round1(toCm(h, units)), weightKg: weight.value ? round1(toKg(Number(weight.value), units)) : null, tape };
    await c.vault.putJson('measures', newId(), rec);
    c.toast(W.saved); c.refresh();
  });
  form.append(grid, how, save);
  // history
  if (all.length) {
    const list = el('ul', 'gc-list');
    for (const m of [...all].reverse()) {
      const li = el('li');
      li.append(el('b', '', c.t('measuredOn', { date: c.date(m.at) })));
      if (!hide && m.tape.waist) li.append(c.doc.createTextNode(`${W.part_waist} ${round1(fromCm(m.tape.waist, units))} ${unitL}`));
      list.append(li);
    }
    form.append(el('h3', '', W.timeline), list);
  }
  wrap.append(form);
  const onResize = (): void => tv?.resize();
  c.win.addEventListener('resize', onResize);
  return () => { c.win.removeEventListener('resize', onResize); tv?.dispose(); };
}
