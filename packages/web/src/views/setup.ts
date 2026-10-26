// "Set up your round": who is playing, how hard, and the ways to play (seated, quiet, camera or keyboard). The fields
// sit on the game's page (design/ui-kit/game.html) inside a form that goes to the play address, so a round starts the
// same way with or without scripts. The rules of what is possible live here as pure functions, so the page, the play
// address and the tests agree.
import type { SessionOptions } from '../../../core/types/index.ts';
import { html, type SafeHtml } from '../../../core/ui/html.ts';
import { icon } from '../../../core/ui/icons.ts';
import { supportsLocal2 } from '../../catalogue/filter.ts';
import type { ShellGame } from '../../catalogue/types.ts';
import { accessOf, hasPro, titleOf, type ViewContext } from '../context.ts';
import { segmented, switchRow } from './forms.ts';
import { defaultWorld, sanitizeWorld, worldLocked, worldPicker } from './worlds.ts';

export type Difficulty = 'easy' | 'normal' | 'hard' | 'expert';
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard', 'expert'];
/** Part of Pro (entitlement feature 'difficulty:hard'). */
export const PRO_DIFFICULTIES: readonly Difficulty[] = ['hard', 'expert'];

export interface SetupState {
  players: 1 | 2;
  input: 'camera' | 'keyboard';
  difficulty: Difficulty;
  seated: boolean;
  quiet: boolean;
  /** The world of a game that has worlds (Road Run): a theme id the player may play. Left out for a game without worlds. */
  world?: string;
}

export const twoPlayersOffered = (ctx: ViewContext): boolean => ctx.caps.local2;
export const twoPlayersPossible = (ctx: ViewContext, g: ShellGame): boolean => ctx.caps.local2 && supportsLocal2(g);
export const cameraUsable = (ctx: ViewContext): boolean => ctx.caps.camera && ctx.caps.secure;

/**
 * Games with swipes and taps for a touch screen: every game but the mirror games (target, rhythm), whose keys move a cursor over the
 * camera picture and have no swipes. A test holds this to what each game's own module declares (controls.test.ts).
 */
export const touchPlays = (g: Pick<ShellGame, 'template'>): boolean => g.template !== 'target' && g.template !== 'rhythm';

/**
 * A way to play without the camera on this device: a keyboard, or a touch screen and a game that has swipes. Those rounds are
 * practice (they are not kept in the record, the habit or the calories: no body moved), so the way is offered, never pushed.
 */
export const noCameraPossible = (ctx: ViewContext, g: Pick<ShellGame, 'template'>): boolean => ctx.caps.keyboard || (ctx.caps.touch && touchPlays(g));

/** Forces a state into what is possible for this game on this device. */
export function sanitizeSetup(ctx: ViewContext, g: ShellGame, s: SetupState): SetupState {
  const players: 1 | 2 = s.players === 2 && twoPlayersPossible(ctx, g) ? 2 : 1;
  const camera = cameraUsable(ctx);
  // Two players need the camera, and so does a game that has no way around it on this device (a mirror game on a phone: the game
  // then says it needs the camera and helps with the permission). Anything else the game decides later.
  const input = players === 2 || !noCameraPossible(ctx, g) ? 'camera' : s.input === 'camera' && !camera ? 'keyboard' : s.input;
  const difficulty = PRO_DIFFICULTIES.includes(s.difficulty) && !hasPro(ctx) ? 'normal' : DIFFICULTIES.includes(s.difficulty) ? s.difficulty : 'normal';
  const world = sanitizeWorld(ctx, g, s.world);
  return { players, input, difficulty, seated: s.seated && g.seated, quiet: s.quiet && g.silentSafe, ...(world !== undefined ? { world } : {}) };
}

/**
 * A choice that is part of Pro, asked for by a player who does not have it: a Pro difficulty or a Pro world. The page opens the
 * offer for it instead of taking it (a state that was read from an address is simply made playable by sanitizeSetup).
 */
