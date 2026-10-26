// Player preferences for the shell: language, theme, seated and quiet mode, the self-view corner, motion, TV text.
// Stored through the contract's Namespace with a schema, so a damaged value resets that field and nothing else (B4).
import type { BodyRegion, Namespace, Schema, Unsubscribe } from '../types/index.ts';
import { isLang, type Lang } from './i18n/index.ts';
import type { PipPlacement } from './layout.ts';

export type ThemePref = 'system' | 'light' | 'dark';
export type MotionPref = 'system' | 'reduce' | 'full';
export type Level = 'gentle' | 'steady' | 'strong';
export type SetupDevice = 'phone' | 'phoneLand' | 'laptop';
/** What a round is played with when nothing else is asked: the camera, or the keyboard (and swipes on a touch screen). */
export type ControlsPref = 'camera' | 'keyboard';

export interface Settings {
  /** 'auto' follows the browser's language list. */
  lang: Lang | 'auto';
  theme: ThemePref;
  /** Play from a chair; games with a seated version use it (game-design 0.1 item 5). */
  seated: boolean;
  /** No jumping or stamping (game-design 0.1 item 6). */
  quiet: boolean;
  /**
   * Play without the camera: rounds begin with the keyboard (and swipes on a touch screen) instead of the camera. A way for anyone who
   * cannot or does not want to use the camera; two-player rounds and races always use it.
   */
  controls: ControlsPref;
  /** Where your own camera view sits during scene games, or hidden (LAYOUT.md section 4). */
  pipCorner: PipPlacement;
  /** Draw the tracked skeleton on the self view. */
  skeleton: boolean;
  /** Keep the last seconds of a round on this device, to be shared from the results. Nothing is uploaded. */
  clips: boolean;
  motion: MotionPref;
  /** TV mode: root font size 150 % and four columns. */
  bigText: boolean;
  sound: boolean;
  /** Optional, stays on the device; without it no calories are shown (game-design 2.10). */
  weightKg: number | null;
  /** The body regions chosen in the welcome tour. */
  regions: BodyRegion[];
  level: Level;
  device: SetupDevice;
  onboardingDone: boolean;
  /** Epoch ms of the last time the paywall appeared on its own (paywall policy: not again for 3 days). */
  paywallShownAt: number | null;
  /** Pro games already played once for free, by game id. */
  playedOnce: string[];
  /** The world last chosen in each game that has worlds (Road Run), by game id: the next round on this device starts there. */
  worlds: Record<string, string>;
}

export const REGION_IDS: readonly BodyRegion[] = ['legs', 'arms', 'chest-back', 'core', 'cardio', 'mobility', 'seated'];
export const PIP_PLACEMENTS: readonly PipPlacement[] = ['bottom-right', 'bottom-left', 'top-left', 'top-right', 'hidden'];

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  lang: 'auto',
  theme: 'system',
  seated: false,
  quiet: false,
  controls: 'camera',
  pipCorner: 'bottom-right',
  skeleton: true,
  clips: true,
  motion: 'system',
  bigText: false,
  sound: true,
  weightKg: null,
  regions: [],
  level: 'steady',
  device: 'phone',
  onboardingDone: false,
  paywallShownAt: null,
  playedOnce: [],
  worlds: {},
};

/** A game id or a world id: lower-case letters, digits and hyphens (what the manifests and themes allow). */
const ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T =>
  (typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : fallback);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

