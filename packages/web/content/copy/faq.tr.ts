// Sık sorulan sorular, Türkçe. faq.en.ts ile aynı soruları ve aynı olguları yanıtlar (sayılar facts.ts'ten, oyunlar katalogdan).
// Aynı sorular ve yanıtlar FAQPage yapılandırılmış verisini de besler.
import { cta, faqLd, mail, qa, type PageSpec, type Section } from '../chrome.ts';
import * as F from '../facts.ts';
import { gameCounts, titlesOf } from './games.ts';

interface Item { q: string; a: string }
interface Group { id: string; title: string; items: Item[] }

export function faqTr(): PageSpec {
  const c = gameCounts();
  const proTitles = titlesOf((g) => !g.free, 'tr');
  const liveTitles = titlesOf((g) => g.live, 'tr');
  const $ = (n: number): string => F.usd(n, 'tr');
  const app = F.ANDROID_APP_LIVE
    ? '<p>Google Play’de bir Android uygulaması var. Aynı oyunları oynatır ve ödemeleri Google Play üzerinden alır. iPhone’da BodyArcade’ı Safari’de kullan.</p>'
    : '<p>BodyArcade her cihazın tarayıcısında çalışır, bu yüzden kurulacak bir şey yoktur. Google Play’deki Android uygulaması web sürümünün ardından gelir. Ücretli planların her iki yerde de geçerli olması amaçlanır.</p>';

  const groups: Group[] = [
    {
      id: 'baslangic',
      title: 'Başlarken',
      items: [
        {
          q: 'Oynamak için neye ihtiyacım var?',
          a: '<p>Kamerası olan bir telefon, tablet, dizüstü ya da masaüstü bilgisayar ve güncel bir tarayıcı (Chrome, Edge, Firefox ya da Safari). Kurulacak bir şey yok. İlk seferde oyun poz modelini, yaklaşık 6 MB, indirir ve cihazında saklar. Kameran yoksa izin veren oyunlar klavye ya da dokunmatikle oynanabilir.</p>',
        },
        {
          q: 'Nereye durmalıyım?',
          a: '<p>Oyuna bağlı. Tüm vücut oyunlarında başından ayak bileklerine kadar görünmelisin: dizüstünden 2 ile 3 metre, dik duran bir telefondan 1,5 ile 2 metre uzakta dur. Üst vücut oyunlarında başından kalçana kadar görünmelisin, yaklaşık 1 metre uzakta. Her oyundan önceki kalibrasyon adımı geri mi çekileceğini yoksa yaklaşılacağını söyler. Işığın önünde ya da yanında durman en iyisidir; arkandaki bir pencere seni kameradan saklar.</p>',
        },
        {
          q: 'Oturarak oynayabilir miyim?',
          a: `<p>Evet. Her oyunun oturarak sürümü var. Ayarlar’dan Oturarak modunu aç ya da uygulama yalnızca başını ve omuzlarını gördüğünde masa modunu sunsun. ${c.total} oyunun ${c.quiet} tanesinde ayrıca zıplama ve yere vurma olmayan bir sessiz mod var; alt kattaki komşulara saygılıdır.</p>`,
        },
        {
          q: 'Telefonda çalışır mı?',
          a: '<p>Evet, telefonunun tarayıcısında, dik ya da yatay. Tek kamerada iki oyuncu daha büyük bir ekran ister ve telefon boyutundaki ekranlarda sunulmaz.</p>',
        },
        {
          q: 'Bir uygulama var mı?',
          a: app,
        },
        {
          q: 'Çevrimdışı çalışır mı?',
          a: '<p>Daha önce açtığın oyunlar bağlantı olmadan da çalışır: kamera ve poz modeli cihazında çalışır. Arkadaşlar, odalar, sıralamalar ve lisans kontrolleri bağlantı ister.</p>',
        },
      ],
    },
    {
      id: 'gizlilik',
      title: 'Kamera ve gizlilik',
      items: [
        {
          q: 'Kamera görüntüm yükleniyor ya da kaydediliyor mu?',
          a: `<p>Hayır. Cihazın görüntüyü anında ${F.MODEL_POINTS} vücut noktasına çevirir; görüntü hiçbir zaman yüklenmez, kaydedilmez ya da saklanmaz. Tek istisna isteğe bağlıdır: ikisi de ${F.AGE.video} yaşında ya da daha büyük iki arkadaş, özel bir odada ikisi de açarsa birbirine kameralarını gösterebilir. O zaman da hiçbir şey kaydedilmez. Ayrıntılar için <a href="/tr/privacy">gizlilik politikasını</a> oku.</p>`,
        },
        {
          q: 'Hesap gerekir mi?',
          a: '<p>Oynamak için hesap, parola ya da e-posta adresi gerekmez. Çevrimiçi profil yalnızca arkadaşlar, başkalarıyla odalar, herkese açık lobiler ve haftalık sıralamalar için gerekir; onun da parolası ve e-posta adresi yoktur.</p>',
        },
        {
          q: 'BodyArcade benim hakkımda ne saklar?',
          a: '<p>Ayarların ve sonuçların cihazında kalır. Sunucularımız çevrimiçi bir profili yalnızca sen yaparsan, odaları yalnızca var oldukları sürece, Pro için lisans kayıtlarını tutar; her biri için <a href="/tr/privacy">gizlilik politikasında</a> yazan süre kadar. Reklam yok, reklam izleyicisi yok.</p>',
        },
        {
          q: 'Verilerimi nasıl silerim?',
          a: `<p>Cihazında: Ayarlar, sonra Bu cihazdaki verileri sil. Çevrimiçi profil için profil ekranında Verilerimi indir ve Profilimi sil düğmeleri var. Başka her şey için ${mail()} adresine yaz.</p>`,
        },
        {
          q: 'Çocuklar için güvenli mi?',
          a: `<p>Aileler oynayabilir. ${F.AGE.online} yaşından küçüklerde oyunlar yalnızca cihazda çalışır: çevrimiçi profil yoktur ve sunucularımıza hiçbir şey gönderilmez. ${F.AGE.online} ile 17 yaş arasında adlar üretilir, mesajlar hazırdır, arkadaşlar yalnızca kod ya da bağlantıyla eklenir, herkese açık lobiler aynı yaş grubundaki oyuncularla olur ve hiçbir zaman görüntü ya da yazılı metin yoktur. Bir yetişkin, ${F.AGE.video} yaşından küçük bir oyuncuya arkadaşlık isteği gönderemez. Her şey <a href="/tr/privacy">gizlilik politikasında</a> ve <a href="/tr/terms">koşullarda</a> var.</p>`,
        },
      ],
    },
    {
      id: 'birlikte',
      title: 'Birlikte oynamak',
      items: [
        {
          q: 'Bir arkadaşımla çevrimiçi nasıl oynarım?',
          a: `<p>Arkadaşlar sayfasını aç ve bir profil oluştur. Uygulama yaş grubunu bir kez sorar ve sana BA-7K2Q4X gibi görünen bir arkadaş kodu verir. Arkadaş kodunu ya da davet bağlantını gönder; arkadaşın kabul edince arkadaş olursunuz. Oynamak için bir oda kur, bir oyun seç ve davet bağlantısını, ${F.ROOM_CODE_CHARS} karakterli kodu ya da QR kodu gönder. Bir odada ${F.SEATS.min} ile ${F.SEATS.max} oyuncu bulunur. Herkes hazır olur ve tur hepinizde aynı anda başlar. Canlı yarışlar şu oyunlarda: ${liveTitles}.</p>`,
        },
        {
          q: 'İkimiz tek kamerada oynayabilir miyiz?',
          a: `<p>Evet, dizüstü, masaüstü ya da TV gibi büyük bir ekranda. ${c.total} oyunun ${c.local2} tanesi bunu destekler. 1. oyuncu solda, 2. oyuncu sağda durur; aranızda yaklaşık 1 metre, ekrana yaklaşık 3 metre olsun. İkinizin de kendi skoru olur.</p>`,
        },
        {
          q: 'Beni kimler görebilir ya da bana ulaşabilir?',
          a: '<p>Arkadaşların görünen adını ve çevrimiçi olup olmadığını görür. Herkese açık bir lobideki oyuncular renginde bir iskelet ve görünen adını görür, sana hazır mesajlar ve tepkiler gönderebilir; asla görüntü ya da yazılı metin göndermez. Kimse seni arayamaz: insanlar seni yalnızca arkadaş kodun ya da davet bağlantınla ya da yaş grubundaki bir lobide bulur.</p>',
        },
        {
          q: 'Arkadaşlar arasında görüntü nasıl çalışır?',
          a: `<p>İsteğe bağlıdır ve varsayılan olarak kapalıdır. Yalnızca herkesin ${F.AGE.video} yaşında ya da daha büyük olduğu özel bir odada, iki arkadaş da açtığında çalışır. İkinizden biri bunu istediği an kapatabilir; oda kimin paylaştığını gösterir. Görüntü cihazdan cihaza, şifreli gider; kimse onu kaydetmez ya da saklamaz. Cihazlarınız birbirine doğrudan ulaşamazsa görüntü gösterilmez ve oyun iskeletinle devam eder.</p>`,
        },
        {
          q: 'Birini nasıl bildiririm ya da engellerim?',
          a: '<p>Bir odada ya da arkadaş listende oyuncunun menüsünü aç ve Bildir ya da Engelle’yi seç. Engellenen oyuncular seninle eşleştirilemez, seni davet edemez ve sana gösterilmez. Oyuncu, onu kimin bildirdiğini öğrenmez. Her bildirim bizim okuduğumuz bir kuyruğa girer; ciddi olanlar öne alınır.</p>',
        },
        {
          q: 'Haftalık sıralamalar nedir?',
          a: '<p>Bir profilin olunca her oyunun her haftaki en iyi skoru, arkadaşlarının sıralamasına ve ülkendeki, yaş grubundaki oyuncuların sıralamasına gider. Yeni hafta her Pazartesi başlar. Sıralamalar yalnızca gerçek oyuncuları listeler ve ödül içermez.</p>',
        },
        {
          q: 'Hayalet yarışı nedir?',
          a: '<p>Canlı bir oyuncu yerine bir kayda karşı yarış: kendi en iyi koşun, bir arkadaşının koşusu ya da bir bot olan bir antrenman arkadaşı. Uygulama hangisi olduğunu her zaman söyler. Canlı olmayan kimse canlı gibi gösterilmez.</p>',
        },
      ],
    },
    {
      id: 'planlar',
      title: 'Planlar ve ödemeler',
      items: [
        {
          q: 'Neler ücretsiz?',
          a: `<p>${c.total} oyunun ${c.free} tanesi, oturarak ve sessiz sürümleriyle, Kolay ve Normal zorluk seviyeleriyle ve reklamsız. Her Pro oyunu ayrıca bir kez ücretsiz oynayabilirsin.</p>`,
        },
        {
          q: 'Pro ne ekler?',
          a: `<p>Pro oyunlar (${proTitles}), Zor ve Uzman zorluk seviyeleri ve daha sonra eklediğimiz oyunlar. Planlar için <a href="/tr/pro/">Pro sayfasına</a> bak.</p>`,
        },
        {
          q: 'Planların fiyatı ne kadar?',
          a: `<p>Web’de: Pro aylık ayda ${$(F.PRICE.proMonthly)}, Pro yıllık yılda ${$(F.PRICE.proYearly)} (${F.TRIAL_DAYS} günlük ücretsiz denemeyle), ${F.FAMILY_PLAN ? `Aile yıllık yılda ${$(F.PRICE.familyYearly)}, ` : ''}Ömür boyu tek sefer ${$(F.PRICE.lifetime)}. Android uygulamasında fiyatı ve para birimini ülken için Google Play belirler. Ayrıntılar <a href="/tr/terms">koşullarda</a>.</p>`,
        },
        {
          q: 'Ücretsiz deneme nasıl çalışır?',
          a: `<p>Pro yıllık ${F.TRIAL_DAYS} gün ücretsiz başlar. Deneme sırasında hiçbir şey tahsil edilmez. Bitmeden iptal etmezsen ilk yıl tahsil edilir. Bitişten ${F.REMINDER_DAYS} gün önce sana hatırlatırız: uygulama her açılışta bir bildirim gösterir; web’de bir adres bırakırsan tek bir e-posta göndeririz. Google Play da kendi hatırlatmasını gönderir.</p>`,
        },
        {
          q: 'Nasıl iptal ederim?',
          a: '<p>Web’de Gumroad kütüphaneni aç, BodyArcade’ı seç ve Manage membership’i seç; makbuz e-postasında da aynı bağlantı var. Android uygulamasında Google Play aboneliklerinden iptal et. Pro, zaten ödediğin sürenin sonuna kadar açık kalır.</p>',
        },
        {
          q: 'Nasıl iade alırım?',
          a: `<p>İadeler, planı satan mağazanın kurallarına göre yapılır. Web’de iadeyi Gumroad yapar; iade süresi ürün sayfasında ve makbuzunda yazar, yardım için ${mail()} adresine yazabilirsin. Google Play’de Google’ın kuralları geçerlidir. İade edilen bir plan, bir sonraki kontrolde cihazlarındaki Pro’yu bitirir; uygulama bu kontrolü sen kullandıkça yaklaşık günde bir kez yapar.</p>`,
        },
        {
          q: 'Pro’yu lisans anahtarımla nasıl açarım?',
          a: '<p>Gumroad’da ödedikten sonra bir lisans anahtarı içeren bir e-posta alırsın. Pro ekranını aç, “Lisans anahtarın var mı?” bölümünü bul, anahtarı yapıştır ve Etkinleştir’e bas. Android uygulamasında Pro henüz açılmadıysa Satın alımları geri yükle’ye bas.</p>',
        },
        {
          q: 'Lisans anahtarımı kaybettim.',
          a: '<p>Gumroad, ödediğinde onu sana e-postayla gönderdi; Gumroad kütüphanende de var. Bulamazsan ödeme yaptığın adresten bize yaz.</p>',
        },
        {
          q: 'Pro’yu kaç cihazda kullanabilirim?',
          a: `<p>Bir satın alma aynı anda en çok ${F.DEVICES.pro} cihazda çalışır${F.FAMILY_PLAN ? `, Aile ile ${F.DEVICES.family}` : ''} ve Kurucular için ${F.DEVICES.founder}. ${F.SEAT_IDLE_DAYS} gün kullanmadığın bir cihaz yerini kendiliğinden bırakır. Daha önce bir yer gerekiyorsa ${mail()} adresine yaz.</p>`,
        },
        {
          q: 'Pro çevrimdışı çalışır mı?',
          a: `<p>Uygulama planının hâlâ etkin olup olmadığını yaklaşık günde bir kez sorar. Sunucuya ulaşamazsa Pro, son lisans bitene kadar, en çok ${F.LICENCE_DAYS} gün çalışmaya devam eder. Ondan sonra o cihazda duraklar ve bir sonraki başarılı kontrolde geri gelir.</p>`,
        },
        {
          q: 'Yeni planlardan önce satın aldım. Ne değişir?',
          a: `<p>Senden hiçbir şey alınmaz. Ayda ${$(F.PRICE.legacyMonthly)} ödüyorsan, o üyelik kesintisiz sürdüğü sürece ayda ${$(F.PRICE.legacyMonthly)} ödemeye devam edersin. Ömür boyu planını ${$(F.PRICE.founder)} karşılığında aldıysan Kurucu’sun: BodyArcade sunulduğu sürece Pro, daha sonra eklenen her oyun, ${F.FAMILY_PROFILES} profil ve en çok ${F.DEVICES.founder} cihaz.</p>`,
        },
        ...(F.FAMILY_PLAN ? [{
          q: 'Aile planı nedir?',
          a: `<p>Aile yıllık, bütün ev için Pro’dur: en çok ${F.DEVICES.family} cihazın her birinde en çok ${F.FAMILY_PROFILES} profil; böylece herkes kendi sonuçlarını tutar. Yalnızca ilk profil çevrimiçi bir profile sahip olabilir; bir çocuğun profili sunucularımıza hiçbir şey kaydetmez.</p>`,
        }] : []),
      ],
    },
    {
      id: 'yardim',
      title: 'Bir şey çalışmadığında',
      items: [
        {
          q: 'Kamera açılmıyor.',
          a: '<p>Tarayıcının adres çubuğundan kameraya izin ver (kilit, ayar simgesi ya da “aA”), sonra Tekrar dene’ye bas. Kamerayı başka bir uygulama kullanıyorsa o uygulamayı kapat.</p>',
        },
        {
          q: 'Oyun beni göremiyor ya da kaybediyor.',
          a: '<p>Başın ve ayakların görünene kadar geri çekil (üst vücut oyunlarında başın ve kalçan). Işık önünde olacak, arkanda olmayacak biçimde dön. İki kişi oynamıyorsan görüntüde yalnızca bir kişi olmalı. Bir masadaysan masa modunu seç.</p>',
        },
        {
          q: 'Bir hareket sayılmadı.',
          a: '<p>Sonuç ekranı her kaçırmanın nedenini listeler; örneğin kalçan yeterince inmedi ya da bir elin görüntü dışındaydı; iskeletinden çizilmiş bir saniyelik tekrar da gösterir. Her oyunun sayfasında kısa bir rehber de var.</p>',
        },
        {
          q: 'Oyun yavaş ya da takılıyor.',
          a: '<p>Başka sekmeleri ve uygulamaları kapat ve yeniden dene. Uygulama cihazının kamera modu için çok yavaş olduğunu söylerse klavye ya da dokunmatikle oyna ya da daha hızlı bir cihaz kullan.</p>',
        },
        {
          q: 'Tarayıcı verilerimi temizledim ve profilim gitti.',
          a: `<p>Arkadaşlar sayfasını aç, “Zaten profilim var”ı seç ve arkadaş kodunu ve kaydettiğin ${F.RECOVERY_CODE_CHARS} karakterli kurtarma kodunu gir. Arkadaşların, isteklerin ve haftalık skorların geri gelir. Kurtarma kodunu yeniden gösteremeyiz, çünkü yalnızca özetini (hash) saklarız.</p>`,
        },
      ],
    },
    {
      id: 'hakkinda',
      title: 'BodyArcade hakkında',
      items: [
        {
          q: 'Kaloriler nasıl hesaplanıyor?',
          a: '<p>Girdiğin kiloya (cihazında kalır), ne kadar süre hareket ettiğine ve her oyunun ne kadar yoğun olduğuna göre. Kilo girilmezse kalori gösterilmez. Bir tahmindir, ölçüm değildir ve tıbbi tavsiye değildir.</p>',
        },
        {
          q: 'BodyArcade’ı kim yapıyor, size nasıl ulaşırım?',
          a: `<p>BodyArcade’ı ${F.COMPANY} yapıyor. ${mail()} adresine yaz.</p>`,
        },
      ],
    },
  ];

  const all = groups.flatMap((g) => g.items);
  const sections: Section[] = groups.map((g) => ({ id: g.id, title: g.title, html: g.items.map((i) => qa(i.q, i.a)).join('\n') }));
  return {
    file: 'tr/faq.html',
    url: '/tr/faq',
    lang: 'tr',
    other: { lang: 'en', url: '/faq' },
    nav: 'faq',
    title: 'Sık sorulan sorular',
    description: 'BodyArcade hakkında yanıtlar: nereye durulur, oturarak oynama, arkadaşlar ve odalar, gizlilik, ücretsiz plan, Pro fiyatları, ücretsiz deneme, iptal ve iade.',
    h1: 'Sorular ve yanıtlar',
    lead: `Oynamak, gizlilik, arkadaşlar ve planlar hakkında kısa yanıtlar. Seninki burada yoksa ${mail()} adresine yaz.`,
    sections,
    toc: true,
    after: cta('Denemeye hazır mısın? Bir oyun seç, gerisini kameran yapsın.', '/tr/', 'Bir oyun oyna'),
    crumbs: [{ name: 'BodyArcade', url: '/tr/' }, { name: 'Sık sorulan sorular', url: '/tr/faq' }],
    jsonLd: [faqLd(all)],
  };
}