export function lockedChoice(ctx: ViewContext, g: ShellGame, wanted: SetupState): 'difficulty' | 'world' | null {
  if (PRO_DIFFICULTIES.includes(wanted.difficulty) && !hasPro(ctx)) return 'difficulty';
  if (worldLocked(ctx, g, wanted.world)) return 'world';
  return null;
}

/** What a round is started with: the setup's own parts, and the world when the game has one. */
export function sessionOptionsOf(s: SetupState, mode: SessionOptions['mode']): SessionOptions {
  return { mode, difficulty: s.difficulty, input: s.input, seated: s.seated, ...(s.world ? { world: s.world } : {}) };
}

const worldOf = (w: string | undefined): { world?: string } => (w !== undefined ? { world: w } : {});

export function defaultSetup(ctx: ViewContext, g: ShellGame): SetupState {
  return sanitizeSetup(ctx, g, {
    players: 1,
    // The camera, unless there is none to use or the player's setting says the rounds begin without it.
    input: noCameraPossible(ctx, g) && (!cameraUsable(ctx) || ctx.settings.controls === 'keyboard') ? 'keyboard' : 'camera',
    difficulty: 'normal',
    seated: ctx.settings.seated,
    quiet: ctx.settings.quiet,
    ...worldOf(defaultWorld(ctx, g)),
  });
}

/** The play address for a state. Everything the round needs is in it, so a reload or a shared link starts the same round. */
export function playHref(ctx: ViewContext, g: ShellGame, s: SetupState, extra: Record<string, string | number> = {}): string {
  return ctx.href('play', {
    params: { slug: g.seo.slug },
    query: { players: s.players, input: s.input, difficulty: s.difficulty, seated: s.seated ? 1 : 0, quiet: s.quiet ? 1 : 0, ...(s.world ? { world: s.world } : {}), ...extra },
  });
}

/** Reads a play address back into a state, ignoring anything that makes no sense. */
export function setupFromQuery(ctx: ViewContext, g: ShellGame, q: URLSearchParams): SetupState {
  const base = defaultSetup(ctx, g);
  const diff = q.get('difficulty');
  const read = {
    players: q.get('players') === '2' ? (2 as const) : (1 as const),
    input: q.get('input') === 'keyboard' ? ('keyboard' as const) : q.get('input') === 'camera' ? ('camera' as const) : base.input,
    difficulty: (DIFFICULTIES as readonly string[]).includes(diff ?? '') ? (diff as Difficulty) : base.difficulty,
    seated: q.has('seated') ? q.get('seated') === '1' : base.seated,
    quiet: q.has('quiet') ? q.get('quiet') === '1' : base.quiet,
    ...worldOf(q.get('world') ?? base.world),
  };
  return sanitizeSetup(ctx, g, read);
}

/** What a form on the game's page holds, read back into a state (the form's fields are named like the address). */
export function setupFromForm(ctx: ViewContext, g: ShellGame, f: FormData, previous: SetupState): SetupState {
  const pick = (k: string, fallback: string): string => {
    const v = f.get(k);
    return typeof v === 'string' ? v : fallback;
  };
  return {
    players: pick('players', String(previous.players)) === '2' ? 2 : 1,
    input: pick('input', previous.input) === 'keyboard' ? 'keyboard' : 'camera',
    difficulty: pick('difficulty', previous.difficulty) as Difficulty,
    // A checked box sends 1 before the hidden 0 that follows it; an unchecked one sends only the 0.
    seated: pick('seated', previous.seated ? '1' : '0') === '1',
    quiet: pick('quiet', previous.quiet ? '1' : '0') === '1',
    ...worldOf(pick('world', previous.world ?? '') || undefined),
  };
}

export function startLabel(ctx: ViewContext, g: ShellGame): string {
  const t = ctx.i18n;
  const a = accessOf(ctx, g);
  return a === 'locked' ? t.t('setup.needPro') : a === 'once' ? t.t('setup.startOnce') : t.t('game.play');
}

