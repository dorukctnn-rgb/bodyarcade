// The theme schema: the ten classic worlds pass both the JSON Schema (for tools) and parseTheme (at runtime), the two
// agree on every single-field mutation, and bad data is refused with a message that names the field.
import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { parseTheme, PROP_KINDS, themeOrThrow, themeSignature, ThemeError, THEME_DEFAULTS, type Theme } from './theme.ts';

const read = (p: string): unknown => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const schema = read('./theme.schema.json') as object;
const worlds = read('./themes/classic-worlds.json') as Record<string, unknown>[];
const validate = new Ajv2020({ allErrors: true, strict: true, validateFormats: false }).compile(schema);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe('classic worlds', () => {
  it('are the ten worlds of the live game, in the live order', () => {
    expect(worlds.map((w) => w['id'])).toEqual(['alps', 'desert', 'forest', 'storm', 'sunset', 'arctic', 'jungle', 'city', 'volcano', 'coast']);
  });

  it.each(worlds.map((w) => [w['id'] as string, w] as const))('%s passes the JSON Schema and parseTheme', (_id, w) => {
    expect(validate(w), JSON.stringify(validate.errors)).toBe(true);
    const r = parseTheme(w);
    expect(r.ok, r.ok ? '' : r.errors.join('\n')).toBe(true);
  });

  it('only the first three are free (as live)', () => {
    expect(worlds.filter((w) => w['free'] === true).map((w) => w['id'])).toEqual(['alps', 'desert', 'forest']);
  });

  it('every prop kind used is built by the scenery code', () => {
    const used = new Set(worlds.flatMap((w) => (w['props'] as { kind: string }[]).map((p) => p.kind)));
    for (const k of used) expect(PROP_KINDS as readonly string[]).toContain(k);
  });
});

describe('parseTheme defaults', () => {
  it('fills in what a theme leaves out', () => {
    const r = parseTheme(worlds[0]);
    if (!r.ok) throw new Error(r.errors.join());
    const t = r.theme;
    expect(t.exposure).toBe(THEME_DEFAULTS.exposure);
    expect(t.road.width).toBe(5.6);
    expect(t.road.lanes).toBe(3);
    expect(t.road.wet).toBe(false);
    expect(t.sky.aurora).toBe(false);
    expect(t.weather).toBeNull();
    expect(t.lightning).toBe(false);
    expect(t.glow).toBeNull();
    expect(t.water).toBe(false);
    expect(t.props.every((p) => p.fixed === false)).toBe(true);
  });

  it('keeps explicit values (storm: exposure, wet road, rain, lightning)', () => {
    const t = themeOrThrow(worlds.find((w) => w['id'] === 'storm'));
    expect(t.exposure).toBe(1.3);
    expect(t.road.wet).toBe(true);
    expect(t.weather?.kind).toBe('rain');
    expect(t.weather?.count).toBe(900);
    expect(t.lightning).toBe(true);
  });

  it('coast keeps its rails as a regular row of props, not as a special case in code', () => {
    const t = themeOrThrow(worlds.find((w) => w['id'] === 'coast'));
    const rail = t.props.find((p) => p.kind === 'rail');
    expect(rail?.fixed).toBe(true);
    expect(t.water).toBe(true);
  });

  it('lets a game keep its own top-level fields', () => {
    const w = { ...clone(worlds[0]!), unlockedBy: 'free', skins: ['runner'] };
    expect(validate(w)).toBe(true);
    expect(parseTheme(w).ok).toBe(true);
  });

  it('a wider road with six lanes (two lanes of three, for two players) is allowed', () => {
    const w = clone(worlds[0]!) as { road: Record<string, unknown> };
    w.road['width'] = 11.2; w.road['lanes'] = 6;
    expect(validate(w)).toBe(true);
    const t = themeOrThrow(w);
    expect(t.road.width).toBe(11.2);
    expect(t.road.lanes).toBe(6);
  });
});

