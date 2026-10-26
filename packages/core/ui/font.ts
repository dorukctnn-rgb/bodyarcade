// The fonts of the product: the system fonts of each platform, as apple.com sets its text. The stylesheets read them from
// the tokens (design/tokens: --ba-font-text and --ba-font-display); a canvas has no stylesheet, so a game that draws a word
// on its scene takes the same stacks from here (font.test.ts keeps them equal to the tokens). No font file is loaded.
export const FONT_TEXT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
export const FONT_DISPLAY = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/** A value for `ctx.font`: headings, commands and numerals are 700 to 800. */
export function canvasFont(weight: 400 | 500 | 600 | 700 | 800, px: number, family: 'display' | 'text' = 'display'): string {
  return `${weight} ${Math.round(px)}px ${family === 'display' ? FONT_DISPLAY : FONT_TEXT}`;
}
