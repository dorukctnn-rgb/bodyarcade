// The pictures at the top of the home page: frames of the real games (tools/gfx-shots, the high tier, no HUD), shown one
// after the other. Each frame has a wide crop for a computer and a 4:3 crop for a phone, in AVIF with one WebP for a browser
// without AVIF. The files are design/art/hero/<id>-<width>.<ext> (wide) and <id>-m-<width>.<ext> (phone).
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
  { id: 'city', game: 'road-run', world: 'city' },
];

/** Widths of the wide crop (16:9) and of the phone crop (4:3), in pixels. */
export const SHOWCASE_WIDE = [1280, 1920, 2560] as const;
export const SHOWCASE_PHONE = [640, 960, 1280] as const;
/** The WebP fallback of each crop is one size. */
export const SHOWCASE_WIDE_WEBP = 1920;
export const SHOWCASE_PHONE_WEBP = 960;

/** The width at which the hero stops stacking (picture above the words) and lays the words over the picture. */
export const SHOWCASE_WIDE_MIN = 760;

/** Every file of design/art/hero the page uses. */
export function showcaseFiles(slides: readonly ShowcaseSlide[] = SHOWCASE): string[] {
  return slides.flatMap((s) => [
    ...SHOWCASE_WIDE.map((w) => `${s.id}-${w}.avif`), `${s.id}-${SHOWCASE_WIDE_WEBP}.webp`,
    ...SHOWCASE_PHONE.map((w) => `${s.id}-m-${w}.avif`), `${s.id}-m-${SHOWCASE_PHONE_WEBP}.webp`,
  ]);
}
