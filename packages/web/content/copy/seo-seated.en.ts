// Search page: seated exercise games for seniors, played with a webcam (English). Target queries: seated exercise games, exercise
// games for seniors, chair exercise games. It says how a seated round is set up, how each game plays from a chair (the games' own
// seated notes), what the app's Easy 60+ plan is, and what to take care of. Nothing here promises a health effect: the app does not
// measure health and the page says so. Numbers and names come from the snapshot, the plans and the app's own words (seo-shared.ts).
import { articleLd, cta, faqLd, link, ol, qa, readMinutes, table, ul, type PageSpec, type Section } from '../chrome.ts';
import * as F from '../facts.ts';
import { WORKOUT_PLANS } from '../../../core/store/workout-plans.ts';
import { gameCounts, listWords, roundLength } from './games.ts';
import { SEO_DATES, SEO_NAME, SEO_URL, appWord, gameLink, games, moreSection, otherOf, planFacts, planWord, plansHref, proHref, seoFile, seoLink } from './seo-shared.ts';

export function seoSeatedEn(): PageSpec {
  const lang = 'en';
  const c = gameCounts();
  const all = games(lang);
  const easy = planFacts('easy-60', lang);
  const desk = planFacts('desk-break', lang);
  const rest = easy.rests[0] ?? 0;
  const lively = all.filter((g) => !g.lowImpact);
  const lowCount = all.filter((g) => g.lowImpact).length;
  const word = (key: string): string => appWord(lang, key);

  const sections: Section[] = [
    {
      id: 'who',
      title: 'Who these games suit',
      html: '<p>The games are short, there is no controller to hold and every one can be played seated, so they suit older adults who want light movement at home, people who sit for most of the day, and anyone who cannot or would rather not stand and jump. They are games, not a medical programme: read the last section before you start.</p>',
    },
    {
      id: 'setup',
      title: 'Set up a seated round',
      html: ol([
        '<strong>Pick a chair.</strong> A stable chair without wheels, with room around you for your arms to swing.',
        '<strong>Place the screen.</strong> Put a laptop on a table, or lean a tablet on something steady, at about eye level. The camera needs your head, shoulders and arms in view, and your hips too if it can. About 1 metre away works. If you sit too close, the app asks you to sit back a little so your head, shoulders and arms show. A few games ask you to raise both hands once in the set-up check, to make sure your hands stay in the picture, so leave some room above your head.',
        `<strong>Turn on ${word('settings.seated')}.</strong> In ${word('nav.settings')}, switch on ${word('settings.seated')}, and every game with a seated version uses it. You can also leave it off: when the app only sees your head and shoulders it offers to play at the desk, and the set-up check has a button, &ldquo;${word('calib.seatedInstead')}&rdquo;.`,
        '<strong>Mind the light.</strong> Put the light in front of you or beside you, not behind you. A window behind you turns you into a silhouette and the camera loses track of your arms.',
        '<strong>Start at Easy.</strong> The Easy and Normal difficulties are free. Hard and Expert are part of Pro.',
      ]),
    },
    {
      id: 'games',
      title: 'Each game from a chair',
      html: `<p>This is how the app describes the seated version of every game. A round lasts from ${roundLength(c.shortest, lang)} to ${roundLength(c.longest, lang)}.</p>
${table(null, ['Game', 'How it plays seated', 'Round', 'Free or Pro'], all.map((g) => [
  gameLink(g, lang),
  g.seatedNote ?? '',
  roundLength(g.seconds, lang),
  planWord(g, lang),
]))}`,
    },
    {
      id: 'gentle',
      title: 'The gentler games and the livelier ones',
      html: `<p>In the app, ${lowCount} of the ${c.total} games are marked low impact. The ${lively.length === 2 ? 'two' : String(lively.length)} that are not are ${listWords(lively.map((g) => g.title), lang)}. Played seated, Firework Jacks becomes arm jacks and Road Run needs only leaning and ducking, but they are still the liveliest games here, so begin with the others if you want it gentle. A quiet mode, with no jumping and no stamping, is in ${c.quiet} of the ${c.total} games too.</p>`,
    },
    {
      id: 'plan',
      title: 'The Easy 60+ plan',
      html: `<p>The app has a ready-made plan for people 60 and over. It chains ${listWords(easy.steps, lang)}, all at Easy difficulty, with ${rest} seconds of rest between the games, about ${easy.minutes} minutes in all. It starts seated unless you have switched Seated mode off, and you can stand up whenever you feel steady.</p>
<p>Workout plans are part of Pro, except one. The free plan is ${desk.title}: ${listWords(desk.steps, lang)}, played seated, about ${desk.minutes} minutes. The games in both plans are free games, so you can also play them one at a time without paying. The ${link(plansHref(lang), 'plans page')} lists all ${WORKOUT_PLANS.length} plans, and the ${link(proHref(lang), 'Pro page')} has what Pro costs.</p>`,
    },
    {
      id: 'care',
      title: 'Staying safe, and what the app does not do',
      html: ul([
        `<strong>Ask first if it applies to you.</strong> Check with a doctor if you are pregnant, have a heart or joint condition, or feel pain when you move. Do the same if a doctor or physiotherapist has told you to take care with exercise. Stop if you feel dizzy or a sharp pain.`,
        '<strong>It is a game, not a treatment.</strong> BodyArcade is not a medical device, a rehabilitation programme or a falls-prevention programme. It does not measure heart rate or give medical advice, and we make no health claims for it.',
        '<strong>Keep things steady.</strong> Use a stable chair, keep water within reach and tell someone at home that you are playing.',
        '<strong>Rests are built in.</strong> Most games are played in sets with a rest between them, and you can stop at any time.',
        '<strong>The camera can miss a move.</strong> When a move does not count, the results screen says why, for example a hand out of view.',
      ]),
    },
  ];

  const faq = [
    {
      q: 'Does every game have a seated version?',
      a: `<p>Yes, all ${c.total} do. Each game page has a section called &ldquo;${word('game.section.variants')}&rdquo; that says how the game plays from a chair.</p>`,
    },
    {
      q: 'Do I have to stand up at any point?',
      a: '<p>No. Every game can be played seated from the first second to the last. The Easy 60+ plan starts seated, and standing is your choice.</p>',
    },
    {
      q: 'Does it work on a tablet or an older laptop?',
      a: '<p>On any device with a camera and a current browser (Chrome, Edge, Firefox or Safari). If the app says your device is too slow for camera mode, you can play with the keyboard or by touch. Those rounds are practice and are not kept in your records.</p>',
    },
    {
      q: 'What does it cost?',
      a: `<p>Of the ${c.total} games, ${c.free} are free, with their seated and quiet versions, the Easy and Normal difficulties and no ads. Pro adds the other ${c.pro} games, the harder difficulties and most of the workout plans. See the <a href="${proHref(lang)}">Pro page</a>.</p>`,
    },
    {
      q: 'Is my camera video recorded or uploaded?',
      a: `<p>No. Your device turns the video into ${F.MODEL_POINTS} body points on the spot, and the video is never uploaded, recorded or saved. Read the <a href="/privacy">privacy policy</a>.</p>`,
    },
    {
      q: 'Can I play with my grandchildren?',
      a: `<p>Yes. In ${c.local2} of the ${c.total} games, two people can share one camera on a big screen such as a laptop, and each gets a score. Online rooms are for players aged ${F.AGE.online} and over. ${seoLink(lang, 'friends', 'The page on playing with friends')} has the details.</p>`,
    },
  ];
  sections.push({ id: 'faq', title: 'Questions people ask', html: faq.map((i) => qa(i.q, i.a)).join('\n') }, moreSection(lang, 'seated'));

  const title = 'Seated exercise games for seniors, played with a webcam';
  const description = `All ${c.total} BodyArcade games have a seated version. Play from a chair with your webcam: how to set up, what each game asks of you and a gentle plan for 60 and over.`;
  const lead = `Every one of BodyArcade&rsquo;s ${c.total} camera games can be played from a chair. You sit in front of a laptop, tablet or phone, the camera follows your head, shoulders and arms, and the game answers what they do. Of the ${c.total} games, ${c.free} are free and ${c.quiet} have a quiet mode. This page shows how to set up a seated round, what each game asks of you and what to take care of.`;
  const minutes = readMinutes(lead + sections.map((s) => s.html).join(' '));
  return {
    file: seoFile(lang, 'seated'),
    url: SEO_URL[lang].seated,
    lang,
    other: otherOf(lang, 'seated'),
    og: 'article',
    title,
    description,
    h1: title,
    when: `Updated ${F.longDate(SEO_DATES.modified, lang)} &middot; ${minutes} min read`,
    lead,
    sections,
    toc: true,
    after: cta('Open a game, turn on Seated mode in Settings and sit back from the screen. The first round takes a couple of minutes.', '/', 'Play a game'),
    crumbs: [{ name: 'BodyArcade', url: '/' }, { name: SEO_NAME[lang].seated.name, url: SEO_URL[lang].seated }],
    jsonLd: [
      articleLd({ headline: title, description, url: SEO_URL[lang].seated, published: SEO_DATES.published, modified: SEO_DATES.modified, lang }),
      faqLd(faq),
    ],
  };
}
