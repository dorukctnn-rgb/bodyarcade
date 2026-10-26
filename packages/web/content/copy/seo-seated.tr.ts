// Arama sayfası: yaşlılar için oturarak egzersiz oyunları, kamerayla (Türkçe). Hedef aramalar: oturarak egzersiz, yaşlılar için
// egzersiz. Oturarak bir turun nasıl kurulduğunu, her oyunun sandalyeden nasıl oynandığını (oyunların kendi oturarak notları),
// uygulamadaki Rahat 60+ planının ne olduğunu ve nelere dikkat edilmesi gerektiğini anlatır. Hiçbir sağlık etkisi vaat etmez:
// uygulama sağlığı ölçmez ve sayfa bunu söyler. Sayı ve adlar anlık görüntüden, planlardan ve uygulamanın kendi sözcüklerinden gelir.
import { articleLd, cta, faqLd, link, ol, qa, readMinutes, table, ul, type PageSpec, type Section } from '../chrome.ts';
import * as F from '../facts.ts';
import { WORKOUT_PLANS } from '../../../core/store/workout-plans.ts';
import { gameCounts, listWords, roundLength } from './games.ts';
import { SEO_DATES, SEO_NAME, SEO_URL, appWord, gameLink, games, moreSection, otherOf, planFacts, planWord, plansHref, proHref, seoFile, seoLink } from './seo-shared.ts';

