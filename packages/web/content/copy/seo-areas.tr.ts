// Arama sayfası: bölgeye göre spor oyunları (Türkçe). Hedef aramalar: bacak egzersizi oyunları, kol egzersizi oyunları, karın
// egzersizi oyunları, kardiyo oyunları. Bölge başına bir sayfa değil, tek sayfa: uygulamanın her bölge için zaten indekslenen bir
// listesi var (/tr/workouts/<bölge>/) ve birbirine çok benzeyen sayfalar onlarla yarışırdı. Bu sayfa daha derine iner: hangi oyunlar,
// her birinde kameranın ne okuduğu, bir turun uzunluğu ve kameralı bir oyunun neyi çalıştıramayacağı. Bir oyunun bölgeleri
// manifestinkidir (anlık görüntü); bölge adları uygulamanındır (seo-shared.ts).
import { articleLd, cta, faqLd, link, qa, readMinutes, table, ul, type PageSpec, type Section } from '../chrome.ts';
import * as F from '../facts.ts';
import type { BodyRegion } from '../../../core/types/index.ts';
import { gameCounts, listWords, roundLength } from './games.ts';
import { AREA_ORDER, GLANCE_ORDER } from './seo-areas.en.ts';
import { SEO_DATES, SEO_NAME, SEO_URL, appWord, gameLink, games, inline, moreSection, otherOf, planFacts, planWord, regionHref, regionName, seoFile, seoLink } from './seo-shared.ts';

