// The HUD of the shell as a games writes to it: a slot is only touched when its value really changed (the DOM plates
// re-measure and re-place themselves on every write), and the two-player plates of the duo HUD are reached through
// setPlayer when the HUD has them (the contract's Hud does not know them; the shell's PlayHud does).
import type { Hud, HudSlot, PlayerSlot } from '../../core/types/index.ts';

export type HudValue = Parameters<Hud['set']>[1];
export type DuoValue = string | number;

interface DuoHud { setPlayer(player: PlayerSlot, slot: 'score' | 'hint', v: DuoValue): void }

const hasDuo = (h: Hud): h is Hud & DuoHud => typeof (h as Partial<DuoHud>).setPlayer === 'function';

export class HudWriter {
  private readonly hud: Hud;
  private readonly shown = new Map<string, string>();

  constructor(hud: Hud) {
    this.hud = hud;
  }

  set(slot: HudSlot, v: HudValue): void {
    const key = JSON.stringify(v);
    if (this.shown.get(slot) === key) return;
    this.shown.set(slot, key);
    this.hud.set(slot, v);
  }

  /** Score and reason of one player; in a one-player run (or a HUD without player plates) Player 1 is the plain slot. */
  setPlayer(player: PlayerSlot, slot: 'score' | 'hint', v: DuoValue): void {
    const key = JSON.stringify(v);
    const name = `${slot}${player}`;
    if (this.shown.get(name) === key) return;
    this.shown.set(name, key);
    if (hasDuo(this.hud)) this.hud.setPlayer(player, slot, v);
    else if (player === 1) this.hud.set(slot, v);
  }

  /** Polite by default: the shell speaks only what is worth hearing (a new set, the result), never every move. */
  announce(text: string, o?: { assertive?: boolean }): void {
    this.hud.announce(text, o);
  }

  toast(text: string): void {
    this.hud.toast(text);
  }

  /** Forget what was shown (a new run, a restore, a HUD that was rebuilt). */
  reset(): void {
    this.shown.clear();
  }
}
