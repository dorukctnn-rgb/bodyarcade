// Small pieces the Today panel, the progress page and the quests share (kol F): the words, a ring, bars, a stat tile.
// Plain DOM and inline SVG: no chart library, no animation (the tracking screens stay fast; 3D and effects belong to the
// exercise screen). Colours come from the page's tokens.
import { fill } from './strings.ts';
import { TODAY_WORDS, type TodayKey } from './today-strings.ts';
import type { Ctx } from './ctx.ts';

export const TODAY_CSS = `
.gc-today{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:16px;align-items:start}
.gc-today > .gc-span{grid-column:1/-1}
.gc-hero{display:grid;grid-template-columns:auto minmax(0,1fr);gap:16px 20px;align-items:center}
.gc-hero h2{font-size:26px;margin:0}
.gc-hero .gc-date{color:var(--gc-muted);font-size:14px;margin:2px 0 8px}
.gc-ring{width:112px;height:112px;display:block}
.gc-ring text{font-family:inherit;font-weight:800;fill:var(--gc-text)}
.gc-ring .gc-ring-sub{font-weight:600;fill:var(--gc-muted)}
.gc-pills{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.gc-pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;background:var(--gc-panel2);border:1px solid var(--gc-line);padding:6px 12px;font-size:14px;font-weight:700}
.gc-pill b{font-variant-numeric:tabular-nums}
.gc-plan-line{font-size:18px;font-weight:700;line-height:1.4;margin:0 0 10px}
.gc-compact{list-style:none;margin:0 0 8px;padding:0;display:grid;gap:4px;font-size:14px}
.gc-compact li{display:flex;justify-content:space-between;gap:10px;border-bottom:1px solid var(--gc-line);padding:6px 0}
.gc-compact li span:last-child{color:var(--gc-muted);white-space:nowrap;font-variant-numeric:tabular-nums}
.gc-game{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;background:#0F0B20;border:1px solid var(--gc-line);border-radius:12px;padding:10px 12px;margin:10px 0}
.gc-link{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:10px 14px;border-radius:12px;font-weight:700;text-decoration:none;background:var(--gc-panel2);border:1px solid var(--gc-accent);color:var(--gc-text)}
.gc-tip{border-left:4px solid var(--gc-tip)}
.gc-tip .gc-tip-k{font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--gc-tip);margin:0 0 6px}
.gc-tip p:last-child{font-size:17px;font-weight:600;margin:0}
.gc-bars{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;align-items:end;gap:6px;height:96px;position:relative;margin-top:6px}
.gc-bar{display:grid;grid-template-rows:1fr auto;height:100%;gap:4px;min-width:0}
.gc-bar i{align-self:end;display:block;width:100%;border-radius:6px 6px 3px 3px;background:var(--gc-panel2);min-height:3px}
.gc-bar[data-active=true] i{background:var(--gc-ok)}
.gc-bar[data-now=true] i{outline:2px solid var(--gc-accent);outline-offset:1px}
.gc-bar small{font-size:11px;color:var(--gc-muted);text-align:center;white-space:nowrap;overflow:hidden}
.gc-goal-line{position:absolute;left:0;right:0;border-top:2px dashed var(--gc-tip);pointer-events:none}
.gc-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr));gap:12px}
.gc-tile{background:var(--gc-panel);border:1px solid var(--gc-line);border-radius:16px;padding:14px;min-width:0}
.gc-tile small{display:block;color:var(--gc-muted);font-size:13px;font-weight:700;margin-bottom:6px}
.gc-tile b{font-size:28px;font-weight:800;font-variant-numeric:tabular-nums;line-height:1.1}
.gc-quests{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.gc-quest{display:grid;grid-template-columns:28px minmax(0,1fr) auto;gap:10px;align-items:center;background:#0F0B20;border:1px solid var(--gc-line);border-radius:12px;padding:10px 12px}
.gc-quest .gc-check{width:24px;height:24px;border-radius:50%;border:2px solid var(--gc-line);display:grid;place-items:center;font-size:14px;font-weight:900;color:#0E0A1E}
.gc-quest[data-done=true] .gc-check{background:var(--gc-ok);border-color:var(--gc-ok)}
.gc-quest small{color:var(--gc-muted);font-variant-numeric:tabular-nums}
.gc-meter{height:10px;border-radius:999px;background:var(--gc-panel2);overflow:hidden;margin:8px 0}
.gc-meter i{display:block;height:100%;background:var(--gc-ok);border-radius:999px}
.gc-badges{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,150px),1fr));gap:10px}
.gc-badge{background:#0F0B20;border:1px solid var(--gc-line);border-radius:14px;padding:12px;display:grid;gap:6px;justify-items:start;opacity:.62}
.gc-badge[data-earned=true]{opacity:1;border-color:var(--gc-ok)}
.gc-badge .gc-medal{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;font-weight:900;background:var(--gc-panel2);color:var(--gc-muted)}
.gc-badge[data-earned=true] .gc-medal{background:#123B2C;color:#D6F5E7}
.gc-badge b{font-size:14px}
.gc-badge small{color:var(--gc-muted);font-size:12px}
.gc-hist{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.gc-hist li{display:grid;grid-template-columns:minmax(84px,auto) minmax(0,1fr);gap:10px;border-bottom:1px solid var(--gc-line);padding:8px 0;font-size:14px}
.gc-hist li span:first-child{color:var(--gc-muted);font-variant-numeric:tabular-nums}
.gc [hidden]{display:none!important}
.gc-hold{position:absolute;left:50%;top:52px;transform:translateX(-50%);background:#C8102E;color:#fff;border-radius:14px;padding:10px 18px;display:grid;gap:6px;justify-items:center;font-size:24px;font-weight:900;letter-spacing:.06em;text-transform:uppercase;box-shadow:0 0 0 3px rgba(255,255,255,.85)}
.gc-hold-bar{display:block;width:120px;height:6px;border-radius:999px;background:rgba(255,255,255,.35);overflow:hidden}
.gc-hold-bar i{display:block;height:100%;width:0;background:#fff}
.gc-step-preview{position:absolute;right:10px;bottom:76px;width:min(52%,220px);background:rgba(14,10,30,.95);border:1px solid var(--gc-accent);border-radius:14px;padding:8px;display:grid;gap:6px;font-size:14px;z-index:2}
.gc-step-preview img{width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:8px;background:#000}
.gc-step-preview .gc-row{gap:6px;flex-wrap:nowrap}
.gc-step-preview .gc-btn{padding:8px 10px;flex:1 1 0;min-width:0}
@media (max-width:520px){.gc-hero{grid-template-columns:1fr;justify-items:start}.gc-hero h2{font-size:23px}}
@media (prefers-reduced-motion:reduce){.gc *{transition:none!important;animation:none!important;scroll-behavior:auto!important}}
`;

