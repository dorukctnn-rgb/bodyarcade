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
 * Whether one clip plays now. A device that hovers (a mouse) plays a tile's clip while the pointer is on it or it has the keyboard
 * focus; a touch screen plays the clips of the tiles that are on the screen. Never while the page is still loading (the clips wait
 * for the page's own pictures), never in a hidden tab, never off the screen.
 */
export function clipShouldPlay(s: { ready: boolean; hidden: boolean; inView: boolean; hoverDevice: boolean; engaged: boolean; failed: boolean }): boolean {
  if (!s.ready || s.hidden || !s.inView || s.failed) return false;
  return s.hoverDevice ? s.engaged : true;
}
