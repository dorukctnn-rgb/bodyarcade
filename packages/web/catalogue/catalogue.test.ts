import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BodyRegion } from '../../core/types/index.ts';
import { REGION_IDS } from '../../core/ui/settings.ts';
import { copyProblems } from './copy.ts';
import { filterGames, gameById, gameBySlug, inRegion, orderForPlayer, proGames, regionCounts, relatedGames, supportsLocal2 } from './filter.ts';
import { loadCatalogue, repoRoot, tilesDir } from './load.ts';
import { checkCatalogue, checkEntry } from './validate.ts';
import type { GameEntry, ShellGame } from './types.ts';

const fixtures = loadCatalogue({ fixtures: 'only', requiredLangs: ['en', 'tr'] });
const games = fixtures.catalogue.games;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// A raw, valid entry to mutate in the negative tests.
const raw = (id = 'squat-flap'): GameEntry => {
  const g = gameById(games, id);
  if (!g) throw new Error(`no fixture ${id}`);
  return { ...clone(g), detectors: [{ id: 'squat' }] } as GameEntry;
};

describe('development fixtures', () => {
  it('load without a single problem, in English and Turkish', () => {
    expect(fixtures.problems).toEqual([]);
    expect(fixtures.catalogue.source).toBe('fixtures');
    expect(games).toHaveLength(11);
  });

  it('are in menu order 1 to 11 with unique ids, slugs and tiles', () => {
    expect(games.map((g) => g.catalogue.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(new Set(games.map((g) => g.id)).size).toBe(11);
    expect(new Set(games.map((g) => g.seo.slug)).size).toBe(11);
    expect(new Set(games.map((g) => g.catalogue.tile)).size).toBe(11);
  });

  it('match the art director: same eleven games, tiers and two-player flags as design/ui-kit/games.mjs, art for each', async () => {
    const d = (await import(/* @vite-ignore */ pathToFileURL(join(repoRoot(), 'design', 'ui-kit', 'games.mjs')).href)) as {
      GAMES: { id: string; region: string; tier: string; local2: boolean }[];
    };
    const art = (await import(/* @vite-ignore */ pathToFileURL(join(repoRoot(), 'design', 'art', 'tile-ids.mjs')).href)) as { TILE_IDS: string[] };
    expect(games.map((g) => g.id)).toEqual(d.GAMES.map((g) => g.id));
    for (const ref of d.GAMES) {
      const g = gameById(games, ref.id) as ShellGame;
      expect(g.free, `${ref.id} free`).toBe(ref.tier === 'free');
      expect(supportsLocal2(g), `${ref.id} local2`).toBe(ref.local2);
      const region = ref.region === 'balance' ? 'mobility' : ref.region;
      expect(g.regions, `${ref.id} region`).toContain(region);
      expect(art.TILE_IDS).toContain(g.catalogue.tile);
    }
    expect(tilesDir()).toContain('tiles');
  });

  it('use every body region the filter chips offer except the seated one, which is derived', () => {
    const used = new Set(games.flatMap((g) => g.regions));
    for (const r of REGION_IDS.filter((x) => x !== 'seated')) expect(used.has(r), r).toBe(true);
  });

  it('say only what the game really has: notes exist exactly when the variant exists', () => {
    for (const g of games) {
      expect(!!g.catalogue.seatedNote, `${g.id} seated`).toBe(g.seated);
      expect(!!g.catalogue.quietNote, `${g.id} quiet`).toBe(g.silentSafe);
    }
  });

  it('keep two-player games solo-capable, and never list modes the games do not have', () => {
    for (const g of games) {
      expect(g.modes).toContain('solo');
      expect(g.modes.every((m) => ['solo', 'ghost', 'duel', 'local2'].includes(m))).toBe(true);
    }
  });
});

describe('no real manifests yet is fine, and a published build never reads fixtures', () => {
  it('real manifests load cleanly', () => {
    const real = loadCatalogue({ fixtures: 'none', requiredLangs: ['en'] });
    expect(real.problems).toEqual([]);
    expect(real.catalogue.source).toBe('games');
  });

  it('every real game says what it is in the words of its page title, in English, and two games do not claim the same words', () => {
    const real = loadCatalogue({ fixtures: 'none', requiredLangs: ['en', 'tr'] }).catalogue.games;
    const kinds = real.map((g) => (typeof g.catalogue.kind === 'string' ? '' : g.catalogue.kind?.['en'] ?? ''));
    real.forEach((g, i) => expect(kinds[i], `${g.id} has a kind`).toMatch(/^(a|an) [a-z ]+ game$/));
    expect(new Set(kinds).size, 'each game its own words').toBe(real.length);
  });
});

describe('the schema and the rules refuse bad manifests', () => {
  const bad = (mutate: (e: Record<string, unknown>) => void, expected: RegExp, opts = {}) => {
    const e = raw() as unknown as Record<string, unknown>;
    mutate(e);
    const r = checkEntry(e, 'x.json', opts);
    expect(r.entry).toBeNull();
    expect(r.problems.map((p) => p.message).join('\n')).toMatch(expected);
  };

  it('accepts the unchanged entry', () => {
    expect(checkEntry(raw(), 'x.json', { requiredLangs: ['en', 'tr'] }).problems).toEqual([]);
  });

  it('refuses a missing required field, a wrong enum and a bad id', () => {
    bad((e) => { delete e['framing']; }, /framing/);
    bad((e) => { e['template'] = 'puzzle'; }, /template|allowed values/);
    bad((e) => { e['id'] = 'Squat Flap'; }, /pattern/);
    bad((e) => { (e['catalogue'] as Record<string, unknown>)['move'] = 'dance'; }, /allowed values/);
  });

  it('refuses a game without solo mode and a catalogue block with unknown keys', () => {
    bad((e) => { e['modes'] = ['local2']; }, /contain|valid/);
    bad((e) => { (e['catalogue'] as Record<string, unknown>)['hype'] = 'big'; }, /additional/);
  });

  it('refuses copy that breaks the house rules', () => {
    bad((e) => { (e['catalogue'] as Record<string, unknown>)['tagline'] = 'Squat — and fly'; }, /dash/);
    bad((e) => { (e['catalogue'] as Record<string, unknown>)['tagline'] = 'Squat and fly!'; }, /exclamation/);
    bad((e) => { (e['catalogue'] as Record<string, unknown>)['tagline'] = 'The ultimate squat game'; }, /hype word/);
    bad((e) => { (e['catalogue'] as Record<string, unknown>)['tagline'] = { en: 'Fly → higher' }; }, /arrow/);
  });

  it('refuses text that is too long', () => {
    bad((e) => { (e['catalogue'] as Record<string, unknown>)['tagline'] = 'x'.repeat(91); }, /limit is 90/);
  });

  it('refuses a missing translation only when the language is required', () => {
    const e = raw() as unknown as { catalogue: { tagline: Record<string, string> } };
    e.catalogue.tagline = { en: 'Squat and fly.' };
    expect(checkEntry(e, 'x.json', { requiredLangs: ['en'] }).problems).toEqual([]);
    expect(checkEntry(e, 'x.json', { requiredLangs: ['en', 'tr'] }).problems.map((p) => p.message)).toContain('tagline has no tr text');
  });

  it('takes the words of the page title ("a boxing workout game") per language, English alone required, with its article, and not too long', () => {
    const e = raw() as unknown as { catalogue: { kind?: unknown } };
    e.catalogue.kind = { en: 'a squat workout game' };
    expect(checkEntry(e, 'x.json', { requiredLangs: ['en', 'tr'] }).problems, 'English alone is enough, a language without its own words keeps the general title').toEqual([]);
    bad((x) => { (x['catalogue'] as Record<string, unknown>)['kind'] = 'a squat workout game'; }, /kind must say its words per language/);
    bad((x) => { (x['catalogue'] as Record<string, unknown>)['kind'] = { en: 'squat workout game' }; }, /starts with its article/);
    bad((x) => { (x['catalogue'] as Record<string, unknown>)['kind'] = { en: `a ${'squat '.repeat(8)}game` }; }, /kind \(en\) is \d+ characters, the limit is 36/);
    bad((x) => { (x['catalogue'] as Record<string, unknown>)['kind'] = { en: 'a squat workout game!' }; }, /exclamation/);
  });

  it('keeps variants honest', () => {
    bad((e) => { e['seated'] = false; }, /seatedNote on a game without/);
    bad((e) => { delete (e['catalogue'] as Record<string, unknown>)['quietNote']; }, /no quietNote/);
  });

  it('finds duplicate slugs and orders, and lets a game name related games that are not built yet', () => {
    const a = raw('squat-flap');
    const b = raw('knee-sprint');
    b.catalogue.order = a.catalogue.order;
    b.seo.slug = a.seo.slug;
    const r = checkCatalogue([{ label: 'a', data: a }, { label: 'b', data: b }]);
    const text = r.problems.map((p) => p.message).join('\n');
    expect(text).toMatch(/slug squat-flap is also used/);
    expect(text).toMatch(/order 1 is also used/);
    expect(text).not.toMatch(/related/);
  });

  it('wants the tile art to exist when asked', () => {
    const e = raw();
    e.catalogue.tile = 'no-such-art';
    expect(checkEntry(e, 'x.json', { tilesDir: tilesDir() }).problems.map((p) => p.message)).toContain('tile art no-such-art.webp is missing');
  });
});

describe('copy rules', () => {
  it('pass plain sentences, including Turkish', () => {
    expect(copyProblems('Squat low and the bird glides.')).toEqual([]);
    expect(copyProblems('Alçak çömelin, kuş süzülsün.')).toEqual([]);
  });
  it('catch the usual tells', () => {
    expect(copyProblems('one – two')).toHaveLength(1);
    expect(copyProblems('two  spaces')).toContain('has a double space');
    expect(copyProblems(' padded')).toContain('has leading or trailing space');
    expect(copyProblems('go -> there')).toContain('uses an arrow');
    expect(copyProblems('fire \u{1F525}')).toContain('uses an emoji or pictograph');
  });
});

describe('filtering the menu', () => {
  const ids = (list: readonly ShellGame[]): string[] => list.map((g) => g.id);

  it('shows everything with no filter, in catalogue order', () => {
    const r = filterGames(games, { regions: [], seated: false, quiet: false });
    expect(ids(r.shown)).toEqual(ids(games));
    expect(r.hiddenByModes).toBe(0);
  });

  it('picks games by any chosen region', () => {
    const legs = filterGames(games, { regions: ['legs'], seated: false, quiet: false });
    expect(ids(legs.shown)).toEqual(['squat-flap', 'knee-sprint', 'road-run']);
    const two = filterGames(games, { regions: ['core', 'chest-back'], seated: false, quiet: false });
    expect(ids(two.shown).sort()).toEqual(['limbo-bend', 'pad-work', 'summit-climb', 'twist-turbine']);
  });

  it('the seated region holds every game that has a seated version', () => {
    const seated = filterGames(games, { regions: ['seated'], seated: false, quiet: false });
    expect(seated.shown).toHaveLength(games.filter((g) => g.seated).length);
  });

  it('quiet mode hides the games that need jumping or stamping and counts them', () => {
    const r = filterGames(games, { regions: [], seated: false, quiet: true });
    expect(ids(r.shown)).not.toContain('knee-sprint');
    expect(ids(r.shown)).not.toContain('road-run');
    expect(r.hiddenByModes).toBe(2);
  });

  it('counts only hidden games that fit the chosen regions', () => {
    const r = filterGames(games, { regions: ['legs'], seated: false, quiet: true });
    expect(ids(r.shown)).toEqual(['squat-flap']);
    expect(r.hiddenByModes).toBe(2);
  });

  it('seated mode hides games without a seated version', () => {
    const noSeated: ShellGame = { ...(games[0] as ShellGame), id: 'standing-only', seated: false };
    const r = filterGames([...games, noSeated], { regions: [], seated: true, quiet: false });
    expect(ids(r.shown)).not.toContain('standing-only');
    expect(r.hiddenByModes).toBe(1);
  });

  it('puts the games of the chosen regions first and keeps order inside each group', () => {
    const o = orderForPlayer(games, ['arms']);
    const arms = games.filter((g) => inRegion(g, 'arms')).map((g) => g.id);
    expect(ids(o).slice(0, arms.length)).toEqual(arms);
    expect(ids(orderForPlayer(games, []))).toEqual(ids(games));
  });

  it('counts games per region for the chips and leaves out empty regions', () => {
    const order: BodyRegion[] = ['legs', 'arms', 'chest-back', 'core', 'cardio', 'mobility', 'seated'];
    const c = regionCounts(games, order);
    expect(c.find((x) => x.region === 'legs')?.count).toBe(3);
    expect(regionCounts(games.filter((g) => g.id === 'squat-flap'), order).map((x) => x.region)).toEqual(['legs', 'seated']);
  });

  it('suggests named related games first, then the same region, never the game itself', () => {
    const g = gameById(games, 'squat-flap') as ShellGame;
    const rel = relatedGames(g, games, 3);
    expect(ids(rel)).toEqual(['knee-sprint', 'road-run', ...ids(rel).slice(2)]);
    expect(ids(rel)).not.toContain('squat-flap');
    expect(rel).toHaveLength(3);
  });

  it('finds games by slug and id and lists the Pro ones', () => {
    expect(gameBySlug(games, 'pad-work')?.id).toBe('pad-work');
    expect(gameBySlug(games, 'nope')).toBeUndefined();
    expect(ids(proGames(games))).toEqual(['pad-work', 'reaction-tag', 'limbo-bend']);
  });
});
