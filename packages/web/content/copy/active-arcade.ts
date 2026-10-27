// BodyArcade next to Active Arcade, in English and Turkish (the search: "Active Arcade alternative"). BodyArcade's side comes from the
// catalogue, the facts and the release notes. Active Arcade's side is only what a public source says, and each fact names its source
// and the day it was read: the App Store listing (iTunes Lookup and the store page) and NEX's own Play Pass page. Nothing else is said
// about it: not where else it is sold, not why it is not updated. When a fact is read again, change the day of its source.
import { articleLd, cta, faqLd, link, qa, readMinutes, table, ul, type PageSpec, type Section } from '../chrome.ts';
import * as F from '../facts.ts';
import { ACTIVE_ARCADE_URL, LATEST_RELEASE } from './changelog.ts';
import { gameCounts, titlesOf } from './games.ts';
import { PAGES_CHANGELOG, PRICING_URL } from './pricing.en.ts';

export const ACTIVE_ARCADE_DATES = { published: '2026-10-27', modified: '2026-10-27' } as const;

/** The public sources of every fact about Active Arcade and NEX on the page, and the day each was read (ISO). */
export const SOURCES = {
  appStore: { url: 'https://apps.apple.com/us/app/active-arcade/id1553158383', read: '2026-10-27' },
  playPass: { url: 'https://nexplayground.com/play-pass', read: '2026-10-27' },
} as const;

/** What those sources said on the day they were read. */
export const ACTIVE_ARCADE = {
  maker: 'NEX Team Inc.',
  version: '3.11',
  updated: '2022-12-19',
  firstReleased: '2021-03-31',
  sizeMb: 983,
  rating: 4.7,
  ratings: 1133,
  playPass: { year: 89, quarter: 49, starterGames: 5 },
} as const;

const SRC = { en: { a: '[1]', b: '[2]' }, tr: { a: '[1]', b: '[2]' } } as const;

