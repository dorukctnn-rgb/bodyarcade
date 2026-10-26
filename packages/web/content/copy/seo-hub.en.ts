// Search page: fitness games you can play in the browser with a webcam (English). Target queries: fitness games, exercise games,
// workout games, workout game app. It lists every game of the catalogue with what it asks of the body, how long a round is and
// whether it is free, and helps a visitor choose. Every number and every name comes from the catalogue snapshot, the facts or the
// app's own words (seo-shared.ts); content.test.ts compares the page with them.
import { cta, faqLd, link, qa, readMinutes, table, ul, type PageSpec, type Section } from '../chrome.ts';
import * as F from '../facts.ts';
import { WORKOUT_PLANS } from '../../../core/store/workout-plans.ts';
import { gameCounts, roundLength, titlesOf } from './games.ts';
import { SEO_DATES, SEO_NAME, SEO_URL, GUIDE_URL, MOVE, gameLink, games, itemListLd, moreSection, otherOf, planWord, proHref, regionName, seoFile, seoLink } from './seo-shared.ts';

export function seoHubEn(): PageSpec {
  const lang = 'en';
  const c = gameCounts();
  const W = F.ROAD_RUN_WORLDS;
  const all = games(lang);
  const freeShort = all.filter((g) => g.free && g.seconds <= 180).sort((a, b) => a.seconds - b.seconds);
  const vigorous = [...all].sort((a, b) => b.met - a.met).slice(0, 3);
  const upper = all.filter((g) => g.framing === 'upper');
  const full = all.filter((g) => g.framing === 'full');
  const listed = (xs: readonly string[]): string => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
  const proPlans = WORKOUT_PLANS.length - 1;

  const sections: Section[] = [
    {
      id: 'games',
      title: `All ${c.total} games`,
      html: `<p>A round lasts from ${roundLength(c.shortest, lang)} to ${roundLength(c.longest, lang)}. Choose a game to open its page, which has the steps, what the camera reads and the seated and quiet versions.</p>
${table(null, ['Game', 'What you do', 'Round', 'Free or Pro', 'Body area'], all.map((g) => [
  gameLink(g, lang),
  `${MOVE[g.id]?.en ?? ''}`,
  roundLength(g.seconds, lang),
  planWord(g, lang),
  g.regions.map((r) => regionName(r, lang)).join(', '),
]))}`,
    },
    {
      id: 'pick',
      title: 'Which one to start with',
      html: ul([
        `<strong>You have three minutes or less.</strong> These free games fit: ${listed(freeShort.map((g) => `${gameLink(g, lang)} (${roundLength(g.seconds, lang)})`))}.`,
        `<strong>You want to get warm and breathe harder.</strong> The app rates ${listed(vigorous.map((g) => gameLink(g, lang)))} as its most intense games${vigorous.every((g) => g.free) ? ', and all three are free' : ''}. They are played standing, and each has a seated version.`,
        `<strong>You do not want to jump.</strong> A quiet mode, with no jumping and no stamping, is in ${c.quiet} of the ${c.total} games, and it is kind to the neighbours below. Switch it on in Settings.`,
        `<strong>You would rather sit.</strong> Every game has a seated version. ${seoLink(lang, 'seated', 'The seated games page')} goes through them one by one.`,
        `<strong>You are playing with someone.</strong> Two people can share one camera in ${c.local2} games, and ${listed(all.filter((g) => g.live).map((g) => gameLink(g, lang)))} have live online races. See ${seoLink(lang, 'friends', 'workout games to play with friends')}.`,
        `<strong>You want to work one part of your body.</strong> ${seoLink(lang, 'areas', 'Workout games by body area')} lists the games for legs, arms, chest and back, core, cardio and mobility.`,
      ]),
    },
    {
      id: 'need',
      title: 'What you need',
      html: `<p>A phone, tablet, laptop or desktop with a camera and a current browser (Chrome, Edge, Firefox or Safari). There is nothing to install and no account to make. The first time, the game downloads its pose model, about 6 MB, and keeps it on your device.</p>
<p>For ${full.length} of the ${c.total} games your whole body must be in view, from your head to your ankles: stand 2 to 3 metres from a laptop or 1.5 to 2 metres from an upright phone. The other ${upper.length} (${listed(upper.map((g) => g.title))}) need only your head to your hips in view, about 1 metre away, so they work at a desk.</p>
<p>Put the light in front of you or beside you, and clear about 2 metres around you if you play standing. ${link(GUIDE_URL[lang], 'How webcam fitness games work')} has the full set-up. With no camera, games that allow it can be played with the keyboard or by touch. Those rounds are practice and are not kept in your records.</p>`,
    },
    {
      id: 'free',
      title: 'Free and Pro',
      html: `<p>Of the ${c.total} games, ${c.free} are free: ${titlesOf((g) => g.free, lang)}. They come with their seated and quiet versions, the Easy and Normal difficulties and no ads. Road Run has ${W.total} worlds, and ${W.free} of them are free.</p>
<p>Pro adds ${titlesOf((g) => !g.free, lang)}, the Hard and Expert difficulties, the other ${W.total - W.free} Road Run worlds, ${proPlans} of the ${WORKOUT_PLANS.length} workout plans (Desk break is free) and the games we add later, while a membership is active and on the Lifetime plan. You can play each Pro game once for free before you decide. The ${link(proHref(lang), 'Pro page')} has the plans and the prices.</p>`,
    },
    {
      id: 'limits',
      title: 'What a camera game cannot do',
      html: ul([
        '<strong>It cannot add resistance.</strong> A camera cannot make you push against anything, so these games are bodyweight movement and cardio. For a strength programme, use weights; BodyArcade works as a warm-up or a break.',
        '<strong>It can miss a move.</strong> One camera reads big moves of big body parts well. Fine hand positions, very fast moves and anything hidden behind furniture are harder. When a move does not count, the results screen says why, for example hips not low enough or a hand out of view.',
        '<strong>Its calories are estimates.</strong> They come from the weight you enter (it stays on your device), how long you moved and how intense each game is. Without a weight, no calories are shown.',
        '<strong>It is not medical advice.</strong> It does not measure heart rate. Check with a doctor first if you are pregnant, have a heart or joint condition, or feel pain when you move. Stop if you feel dizzy or a sharp pain.',
      ]),
    },
  ];

  const faq = [
    {
      q: 'Can I play fitness games in the browser without installing anything?',
      a: '<p>Yes. BodyArcade runs in the browser of a phone, tablet, laptop or desktop, and the camera and the pose model run on your device. There is nothing to install and no account to make.</p>',
    },
    {
      q: 'Do I need a controller or any equipment?',
      a: '<p>No. Your camera is the controller: the one in a laptop lid, on top of a monitor or on the front of a phone is enough. There are no weights, bands or sensors, only some floor space for the games you play standing.</p>',
    },
    {
      q: 'Is my camera video uploaded?',
      a: `<p>No. Your device turns the video into ${F.MODEL_POINTS} body points on the spot, and the video is never uploaded, recorded or saved. The only video that leaves your device is optional: friends who are both ${F.AGE.video} or older can show each other their camera in a private room when both switch it on. See the <a href="/privacy">privacy policy</a>.</p>`,
    },
    {
      q: 'Does it work on a phone?',
      a: '<p>Yes, in your phone&rsquo;s browser, upright or sideways. Two players on one camera needs a bigger screen and is not offered on phone-sized screens.</p>',
    },
    {
      q: 'How long does a game take?',
      a: `<p>A round lasts from ${roundLength(c.shortest, lang)} (${all.find((g) => g.seconds === c.shortest)?.title}) to ${roundLength(c.longest, lang)} (${all.find((g) => g.seconds === c.longest)?.title}), and the others are in between. Most are played in sets with a rest between them. The <a href="/faq">FAQ</a> answers questions about plans, payments and your data.</p>`,
    },
  ];
  sections.push({ id: 'faq', title: 'Questions people ask', html: faq.map((i) => qa(i.q, i.a)).join('\n') }, moreSection(lang, 'hub'));

  const title = 'Fitness games you can play in your browser with a webcam';
  const description = `${c.total} short fitness games that use your webcam as the controller: squats, knee lifts, jumping jacks, punches. ${c.free} are free and nothing needs installing.`;
  const lead = `BodyArcade is a set of ${c.total} short fitness games that you play with your body. Your webcam or phone camera reads your moves, so there is no controller, nothing to install and no account. Of the ${c.total} games, ${c.free} are free. This page lists all of them, says what each one asks of you and helps you choose.`;
  const minutes = readMinutes(lead + sections.map((s) => s.html).join(' '));
  return {
    file: seoFile(lang, 'hub'),
    url: SEO_URL[lang].hub,
    lang,
    other: otherOf(lang, 'hub'),
    title,
    description,
    h1: title,
    when: `Updated ${F.longDate(SEO_DATES.modified, lang)} &middot; ${minutes} min read`,
    lead,
    sections,
    toc: true,
    after: cta('Open a game, allow the camera and play a first round. It takes a couple of minutes.', '/', 'Play a game'),
    crumbs: [{ name: 'BodyArcade', url: '/' }, { name: SEO_NAME[lang].hub.name, url: SEO_URL[lang].hub }],
    jsonLd: [
      itemListLd(`${c.total} fitness games`, all.map((g) => ({ name: g.title, url: `/games/${g.slug}/` }))),
      faqLd(faq),
    ],
  };
}