export type Tw = (k: TodayKey, vars?: Record<string, string | number>) => string;
export const tw = (c: Pick<Ctx, 'lang'>): Tw => (k, vars) => (vars ? fill(TODAY_WORDS[c.lang][k], vars) : TODAY_WORDS[c.lang][k]);

const SVG = 'http://www.w3.org/2000/svg';

/** A ring: the share done, the big number in the middle and a small word under it. */
export function ring(c: Pick<Ctx, 'doc'>, share: number, big: string, small: string, label: string): SVGSVGElement {
  const s = c.doc.createElementNS(SVG, 'svg');
  s.setAttribute('viewBox', '0 0 120 120'); s.setAttribute('class', 'gc-ring'); s.setAttribute('role', 'img'); s.setAttribute('aria-label', label);
  const r = 50, len = 2 * Math.PI * r, f = Math.max(0, Math.min(1, share));
  const back = c.doc.createElementNS(SVG, 'circle');
  for (const [k, v] of [['cx', '60'], ['cy', '60'], ['r', String(r)], ['fill', 'none'], ['stroke', 'var(--gc-panel2)'], ['stroke-width', '12']]) back.setAttribute(k!, v!);
  const fg = c.doc.createElementNS(SVG, 'circle');
  for (const [k, v] of [['cx', '60'], ['cy', '60'], ['r', String(r)], ['fill', 'none'], ['stroke', f >= 1 ? 'var(--gc-ok)' : 'var(--gc-accent)'], ['stroke-width', '12'], ['stroke-linecap', 'round'], ['stroke-dasharray', `${(len * f).toFixed(1)} ${len.toFixed(1)}`], ['transform', 'rotate(-90 60 60)']]) fg.setAttribute(k!, v!);
  const t1 = c.doc.createElementNS(SVG, 'text');
  for (const [k, v] of [['x', '60'], ['y', '62'], ['text-anchor', 'middle'], ['font-size', '30']]) t1.setAttribute(k!, v!);
  t1.textContent = big;
  const t2 = c.doc.createElementNS(SVG, 'text');
  for (const [k, v] of [['x', '60'], ['y', '84'], ['text-anchor', 'middle'], ['font-size', '13'], ['class', 'gc-ring-sub']]) t2.setAttribute(k!, v!);
  t2.textContent = small;
  s.append(back, fg, t1, t2);
  return s;
}

/** Bars: one per value, the highest at the top; an optional dashed goal line. */
export function bars(c: Pick<Ctx, 'el'>, items: readonly { value: number; label: string; title: string; active?: boolean; now?: boolean }[], goal?: number): HTMLElement {
  const box = c.el('div', 'gc-bars');
  box.setAttribute('role', 'list');
  const top = Math.max(1, goal ?? 0, ...items.map((i) => i.value)) * 1.08;
  for (const it of items) {
    const b = c.el('div', 'gc-bar'); b.setAttribute('role', 'listitem'); b.title = it.title; b.setAttribute('aria-label', it.title);
    b.dataset.active = String(it.active ?? it.value > 0); if (it.now) b.dataset.now = 'true';
    const i = c.el('i'); i.style.height = `${Math.round((it.value / top) * 100)}%`;
    b.append(i, c.el('small', '', it.label));
    box.append(b);
  }
  if (goal && goal > 0) {
    const g = c.el('div', 'gc-goal-line');
    // the bars' area is the box minus the label row (about 18 px)
    g.style.bottom = `calc(18px + (100% - 18px) * ${(goal / top).toFixed(3)})`;
    box.append(g);
  }
  return box;
}

export function tile(c: Pick<Ctx, 'el'>, label: string, value: string, key: string): HTMLElement {
  const t = c.el('div', 'gc-tile'); t.dataset.tile = key;
  t.append(c.el('small', '', label), c.el('b', '', value));
  return t;
}

export const fmt = (c: Pick<Ctx, 'tag'>, n: number): string => new Intl.NumberFormat(c.tag).format(n);
