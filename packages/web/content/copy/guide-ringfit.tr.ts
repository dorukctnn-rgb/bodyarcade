// Rehber: tarayıcıda oynayabileceğin bir Ring Fit Adventure alternatifi (Türkçe). BodyArcade tarafı katalogdan ve planlardan gelir;
// Ring Fit tarafı Nintendo'nun sattığı ve oyun hakkında söylediği, herkesin bildiği şeylerle sınırlı tutulur.
import { articleLd, cta, faqLd, qa, readMinutes, table, ul, type PageSpec, type Section } from '../chrome.ts';
import * as F from '../facts.ts';
import { gameCounts, gameList, roundLength } from './games.ts';
import { GUIDE_RINGFIT_EN } from './guide-ringfit.en.ts';

export function guideRingfitTr(): PageSpec {
  const c = gameCounts();
  const $ = (n: number): string => F.usd(n, 'tr');
  const faq = [
    {
      q: 'BodyArcade, Ring Fit Adventure’ın yerini tutar mı?',
      a: '<p>Tam olarak değil. Ring Fit Adventure, Ring-Con ile direnç egzersizleri yaptıran uzun bir rol yapma oyunudur. BodyArcade bacaklar, kollar, karın ve denge için kısa kameralı oyunlardan oluşur. Konsol ya da aksesuar almadan hızlı, hareketli oyunlar isteyenlere uygundur.</p>',
    },
    {
      q: 'BodyArcade için aksesuar gerekir mi?',
      a: '<p>Hayır. BodyArcade dizüstü, masaüstü, tablet ya da telefonundaki kamerayı kullanır. Poz tespiti cihazında çalışır ve görüntü orada kalır.</p>',
    },
    {
      q: 'Hangisi daha iyi bir antrenman?',
      a: '<p>Farklı şeyleri çalıştırırlar. Ring Fit, Ring-Con ile direnç ekler ve geniş bir güç ve yoga tarzı hareket yelpazesi sunar. BodyArcade dirençsiz, tüm vücut hareketinden oluşan kısa turlardır. Birçok kişi ikisinden de keyif alacaktır.</p>',
    },
  ];
  const sections: Section[] = [
    {
      id: 'bakis',
      title: 'Bir bakışta',
      html: table(null, ['Konu', 'Ring Fit Adventure', 'BodyArcade'], [
        ['Neye ihtiyacın var', 'Bir Nintendo Switch, Joy-Con kumandaları ve oyunla birlikte gelen Ring-Con ile Leg Strap', 'Kamerası ve tarayıcısı olan bir dizüstü, masaüstü, tablet ya da telefon'],
        ['Seni nasıl takip eder', 'Joy-Con’lardaki hareket sensörleri ve Ring-Con’daki, sıkmayı ve çekmeyi algılayan bir kuvvet sensörü', `Kamera ve bedeninde ${F.MODEL_POINTS} nokta bulan, cihazda çalışan bir poz modeli`],
        ['Oyun türü', 'Savaşlar, seviyeler ve mini oyunlarla rol yapma macerası', `Bacaklar, kollar, karın ve denge için ${c.total} kısa arcade oyunu`],
        ['Seans süresi', 'İstediğin kadar; macera seviyeleri daha uzun seanslara uygundur', `${roundLength(c.shortest, 'tr')} ile ${roundLength(c.longest, 'tr')} arasında turlar`],
        ['Maliyet', 'Oyunun tek seferlik satın alımı ve konsol', `${c.total} oyunun ${c.free} tanesi ücretsiz, reklamsız.<span data-web-pay> Pro ayda ${$(F.PRICE.proMonthly)}, yılda ${$(F.PRICE.proYearly)} ya da tek sefer ${$(F.PRICE.lifetime)}</span>`],
      ]),
    },
    {
      id: 'ringfit',
      title: 'Ring Fit Adventure’ın daha güçlü olduğu yerler',
      html: ul([
        '<strong>Direnç.</strong> Ring-Con’u sıkmak ve çekmek, bir kameranın veremeyeceği bir güç öğesi ekler.',
        '<strong>Çeşitlilik.</strong> Çömelmeden plank’e, yoga tarzı pozlara kadar büyük bir egzersiz kütüphanesi var.',
        '<strong>Hikâye ve ilerleme.</strong> Macera modu haftalarca geri dönmen için bir sebep verir.',
        '<strong>Kadraj yok.</strong> Joy-Con, nerede durursan dur ve hangi ışıkta olursa olsun seni takip eder.',
      ]),
    },
    {
      id: 'bodyarcade',
      title: 'BodyArcade’ın daha güçlü olduğu yerler',
      html: ul([
        '<strong>Satın alınacak bir şey yok.</strong> Zaten sahip olduğun dizüstü, masaüstü, tablet ya da telefonda çalışır.',
        '<strong>Hızlı başlar.</strong> Sayfayı aç, kameraya izin ver ve oyna. İlk ziyarette yaklaşık iki dakikalık bir karşılama turu olur. Kurulacak bir şey ve açılacak bir hesap yok.',
        `<strong>Kısa turlar.</strong> Bir tur ${roundLength(c.shortest, 'tr')} ile ${roundLength(c.longest, 'tr')} arasında sürer; bu yüzden masa molası ya da hızlı bir ısınma olarak işe yarar.`,
        `<strong>Oturarak ve sessiz.</strong> Her oyunun oturarak sürümü var ve ${c.total} oyunun ${c.quiet} tanesi zıplamadan ve yere vurmadan oynanabilir.`,
        '<strong>Birlikte oyna.</strong> İki kişi büyük bir ekranda tek kamerayı paylaşabilir; arkadaşlar iki ile dört oyunculu çevrimiçi bir odaya katılabilir.',
      ]),
    },
    {
      id: 'oyunlar',
      title: 'BodyArcade bedeninden ne ister',
      html: `<p>${c.total} oyun, her birinin kendi hareketiyle. ${c.free} tanesi ücretsiz; diğerleri Pro’nun parçasıdır ve her birini bir kez ücretsiz oynayabilirsin.</p>
${table(null, ['Oyun', 'Ne yaparsın', 'Tur', 'Plan'], gameList('tr').map((g) => [g.title, g.tagline, roundLength(g.seconds, 'tr'), g.free ? (g.id === 'road-run' ? `Ücretsiz, ${F.ROAD_RUN_WORLDS.total} dünyadan ${F.ROAD_RUN_WORLDS.free} tanesi` : 'Ücretsiz') : 'Pro']))}`,
    },
    {
      id: 'kurulum',
      title: 'Kameralı bir antrenman nasıl kurulur',
      html: `${ul([
  '<strong>Mesafe.</strong> Kameranın başından ayak bileklerine kadar seni gördüğü yere dur: dizüstünden 2 ile 3 metre, dik duran bir telefondan 1,5 ile 2 metre.',
  '<strong>Işık.</strong> Bir pencereye ya da lambaya dön. Arkandaki güçlü ışık takibi daha az güvenilir yapar.',
  '<strong>Sabitlik.</strong> Dizüstünü ya da telefonu bir masaya ya da rafa koy; sen hareket ederken kımıldamasın.',
  '<strong>Ayakkabı ve zemin.</strong> Kaygan olmayan bir zeminde spor ayakkabı, çevrende yaklaşık 2 metre boş alan.',
])}
<p>Daha fazlası için <a href="/tr/kamera-ile-spor-oyunlari">kamera ile spor oyunları nasıl çalışır ve odanı nasıl hazırlarsın</a> rehberine bak.</p>`,
    },
    {
      id: 'sss',
      title: 'Sık sorulan sorular',
      html: faq.map((i) => qa(i.q, i.a)).join('\n'),
    },
  ];
  const title = 'Tarayıcıda oynayabileceğin bir Ring Fit Adventure alternatifi';
  const description = 'Ring Fit Adventure ile BodyArcade’ın dürüst bir karşılaştırması: ne gerekir, her biri seni nasıl takip eder, antrenman türü ve maliyet.';
  const lead = 'Ring Fit Adventure, şimdiye kadar yapılmış en sevilen spor oyunlarından biri. Ayrıca bir Nintendo Switch, Joy-Con kumandaları ve kutuda gelen Ring-Con ile Leg Strap ister. Bir Switch’in yoksa ya da elindeki bir dizüstünde hemen başlayabileceğin bir şey istiyorsan, farklı türde bir oyun isteyeceksin.';
  const minutes = readMinutes(lead + sections.map((s) => s.html).join(' '));
  return {
    file: 'tr/ring-fit-adventure-alternatifi.html',
    url: '/tr/ring-fit-adventure-alternatifi',
    lang: 'tr',
    other: { lang: 'en', url: '/ring-fit-adventure-alternative' },
    og: 'article',
    title,
    description,
    h1: title,
    when: `Güncelleme: ${F.longDate(GUIDE_RINGFIT_EN.modified, 'tr')} &middot; ${minutes} dk okuma`,
    lead: `${lead} BodyArcade bizim yanıtımız. Kısa kameralı oyunlardan oluşur ve Ring Fit’i kopyalamaya çalışmaz. Hangisinin sana uyduğuna karar verebilmen için dürüst bir karşılaştırma burada.`,
    sections,
    toc: true,
    after: cta('Bir tur birkaç dakika sürer ve bir kameradan başka bir şey gerektirmez.', '/tr/', 'Bir oyun oyna'),
    crumbs: [{ name: 'BodyArcade', url: '/tr/' }, { name: 'Ring Fit Adventure alternatifi', url: '/tr/ring-fit-adventure-alternatifi' }],
    jsonLd: [
      articleLd({ headline: title, description, url: '/tr/ring-fit-adventure-alternatifi', published: GUIDE_RINGFIT_EN.published, modified: GUIDE_RINGFIT_EN.modified, lang: 'tr' }),
      faqLd(faq),
    ],
  };
}
