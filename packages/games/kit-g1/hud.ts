// A thin writer over the contract's Hud: it sets a slot only when the value changed (the DOM plates re-measure and
// re-place on every set), and it reaches the per-player plates of the shell's HUD in mode 'local2' when the Hud has them
// (PlayHud.setPlayer; the contract's Hud has no player argument, so it is looked for, not assumed).
import type { Hud, HudSlot, PlayerSlot } from '../../core/types/index.ts';

export type HudValue = string | number | { icon: string; text: string; progress?: number };

export interface HudWriter {
  set(slot: HudSlot, v: HudValue): void;
  /** Mode 'local2': one player's score or reason strip. Without per-player plates the value is dropped. */
  player(p: PlayerSlot, slot: 'score' | 'hint', v: string | number): void;
  announce(text: string, o?: { assertive?: boolean }): void;
  toast(text: string): void;
  /** Forgets what was shown (a new run starts from empty plates). */
  reset(): void;
}

interface PerPlayer { setPlayer(p: PlayerSlot, slot: 'score' | 'hint', v: string | number): void }

const hasPlayers = (h: Hud): h is Hud & PerPlayer => typeof (h as Partial<PerPlayer>).setPlayer === 'function';

const keyOf = (v: HudValue): string => (typeof v === 'object' ? `o|${v.icon}|${v.text}|${v.progress ?? ''}` : `${typeof v}|${v}`);

export function hudWriter(hud: Hud): HudWriter {
  const shown = new Map<string, string>();
  return {
    set(slot, v) {
      const k = keyOf(v);
      if (shown.get(slot) === k) return;
      shown.set(slot, k);
      hud.set(slot, v);
    },
    player(p, slot, v) {
      const id = `p${p}.${slot}`;
      const k = keyOf(v);
      if (shown.get(id) === k) return;
      shown.set(id, k);
      if (hasPlayers(hud)) hud.setPlayer(p, slot, v);
    },
    announce(text, o) { hud.announce(text, o); },
    toast(text) { hud.toast(text); },
    reset() { shown.clear(); },
  };
}
