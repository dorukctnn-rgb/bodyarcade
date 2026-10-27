// Prices (English): what is free, what Pro adds and what each plan costs on the web, as text a person, a search engine and an AI
// assistant can read without running the app (the Pro screen of the app is drawn by scripts and is not indexed). Every price, day
// count and device count comes from facts.ts, which content.test.ts compares with the plans of the code; the games come from the
// catalogue snapshot and the workout plans from core/store/workout-plans.ts. Inside the Android app (twa.js) the web prices and the
// web shop are hidden, and the page says that Google Play sets the price there.
import { WORKOUT_PLANS, FREE_PLAN_ID } from '../../../core/store/workout-plans.ts';
import { localized } from '../../../core/ui/i18n/localized.ts';
import { cta, faqLd, link, mail, qa, table, ul, type PageSpec, type Section } from '../chrome.ts';
import * as F from '../facts.ts';
import { gameCounts, listWords, titlesOf } from './games.ts';

/** The day the prices on this page were last checked against the plans of the code (ISO). Bump it with any change of price. */
export const PRICING_DATES = { published: '2026-10-27', modified: '2026-10-27' } as const;

export const PRICING_URL = { en: '/pricing', tr: '/tr/fiyatlar' } as const;

/** The monthly cost of a yearly price and what the yearly plan saves against twelve months, as the paywall computes them (core/ui/plans.ts). */
export const perMonthOf = (yearly: number): number => Math.round((yearly / 12) * 100) / 100;
export const yearlySaves = (monthly: number, yearly: number): number => Math.round((1 - yearly / (monthly * 12)) * 100);

/** schema.org: the app and its offers on the web, in US dollars. */
export function pricingLd(lang: F.Lang, name: Record<'free' | 'monthly' | 'yearly' | 'family' | 'lifetime', string>): object {
  const offer = (n: string, price: number): object => ({ '@type': 'Offer', name: n, price: price.toFixed(2), priceCurrency: 'USD', url: `${F.SITE}${PRICING_URL[lang]}` });
  return {
    '@type': 'WebApplication',
    name: 'BodyArcade',
    url: `${F.SITE}${lang === 'en' ? '/' : '/tr/'}`,
    applicationCategory: 'GameApplication',
    operatingSystem: 'Web browser',
    inLanguage: lang,
    offers: [
      offer(name.free, 0),
      offer(name.monthly, F.PRICE.proMonthly),
      offer(name.yearly, F.PRICE.proYearly),
      ...(F.FAMILY_PLAN ? [offer(name.family, F.PRICE.familyYearly)] : []),
      offer(name.lifetime, F.PRICE.lifetime),
    ],
  };
}

