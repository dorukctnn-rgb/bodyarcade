// Fiyatlar (Türkçe): pricing.en.ts ile aynı sayfa, aynı sayılarla (facts.ts, katalog, antrenman planları). Android uygulamasında
// (twa.js) web fiyatları ve web mağazası gizlenir; sayfa orada fiyatı Google Play'in belirlediğini söyler.
import { WORKOUT_PLANS, FREE_PLAN_ID } from '../../../core/store/workout-plans.ts';
import { localized } from '../../../core/ui/i18n/localized.ts';
import { cta, faqLd, link, mail, qa, table, ul, type PageSpec, type Section } from '../chrome.ts';
import * as F from '../facts.ts';
import { gameCounts, listWords, titlesOf } from './games.ts';
import { PAGES_CHANGELOG, PRICING_DATES, PRICING_URL, perMonthOf, pricingLd, yearlySaves } from './pricing.en.ts';

export function pricingTr(): PageSpec {
  const lang = 'tr';
  const c = gameCounts();
  const W = F.ROAD_RUN_WORLDS;
  const $ = (n: number): string => F.usd(n, lang);
  const proPlans = WORKOUT_PLANS.filter((p) => p.id !== FREE_PLAN_ID).map((p) => localized(p.title, lang));
  const freePlan = WORKOUT_PLANS.find((p) => p.id === FREE_PLAN_ID);
  const memberships = F.FAMILY_PLAN ? 'Pro aylık, Pro yıllık ve Aile yıllık' : 'Pro aylık ve Pro yıllık';
  const asOf = F.longDate(PRICING_DATES.modified, lang);

  const plans = table(null, ['Plan', 'Fiyat', 'Ücretsiz deneme', 'Cihaz ve profil'], [
    ['Pro aylık', `<span class="nw">ayda ${$(F.PRICE.proMonthly)}</span>`, 'Yok', `En çok ${F.DEVICES.pro} cihaz`],
    ['Pro yıllık', `<span class="nw">yılda ${$(F.PRICE.proYearly)}</span>, ayda yaklaşık ${$(perMonthOf(F.PRICE.proYearly))}, on iki ay Pro aylıktan %${yearlySaves(F.PRICE.proMonthly, F.PRICE.proYearly)} daha az`, `${F.TRIAL_DAYS} gün`, `En çok ${F.DEVICES.pro} cihaz`],
    ...(F.FAMILY_PLAN ? [['Aile yıllık', `<span class="nw">yılda ${$(F.PRICE.familyYearly)}</span>`, 'Yok', `En çok ${F.DEVICES.family} cihazın her birinde ${F.FAMILY_PROFILES} profil`]] : []),
    ['Ömür boyu', `<span class="nw">tek sefer ${$(F.PRICE.lifetime)}</span>, yenileme yok`, 'Yok', `En çok ${F.DEVICES.pro} cihaz`],
  ]);

  const sections: Section[] = [
    {
      id: 'ucretsiz',
      title: 'Neler ücretsiz',
      html: ul([
        `<strong>${c.total} oyunun ${c.free} tanesi:</strong> ${titlesOf((g) => g.free, lang)}. Road Run’ın ${W.total} dünyası vardır ve ${W.free} tanesi ücretsizdir.`,
        '<strong>Oturarak ve sessiz sürümleri</strong>, Kolay ve Normal zorluk seviyeleri.',
        `<strong>Arkadaşlarla canlı yarış</strong>: ${titlesOf((g) => g.live && g.free, lang)}${c.proLive > 0 ? `; odanın ev sahibinde Pro varsa ${titlesOf((g) => g.live && !g.free, lang)} da` : ''}. Çevrimiçi oynamak için ${F.AGE.online} yaşından itibaren çevrimiçi bir profil gerekir.`,
        `<strong>${freePlan ? localized(freePlan.title, lang) : 'Ücretsiz'} antrenman planı</strong> ve her Pro oyunda bir ücretsiz tur.`,
        '<strong>Reklam ve hesap yok.</strong> Kaydolmadan oynayabilirsin; çevrimiçi profil yalnızca arkadaşlarla oynamak içindir.',
      ]),
    },
    {
      id: 'pro',
      title: 'Pro ne ekler',
      html: ul([
        `Pro oyunlar: ${titlesOf((g) => !g.free, lang)}.`,
        `${proPlans.length} antrenman planı daha: ${listWords(proPlans, lang)}.`,
        'Zor ve Uzman zorluk seviyeleri.',
        `Road Run’ın diğer ${W.total - W.free} dünyası.`,
        `Daha sonra eklediğimiz oyunlar: ${memberships} üyeliklerinden biri etkin olduğu sürece ve Ömür boyu planda. Neyin ne zaman eklendiği ${link(PAGES_CHANGELOG.tr, 'sürüm notlarında')} yazar.`,
      ]),
    },
    {
      id: 'planlar',
      title: 'Planlar ve fiyatları',
      html: `<div data-web-pay><p>Web fiyatları, ABD doları olarak, ${asOf} itibarıyla. Planları web’de Gumroad satar.</p>
${plans}</div>
<p>Android uygulamasında fiyatı ve para birimini ülken için Google Play belirler ve ödemeyi Google Play üzerinden yaparsın.</p>`,
    },
    {
      id: 'deneme',
      title: 'Ücretsiz deneme, iptal ve iade',
      html: ul([
        `<strong>Deneme.</strong> Pro yıllık ${F.TRIAL_DAYS} gün ücretsiz başlar ve deneme sırasında hiçbir şey tahsil edilmez. Bitmeden iptal etmezsen ilk yıl tahsil edilir. Bitişten ${F.REMINDER_DAYS} gün önce uygulamada bir bildirimle hatırlatırız${F.REMINDER_MAIL ? '; web’de bir adres bırakırsan tek bir e-posta da göndeririz' : ''}.`,
        '<strong>İptal.</strong> <span data-web-pay>Web’de Gumroad kütüphaneni aç, BodyArcade’i seç ve Manage membership’i seç. </span>Android uygulamasında Google Play aboneliklerinden iptal et. Pro, ödediğin sürenin sonuna kadar açık kalır.',
        `<strong>İade.</strong> <span data-web-pay>Web’de alınan her plan, satın alındığı günden başlayarak ${F.REFUND_DAYS} gün içinde iade edilebilir. İadeyi Gumroad yapar; yardım için ${mail()} adresine yazabilirsin. </span>Google Play’de Google’ın kuralları geçerlidir.`,
      ]),
    },
    {
      id: 'onceki',
      title: 'Bu planlardan önce satın aldıysan',
      html: `<p>Senden hiçbir şey alınmaz. <span data-web-pay>Ayda ${$(F.PRICE.legacyMonthly)} ödüyorsan, o üyelik kesintisiz sürdüğü sürece ayda ${$(F.PRICE.legacyMonthly)} ödemeye devam edersin. Ömür boyu planını ${$(F.PRICE.founder)} karşılığında aldıysan Kurucu’sun. </span>Kurucular için BodyArcade sunulduğu sürece Pro, daha sonra eklenen her oyun, ${F.FAMILY_PROFILES} profil ve en çok ${F.DEVICES.founder} cihaz vardır.</p>`,
    },
  ];

  const faq = [
    {
      q: 'BodyArcade ücretsiz mi?',
      a: `<p>Evet, ${c.total} oyunun ${c.free} tanesi kalıcı olarak ücretsizdir; reklam ve hesap yoktur. Pro ücretli kısımdır: daha çok oyun, daha çok antrenman planı, en zor seviyeler ve sonradan eklenen oyunlar.</p>`,
    },
    {
      q: 'Hangi planı seçmeliyim?',
      a: `<p>Pro yıllık bir yılda en az tutan plandır ve ücretsiz denemesi olan tek plandır. Pro aylık bir iki aylık deneme için uygundur. ${F.FAMILY_PLAN ? 'Aile yıllık, aynı cihazlarda birkaç kişinin her biri kendi profili ve sonuçlarıyla oynadığı evler içindir. ' : ''}Ömür boyu, yenilemesi olmayan tek bir ödemedir.</p>`,
    },
    {
      q: 'Bir Pro oyunu ödemeden önce oynayabilir miyim?',
      a: '<p>Evet. Her Pro oyunu bir kez ücretsiz oynanabilir; karar vermeden önce kameranın seni o oyunda nasıl okuduğunu görürsün.</p>',
    },
    {
      q: 'Planları uygulamada nerede bulurum?',
      a: `<p>Uygulamanın ${link('/tr/pro/', 'Pro')} sayfasını aç. Orada bulunduğun yerde alınabilen planlar görünür: web’de yukarıdakiler, Android uygulamasında Google Play’inkiler.</p><p>Ödemelerle ilgili diğer soruları ${link('/tr/faq', 'SSS')} yanıtlar.</p>`,
    },
  ];
  sections.push({ id: 'sorular', title: 'Fiyatlarla ilgili sorular', html: faq.map((i) => qa(i.q, i.a)).join('\n') });

  const title = 'BodyArcade fiyatları: ücretsiz oyunlar ve Pro planları';
  const description = `${c.total} oyunun ${c.free} tanesi ücretsiz. Web’de Pro: ayda ${$(F.PRICE.proMonthly)}, ${F.TRIAL_DAYS} gün denemeli yılda ${$(F.PRICE.proYearly)} ya da tek sefer ${$(F.PRICE.lifetime)}. Her planda neler var.`;
  return {
    file: 'tr/fiyatlar.html',
    url: PRICING_URL.tr,
    lang,
    other: { lang: 'en', url: PRICING_URL.en },
    title,
    description,
    h1: 'Fiyatlar',
    when: `${asOf} itibarıyla fiyatlar`,
    lead: `BodyArcade’in ücretsiz bir çekirdeği ve tek bir ücretli yükseltmesi var: Pro. ${c.total} oyunun ${c.free} tanesi ücretsizdir ve öyle kalır. <span data-web-pay>Web’de Pro ayda ${$(F.PRICE.proMonthly)}, ${F.TRIAL_DAYS} gün ücretsiz denemeyle yılda ${$(F.PRICE.proYearly)}, ${F.FAMILY_PLAN ? `Aile planıyla yılda ${$(F.PRICE.familyYearly)} ` : ''}ya da tek sefer ${$(F.PRICE.lifetime)}.</span>`,
    sections,
    toc: true,
    after: cta('Ücretsiz bir oyunla başla. Sevdiğinden emin olana kadar Pro bekleyebilir.', '/tr/', 'Ücretsiz bir oyun oyna'),
    crumbs: [{ name: 'BodyArcade', url: '/tr/' }, { name: 'Fiyatlar', url: PRICING_URL.tr }],
    jsonLd: [pricingLd(lang, { free: 'Ücretsiz oyunlar', monthly: 'Pro aylık', yearly: 'Pro yıllık', family: 'Aile yıllık', lifetime: 'Ömür boyu' }), faqLd(faq)],
  };
}
