// Every content page, in the order the sitemap and the checks list them.
import type { PageSpec } from '../chrome.ts';
import { blogEn } from './blog.en.ts';
import { deleteAccountEn } from './delete-account.en.ts';
import { deleteAccountTr } from './delete-account.tr.ts';
import { faqEn } from './faq.en.ts';
import { faqTr } from './faq.tr.ts';
import { guideRingfitEn } from './guide-ringfit.en.ts';
import { guideRingfitTr } from './guide-ringfit.tr.ts';
import { guideWebcamEn } from './guide-webcam.en.ts';
import { guideWebcamTr } from './guide-webcam.tr.ts';
import { postBrowserEn } from './post-browser.en.ts';
import { postPrivacyEn } from './post-privacy.en.ts';
import { privacyEn } from './privacy.en.ts';
import { privacyTr } from './privacy.tr.ts';
import { termsEn } from './terms.en.ts';
import { termsTr } from './terms.tr.ts';

export function allPages(): PageSpec[] {
  return [
    privacyEn(), privacyTr(), termsEn(), termsTr(), faqEn(), faqTr(), deleteAccountEn(), deleteAccountTr(),
    guideWebcamEn(), guideWebcamTr(), guideRingfitEn(), guideRingfitTr(),
    blogEn(), postBrowserEn(), postPrivacyEn(),
  ];
}