function page(lang: F.Lang): PageSpec {
  const en = lang === 'en';
  const c = gameCounts();
  const A = ACTIVE_ARCADE;
  const s = SRC[lang];
  const day = (iso: string): string => F.longDate(iso, lang);
  const $ = (n: number): string => F.usd(n, lang);
  const n1133 = en ? '1,133' : '1.133';
  const rating = en ? String(A.rating) : String(A.rating).replace('.', ',');
  const live = titlesOf((g) => g.live, lang);

  const glance = en
    ? table(null, ['Topic', 'Active Arcade', 'BodyArcade'], [
      ['Where it runs', `An app for iPhone and iPad from the App Store; a TV through AirPlay or HDMI ${s.a}`, 'The browser of a phone, tablet, laptop or desktop: Chrome, Edge, Firefox or Safari'],
      ['What you install', `An app of about ${A.sizeMb} MB ${s.a}`, 'Nothing. The browser keeps the pose model, about 6 MB'],
      ['What it costs', `Free, with no ads, no in-app purchases and no subscription ${s.a}`, `${c.free} of ${c.total} games free, no ads.<span data-web-pay> Pro from ${$(F.PRICE.proMonthly)} a month</span>`],
      ['Last update', `Version ${A.version}, ${day(A.updated)} ${s.a}`, `${day(LATEST_RELEASE.day)}; every change is on the updates page`],
      ['Languages', `English and Chinese ${s.a}`, 'English and Turkish'],
      ['Playing with others', `2-player modes, side by side in front of one device ${s.a}`, `Two people on one camera on a big screen, and live online races in rooms of ${F.SEATS.min} to ${F.SEATS.max} (${live})`],
      ['Seated play', `Not mentioned in the listing ${s.a}`, 'Every game has a seated version'],
      ['Ratings', `${rating} from ${n1133} ratings on the US App Store ${s.a}`, 'A new site, with no store ratings yet'],
    ])
    : table(null, ['Konu', 'Active Arcade', 'BodyArcade'], [
      ['Nerede çalışır', `App Store’dan iPhone ve iPad uygulaması; AirPlay ya da HDMI ile TV ${s.a}`, 'Telefon, tablet, dizüstü ya da masaüstünde tarayıcı: Chrome, Edge, Firefox veya Safari'],
      ['Ne kurarsın', `Yaklaşık ${A.sizeMb} MB’lık bir uygulama ${s.a}`, 'Hiçbir şey. Poz modelini, yaklaşık 6 MB, tarayıcı saklar'],
      ['Ücreti', `Ücretsiz; reklam, uygulama içi satın alma ve abonelik yok ${s.a}`, `${c.total} oyunun ${c.free} tanesi ücretsiz, reklam yok.<span data-web-pay> Pro ayda ${$(F.PRICE.proMonthly)}’dan başlar</span>`],
      ['Son güncelleme', `Sürüm ${A.version}, ${day(A.updated)} ${s.a}`, `${day(LATEST_RELEASE.day)}; her değişiklik güncellemeler sayfasında`],
      ['Diller', `İngilizce ve Çince ${s.a}`, 'İngilizce ve Türkçe'],
      ['Başkalarıyla oynama', `Tek cihazın önünde yan yana 2 oyunculu modlar ${s.a}`, `Büyük ekranda tek kamerada iki kişi ve ${F.SEATS.min} ile ${F.SEATS.max} kişilik odalarda çevrimiçi canlı yarış (${live})`],
      ['Oturarak oynama', `Mağaza sayfasında geçmiyor ${s.a}`, 'Her oyunun oturarak sürümü var'],
      ['Puanlar', `ABD App Store’da ${n1133} puanla ${rating} ${s.a}`, 'Yeni bir site, henüz mağaza puanı yok'],
    ]);

  const sections: Section[] = [
    { id: en ? 'glance' : 'bakis', title: en ? 'At a glance' : 'Bir bakışta', html: glance },
    {
      id: 'active-arcade',
      title: en ? 'Where Active Arcade is the better choice' : 'Active Arcade’in daha iyi seçim olduğu yerler',
      html: ul(en ? [
        `<strong>Everything is free.</strong> The listing says there are no ads, no in-app purchases and no subscription ${s.a}. BodyArcade keeps ${c.total - c.free} of its ${c.total} games for Pro.`,
        `<strong>Made for an iPhone or iPad on a TV.</strong> It is an app, and the listing suggests AirPlay or HDMI for the living room ${s.a}.`,
        `<strong>Many players have rated it.</strong> ${rating} from ${n1133} ratings on the US App Store ${s.a}. BodyArcade is new and has none yet.`,
      ] : [
        `<strong>Her şey ücretsiz.</strong> Mağaza sayfasına göre reklam, uygulama içi satın alma ve abonelik yok ${s.a}. BodyArcade ${c.total} oyunundan ${c.total - c.free} tanesini Pro’ya ayırır.`,
        `<strong>TV’deki bir iPhone ya da iPad için yapılmış.</strong> Bir uygulamadır; mağaza sayfası salon için AirPlay ya da HDMI önerir ${s.a}.`,
        `<strong>Çok oyuncu puanlamış.</strong> ABD App Store’da ${n1133} puanla ${rating} ${s.a}. BodyArcade yeni, henüz puanı yok.`,
      ]),
    },
    {
      id: 'bodyarcade',
      title: en ? 'Where BodyArcade is the better choice' : 'BodyArcade’in daha iyi seçim olduğu yerler',
      html: ul(en ? [
        '<strong>No iPhone or iPad needed.</strong> It runs in the browser of an Android phone, a Windows or Mac computer, an iPhone or an iPad.',
        '<strong>Nothing to download.</strong> Open the page, allow the camera and play. The camera video is read on your device and never uploaded.',
        `<strong>Seated and quiet versions.</strong> Every game can be played from a chair, and ${c.quiet} of ${c.total} without jumping or stamping.`,
        `<strong>Friends far away.</strong> Live races in ${live}, in a room of ${F.SEATS.min} to ${F.SEATS.max} players, and ghost races against a recording.`,
        `<strong>Updated.</strong> The last release was on ${day(LATEST_RELEASE.day)}, and the ${link(PAGES_CHANGELOG.en, 'updates')} page lists every change.`,
      ] : [
        '<strong>iPhone ya da iPad gerekmez.</strong> Android telefonda, Windows ya da Mac bilgisayarda, iPhone’da ya da iPad’de tarayıcıda çalışır.',
        '<strong>İndirecek bir şey yok.</strong> Sayfayı aç, kameraya izin ver ve oyna. Kamera görüntüsü cihazında okunur, hiçbir yere gönderilmez.',
        `<strong>Oturarak ve sessiz sürümler.</strong> Her oyun sandalyeden oynanabilir; ${c.total} oyunun ${c.quiet} tanesi zıplamadan ve tepinmeden oynanır.`,
        `<strong>Uzaktaki arkadaşlar.</strong> ${live} oyunlarında ${F.SEATS.min} ile ${F.SEATS.max} kişilik odada canlı yarış ve bir kayda karşı hayalet yarışı.`,
        `<strong>Güncel.</strong> Son sürüm ${day(LATEST_RELEASE.day)} tarihinde çıktı; her değişiklik ${link(PAGES_CHANGELOG.tr, 'güncellemeler')} sayfasında yazar.`,
      ]),
    },
    {
      id: 'nex',
      title: en ? 'What NEX makes now' : 'NEX bugün ne yapıyor',
      html: en
        ? `<p>${A.maker}, the company behind Active Arcade, now sells Nex Playground, a games console for the TV. Its Play Pass costs $${A.playPass.year} for 12 months or $${A.playPass.quarter} for 3 months, and ${A.playPass.starterGames} games come with the console without a Play Pass ${s.b}. If you want a box under the TV and a large library, it is worth a look; if you want to start on a device you already own, BodyArcade needs nothing more.</p>`
        : `<p>Active Arcade’in arkasındaki şirket ${A.maker} bugün TV için bir oyun konsolu olan Nex Playground’u satıyor. Play Pass 12 ay için ${A.playPass.year} dolar ya da 3 ay için ${A.playPass.quarter} dolar; konsolla birlikte Play Pass olmadan ${A.playPass.starterGames} oyun gelir ${s.b}. TV’nin altında bir kutu ve büyük bir oyun listesi istiyorsan bakmaya değer; elindeki bir cihazla başlamak istiyorsan BodyArcade başka bir şey istemez.</p>`,
    },
  ];

  const faq = en ? [
    { q: 'Are there free apps like Active Arcade?', a: `<p>BodyArcade is one, as a web app: ${c.free} of its ${c.total} games are free, with no ads and no account, and it runs in a browser instead of an app. Pro adds the other ${c.total - c.free} games and more; the ${link(PRICING_URL.en, 'prices page')} has the details.</p>` },
    { q: 'Can I play on an Android phone or a computer?', a: '<p>BodyArcade, yes: it runs in Chrome, Edge, Firefox or Safari on a phone, tablet, laptop or desktop. For this page we read only Active Arcade&rsquo;s App Store listing, which is for iPhone and iPad.</p>' },
    { q: 'Can two people play together?', a: `<p>Both have two-player play. In Active Arcade two people stand side by side in front of one device ${s.a}. In BodyArcade two people can share one camera on a big screen, and friends in other places can race live in a room of ${F.SEATS.min} to ${F.SEATS.max}.</p>` },
    { q: 'Is my camera video uploaded?', a: `<p>Not in BodyArcade: your device turns the video into ${F.MODEL_POINTS} body points on the spot, and the video is never uploaded, recorded or saved. See the <a href="/privacy">privacy policy</a>.</p>` },
  ] : [
    { q: 'Active Arcade’in ücretsiz bir alternatifi var mı?', a: `<p>BodyArcade bunlardan biri: ${c.total} oyunun ${c.free} tanesi ücretsiz, reklam ve hesap yok; bir uygulama yerine tarayıcıda çalışır. Pro, kalan ${c.total - c.free} oyunu ve fazlasını ekler; ayrıntılar ${link(PRICING_URL.tr, 'fiyatlar sayfasında')}.</p>` },
    { q: 'Android telefonda ya da bilgisayarda oynayabilir miyim?', a: '<p>BodyArcade’de evet: telefon, tablet, dizüstü ya da masaüstünde Chrome, Edge, Firefox veya Safari’de çalışır. Bu sayfa için Active Arcade’in yalnızca iPhone ve iPad için olan App Store sayfasını okuduk.</p>' },
    { q: 'İki kişi birlikte oynayabilir mi?', a: `<p>İkisinde de iki oyunculu oyun var. Active Arcade’de iki kişi tek cihazın önünde yan yana durur ${s.a}. BodyArcade’de büyük ekranda iki kişi tek kamerayı paylaşabilir, başka yerlerdeki arkadaşlar da ${F.SEATS.min} ile ${F.SEATS.max} kişilik bir odada canlı yarışabilir.</p>` },
    { q: 'Kamera görüntüm bir yere gönderiliyor mu?', a: `<p>BodyArcade’de hayır: cihazın görüntüyü anında ${F.MODEL_POINTS} vücut noktasına çevirir; görüntü hiçbir zaman gönderilmez, kaydedilmez ya da saklanmaz. <a href="/tr/privacy">Gizlilik politikasına</a> bak.</p>` },
  ];
  sections.push(
    { id: en ? 'faq' : 'sss', title: en ? 'Questions people ask' : 'Sık sorulanlar', html: faq.map((i) => qa(i.q, i.a)).join('\n') },
    {
      id: en ? 'sources' : 'kaynaklar',
      title: en ? 'Sources' : 'Kaynaklar',
      html: `<ol class="sources">
<li>${en ? 'Active Arcade on the App Store (United States)' : 'App Store’da Active Arcade (ABD)'}, <a href="${SOURCES.appStore.url}" rel="nofollow">apps.apple.com</a>, ${en ? 'read on' : 'okunduğu gün'} ${day(SOURCES.appStore.read)}.</li>
<li>${en ? 'Play Pass, on the Nex Playground site' : 'Nex Playground sitesinde Play Pass'}, <a href="${SOURCES.playPass.url}" rel="nofollow">nexplayground.com</a>, ${en ? 'read on' : 'okunduğu gün'} ${day(SOURCES.playPass.read)}.</li>
</ol>
<p>${en ? 'What the page says about BodyArcade comes from its own game list, its ' : 'BodyArcade hakkında söylenenler kendi oyun listesinden, '}${link(en ? PRICING_URL.en : PRICING_URL.tr, en ? 'prices' : 'fiyatlarından')}${en ? ' and its ' : ' ve '}${link(en ? '/faq' : '/tr/faq', en ? 'FAQ' : 'SSS’sinden')}${en ? '. Active Arcade and Nex Playground are names of NEX Team Inc.; this page is ours, not theirs.' : ' gelir. Active Arcade ve Nex Playground NEX Team Inc.’in adlarıdır; bu sayfa bizim, onların değil.'}</p>`,
    },
  );

  // wording from the keyword scan of 27 Oct (NOTLAR-release3.md): "active arcade app", "android" and "pc" are the strongest suggestions
  // after the name, "active arcade alternative" is offered as it is; in Turkish "apk", "ios", "android". Each says where BodyArcade runs.
  const title = en ? 'Active Arcade app alternative for Android and PC' : 'Active Arcade alternatifi: Android, iPhone ve bilgisayarda';
  const h1 = en ? 'An Active Arcade alternative for Android and PC' : 'Android, iPhone ve bilgisayar için Active Arcade alternatifi';
  const description = en
    ? `An Active Arcade alternative for Android and PC: BodyArcade runs in a browser, with ${c.free} free games. Active Arcade was last updated in ${day(A.updated).replace(/^\d+ /, '')}.`
    : `Android, iPhone ve bilgisayar için Active Arcade alternatifi: BodyArcade tarayıcıda, ${c.free} ücretsiz oyunla çalışır. Active Arcade’in son güncellemesi ${day(A.updated).replace(/^\d+ /, '')}.`;
  const lead = en
    ? `BodyArcade is an Active Arcade alternative that runs in the browser of an Android phone, a PC or Mac, an iPhone or an iPad, with no app to download. Active Arcade is a free app from ${A.maker} that turns your body into the controller of short games on an iPhone or iPad. Its App Store listing shows version ${A.version}, from ${day(A.updated)} ${s.a}. BodyArcade is a set of ${c.total} short camera games. This page puts the two side by side and names the source and the day of every fact about Active Arcade.`
    : `BodyArcade, Android telefonda, PC ya da Mac bilgisayarda, iPhone’da ya da iPad’de tarayıcıda çalışan, uygulama indirmeden oynanan bir Active Arcade alternatifidir. Active Arcade, ${A.maker} firmasının, bir iPhone ya da iPad’de bedenini kısa oyunların kumandasına çeviren ücretsiz uygulaması. App Store sayfası ${day(A.updated)} tarihli ${A.version} sürümünü gösteriyor ${s.a}. BodyArcade ${c.total} kısa kameralı oyundan oluşur. Bu sayfa ikisini yan yana koyar ve Active Arcade hakkındaki her bilginin kaynağını ve tarihini verir.`;
  const minutes = readMinutes(lead + sections.map((x) => x.html).join(' '));
  const url = ACTIVE_ARCADE_URL[lang];
  return {
    file: en ? 'active-arcade-alternative.html' : 'tr/active-arcade-alternatifi.html',
    url,
    lang,
    other: { lang: en ? 'tr' : 'en', url: ACTIVE_ARCADE_URL[en ? 'tr' : 'en'] },
    og: 'article',
    title,
    description,
    h1,
    when: en ? `Updated ${day(ACTIVE_ARCADE_DATES.modified)} &middot; ${minutes} min read` : `Güncelleme: ${day(ACTIVE_ARCADE_DATES.modified)} &middot; ${minutes} dk okuma`,
    lead,
    sections,
    toc: true,
    after: en ? cta('Try a free game in your browser: it takes a couple of minutes and needs only a camera.', '/', 'Play a free game') : cta('Tarayıcında ücretsiz bir oyun dene: birkaç dakika sürer, yalnızca kamera ister.', '/tr/', 'Ücretsiz bir oyun oyna'),
    crumbs: en
      ? [{ name: 'BodyArcade', url: '/' }, { name: 'Blog', url: '/blog/' }, { name: 'Active Arcade alternative', url }]
      : [{ name: 'BodyArcade', url: '/tr/' }, { name: 'Active Arcade alternatifi', url }],
    ...(en ? { nav: 'blog' as const } : {}),
    jsonLd: [
      articleLd({ headline: h1, description, url, published: ACTIVE_ARCADE_DATES.published, modified: ACTIVE_ARCADE_DATES.modified, lang }),
      faqLd(faq),
    ],
  };
}

export const activeArcadeEn = (): PageSpec => page('en');
export const activeArcadeTr = (): PageSpec => page('tr');
