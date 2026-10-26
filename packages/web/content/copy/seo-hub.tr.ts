// Arama sayfası: evde spor oyunları, kamerayla oynanan egzersiz oyunları (Türkçe). Hedef aramalar: evde spor oyunları, evde spor,
// evde egzersiz, evde fitness. Katalogdaki her oyunu, bedenden ne istediğini, turun uzunluğunu ve ücretsiz olup olmadığını sıralar ve
// ziyaretçinin seçmesine yardım eder. Sayılar ve adlar katalog anlık görüntüsünden, facts.ts'ten ve uygulamanın kendi sözcüklerinden
// gelir (seo-shared.ts); content.test.ts sayfayı bunlarla karşılaştırır.
import { cta, faqLd, link, qa, readMinutes, table, ul, type PageSpec, type Section } from '../chrome.ts';
import * as F from '../facts.ts';
import { WORKOUT_PLANS } from '../../../core/store/workout-plans.ts';
import { gameCounts, listWords, roundLength, titlesOf } from './games.ts';
import { SEO_DATES, SEO_NAME, SEO_URL, GUIDE_URL, MOVE, gameLink, games, itemListLd, moreSection, otherOf, planWord, proHref, regionName, seoFile, seoLink } from './seo-shared.ts';

export function seoHubTr(): PageSpec {
  const lang = 'tr';
  const c = gameCounts();
  const W = F.ROAD_RUN_WORLDS;
  const all = games(lang);
  const freeShort = all.filter((g) => g.free && g.seconds <= 180).sort((a, b) => a.seconds - b.seconds);
  const vigorous = [...all].sort((a, b) => b.met - a.met).slice(0, 3);
  const upper = all.filter((g) => g.framing === 'upper');
  const full = all.filter((g) => g.framing === 'full');
  const listed = (xs: readonly string[]): string => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} ve ${xs[xs.length - 1]}`);
  const proPlans = WORKOUT_PLANS.length - 1;

  const sections: Section[] = [
    {
      id: 'oyunlar',
      title: `${c.total} oyunun hepsi`,
      html: `<p>Bir tur ${roundLength(c.shortest, lang)} ile ${roundLength(c.longest, lang)} arasında sürer. Bir oyuna tıkla; sayfasında adımlar, kameranın ne okuduğu, oturarak ve sessiz sürümler yer alır.</p>
${table(null, ['Oyun', 'Ne yaparsın', 'Tur', 'Ücretsiz mi, Pro mu', 'Bölge'], all.map((g) => [
  gameLink(g, lang),
  `${MOVE[g.id]?.tr ?? ''}`,
  roundLength(g.seconds, lang),
  planWord(g, lang),
  g.regions.map((r) => regionName(r, lang)).join(', '),
]))}`,
    },
    {
      id: 'sec',
      title: 'Hangisiyle başlamalı',
      html: ul([
        `<strong>Üç dakikan ya da daha azın var.</strong> Şu ücretsiz oyunlar sığar: ${listed(freeShort.map((g) => `${gameLink(g, lang)} (${roundLength(g.seconds, lang)})`))}.`,
        `<strong>Isınmak ve nefesini hızlandırmak istiyorsun.</strong> Uygulama ${listed(vigorous.map((g) => gameLink(g, lang)))} oyunlarını en yoğun oyunları olarak değerlendirir${vigorous.every((g) => g.free) ? '; üçü de ücretsizdir' : ''}. Ayakta oynanırlar ve her birinin oturarak sürümü vardır.`,
        `<strong>Zıplamak istemiyorsun.</strong> ${c.total} oyunun ${c.quiet} tanesinde zıplama ve yere vurma olmayan bir sessiz mod var; alt kattaki komşulara saygılıdır. Ayarlar’dan aç.`,
        `<strong>Oturmayı tercih ediyorsun.</strong> Her oyunun oturarak sürümü var. ${seoLink(lang, 'seated', 'Oturarak egzersiz oyunları sayfası')} hepsini sırayla anlatır.`,
        `<strong>Biriyle birlikte oynuyorsun.</strong> ${c.local2} oyunda iki kişi tek kamerayı paylaşabilir; ${listWords(all.filter((g) => g.live).map((g) => gameLink(g, lang)), lang)} oyunlarında canlı çevrimiçi yarışlar var. ${seoLink(lang, 'friends', 'Arkadaşlarla spor oyunları')} sayfasına bak.`,
        `<strong>Vücudunun belirli bir bölgesini çalıştırmak istiyorsun.</strong> ${seoLink(lang, 'areas', 'Bölgeye göre spor oyunları')} sayfası bacak, kol, göğüs ve sırt, karın, kardiyo ve hareketlilik oyunlarını sıralar.`,
      ]),
    },
    {
      id: 'gerek',
      title: 'Ne gerekir',
      html: `<p>Kamerası ve güncel bir tarayıcısı (Chrome, Edge, Firefox ya da Safari) olan bir telefon, tablet, dizüstü ya da masaüstü bilgisayar. Kurulacak bir şey ve açılacak bir hesap yok. İlk seferde oyun, yaklaşık 6 MB olan poz modelini indirir ve cihazında saklar.</p>