/** A checkbox that also says "no" when it is not checked: the checkbox comes first, so a checked box wins. */
function flag(o: { id: string; name: string; label: string; hint?: string | undefined; checked: boolean; disabled: boolean }): SafeHtml {
  return html`${switchRow({ id: o.id, name: o.name, label: o.label, ...(o.hint ? { hint: o.hint } : {}), checked: o.checked, disabled: o.disabled })}<input type="hidden" name="${o.name}" value="0">`;
}

/** The fields of the setup: players (only where two players are offered), difficulty, and the ways to play. */
export function setupFields(ctx: ViewContext, g: ShellGame, s: SetupState): SafeHtml {
  const t = ctx.i18n;
  const camera = cameraUsable(ctx);
  const title = titleOf(ctx, g);

  const players = twoPlayersOffered(ctx)
    ? html`${segmented('players', t.t('setup.players'), [
        { value: '1', label: t.t('setup.players.one'), checked: s.players === 1 },
        { value: '2', label: t.t('setup.players.two'), checked: s.players === 2, disabled: !twoPlayersPossible(ctx, g) },
      ], { describedBy: 'setup-players-hint', legendClass: 'k-label', className: 'k-block' })}
      ${!twoPlayersPossible(ctx, g)
        ? html`<p class="ba-small k-hint" id="setup-players-hint">${t.t('setup.players.twoUnavailable', { game: title })}</p>`
        : s.players === 2
          ? html`<div class="k-duo" id="setup-players-hint"><i class="p1" aria-hidden="true"></i><p class="ba-small">${t.t('setup.players.duoDetail')}</p></div>`
          : html`<p class="ba-small k-hint" id="setup-players-hint">${t.t('setup.players.twoHint')}</p>`}`
    : '';

  const levelLabel = (d: Difficulty): string => t.t(`setup.difficulty.${d}` as 'setup.difficulty.easy');
  const difficulty = html`${segmented('difficulty', t.t('setup.difficulty'), DIFFICULTIES.map((d) => ({
      value: d, label: levelLabel(d), checked: s.difficulty === d, lock: PRO_DIFFICULTIES.includes(d) && !hasPro(ctx),
    })), { describedBy: 'setup-difficulty-hint', legendClass: 'k-label', className: 'k-block' })}
    ${hasPro(ctx) ? '' : html`<p class="ba-small k-hint" id="setup-difficulty-hint">${t.t('setup.difficulty.hint')}</p>`}`;

  const noCam = noCameraPossible(ctx, g);
  const inputNote = !ctx.caps.camera ? t.t(noCam ? 'setup.noCamera' : 'setup.noCamera.phone')
    : !ctx.caps.secure ? t.t('setup.insecure')
      : t.t(noCam ? 'setup.input.hint' : 'setup.cameraOnly');
  const more = html`<details class="k-more"><summary>${icon('settings')}<span>${t.t('setup.more')}</span></summary>
    <div>
      ${flag({ id: 'setup-seated', name: 'seated', label: t.t('setup.seated'), hint: g.seated ? undefined : t.t('setup.seated.none'), checked: s.seated, disabled: !g.seated })}
      ${flag({ id: 'setup-quiet', name: 'quiet', label: t.t('setup.quiet'), hint: g.silentSafe ? undefined : t.t('setup.quiet.none'), checked: s.quiet, disabled: !g.silentSafe })}
      ${noCam ? segmented('input', t.t('setup.input'), [
        { value: 'camera', label: t.t('setup.input.camera'), checked: s.input === 'camera', disabled: !camera },
        { value: 'keyboard', label: t.t('setup.input.keyboard'), checked: s.input === 'keyboard', disabled: s.players === 2 },
      ], { describedBy: 'setup-input-hint', legendClass: 'k-label' }) : html`<input type="hidden" name="input" value="camera">`}
      <p class="ba-small k-hint" id="setup-input-hint">${inputNote}</p>
    </div>
  </details>`;

  return html`${worldPicker(ctx, g, s.world)}${players}${difficulty}${more}`;
}
