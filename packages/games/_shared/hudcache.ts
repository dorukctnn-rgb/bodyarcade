// The HUD of the shell as a games writes to it: a slot is only touched when its value really changed (the DOM plates
// re-measure and re-place themselves on every write), and the two-player plates of the duo HUD are reached through
// setPlayer when the HUD has them (the contract's Hud does not know them; the shell's PlayHud does).
import type { Hud, HudSlot, PlayerSlot } from '../../core/types/index.ts';

export type HudValue = Parameters<Hud['set']>[1];
export type DuoValue = string | number;

interface DuoHud { setPlayer(player: PlayerSlot, slot: 'score' | 'hint', v: DuoValue): void }

const hasDuo = (h: Hud): h is Hud & DuoHud => typeof (h as Partial<DuoHud>).setPlayer === 'function';

/** The slots the duo HUD has no plate for: it has a score and a reason per player instead (a write would find nothing to write to). */
const SOLO_ONLY: ReadonlySet<HudSlot> = new Set<HudSlot>(['score', 'hint', 'combo', 'lives']);

export class HudWriter {
  private readonly hud: Hud;
  private readonly plates: boolean;
  /** The run has two players: the plain score and reason plates are not there (the shell's HUD always has the player plates' writer, in a one-player run too). */
  private twoPlayers = false;
  private readonly shown = new Map<string, string>();

  constructor(hud: Hud) {
    this.hud = hud;
    this.plates = hasDuo(hud);
  }

  /** Does this HUD have plates per player (a duo-capable HUD)? */
  get hasPlayerPlates(): boolean { return this.plates; }

  /** How many players the run has: with two, the HUD has no plain score, combo or reason plate to write to (call it when a run starts). */
  setPlayers(n: 1 | 2): void { this.twoPlayers = n === 2; }

  set(slot: HudSlot, v: HudValue): void {
    if (this.plates && this.twoPlayers && SOLO_ONLY.has(slot)) return;
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
