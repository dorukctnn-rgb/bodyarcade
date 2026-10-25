// The world picker of Road Run on its game page: ten worlds with their real names and a picture drawn from each world's own
// theme, three free and seven Pro. Who may start which world, what the choice does to the setup, the play address and the
// options a round is started with. The same rules, end to end through the real page, are in e2e-real/worlds.spec.ts.
import { describe, expect, it } from 'vitest';
import { canUse } from '../../core/entitlements/features.ts';
import { textOf } from '../../core/ui/html.ts';
import type { Lang } from '../../core/ui/i18n/index.ts';
import { DEFAULT_SETTINGS } from '../../core/ui/settings.ts';
import { ROAD_RUN_WORLDS } from '../../games/road-run/worlds.ts';
import { copyProblems } from '../catalogue/copy.ts';
import { loadCatalogue } from '../catalogue/load.ts';
import type { ShellGame } from '../catalogue/types.ts';
import { makeContext, type ContextInit } from './make-context.ts';
import { EMPTY_STATE, renderPage } from './pages.ts';
import { router } from './routes.ts';
import { defaultSetup, lockedChoice, playHref, sanitizeSetup, sessionOptionsOf, setupFromForm, setupFromQuery } from './views/setup.ts';
import { defaultWorld, worldAllowed, worldLocked, worldPicker, worldsOf } from './views/worlds.ts';
import { worldArt } from './views/world-art.ts';

const games = loadCatalogue({ fixtures: 'only', requiredLangs: ['en', 'tr'] }).catalogue.games;
const road = games.find((g) => g.id === 'road-run') as ShellGame;
const squat = games.find((g) => g.id === 'squat-flap') as ShellGame;
const IDS = ROAD_RUN_WORLDS.map((w) => w.id);
const FREE_IDS = ROAD_RUN_WORLDS.filter((w) => w.free).map((w) => w.id);

const ctxOf = (o: Partial<ContextInit> = {}) => makeContext({ lang: 'en', games, url: '/games/road-run/', ...o });
const free = (o: Partial<ContextInit> = {}) => ctxOf({ plan: 'free', ...o });
const pro = (o: Partial<ContextInit> = {}) => ctxOf({ plan: 'pro', ...o });

function page(lang: Lang, o: Partial<ContextInit> = {}): string {
  const url = `${lang === 'en' ? '' : `/${lang}`}/games/road-run/`;
  const ctx = makeContext({ lang, games, url, ...o });
  return renderPage(ctx, router.match(url), EMPTY_STATE).body.value;
}

/** The radio buttons of the picker, as the page draws them. */
function tiles(html: string): { value: string; checked: boolean; locked: boolean; label: string }[] {
  return [...html.matchAll(/<label class="k-world( is-locked)?"><input type="radio" name="world" value="([^"]+)"([^>]*)>([\s\S]*?)<\/label>/g)].map((m) => ({
    value: m[2] as string, checked: /\schecked/.test(m[3] as string), locked: m[1] !== undefined, label: textOf(m[4] as string).replace(/\s+/g, ' ').trim(),
  }));
}

