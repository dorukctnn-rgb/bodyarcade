// World themes as data (code-audit.md 11.3: worlds.js becomes worlds.json "against the theme schema").
//
// A theme says everything the 3D kit needs to build a world: sky gradient, sun, fog, ground and road tints, the
// horizon silhouette, the prop set and the weather. It carries no code. theme.schema.json is the JSON Schema of the
// same shape (for tools and for the games' content tests); parseTheme is the runtime check with the defaults
// filled in. theme.test.ts keeps the two in step.
import type { ThemeData } from '../types/index.ts';

export const PROP_KINDS = [
  'pine', 'tree', 'jungletree', 'bush', 'fern', 'rock', 'ice', 'cactus', 'dune', 'palm',
  'lamp', 'building', 'tuft', 'post', 'rail', 'buoy', 'lava',
] as const;
export type PropKind = (typeof PROP_KINDS)[number];

export const HORIZON_KINDS = ['mountains', 'dunes', 'forest', 'skyline', 'islands', 'hills'] as const;
export type HorizonKind = (typeof HORIZON_KINDS)[number];

export const WEATHER_KINDS = ['dust', 'leaves', 'rain', 'snow', 'embers'] as const;
export type WeatherKind = (typeof WEATHER_KINDS)[number];

/** '#rgb' or '#rrggbb'. */
export type Hex = string;

export interface PropDef {
  kind: PropKind;
  /** Metres between two props on one side of the road (the density). */
  every: number;
  /** Distance from the road centre line, min and max (metres). */
  side: [number, number];
  /** Random scale, min and max. */
  scale: [number, number];
  tint: Hex | null;
  /** Pines: snow on the top. */
  snow: boolean;
  /** No random offset, scale or turn: a regular row (rails, posts). Placed in the middle of each interval. */
  fixed: boolean;
}

export interface WeatherDef {
  kind: WeatherKind;
  count: number;
  color: Hex;
  size: number;
  opacity: number;
  /** Fall speed, metres per second (negative rises: embers). */
  fall: number;
  /** Sideways sway, metres per second. */
  drift: number;
}

/** A theme with every default filled in. */
export interface Theme {
  id: string;
  name?: string;
  tagline?: string;
  free?: boolean;
  exposure: number;
  ambient: Hex;
  ambientIntensity: number;
  sky: { top: Hex; mid: Hex; bot: Hex; sunGlow: Hex; stars: number; clouds: Hex | null; aurora: boolean };
  sun: { color: Hex; intensity: number; pos: [number, number, number] };
  hemi: { sky: Hex; ground: Hex; intensity: number };
  fog: { color: Hex; density: number };
  ground: Hex;
  groundNoise: Hex;
  /** A causeway over water: the ground plane sits lower and shines. */
  water: boolean;
  road: { base: Hex; edge: Hex; line: Hex; center: Hex; wet: boolean; width: number; lanes: number };
  horizon: { kind: HorizonKind; colorFar: Hex; colorNear: Hex; snow: boolean };
  props: PropDef[];
  weather: WeatherDef | null;
  /** Flashes of lightning (a brief sky and fill-light flash; no extra light source). */
  lightning: boolean;
  /** A warm pulse in the fill light (volcano). No point light: those cost every fragment. */
  glow: Hex | null;
  accent: Hex;
  coin: Hex;
}

export type ThemeParse = { ok: true; theme: Theme } | { ok: false; errors: string[] };

export const THEME_DEFAULTS = {
  exposure: 1.05,
  ambient: '#9db0cc',
  ambientIntensity: 0.5,
  roadWidth: 5.6,
  roadLanes: 3,
  accent: '#ffc93c',
  coin: '#ffd166',
} as const;

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Limits shared with theme.schema.json. */
export const THEME_LIMITS = {
  exposure: [0.3, 3], ambientIntensity: [0, 3], stars: [0, 1], sunIntensity: [0, 10], sunPos: [-200, 200],
  hemiIntensity: [0, 5], density: [0.001, 0.1], roadWidth: [3, 16], roadLanes: [1, 8], every: [0.5, 60],
  side: [0, 60], scale: [0.1, 4], weatherCount: [1, 2000], weatherSize: [0.01, 2], opacity: [0, 1],
  fall: [-30, 40], drift: [-10, 10], maxProps: 12, name: 60, tagline: 120,
} as const;

class Errors {
  readonly list: string[] = [];
  add(path: string, msg: string): void { this.list.push(`${path || '/'}: ${msg}`); }
}

