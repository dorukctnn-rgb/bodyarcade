// The screens around a race against a recording: the window that asks who to race, the card a friend's link opens on a game's
// page, the line about the other side during the race, and what the result says. Every word says what it is: a recording is not
// someone playing live, a bot is not a person, and the code a player sends carries a name, a course and what happened, never a picture.
import { runScore, type GhostLabel, type GhostRun } from '../../../core/net/ghost.ts';
import { avatar } from '../../../core/ui/avatars.ts';
import { attr, html, type SafeHtml } from '../../../core/ui/html.ts';
import { icon } from '../../../core/ui/icons.ts';
import type { ViewContext } from '../context.ts';
import { ghostParam, plateName, specOfRun, type GhostMenu, type RaceOutcome } from '../app/race.ts';

/** The draft of the window: what is chosen, and the recordings pasted in since it opened. */
export interface GhostChoice {
  /** The value of `?ghost=` that is chosen. */
  value: string;
  /** The level of the practice partner. */
  level: 'easy' | 'medium' | 'hard';
  /** Recordings from codes pasted in this window (raced and, for an adult, kept). */
  pasted: readonly GhostRun[];
  /** What the box for a code last said. */
  note: { kind: 'bad' | 'game' | 'added'; label?: string } | null;
}

export const defaultChoice = (menu: GhostMenu): GhostChoice => ({ value: menu.own ? 'own' : 'practice', level: 'medium', pasted: [], note: null });

const points = (ctx: ViewContext, n: number): string => ctx.i18n.t('race.points', { n });

/** "Your best run", "Recording of Ada", "Practice partner (a bot)": what a recording is, in a sentence. */
export function labelText(ctx: ViewContext, label: GhostLabel): string {
  const t = ctx.i18n;
  switch (label.key) {
    case 'ghost.label.own': return t.t('ghost.label.own');
    case 'ghost.label.bot': return t.t('ghost.label.bot');
    case 'ghost.label.friend': return t.t('ghost.label.friend', { name: label.name });
    default: return t.t('ghost.label.recording');
  }
}

/** Who won, as a name for the sentence about it: "Your best run", "The practice partner", "Ada", "The recording". */
export function winnerName(ctx: ViewContext, label: GhostLabel | null): string {
  const t = ctx.i18n;
  switch (label?.key) {
    case 'ghost.label.own': return t.t('race.winner.own');
    case 'ghost.label.bot': return t.t('race.winner.bot');
    case 'ghost.label.friend': return label.name;
    default: return t.t('race.winner.recording');
  }
}

function choice(ctx: ViewContext, o: { value: string; checked: boolean; disabled?: boolean; title: string; hint: string; face?: SafeHtml }): SafeHtml {
  return html`<label class="rc-choice${o.disabled ? ' is-off' : ''}"><input type="radio" name="ghost" value="${o.value}" data-key="ghost-${o.value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24)}"${attr('checked', o.checked && !o.disabled)}${attr('disabled', o.disabled)}>
    ${o.face ?? ''}<span class="rc-text"><b>${o.title}</b><small>${o.hint}</small></span></label>`;
}

function recordingChoice(ctx: ViewContext, run: GhostRun, checked: boolean, o: { value?: string; title?: string; face?: SafeHtml } = {}): SafeHtml {
  const t = ctx.i18n;
  const label = { key: run.source === 'own' ? 'ghost.label.own' : run.name ? 'ghost.label.friend' : 'ghost.label.recording', name: run.name } as GhostLabel;
  return choice(ctx, {
    value: o.value ?? ghostParam(specOfRun(run)), checked, title: o.title ?? labelText(ctx, label),
    hint: t.t('race.recording.hint', { score: points(ctx, runScore(run).score), date: t.date(run.at, { dateStyle: 'medium' }) }),
    ...(o.face ? { face: o.face } : {}),
  });
}

