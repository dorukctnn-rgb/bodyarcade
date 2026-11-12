// Brings the home page's before/after band to life (growth/before-after-band.ts): the page draws it with a still of each view; here the
// 3D twin takes their place once the band comes near the screen. The same switches as the moving tiles and the scene at the top keep the
// stills: reduced motion, saving data, 2G, a crawler or a script (tests can ask for it). Browser only.
import { clipsAllowed, type ClipConnection } from '../clips.ts';
import { mountBeforeAfterBand } from '../growth/before-after-band.ts';
import type { Lang } from '../../../core/ui/i18n/index.ts';
import type { TileClipsEnv } from './tile-clips.ts';

export function startHomeBand(root: ParentNode, env: TileClipsEnv, lang: Lang): () => void {
  const host = root.querySelector<HTMLElement>('[data-home-band]');
  if (!host) return () => undefined;
  const connection = (env.win.navigator as Navigator & { connection?: ClipConnection }).connection;
  if (!clipsAllowed({ reducedMotion: env.reducedMotion, connection, automated: env.automated, forced: env.forced === true })) return () => undefined;
  const band = mountBeforeAfterBand(host, { lang });
  return () => band.dispose();
}
