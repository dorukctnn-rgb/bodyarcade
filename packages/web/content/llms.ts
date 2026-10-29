// /llms.txt: a short plain-text map of the site for AI assistants (llmstxt.org), written by build.ts next to the pages. Every number
// is the one the pages use (facts.ts, the catalogue snapshot, the workout plans), so the file cannot say other prices or counts than
// the site; content.test.ts checks it against them. Google does not use it for search; it costs one small file.
import { FREE_PLAN_ID, WORKOUT_PLANS } from '../../core/store/workout-plans.ts';
import { localized } from '../../core/ui/i18n/localized.ts';
import * as F from './facts.ts';
import { ACTIVE_ARCADE_URL, LATEST_RELEASE } from './copy/changelog.ts';
import { gameCounts, titlesOf } from './copy/games.ts';
import { PAGES_CHANGELOG, PRICING_DATES, PRICING_URL } from './copy/pricing.en.ts';
import { EXTRA_NAME, EXTRA_URL, GUIDE_URL, SEO_URL } from './copy/seo-shared.ts';

export function llmsTxt(): string {
  const c = gameCounts();
  const $ = (n: number): string => F.usd(n, 'en');
  const free = WORKOUT_PLANS.find((p) => p.id === FREE_PLAN_ID);
  const u = (path: string): string => `${F.SITE}${path}`;
  return [
    '# BodyArcade',
    '',
    `> BodyArcade is a set of ${c.total} short fitness games you play with your body in a web browser, on a phone, tablet, laptop or desktop. A webcam or phone camera reads your moves on your own device and the video is not uploaded. ${c.free} of the ${c.total} games are free, every game has a seated version, and friends can race live in rooms of ${F.SEATS.min} to ${F.SEATS.max} players. Made by ${F.OWNER}, trading as ${F.STUDIO} (${F.COUNTRY}). English and Turkish.`,
    '',
    '## Main pages',
    `- [Games](${u('/')}): the ${c.total} games by body area, free and Pro`,
    `- [Prices](${u(PRICING_URL.en)}): the free workout games, what Pro adds, the plans and their prices`,
    `- [FAQ](${u('/faq')}): set-up, privacy, friends and rooms, plans, the trial, refunds`,
    `- [Fitness games](${u(SEO_URL.en.hub)}): every game, what it asks of you and which to start with`,
    `- [Seated exercise games](${u(SEO_URL.en.seated)}): every game from a chair`,
    `- [Workout games with friends](${u(SEO_URL.en.friends)}): online rooms, two players on one camera, ghost races`,
    `- [Workout games by body area](${u(SEO_URL.en.areas)}): legs, arms, chest and back, core, cardio, mobility`,
    `- [How webcam fitness games work](${u(GUIDE_URL.en)}): how the camera reads your body and how to set up your room`,
    `- [Ring Fit Adventure alternative](${u('/ring-fit-adventure-alternative')}): a comparison`,
    `- [Active Arcade alternative for Android and PC](${u(ACTIVE_ARCADE_URL.en)}): a comparison, with sources`,
    `- [${EXTRA_NAME.pc.name}](${u(EXTRA_URL.pc)}): what a laptop or desktop needs, the games for a desk and the ones that need floor space`,
    `- [${EXTRA_NAME.kinect.name}](${u(EXTRA_URL.kinect)}): what a webcam reads next to a depth sensor, and the games it runs`,
    `- [Workout plans](${u('/plans/')}): ready sessions of games with rests; ${free ? localized(free.title, 'en') : 'one'} is free`,
    `- [Updates](${u(PAGES_CHANGELOG.en)}): new games and changes, release by release; the last release was on ${F.longDate(LATEST_RELEASE.day, 'en')}`,
    `- [Privacy policy](${u('/privacy')}), [Terms](${u('/terms')})`,
    '',
    `## Plans on the web (US dollars, as of ${F.longDate(PRICING_DATES.modified, 'en')})`,
    `- Free: ${c.free} of ${c.total} games (${titlesOf((g) => g.free, 'en')}), with seated and quiet versions, no ads and no account`,
    `- Pro monthly ${$(F.PRICE.proMonthly)} a month`,
    `- Pro yearly ${$(F.PRICE.proYearly)} a year, with a ${F.TRIAL_DAYS}-day free trial`,
    ...(F.FAMILY_PLAN ? [`- Family yearly ${$(F.PRICE.familyYearly)} a year, ${F.FAMILY_PROFILES} profiles on up to ${F.DEVICES.family} devices`] : []),
    `- Lifetime ${$(F.PRICE.lifetime)} once`,
    `- Pro adds ${titlesOf((g) => !g.free, 'en')}, ${WORKOUT_PLANS.length - 1} more workout plans, the Hard and Expert difficulties and the games added later. Refunds within ${F.REFUND_DAYS} days of buying on the web. In the Android app, Google Play sets the price.`,
    '',
    '## Türkçe',
    `- [Ana sayfa](${u('/tr/')}), [Fiyatlar](${u(PRICING_URL.tr)}), [Sık sorulan sorular](${u('/tr/faq')}), [Evde spor oyunları](${u(SEO_URL.tr.hub)}), [Güncellemeler](${u(PAGES_CHANGELOG.tr)})`,
    '',
    `## Contact`,
    `- ${F.EMAIL}`,
    '',
  ].join('\n');
}