<p>${c.total} oyunun ${full.length} tanesinde bütün vücudun, baştan ayak bileklerine kadar, görünmelidir: dizüstüne 2 ile 3 metre, dik tutulan telefona 1,5 ile 2 metre uzakta dur. Diğer ${upper.length} oyun (${listed(upper.map((g) => g.title))}) yalnızca başından kalçana kadar görünmeni ister, yaklaşık 1 metre uzaklıkta; bu yüzden masada da oynanır.</p>
<p>Işığı önüne ya da yanına al; ayakta oynuyorsan çevrende yaklaşık 2 metre boşluk aç. Hazırlığın tamamı için ${link(GUIDE_URL[lang], 'Kamera ile spor oyunları nasıl çalışır')} rehberine bak. Kameran yoksa, izin veren oyunlar klavye ya da dokunmatikle oynanabilir. Bu turlar antrenmandır ve kayıtlarında tutulmaz.</p>`,
    },
    {
      id: 'ucretsiz',
      title: 'Ücretsiz ve Pro',
      html: `<p>${c.total} oyunun ${c.free} tanesi ücretsiz: ${titlesOf((g) => g.free, lang)}. Oturarak ve sessiz sürümleriyle, Kolay ve Normal zorluk seviyeleriyle ve reklamsız gelirler. Road Run’ın ${W.total} dünyası var ve ${W.free} tanesi ücretsiz.</p>