export function seoSeatedTr(): PageSpec {
  const lang = 'tr';
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
      id: 'kimler',
      title: 'Bu oyunlar kimlere uygun',
      html: '<p>Oyunlar kısa, elde tutulacak kumanda yok ve her biri oturarak oynanabiliyor. Bu yüzden evde hafif hareket isteyen yaşlılara, günün çoğunu oturarak geçirenlere ve ayakta durup zıplayamayan ya da zıplamak istemeyen herkese uygun. Bunlar oyundur, tıbbi bir program değil: başlamadan önce son bölümü oku.</p>',
    },
    {
      id: 'hazirlik',
      title: 'Oturarak bir tur nasıl kurulur',
      html: ol([
        '<strong>Bir sandalye seç.</strong> Sağlam, tekerleksiz bir sandalye olsun; kolların rahatça sallanabilmesi için çevrende boşluk bırak.',
        '<strong>Ekranı yerleştir.</strong> Dizüstünü bir masaya koy ya da tableti sağlam bir şeye dayayıp yaklaşık göz hizasına getir. Kamera başını, omuzlarını ve kollarını görmeli; mümkünse kalçanı da. Yaklaşık 1 metre uzaklık işe yarar. Fazla yakın oturursan uygulama biraz geri oturmanı ister: baş, omuz ve kolların görünsün. Birkaç oyun, hazırlık denetiminde iki elini bir kez kaldırmanı ister; elin görüntüde kalsın diye başının üstünde biraz boşluk bırak.',
        `<strong>${word('settings.seated')}nu aç.</strong> ${word('nav.settings')} içinden aç; oturarak sürümü olan her oyun onu kullanır. Kapalı da bırakabilirsin: uygulama yalnızca başını ve omuzlarını görürse masada oynamayı önerir ve hazırlık denetiminde “${word('calib.seatedInstead')}” düğmesi vardır.`,
        '<strong>Işığa dikkat et.</strong> Işığı önüne ya da yanına al, arkana değil. Arkandaki bir pencere seni siluete çevirir ve kamera kollarını izleyemez.',
        '<strong>Kolay seviyeyle başla.</strong> Kolay ve Normal seviyeler ücretsiz. Zor ve Uzman Pro içinde.',
      ]),
    },
    {
      id: 'oyunlar',
      title: 'Her oyun sandalyeden',
      html: `<p>Uygulama her oyunun oturarak sürümünü böyle anlatır. Bir tur ${roundLength(c.shortest, lang)} ile ${roundLength(c.longest, lang)} arasında sürer.</p>
${table(null, ['Oyun', 'Oturarak nasıl oynanır', 'Tur', 'Ücretsiz mi, Pro mu'], all.map((g) => [
  gameLink(g, lang),
  g.seatedNote ?? '',
  roundLength(g.seconds, lang),
  planWord(g, lang),
]))}`,
    },
    {
      id: 'yumusak',
      title: 'Daha yumuşak oyunlar ve daha hareketli olanlar',
      html: `<p>${c.total} oyunun ${lowCount} tanesi uygulamada düşük etkili olarak işaretli. Düşük etkili olmayan ${lively.length === 2 ? 'iki' : String(lively.length)} oyun var: ${listWords(lively.map((g) => g.title), lang)}. Oturarak oynarken Firework Jacks’te zıplamak yerine kollarını açıp kapatırsın, Road Run’da yalnızca yana yaslanıp eğilirsin; yine de buradaki en hareketli oyunlar onlar, bu yüzden yumuşak başlamak istiyorsan diğerleriyle başla. ${c.total} oyunun ${c.quiet} tanesinde ayrıca zıplama ve yere vurma olmayan bir sessiz mod var.</p>`,
    },
    {
      id: 'plan',
      title: 'Rahat 60+ planı',
      html: `<p>Uygulamada 60 yaş ve üzeri için hazır bir plan var. ${listWords(easy.steps, lang)} oyunlarını, hepsi Kolay seviyede, oyunlar arasında ${rest} saniye dinlenmeyle art arda getirir; toplam yaklaşık ${easy.minutes} dakika sürer. Oturarak modunu kapatmadıysan oturarak başlar ve dengede hissettiğin anda ayağa kalkabilirsin.</p>
<p>Antrenman planları bir tanesi hariç Pro içindedir. Ücretsiz plan ${desk.title}: ${listWords(desk.steps, lang)} oyunları, oturarak, yaklaşık ${desk.minutes} dakika. İki plandaki oyunlar da ücretsiz oyunlardır; bu yüzden onları para ödemeden de oynayabilirsin. ${link(plansHref(lang), 'Planlar sayfası')} ${WORKOUT_PLANS.length} planın hepsini sıralar; ${link(proHref(lang), 'Pro sayfasında')} Pro’nun fiyatını görürsün.</p>`,
    },
    {
      id: 'dikkat',
      title: 'Güvenlik ve uygulamanın yapmadıkları',
      html: ul([
        '<strong>Sana uyuyorsa önce sor.</strong> Hamileysen, kalp ya da eklem rahatsızlığın varsa ya da hareket ederken ağrı duyuyorsan önce doktoruna danış. Bir doktor ya da fizyoterapist sana egzersizde dikkatli olmanı söylediyse de aynısını yap. Baş dönmesi ya da keskin bir ağrı hissedersen dur.',
        '<strong>Bu bir oyun, tedavi değil.</strong> BodyArcade tıbbi bir cihaz, rehabilitasyon programı ya da düşmeyi önleme programı değildir. Kalp atışını ölçmez ve tıbbi tavsiye vermez; ona bir sağlık iddiası yüklemiyoruz.',
        '<strong>Her şeyi sağlam tut.</strong> Sağlam bir sandalye kullan, suyu elinin altında tut ve evdeki birine oynadığını söyle.',
        '<strong>Dinlenme oyunun içinde.</strong> Çoğu oyun, arada dinlenme olan setlerle oynanır ve istediğin an durabilirsin.',
        '<strong>Kamera bir hareketi kaçırabilir.</strong> Bir hareket sayılmadığında sonuç ekranı nedenini söyler; örneğin bir el görüntü dışındaydı.',
      ]),
    },
  ];

  const faq = [
    {
      q: 'Her oyunun oturarak sürümü var mı?',
      a: `<p>Evet, ${c.total} oyunun hepsinde var. Her oyun sayfasında “${word('game.section.variants')}” adlı bir bölüm, oyunun sandalyeden nasıl oynandığını anlatır.</p>`,
    },
    {
      q: 'Hiçbir anda ayağa kalkmam gerekiyor mu?',
      a: '<p>Hayır. Her oyun baştan sona oturarak oynanabilir. Rahat 60+ planı oturarak başlar; ayakta durmak senin seçimin.</p>',
    },
    {
      q: 'Tablette ya da eski bir dizüstünde çalışır mı?',
      a: '<p>Kamerası ve güncel bir tarayıcısı (Chrome, Edge, Firefox ya da Safari) olan her cihazda. Uygulama cihazının kamera modu için fazla yavaş olduğunu söylerse klavye ya da dokunmatikle oynayabilirsin. Bu turlar antrenmandır ve kayıtlarında tutulmaz.</p>',
    },
    {
      q: 'Ne kadar tutuyor?',
      a: `<p>${c.total} oyunun ${c.free} tanesi ücretsiz; oturarak ve sessiz sürümleriyle, Kolay ve Normal seviyelerle, reklamsız. Pro diğer ${c.pro} oyunu, zor seviyeleri ve antrenman planlarının çoğunu ekler. <a href="${proHref(lang)}">Pro sayfasına</a> bak.</p>`,
    },
    {
      q: 'Kamera görüntüm kaydediliyor ya da yükleniyor mu?',
      a: `<p>Hayır. Cihazın görüntüyü anında ${F.MODEL_POINTS} vücut noktasına çevirir ve görüntü hiçbir zaman yüklenmez, kaydedilmez ya da saklanmaz. <a href="/tr/privacy">Gizlilik politikasını</a> oku.</p>`,
    },
    {
      q: 'Torunlarımla birlikte oynayabilir miyim?',
      a: `<p>Evet. ${c.total} oyunun ${c.local2} tanesinde iki kişi, bir dizüstü gibi büyük bir ekranda tek kamerayı paylaşır ve her biri kendi puanını alır. Çevrimiçi odalar ${F.AGE.online} yaş ve üzeri oyuncular içindir. Ayrıntılar için ${seoLink(lang, 'friends', 'arkadaşlarla oynama sayfasına')} bak.</p>`,
    },
  ];
  sections.push({ id: 'sss', title: 'Sık sorulanlar', html: faq.map((i) => qa(i.q, i.a)).join('\n') }, moreSection(lang, 'seated'));

  const title = 'Yaşlılar için oturarak egzersiz oyunları, kamerayla oynanır';
  const description = `${c.total} BodyArcade oyununun hepsinin oturarak sürümü var. Sandalyeden web kameranla oyna: kurulum, her oyunun senden istediği ve 60 yaş ve üzeri için rahat bir plan.`;
  const lead = `BodyArcade’in ${c.total} kamera oyununun hepsi sandalyeden oynanabilir. Bir dizüstü, tablet ya da telefonun karşısına oturursun; kamera başını, omuzlarını ve kollarını izler, oyun onların yaptığına karşılık verir. Oyunların ${c.free} tanesi ücretsiz, ${c.quiet} tanesinde de sessiz mod var. Bu sayfa oturarak bir turun nasıl kurulduğunu, her oyunun senden ne istediğini ve nelere dikkat etmen gerektiğini anlatır.`;
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
    when: `Güncelleme: ${F.longDate(SEO_DATES.modified, lang)} &middot; ${minutes} dk okuma`,
    lead,
    sections,
    toc: true,
    after: cta('Bir oyun aç, Ayarlar’dan Oturarak modunu aç ve ekrandan biraz geri otur. İlk tur birkaç dakika sürer.', '/tr/', 'Bir oyun oyna'),
    crumbs: [{ name: 'BodyArcade', url: '/tr/' }, { name: SEO_NAME[lang].seated.name, url: SEO_URL[lang].seated }],
    jsonLd: [
      articleLd({ headline: title, description, url: SEO_URL[lang].seated, published: SEO_DATES.published, modified: SEO_DATES.modified, lang }),
      faqLd(faq),
    ],
  };
}
