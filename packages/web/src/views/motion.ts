// A real person in motion with our body line (src/motion.ts): the poster first (the clip's first frame with its line drawn on it), and,
// once the app plays the clip (app/motion-cards.ts), the clip and its line drawn together on a canvas. The markup carries only the poster
// and the addresses (data-*); the video and the canvas are made by the app when the clip is to play, so a page that never plays one (a
// crawler, reduced motion, saving data, a weak device) has none of them, and nothing but the poster is fetched. Decorative unless given words:
// the card or the link around it says what it shows.
import { html, type SafeHtml } from '../../../core/ui/html.ts';
import type { ShellGame } from '../../catalogue/types.ts';
import { CAPTURED_GAMES, captureFile } from '../arena.ts';
import type { ViewContext } from '../context.ts';
import { MOTION_SIZE, motionClipFile, motionPoseFile, motionPosterFile, type MotionId, type MotionShape } from '../motion.ts';

export interface MotionOptions {
  /** The poster is the page's first picture (never on the home page: the hero is). */
  eager?: boolean;
  /** Words for a screen reader (the picture is then not decorative). */
  alt?: string;
  /** Score pops in the display face over the person, at the rep's moments. */
  pops?: boolean;
  /** "How it works": the shape to match, drawn faint and dashed from the clip's own held pose. */
  target?: boolean;
  /** Every point the model finds, not only the body line (the tour's "33 points"). */
  all?: boolean;
  /** What sits over the picture: a frame of the game, a counter. */
  over?: SafeHtml | string;
  className?: string;
}

export function motionMedia(ctx: ViewContext, id: MotionId, shape: MotionShape, o: MotionOptions = {}): SafeHtml {
  const { w, h } = MOTION_SIZE[shape];
  const a = (f: string): string => ctx.assets.hero(f);
  const c = (f: string): string => ctx.assets.clip(f);
  const load = o.eager ? html`decoding="async"` : html`loading="lazy" decoding="async"`;
  const flags = html`${o.pops ? html` data-mo-pops` : ''}${o.target ? html` data-mo-target` : ''}${o.all ? html` data-mo-all` : ''}`;
  return html`<span class="k-mo k-mo--${shape}${o.className ? ` ${o.className}` : ''}" data-mo="${id}" data-mo-webm="${c(motionClipFile(id, shape, 'webm'))}" data-mo-mp4="${c(motionClipFile(id, shape, 'mp4'))}" data-mo-pose="${c(motionPoseFile(id, shape))}"${flags}${o.alt ? '' : html` aria-hidden="true"`}>
    <picture class="k-mo-poster"><source type="image/avif" srcset="${a(motionPosterFile(id, shape, 'avif'))}"><img src="${a(motionPosterFile(id, shape, 'webp'))}" alt="${o.alt ?? ''}" width="${w}" height="${h}" ${load}></picture>${o.over ?? ''}
  </span>`;
}

/** A small frame of the game itself in the corner of a card (the person shows the move; this shows the game). */
export function gameInset(ctx: ViewContext, g: ShellGame): SafeHtml {
  if (!CAPTURED_GAMES.includes(g.id)) return html``;
  return html`<span class="k-mo-game" data-qa-layer><img src="${ctx.assets.hero(captureFile(g.id, 480))}" alt="" width="480" height="360" loading="lazy" decoding="async"></span>`;
}
