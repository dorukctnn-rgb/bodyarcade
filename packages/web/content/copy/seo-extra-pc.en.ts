// Search page: exercise games for a PC (English only). Target queries, from Google suggest on 29 Oct 2026: exercise games for pc, workout
// games for pc, webcam exercise games, exercise games for pc without equipment, free. It says what a laptop or desktop needs, which games
// work at a desk and which need floor space, and what a webcam game cannot do. Counts, names and rounds come from the catalogue snapshot,
// the numbers of distance from the guide of the first page, the words of the app from its own tables; content.test.ts compares them.
import { articleLd, cta, faqLd, figure, link, qa, readMinutes, table, ul, type PageSpec, type Section } from '../chrome.ts';
import * as F from '../facts.ts';
import { gameCounts, listWords, roundLength } from './games.ts';
import { EXTRA_DATES, EXTRA_NAME, EXTRA_URL, GUIDE_URL, MOVE, SHOT, extraFile, extraMore, gameLink, games, planFacts, proHref, seoLink, shotSrc } from './seo-shared.ts';

export function seoPcEn(): PageSpec {
  const lang = 'en';
  const c = gameCounts();
  const all = games(lang);
  const upper = all.filter((g) => g.framing === 'upper');
  const full = all.filter((g) => g.framing === 'full');
  const desk = planFacts('desk-break', lang);
  const names = (xs: readonly { title: string }[]): string => listWords(xs.map((g) => g.title), lang);

  const sections: Section[] = [
    {
      id: 'need',
      title: 'What a PC needs',
      html: `${ul([
        '<strong>A camera the browser can open.</strong> The one in a laptop lid or on top of a monitor is enough, and so is a webcam you plug in.',
        '<strong>A current browser.</strong> Chrome, Edge, Firefox or Safari. The game opens as a web page, so there is nothing to download and no installer to run.',
        '<strong>No account.</strong> You can play the free games without an e-mail address or a password.',
        `<strong>One small fetch the first time.</strong> The game fetches its pose model, about 6 MB, and keeps it on your device. The model runs on your graphics chip when the browser can use one and on the processor when it cannot.`,
        '<strong>Some room.</strong> About 2 metres clear around you if you play standing. Nothing else: no weights, bands or sensors.',
      ])}
<p>Your PC turns each camera frame into ${F.MODEL_POINTS} body points on the spot. The video is never uploaded, recorded or saved.</p>`,
    },
    {
      id: 'desk',
      title: 'Games you can play at a desk',
      html: `<p>${names(upper)} need only your head down to your hips in view, about 1 metre from the camera, so you can play them seated at a desk. When the camera sees only your head and shoulders, the camera check offers to play at the desk, as in the picture.</p>
${figure({ src: shotSrc('desk-offer-desktop'), alt: 'The camera check of BodyArcade on a wide screen. An outline of a body shows where the head, hips, knees and feet should be, the hips are marked yellow, and a panel offers a button called Play at the desk.', caption: 'The camera check when it cannot see your hips. It tells you to step back, and offers Play at the desk if you are sitting.', ...SHOT.desktop })}
<p>There is a ready break for this. ${desk.title} is ${desk.steps.length} seated games, ${names(desk.steps.map((title) => ({ title })))}, for about ${desk.minutes} minutes with a rest of ${desk.rests[0]} seconds between them. It is the one workout plan that is free. Every game, including the standing ones, also has a seated version in Settings.</p>`,
    },
    {
      id: 'floor',
      title: 'Games that need floor space',
      html: `<p>${full.length} of the ${c.total} games need your whole body in view, from your head to your ankles. Stand 2 to 3 metres from a laptop. Tilt the screen back until the camera sees your feet, and put the light in front of you or beside you, not behind you. ${link(GUIDE_URL[lang], 'How webcam fitness games work')} has the full set-up for a room.</p>
${figure({ src: shotSrc('road-run-desktop'), alt: 'Road Run on a wide screen: a runner in a red jacket and yellow helmet on a road through a pine forest, with the score at the top left and the time at the top right.', caption: 'Road Run in a browser tab. The camera reads whether you jump, duck or lean, and the runner does the same.', ...SHOT.desktop })}`,
    },
    {
      id: 'all',
      title: `All ${c.total} games on a PC`,
      html: `<p>A round lasts from ${roundLength(c.shortest, lang)} to ${roundLength(c.longest, lang)}. ${c.free} of the ${c.total} are free.</p>
${table(null, ['Game', 'What you do', 'Camera must see', 'Round', 'Free or Pro'], all.map((g) => [
  gameLink(g, lang),
  MOVE[g.id]?.en ?? '',
  g.framing === 'upper' ? 'Head to hips' : 'Head to ankles',
  roundLength(g.seconds, lang),
  g.free ? 'Free' : 'Pro',
]))}
<p>On a laptop or a desktop, two people can share one camera in ${c.local2} of the games. ${seoLink(lang, 'friends', 'Workout games to play with friends')} explains how, and how online rooms work.</p>`,
    },
    {
      id: 'limits',
      title: 'What a webcam game cannot do',
      html: ul([
        '<strong>It cannot add resistance.</strong> A camera cannot make you push against anything, so these games are bodyweight movement and cardio. For a strength programme, use weights.',
        '<strong>It can miss a move.</strong> One camera reads big moves of big body parts well. Fine hand positions, very fast moves and anything hidden behind a chair or a desk are harder. When a move does not count, the results screen says why.',
        '<strong>It is not medical advice.</strong> It does not measure heart rate. Check with a doctor first if you are pregnant, have a heart or joint condition, or feel pain when you move. Stop if you feel dizzy or a sharp pain.',
      ]),
    },
  ];

  const faq = [
    {
      q: 'Is there a download for PC?',
      a: `<p>No. BodyArcade runs in the browser of a laptop or desktop, so there is no installer and no file to keep up to date. Open the page, allow the camera and play.</p>`,
    },
    {
      q: 'Which browsers work?',
      a: '<p>A current Chrome, Edge, Firefox or Safari, on a laptop or desktop with a camera. The first time, the browser asks if the page may use the camera.</p>',
    },
    {
      q: 'Can I play without a webcam?',
      a: '<p>Games that allow it can be played with the keyboard or by touch. Those rounds are practice: they are not kept in your records, your active days or your calories.</p>',
    },
    {
      q: 'Do I need a gaming PC?',
      a: '<p>BodyArcade lists no required parts. The camera reading runs on the graphics chip when your browser can use one and on the processor when it cannot. Open the first game and see how it runs on your machine.</p>',
    },
    {
      q: 'Is my camera video uploaded?',
      a: `<p>No. Your PC turns the video into ${F.MODEL_POINTS} body points on the spot, and the video is never uploaded, recorded or saved. See the <a href="/privacy">privacy policy</a>.</p>`,
    },
    {
      q: 'How much does it cost?',
      a: `<p>${c.free} of the ${c.total} games are free, with their seated and quiet versions and no ads. Pro adds the other ${c.pro} games and more. The <a href="${proHref(lang)}">Pro page</a> and the <a href="/pricing">prices page</a> have the plans.</p>`,
    },
  ];
  sections.push({ id: 'faq', title: 'Questions people ask', html: faq.map((i) => qa(i.q, i.a)).join('\n') }, extraMore('pc'));

  const title = 'Exercise games for PC with a webcam: free, no equipment';
  const description = `${c.total} exercise games that run in the browser of a PC or laptop and use its webcam as the controller. ${c.free} are free, with no download and no account.`;
  const lead = `BodyArcade is a set of ${c.total} short exercise games for a PC or a laptop with a webcam. Open the page, allow the camera and move: squat, jump, punch, twist, reach. There is no download and no controller. ${c.free} of the games are free.`;
  const minutes = readMinutes(lead + sections.map((s) => s.html).join(' '));
  return {
    file: extraFile('pc'),
    url: EXTRA_URL.pc,
    lang,
    title,
    description,
    h1: 'Exercise games for PC that run in your browser',
    when: `Updated ${F.longDate(EXTRA_DATES.modified, lang)} &middot; ${minutes} min read`,
    lead,
    sections,
    toc: true,
    og: 'article',
    after: cta('Open a game, allow the camera and play a first round. It takes a couple of minutes.', '/', 'Play a game'),
    crumbs: [{ name: 'BodyArcade', url: '/' }, { name: EXTRA_NAME.pc.name, url: EXTRA_URL.pc }],
    jsonLd: [articleLd({ headline: title, description, url: EXTRA_URL.pc, published: EXTRA_DATES.published, modified: EXTRA_DATES.modified, lang }), faqLd(faq)],
  };
}