function strictKeys(e: Errors, path: string, v: Record<string, unknown>, allowed: readonly string[]): void {
  for (const k of Object.keys(v)) if (!allowed.includes(k)) e.add(`${path}/${k}`, 'unknown key');
}

function hexAt(e: Errors, path: string, v: unknown, required: boolean): Hex | undefined {
  if (v === undefined) { if (required) e.add(path, 'required'); return undefined; }
  if (typeof v !== 'string' || !HEX.test(v)) { e.add(path, 'must be a colour like #1a2b3c'); return undefined; }
  return v;
}

function numAt(e: Errors, path: string, v: unknown, range: readonly [number, number], required: boolean, int = false): number | undefined {
  if (v === undefined) { if (required) e.add(path, 'required'); return undefined; }
  if (typeof v !== 'number' || !Number.isFinite(v) || v < range[0] || v > range[1] || (int && !Number.isInteger(v))) {
    e.add(path, `must be ${int ? 'an integer' : 'a number'} from ${range[0]} to ${range[1]}`);
    return undefined;
  }
  return v;
}

function boolAt(e: Errors, path: string, v: unknown): boolean | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'boolean') { e.add(path, 'must be true or false'); return undefined; }
  return v;
}

function pairAt(e: Errors, path: string, v: unknown, range: readonly [number, number]): [number, number] | undefined {
  if (!Array.isArray(v) || v.length !== 2) { e.add(path, 'must be a pair [min, max]'); return undefined; }
  const a = numAt(e, `${path}/0`, v[0], range, true), b = numAt(e, `${path}/1`, v[1], range, true);
  if (a === undefined || b === undefined) return undefined;
  if (a > b) { e.add(path, 'min must not be larger than max'); return undefined; }
  return [a, b];
}

function objAt(e: Errors, path: string, v: unknown, allowed: readonly string[]): Record<string, unknown> | undefined {
  if (!isObj(v)) { e.add(path, v === undefined ? 'required' : 'must be an object'); return undefined; }
  strictKeys(e, path, v, allowed);
  return v;
}

function parseProp(e: Errors, path: string, raw: unknown): PropDef | undefined {
  const v = objAt(e, path, raw, ['kind', 'every', 'side', 'scale', 'tint', 'snow', 'fixed']);
  if (!v) return undefined;
  const kind = v['kind'];
  if (typeof kind !== 'string' || !(PROP_KINDS as readonly string[]).includes(kind)) e.add(`${path}/kind`, `must be one of ${PROP_KINDS.join(', ')}`);
  const every = numAt(e, `${path}/every`, v['every'], THEME_LIMITS.every, true);
  const side = v['side'] === undefined ? (e.add(`${path}/side`, 'required'), undefined) : pairAt(e, `${path}/side`, v['side'], THEME_LIMITS.side);
  const scale = v['scale'] === undefined ? (e.add(`${path}/scale`, 'required'), undefined) : pairAt(e, `${path}/scale`, v['scale'], THEME_LIMITS.scale);
  const tint = hexAt(e, `${path}/tint`, v['tint'], false);
  const snow = boolAt(e, `${path}/snow`, v['snow']);
  const fixed = boolAt(e, `${path}/fixed`, v['fixed']);
  if (typeof kind !== 'string' || every === undefined || !side || !scale) return undefined;
  return { kind: kind as PropKind, every, side, scale, tint: tint ?? null, snow: snow ?? false, fixed: fixed ?? false };
}

function parseWeather(e: Errors, path: string, raw: unknown): WeatherDef | null | undefined {
  if (raw === undefined || raw === null) return null;
  const v = objAt(e, path, raw, ['kind', 'count', 'color', 'size', 'opacity', 'fall', 'drift']);
  if (!v) return undefined;
  const kind = v['kind'];
  if (typeof kind !== 'string' || !(WEATHER_KINDS as readonly string[]).includes(kind)) e.add(`${path}/kind`, `must be one of ${WEATHER_KINDS.join(', ')}`);
  const count = numAt(e, `${path}/count`, v['count'], THEME_LIMITS.weatherCount, true, true);
  const color = hexAt(e, `${path}/color`, v['color'], true);
  const size = numAt(e, `${path}/size`, v['size'], THEME_LIMITS.weatherSize, true);
  const opacity = numAt(e, `${path}/opacity`, v['opacity'], THEME_LIMITS.opacity, true);
  const fall = numAt(e, `${path}/fall`, v['fall'], THEME_LIMITS.fall, true);
  const drift = numAt(e, `${path}/drift`, v['drift'], THEME_LIMITS.drift, true);
  if (typeof kind !== 'string' || count === undefined || color === undefined || size === undefined || opacity === undefined || fall === undefined || drift === undefined) return undefined;
  return { kind: kind as WeatherKind, count, color, size, opacity, fall, drift };
}

