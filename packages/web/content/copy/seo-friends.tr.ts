// Arama sayfası: arkadaşlarla oynanan spor oyunları (Türkçe). Yapının yaptığını anlatır: canlı yarışı olan oyunlar için çevrimiçi
// odalar, tek kamerada iki kişi, hayalet koşular ve haftalık sıralamalar, bir de yaş kuralları. Her şey facts.ts'ten, katalog
// anlık görüntüsünden ve uygulamanın kendi sözcüklerinden gelir (seo-shared.ts); SSS sayfası aynı şeyleri kısaca söyler ve
// content.test.ts ikisini karşılaştırır.
import { articleLd, cta, faqLd, ol, qa, readMinutes, ul, type PageSpec, type Section } from '../chrome.ts';
import * as F from '../facts.ts';
import { gameCounts, listWords, titlesOf } from './games.ts';
import { SEO_DATES, SEO_NAME, SEO_URL, appWord, gameLink, games, moreSection, otherOf, seoFile } from './seo-shared.ts';

export function seoFriendsTr(): PageSpec {
  const lang = 'tr';
  const c = gameCounts();
  const live = titlesOf((g) => g.live, lang);
  const all = games(lang);
  const liveLinks = listWords(all.filter((g) => g.live).map((g) => gameLink(g, lang)), lang);
  const shareLinks = listWords(all.filter((g) => g.local2).map((g) => gameLink(g, lang)), lang);
  const word = (key: string): string => appWord(lang, key);

  const sections: Section[] = [
    {
      id: 'oda',
      title: 'Çevrimiçi bir odada canlı yarış',
      html: `${ol([
        `<strong>Bir profil oluştur.</strong> ${word('nav.friends')} sayfasını aç ve “${word('social.intro.cta')}” düğmesine bas. Uygulama yaş grubunu bir kez sorar ve sana BA-7K2Q4X gibi görünen bir arkadaş kodu verir. E-posta adresi ve şifre gerekmez.`,
        '<strong>Arkadaşını ekle.</strong> Arkadaş kodunu ya da davet bağlantını gönder. Arkadaşın kabul edince arkadaş olursunuz.',
        `<strong>Bir oda kur.</strong> Oyunu ev sahibi seçer. Canlı yarışı olan oyunlar ${liveLinks}.`,
        `<strong>İnsanları davet et.</strong> Davet bağlantısını, ${F.ROOM_CODE_CHARS} karakterli oda kodunu ya da QR kodu gönder. Bir odada ${F.SEATS.min} ile ${F.SEATS.max} oyuncu bulunur.`,
        '<strong>Hazır ol.</strong> Önce her kamera hazırlanır. Herkes hazır olunca tur hepinizde aynı anda başlar.',
      ])}
<p>Yarış sırasında cihazın diğerlerine skorunu ve ${F.SHARED_JOINTS} eklemli bir iskeleti, saniyede yaklaşık ${F.SHARE_HZ} kez bildirir. Bu bir çöp adam çizimidir, görüntü değil. Paylaşmayı kendin seçmedikçe kamera görüntün cihazında kalır.</p>`,
    },
    {
      id: 'ekran',
      title: 'Tek ekranda iki kişi',
      html: `<p>${c.total} oyunun ${c.local2} tanesinde iki kişi tek kamerayı paylaşır: ${shareLinks}. Dizüstü, masaüstü ya da TV gibi büyük bir ekran gerekir; telefon boyutundaki ekranlarda sunulmaz. 1. oyuncu solda, 2. oyuncu sağda durur; aranızda yaklaşık 1 metre, ekrana uzaklığınız yaklaşık 3 metre olsun. Her biriniz kendi puanını alırsınız.</p>`,
    },
    {
      id: 'hayalet',
      title: 'Kayda karşı yarışlar ve haftalık sıralamalar',
      html: `<p>Çevrimiçi başka kimse yokken de her an bir hayaletle yarışabilirsin: kendi en iyi koşun, bir arkadaşının koşusu ya da bir bot olan bir antrenman arkadaşı. Uygulama hangisi olduğunu her zaman söyler ve canlı olmayan kimse canlı gibi gösterilmez. Özel bir odada oynanan bir turdan sonra arkadaşların koşunu, sonradan karşı yarışmak üzere bir kayıt olarak saklayabilir. Kayıt her engelde ne yaptığını taşır, görüntü taşımaz.</p>
<p>Bir profilin olunca her oyunun her haftaki en iyi skoru, arkadaşlarının sıralamasına ve ülkendeki, yaş grubundaki oyuncuların sıralamasına gider. Yeni hafta her Pazartesi başlar. Sıralamalar yalnızca gerçek oyuncuları listeler ve ödül içermez.</p>`,
    },
    {
      id: 'yas',
      title: 'Çevrimiçi kimler oynayabilir',
      html: ul([
        `<strong>${F.AGE.online} yaşından küçükler:</strong> çevrimiçi profil yok. Oyunlar yalnızca cihazda çalışır ve uygulama çocuk hakkında arkadaş hizmetine hiçbir şey göndermez. Daha küçük oyuncular oyunları yine kendi cihazlarında, tek kamerada iki kişi dahil, oynayabilir.`,
        `<strong>${F.AGE.online} ile 17 arası:</strong> üretilmiş adlar, hazır mesajlar, yalnızca kodla ya da bağlantıyla eklenen arkadaşlar; hiçbir zaman görüntü ya da yazılan metin yok.`,
        `<strong>${F.AGE.video} yaş ve üzeri:</strong> herkesin ${F.AGE.video} yaşında ya da daha büyük olduğu özel bir odada yazılı sohbet ve orada arkadaşlar arasında isteğe bağlı görüntü.`,
        `<strong>Gruplar arasında:</strong> bir yetişkin ${F.AGE.video} yaşından küçük bir oyuncuya arkadaşlık isteği gönderemez.`,
      ]),
    },
    {
      id: 'gorme',
      title: 'Kim neyi görür',
      html: `<p>Arkadaşların görünen adını ve çevrimiçi olup olmadığını görür. Seni arama yoluyla kimse bulamaz: insanlar seni yalnızca arkadaş kodunla ya da davet bağlantınla veya yaş grubunun herkese açık lobisinde bulur. Herkese açık bir lobide seviyendeki ve yaş grubundaki oyuncularla karşılaşırsın. Onlar rengindeki bir iskeleti ve görünen adını görür; sana hazır mesajlar ve çizilmiş tepkiler gönderebilir, hiçbir zaman görüntü ya da yazılan metin gönderemez.</p>
<p>Arkadaşlar arasında görüntü isteğe bağlıdır ve varsayılan olarak kapalıdır. Yalnızca herkesin ${F.AGE.video} yaşında ya da daha büyük olduğu özel bir odada, iki arkadaş da açtığında çalışır. İkinizden biri bunu istediği an kapatabilir. Görüntü cihazdan cihaza, şifreli gider; kimse onu kaydetmez. Cihazlarınız birbirine doğrudan ulaşamazsa görüntü gösterilmez ve oyun iskeletinle devam eder.</p>
<p>Birini bildirmek ya da engellemek için bir odada ya da arkadaş listende oyuncunun menüsünü aç. Her bildirim bizim okuduğumuz bir kuyruğa girer; ciddi olanlar öne alınır.</p>`,
    },
    {
      id: 'beklenti',
      title: 'Ne beklemeli',
      html: ul([
        `Canlı yarışlar ${c.live} oyunda var, ${liveLinks}, ikisi de ücretsiz.`,
        'Bağlantı gerekir. Arkadaşlar, odalar ve sıralamalar çevrimdışı çalışmaz.',
        `Bir oda son oyuncu ayrıldıktan ${F.ROOM_EMPTY_MINUTES} dakika sonra kapanır; son hareketinden en geç ${F.ROOM_IDLE_HOURS} saat sonra da kapanır.`,
        'Her oyuncu kendi kamerasını ve kendi alanını kullanır. Tek kamera ara sıra bir hareketi kaçırır ve sonuç ekranı bir hareketin neden sayılmadığını söyler.',
      ]),
    },
  ];

  const faq = [
    {
      q: 'Arkadaşlarımın benimle oynamak için Pro’ya ihtiyacı var mı?',
      a: `<p>Hayır. Canlı yarışı olan iki oyun, ${live}, ücretsiz oyunlardır.</p>`,
    },
    {
      q: 'Bir odada kaç kişi olabilir?',
      a: `<p>${F.SEATS.min} ile ${F.SEATS.max} oyuncu. Oyunu ev sahibi seçer, herkes hazır olur ve tur hepinizde aynı anda başlar.</p>`,
    },
    {
      q: 'Kodunu bilmiyorsam bir arkadaşımı nasıl bulurum?',
      a: '<p>Oyuncuları adla arayamazsın. Arkadaş kodunu ya da davet bağlantısını iste ya da sana bir oda bağlantısı ya da oda kodu göndermesini söyle. Herkese açık bir lobide yaş grubundan, seviyendeki oyuncularla karşılaşırsın; onlar iskelet olarak görünür.</p>',
    },
    {
      q: 'Çocuğum arkadaşlarıyla çevrimiçi oynayabilir mi?',
      a: `<p>${F.AGE.online} yaşından küçükler için olmaz: daha küçük oyuncular için çevrimiçi profil yoktur. ${F.AGE.online} ile 17 arasında profil üretilmiş adlar ve hazır mesajlar kullanır. Daha küçük oyuncular oyunları yine kendi cihazlarında, tek kamerada iki kişi dahil, oynayabilir.</p>`,
    },
    {
      q: 'Arkadaşlarım beni görebilir mi?',
      a: `<p>Yalnızca iskelet olarak; ikiniz de ${F.AGE.video} yaşında ya da daha büyükseniz, özel bir odadaysanız ve ikiniz de görüntüyü açarsanız görüntü de görünür. Varsayılan olarak kapalıdır ve ikinizden biri istediği an kapatabilir.</p>`,
    },
  ];
  sections.push({ id: 'sss', title: 'Sık sorulanlar', html: faq.map((i) => qa(i.q, i.a)).join('\n') }, moreSection(lang, 'friends'));

  const title = 'Arkadaşlarla spor oyunları: çevrimiçi oda ve tek ekran';
  const description = `${live} oyunlarında arkadaşınla canlı yarış, tek ekranda tek kamerayı paylaş ya da bir arkadaşının kaydına karşı yarış. Odalar, kodlar, yaşlar.`;
  const lead = `BodyArcade’i başkalarıyla üç şekilde oynayabilirsin. Çevrimiçi, en çok ${F.SEATS.max} oyunculu bir odaya katılır ve ${live} oyunlarında canlı yarışırsın. Tek ekranda, ${c.total} oyunun ${c.local2} tanesinde iki kişi tek kamerayı paylaşır. Tek başına bir arkadaşının koşusunun kaydına karşı yarışabilirsin. Kimsenin e-posta adresine ya da şifreye ihtiyacı yok.`;
  const minutes = readMinutes(lead + sections.map((s) => s.html).join(' '));
  return {
    file: seoFile(lang, 'friends'),
    url: SEO_URL[lang].friends,
    lang,
    other: otherOf(lang, 'friends'),
    og: 'article',
    title,
    description,
    h1: title,
    when: `Güncelleme: ${F.longDate(SEO_DATES.modified, lang)} &middot; ${minutes} dk okuma`,
    lead,
    sections,
    toc: true,
    after: cta('Arkadaşlar sayfasını aç, bir profil oluştur ve arkadaş kodunu kamerası olan birine gönder.', '/tr/', 'Bir oyun oyna'),
    crumbs: [{ name: 'BodyArcade', url: '/tr/' }, { name: SEO_NAME[lang].friends.name, url: SEO_URL[lang].friends }],
    jsonLd: [
      articleLd({ headline: title, description, url: SEO_URL[lang].friends, published: SEO_DATES.published, modified: SEO_DATES.modified, lang }),
      faqLd(faq),
    ],
  };
}
