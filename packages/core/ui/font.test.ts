import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { canvasFont, FONT_DISPLAY, FONT_TEXT } from './font.ts';

const root = resolve(__dirname, '../../../design/tokens');
const tokens = (await import(/* @vite-ignore */ pathToFileURL(resolve(root, 'tokens.mjs')).href)) as { type: { family: { display: string; text: string }; weight: Record<string, number>; tracking: Record<string, string> } };
const css = readFileSync(resolve(root, 'tokens.css'), 'utf8');

describe('the fonts', () => {
  it('are the system fonts: no font file is declared or loaded anywhere in the tokens', () => {
    expect(css).not.toContain('@font-face');
    expect(css).not.toMatch(/woff2?/);
    expect(JSON.stringify(tokens.type.family)).not.toMatch(/Savate|National Park/);
    expect(tokens.type.family.text.startsWith('-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI"')).toBe(true);
    expect(tokens.type.family.display.startsWith('-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI"')).toBe(true);
  });

  it('are the same on a canvas as in the stylesheets', () => {
    expect(FONT_TEXT).toBe(tokens.type.family.text);
    expect(FONT_DISPLAY).toBe(tokens.type.family.display);
    expect(css).toContain(`--ba-font-text: ${FONT_TEXT};`);
    expect(css).toContain(`--ba-font-display: ${FONT_DISPLAY};`);
  });

  it('keep headings and commands at 700 to 800 with normal letter spacing', () => {
    for (const k of ['display', 'display-heavy', 'numeric']) expect(tokens.type.weight[k], k).toBeGreaterThanOrEqual(700);
    for (const k of ['display', 'display-heavy']) expect(tokens.type.weight[k], k).toBeLessThanOrEqual(800);
    expect(tokens.type.tracking['display']).toBe('0');
    expect(tokens.type.tracking['display-xl']).toBe('0');
  });

  it('are written for a canvas as weight, size and stack', () => {
    expect(canvasFont(800, 31.6)).toBe(`800 32px ${FONT_DISPLAY}`);
    expect(canvasFont(400, 14, 'text')).toBe(`400 14px ${FONT_TEXT}`);
  });

  it('leave no stylesheet of the shell asking for a decorative face or a negative letter spacing', () => {
    for (const f of ['design/ui-kit/kit.css', 'design/ui-kit/shell.css', 'design/ui-kit/pages.css', 'design/onboarding/onboarding.css', 'packages/web/src/styles/app.css']) {
      const s = readFileSync(resolve(__dirname, '../../../', f), 'utf8');
      expect(s, f).not.toMatch(/letter-spacing:\s*-/);
      expect(s, f).not.toMatch(/font-weight:\s*(820|850|900)\b/);
      expect(s, f).not.toMatch(/Savate|National Park/);
    }
  });
});