describe('who may play which world', () => {
  it('a free player may play the three free worlds and no other, a Pro player all ten: the entitlements decide', () => {
    expect(worldsOf(road)).toHaveLength(10);
    for (const id of IDS) {
      expect(worldAllowed(free(), id), `free ${id}`).toBe(FREE_IDS.includes(id));
      expect(worldAllowed(pro(), id), `pro ${id}`).toBe(true);
      expect(worldAllowed(free(), id)).toBe(canUse(`world:${id}`, { plan: 'free', source: 'none' }));
    }
    for (const plan of ['pro', 'family', 'lifetime'] as const) for (const id of IDS) expect(worldAllowed(ctxOf({ plan }), id), `${plan} ${id}`).toBe(true);
  });

  it('a game without worlds has none, and no state of it carries one', () => {
    expect(worldsOf(squat)).toEqual([]);
    expect(defaultWorld(pro(), squat)).toBeUndefined();
    expect(sanitizeSetup(pro(), squat, { ...defaultSetup(pro(), squat), world: 'storm' }).world).toBeUndefined();
    expect(worldLocked(free(), squat, 'storm')).toBe(false);
  });

  it('a Pro player can start every one of the ten worlds; a free player can start only the three free ones', () => {
    for (const id of IDS) {
      const asked = new URLSearchParams({ world: id });
      const p = pro();
      const proState = setupFromQuery(p, road, asked);
      expect(proState.world, `pro ${id}`).toBe(id);
      expect(lockedChoice(p, road, { ...proState, world: id })).toBeNull();
      expect(sessionOptionsOf(proState, 'solo').world, `pro round ${id}`).toBe(id);
      expect(playHref(p, road, proState)).toContain(`world=${id}`);

      const f = free();
      const freeState = setupFromQuery(f, road, asked);
      if (FREE_IDS.includes(id)) {
        expect(freeState.world, `free ${id}`).toBe(id);
        expect(lockedChoice(f, road, freeState)).toBeNull();
      } else {
        // The address of a Pro world, opened by a free player, plays the free default instead; the page opens the offer for the click.
        expect(freeState.world, `free ${id}`).toBe('alps');
        expect(lockedChoice(f, road, { ...freeState, world: id }), `free ${id}`).toBe('world');
        expect(sessionOptionsOf(freeState, 'solo').world, `free round ${id}`).toBe('alps');
      }
    }
  });

  it('a Pro difficulty is still a locked choice of its own, and a free choice is none', () => {
    const f = free();
    const base = defaultSetup(f, road);
    expect(lockedChoice(f, road, { ...base, difficulty: 'hard' })).toBe('difficulty');
    expect(lockedChoice(f, road, { ...base, world: 'desert' })).toBeNull();
    expect(lockedChoice(pro(), road, { ...base, difficulty: 'expert', world: 'volcano' })).toBeNull();
  });
});

describe('the default world and the one played last', () => {
  it('is the first free world when nothing was played, and the last world when the player may still play it', () => {
    expect(defaultSetup(free(), road).world).toBe('alps');
    expect(defaultSetup(pro(), road).world).toBe('alps');
    expect(defaultSetup(pro({ settings: { worlds: { 'road-run': 'volcano' } } }), road).world).toBe('volcano');
    expect(defaultSetup(free({ settings: { worlds: { 'road-run': 'forest' } } }), road).world).toBe('forest');
  });

  it('falls back to a free world when the last one is not the player to play any more (Pro ended) or no longer exists', () => {
    expect(defaultSetup(free({ settings: { worlds: { 'road-run': 'volcano' } } }), road).world).toBe('alps');
    expect(defaultSetup(pro({ settings: { worlds: { 'road-run': 'atlantis' } } }), road).world).toBe('alps');
  });

  it('is kept per game on this device, and damaged values are dropped by the settings', () => {
    expect(DEFAULT_SETTINGS.worlds).toEqual({});
  });
});

describe('the choice in the setup, the play address and the form', () => {
  it('goes into the play address and comes back from it', () => {
    const p = pro();
    const s = { ...defaultSetup(p, road), world: 'jungle' };
    const href = playHref(p, road, s);
    expect(href).toMatch(/^\/play\/road-run\/\?/);
    const back = setupFromQuery(p, road, new URL(href, 'https://x.test').searchParams);
    expect(back.world).toBe('jungle');
    expect(back).toEqual(s);
  });

  it('is read from the game page form, and a world that is not offered is replaced by the default', () => {
    const p = pro();
    const prev = defaultSetup(p, road);
    const form = (world: string): FormData => { const f = new FormData(); f.set('world', world); f.set('difficulty', 'normal'); return f; };
    expect(setupFromForm(p, road, form('coast'), prev).world).toBe('coast');
    expect(sanitizeSetup(p, road, setupFromForm(p, road, form('<script>'), prev)).world).toBe('alps');
  });

  it('is part of the options a round is started with, and only when the game has worlds', () => {
    const s = { ...defaultSetup(pro(), road), world: 'city' };
    expect(sessionOptionsOf(s, 'solo')).toEqual({ mode: 'solo', difficulty: 'normal', input: s.input, seated: s.seated, world: 'city' });
    const { world: _w, ...none } = s;
    expect('world' in sessionOptionsOf(none, 'solo')).toBe(false);
    expect('world' in sessionOptionsOf(defaultSetup(pro(), squat), 'solo')).toBe(false);
  });
});

