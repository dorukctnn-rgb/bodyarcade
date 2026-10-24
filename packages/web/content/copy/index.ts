// Every content page, in the order the sitemap and the checks list them.
import type { PageSpec } from '../chrome.ts';
import { privacyEn } from './privacy.en.ts';
import { privacyTr } from './privacy.tr.ts';

export function allPages(): PageSpec[] {
  return [privacyEn(), privacyTr()];
}
