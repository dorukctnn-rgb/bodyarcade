// Blog post: why browser fitness games are the future of home workouts (English). Written in May 2026, brought up to date for the
// second version of BodyArcade; the parts that were predictions in May and are products now say so.
import { articleLd, cta, readMinutes, ul, type PageSpec, type Section } from '../chrome.ts';
import * as F from '../facts.ts';
import { gameCounts, titlesOf } from './games.ts';

export const POST_BROWSER_EN = { published: '2026-05-11', modified: F.UPDATED };

export function postBrowserEn(): PageSpec {
  const c = gameCounts();
  const live = titlesOf((g) => g.live, 'en');
  const sections: Section[] = [
    {
      id: 'hardware',
      title: 'The hardware problem nobody wants to admit',
      html: `<p>Wii Fit and Kinect sold tens of millions of units, and neither is on shelves today. Most fitness hardware follows the same arc: people buy it with good intentions, use it for a couple of weeks, and then it lives in a cupboard. Finding the device, connecting it and committing to a session is too much friction for something you want to do every day.</p>
<p>Premium fitness mirrors and bikes face the same problem. A device that costs as much as a holiday and gets used a few times a year is an expensive coat rack.</p>`,
    },
    {
      id: 'platform',
      title: 'What changed: the browser became a real platform',
      html: `<p>In the last few years four technologies met:</p>
${ul([
  'WebGL, and WebGPU in newer browsers: real-time graphics in a tab.',
  'MediaPipe and similar libraries: real-time pose detection from an ordinary camera, running on your device.',
  'getUserMedia: camera access with no install.',
  'Service workers and web apps: fast, installable pages that keep working offline.',
])}
<p>Together they give you something that did not exist before: a motion-controlled game that needs no download, no extra hardware and no setup. Open a link, allow the camera, start moving.</p>`,
    },
    {
      id: 'friction',
      title: 'The friction test',
      html: `<p>Time it. Open a typical fitness app on your phone: download it, sign up, create a profile, pick a workout, allow notifications and health permissions. That is minutes before the first squat.</p>
<p>BodyArcade needs no account. The first visit has a short welcome tour for the room, the camera permission and the calibration, about two minutes in all, and then you play. After that the files are on your device. That drop in friction is the whole story.</p>`,
    },
    {
      id: 'game',
      title: 'Gamification that works',
      html: `<p>Fitness apps have called themselves gamified for more than a decade: streaks, badges, leaderboards. It rarely lasts, because the activity underneath is still a workout with stickers on it.</p>
<p>A real movement game turns that around. The activity is the game. In BodyArcade you stand up from a squat to flap a bird through gaps, run on the spot with high knees, catch stars with the hand of their colour, or make the shape before a wall reaches you. The exercise is the gameplay.</p>`,
    },
    {
      id: 'together',
      title: 'Playing together',
      html: `<p>In May we expected live multiplayer movement games to arrive. They are here. In BodyArcade friends can race live in a room of two to four players (${live}), two people can share one camera on a big screen, and everyone can race a recording of their own best run. Your camera video stays on your device throughout; what other players receive is a score and a skeleton of ${F.SHARED_JOINTS} joints.</p>`,
    },
    {
      id: 'next',
      title: 'Where this goes',
      html: `<p>We expect to see more of this over the next few years:</p>
${ul([
  'PE lessons that run browser-based motion games on school laptops.',
  'Physical therapy exercises delivered as games tuned to each patient&rsquo;s range of motion.',
  'Workplace wellness programmes that use short web games instead of gym stipends.',
])}
<p>None of it needs new hardware or an app store. It works on devices people already own. BodyArcade has ${c.total} games today, ${c.free} of them free, and adds more over time.</p>`,
    },
  ];
  const title = 'Why browser fitness games are the future of home workouts';
  const description = 'No app stores, no consoles, no equipment: just a camera and a tab. Why the browser became a real platform for movement games.';
  const lead = 'For decades, fitness gaming meant buying a console, a sensor bar, a special mat or an expensive smart mirror. That era is ending. More home workouts will happen inside a browser tab, and we are closer to that than most people realise.';
  const minutes = readMinutes(lead + sections.map((s) => s.html).join(' '));
  return {
    file: 'blog/why-browser-fitness-games-are-the-future.html',
    url: '/blog/why-browser-fitness-games-are-the-future',
    lang: 'en',
    nav: 'blog',
    og: 'article',
    title,
    description,
    h1: title,
    when: `${F.longDate(POST_BROWSER_EN.published, 'en')}, updated ${F.longDate(POST_BROWSER_EN.modified, 'en')} &middot; ${minutes} min read`,
    lead,
    sections,
    toc: false,
    after: cta('A round takes a couple of minutes and needs nothing but a camera.', '/', 'Play a game'),
    crumbs: [{ name: 'BodyArcade', url: '/' }, { name: 'Blog', url: '/blog/' }, { name: 'Browser fitness games', url: '/blog/why-browser-fitness-games-are-the-future' }],
    jsonLd: [articleLd({ headline: title, description, url: '/blog/why-browser-fitness-games-are-the-future', published: POST_BROWSER_EN.published, modified: POST_BROWSER_EN.modified, lang: 'en' })],
  };
}
