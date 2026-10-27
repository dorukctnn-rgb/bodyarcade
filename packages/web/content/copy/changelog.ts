// The release notes, in English and Turkish: what changed in each release of the site, newest first. A public page, so that a player
// can see that the games added later really come (the Pro plans include them) and when.
//
// Each entry is history: its numbers are what was true on its day and are written as they were (11 games, 8 free on 26 October), not
// read from the catalogue, which moves on. The newest entry is the release this file ships in; add one with every release, at the top.
import { cta, ul, type PageSpec, type Section } from '../chrome.ts';
import * as F from '../facts.ts';
import { PAGES_CHANGELOG, PRICING_URL } from './pricing.en.ts';

interface Entry {
  /** The day the release went live, or for the newest one the day it was finished and tested (ISO). */
  day: string;
  title: { en: string; tr: string };
  items: { en: string; tr: string }[];
}

export const ACTIVE_ARCADE_URL = { en: '/active-arcade-alternative', tr: '/tr/active-arcade-alternatifi' } as const;

export const RELEASES: readonly Entry[] = [
  {
    day: '2026-10-27',
    title: { en: 'Prices, release notes and small phones', tr: 'Fiyatlar, sürüm notları ve küçük telefonlar' },
    items: [
      {
        en: 'The Pro screen fits small phones: the plans are on the first screen, and the buy button and &ldquo;Continue free&rdquo; share one row.',
        tr: 'Pro ekranı küçük telefonlara sığar: planlar ilk ekranda, satın alma düğmesi ile &ldquo;Ücretsiz devam et&rdquo; tek satırda.',
      },
      {
        en: 'On a game&rsquo;s page only Play stays at the foot of a phone&rsquo;s screen; the races with a friend and with a ghost follow it in the page.',
        tr: 'Bir oyunun sayfasında telefon ekranının altında yalnızca Oyna kalır; arkadaşla ve hayaletle yarış düğmeleri sayfada onu izler.',
      },
      {
        en: `New pages: <a href="${PRICING_URL.en}">prices</a>, these release notes, and a <a href="${ACTIVE_ARCADE_URL.en}">comparison</a> with Active Arcade.`,
        tr: `Yeni sayfalar: <a href="${PRICING_URL.tr}">fiyatlar</a>, bu sürüm notları ve Active Arcade ile bir <a href="${ACTIVE_ARCADE_URL.tr}">karşılaştırma</a>.`,
      },
      {
        en: 'The home page says what BodyArcade is, which games have live races, where it plays and what Pro costs, also in a browser that does not run scripts.',
        tr: 'Ana sayfa BodyArcade’in ne olduğunu, hangi oyunlarda canlı yarış olduğunu, nerede oynandığını ve Pro’nun fiyatını söyler; betik çalıştırmayan bir tarayıcıda da.',
      },
      {
        en: 'The Pro screen lists the four workout plans of Pro and the games added later.',
        tr: 'Pro ekranı Pro’nun dört antrenman planını ve sonradan eklenen oyunları da sayar.',
      },
      {
        en: 'The body area pages count their own free games. They used to give the free games of the whole set.',
        tr: 'Bölge sayfaları kendi ücretsiz oyunlarını sayar. Önceden bütün oyunların ücretsiz sayısını yazıyordu.',
      },
      {
        en: 'bodyarcade.com/support opens the FAQ, and a visitor without an online profile no longer gets an error line in the browser console.',
        tr: 'bodyarcade.com/tr/destek SSS’yi açar; çevrimiçi profili olmayan bir ziyaretçi tarayıcı konsolunda artık hata satırı görmez.',
      },
    ],
  },
  {
    day: '2026-10-27',
    title: { en: 'Reaction Tag races and four guides', tr: 'Reaction Tag yarışı ve dört rehber' },
    items: [
      {
        en: 'Reaction Tag can be raced live in a room: the same lights for everyone at the same moment. It is a Pro game, so the host needs Pro and the friends who join do not.',
        tr: 'Reaction Tag bir odada canlı yarışılabilir: herkese aynı anda aynı ışıklar. Bir Pro oyunudur; ev sahibinde Pro gerekir, katılan arkadaşlarda gerekmez.',
      },
      {
        en: 'Four guides in English and in Turkish: fitness games, seated exercise games, games to play with friends and games by body area.',
        tr: 'İngilizce ve Türkçe dört rehber: evde spor oyunları, oturarak egzersiz oyunları, arkadaşlarla oyunlar ve bölgeye göre oyunlar.',
      },
      {
        en: 'With a phone held sideways, the main button of Friends, the sign-up, Pro and Workout plans is on the first screen.',
        tr: 'Telefon yatay tutulduğunda Arkadaşlar, kayıt, Pro ve Antrenman planları ekranlarının ana düğmesi ilk ekranda.',
      },
      {
        en: 'The trial reminder is a notice in the app, as the pages and the Pro screen now say.',
        tr: 'Deneme hatırlatması uygulamada bir bildirimdir; sayfalar ve Pro ekranı artık bunu söyler.',
      },
    ],
  },
  {
    day: '2026-10-26',
    title: { en: 'BodyArcade 2', tr: 'BodyArcade 2' },
    items: [
      {
        en: '11 games, 8 of them free, for legs, arms, chest and back, core, cardio and balance. Every game has a seated version.',
        tr: 'Bacak, kol, göğüs ve sırt, karın, kardiyo ve denge için 11 oyun, 8 tanesi ücretsiz. Her oyunun oturarak sürümü var.',
      },
      {
        en: 'Live races with friends in rooms of 2 to 4 players, by an invite link or a code, with friends lists, public lobbies and ghost races.',
        tr: 'Davet bağlantısı ya da kodla 2 ile 4 kişilik odalarda arkadaşlarla canlı yarış; arkadaş listesi, herkese açık lobiler ve hayalet yarışları.',
      },
      {
        en: 'Two players on one camera on a big screen, workout plans, a challenge of the day and weekly boards.',
        tr: 'Büyük ekranda tek kamerada iki oyuncu, antrenman planları, günün meydan okuması ve haftalık tablolar.',
      },
      {
        en: 'English and Turkish, and the plans of today: Pro monthly, Pro yearly with a free trial, Family yearly and Lifetime.',
        tr: 'İngilizce ve Türkçe, ve bugünkü planlar: Pro aylık, ücretsiz denemeli Pro yıllık, Aile yıllık ve Ömür boyu.',
      },
    ],
  },
];