/** Field by field: a value of the wrong type becomes its default, the rest of the object survives. */
export function sanitizeSettings(raw: unknown): Settings {
  const o = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_SETTINGS;
  const w = o['weightKg'];
  const weight = typeof w === 'number' && Number.isFinite(w) && w >= 20 && w <= 350 ? Math.round(w * 10) / 10 : null;
  const regionsRaw = o['regions'];
  const regions = Array.isArray(regionsRaw) ? REGION_IDS.filter((r) => (regionsRaw as unknown[]).includes(r)) : [];
  const playedRaw = o['playedOnce'];
  const played = Array.isArray(playedRaw)
    ? (playedRaw as unknown[]).filter((x): x is string => typeof x === 'string' && x.length <= 64).slice(0, 200)
    : [];
  const worldsRaw = o['worlds'];
  const worlds: Record<string, string> = {};
  if (typeof worldsRaw === 'object' && worldsRaw !== null && !Array.isArray(worldsRaw)) {
    for (const [game, world] of Object.entries(worldsRaw as Record<string, unknown>).slice(0, 50)) {
      if (ID_RE.test(game) && typeof world === 'string' && ID_RE.test(world)) worlds[game] = world;
    }
  }
  const sa = o['paywallShownAt'];
  const shownAt = typeof sa === 'number' && Number.isFinite(sa) ? sa : null;
  const lang = o['lang'];
  return {
    lang: lang === 'auto' || isLang(lang) ? lang : d.lang,
    theme: oneOf(o['theme'], ['system', 'light', 'dark'], d.theme),
    seated: bool(o['seated'], d.seated),
    quiet: bool(o['quiet'], d.quiet),
    controls: oneOf(o['controls'], ['camera', 'keyboard'], d.controls),
    pipCorner: oneOf(o['pipCorner'], PIP_PLACEMENTS, d.pipCorner),
    skeleton: bool(o['skeleton'], d.skeleton),
    clips: bool(o['clips'], d.clips),
    motion: oneOf(o['motion'], ['system', 'reduce', 'full'], d.motion),
    bigText: bool(o['bigText'], d.bigText),
    sound: bool(o['sound'], d.sound),
    weightKg: weight,
    regions,
    level: oneOf(o['level'], ['gentle', 'steady', 'strong'], d.level),
    device: oneOf(o['device'], ['phone', 'phoneLand', 'laptop'], d.device),
    onboardingDone: bool(o['onboardingDone'], d.onboardingDone),
    paywallShownAt: shownAt,
    playedOnce: [...new Set(played)],
    worlds,
  };
}

export const SETTINGS_SCHEMA: Schema<Settings> = {
  version: 1,
  parse: (raw) => (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? sanitizeSettings(raw) : null),
};

export type SettingsListener = (s: Readonly<Settings>, changed: readonly (keyof Settings)[]) => void;

export interface SettingsStore {
  get(): Readonly<Settings>;
  set(patch: Partial<Settings>): Readonly<Settings>;
  reset(): void;
  subscribe(cb: SettingsListener): Unsubscribe;
}

export function createSettingsStore(ns: Namespace | null, key = 'settings'): SettingsStore {
  let cur: Settings = ns ? ns.get(key, SETTINGS_SCHEMA, { ...DEFAULT_SETTINGS }) : { ...DEFAULT_SETTINGS };
  const subs = new Set<SettingsListener>();
  return {
    get: () => cur,
    set(patch) {
      const next = sanitizeSettings({ ...cur, ...patch });
      const changed = (Object.keys(next) as (keyof Settings)[]).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(cur[k]));
      if (!changed.length) return cur;
      cur = next;
      ns?.set(key, cur);
      for (const cb of [...subs]) cb(cur, changed);
      return cur;
    },
    reset() {
      const changed = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[];
      cur = { ...DEFAULT_SETTINGS };
      ns?.remove(key);
      for (const cb of [...subs]) cb(cur, changed);
    },
    subscribe(cb) {
      subs.add(cb);
      return () => { subs.delete(cb); };
    },
  };
}

/** What the document needs to know: attributes the stylesheet and the screen readers read. */
export interface DocumentLike {
  documentElement: { lang: string; dataset: DOMStringMap };
}

export function applySettingsToDocument(doc: DocumentLike, s: Readonly<Settings>, lang: Lang, tag: string, prefersReducedMotion: boolean): void {
  const el = doc.documentElement;
  el.lang = tag;
  el.dataset['lang'] = lang;
  if (s.theme === 'system') delete el.dataset['theme'];
  else el.dataset['theme'] = s.theme;
  const reduce = s.motion === 'reduce' || (s.motion === 'system' && prefersReducedMotion);
  el.dataset['motion'] = reduce ? 'reduce' : 'full';
  if (s.bigText) el.dataset['bigText'] = '1';
  else delete el.dataset['bigText'];
  el.dataset['seated'] = s.seated ? '1' : '0';
  el.dataset['quiet'] = s.quiet ? '1' : '0';
}
