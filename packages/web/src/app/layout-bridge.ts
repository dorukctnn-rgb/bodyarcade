// The HUD and the 2D scene kit lay the screen out with the same code (core/ui/layout.ts), but only the HUD can measure its
// plates in the DOM. This hands the kit what the HUD measured, so the play area, the lanes and the self view window the
// game keeps clear are the very rectangles the plates and the self view sit in.
import type { Scene2DKit } from '../../../core/render2d/scene2d.ts';
import type { HudLayoutInfo } from '../../../core/ui/hud/hud.ts';
import type { HudMode, MeasuredDuo, MeasuredHud, Size } from '../../../core/ui/layout.ts';

const size = (r: { w: number; h: number }): Size => ({ w: r.w, h: r.h });

/** The plates of one player as the HUD placed them; null for a two player layout. */
export function measuredHudOf(info: HudLayoutInfo): MeasuredHud | null {
  if (info.duo || !info.solo) return null;
  const r = info.solo.rects;
  return { statusLeft: size(r.statusLeft), statusRight: size(r.statusRight), command: size(r.command), reason: size(r.reason) };
}

/** The plates of two players on one camera; null for a one player layout. */
export function measuredDuoOf(info: HudLayoutInfo): MeasuredDuo | null {
  if (!info.duo || !info.twoPlayers) return null;
  const d = info.twoPlayers.rects;
  const m: MeasuredDuo = { statusP1: size(d.statusP1), statusP2: size(d.statusP2), timer: size(d.timer), command: size(d.command) };
  if (d.reasonP1) m.reasonP1 = size(d.reasonP1);
  if (d.reasonP2) m.reasonP2 = size(d.reasonP2);
  return m;
}

type KitLayout = Pick<Scene2DKit, 'setHud' | 'setHudDuo' | 'setCamera'>;

/**
 * Tells the kit where everything went. A mirror game keeps no self view and sets the camera's own aspect itself (the
 * picture is the scene); every other game gets the aspect the HUD sized the self view window with, so the window the
 * game keeps clear is the window on the screen.
 */
export function followHud(kit: KitLayout, info: HudLayoutInfo, mode: HudMode): void {
  const duo = measuredDuoOf(info);
  if (duo) {
    kit.setHudDuo(duo);
    return;
  }
  const measured = measuredHudOf(info);
  if (!measured) return;
  if (mode !== 'mirror') kit.setCamera(info.metrics.pip.aspect);
  kit.setHud({ mode, pipCorner: mode === 'mirror' ? 'hidden' : info.pipCorner, measured });
}