/** The newest release (the top of the list). */
export const LATEST_RELEASE = RELEASES[0] as Entry;

function page(lang: F.Lang): PageSpec {
  const en = lang === 'en';
  const sections: Section[] = RELEASES.map((r, i) => ({
    id: `r${RELEASES.length - i}`,
    title: `${F.longDate(r.day, lang)}: ${r.title[lang]}`,
    html: ul(r.items.map((x) => x[lang])),
  }));
  const title = en ? 'What is new in BodyArcade' : 'BodyArcade’de yenilikler';
  const description = en
    ? 'The release notes of BodyArcade: the games, the screens and the pages that each release added or changed, newest first, with the day it went live.'
    : 'BodyArcade’in sürüm notları: her sürümün eklediği ya da değiştirdiği oyunlar, ekranlar ve sayfalar, en yenisi başta, yayın günüyle.';
  return {
    file: en ? 'changelog.html' : 'tr/surum-notlari.html',
    url: PAGES_CHANGELOG[lang],
    lang,
    other: { lang: en ? 'tr' : 'en', url: PAGES_CHANGELOG[en ? 'tr' : 'en'] },
    title,
    description,
    h1: en ? 'What is new' : 'Yenilikler',
    when: en ? `Last release ${F.longDate(LATEST_RELEASE.day, lang)}` : `Son sürüm ${F.longDate(LATEST_RELEASE.day, lang)}`,
    lead: en
      ? 'What changed in BodyArcade, release by release, newest first. Pro includes the games we add later, and this is where they appear.'
      : 'BodyArcade’de her sürümde neyin değiştiği, en yenisi başta. Pro, sonradan eklediğimiz oyunları da içerir; onlar burada görünür.',
    sections,
    toc: false,
    after: en ? cta('Try what is new in a couple of minutes.', '/', 'Play a game') : cta('Yenilikleri birkaç dakikada dene.', '/tr/', 'Bir oyun oyna'),
    crumbs: [{ name: 'BodyArcade', url: en ? '/' : '/tr/' }, { name: en ? 'What is new' : 'Yenilikler', url: PAGES_CHANGELOG[lang] }],
  };
}

export const changelogEn = (): PageSpec => page('en');
export const changelogTr = (): PageSpec => page('tr');
