// The window "Race a ghost": who to race (your best run, a family member's, a friend's recording, a practice partner that is a bot,
// a code pasted in), and the way on to the round. It is a form in a dialog of its own: it listens on its own element, so what
// happens inside it never reaches the app's handlers.
import { decodeRun, type GhostRun } from '../../../core/net/ghost.ts';
import { openDialog } from '../../../core/ui/dialog.ts';
import type { ShellGame } from '../../catalogue/types.ts';
import type { ViewContext } from '../context.ts';
import { defaultChoice, ghostDialog, labelText, type GhostChoice } from '../views/race.ts';
import { codeIn, ghostParam, specOfRun, type GhostMenu } from './race.ts';

export interface GhostDialogHost {
  document: Document;
  /** Fresh every call: the language may change while the window is open. */
  context(): ViewContext;
  /** What this player may race in this game now. */
  menu(game: ShellGame): GhostMenu;
  /** A recording that was pasted in: an adult keeps it for the next time. */
  keep(run: GhostRun): void;
  /** The round of the race: the address is built by the app (it knows the choices on the game's page). */
  start(game: ShellGame, ghost: string): void;
}

/** Opens the window for a game. Closing it (Cancel, Escape, a click outside) races nothing. */
export function openGhostDialog(host: GhostDialogHost, game: ShellGame): void {
  const menu = host.menu(game);
  let st: GhostChoice = defaultChoice(menu);
  const dialog = openDialog({
    document: host.document, html: ghostDialog(host.context(), menu, st), labelledBy: 'race-title', describedBy: 'race-body', className: 'rc-box',
    initialFocus: 'input[name="ghost"]:checked, input[name="ghost"]:not(:disabled)',
  });
  const redraw = (): void => dialog.setHtml(ghostDialog(host.context(), menu, st));

  dialog.el.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement | null;
    if (!input) return;
    if (input.name === 'ghost') {
      st = { ...st, value: input.value, note: null };
      redraw();
    } else if (input.name === 'level') {
      const level = input.value === 'easy' || input.value === 'hard' ? input.value : 'medium';
      st = { ...st, level, value: `practice:${level}` };
      redraw();
    }
  });

  dialog.el.addEventListener('click', (e) => {
    const button = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-action="ghost-code"]');
    if (!button) return;
    e.preventDefault();
    const field = dialog.el.querySelector<HTMLInputElement>('#race-code');
    const code = codeIn(field?.value ?? '');
    const run = code ? decodeRun(code) : null;
    if (!run) { st = { ...st, note: { kind: 'bad' } }; redraw(); return; }
    if (run.gameId !== game.id) { st = { ...st, note: { kind: 'game' } }; redraw(); return; }
    host.keep(run);
    const label = labelText(host.context(), { key: run.name ? 'ghost.label.friend' : 'ghost.label.recording', name: run.name, at: run.at, source: 'friend' });
    st = { ...st, pasted: [...st.pasted.filter((r) => ghostParam(specOfRun(r)) !== ghostParam(specOfRun(run))), run], value: ghostParam(specOfRun(run)), note: { kind: 'added', label } };
    redraw();
  });

  dialog.el.addEventListener('submit', (e) => {
    e.preventDefault();
    const chosen = dialog.el.querySelector<HTMLInputElement>('input[name="ghost"]:checked');
    const value = chosen?.value ?? st.value;
    dialog.close('go');
    host.start(game, value);
  });
}
