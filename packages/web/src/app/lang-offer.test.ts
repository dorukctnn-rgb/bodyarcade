import { describe, expect, it } from 'vitest';
import { languageOffer } from './lang-offer.ts';

describe('the language bar offer', () => {
  it('offers the browser language on an English page when the visitor never chose one, and the chosen language when they did', () => {
    expect(languageOffer('auto', 'tr', 'en')).toBe('tr');
    expect(languageOffer('tr', 'en', 'en')).toBe('tr');
  });

  it('offers nothing to a visitor who keeps English, when the browser prefers English, on a page that is not the English one, or for a draft language', () => {
    expect(languageOffer('en', 'tr', 'en')).toBeNull();
    expect(languageOffer('auto', 'en', 'en')).toBeNull();
    expect(languageOffer('auto', 'tr', 'tr')).toBeNull();
    expect(languageOffer('tr', 'tr', 'tr')).toBeNull();
    expect(languageOffer('de', 'de', 'en')).toBeNull();
  });
});
