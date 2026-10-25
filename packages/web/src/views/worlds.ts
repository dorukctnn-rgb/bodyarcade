// The world picker of a game that has worlds (today Road Run: ten, three free). A group of real radio buttons, one tile per
// world with a small picture drawn from the world's own theme, so the arrow keys, the labels and the group name come from
// the browser. A world the player may not use is shown with a lock and is chosen like any other: the page then opens the
// offer instead (the same way as a Pro difficulty). Which worlds a player may use is one rule, the entitlements' can(): the
// feature is 'world:<id>', free for the three free worlds (DEFAULT_FREE_FEATURES) and part of Pro for the rest.
import { canUse } from '../../../core/entitlements/features.ts';
import { html, attr, type SafeHtml } from '../../../core/ui/html.ts';
import { icon } from '../../../core/ui/icons.ts';
import { localized } from '../../../core/ui/i18n/localized.ts';
import { ROAD_RUN_WORLDS, type WorldCard } from '../../../games/road-run/worlds.ts';
import type { ShellGame } from '../../catalogue/types.ts';
import type { ViewContext } from '../context.ts';
import { worldArt } from './world-art.ts';

/** The worlds of each game that has any, by game id. A game without an entry has none and the page shows no picker. */
const WORLDS_OF: Readonly<Record<string, readonly WorldCard[]>> = { 'road-run': ROAD_RUN_WORLDS };

export const worldsOf = (g: Pick<ShellGame, 'id'>): readonly WorldCard[] => WORLDS_OF[g.id] ?? [];

/** The entitlement feature of a world: 'world:storm'. */
export const worldFeature = (id: string): string => `world:${id}`;

/** May this player play this world? The entitlements' own rule (core/entitlements/features.ts), asked with the plan the page is drawn for. */
export const worldAllowed = (ctx: Pick<ViewContext, 'plan'>, id: string): boolean => canUse(worldFeature(id), { plan: ctx.plan, source: 'none' });

/**
 * The world a round starts in when nothing was asked: the one this device played last when the player may still play it, else the
 * first free world. Undefined for a game without worlds.
 */
export function defaultWorld(ctx: Pick<ViewContext, 'plan' | 'settings'>, g: Pick<ShellGame, 'id'>): string | undefined {
  const list = worldsOf(g);
  if (list.length === 0) return undefined;
  const last = ctx.settings.worlds[g.id];
  const pick = list.find((w) => w.id === last && worldAllowed(ctx, w.id)) ?? list.find((w) => w.free && worldAllowed(ctx, w.id)) ?? list.find((w) => worldAllowed(ctx, w.id));
  return pick?.id;
}

/** A world that exists, may be played by this player, and belongs to this game; else the default. Undefined for a game without worlds. */
export function sanitizeWorld(ctx: Pick<ViewContext, 'plan' | 'settings'>, g: Pick<ShellGame, 'id'>, wanted: string | undefined): string | undefined {
  const list = worldsOf(g);
  if (list.length === 0) return undefined;
  const w = list.find((x) => x.id === wanted);
  return w && worldAllowed(ctx, w.id) ? w.id : defaultWorld(ctx, g);
}

/** A world the player asked for that exists but is not theirs to play: the page opens the offer instead of starting it. */
export function worldLocked(ctx: Pick<ViewContext, 'plan'>, g: Pick<ShellGame, 'id'>, wanted: string | undefined): boolean {
  const w = worldsOf(g).find((x) => x.id === wanted);
  return !!w && !worldAllowed(ctx, w.id);
}

export const worldName = (ctx: Pick<ViewContext, 'lang'>, w: WorldCard): string => localized(w.name, ctx.lang);
export const worldTagline = (ctx: Pick<ViewContext, 'lang'>, w: WorldCard): string => localized(w.tagline, ctx.lang);

function tile(ctx: ViewContext, w: WorldCard, checked: boolean): SafeHtml {
  const locked = !worldAllowed(ctx, w.id);
  return html`<label class="k-world${locked ? ' is-locked' : ''}"><input type="radio" name="world" value="${w.id}" data-key="world-${w.id}"${attr('checked', checked)}><span class="wpic">${worldArt(w.look)}${locked ? html`<span class="wlock">${icon('lock')}</span>` : ''}</span><span class="wname">${worldName(ctx, w)}${locked ? html`<span class="ba-visually-hidden"> (${ctx.i18n.t('common.pro')})</span>` : ''}</span></label>`;
}

/** The picker: the ten tiles and, under them, the chosen world in a line (and for a player without Pro, how many are free). */
export function worldPicker(ctx: ViewContext, g: Pick<ShellGame, 'id'>, selected: string | undefined): SafeHtml {
  const list = worldsOf(g);
  if (list.length === 0) return html``;
  const t = ctx.i18n;
  const chosen = list.find((w) => w.id === selected) ?? list[0] as WorldCard;
  const free = list.filter((w) => w.free).length;
  const everything = list.every((w) => worldAllowed(ctx, w.id));
  return html`<fieldset class="ba-fieldset k-block k-worlds" aria-describedby="setup-world-hint">
    <legend class="k-label">${t.t('setup.world')}</legend>
    <div class="k-worldgrid">${list.map((w) => tile(ctx, w, w.id === chosen.id))}</div>
    <p class="ba-small k-hint" id="setup-world-hint"><b class="k-worldname">${worldName(ctx, chosen)}</b> ${worldTagline(ctx, chosen)}${everything ? '' : html` ${t.t('setup.world.hint', { free, total: list.length })}`}</p>
  </fieldset>`;
}