export function seoAreasTr(): PageSpec {
  const lang = 'tr';
  const c = gameCounts();
  const all = games(lang);
  const inArea = (r: BodyRegion): typeof all => all.filter((g) => g.regions.includes(r));
  const legs = planFacts('legs-day', lang);
  const desk = planFacts('desk-break', lang);
  const strongest = [...all].sort((a, b) => b.met - a.met)[0];
  const noQuiet = all.filter((g) => !g.quiet);

  const intro: Readonly<Record<string, string>> = {
    legs: 'Çömelmeler, diz kaldırmalar, sıçramalar ve bacakları kullanan şekiller. Tek yük kendi vücut ağırlığın; bunları bir güç antrenmanı olarak değil, biraz kardiyo içeren bir bacak çalışması olarak düşün.',
    arms: 'Uzanma, dokunma, yumruk atma ve çekme. Yalnızca üst vücudunun görünmesini isteyen oyunlar masada da oynanır.',
    core: 'Belden dönüşler ve yana eğilmeler ile boks tarzı yumruklar. Kamera omuzlarının ne kadar döndüğünü ya da yattığını okur. Bir kasın ne kadar çalıştığını ölçmez.',
    cardio: `Seni hareket ettiren oyunlar: jumping jack, olduğun yerde koşu, hızlı dokunuşlar ve kaçınmalar. Uygulama ${strongest?.title} oyununu en yoğun oyunu olarak değerlendirir.`,
    mobility: `Yavaş, kontrollü eğilmeler ve tutulan şekiller. Uygulama bunları “${regionName('mobility', lang)}” altında listeler. Dengeni geliştirdiklerini iddia etmiyoruz ve kamera dengeni sınamaz.`,
  };

  const lineOf = (g: (typeof all)[number]): string => {
    const reads = g.measures.map((m) => inline(m, lang)).join('; ');
    return `<strong>${gameLink(g, lang)}</strong> (${planWord(g, lang)}, ${roundLength(g.seconds, lang)}). Kamera şunları okur: ${reads}.${g.framing === 'upper' ? ' Yalnızca üst vücudunun görünmesi yeter.' : ''}`;
  };

  const chestBack = all.filter((g) => g.regions.includes('chest-back'));
  /** Bir oyun ilk göründüğü bölümde anlatılır; diğerlerinde adı geçer ve oraya gönderilir. */
  const home = new Map<string, BodyRegion>();
  const areaSections: Section[] = AREA_ORDER.map((r) => {
    const list = inArea(r);
    const lines = list.map((g) => {
      const at = home.get(g.id);
      if (at === undefined) { home.set(g.id, r); return lineOf(g); }
      return `<strong>${gameLink(g, lang)}</strong> (${planWord(g, lang)}, ${roundLength(g.seconds, lang)}), <a href="#${at}">${regionName(at, lang)}</a> bölümünde anlatılıyor.`;
    });
    const extra = r === 'arms' && chestBack.length > 0
      ? `<p>Uygulamada ayrıca bir ${link(regionHref('chest-back', lang), regionName('chest-back', lang))} listesi var. İçinde ${chestBack.map((g) => gameLink(g, lang)).join(' ve ')} adlı tek bir oyun var ve o burada da listelenir: bir elini yukarı uzatır, omzuna kadar aşağı çekersin, sonra elini değiştirirsin.</p>`
      : '';
    return {
      id: r,
      title: regionName(r, lang),
      html: `<p>${intro[r] ?? ''}</p>\n${ul(lines)}\n${extra}<p>${link(regionHref(r, lang), `Uygulamada ${regionName(r, lang)} listesini aç`)}; oturarak ve sessiz oynama filtreleri de orada.</p>`,
    };
  });

  const glance: Section = {
    id: 'ozet',
    title: 'Bölgelere bir bakışta',
    html: `<p>Her oyun bir ile üç bölge altında listelenir; her oyun sandalyeden oynanabildiği için ${c.total} oyunun hepsi Oturarak listesinde yer alır. ${c.total} oyunun ${c.quiet} tanesinde zıplama ve yere vurma olmayan bir sessiz mod var${noQuiet.length === 1 ? `; olmayan tek oyun ${noQuiet[0]?.title}` : ''}.</p>
${table(null, ['Bölge', 'Oyun', 'Hangileri'], GLANCE_ORDER.map((r) => {
  const list = r === 'seated' ? all : inArea(r);
  return [link(regionHref(r, lang), regionName(r, lang)), String(list.length), listWords(list.map((g) => g.title), lang)];
}))}`,
  };

  const faq = [
    {
      q: 'Uygulamada oyunları vücut bölgesine göre seçebilir miyim?',
      a: `<p>Evet. Ana sayfada “${appWord(lang, 'home.filters')}” filtresi var ve her bölgenin kendi adresinde bir listesi var; örneğin <a href="${regionHref('legs', lang)}">${regionName('legs', lang)}</a>. Filtrede oturarak ve sessiz oynama için de seçenekler bulunur.</p>`,
    },
    {
      q: 'Tek bir bölge için hazır bir seans var mı?',
      a: `<p>Oyunları aralarında dinlenmeyle art arda getiren antrenman planları var. ${legs.title} planı ${listWords(legs.steps, lang)} oyunlarını çalıştırır, yaklaşık ${legs.minutes} dakika sürer. ${desk.title} omuzlar, sırt ve bel için: ${listWords(desk.steps, lang)} oyunları, oturarak, yaklaşık ${desk.minutes} dakika; ücretsiz plan o. Diğer planlar Pro içinde.</p>`,
    },
    {
      q: 'Oyunlar ağırlık ya da direnç ekliyor mu?',
      a: '<p>Hayır. Bir kamera seni bir şeye karşı itmeye zorlayamaz; bu yüzden buradaki her oyun kendi vücut ağırlığını kullanır ya da hiçbir yük kullanmaz. Güç programı istiyorsan ağırlık kullan; BodyArcade ısınma ya da mola olarak işe yarar.</p>',
    },
    {
      q: 'Bunları oturarak oynayabilir miyim?',
      a: `<p>Evet. ${c.total} oyunun hepsinin oturarak sürümü var. ${seoLink(lang, 'seated', 'Oturarak egzersiz oyunları sayfası')} her birinin sandalyeden nasıl oynandığını anlatır.</p>`,
    },
  ];

  const sections: Section[] = [glance, ...areaSections, { id: 'sss', title: 'Sık sorulanlar', html: faq.map((i) => qa(i.q, i.a)).join('\n') }, moreSection(lang, 'areas')];

  const title = 'Bölgeye göre spor oyunları: bacak, kol, karın ve kardiyo';
  const description = 'Hangi BodyArcade oyunları bacağını, kolunu, göğüs ve sırtını, karnını ya da kardiyonu çalıştırır, her birinde kameranın ne okuduğu ve hangileri oturarak oynanır.';
  const lead = 'Her BodyArcade oyunu bir ile üç vücut bölgesi altında listelenir ve uygulama bunlara göre süzmene izin verir. Bu sayfa bölgeleri sırayla gezer: her birindeki oyunlar, bir turun uzunluğu ve kameranın ne okuduğu. Bunlar vücut ağırlığıyla oynanan oyunlardır; hiçbiri direnç eklemez.';
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
    when: `Güncelleme: ${F.longDate(SEO_DATES.modified, lang)} &middot; ${minutes} dk okuma`,
    lead,
    sections,
    toc: true,
    after: cta('Bir bölge seç, ilk oyununu aç ve bir tur oyna.', '/tr/', 'Bir oyun oyna'),
    crumbs: [{ name: 'BodyArcade', url: '/tr/' }, { name: SEO_NAME[lang].areas.name, url: SEO_URL[lang].areas }],
    jsonLd: [
      articleLd({ headline: title, description, url: SEO_URL[lang].areas, published: SEO_DATES.published, modified: SEO_DATES.modified, lang }),
      faqLd(faq),
    ],
  };
}
