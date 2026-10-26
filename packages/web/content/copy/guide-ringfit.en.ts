// Guide: a Ring Fit Adventure alternative you can play in a browser (English). BodyArcade's side comes from the catalogue and the
// plans; Ring Fit's side is what Nintendo sells and says about the game, kept to what everyone knows about it.
import { articleLd, cta, faqLd, qa, readMinutes, table, ul, type PageSpec, type Section } from '../chrome.ts';
import * as F from '../facts.ts';
import { gameCounts, gameList, roundLength } from './games.ts';

export const GUIDE_RINGFIT_EN = { published: '2026-09-24', modified: F.UPDATED };

export function guideRingfitEn(): PageSpec {
  const c = gameCounts();
  const $ = (n: number): string => F.usd(n, 'en');
  const faq = [
    {
      q: 'Is BodyArcade a replacement for Ring Fit Adventure?',
      a: '<p>Not exactly. Ring Fit Adventure is a long role-playing game with resistance exercises that use the Ring-Con. BodyArcade is a set of short camera games for legs, arms, core and balance. It suits people who want quick, active games without buying a console or accessories.</p>',
    },
    {
      q: 'Do I need any accessories for BodyArcade?',
      a: '<p>No. BodyArcade uses the camera on your laptop, desktop, tablet or phone. Pose detection runs on your device, and the video stays there.</p>',
    },
    {
      q: 'Which is the better workout?',
      a: '<p>They train different things. Ring Fit adds resistance through the Ring-Con and has a wide range of strength and yoga-style moves. BodyArcade is short rounds of whole-body movement without resistance. Many people will enjoy both.</p>',
    },
  ];
  const sections: Section[] = [
    {
      id: 'glance',
      title: 'At a glance',
      html: table(null, ['Topic', 'Ring Fit Adventure', 'BodyArcade'], [
        ['What you need', 'A Nintendo Switch, Joy-Con controllers, and the Ring-Con and Leg Strap that come with the game', 'A laptop, desktop, tablet or phone with a camera and a browser'],
        ['How it tracks you', 'Motion sensors in the Joy-Con, plus a force sensor in the Ring-Con that detects squeezing and pulling', `The camera and an on-device pose model that finds ${F.MODEL_POINTS} points on your body`],
        ['Type of game', 'Role-playing adventure with battles, levels and mini-games', `${c.total} short arcade games for legs, arms, core and balance`],
        ['Session length', 'As long as you like; the adventure levels suit longer sessions', `Rounds from ${roundLength(c.shortest, 'en')} to ${roundLength(c.longest, 'en')}`],
        ['Cost', 'A one-time purchase of the game, plus the console', `${c.free} of ${c.total} games are free, with no ads. Pro is ${$(F.PRICE.proMonthly)} a month, ${$(F.PRICE.proYearly)} a year or ${$(F.PRICE.lifetime)} once`],
      ]),
    },
    {
      id: 'ringfit',
      title: 'Where Ring Fit Adventure is stronger',
      html: ul([
        '<strong>Resistance.</strong> Squeezing and pulling the Ring-Con adds a strength element that a camera cannot give you.',
        '<strong>Variety.</strong> It has a large library of exercises, from squats and planks to yoga-style poses.',
        '<strong>Story and progression.</strong> The adventure mode gives you a reason to come back for weeks.',
        '<strong>No framing.</strong> The Joy-Con tracks you wherever you stand and in any light.',
      ]),
    },
    {
      id: 'bodyarcade',
      title: 'Where BodyArcade is stronger',
      html: ul([
        '<strong>Nothing to buy.</strong> It runs on the laptop, desktop, tablet or phone you already have.',
        '<strong>Quick to start.</strong> Open the page, allow the camera and play. The first visit adds a welcome tour of about two minutes. There is nothing to install and no account to make.',
        `<strong>Short rounds.</strong> A round lasts from ${roundLength(c.shortest, 'en')} to ${roundLength(c.longest, 'en')}, so it works as a desk break or a quick warm-up.`,
        `<strong>Seated and quiet.</strong> Every game has a seated version, and ${c.quiet} of ${c.total} can be played without jumping or stamping.`,
        '<strong>Play together.</strong> Two people can share one camera on a big screen, and friends can join an online room of two to four players.',
      ]),
    },
    {
      id: 'games',
      title: 'What BodyArcade asks your body to do',
      html: `<p>${c.total} games, each with its own move. ${c.free} are free; the others are part of Pro, and you can play each of them once for free.</p>
${table(null, ['Game', 'What you do', 'Round', 'Plan'], gameList('en').map((g) => [g.title, g.tagline, roundLength(g.seconds, 'en'), g.free ? (g.id === 'road-run' ? `Free, ${F.ROAD_RUN_WORLDS.free} of ${F.ROAD_RUN_WORLDS.total} worlds` : 'Free') : 'Pro']))}`,
    },
    {
      id: 'setup',
      title: 'Setting up a camera-based workout',
      html: `${ul([
  '<strong>Distance.</strong> Stand where the camera sees your head to your ankles: 2 to 3 metres from a laptop or 1.5 to 2 metres from an upright phone.',
  '<strong>Light.</strong> Face a window or a lamp. Strong light behind you makes tracking less reliable.',
  '<strong>Stability.</strong> Put the laptop or phone on a table or shelf so it does not move while you do.',
  '<strong>Footwear and floor.</strong> Trainers on a floor that is not slippery, with about 2 metres clear around you.',
])}
<p>More on this in <a href="/webcam-fitness-games">how webcam fitness games work, and how to set up your room</a>.</p>`,
    },
    {
      id: 'faq',
      title: 'Frequently asked questions',
      html: faq.map((i) => qa(i.q, i.a)).join('\n'),
    },
  ];
  const title = 'A Ring Fit Adventure alternative you can play in a browser';
  const description = 'An honest comparison of Ring Fit Adventure and BodyArcade: what you need, how each tracks you, the kind of workout, and what each costs.';
  const lead = 'Ring Fit Adventure is one of the best-loved fitness games ever made. It also needs a Nintendo Switch, its Joy-Con controllers, and the Ring-Con and Leg Strap that come in the box. If you do not own a Switch, or you want something you can start on a laptop you already have, you will want a different kind of game.';
  const minutes = readMinutes(lead + sections.map((s) => s.html).join(' '));
  return {
    file: 'ring-fit-adventure-alternative.html',
    url: '/ring-fit-adventure-alternative',
    lang: 'en',
    other: { lang: 'tr', url: '/tr/ring-fit-adventure-alternatifi' },
    nav: 'blog',
    og: 'article',
    title,
    description,
    h1: title,
    when: `Updated ${F.longDate(GUIDE_RINGFIT_EN.modified, 'en')} &middot; ${minutes} min read`,
    lead: `${lead} BodyArcade is our answer to that. It is a set of short camera games and makes no attempt to copy Ring Fit. Here is an honest comparison, so you can decide which one fits you.`,
    sections,
    toc: true,
    after: cta('A round takes a couple of minutes and needs nothing but a camera.', '/', 'Play a game'),
    crumbs: [{ name: 'BodyArcade', url: '/' }, { name: 'Blog', url: '/blog/' }, { name: 'Ring Fit Adventure alternative', url: '/ring-fit-adventure-alternative' }],
    jsonLd: [
      articleLd({ headline: title, description, url: '/ring-fit-adventure-alternative', published: GUIDE_RINGFIT_EN.published, modified: GUIDE_RINGFIT_EN.modified, lang: 'en' }),
      faqLd(faq),
    ],
  };
}
