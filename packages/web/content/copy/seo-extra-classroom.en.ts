// Search page: brain break and PE games for the classroom (English only). Target queries, from Google suggest on 29 Oct 2026: brain break
// games (for the classroom, for kids, online), pe games online, virtual pe games, movement break games. It is written for the adult who
// runs the break. It says how one camera and one screen can serve a class, which games are quiet and seated, and, in plain words, what
// the app does not do for a class. The plans and the counts come from the code (planFacts, the catalogue snapshot); the age lines from
// facts.ts; content.test.ts compares them.
import { articleLd, cta, faqLd, figure, link, ol, qa, readMinutes, table, ul, type PageSpec, type Section } from '../chrome.ts';
import * as F from '../facts.ts';
import { gameCounts, listWords, roundLength } from './games.ts';
import { EXTRA_DATES, EXTRA_NAME, EXTRA_URL, GUIDE_URL, MOVE, SHOT, extraFile, extraMore, gameLink, games, planFacts, shotSrc } from './seo-shared.ts';

export function seoClassroomEn(): PageSpec {
  const lang = 'en';
  const c = gameCounts();
  const all = games(lang);
  const desk = planFacts('desk-break', lang);
  const kids = planFacts('kids-break', lang);
  const names = (steps: readonly string[]): string => listWords(steps, lang);

  const sections: Section[] = [
    {
      id: 'run',
      title: 'How to run a break from one screen',
      html: `<p>A camera game follows one player, or two side by side. The rest of the class watches the screen, and can copy the move from their seats. One way to set it up:</p>
${ol([
  'Put the computer with the camera where the class can see the screen: on a projector or a classroom display.',
  'Clear about 2 metres in front of the camera, so the player has room and nobody walks through the picture.',
  'Open the page, choose a game and allow the camera. The camera check measures the player before a game, so each new player stands at it first.',
  `Let one student play a round, or two students side by side in the ${c.local2} games that allow it. A round lasts from ${roundLength(c.shortest, lang)} to ${roundLength(c.longest, lang)}.`,
  'Swap players and pick the next game.',
])}
${figure({ src: shotSrc('star-catch-desktop'), alt: 'Star Catch on a wide screen: a pale stick figure on a dark background whose hands are marked by a yellow ring and a blue ring, with a star to catch above them. The score is at the top left and the time at the top right.', caption: 'Star Catch asks for nothing but reaching. The camera follows two hands, left and right, and the game can be played from a chair.', ...SHOT.desktop })}`,
    },
    {
      id: 'quiet',
      title: 'Quiet and seated: nobody has to jump',
      html: `<p>Every game has a seated version, and ${c.quiet} of the ${c.total} have a quiet mode with no jumping and no stamping, which keeps the noise down. Both are switches in Settings.</p>
${figure({ src: shotSrc('settings-desktop'), alt: 'The Settings screen of BodyArcade. The Play group has two switches, Seated mode, described as play from a chair, and Quiet mode, described as no jumping or stamping and kind to the neighbours below.', caption: 'Settings has the two switches for a classroom: Seated mode and Quiet mode.', ...SHOT.desktop })}
${table(null, ['Game', 'What you do', 'Camera must see', 'Round', 'Quiet mode'], all.map((g) => [
  gameLink(g, lang),
  MOVE[g.id]?.en ?? '',
  g.framing === 'upper' ? 'Head to hips' : 'Head to ankles',
  roundLength(g.seconds, lang),
  g.quiet ? 'Yes' : 'No',
]))}`,
    },
    {
      id: 'plans',
      title: 'Ready-made breaks',
      html: `<p>A workout plan is a short run of games with a rest between them. Two of them are made for a break between lessons.</p>
${ul([
  `<strong>${desk.title}</strong> (free): ${desk.steps.length} seated games, ${names(desk.steps)}, about ${desk.minutes} minutes, with ${desk.rests[0]} seconds of rest.`,
  `<strong>${kids.title}</strong> (Pro): ${kids.steps.length} short games with no jumping, ${names(kids.steps)}, about ${kids.minutes} minutes, with ${kids.rests[0]} seconds of rest between them. The app describes it as a break between lessons.`,
])}
${figure({ src: shotSrc('plans-desktop'), alt: 'The Workout plans screen of BodyArcade with five plan cards: Desk break marked Free, Full body, Legs day, Kids active break and Easy 60 plus, each with its games and its length.', caption: 'The plans screen. Desk break is free, and Kids active break is one of the Pro plans.', ...SHOT.plans })}`,
    },
    {
      id: 'data',
      title: 'What stays on the computer',
      html: ul([
        `<strong>The video.</strong> The computer turns the camera picture into ${F.MODEL_POINTS} body points on the spot. The video is never uploaded, recorded or saved.`,
        '<strong>No accounts.</strong> Nobody has to sign in or give an e-mail address to play the free games.',
        `<strong>Nothing online for younger students.</strong> Under ${F.AGE.online} there is no online profile at all. The games work on the device, and the app sends nothing about the player to the friends service.`,
        '<strong>No ads.</strong> There are no ads and no advertising trackers.',
      ]) + `\n<p>The <a href="/privacy">privacy policy</a> lists what BodyArcade keeps and for how long. We cannot tell you whether it fits your school&rsquo;s rules for web tools, so check them first.</p>`,
    },
    {
      id: 'limits',
      title: 'What the app does not do for a class',
      html: `${ul([
        '<strong>It has no class tools.</strong> There is no roster, teacher dashboard or school licence, and results stay on the device.',
        '<strong>It is not a PE curriculum.</strong> It is a set of short movement games, useful as a break, a warm-up or a reward.',
        `<strong>The camera reads one player.</strong> Two players can share a camera in ${c.local2} of the ${c.total} games. A whole class cannot play at once.`,
        '<strong>It can miss a move.</strong> One camera reads big moves of big body parts well, and light and distance matter. The set-up guide has the details.',
        '<strong>Children play with an adult nearby.</strong> That is what our terms ask, and it fits a lesson.',
      ])}
<p>The terms give each person a personal right to use BodyArcade. If you want to use it with classes regularly, write to ${link(`mailto:${F.EMAIL}`, F.EMAIL)} and tell us what you need. ${link(GUIDE_URL[lang], 'How webcam fitness games work')} has the set-up for a room.</p>`,
    },
  ];

  const faq = [
    {
      q: 'Is BodyArcade free for teachers?',
      a: `<p>${c.free} of the ${c.total} games are free for everyone, with their seated and quiet versions, and the Desk break plan is free too. Pro adds the other ${c.pro} games and the other plans. There is no separate teacher plan. The <a href="/pricing">prices page</a> has the plans.</p>`,
    },
    {
      q: 'Do students need an account?',
      a: '<p>No. Nobody needs an account, a password or an e-mail address to play. An online profile exists only for friends and rooms, and nobody under 16 can make one.</p>',
    },
    {
      q: 'Can the whole class play at once?',
      a: `<p>No. The camera reads one player, or two players side by side in ${c.local2} of the games. The rest of the class can watch the screen and copy the move at their seats.</p>`,
    },
    {
      q: 'Does it need special equipment?',
      a: '<p>A computer with a camera and a current browser (Chrome, Edge, Firefox or Safari), and a screen the class can see. Check with your school that the camera and the site are allowed on that computer.</p>',
    },
    {
      q: 'Is the camera video recorded?',
      a: '<p>No. The video is read on the computer and is never uploaded, recorded or saved.</p>',
    },
  ];
  sections.push({ id: 'faq', title: 'Questions teachers ask', html: faq.map((i) => qa(i.q, i.a)).join('\n') }, extraMore('classroom'));

  const title = 'Brain break and PE games online for the classroom';
  const description = `${c.total} short movement games for a brain break or a PE lesson: one webcam, one screen, ${c.quiet} games with a quiet mode and a seated version of each. ${c.free} are free.`;
  const lead = `A brain break is a short pause in a lesson to move. BodyArcade has ${c.total} short movement games that start in a browser on the classroom computer. One student plays in front of the webcam, or two side by side, while the class watches the screen. Every game has a seated version, and ${c.quiet} have a quiet mode, so nobody has to jump.`;
  const minutes = readMinutes(lead + sections.map((s) => s.html).join(' '));
  return {
    file: extraFile('classroom'),
    url: EXTRA_URL.classroom,
    lang,
    title,
    description,
    h1: 'Brain break games and PE games for the classroom, played with a webcam',
    when: `Updated ${F.longDate(EXTRA_DATES.modified, lang)} &middot; ${minutes} min read`,
    lead,
    sections,
    toc: true,
    og: 'article',
    after: cta('Open a game on the classroom computer, allow the camera and try one round before the lesson.', '/', 'Play a game'),
    crumbs: [{ name: 'BodyArcade', url: '/' }, { name: EXTRA_NAME.classroom.name, url: EXTRA_URL.classroom }],
    jsonLd: [articleLd({ headline: title, description, url: EXTRA_URL.classroom, published: EXTRA_DATES.published, modified: EXTRA_DATES.modified, lang }), faqLd(faq)],
  };
}
