// Search page: a Kinect alternative for PC (English only). Target queries, from Google suggest on 29 Oct 2026: kinect alternative, kinect
// alternative for pc, kinect alternative for pc fitness games, kinect alternative webcam. The facts about Kinect are the ones public pages
// state (SOURCES, with the day they were read); every other sentence about it says what BodyArcade is, not what Kinect was. Counts, names
// and rounds come from the catalogue snapshot; content.test.ts compares them.
import { articleLd, cta, faqLd, figure, link, qa, readMinutes, table, ul, type PageSpec, type Section } from '../chrome.ts';
import * as F from '../facts.ts';
import { gameCounts, roundLength } from './games.ts';
import { EXTRA_DATES, EXTRA_NAME, EXTRA_URL, GUIDE_URL, MOVE, SHOT, extraFile, extraMore, gameLink, games, seoLink, shotSrc } from './seo-shared.ts';

/** The public pages the Kinect sentences rest on, and the day they were read. */
export const KINECT_SOURCES = {
  read: '2026-10-29',
  wikipedia: { name: 'Kinect (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Kinect', says: 'Microsoft announced on 25 October 2017 that it would stop making Kinect for Xbox One, and the Azure Kinect hardware kit was discontinued in October 2023.' },
  learn: { name: 'Azure Kinect DK documentation (Microsoft Learn, previous versions)', url: 'https://learn.microsoft.com/en-us/previous-versions/azure/kinect-dk/', says: 'The Azure Kinect DK has a depth sensor, a spatial microphone array with a video camera, and an orientation sensor.' },
} as const;

