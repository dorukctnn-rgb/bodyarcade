// The blog index (English): the posts and guides, newest first, each with the summary the page itself gives to search engines.
import { esc, type PageSpec } from '../chrome.ts';
import * as F from '../facts.ts';
import { ACTIVE_ARCADE_DATES, activeArcadeEn } from './active-arcade.ts';
import { GUIDE_RINGFIT_EN, guideRingfitEn } from './guide-ringfit.en.ts';
import { GUIDE_WEBCAM_EN, guideWebcamEn } from './guide-webcam.en.ts';
import { POST_BROWSER_EN, postBrowserEn } from './post-browser.en.ts';
import { POST_PRIVACY_EN, postPrivacyEn } from './post-privacy.en.ts';
import { seoClassroomEn } from './seo-extra-classroom.en.ts';
import { seoKidsEn } from './seo-extra-kids.en.ts';
import { seoKinectEn } from './seo-extra-kinect.en.ts';
import { seoPcEn } from './seo-extra-pc.en.ts';
import { EXTRA_DATES } from './seo-shared.ts';

export function blogEn(): PageSpec {
  const posts = [
    { spec: activeArcadeEn(), date: ACTIVE_ARCADE_DATES.published },
    { spec: postPrivacyEn(), date: POST_PRIVACY_EN.published },
    { spec: guideWebcamEn(), date: GUIDE_WEBCAM_EN.published },
    { spec: guideRingfitEn(), date: GUIDE_RINGFIT_EN.published },
    { spec: postBrowserEn(), date: POST_BROWSER_EN.published },
    // Release 5 (SEO): the four pages that answer one question each
    { spec: seoPcEn(), date: EXTRA_DATES.published },
    { spec: seoKinectEn(), date: EXTRA_DATES.published },
    { spec: seoClassroomEn(), date: EXTRA_DATES.published },
    { spec: seoKidsEn(), date: EXTRA_DATES.published },
  ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const list = `<ul class="posts">${posts.map((p) => `<li><h2><a href="${p.spec.url}">${esc(p.spec.h1)}</a></h2><p>${esc(p.spec.description)}</p><p class="when">${F.longDate(p.date, 'en')}</p></li>`).join('')}</ul>`;
  return {
    file: 'blog/index.html',
    url: '/blog/',
    lang: 'en',
    nav: 'blog',
    title: 'Blog',
    description: 'Guides and notes from the people who make BodyArcade: how camera workout games work, how to set up your room, and what happens to your video.',
    h1: 'Notes from the road',
    lead: 'Guides, design notes and updates from the people who make BodyArcade.',
    sections: [],
    after: list,
    toc: false,
    crumbs: [{ name: 'BodyArcade', url: '/' }, { name: 'Blog', url: '/blog/' }],
  };
}