/** Validates a theme and returns it with every default filled in, or every problem found (not just the first). */
export function parseTheme(raw: unknown): ThemeParse {
  const e = new Errors();
  if (!isObj(raw)) return { ok: false, errors: ['/: a theme must be an object'] };

  const id = raw['id'];
  if (typeof id !== 'string' || !ID.test(id)) e.add('/id', 'must be a lowercase id of letters, digits and dashes (up to 32)');
  const name = raw['name'], tagline = raw['tagline'];
  if (name !== undefined && (typeof name !== 'string' || name.length > THEME_LIMITS.name)) e.add('/name', `must be text of at most ${THEME_LIMITS.name} characters`);
  if (tagline !== undefined && (typeof tagline !== 'string' || tagline.length > THEME_LIMITS.tagline)) e.add('/tagline', `must be text of at most ${THEME_LIMITS.tagline} characters`);
  const free = boolAt(e, '/free', raw['free']);
  const exposure = numAt(e, '/exposure', raw['exposure'], THEME_LIMITS.exposure, false);
  const ambient = hexAt(e, '/ambient', raw['ambient'], false);
  const ambientIntensity = numAt(e, '/ambientIntensity', raw['ambientIntensity'], THEME_LIMITS.ambientIntensity, false);

  const sk = objAt(e, '/sky', raw['sky'], ['top', 'mid', 'bot', 'sunGlow', 'stars', 'clouds', 'aurora']);
  const sky = sk && {
    top: hexAt(e, '/sky/top', sk['top'], true), mid: hexAt(e, '/sky/mid', sk['mid'], true), bot: hexAt(e, '/sky/bot', sk['bot'], true),
    sunGlow: hexAt(e, '/sky/sunGlow', sk['sunGlow'], true), stars: numAt(e, '/sky/stars', sk['stars'], THEME_LIMITS.stars, false),
    clouds: hexAt(e, '/sky/clouds', sk['clouds'], false), aurora: boolAt(e, '/sky/aurora', sk['aurora']),
  };

  const sn = objAt(e, '/sun', raw['sun'], ['color', 'intensity', 'pos']);
  let sunPos: [number, number, number] | undefined;
  if (sn) {
    const p = sn['pos'];
    if (!Array.isArray(p) || p.length !== 3) e.add('/sun/pos', 'must be [x, y, z]');
    else {
      const c = p.map((x, i) => numAt(e, `/sun/pos/${i}`, x, THEME_LIMITS.sunPos, true));
      if (c.every((x) => x !== undefined)) sunPos = c as [number, number, number];
    }
  }
  const sun = sn && { color: hexAt(e, '/sun/color', sn['color'], true), intensity: numAt(e, '/sun/intensity', sn['intensity'], THEME_LIMITS.sunIntensity, true), pos: sunPos };

  const hm = objAt(e, '/hemi', raw['hemi'], ['sky', 'ground', 'intensity']);
  const hemi = hm && { sky: hexAt(e, '/hemi/sky', hm['sky'], true), ground: hexAt(e, '/hemi/ground', hm['ground'], true), intensity: numAt(e, '/hemi/intensity', hm['intensity'], THEME_LIMITS.hemiIntensity, true) };

  const fg = objAt(e, '/fog', raw['fog'], ['color', 'density']);
  const fog = fg && { color: hexAt(e, '/fog/color', fg['color'], true), density: numAt(e, '/fog/density', fg['density'], THEME_LIMITS.density, true) };

  const ground = hexAt(e, '/ground', raw['ground'], true);
  const groundNoise = hexAt(e, '/groundNoise', raw['groundNoise'], true);
  const water = boolAt(e, '/water', raw['water']);

  const rd = objAt(e, '/road', raw['road'], ['base', 'edge', 'line', 'center', 'wet', 'width', 'lanes']);
  const road = rd && {
    base: hexAt(e, '/road/base', rd['base'], true), edge: hexAt(e, '/road/edge', rd['edge'], true), line: hexAt(e, '/road/line', rd['line'], true),
    center: hexAt(e, '/road/center', rd['center'], true), wet: boolAt(e, '/road/wet', rd['wet']),
    width: numAt(e, '/road/width', rd['width'], THEME_LIMITS.roadWidth, false), lanes: numAt(e, '/road/lanes', rd['lanes'], THEME_LIMITS.roadLanes, false, true),
  };

  const hz = objAt(e, '/horizon', raw['horizon'], ['kind', 'colorFar', 'colorNear', 'snow']);
  let hzKind: HorizonKind | undefined;
  if (hz) {
    const k = hz['kind'];
    if (typeof k !== 'string' || !(HORIZON_KINDS as readonly string[]).includes(k)) e.add('/horizon/kind', `must be one of ${HORIZON_KINDS.join(', ')}`);
    else hzKind = k as HorizonKind;
  }
  const horizon = hz && { kind: hzKind, colorFar: hexAt(e, '/horizon/colorFar', hz['colorFar'], true), colorNear: hexAt(e, '/horizon/colorNear', hz['colorNear'], true), snow: boolAt(e, '/horizon/snow', hz['snow']) };

  let props: PropDef[] | undefined;
  const rp = raw['props'];
  if (!Array.isArray(rp)) e.add('/props', rp === undefined ? 'required' : 'must be a list');
  else if (rp.length > THEME_LIMITS.maxProps) e.add('/props', `at most ${THEME_LIMITS.maxProps} props`);
  else {
    const list = rp.map((p, i) => parseProp(e, `/props/${i}`, p));
    if (list.every((p) => p !== undefined)) props = list as PropDef[];
  }

  const weather = parseWeather(e, '/weather', raw['weather']);
  const lightning = boolAt(e, '/lightning', raw['lightning']);
  const glow = hexAt(e, '/glow', raw['glow'], false);
  const accent = hexAt(e, '/accent', raw['accent'], false);
  const coin = hexAt(e, '/coin', raw['coin'], false);

  if (e.list.length) return { ok: false, errors: e.list };

  // Everything required has been checked above; the assertions below only narrow types.
  const s = sky!, su = sun!, he = hemi!, fo = fog!, ro = road!, ho = horizon!;
  const theme: Theme = {
    id: id as string,
    ...(typeof name === 'string' ? { name } : {}),
    ...(typeof tagline === 'string' ? { tagline } : {}),
    ...(free !== undefined ? { free } : {}),
    exposure: exposure ?? THEME_DEFAULTS.exposure,
    ambient: ambient ?? THEME_DEFAULTS.ambient,
    ambientIntensity: ambientIntensity ?? THEME_DEFAULTS.ambientIntensity,
    sky: { top: s.top!, mid: s.mid!, bot: s.bot!, sunGlow: s.sunGlow!, stars: s.stars ?? 0, clouds: s.clouds ?? null, aurora: s.aurora ?? false },
    sun: { color: su.color!, intensity: su.intensity!, pos: su.pos! },
    hemi: { sky: he.sky!, ground: he.ground!, intensity: he.intensity! },
    fog: { color: fo.color!, density: fo.density! },
    ground: ground!, groundNoise: groundNoise!, water: water ?? false,
    road: { base: ro.base!, edge: ro.edge!, line: ro.line!, center: ro.center!, wet: ro.wet ?? false, width: ro.width ?? THEME_DEFAULTS.roadWidth, lanes: ro.lanes ?? THEME_DEFAULTS.roadLanes },
    horizon: { kind: ho.kind!, colorFar: ho.colorFar!, colorNear: ho.colorNear!, snow: ho.snow ?? false },
    props: props!,
    weather: weather ?? null,
    lightning: lightning ?? false,
    glow: glow ?? null,
    accent: accent ?? THEME_DEFAULTS.accent,
    coin: coin ?? THEME_DEFAULTS.coin,
  };
  return { ok: true, theme };
}

/** Like parseTheme but throws one readable error. For code that was handed data it cannot continue without. */
export class ThemeError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`Invalid theme: ${errors.slice(0, 5).join('; ')}${errors.length > 5 ? ` (and ${errors.length - 5} more)` : ''}`);
    this.name = 'ThemeError';
    this.errors = errors;
  }
}

export function themeOrThrow(raw: ThemeData | unknown): Theme {
  const r = parseTheme(raw);
  if (!r.ok) throw new ThemeError(r.errors);
  return r.theme;
}

/** Stable text for "is this the same world?": key order and metadata do not matter, every visual value does. */
export function themeSignature(t: Theme): string {
  const strip = ({ name: _n, tagline: _t, free: _f, ...visual }: Theme): unknown => visual;
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (isObj(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm(v[k])]));
    return v;
  };
  const text = JSON.stringify(norm(strip(t)));
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return `${t.id}:${h.toString(16)}:${text.length}`;
}
