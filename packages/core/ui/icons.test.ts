import { describe, expect, it } from 'vitest';
import { ICON_NAMES, icon } from './icons.ts';

describe('icons', () => {
  it('has the icons the shell uses', () => {
    for (const n of ['arcade', 'friends', 'settings', 'close', 'back', 'lock', 'play', 'pause', 'camera', 'cameraOff', 'chair', 'quiet', 'users', 'check', 'key', 'moon', 'sun'] as const) {
      expect(ICON_NAMES).toContain(n);
    }
  });

  it.each(ICON_NAMES)('%s is one decorative, self-contained svg', (name) => {
    const s = icon(name).value;
    expect(s.startsWith('<svg ')).toBe(true);
    expect(s.endsWith('</svg>')).toBe(true);
    expect(s).toContain('aria-hidden="true"');
    expect(s).toContain('viewBox="0 0 24 24"');
    expect(s).not.toMatch(/<script|\son\w+=|javascript:|href=/i);
    const opens = (s.match(/<(?!\/)[a-z]+/g) ?? []).length;
    const selfClosing = (s.match(/\/>/g) ?? []).length;
    const closes = (s.match(/<\/[a-z]+>/g) ?? []).length;
    expect(opens).toBe(selfClosing + closes);
  });

  it('sets a size and a class, and never lets a class break out of the attribute', () => {
    const s = icon('play', { size: 20, className: 'big" onload="x' }).value;
    expect(s).toContain('width="20" height="20"');
    expect(s).toContain('class="big onloadx"');
    expect(s).not.toContain('"x"');
  });
});
