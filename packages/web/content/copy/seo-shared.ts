// What the search pages share: the fitness games page, the seated page, the friends page and the body-area page, each in English
// and in Turkish. Addresses, the names of the pages (for the lists of related pages), one line per game of what the body does,
// the workout plan the seated page talks about, and the list markup of the structured data.
//
// The facts are never typed here a second time: the games, their free or Pro flag, their rounds, their body areas and their
// seated and quiet notes come from the catalogue snapshot (games.ts); the plan comes from core/store/workout-plans.ts;
// the words of the app (Settings, the region names) come from the app's own i18n tables. content.test.ts compares each page with them.
import { createI18n } from '../../../core/ui/i18n/index.ts';
import { FREE_PLAN_ID, WORKOUT_PLANS, resolvePlan, type ResolvedPlan, type WorkoutPlan } from '../../../core/store/workout-plans.ts';
import { localized } from '../../../core/ui/i18n/localized.ts';
import type { BodyRegion } from '../../../core/types/index.ts';
import { esc, link, ul, type Section } from '../chrome.ts';
import { SITE, type Lang } from '../facts.ts';
import { gameList, snapshotGames, type GameInfo } from './games.ts';

/** The day these pages were written and last changed in substance (ISO). Bump the second one with the text. */
export const SEO_DATES = { published: '2026-10-26', modified: '2026-10-26' } as const;

export type SeoPage = 'hub' | 'seated' | 'friends' | 'areas';

/** The address of each page in each language. */
export const SEO_URL: Readonly<Record<Lang, Readonly<Record<SeoPage, string>>>> = {
  en: { hub: '/fitness-games', seated: '/seated-exercise-games', friends: '/workout-games-with-friends', areas: '/workout-games-by-body-area' },
  tr: { hub: '/tr/evde-spor-oyunlari', seated: '/tr/oturarak-egzersiz-oyunlari', friends: '/tr/arkadaslarla-spor-oyunlari', areas: '/tr/bolgeye-gore-spor-oyunlari' },
};

/** The file under site/ of each page (the address without its first slash, plus .html). */
export const seoFile = (lang: Lang, page: SeoPage): string => `${SEO_URL[lang][page].slice(1)}.html`;

/** What a link to the page is called, and one line on what it answers. */
export const SEO_NAME: Readonly<Record<Lang, Readonly<Record<SeoPage, { name: string; about: string }>>>> = {
  en: {
    hub: { name: 'Fitness games you can play in your browser', about: 'all the games, what each asks of you, and which to start with' },
    seated: { name: 'Seated exercise games', about: 'how to play every game from a chair, and the Easy 60+ plan' },
    friends: { name: 'Workout games to play with friends', about: 'online rooms, two people on one camera, ghost races and weekly boards' },
    areas: { name: 'Workout games by body area', about: 'legs, arms, chest and back, core, cardio and mobility, game by game' },
  },
  tr: {
    hub: { name: 'Evde spor oyunları', about: 'bütün oyunlar, her birinin senden ne istediği ve hangisiyle başlayacağın' },
    seated: { name: 'Oturarak egzersiz oyunları', about: 'her oyunu sandalyeden nasıl oynarsın ve Rahat 60+ planı' },
    friends: { name: 'Arkadaşlarla spor oyunları', about: 'çevrimiçi odalar, tek kamerada iki kişi, hayalet yarışları ve haftalık tablolar' },
    areas: { name: 'Bölgeye göre spor oyunları', about: 'bacak, kol, göğüs ve sırt, karın, kardiyo ve hareketlilik oyunları' },
  },
};

/** The page of the other language that answers the same question. */
export const otherOf = (lang: Lang, page: SeoPage): { lang: Lang; url: string } => {
  const lang2: Lang = lang === 'en' ? 'tr' : 'en';
  return { lang: lang2, url: SEO_URL[lang2][page] };
};

/** The guide that was there first (how a webcam game works). */
export const GUIDE_URL: Readonly<Record<Lang, string>> = { en: '/webcam-fitness-games', tr: '/tr/kamera-ile-spor-oyunlari' };

const prefix = (lang: Lang): string => (lang === 'tr' ? '/tr' : '');
export const gameHref = (g: Pick<GameInfo, 'slug'>, lang: Lang): string => `${prefix(lang)}/games/${g.slug}/`;
export const gameLink = (g: GameInfo, lang: Lang): string => link(gameHref(g, lang), esc(g.title));
export const regionHref = (r: BodyRegion, lang: Lang): string => `${prefix(lang)}/workouts/${r}/`;
export const plansHref = (lang: Lang): string => `${prefix(lang)}/plans/`;
export const proHref = (lang: Lang): string => `${prefix(lang)}/pro/`;
export const homeHref = (lang: Lang): string => `${prefix(lang)}/`;
export const seoLink = (lang: Lang, page: SeoPage, text: string = SEO_NAME[lang][page].name): string => link(SEO_URL[lang][page], text);

/** The words of the app (its own interface strings), so a page names a button the way the button is written. */
export const appWord = (lang: Lang, key: string): string => createI18n(lang).tx(key);
export const regionName = (r: BodyRegion, lang: Lang): string => appWord(lang, `region.${r}`);

/** The games the pages are built from, in the order of the menu, in one language. */
export const games = (lang: Lang): GameInfo[] => gameList(lang);
export const gameById = (lang: Lang, id: string): GameInfo => {
  const g = gameList(lang).find((x) => x.id === id);
  if (!g) throw new Error(`the catalogue has no game ${id}`);
  return g;
};

