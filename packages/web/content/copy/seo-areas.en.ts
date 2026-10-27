// Search page: workout games by body area (English). Target queries: leg workout games, arm exercise games, core workout games,
// cardio games, upper body workout games (the keywords of the games' own manifests). One page, not one page per area: the app
// already has an indexable list for every area (/workouts/<area>/), and four near-identical pages would compete with those. This
// page goes deeper: which games, what the camera reads in each, how long a round is, and what a camera game cannot train.
// The areas of a game are the manifest's own (snapshot); the names of the areas are the app's (seo-shared.ts).
import { articleLd, cta, faqLd, link, qa, readMinutes, table, ul, type PageSpec, type Section } from '../chrome.ts';
import * as F from '../facts.ts';
import type { BodyRegion } from '../../../core/types/index.ts';
import { gameCounts, listWords, roundLength } from './games.ts';
import { SEO_DATES, SEO_NAME, SEO_URL, appWord, gameLink, games, inline, moreSection, otherOf, planFacts, planWord, regionHref, regionName, seoFile, seoLink } from './seo-shared.ts';

/** The areas in the order of the page. Chest and back has one game, which is also in Arms and shoulders: it is told there. */
export const AREA_ORDER: readonly BodyRegion[] = ['legs', 'arms', 'core', 'cardio', 'mobility'];
/** The rows of the table at the top: the order of the app's own filter. */
export const GLANCE_ORDER: readonly BodyRegion[] = ['legs', 'arms', 'chest-back', 'core', 'cardio', 'mobility', 'seated'];

