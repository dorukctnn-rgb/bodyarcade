// What every tab of the progress coach page shares: words, the vault, access to Pro features, the person's settings,
// small DOM helpers and unit conversion. Nothing here talks to a network.
import type { Lang } from '../../../core/ui/i18n/index.ts';
import type { Vault } from '../../../core/growth/vault/vault.ts';
import type { GrowthKey, GrowthWords } from './strings.ts';
import { fill } from './strings.ts';
import type { PlayFacts } from './play.ts';

export interface GrowthAccess {
  /** a Pro feature id: 'growth:turntable', 'growth:timelapse', 'growth:program-full', 'growth:meals-week', 'growth:shopping', 'growth:adaptive' */
  can(feature: string): boolean;
  /** the vault's profile (a family plan gives every player their own vault and PIN) */
  profileId: string;
}

export interface Settings {
  birthYear: number | null;
  units: 'metric' | 'imperial';
  hideNumbers: boolean;
  lastBackupAt: number | null;
  photosSinceBackup: number;
  firstPhotoAt: number | null;
  setupDone: boolean;
}

export const DEFAULT_SETTINGS: Settings = { birthYear: null, units: 'metric', hideNumbers: false, lastBackupAt: null, photosSinceBackup: 0, firstPhotoAt: null, setupDone: false };

export interface Ctx {
  win: Window;
  doc: Document;
  lang: Lang;
  tag: string;
  W: GrowthWords;
  vault: Vault;
  access: GrowthAccess;
  settings: Settings;
  saveSettings(patch: Partial<Settings>): Promise<void>;
  t(key: GrowthKey, vars?: Record<string, string | number>): string;
  el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K];
  btn(text: string, cls?: string, onClick?: () => void): HTMLButtonElement;
  toast(text: string): void;
  date(ms: number | string): string;
  /** re-draw the current tab */
  refresh(): void;
  go(tab: TabId): void;
  /** is this person under 18 (by the year they typed)? */
  minor(): boolean;
  /** the trace test hook: a recorded landmark trace instead of the camera (developers and tests) */
  traceUrl: string | null;
  /** the games' side (the arcade's rounds, seconds and bests, the catalogue), or null when the page runs without it */
  play: PlayFacts | null;
}

/** 'home' is the Today panel (kol F); 'progress' and 'quests' are its two pages. */
export type TabId = 'home' | 'progress' | 'quests' | 'photos' | 'twin' | 'program' | 'food' | 'settings';

export function makeHelpers(doc: Document, W: GrowthWords): Pick<Ctx, 't' | 'el' | 'btn'> {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  return {
    t: (key, vars) => (vars ? fill(W[key], vars) : W[key]),
    el,
    btn: (text, cls = 'gc-btn', onClick) => { const b = el('button', cls, text); b.type = 'button'; if (onClick) b.addEventListener('click', onClick); return b; },
  };
}

// ---- units: everything is stored metric ----
export const CM_PER_IN = 2.54;
export const KG_PER_LB = 0.45359237;
export const toCm = (v: number, units: Settings['units']): number => (units === 'imperial' ? v * CM_PER_IN : v);
export const fromCm = (cm: number, units: Settings['units']): number => (units === 'imperial' ? cm / CM_PER_IN : cm);
export const toKg = (v: number, units: Settings['units']): number => (units === 'imperial' ? v * KG_PER_LB : v);
export const fromKg = (kg: number, units: Settings['units']): number => (units === 'imperial' ? kg / KG_PER_LB : kg);
export const round1 = (v: number): number => Math.round(v * 10) / 10;

/** A labelled field: <label><span>text</span><input></label>. */
export function field(c: Pick<Ctx, 'el'>, label: string, input: HTMLElement, cls = 'gc-field'): HTMLLabelElement {
  const l = c.el('label', cls);
  l.append(c.el('span', '', label), input);
  return l;
}

export function select(c: Pick<Ctx, 'el'>, options: readonly [string, string][], value: string): HTMLSelectElement {
  const s = c.el('select');
  for (const [v, t] of options) { const o = c.el('option', '', t); o.value = v; o.selected = v === value; s.append(o); }
  return s;
}

export function numberInput(c: Pick<Ctx, 'el'>, value: number | null | undefined, o: { min?: number; max?: number; step?: number } = {}): HTMLInputElement {
  const i = c.el('input');
  i.type = 'number'; i.inputMode = 'decimal';
  if (o.min !== undefined) i.min = String(o.min);
  if (o.max !== undefined) i.max = String(o.max);
  i.step = String(o.step ?? 0.1);
  if (value !== null && value !== undefined && Number.isFinite(value)) i.value = String(value);
  return i;
}

export function chips<T extends string>(c: Pick<Ctx, 'el'>, options: readonly [T, string][], selected: readonly T[], multi: boolean, onChange: (v: T[]) => void, name: string): HTMLElement {
  const box = c.el('div', 'gc-chips');
  box.setAttribute('role', multi ? 'group' : 'radiogroup');
  let cur = [...selected];
  const draw = (): void => {
    box.replaceChildren(...options.map(([v, t]) => {
      const b = c.el('button', 'gc-chip', t);
      b.type = 'button'; b.dataset.value = v; b.dataset.name = name;
      b.setAttribute(multi ? 'aria-pressed' : 'aria-checked', String(cur.includes(v)));
      if (!multi) b.setAttribute('role', 'radio');
      b.addEventListener('click', () => {
        cur = multi ? (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]) : [v];
        draw(); onChange(cur);
      });
      return b;
    }));
  };
  draw();
  return box;
}

/** Downloads bytes as a file (desktop) or hands them to the share sheet (phones with Web Share files). */
export async function saveFile(win: Window, bytes: Uint8Array<ArrayBuffer> | Blob, name: string, type: string): Promise<void> {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type });
  const nav = win.navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  try {
    const file = new File([blob], name, { type });
    if (nav.canShare?.({ files: [file] }) && /Android|iPhone|iPad/.test(nav.userAgent)) { await nav.share({ files: [file] }); return; }
  } catch { /* fall back to a download */ }
  const url = URL.createObjectURL(blob);
  const a = win.document.createElement('a'); a.href = url; a.download = name; a.rel = 'noopener';
  win.document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