/** What the body does in each game, in a few words. Every game of the catalogue has one (content.test.ts checks it). */
export const MOVE: Readonly<Record<string, { en: string; tr: string }>> = {
  'squat-flap': { en: 'Squat and stand up to flap a bird through gaps', tr: 'Çömel ve kalk, kuşu boşluklardan geçir' },
  'knee-sprint': { en: 'Run on the spot with your knees up and race a runner', tr: 'Olduğun yerde dizlerini kaldırarak koş, bir koşucuyla yarış' },
  'star-catch': { en: 'Reach out and touch stars with the matching hand', tr: 'Uzan ve yıldızlara rengine uyan elinle dokun' },
  'pad-work': { en: 'Punch numbered pads on the beat', tr: 'Numaralı pedlere ritme göre yumruk at' },
  'reaction-tag': { en: 'Tap the green lights before they fade, skip the red ones', tr: 'Yeşil ışıklara sönmeden dokun, kırmızılara dokunma' },
  'firework-jacks': { en: 'Jumping jacks on the beat', tr: 'Ritme göre jumping jack' },
  'twist-turbine': { en: 'Twist your shoulders from side to side', tr: 'Omuzlarını bir yana bir yana çevir' },
  'summit-climb': { en: 'Reach up and pull down, hand over hand', tr: 'Yukarı uzan, aşağı çek, el ele tırman' },
  'limbo-bend': { en: 'Lean sideways to match tilted gates', tr: 'Eğik kapılara uymak için yana eğil' },
  'pose-wall': { en: 'Hold a body shape to fit a hole in a wall', tr: 'Duvardaki boşluğa uymak için bir beden şekli tut' },
  'road-run': { en: 'Jump, duck and lean to dodge what comes down the road', tr: 'Yoldan gelenleri aşmak için zıpla, eğil, yana yaslan' },
};

// ───────── the workout plans the pages mention ─────────

export interface PlanFacts {
  plan: WorkoutPlan;
  resolved: ResolvedPlan;
  title: string;
  /** Titles of the games in the order of the plan. */
  steps: string[];
  /** Seconds of rest after each game but the last (the plans of the pages use one length for all). */
  rests: number[];
  minutes: number;
  free: boolean;
}

/** A plan as the pages state it: resolved against the catalogue snapshot, with the seated setting a player of that plan starts with. */
export function planFacts(id: string, lang: Lang): PlanFacts {
  const plan = WORKOUT_PLANS.find((p) => p.id === id);
  if (!plan) throw new Error(`no workout plan ${id}`);
  const catalog = snapshotGames().map((g) => ({ id: g.id, free: g.free, seated: g.seated, lowImpact: g.lowImpact, durationSec: g.seconds }));
  const resolved = resolvePlan(plan, catalog, { seated: null });
  const titles = new Map(gameList(lang).map((g) => [g.id, g.title] as const));
  return {
    plan,
    resolved,
    title: localized(plan.title, lang),
    steps: resolved.steps.map((s) => titles.get(s.game) ?? s.game),
    rests: resolved.steps.slice(0, -1).map((s) => s.restSec),
    minutes: resolved.minutes,
    free: plan.id === FREE_PLAN_ID,
  };
}

// ───────── structured data ─────────

/** schema.org ItemList of pages (the games, in the page's order). */
export function itemListLd(name: string, items: readonly { name: string; url: string }[]): object {
  return {
    '@type': 'ItemList',
    name,
    numberOfItems: items.length,
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, url: `${SITE}${it.url}` })),
  };
}

// ───────── the list of related pages at the end of each page ─────────

const MORE_TITLE: Readonly<Record<Lang, string>> = { en: 'Keep reading', tr: 'Devamı' };
const GUIDE_NAME: Readonly<Record<Lang, { name: string; about: string }>> = {
  en: { name: 'How webcam fitness games work', about: 'how a browser reads your body, and how to set up your room' },
  tr: { name: 'Kamera ile spor oyunları nasıl çalışır', about: 'tarayıcının bedenini nasıl okuduğu ve odanı nasıl hazırlayacağın' },
};

/** The section "Keep reading": the other search pages and the guide, one line each (not the page itself). */
export function moreSection(lang: Lang, self: SeoPage): Section {
  const items = (['hub', 'seated', 'friends', 'areas'] as const).filter((p) => p !== self)
    .map((p) => `${seoLink(lang, p)}: ${SEO_NAME[lang][p].about}.`);
  items.push(`${link(GUIDE_URL[lang], GUIDE_NAME[lang].name)}: ${GUIDE_NAME[lang].about}.`);
  return { id: 'more', title: MORE_TITLE[lang], html: ul(items) };
}

/** "Title (Free)" or "Title (Pro)" for the lists. */
export const planWord = (g: Pick<GameInfo, 'free'>, lang: Lang): string => (g.free ? (lang === 'tr' ? 'Ücretsiz' : 'Free') : 'Pro');

/** A sentence of the manifests turned into the middle of another one: first letter small (Turkish rules in Turkish), no full stop at the end. */
export const inline = (s: string, lang: Lang): string => {
  const t = s.trim().replace(/\.$/, '');
  return t.charAt(0).toLocaleLowerCase(lang === 'tr' ? 'tr' : 'en') + t.slice(1);
};