describe('the picker on the game page', () => {
  it.each(['en', 'tr'] as const)('%s: ten radio buttons named world, the real names, the first free one checked', (lang) => {
    const html = page(lang);
    const t = tiles(html);
    expect(t.map((x) => x.value)).toEqual(IDS);
    expect(t.filter((x) => x.checked).map((x) => x.value)).toEqual(['alps']);
    for (const [i, w] of ROAD_RUN_WORLDS.entries()) {
      const name = (w.name as Record<string, string>)[lang] as string;
      expect(t[i]?.label.startsWith(name), `${lang} ${w.id}`).toBe(true);
    }
    expect(html).toContain('data-key="world-storm"');
    expect(html).toContain(lang === 'en' ? '<legend class="k-label">World</legend>' : '<legend class="k-label">Dünya</legend>');
  });

  it('shows a lock on the seven Pro worlds for a free player, says so for a screen reader, and says how many are free', () => {
    const html = page('en', { plan: 'free' });
    const t = tiles(html);
    expect(t.filter((x) => x.locked).map((x) => x.value)).toEqual(IDS.filter((id) => !FREE_IDS.includes(id)));
    expect(t.find((x) => x.value === 'storm')?.label).toBe('Storm (Pro)');
    expect(t.find((x) => x.value === 'alps')?.label).toBe('Alps');
    expect(textOf(html)).toContain('3 of 10 worlds are free. The others are part of Pro.');
    expect((html.match(/class="wlock"/g) ?? []).length).toBe(7);
  });

  it('shows no lock to a Pro player, and no sentence about what is free', () => {
    const html = page('en', { plan: 'pro' });
    const t = tiles(html);
    expect(t.some((x) => x.locked)).toBe(false);
    expect(html).not.toContain('class="wlock"');
    expect(textOf(html)).not.toContain('worlds are free');
    expect(t.find((x) => x.value === 'storm')?.label).toBe('Storm');
  });

  it('opens on the last world played, and the line under the tiles names the chosen world with its own words', () => {
    const html = page('en', { plan: 'pro', settings: { worlds: { 'road-run': 'storm' } } });
    expect(tiles(html).filter((x) => x.checked).map((x) => x.value)).toEqual(['storm']);
    expect(textOf(html)).toContain('Storm Rain on the asphalt and lightning on the ridge.');
    const tr = page('tr', { plan: 'pro', settings: { worlds: { 'road-run': 'storm' } } });
    expect(textOf(tr)).toContain('Fırtına Asfaltta yağmur, sırtta şimşek.');
  });

  it('is a labelled group: a legend, a description tied to the group, unique ids', () => {
    const html = page('en');
    expect(html).toMatch(/<fieldset class="ba-fieldset k-block k-worlds" aria-describedby="setup-world-hint">\s*<legend class="k-label">World<\/legend>/);
    expect(html.match(/id="setup-world-hint"/g)).toHaveLength(1);
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('hides its pictures from assistive technology, keeps them inside their box, and holds nothing but the theme\'s own colours', () => {
    const svgs = [...page('en').matchAll(/<svg class="wa"[\s\S]*?<\/svg>/g)].map((m) => m[0]);
    expect(svgs).toHaveLength(10);
    for (const svg of svgs) {
      expect(svg).toContain('aria-hidden="true"');
      expect(svg).toContain('viewBox="0 0 160 100"');
      expect(svg).not.toMatch(/<script|onload|href=/i);
      expect(svg).not.toMatch(/NaN|undefined/);
    }
    // two worlds never share a gradient id
    const gradients = [...page('en').matchAll(/<(?:linear|radial)Gradient id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(gradients).size).toBe(gradients.length);
  });

  it('draws each world from its own look: the sky colours of the theme are in its picture', () => {
    for (const w of ROAD_RUN_WORLDS) {
      const svg = worldArt(w.look).value;
      expect(svg, w.id).toContain(w.look.sky.top);
      expect(svg, w.id).toContain(w.look.road.base);
      if (w.look.weather) expect(svg, w.id).toContain(w.look.weather.color);
    }
    expect(new Set(ROAD_RUN_WORLDS.map((w) => worldArt(w.look).value)).size).toBe(10);
  });

  it('is not on the page of a game without worlds', () => {
    const ctx = ctxOf({ plan: 'pro', url: '/games/squat-flap/' });
    expect(worldPicker(ctx, squat, undefined).value).toBe('');
    const html = renderPage(ctx, router.match('/games/squat-flap/'), EMPTY_STATE).body.value;
    expect(html).not.toContain('name="world"');
    expect(html).not.toContain('k-worldgrid');
  });

  it('uses words that follow the copy rules, in both languages', () => {
    for (const w of ROAD_RUN_WORLDS) {
      for (const text of [...Object.values(w.name as Record<string, string>), ...Object.values(w.tagline as Record<string, string>)]) {
        expect(copyProblems(text), `${w.id}: ${text}`).toEqual([]);
      }
    }
  });
});