export function pricingEn(): PageSpec {
  const lang = 'en';
  const c = gameCounts();
  const W = F.ROAD_RUN_WORLDS;
  const $ = (n: number): string => F.usd(n, lang);
  const proPlans = WORKOUT_PLANS.filter((p) => p.id !== FREE_PLAN_ID).map((p) => localized(p.title, lang));
  const freePlan = WORKOUT_PLANS.find((p) => p.id === FREE_PLAN_ID);
  const memberships = F.FAMILY_PLAN ? 'a Pro monthly, Pro yearly or Family yearly' : 'a Pro monthly or Pro yearly';
  const asOf = F.longDate(PRICING_DATES.modified, lang);

  const plans = table(null, ['Plan', 'Price', 'Free trial', 'Devices and profiles'], [
    ['Pro monthly', `<span class="nw">${$(F.PRICE.proMonthly)} a month</span>`, 'None', `Up to ${F.DEVICES.pro} devices`],
    ['Pro yearly', `<span class="nw">${$(F.PRICE.proYearly)} a year</span>, about ${$(perMonthOf(F.PRICE.proYearly))} a month, ${yearlySaves(F.PRICE.proMonthly, F.PRICE.proYearly)}% less than twelve months of Pro monthly`, `${F.TRIAL_DAYS} days`, `Up to ${F.DEVICES.pro} devices`],
    ...(F.FAMILY_PLAN ? [['Family yearly', `<span class="nw">${$(F.PRICE.familyYearly)} a year</span>`, 'None', `${F.FAMILY_PROFILES} profiles on each of up to ${F.DEVICES.family} devices`]] : []),
    ['Lifetime', `<span class="nw">${$(F.PRICE.lifetime)} once</span>, no renewals`, 'None', `Up to ${F.DEVICES.pro} devices`],
  ]);

  const sections: Section[] = [
    {
      id: 'free',
      title: 'What is free',
      html: ul([
        `<strong>${c.free} of the ${c.total} games:</strong> ${titlesOf((g) => g.free, lang)}. Road Run has ${W.total} worlds, and ${W.free} of them are free.`,
        '<strong>Their seated and quiet versions</strong>, and the Easy and Normal difficulties.',
        `<strong>Live races with friends</strong> in ${titlesOf((g) => g.live && g.free, lang)}${c.proLive > 0 ? `, and in ${titlesOf((g) => g.live && !g.free, lang)} when the host of the room has Pro` : ''}. Playing online needs an online profile, from the age of ${F.AGE.online}.`,
        `<strong>The ${freePlan ? localized(freePlan.title, lang) : 'free'} workout plan</strong>, and one free round of each Pro game.`,
        '<strong>No ads and no account.</strong> You can play without signing up; an online profile is only for playing with friends.',
      ]),
    },
    {
      id: 'pro',
      title: 'What Pro adds',
      html: ul([
        `The Pro games: ${titlesOf((g) => !g.free, lang)}.`,
        `${proPlans.length} more workout plans: ${listWords(proPlans, lang)}.`,
        'The Hard and Expert difficulties.',
        `The other ${W.total - W.free} Road Run worlds.`,
        `The games we add later, while ${memberships} membership is active, and on the Lifetime plan. The ${link(PAGES_CHANGELOG.en, 'release notes')} list what was added and when.`,
      ]),
    },
    {
      id: 'plans',
      title: 'The plans and their prices',
      html: `<div data-web-pay><p>Prices on the web, in US dollars, as of ${asOf}. Gumroad sells the plans on the web.</p>
${plans}</div>
<p>In the Android app, Google Play sets the price and the currency for your country, and you pay through Google Play.</p>`,
    },
    {
      id: 'trial',
      title: 'The free trial, cancelling and refunds',
      html: ul([
        `<strong>Trial.</strong> Pro yearly starts with ${F.TRIAL_DAYS} days free, and nothing is charged during the trial. If you do not cancel before it ends, the first year is charged. We remind you ${F.REMINDER_DAYS} days before the end with a notice in the app${F.REMINDER_MAIL ? ', and on the web with one e-mail if you leave an address' : ''}.`,
        '<strong>Cancelling.</strong> <span data-web-pay>On the web, open your Gumroad library, choose BodyArcade and select Manage membership. </span>In the Android app, cancel in Google Play subscriptions. Pro stays on until the end of the period you paid for.',
        `<strong>Refunds.</strong> <span data-web-pay>Every plan bought on the web can be refunded within ${F.REFUND_DAYS} days of buying it. Gumroad makes the refund, and you can write to ${mail()} for help. </span>On Google Play, Google&rsquo;s rules apply.`,
      ]),
    },
    {
      id: 'earlier',
      title: 'If you bought before these plans',
      html: `<p>Nothing is taken from you. <span data-web-pay>If you pay ${$(F.PRICE.legacyMonthly)} a month, you keep paying ${$(F.PRICE.legacyMonthly)} for as long as that membership runs without a break. If you bought Lifetime for ${$(F.PRICE.founder)}, you are a Founder. </span>Founders have Pro for as long as BodyArcade is offered, every game added later, ${F.FAMILY_PROFILES} profiles and up to ${F.DEVICES.founder} devices.</p>`,
    },
  ];

  const faq = [
    {
      q: 'Is BodyArcade free?',
      a: `<p>Yes, ${c.free} of its ${c.total} games are free for good, with no ads and no account. Pro is the paid part: more games, more workout plans, the hardest difficulties and the games added later.</p>`,
    },
    {
      q: 'Which plan should I choose?',
      a: `<p>Pro yearly costs the least over a year and is the only plan with a free trial. Pro monthly suits a try of a month or two. ${F.FAMILY_PLAN ? `Family yearly is for a home where several people play on the same devices, each with their own profile and results. ` : ''}Lifetime is one payment with no renewals.</p>`,
    },
    {
      q: 'Can I play a Pro game before I pay?',
      a: '<p>Yes. Each Pro game can be played once for free, so you can see how the camera reads you in it before you decide.</p>',
    },
    {
      q: 'Where do I find the plans in the app?',
      a: `<p>Open the ${link('/pro/', 'Pro')} page of the app. It shows the plans that can be bought where you are: on the web the ones above, in the Android app Google Play&rsquo;s.</p><p>The ${link('/faq', 'FAQ')} answers the other questions about payments.</p>`,
    },
  ];
  sections.push({ id: 'questions', title: 'Questions about the prices', html: faq.map((i) => qa(i.q, i.a)).join('\n') });

  const title = 'BodyArcade prices: the free games and the Pro plans';
  const description = `${c.free} of ${c.total} games are free. Pro on the web: ${$(F.PRICE.proMonthly)} a month, ${$(F.PRICE.proYearly)} a year with a ${F.TRIAL_DAYS}-day trial, or ${$(F.PRICE.lifetime)} once. What each plan includes.`;
  return {
    file: 'pricing.html',
    url: PRICING_URL.en,
    lang,
    other: { lang: 'tr', url: PRICING_URL.tr },
    title,
    description,
    h1: 'Prices',
    when: `Prices as of ${asOf}`,
    lead: `BodyArcade has a free core and one paid upgrade, Pro. ${c.free} of the ${c.total} games are free and stay free. <span data-web-pay>On the web Pro costs ${$(F.PRICE.proMonthly)} a month, ${$(F.PRICE.proYearly)} a year with ${F.TRIAL_DAYS} days free, ${F.FAMILY_PLAN ? `${$(F.PRICE.familyYearly)} a year for the Family plan, ` : ''}or ${$(F.PRICE.lifetime)} once.</span>`,
    sections,
    toc: true,
    after: cta('Start with a free game. Pro can wait until you know you like it.', '/', 'Play a free game'),
    crumbs: [{ name: 'BodyArcade', url: '/' }, { name: 'Prices', url: PRICING_URL.en }],
    jsonLd: [pricingLd(lang, { free: 'Free games', monthly: 'Pro monthly', yearly: 'Pro yearly', family: 'Family yearly', lifetime: 'Lifetime' }), faqLd(faq)],
  };
}

/** The release notes, which the prices page points to for the games added later. */
export const PAGES_CHANGELOG = { en: '/changelog', tr: '/tr/surum-notlari' } as const;
