// Every content page, in the order the sitemap and the checks list them.
import type { PageSpec } from '../chrome.ts';
import { faqEn } from './faq.en.ts';
import { faqTr } from './faq.tr.ts';
import { privacyEn } from './privacy.en.ts';
import { privacyTr } from './privacy.tr.ts';
import { termsEn } from './terms.en.ts';
import { termsTr } from './terms.tr.ts';

export function allPages(): PageSpec[] {
  return [privacyEn(), privacyTr(), termsEn(), termsTr(), faqEn(), faqTr()];
}
