// "Set up your round": who is playing, with what controls, how hard, and the ways to play (seated, quiet). The rules of
// what is possible live here as pure functions, so the window, the play address and the tests agree.
import { html, type SafeHtml } from '../../../core/ui/html.ts';
import { icon } from '../../../core/ui/icons.ts';
import { supportsLocal2 } from '../../catalogue/filter.ts';
import type { ShellGame } from '../../catalogue/types.ts';
import { accessOf, hasPro, titleOf, type ViewContext } from '../context.ts';
import { segmented, switchRow } from './forms.ts';
import { accessNote } from './game.ts';

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
}

export const twoPlayersOffered = (ctx: ViewContext): boolean => ctx.caps.local2;
export const twoPlayersPossible = (ctx: ViewContext, g: ShellGame): boolean => ctx.caps.local2 && supportsLocal2(g);
export const cameraUsable = (ctx: ViewContext): boolean => ctx.caps.camera && ctx.caps.secure;

/** Forces a state into what is possible for this game on this device. */
export function sanitizeSetup(ctx: ViewContext, g: ShellGame, s: SetupState): SetupState {
  const players: 1 | 2 = s.players === 2 && twoPlayersPossible(ctx, g) ? 2 : 1;
  const camera = cameraUsable(ctx);
  // Two players need the camera; so does anything the keyboard cannot do, which the game decides later.
  const input = players === 2 ? 'camera' : s.input === 'camera' && !camera ? 'keyboard' : s.input;
  const difficulty = PRO_DIFFICULTIES.includes(s.difficulty) && !hasPro(ctx) ? 'normal' : DIFFICULTIES.includes(s.difficulty) ? s.difficulty : 'normal';
  return { players, input, difficulty, seated: s.seated && g.seated, quiet: s.quiet && g.silentSafe };
}

export function defaultSetup(ctx: ViewContext, g: ShellGame): SetupState {
  return sanitizeSetup(ctx, g, {
    players: 1,
    input: cameraUsable(ctx) ? 'camera' : 'keyboard',
    difficulty: 'normal',
    seated: ctx.settings.seated,
    quiet: ctx.settings.quiet,
  });
}

/** The play address for a state. Everything the round needs is in it, so a reload or a shared link starts the same round. */
export function playHref(ctx: ViewContext, g: ShellGame, s: SetupState): string {
  return ctx.href('play', {
    params: { slug: g.seo.slug },
    query: { players: s.players, input: s.input, difficulty: s.difficulty, seated: s.seated ? 1 : 0, quiet: s.quiet ? 1 : 0 },
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
  };
  return sanitizeSetup(ctx, g, read);
}

export function startLabel(ctx: ViewContext, g: ShellGame): string {
  const t = ctx.i18n;
  const a = accessOf(ctx, g);
  return a === 'locked' ? t.t('setup.needPro') : a === 'once' ? t.t('setup.startOnce') : t.t('setup.start');
}

export function setupHtml(ctx: ViewContext, g: ShellGame, s: SetupState): SafeHtml {
  const t = ctx.i18n;
  const camera = cameraUsable(ctx);
  const access = accessOf(ctx, g);
  const note = accessNote(ctx, g, access);
  const title = titleOf(ctx, g);

  const players = twoPlayersOffered(ctx)
    ? html`${segmented('players', t.t('setup.players'), [
        { value: '1', label: t.t('setup.players.one'), checked: s.players === 1 },
        { value: '2', label: t.t('setup.players.two'), checked: s.players === 2, disabled: !twoPlayersPossible(ctx, g) },
      ], { describedBy: 'setup-players-hint' })}
      <p class="ba-small ba-fieldnote" id="setup-players-hint">${twoPlayersPossible(ctx, g) ? t.t('setup.players.twoHint') : t.t('setup.players.twoUnavailable', { game: title })}</p>`
    : '';

  const inputNote = !ctx.caps.camera ? t.t('setup.noCamera') : !ctx.caps.secure ? t.t('setup.insecure') : t.t('setup.input.hint');
  const input = html`${segmented('input', t.t('setup.input'), [
      { value: 'camera', label: t.t('setup.input.camera'), checked: s.input === 'camera', disabled: !camera },
      { value: 'keyboard', label: t.t('setup.input.keyboard'), checked: s.input === 'keyboard', disabled: s.players === 2 },
    ], { describedBy: 'setup-input-hint' })}
    <p class="ba-small ba-fieldnote" id="setup-input-hint">${inputNote}</p>`;

  const levelLabel = (d: Difficulty): string => t.t(`setup.difficulty.${d}` as 'setup.difficulty.easy');
  const difficulty = segmented('difficulty', t.t('setup.difficulty'), DIFFICULTIES.map((d) => ({
    value: d, label: levelLabel(d), checked: s.difficulty === d, lock: PRO_DIFFICULTIES.includes(d) && !hasPro(ctx),
  })));

  const ways = html`<fieldset class="ba-fieldset"><legend class="ba-legend">${t.t('setup.variants')}</legend>
    ${switchRow({ id: 'setup-seated', name: 'seated', label: t.t('setup.seated'), hint: g.seated ? undefined : t.t('setup.seated.none'), checked: s.seated, disabled: !g.seated })}
    ${switchRow({ id: 'setup-quiet', name: 'quiet', label: t.t('setup.quiet'), hint: g.silentSafe ? undefined : t.t('setup.quiet.none'), checked: s.quiet, disabled: !g.silentSafe })}
  </fieldset>`;

  return html`<form class="ba-setup" data-form="setup" data-game="${g.id}" novalidate>
    <header class="ba-dialog-head">
      <div><p class="ba-small ba-dialog-kicker">${title}</p><h2 class="ba-h3" id="setup-title">${t.t('setup.title')}</h2></div>
      <button type="button" class="ba-icon-btn" data-dialog-close="dismissed" aria-label="${t.t('common.close')}">${icon('close')}</button>
    </header>
    ${players}
    ${input}
    ${difficulty}
    ${ways}
    ${note ? html`<p class="ba-small ba-accessnote">${note}</p>` : ''}
    <div class="ba-actions ba-actions--end">
      <button type="submit" class="ba-btn ba-btn--primary ba-btn--lg" data-key="start">${access === 'locked' ? icon('lock') : icon('play')}<span>${startLabel(ctx, g)}</span></button>
    </div>
  </form>`;
}