/** The window "Race a ghost". It is a form: the choice and the level are real radio buttons, and Start goes to the round. */
export function ghostDialog(ctx: ViewContext, menu: GhostMenu, st: GhostChoice): SafeHtml {
  const t = ctx.i18n;
  const note = st.note;
  const noteText = !note ? '' : note.kind === 'bad' ? t.t('race.code.bad') : note.kind === 'game' ? t.t('race.code.game') : t.t('race.code.added', { label: note.label ?? '' });
  return html`<form class="rc-sheet" data-form="ghost" novalidate>
    <h2 class="ba-h3" id="race-title">${t.t('race.title')}</h2>
    <p id="race-body">${t.t('race.lead')}</p>
    <div class="rc-choices" role="radiogroup" aria-label="${t.t('race.group')}">
      ${menu.own
        ? recordingChoice(ctx, menu.own, st.value === 'own', { value: 'own', title: t.t('race.own'), face: html`<span class="rc-face" aria-hidden="true">${icon('trophy')}</span>` })
        : choice(ctx, { value: 'own', checked: false, disabled: true, title: t.t('race.own'), hint: t.t('race.own.none'), face: html`<span class="rc-face" aria-hidden="true">${icon('trophy')}</span>` })}
      ${menu.family.map((f) => recordingChoice(ctx, f.run, st.value === `family:${f.id}`, { value: `family:${f.id}`, title: t.t('race.family', { name: f.name }), face: html`<span class="rc-face">${avatar(f.avatar, { size: 40 })}</span>` }))}
      ${menu.friends.map((r) => recordingChoice(ctx, r, st.value === ghostParam(specOfRun(r)), { face: html`<span class="rc-face" aria-hidden="true">${icon('friends')}</span>` }))}
      ${st.pasted.map((r) => recordingChoice(ctx, r, st.value === ghostParam(specOfRun(r)), { face: html`<span class="rc-face" aria-hidden="true">${icon('friends')}</span>` }))}
      ${choice(ctx, { value: `practice:${st.level}`, checked: st.value.startsWith('practice'), title: t.t('race.practice'), hint: t.t('race.practice.hint'), face: html`<span class="rc-face">${avatar('robot', { size: 40 })}</span>` })}
    </div>
    ${st.value.startsWith('practice')
      ? html`<fieldset class="ba-fieldset rc-level"><legend class="ba-legend">${t.t('race.level')}</legend><div class="ba-seg">${menu.levels.map((l) => html`<label class="ba-seg-opt"><input type="radio" name="level" value="${l}" data-key="level-${l}"${attr('checked', st.level === l)}><span>${t.tx(`race.level.${l}`)}</span></label>`)}</div></fieldset>`
      : ''}
    ${menu.code ? html`<div class="rc-code"><div class="ba-field"><label for="race-code">${t.t('race.code')}</label><div class="rc-codebox"><input class="ba-input" id="race-code" name="code" data-key="code" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${t.t('race.code.label')}" aria-describedby="race-code-note"><button type="button" class="ba-btn ba-btn--secondary" data-action="ghost-code">${t.t('race.code.add')}</button></div></div>
      <p class="ba-small rc-note${note?.kind === 'added' ? '' : ' pf-error'}" id="race-code-note" role="status">${noteText}</p></div>` : ''}
    <div class="ba-actions ba-actions--end">
      <button type="button" class="ba-btn ba-btn--quiet" data-dialog-close="no">${t.t('common.cancel')}</button>
      <button type="submit" class="ba-btn ba-btn--primary" data-key="ghost-go">${icon('play')}<span>${t.t('race.start')}</span></button>
    </div>
  </form>`;
}

/** What a friend's link opens on the page of a game: who made the recording, what it scored, and the way to race it. */
export function ghostOffer(ctx: ViewContext, o: { run: GhostRun; startHref: string }): SafeHtml {
  const t = ctx.i18n;
  const score = runScore(o.run).score;
  const title = o.run.name ? t.t('race.offer.title', { name: o.run.name }) : t.t('race.offer.nameless');
  return html`<section class="k-card rc-offer" aria-labelledby="race-offer-h" data-ghost-offer><h2 class="k-h3" id="race-offer-h">${icon('users')}<span>${title}</span></h2>
    <p>${t.t('race.offer.body', { score: points(ctx, score) })}</p>
    <div class="ba-actions"><a class="ba-btn ba-btn--primary" href="${o.startHref}" data-action="ghost-offer-start">${icon('play')}<span>${t.t('race.start')}</span></a></div></section>`;
}

/** The lines of the results screen about a race: who won and by how much, both scores, and what the player can do with their run. */
export function raceBlock(ctx: ViewContext, r: RaceOutcome, o: { again: string; sendable: boolean }): SafeHtml {
  const t = ctx.i18n;
  const rival = r.rivals[0];
  const verdict = r.won ? t.t('race.result.won', { n: Math.abs(r.margin) }) : r.lost ? t.t('race.result.lost', { name: winnerName(ctx, rival?.label ?? null), n: Math.abs(r.margin) }) : t.t('race.result.draw');
  const bestLine = r.best === 'best' ? t.t('race.result.best') : r.best === 'kept' ? t.t('race.result.kept') : '';
  const rivalName = rival?.label ? labelText(ctx, rival.label) : (rival?.name ?? '');
  return html`<section class="k-card rc-result" aria-labelledby="race-result-h" data-race>
    <h2 class="k-h3" id="race-result-h">${t.t('race.result.title')}</h2>
    <p class="rc-verdict" role="status" data-race-verdict>${verdict}</p>
    <div class="rc-scores"><div><b>${t.number(r.you)}</b><span>${t.t('race.result.you')}</span></div><div><b>${t.number(rival?.score ?? 0)}</b><span>${rivalName}</span></div></div>
    ${bestLine ? html`<p class="ba-small" data-race-best>${bestLine}</p>` : ''}
    <p class="ba-small">${t.t(rival?.label?.source === 'bot' ? 'ghost.note.bot' : 'ghost.note')}</p>
    <div class="ba-actions rc-actions"><a class="ba-btn ba-btn--secondary" href="${o.again}" data-action="again" data-replace>${icon('replay')}<span>${t.t('race.result.again')}</span></a>
      ${o.sendable && r.code ? html`<button type="button" class="ba-btn ba-btn--secondary" data-action="ghost-send" data-code="${r.code}">${icon('share')}<span>${t.t('race.result.send')}</span></button>` : ''}</div>
    ${o.sendable && r.code ? html`<p class="ba-small">${t.t('race.result.sendHint')}</p>` : ''}
  </section>`;
}

/** The name the plates show for the recording that is raced, short enough for the corner of a phone. */
export const plateOf = (ctx: ViewContext, label: GhostLabel): string => plateName(label, ctx.i18n);
