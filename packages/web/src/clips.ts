// The moving game tiles of the home page: a few seconds of the game in play, silent, round and round, over the tile's still picture
// (which stays the poster: what a visitor sees before the clip has loaded, when motion is reduced, and when data is saved). Only the
// games whose look was redrawn have one (the tiles that are frames of the game, design/art/tile-ids.mjs FRAME_TILES). The files are
// design/art/clips/<tile>-<width>.<webm|mp4>, made by design/tools/tile-clips.mjs; the app plays them (app/tile-clips.ts).
// They are not in the service worker's precache (release/site.ts precacheList): a visitor loads the one or two sizes their screen needs.

/** The tiles (catalogue tile stems) that have a clip. */
export const CLIP_TILES: readonly string[] = ['squat-flap', 'road-run', 'pose-wall', 'star-catch'];

/** The two widths of each clip (4:3), the tile's own: 400x300 and 800x600. */
export const CLIP_WIDTHS = [400, 800] as const;
export type ClipWidth = (typeof CLIP_WIDTHS)[number];

/** AV1 in WebM first (smaller), H.264 in MP4 for a browser without AV1 (Safari on most devices). */
export const CLIP_FORMATS = ['webm', 'mp4'] as const;
export type ClipFormat = (typeof CLIP_FORMATS)[number];
/** What canPlayType is asked for each format: the codec the files are made with (AV1 main 8-bit level 3.0, H.264 high level 3.1). */
export const CLIP_TYPES: Readonly<Record<ClipFormat, string>> = { webm: 'video/webm; codecs="av01.0.04M.08"', mp4: 'video/mp4; codecs="avc1.64001F"' };

export const hasClip = (tile: string): boolean => CLIP_TILES.includes(tile);

export const clipFile = (tile: string, width: ClipWidth, format: ClipFormat): string => `${tile}-${width}.${format}`;

/** Every file of design/art/clips the pages use. */
export function clipFiles(tiles: readonly string[] = CLIP_TILES): string[] {
  return tiles.flatMap((t) => CLIP_FORMATS.flatMap((f) => CLIP_WIDTHS.map((w) => clipFile(t, w, f))));
}

/** The files of one format of a clip, as the markup carries them: "<url> 400w, <url> 800w". */
export function clipSet(tile: string, format: ClipFormat, url: (file: string) => string): string {
  return CLIP_WIDTHS.map((w) => `${url(clipFile(tile, w, format))} ${w}w`).join(', ');
}

/** A clip set read back: each file with its width, narrowest first. */
export function parseClipSet(set: string): { url: string; width: number }[] {
  return set.split(',').map((part) => part.trim().split(/\s+/)).flatMap(([url, w]) => {
    const width = Number((w ?? '').replace(/w$/, ''));
    return url && Number.isFinite(width) && width > 0 ? [{ url, width }] : [];
  }).sort((a, b) => a.width - b.width);
}

/**
 * The file for a tile drawn `cssWidth` pixels wide on a screen of `dpr` device pixels per CSS pixel: the narrowest one that is wide
 * enough (a little enlarging is allowed: 10%), else the widest. A screen denser than 2 gets the 2x file (a small moving picture
 * shows no difference, and it saves data and decoding).
 */
export function pickClip(set: readonly { url: string; width: number }[], cssWidth: number, dpr: number): string | null {
  if (set.length === 0) return null;
  const need = Math.max(1, cssWidth) * Math.min(Math.max(dpr || 1, 1), 2);
  return (set.find((f) => f.width * 1.1 >= need) ?? set[set.length - 1])?.url ?? null;
}

/** The format a browser plays: the first whose canPlayType is not "", else none (the tile keeps its still picture). */
export function pickFormat(canPlay: (type: string) => string): ClipFormat | null {
  return CLIP_FORMATS.find((f) => canPlay(CLIP_TYPES[f]) !== '') ?? null;
}

/** What the device says about its connection (Network Information API, where there is one). */
export interface ClipConnection { saveData?: boolean; effectiveType?: string }

/**
 * Whether the tiles may move at all on this visit: not when motion is reduced (the player's setting or the system's), not when the
 * visitor saves data or is on a 2G connection, and not for a crawler or a script (they get the pictures; tests can ask for the clips).
 */
export function clipsAllowed(o: { reducedMotion: boolean; connection?: ClipConnection | undefined; automated: boolean; forced?: boolean }): boolean {
  if (o.reducedMotion) return false;
  if (o.connection?.saveData === true) return false;
  if (o.connection?.effectiveType === 'slow-2g' || o.connection?.effectiveType === '2g') return false;
  return o.forced === true || !o.automated;
}

