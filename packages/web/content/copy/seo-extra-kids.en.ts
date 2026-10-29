// Search page: indoor motion games for kids (English only). Target queries, from Google suggest on 29 Oct 2026: motion games for kids
// indoor(s), indoor games for kids active, active games for kids at home, workout games for kids. It is written for the adult who sets it
// up: which games have no jumping, what the room needs, and what the app does and does not keep about a child. The age lines are
// facts.ts (AGE), the plan is planFacts, the games are the catalogue; content.test.ts compares them. No claim about a child's health.
import { articleLd, cta, faqLd, figure, figures, link, qa, readMinutes, table, ul, type PageSpec, type Section } from '../chrome.ts';
import * as F from '../facts.ts';
import { gameCounts, listWords, roundLength } from './games.ts';
import { EXTRA_DATES, EXTRA_NAME, EXTRA_URL, GUIDE_URL, MOVE, SHOT, extraFile, extraMore, gameLink, games, planFacts, proHref, seoLink, shotSrc } from './seo-shared.ts';

export function seoKidsEn(): PageSpec {
  const lang = 'en';
  const c = gameCounts();
  const all = games(lang);
  const free = all.filter((g) => g.free);
  const proGames = all.filter((g) => !g.free);
  const kids = planFacts('kids-break', lang);
  const noJump = all.filter((g) => g.quiet);
  const upper = all.filter((g) => g.framing === 'upper');

  const sections: Section[] = [
    {
      id: 'start',
      title: 'Which games to start with',
      html: `<p>The games are not graded by age, so you choose. ${noJump.length} of the ${c.total} games have a quiet mode with no jumping and no stamping, and every game has a seated version. These are the ${free.length} free games, with the way to play each one without jumping:</p>
${table(null, ['Game', 'What your child does', 'Round', 'Without jumping'], free.map((g) => [gameLink(g, lang), MOVE[g.id]?.en ?? '', roundLength(g.seconds, lang), g.quietNote ?? g.seatedNote ?? '']))}
<p>${listWords(proGames.map((g) => g.title), lang)} are Pro games. ${kids.title}, one of the Pro plans, puts ${kids.steps.length} of them together for a break between lessons: ${listWords(kids.steps, lang)}, about ${kids.minutes} minutes, with no jumping.</p>
${figures('duo',
  figure({ src: shotSrc('pose-wall-desktop'), alt: 'Pose Wall on a wide screen: a white figure stands with its arms out in front of a red wall that has a body-shaped hole, with the words Match it at the top and the score and time in the corners.', caption: 'Pose Wall: make the shape of the hole before the wall reaches you.', ...SHOT.desktop }),
  figure({ src: shotSrc('pose-wall-phone'), alt: 'Pose Wall on a phone held upright, with the words Match it at the top and a figure in front of a wall.', caption: 'The same game on a phone.', phone: true, ...SHOT.phone }),
)}`,
    },
    {
      id: 'room',
      title: 'What the room needs',
      html: ul([
        '<strong>Space.</strong> About 2 metres clear around the player, on a floor that is not slippery. Move the coffee table.',
        `<strong>Distance.</strong> For the standing games the camera must see your child from head to ankles: 2 to 3 metres from a laptop, or 1.5 to 2 metres from an upright phone. For ${upper.length} of the games, head to hips is enough, about 1 metre away.`,
        '<strong>Light.</strong> In front of the player or beside, not behind.',
        '<strong>An adult nearby.</strong> Our terms ask children to play with an adult nearby.',
        '<strong>The neighbours.</strong> Quiet mode is in Settings, and it is kind to the people downstairs.',
      ]) + `\n<p>${link(GUIDE_URL[lang], 'How webcam fitness games work')} has the set-up in full.</p>`,
    },
    {
      id: 'together',
      title: 'Two children on one camera',
      html: `<p>On a big screen such as a laptop, a desktop or a TV, two players can share one camera in ${c.local2} of the ${c.total} games. Player 1 stands on the left and Player 2 on the right, about 1 metre apart and about 3 metres from the screen, and each gets a score of their own. It is not offered on phone-sized screens. ${seoLink(lang, 'friends', 'Workout games to play with friends')} explains online rooms for older players.</p>`,
    },
    {
      id: 'data',
      title: 'What the app keeps about a child',
      html: `${ul([
        `<strong>The video.</strong> The camera picture is turned into ${F.MODEL_POINTS} body points on the device. It is never uploaded, recorded or saved.`,
        `<strong>No online profile under ${F.AGE.online}.</strong> The games work on the device, and the app sends nothing about the child to the friends service. Friends, rooms, public lobbies and weekly boards are not available.`,
        '<strong>No ads.</strong> There are no ads and no advertising trackers.',
        `<strong>Results stay on the device.</strong> With the Family plan, up to ${F.FAMILY_PROFILES} people on one device keep their own results, stored on that device only. A child&rsquo;s profile never gets an online profile of its own.`,
        '<strong>Buying is for adults.</strong> Gumroad and Google Play have their own age rules for buying.',
      ])}
<p>The <a href="/privacy">privacy policy</a> and the <a href="/terms">terms</a> have everything in full.</p>`,
    },
    {
      id: 'limits',
      title: 'What to know before you start',
      html: ul([
        '<strong>It can miss a move.</strong> One camera reads big moves of big body parts well, and a small child close to the camera or in poor light can be harder to read. When a move does not count, the results screen says why.',
        '<strong>It is not medical advice.</strong> It does not measure heart rate and makes no claim about a child&rsquo;s health.',
        '<strong>It adds no resistance.</strong> The games are bodyweight movement. They suit a rainy afternoon, not a training plan.',
      ]),
    },
  ];

  const faq = [
    {
      q: 'What age is BodyArcade for?',
      a: `<p>Anyone can play on their own device, and the games have no age rating. Our terms ask children to play with an adult nearby. Online features (friends, rooms, public lobbies and weekly boards) are for players ${F.AGE.online} and older.</p>`,
    },
    {
      q: 'What does BodyArcade send about my child?',
      a: `<p>Under ${F.AGE.online} there is no online profile, and the app sends nothing about the child to the friends service. The video is never uploaded, recorded or saved. Read the <a href="/privacy">privacy policy</a> for the details.</p>`,
    },
    {
      q: 'Does my child need a camera?',
      a: '<p>The games are played with a camera. Games that allow it can also be played with the keyboard or by touch, but those rounds are practice and are not kept in the records.</p>',
    },
    {
      q: 'Is it free?',
      a: `<p>${c.free} of the ${c.total} games are free, with their seated and quiet versions and no ads. Pro adds the other ${c.pro} games, more plans and harder levels. The <a href="${proHref(lang)}">Pro page</a> and the <a href="/pricing">prices page</a> have the plans.</p>`,
    },
    {
      q: 'Can two children play together?',
      a: `<p>Yes, on a big screen: ${c.local2} of the ${c.total} games let two players share one camera. Online rooms are for players ${F.AGE.online} and older.</p>`,
    },
  ];
  sections.push({ id: 'faq', title: 'Questions parents ask', html: faq.map((i) => qa(i.q, i.a)).join('\n') }, extraMore('kids'));

  const title = 'Indoor motion games for kids: play with a webcam at home';
  const description = `${c.total} short motion games for a rainy day: your child moves, the camera reads it on your device. ${c.quiet} have a quiet mode, ${c.free} are free and nothing is uploaded.`;
  const lead = `On a rainy day, a camera can turn a living room into a play space. BodyArcade is a set of ${c.total} short games that a child plays by moving in front of a laptop, tablet or phone camera: squatting, reaching, leaning, punching. This page is for the adult who sets it up. It says which games have no jumping, what the room needs and what the app keeps about a child.`;
  const minutes = readMinutes(lead + sections.map((s) => s.html).join(' '));
  return {
    file: extraFile('kids'),
    url: EXTRA_URL.kids,
    lang,
    title,
    description,
    h1: 'Indoor motion games for kids, played with a webcam',
    when: `Updated ${F.longDate(EXTRA_DATES.modified, lang)} &middot; ${minutes} min read`,
    lead,
    sections,
    toc: true,
    og: 'article',
    after: cta('Open a game with your child, allow the camera and try one round together.', '/', 'Play a game'),
    crumbs: [{ name: 'BodyArcade', url: '/' }, { name: EXTRA_NAME.kids.name, url: EXTRA_URL.kids }],
    jsonLd: [articleLd({ headline: title, description, url: EXTRA_URL.kids, published: EXTRA_DATES.published, modified: EXTRA_DATES.modified, lang }), faqLd(faq)],
  };
}