describe('parseTheme refuses bad data and says where', () => {
  const bad = (mutate: (w: Record<string, any>) => void): string[] => {
    const w = clone(worlds[0]!) as Record<string, any>;
    mutate(w);
    const r = parseTheme(w);
    if (r.ok) throw new Error('expected a refusal');
    return r.errors;
  };

  it('names the field', () => {
    expect(bad((w) => { w['fog'].color = 'blue'; })).toContain('/fog/color: must be a colour like #1a2b3c');
    expect(bad((w) => { w['fog'].density = -1; }).join()).toContain('/fog/density');
    expect(bad((w) => { delete w['sky']; })).toContain('/sky: required');
    expect(bad((w) => { w['props'][0].kind = 'unicorn'; }).join()).toContain('/props/0/kind');
    expect(bad((w) => { w['props'][0].side = [9, 3]; }).join()).toContain('/props/0/side: min must not be larger than max');
    expect(bad((w) => { w['id'] = 'Not Valid'; }).join()).toContain('/id');
  });

  it('reports every problem, not just the first', () => {
    const errors = bad((w) => { w['fog'].color = 'x'; w['ground'] = 5; delete w['road']; });
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });

  it('catches a typo inside a nested object', () => {
    expect(bad((w) => { w['fog'].dnesity = 0.01; }).join()).toContain('/fog/dnesity: unknown key');
  });

  it('refuses things that are not themes at all', () => {
    for (const v of [null, undefined, 5, 'alps', [], true]) expect(parseTheme(v).ok).toBe(false);
  });

  it('too many props', () => {
    expect(bad((w) => { w['props'] = Array.from({ length: 13 }, () => clone(worlds[0]!['props'] as unknown[])[0]); }).join()).toContain('/props');
  });

  it('themeOrThrow throws a ThemeError that carries the list', () => {
    try { themeOrThrow({ id: 'x' }); throw new Error('did not throw'); } catch (e) {
      expect(e).toBeInstanceOf(ThemeError);
      expect((e as ThemeError).errors.length).toBeGreaterThan(3);
      expect((e as ThemeError).message).toContain('Invalid theme');
    }
  });
});

describe('the JSON Schema and parseTheme agree', () => {
  // Every leaf of every world is replaced by values of the wrong type, and every key removed in turn. Both validators
  // must refuse the mutated theme, or both must accept it (an optional key that was removed).
  type Path = (string | number)[];
  const leaves = (v: unknown, path: Path, out: Path[]): void => {
    if (Array.isArray(v)) v.forEach((x, i) => leaves(x, [...path, i], out));
    else if (v !== null && typeof v === 'object') for (const k of Object.keys(v)) leaves((v as Record<string, unknown>)[k], [...path, k], out);
    else out.push(path);
  };
  const at = (root: unknown, path: Path): { parent: any; key: string | number } => {
    let cur: any = root;
    for (const k of path.slice(0, -1)) cur = cur[k];
    return { parent: cur, key: path[path.length - 1]! };
  };

  it('agree on every wrong-type mutation and every deletion of the ten worlds', () => {
    let checked = 0;
    for (const world of worlds) {
      const out: Path[] = [];
      leaves(world, [], out);
      for (const path of out) {
        for (const wrong of ['wrong', -999, true, null, {}, []] as unknown[]) {
          const w = clone(world);
          const { parent, key } = at(w, path);
          if (parent[key] === wrong) continue;
          // Unknown-key allowance at the top level means id/name/etc. behave as typed; mutate only checked fields.
          parent[key] = wrong;
          const a = validate(w) as boolean;
          const b = parseTheme(w).ok;
          // min <= max on pairs is checked by parseTheme only; skip the cases where only that rule differs.
          if (a !== b) {
            const pairCase = path.length >= 2 && (path[path.length - 2] === 'side' || path[path.length - 2] === 'scale');
            expect(pairCase && a && !b, `${String(world['id'])} ${path.join('.')} = ${JSON.stringify(wrong)}: schema ${a}, parser ${b}`).toBe(true);
          }
          checked++;
        }
        const d = clone(world);
        const { parent, key } = at(d, path);
        if (!Array.isArray(parent)) {
          delete parent[key];
          const a = validate(d) as boolean;
          const b = parseTheme(d).ok;
          expect(a, `${String(world['id'])} delete ${path.join('.')}: schema ${a}, parser ${b}`).toBe(b);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(2000);
  }, 60_000);
});

describe('themeSignature', () => {
  const t = (i = 0): Theme => themeOrThrow(worlds[i]);

  it('is stable and ignores metadata', () => {
    const a = t();
    const b = { ...a, name: 'Other name', tagline: 'Other', free: false };
    expect(themeSignature(a)).toBe(themeSignature(b));
    expect(themeSignature(t())).toBe(themeSignature(t()));
  });

  it('changes when anything visual changes', () => {
    const base = themeSignature(t());
    const c = t(); c.fog.density = 0.0131;
    expect(themeSignature(c)).not.toBe(base);
    const d = t(); d.props[0]!.every = 7.5;
    expect(themeSignature(d)).not.toBe(base);
    const e = t(); e.road.lanes = 6;
    expect(themeSignature(e)).not.toBe(base);
    expect(new Set(worlds.map((_w, i) => themeSignature(t(i)))).size).toBe(10);
  });

  it('does not depend on key order', () => {
    const a = t();
    const flip = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(flip);
      if (v !== null && typeof v === 'object') return Object.fromEntries(Object.keys(v).reverse().map((k) => [k, flip((v as Record<string, unknown>)[k])]));
      return v;
    };
    const reordered = flip(a) as Theme;
    expect(Object.keys(reordered)).not.toEqual(Object.keys(a));
    expect(themeSignature(reordered)).toBe(themeSignature(a));
  });
});