/**
 * Whether one clip plays now: whenever its tile is on the screen, with a mouse as on a touch screen (a moving tile tells what the game
 * is before anyone points at it). Never while the page is still loading (the clips wait for the page's own pictures), never in a
 * hidden tab, never off the screen, never after its file failed.
 */
export function clipShouldPlay(s: { ready: boolean; hidden: boolean; inView: boolean; failed: boolean }): boolean {
  return s.ready && !s.hidden && s.inView && !s.failed;
}

// ---- the moving pictures at the top of the home page ----------------------------------------------------------------------
// The showcase (src/showcase.ts) shows a frame of each of four games, one after the other. Each frame has a clip of the same game
// in play: HERO_SECONDS of the real game, silent, with the last half second dissolving into the first so that it loops without a jump.
// The page shows the clip over the frame (which stays the poster: the page's largest picture, what a visitor sees before the clip
// has loaded, when motion is reduced and when data is saved) and takes each slide off the screen when its clip has played once, so
// the slides change on the clip's own loop. The files are design/art/clips/hero-<id>-<w>.<ext> (the 21:9 crop of a wider screen) and
// hero-<id>-m-<w>.<ext> (the 4:3 crop of a phone), made by design/tools/hero-clips.mjs from frames of tools/gfx-shots/clip.ts.

/** Widths of the 21:9 clips and of the 4:3 clips. A clip is never enlarged: each size is the capture (2000 px wide, twice the card beside the week panel) or smaller. */
export const HERO_CLIP_WIDE = [1280, 2000] as const;
export const HERO_CLIP_PHONE = [960] as const;
export type HeroCrop = 'wide' | 'phone';

/** Seconds one slide stays: the length of its clip's loop. */
export const HERO_SECONDS = 5;

/** The height of a clip of that width: 21:9 or 4:3, an even number (the encoders want one). */
export const heroClipHeight = (crop: HeroCrop, w: number): number => {
  const h = crop === 'wide' ? Math.round((w * 9) / 21) : Math.round((w * 3) / 4);
  return h - (h % 2);
};

export const heroClipFile = (id: string, crop: HeroCrop, width: number, format: ClipFormat): string => `hero-${id}${crop === 'phone' ? '-m' : ''}-${width}.${format}`;

/** Every file of design/art/clips the showcase uses. */
export function heroClipFiles(ids: readonly string[]): string[] {
  return ids.flatMap((id) => CLIP_FORMATS.flatMap((f) => [
    ...HERO_CLIP_WIDE.map((w) => heroClipFile(id, 'wide', w, f)),
    ...HERO_CLIP_PHONE.map((w) => heroClipFile(id, 'phone', w, f)),
  ]));
}

/** The files of one crop and format of a clip, as the markup carries them: "<url> 1280w, <url> 1920w, ...". */
export function heroClipSet(id: string, crop: HeroCrop, format: ClipFormat, url: (file: string) => string): string {
  return (crop === 'wide' ? HERO_CLIP_WIDE : HERO_CLIP_PHONE).map((w) => `${url(heroClipFile(id, crop, w, format))} ${w}w`).join(', ');
}

/** The slide after `i` of `n`, round and round. */
export const nextSlide = (i: number, n: number): number => (n <= 0 ? 0 : (i + 1) % n);

/**
 * Whether the reel runs now: the page has loaded, the tab is in front, at least a quarter of the reel is on the screen. (The clips
 * of the tiles play the same way.)
 */
export function reelShouldRun(s: { ready: boolean; hidden: boolean; inView: boolean }): boolean {
  return s.ready && !s.hidden && s.inView;
}

/**
 * How far a slide has got, 0 to 1, and whether it is over. The clip's own clock is the truth while it plays (so the slides change on
 * its loop, however the page's frames are paced); a slide whose clip is not playing (not loaded, failed, still buffering) is timed by
 * the page's clock, and one that has overrun by 2 seconds goes on whatever its clip does.
 */
export function slideProgress(s: { clipPlaying: boolean; clipTime: number; clipLength: number; wallMs: number; slideMs: number }): { fraction: number; over: boolean } {
  const length = s.clipPlaying && s.clipLength > 0 ? s.clipLength * 1000 : s.slideMs;
  const time = s.clipPlaying ? s.clipTime * 1000 : s.wallMs;
  const over = time >= length - 40 || s.wallMs >= length + 2000;
  return { fraction: Math.max(0, Math.min(1, time / length)), over };
}