export function seoAreasEn(): PageSpec {
  const lang = 'en';
  const c = gameCounts();
  const all = games(lang);
  const inArea = (r: BodyRegion): typeof all => all.filter((g) => g.regions.includes(r));
  const legs = planFacts('legs-day', lang);
  const desk = planFacts('desk-break', lang);
  const strongest = [...all].sort((a, b) => b.met - a.met)[0];
  const noQuiet = all.filter((g) => !g.quiet);

  const intro: Readonly<Record<string, string>> = {
    legs: 'Squats, knee lifts, jumps and shapes that use the legs. Your own body weight is the only load, so think of these as leg work with some cardio in it, not as strength training.',
    arms: 'Reaching, tapping, punching and pulling. The games that need only your upper body in view also work at a desk.',
    core: 'Twists and side bends from the waist, and boxing-style punches. The camera reads how far your shoulders turn or lean. It does not measure how hard a muscle works.',
    cardio: `Games that keep you moving: jumping jacks, running on the spot, quick taps and dodges. The app rates ${strongest?.title} as its most intense game.`,
    mobility: `Slow, controlled bends and held shapes. The app files these under &ldquo;${regionName('mobility', lang)}&rdquo;. We make no claim that they improve your balance, and the camera does not test it.`,
  };

  const lineOf = (g: (typeof all)[number]): string => {
    const reads = g.measures.map((m) => inline(m, lang)).join('; ');
    return `<strong>${gameLink(g, lang)}</strong> (${planWord(g, lang)}, ${roundLength(g.seconds, lang)}). The camera reads ${reads}.${g.framing === 'upper' ? ' It needs only your upper body in view.' : ''}`;
  };

  const chestBack = all.filter((g) => g.regions.includes('chest-back'));
  /** The first section a game appears in is where it is described; in the others it is named and pointed back. */
  const home = new Map<string, BodyRegion>();
  const areaSections: Section[] = AREA_ORDER.map((r) => {
    const list = inArea(r);
    const lines = list.map((g) => {
      const at = home.get(g.id);
      if (at === undefined) { home.set(g.id, r); return lineOf(g); }
      return `<strong>${gameLink(g, lang)}</strong> (${planWord(g, lang)}, ${roundLength(g.seconds, lang)}), described under <a href="#${at}">${regionName(at, lang)}</a>.`;
    });
    const extra = r === 'arms' && chestBack.length > 0
      ? `<p>The app also has a ${link(regionHref('chest-back', lang), regionName('chest-back', lang))} list. It holds one game, ${chestBack.map((g) => gameLink(g, lang)).join(' and ')}, which is also listed here: you reach up with one hand and pull it down to your shoulder, then switch hands.</p>`
      : '';
    return {
      id: r,
      title: regionName(r, lang),
      html: `<p>${intro[r] ?? ''}</p>\n${ul(lines)}\n${extra}<p>${link(regionHref(r, lang), `Open the ${regionName(r, lang)} list in the app`)}, with the filters for seated and quiet play.</p>`,
    };
  });

  const glance: Section = {
    id: 'glance',
    title: 'The areas at a glance',
    html: `<p>Every game is filed under one to three areas, and all ${c.total} games are in the seated list, because every game can be played from a chair. A quiet mode, with no jumping and no stamping, is in ${c.quiet} of the ${c.total} games${noQuiet.length === 1 ? `; ${noQuiet[0]?.title} is the one without it` : ''}.</p>
${table(null, ['Area', 'Games', 'Which'], GLANCE_ORDER.map((r) => {
  const list = r === 'seated' ? all : inArea(r);
  return [link(regionHref(r, lang), regionName(r, lang)), String(list.length), listWords(list.map((g) => g.title), lang)];
}))}`,
  };

  const faq = [
    {
      q: 'Can I choose games by body area in the app?',
      a: `<p>Yes. The home page has a &ldquo;${appWord(lang, 'home.filters')}&rdquo; filter, and every area has its own list at an address of its own, for example <a href="${regionHref('legs', lang)}">${regionName('legs', lang)}</a>. The filter also has chips for seated and quiet play.</p>`,
    },
    {
      q: 'Is there a ready-made session for one area?',
      a: `<p>There are workout plans that chain games with rests between them. ${legs.title} runs ${listWords(legs.steps, lang)}, about ${legs.minutes} minutes. ${desk.title} is for shoulders, back and waist: ${listWords(desk.steps, lang)}, played seated, about ${desk.minutes} minutes, and it is the free plan. The other plans are part of Pro.</p>`,
    },
    {
      q: 'Do the games add weight or resistance?',
      a: '<p>No. A camera cannot make you push against anything, so every game here uses your own body weight, or none at all. If you want a strength programme, use weights; BodyArcade works as a warm-up or a break.</p>',
    },
    {
      q: 'Can I play them seated?',
      a: `<p>Yes. All ${c.total} games have a seated version. ${seoLink(lang, 'seated', 'The seated games page')} says how each one plays from a chair.</p>`,
    },
  ];

  const sections: Section[] = [glance, ...areaSections, { id: 'faq', title: 'Questions people ask', html: faq.map((i) => qa(i.q, i.a)).join('\n') }, moreSection(lang, 'areas')];

  const title = 'Workout games by body area: legs, arms, core and cardio';
  const description = 'Which BodyArcade games work your legs, arms, chest and back, core or cardio, what the camera reads in each, and which can be played from a chair.';
  const lead = `Every BodyArcade game is filed under one to three body areas, and the app lets you filter by them. This page goes through the areas one by one: the games in each, how long a round lasts and what the camera reads. These are bodyweight games, so none of them adds resistance.`;
  const minutes = readMinutes(lead + sections.map((s) => s.html).join(' '));
  return {
    file: seoFile(lang, 'areas'),
    url: SEO_URL[lang].areas,
    lang,
    other: otherOf(lang, 'areas'),
    og: 'article',
    title,
    description,
    h1: title,
    when: `Updated ${F.longDate(SEO_DATES.modified, lang)} &middot; ${minutes} min read`,
    lead,
    sections,
    toc: true,
    after: cta('Pick an area, open its first game and play a round.', '/', 'Play a game'),
    crumbs: [{ name: 'BodyArcade', url: '/' }, { name: SEO_NAME[lang].areas.name, url: SEO_URL[lang].areas }],
    jsonLd: [
      articleLd({ headline: title, description, url: SEO_URL[lang].areas, published: SEO_DATES.published, modified: SEO_DATES.modified, lang }),
      faqLd(faq),
    ],
  };
}
