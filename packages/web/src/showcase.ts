// The pictures at the top of the home page: frames of the real games (tools/gfx-shots --clean, Road Run on the high tier), shown
// one after the other. Each frame has a 21:9 crop for a wider screen and a 4:3 crop for a phone, in AVIF with one WebP for a
// browser without AVIF. The files are design/art/hero/<id>-<width>.<ext> (wide) and <id>-m-<width>.<ext> (phone), made by
// design/tools/hero-frames.mjs from the shots. The fades in styles/app.css (.k-frame, .k-ticks) are written for four frames.
// They are not in the service worker's precache (release/site.ts precacheList): a visitor loads the sizes their screen needs.

export interface ShowcaseSlide {
  /** The file stem in design/art/hero. */
  id: string;
  /** The game the frame is from (catalogue id). */
  game: string;
  /** The Road Run world of the frame, when it is one. */
  world?: string;
}

/** In the order they are shown; the first is the one the page loads first and the one shown when motion is reduced. */
export const SHOWCASE: readonly ShowcaseSlide[] = [
  { id: 'coast', game: 'road-run', world: 'coast' },
  { id: 'flap', game: 'squat-flap' },
  { id: 'alps', game: 'road-run', world: 'alps' },
  { id: 'city', game: 'road-run', world: 'city' },
];

/** Widths of the wide crop (21:9) and of the phone crop (4:3), in pixels. */
export const SHOWCASE_WIDE = [1280, 1920, 2560] as const;
export const SHOWCASE_PHONE = [640, 960, 1280] as const;
/** Height of a crop of a given width. */
export const wideHeight = (w: number): number => Math.round((w * 9) / 21);
export const phoneHeight = (w: number): number => Math.round((w * 3) / 4);
/** The WebP fallback of each crop is one size. */
export const SHOWCASE_WIDE_WEBP = 1920;
export const SHOWCASE_PHONE_WEBP = 960;

/** From this width up the page shows the wide crop (styles/app.css .k-reel). */
export const SHOWCASE_WIDE_MIN = 760;

/** How wide the frame is drawn: the content column of the page (1240 px, 1560 px from 1680 px up), the whole width less the margins below. */
export const SHOWCASE_SIZES_WIDE = '(min-width: 1680px) 1560px, (min-width: 1336px) 1240px, 92vw';
export const SHOWCASE_SIZES_PHONE = '92vw';

/** Every file of design/art/hero the page uses. */
export function showcaseFiles(slides: readonly ShowcaseSlide[] = SHOWCASE): string[] {
  return slides.flatMap((s) => [
    ...SHOWCASE_WIDE.map((w) => `${s.id}-${w}.avif`), `${s.id}-${SHOWCASE_WIDE_WEBP}.webp`,
    ...SHOWCASE_PHONE.map((w) => `${s.id}-m-${w}.avif`), `${s.id}-m-${SHOWCASE_PHONE_WEBP}.webp`,
  ]);
}

/** The srcset of one crop of a frame, from the address of each file. */
export function showcaseSrcset(slide: ShowcaseSlide, crop: 'wide' | 'phone', url: (file: string) => string): string {
  return crop === 'wide'
    ? SHOWCASE_WIDE.map((w) => `${url(`${slide.id}-${w}.avif`)} ${w}w`).join(', ')
    : SHOWCASE_PHONE.map((w) => `${url(`${slide.id}-m-${w}.avif`)} ${w}w`).join(', ');
}