export function seoKinectEn(): PageSpec {
  const lang = 'en';
  const c = gameCounts();
  const all = games(lang);
  const S = KINECT_SOURCES;

  const sections: Section[] = [
    {
      id: 'kinect',
      title: 'What happened to Kinect',
      html: `<p>Microsoft announced on 25 October 2017 that it would stop making Kinect for Xbox One, and the Azure Kinect developer kit was discontinued in October 2023. If your Kinect still works, nothing here asks you to stop using it. If you are looking for body-controlled games on a PC without hunting for a sensor, a webcam does the job, and most laptops have one built in.</p>
<p>Sources, read on ${F.longDate(S.read, lang)}: <a href="${S.wikipedia.url}" rel="noopener">${S.wikipedia.name}</a> for the dates, and <a href="${S.learn.url}" rel="noopener">${S.learn.name}</a> for what the Azure Kinect DK contains.</p>`,
    },
    {
      id: 'webcam',
      title: 'What a webcam reads next to a depth sensor',
      html: `<p>Microsoft&rsquo;s own documentation lists a depth sensor, a video camera, a microphone array and an orientation sensor in the Azure Kinect DK. An ordinary webcam gives you a flat colour picture and no depth. BodyArcade reads that picture with Google&rsquo;s MediaPipe Pose Landmarker and finds ${F.MODEL_POINTS} points on your body, such as the shoulders, elbows, wrists, hips, knees and ankles. It does this on your device, and the video is never uploaded.</p>
${figure({ src: shotSrc('camera-check-desktop'), alt: 'The camera check of BodyArcade: a light body outline on a dark screen with dashed edges, a list of Head, Hips, Knees and Feet with green ticks, and a bar that says Hold still. Measuring.', caption: 'The camera check. The outline shows where your head, hips, knees and feet need to be before a game starts.', ...SHOT.desktop })}
${ul([
  '<strong>What it reads well:</strong> large moves of large body parts. Squats, knee lifts, jumping jacks, twists, side bends, reaching overhead and stepping.',
  '<strong>What is harder:</strong> fine hand positions and finger gestures, very fast moves, anything hidden behind furniture or another person, and moving towards or away from the camera, because one camera has no real sense of depth.',
  '<strong>What it asks of the room:</strong> light in front of you or beside you, about 2 metres clear around you and your whole body in view for the standing games.',
])}
<p>${link(GUIDE_URL[lang], 'How webcam fitness games work')} explains the tracking and the set-up in full.</p>`,
    },
    {
      id: 'games',
      title: `The ${c.total} games`,
      html: `<p>BodyArcade is its own set of short games. None of them is a copy of a Kinect title, and none is a dance game. A round lasts from ${roundLength(c.shortest, lang)} to ${roundLength(c.longest, lang)}, and ${c.free} of the ${c.total} are free.</p>
${figure({ src: shotSrc('firework-jacks-desktop'), alt: 'Firework Jacks on a wide screen: a white figure with a red head stands on a ring in front of a night city skyline, with the command Jack at the top, the score at the top left and the time at the top right.', caption: 'Firework Jacks: a jumping jack on the beat sends a firework up.', ...SHOT.desktop })}
${table(null, ['Game', 'What you do', 'Round', 'Free or Pro'], all.map((g) => [gameLink(g, lang), MOVE[g.id]?.en ?? '', roundLength(g.seconds, lang), g.free ? 'Free' : 'Pro']))}`,
    },
    {
      id: 'couch',
      title: 'Playing with someone on the same screen',
      html: `<p>Two people can share one camera in ${c.local2} of the games, on a big screen such as a laptop, a desktop or a TV connected to one. Player 1 stands on the left and Player 2 on the right, about 1 metre apart and about 3 metres from the screen, and each of you gets your own score. For rooms with friends in other homes, see ${seoLink(lang, 'friends', 'workout games to play with friends')}.</p>`,
    },
    {
      id: 'differs',
      title: 'What is different from a Kinect game',
      html: ul([
        '<strong>No sensor to find.</strong> The camera you have is the controller. You install nothing, and you need no sensor or adapter.',
        '<strong>Short games, not a long programme.</strong> BodyArcade is a set of quick rounds, and it adds no resistance. Use it for a warm-up, a break or a few minutes of cardio.',
        '<strong>One flat picture.</strong> The games are built around moves a single camera reads reliably, so they ask for big, clear moves.',
        '<strong>It runs in a browser.</strong> On a laptop or desktop, in Chrome, Edge, Firefox or Safari. Nothing is downloaded and no account is needed to play the free games.',
      ]),
    },
  ];

  const faq = [
    {
      q: 'Does BodyArcade work with a Kinect sensor?',
      a: '<p>It does not use a Kinect sensor or its depth data. It reads the colour picture that a camera gives the browser, the same picture a video call would use.</p>',
    },
    {
      q: 'Is BodyArcade a Kinect replacement?',
      a: `<p>It is a different kind of game that uses the camera you already own. It has ${c.total} short games for legs, arms, core and cardio, and none of them is a copy of a Kinect game. If you want a long structured programme or resistance training, look at a console fitness title or weights.</p>`,
    },
    {
      q: 'Do I need to install anything on my PC?',
      a: '<p>No. Open the page in a current browser, allow the camera and play. The first time, the game downloads its pose model, about 6 MB, and keeps it on your device.</p>',
    },
    {
      q: 'Does it work on a Mac?',
      a: '<p>Yes, on any laptop or desktop with a camera and a current browser (Chrome, Edge, Firefox or Safari).</p>',
    },
    {
      q: 'Is it free?',
      a: `<p>${c.free} of the ${c.total} games are free, with their seated and quiet versions and no ads. Pro adds the other ${c.pro} games, more workout plans and the harder levels. The <a href="/pricing">prices page</a> has the plans.</p>`,
    },
  ];
  sections.push({ id: 'faq', title: 'Questions people ask', html: faq.map((i) => qa(i.q, i.a)).join('\n') }, extraMore('kinect'));

  const title = 'Kinect alternative for PC: fitness games with a webcam';
  const description = `Microsoft no longer makes Kinect. BodyArcade has ${c.total} short fitness games for a PC that read your body with an ordinary webcam. ${c.free} are free.`;
  const lead = `If you used Kinect to exercise in front of the screen, you may be looking for something that runs on a PC today. BodyArcade is a set of ${c.total} short fitness games that read your body through an ordinary webcam in a browser, so there is no sensor, no adapter and no console. It is a different kind of game from the Kinect titles, and this page says where.`;
  const minutes = readMinutes(lead + sections.map((s) => s.html).join(' '));
  return {
    file: extraFile('kinect'),
    url: EXTRA_URL.kinect,
    lang,
    title,
    description,
    h1: 'A Kinect alternative for PC: fitness games that need only a webcam',
    when: `Updated ${F.longDate(EXTRA_DATES.modified, lang)} &middot; ${minutes} min read`,
    lead,
    sections,
    toc: true,
    og: 'article',
    after: cta('Open a game, allow the camera and step back. The first round takes a couple of minutes.', '/', 'Play a game'),
    crumbs: [{ name: 'BodyArcade', url: '/' }, { name: EXTRA_NAME.kinect.name, url: EXTRA_URL.kinect }],
    jsonLd: [articleLd({ headline: title, description, url: EXTRA_URL.kinect, published: EXTRA_DATES.published, modified: EXTRA_DATES.modified, lang }), faqLd(faq)],
  };
}