<p>Pro şunları ekler: ${titlesOf((g) => !g.free, lang)}, Zor ve Uzman seviyeler, Road Run’ın diğer ${W.total - W.free} dünyası, ${WORKOUT_PLANS.length} antrenman planının ${proPlans} tanesi (Masa molası ücretsiz) ve daha sonra eklediğimiz oyunlar. Sonradan eklenen oyunlar, bir üyelik etkin olduğu sürece ve Ömür boyu planda dahildir. Her Pro oyunu karar vermeden önce bir kez ücretsiz oynayabilirsin. Planlar ve fiyatlar ${link(proHref(lang), 'Pro sayfasında')}.</p>`,
    },
    {
      id: 'sinir',
      title: 'Kameralı bir oyunun yapamadıkları',
      html: ul([
        '<strong>Direnç ekleyemez.</strong> Bir kamera seni bir şeye karşı itmeye zorlayamaz; bu yüzden bu oyunlar vücut ağırlığıyla hareket ve kardiyodur. Güç programı için ağırlık kullan; BodyArcade ısınma ya da mola olarak işe yarar.',
        '<strong>Bir hareketi kaçırabilir.</strong> Tek kamera büyük vücut parçalarının büyük hareketlerini iyi okur. İnce el konumları, çok hızlı hareketler ve mobilyanın arkasında kalan her şey daha zordur. Bir hareket sayılmadığında sonuç ekranı nedenini söyler; örneğin kalça yeterince inmedi ya da bir el görüntü dışındaydı.',
        '<strong>Kalori değerleri tahmindir.</strong> Girdiğin kiloya (cihazında kalır), ne kadar hareket ettiğine ve her oyunun yoğunluğuna dayanır. Kilo girmezsen kalori gösterilmez.',
        '<strong>Tıbbi tavsiye değildir.</strong> Kalp atışını ölçmez. Hamileysen, kalp ya da eklem rahatsızlığın varsa ya da hareket ederken ağrı duyuyorsan önce doktoruna danış. Baş dönmesi ya da keskin bir ağrı hissedersen dur.',
      ]),
    },
  ];

  const faq = [
    {
      q: 'Hiçbir şey kurmadan tarayıcıda spor oyunu oynayabilir miyim?',
      a: '<p>Evet. BodyArcade bir telefonun, tabletin, dizüstünün ya da masaüstünün tarayıcısında çalışır; kamera ve poz modeli cihazında çalışır. Kurulacak bir şey ve açılacak bir hesap yok.</p>',
    },
    {
      q: 'Kumandaya ya da başka bir ekipmana ihtiyacım var mı?',
      a: '<p>Hayır. Kumanda kameran: dizüstünün kapağındaki, monitörün üstündeki ya da telefonunun önündeki kamera yeter. Ağırlık, lastik band ya da sensör yok; yalnızca ayakta oynadığın oyunlar için biraz yer gerekir.</p>',
    },
    {
      q: 'Kamera görüntüm yükleniyor mu?',
      a: `<p>Hayır. Cihazın görüntüyü anında ${F.MODEL_POINTS} vücut noktasına çevirir ve görüntü hiçbir zaman yüklenmez, kaydedilmez ya da saklanmaz. Cihazından çıkan tek görüntü isteğe bağlıdır: ikisi de ${F.AGE.video} yaşında ya da daha büyük olan arkadaşlar, özel bir odada ikisi de açtığında birbirlerine kameralarını gösterebilir. <a href="/tr/privacy">Gizlilik politikasına</a> bak.</p>`,
    },
    {
      q: 'Telefonda çalışır mı?',
      a: '<p>Evet, telefonunun tarayıcısında, dik ya da yatay. Tek kamerada iki oyuncu daha büyük bir ekran ister ve telefon boyutundaki ekranlarda sunulmaz.</p>',
    },
    {
      q: 'Bir oyun ne kadar sürer?',
      a: `<p>Bir tur ${roundLength(c.shortest, lang)} (${all.find((g) => g.seconds === c.shortest)?.title}) ile ${roundLength(c.longest, lang)} (${all.find((g) => g.seconds === c.longest)?.title}) arasında sürer; diğerleri bunların arasındadır. Çoğu, arada dinlenme olan setlerle oynanır. <a href="/tr/faq">SSS</a> planlar, ödemeler ve verilerinle ilgili soruları yanıtlar.</p>`,
    },
  ];
  sections.push({ id: 'sss', title: 'Sık sorulanlar', html: faq.map((i) => qa(i.q, i.a)).join('\n') }, moreSection(lang, 'hub'));

  const title = 'Evde spor oyunları: kamerayla oynanan egzersiz oyunları';
  const description = `${c.total} kısa spor oyunu, kumanda yerine web kameran: çömelme, diz kaldırma, jumping jack, yumruk. ${c.free} tanesi ücretsiz, kurulum yok.`;
  const lead = `BodyArcade, bedeninle oynadığın ${c.total} kısa spor oyunundan oluşur. Web kameran ya da telefon kameran hareketlerini okur; kumanda, kurulum ve hesap gerekmez. Oyunların ${c.free} tanesi ücretsizdir. Bu sayfa hepsini sıralar, her birinin senden ne istediğini anlatır ve seçmene yardım eder.`;
  const minutes = readMinutes(lead + sections.map((s) => s.html).join(' '));
  return {
    file: seoFile(lang, 'hub'),
    url: SEO_URL[lang].hub,
    lang,
    other: otherOf(lang, 'hub'),
    title,
    description,
    h1: title,
    when: `Güncelleme: ${F.longDate(SEO_DATES.modified, lang)} &middot; ${minutes} dk okuma`,
    lead,
    sections,
    toc: true,
    after: cta('Bir oyun aç, kameraya izin ver ve ilk turu oyna. Birkaç dakika sürer.', '/tr/', 'Bir oyun oyna'),
    crumbs: [{ name: 'BodyArcade', url: '/tr/' }, { name: SEO_NAME[lang].hub.name, url: SEO_URL[lang].hub }],
    jsonLd: [
      itemListLd(`${c.total} spor oyunu`, all.map((g) => ({ name: g.title, url: `/tr/games/${g.slug}/` }))),
      faqLd(faq),
    ],
  };
}
