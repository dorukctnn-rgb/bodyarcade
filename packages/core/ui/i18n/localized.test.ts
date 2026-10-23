import { describe, expect, it } from 'vitest';
import { hasLanguage, localized } from './localized.ts';

describe('localized text', () => {
  it('plain text is the same in every language', () => {
    expect(localized('Squat Flap', 'tr')).toBe('Squat Flap');
    expect(hasLanguage('Squat Flap', 'de')).toBe(true);
  });

  it('picks the language, then English, then anything', () => {
    expect(localized({ en: 'Hello', tr: 'Merhaba' }, 'tr')).toBe('Merhaba');
    expect(localized({ en: 'Hello', tr: 'Merhaba' }, 'fr')).toBe('Hello');
    expect(localized({ tr: 'Merhaba' }, 'fr')).toBe('Merhaba');
    expect(localized(undefined, 'en')).toBe('');
  });

  it('says whether a language has its own text', () => {
    expect(hasLanguage({ en: 'a' }, 'tr')).toBe(false);
    expect(hasLanguage({ en: 'a', tr: 'b' }, 'tr')).toBe(true);
    expect(hasLanguage(undefined, 'en')).toBe(false);
  });
});
