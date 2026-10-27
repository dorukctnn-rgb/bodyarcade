// Every content page, in the order the sitemap and the checks list them.
import type { PageSpec } from '../chrome.ts';
import { activeArcadeEn, activeArcadeTr } from './active-arcade.ts';
import { blogEn } from './blog.en.ts';
import { changelogEn, changelogTr } from './changelog.ts';
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
import { pricingEn } from './pricing.en.ts';
import { pricingTr } from './pricing.tr.ts';
import { privacyEn } from './privacy.en.ts';
import { privacyTr } from './privacy.tr.ts';
import { termsEn } from './terms.en.ts';
import { termsTr } from './terms.tr.ts';
import { seoAreasEn } from './seo-areas.en.ts';
import { seoAreasTr } from './seo-areas.tr.ts';
import { seoFriendsEn } from './seo-friends.en.ts';
import { seoFriendsTr } from './seo-friends.tr.ts';
import { seoHubEn } from './seo-hub.en.ts';
import { seoHubTr } from './seo-hub.tr.ts';
import { seoSeatedEn } from './seo-seated.en.ts';
import { seoSeatedTr } from './seo-seated.tr.ts';

export function allPages(): PageSpec[] {
  return [
    privacyEn(), privacyTr(), termsEn(), termsTr(), faqEn(), faqTr(), deleteAccountEn(), deleteAccountTr(),
    guideWebcamEn(), guideWebcamTr(), guideRingfitEn(), guideRingfitTr(),
    blogEn(), postBrowserEn(), postPrivacyEn(),
    seoHubEn(), seoHubTr(), seoSeatedEn(), seoSeatedTr(), seoFriendsEn(), seoFriendsTr(), seoAreasEn(), seoAreasTr(),
    pricingEn(), pricingTr(), changelogEn(), changelogTr(), activeArcadeEn(), activeArcadeTr(),
  ];
}
