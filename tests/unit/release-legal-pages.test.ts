// The content pages the release layout and axe checks add to their lists (tests/release/support.ts legalPages): the FAQ, the Turkish privacy,
// terms and FAQ, and the delete-account page in both languages, each only when the build's sitemap lists it.
import { describe, expect, it } from 'vitest';
import { LEGAL_EXTRA, legalPages } from '../release/support.ts';

describe('legalPages', () => {
  it('names the FAQ and the Turkish legal pages, the delete-account page, and (release 3) the prices, the release notes and the Active Arcade page in both languages', () => {
    expect(LEGAL_EXTRA.map(([, path]) => path)).toEqual(['/faq', '/tr/privacy', '/tr/terms', '/tr/faq', '/delete-account', '/tr/delete-account',
      '/pricing', '/tr/fiyatlar', '/changelog', '/tr/surum-notlari', '/active-arcade-alternative', '/tr/active-arcade-alternatifi']);
  });
  it('keeps the ones the sitemap lists and drops the ones it does not (a build from before the delete-account page)', () => {
    const before = legalPages(['/', '/privacy', '/faq', '/tr/privacy', '/tr/terms', '/tr/faq']);
    expect(before.map(([name]) => name)).toEqual(['faq', 'privacy-tr', 'terms-tr', 'faq-tr']);
    const now = legalPages(['/faq', '/tr/faq', '/delete-account', '/tr/delete-account']);
    expect(now.map(([, path]) => path)).toEqual(['/faq', '/tr/faq', '/delete-account', '/tr/delete-account']);
  });
  it('with no build to ask it names the pages every build has, never the newest', () => {
    const none = legalPages(null);
    expect(none.map(([name]) => name)).toEqual(['faq', 'privacy-tr', 'terms-tr', 'faq-tr']);
  });
  it('every name is unique, so the evidence file and the picture of each page keep their own entry', () => {
    const names = LEGAL_EXTRA.map(([name]) => name);
    expect(new Set(names).size).toBe(names.length);
    expect(legalPages().every(([name]) => names.includes(name))).toBe(true);
  });
});
