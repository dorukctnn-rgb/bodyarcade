// İade politikası, Türkçe. refund.en.ts ile aynı şeyleri söyler ve kullanım koşullarındaki (terms.tr.ts, Ödeme ve İadeler bölümleri)
// iade ve iptal sözlerini tek yerde toplar; kendi başına yeni bir söz vermez.
import { mail, type PageSpec } from '../chrome.ts';
import * as F from '../facts.ts';

export function refundTr(): PageSpec {
  const date = F.longDate(F.TERMS_UPDATED, 'tr');
  return {
    file: 'tr/refund.html',
    url: '/tr/refund',
    lang: 'tr',
    other: { lang: 'en', url: '/refund' },
    title: 'İade politikası',
    description: `BodyArcade Pro iadeleri: web’de ${F.REFUND_DAYS} gün, nasıl istenir, parayı nasıl geri alırsın ve bir üyelik ya da ücretsiz deneme nasıl iptal edilir.`,
    h1: 'İade politikası',
    when: `Son güncelleme: ${date}`,
    lead: `BodyArcade Pro için iade ve iptalin nasıl işlediği, tek sayfada. <a href="/tr/terms">Kullanım koşullarıyla</a> aynı şeyi söyler.`,
    crumbs: [{ name: 'BodyArcade', url: '/tr/' }, { name: 'İade politikası', url: '/tr/refund' }],
    sections: [
      {
        id: 'sure',
        title: 'Web’de iade süresi',
        html: `<p>Web’de her plan, satın alındığı günden başlayarak ${F.REFUND_DAYS} gün içinde iade edilebilir. Bu, kullanım koşullarındaki <a href="/tr/terms#iade">iadeler bölümüyle</a> aynı sözdür.</p>`,
      },
      {
        id: 'iste',
        title: 'İade nasıl istenir',
        html: `<p>Makbuzundaki bağlantıyı kullan ya da satın alırken kullandığın e-posta adresinden ${mail()} adresine yaz; satıcıdan iade etmesini isteriz.</p>`,
      },
      {
        id: 'odeme',
        title: 'Paran nasıl geri ödenir',
        html: `<p>Web’de siparişlerimizi çevrimiçi satıcılarımız Paddle.com ve Gumroad yürütür. Bütün siparişlerimizde kayıtlı satıcı (Merchant of Record) onlardır: ödemeyi, satış vergisini ya da KDV’yi ve iadeleri onlar halleder ve satın alman için kendi koşulları da geçerlidir.</p>
<p>İade, ödeme yaptığın satıcı üzerinden geri ödenir. İade süresi makbuzunda da yazar.</p>`,
      },
      {
        id: 'sonra',
        title: 'İadeden sonra',
        html: `<p>İade edilen bir satın alma, bir sonraki kontrolde cihazlarındaki Pro’yu bitirir; uygulama bu kontrolü sen kullandıkça yaklaşık günde bir kez yapar.</p>`,
      },
      {
        id: 'iptal',
        title: 'Üyeliği iptal etmek',
        html: `<p>Pro aylık, Pro yıllık ve Aile yıllık sen iptal edene kadar yenilenir. İptal etmek gelecekteki ödemeleri durdurur ve Pro, zaten ödediğin sürenin sonuna kadar açık kalır. Bir sonraki ödemeyi önlemek için üyelik yenilenmeden önce iptal et.</p>
<p>Web’de ödeme yaptığın satıcıdan iptal et. Gumroad’da bu, Gumroad kütüphanendir (BodyArcade’i seç, sonra Manage membership); makbuz e-postasında da aynı bağlantı var. Android uygulamasında Google Play aboneliklerinden iptal et.</p>`,
      },
      {
        id: 'deneme',
        title: 'Ücretsiz deneme',
        html: `<p>Pro yıllık planının ücretsiz denemesi ${F.TRIAL_DAYS} gün sürer. Deneme sırasında hiçbir şey tahsil edilmez. Deneme bitmeden iptal etmezsen ilk yıl tahsil edilir ve plan her yıl yenilenir.</p>`,
      },
      {
        id: 'android',
        title: 'Android uygulaması',
        html: `<p>Android uygulamasında Pro’yu Google Play satar. Google Play’in iade kuralları geçerlidir ve kararı Google verir. Yardım gerekirse bize yaz.</p>`,
      },
      {
        id: 'hukuk',
        title: 'Yasadan doğan hakların',
        html: `<p>Bu sayfadaki hiçbir şey, ülkenin hukukunun sana tüketici olarak verdiği iade ya da cayma hakkını ortadan kaldırmaz.</p>`,
      },
      {
        id: 'iletisim',
        title: 'İletişim',
        html: `<p>İadelerle ilgili sorular: ${mail()}. BodyArcade, ${F.STUDIO} tarafından yapılır. Verilerinin nasıl işlendiği <a href="/tr/privacy">gizlilik politikasında</a>, sık sorulan sorular <a href="/tr/faq">SSS</a> sayfasında.</p>`,
      },
    ],
  };
}
