// Rehber: kameralı spor oyunları nasıl çalışır ve oda nasıl hazırlanır (Türkçe). Mesafeler uygulamanın oyuncuya söylediği mesafelerdir
// (core/ui/i18n/tr.ts); oyunlar ve sayıları katalogdan gelir.
import { articleLd, cta, readMinutes, table, ul, type PageSpec, type Section } from '../chrome.ts';
import * as F from '../facts.ts';
import { gameCounts, roundLength } from './games.ts';
import { GUIDE_WEBCAM_EN } from './guide-webcam.en.ts';

export function guideWebcamTr(): PageSpec {
  const c = gameCounts();
  const sections: Section[] = [
    {
      id: 'nasil',
      title: 'Bir tarayıcı bedenini nasıl okur',
      html: `<p>Modern tarayıcılar küçük makine öğrenmesi modellerini senin kendi cihazında çalıştırabilir. Kameralı oyunların beden için en çok kullandığı model bir poz işaretleyicisidir. Bir kamera karesini alır ve bedeninin ${F.MODEL_POINTS} noktasının, örneğin burnun, omuzların, dirseklerin, bileklerin, kalçaların, dizlerin ve ayak bileklerinin, karedeki konumunu koordinat olarak verir. BodyArcade, Google’ın MediaPipe Pose Landmarker’ını kullanır. Tarayıcının izin verdiği yerde sayfanın bir arka plan iş parçacığında, cihazın kullanılabilir grafik hızlandırması varsa grafik yongasında, yoksa işlemcide çalışır. Görüntü kareleri hiçbir yere gönderilmez.</p>
<p>Bir oyunun ${F.MODEL_POINTS} noktanın hepsine ihtiyacı yoktur. Kararlı olan birkaçını seçer ve aralarındaki basit ilişkileri okur:</p>
${ul([
  '<strong>Çömelme:</strong> kalçan duruş yüksekliğinin çok altına iner, sonra yeniden yükselir (Squat Flap).',
  '<strong>Diz kaldırma:</strong> bir diz kalçana doğru yükselir, bacaklar sırayla (Knee Sprint).',
  '<strong>Jumping jack:</strong> kollar ve ayaklar birlikte açılır, sonra geri gelir (Firework Jacks).',
  '<strong>Dönme ve yana eğilme:</strong> omuzların kalçana karşı döner ya da kalçanın üzerinde yana yatar (Twist Turbine, Limbo Bend).',
  '<strong>Uzan ve çek:</strong> bir el omzunun üstüne çıkar, sonra ona doğru iner (Summit Climb).',
  '<strong>Vurma:</strong> bir el ekrandaki bir hedefe ulaşır (Star Catch, Pad Work, Reaction Tag).',
  '<strong>Şekil:</strong> bir duvar sana ulaşmadan bedenin bir pozla eşleşir (Pose Wall).',
])}`,
    },
    {
      id: 'sen',
      title: 'Kendi bedenine göre ölçülür',
      html: `<p>Kamera senin boyunu ya da ne kadar uzakta durduğunu bilmez; bu yüzden iyi bir oyun her şeyi senin kendi bedenine göre ölçer. Bir oyundan önce BodyArcade, oynayacağın yerde durmanı ister ve boyunu, kol erişimini ve rahat bir çömelme derinliğini ölçer. Böylece bir çömelme bir çocuk için de uzun boylu bir yetişkin için de aynı fiziksel şey demektir. Bu adımı atlayıp sabit piksel eşikleri kullanan oyunlar, onları yapan kişi için çalışır, başka kimse için pek çalışmaz.</p>`,
    },
    {
      id: 'sinirlar',
      title: 'Tek kamera neyi iyi okur, neyi okuyamaz',
      html: `<p><strong>Güvenilir:</strong> büyük vücut parçalarının büyük hareketleri. Çömelme, diz kaldırma, jumping jack, dönme, yana eğilme, baş üstüne uzanma ve adım atma; ucuz bir kameradan, eşit olmayan ışıktan ve dağınık bir odadan sağ çıkar.</p>
<p><strong>Daha az güvenilir:</strong> ince el konumları ve parmak hareketleri, çok hızlı hareketler, bir masanın ya da başka birinin arkasında kalan her şey ve kameraya doğru ya da kameradan uzaklaşan hareketler; çünkü tek kameranın gerçek bir derinlik algısı yoktur.</p>
<p>Bir kameranın iyi gördüğü şeylerin etrafında kurulmuş, az sayıda net hareketli bir oyun, yarısı sayılan yirmi hareketli bir oyundan iyidir. Bir hareket sayılmadığında iyi bir oyun nedenini söyler. BodyArcade her kaçırmanın nedenini listeler, örneğin “Kalçan yeterince inmedi” ya da “Ellerin görüntü dışındaydı”; böylece tahmin etmek yerine nedeni düzeltebilirsin.</p>`,
    },
    {
      id: 'oda',
      title: 'İlk seferde çalışan bir oda nasıl hazırlanır',
      html: `${ul([
  '<strong>Alan.</strong> Çevrende yaklaşık 2 metre boş alan aç ve kaygan olmayan bir zeminde oyna.',
  '<strong>Mesafe.</strong> Tüm vücut oyunlarında başından ayak bileklerine kadar görünmelisin: dizüstünden 2 ile 3 metre, dik duran bir telefondan 1,5 ile 2 metre uzakta dur. Üst vücut oyunlarında başından kalçana kadar görünmelisin, yaklaşık 1 metre uzakta.',
  '<strong>Kamera yüksekliği.</strong> En iyisi kalça yüksekliğidir. Telefonu kalça yüksekliğinde dik tut, sağlam bir şeye yasla. Dizüstünün ekranını kamera ayaklarını görene kadar geriye yatır, sonra 2,5 ile 3 metre geri çekil. Yerde, yukarı bakan bir dizüstü oranlarını bozar.',
  '<strong>Işık.</strong> Işığı önüne ya da yanına al, arkana değil. Arkandaki bir pencere seni siluete çevirir ve model eklemlerini kaybeder.',
  '<strong>İnsanlar.</strong> İki kişi oynamıyorsan görüntüde yalnızca oyuncu olmalı. Yoldan geçen biri takibi bir an karıştırabilir.',
  '<strong>Kıyafet.</strong> Arkandaki duvarla zıtlık oluşturan her şey yardımcı olur.',
  '<strong>Telefonlar.</strong> Yatay, odanın daha çoğunu gösterir; geniş hareketlere yer olur. Dik ise daha uzun bir görüntü verir. BodyArcade, tarayıcı izin veriyorsa bir tur boyunca ekranı açık tutmasını ister. Başka kameralı uygulamalarda, ekran bir turun ortasında kararmasın diye otomatik kilidi kapat.',
])}`,
    },
    {
      id: 'oturarak',
      title: 'Oturarak, sessiz ve düşük etkili',
      html: `<p>Herkes ayakta durup zıplayamaz ya da istemez. BodyArcade’de her oyunun oturarak sürümü var ve ${c.total} oyunun ${c.quiet} tanesi zıplamadan ve yere vurmadan, sessizce oynanabilir; bu, alt katında komşular olan bir dairede önemlidir. Bir masada uygulama yalnızca başını ve omuzlarını gördüğünde bunu fark eder ve masa modunu sunar. Oturarak oynanamayan bir kameralı oyun birçok insanı dışarıda bırakır.</p>`,
    },
    {
      id: 'kiyas',
      title: 'Kameralı oyunlar alternatiflerle nasıl kıyaslanır',
      html: `${table(null, ['Seçenek', 'Ne gerekir', 'Takip', 'En iyi olduğu yer'], [
  ['Tarayıcıda kameralı oyunlar', 'Kamerası ve tarayıcısı olan bir dizüstü ya da telefon', 'Tek kameradan tüm vücut pozları', 'Saniyeler içinde başlamak, kısa seanslar, denemek için satın alınacak bir şey yok'],
  ['Konsol hareket oyunları', 'Bir konsol ve kumandaları ya da aksesuarları', 'Kumandalardaki hareket sensörleri, bazen bir kuvvet sensörü', 'Dirençli antrenmanlı uzun, yapılandırılmış programlar'],
  ['VR spor', 'Bir başlık ve boş alan', 'Başlık ve el kumandalarıyla 3B takip', 'Sürükleyicilik, boks ve ritim oyunları, kol çalışması'],
  ['Telefon kameralı spor uygulamaları', 'Bir telefon ve uygulama kurulumu', 'Aynı türden poz modeli, bir uygulamada', 'Tekrar sayma ve rehberli antrenmanlar'],
])}
<p>Kameralı oyunlar sürtünmede kazanır. Satın alınacak ya da şarj edilecek bir şey yok ve bir tur, hareket etmeye karar vermenden bir dakika sonra başlayabilir. Direnç konusunda kaybederler, çünkü bir kamera seni bir şeye karşı itmeye zorlayamaz; hassasiyette de. Bir oturma odasında nabzını yükseltmenin kolay bir yolunu istiyorsan uygundurlar. Bir güç programı istiyorsan bir konsol oyununa ya da ağırlık uygulamasına bak ya da kameralı bir oyunu ısınma olarak kullan.</p>`,
    },
    {
      id: 'bak',
      title: 'Kameralı bir spor oyununda nelere bakmalı',
      html: `${ul([
  '<strong>Cihazda işleme.</strong> Görüntü cihazında analiz edilmeli ve hiç yüklenmemeli. Gizlilik politikasını oku; söylemiyorsa yüklendiğini varsay.',
  '<strong>Bir kalibrasyon adımı.</strong> Kısa bir “buraya dur” denetimi, oyunun tahmin etmek yerine seni ölçtüğü anlamına gelir.',
  '<strong>Görebileceğin geri bildirim.</strong> İskeletinin üzerine çizildiği küçük bir önizleme, kameranın seni kaybedip kaybetmediğini anında söyler.',
  '<strong>Kaçırma nedenleri.</strong> Bir hareketin neden sayılmadığını söyleyen oyun gelişmeni sağlar.',
  '<strong>Kısa turlar.</strong> Poz oyunları seni iyi anlamda yorar. Formun düşmeden önce birkaç dakika yeterlidir.',
  '<strong>Oturarak ve sessiz sürümler.</strong> Bütün ailenin ve komşuların katılmasını sağlar.',
  '<strong>Kamerasız oynama yolu.</strong> Klavye ya da dokunmatik kontroller bir oyunu trende denemeni sağlar.',
])}`,
    },
    {
      id: 'dene',
      title: 'Şimdi birini dene',
      html: `<p>BodyArcade, ${roundLength(c.shortest, 'tr')} ile ${roundLength(c.longest, 'tr')} arasında turlarla ${c.total} kısa oyun içerir; ${c.free} tanesi ücretsizdir. Tek başına, büyük bir ekranda tek kamerada yan yana iki kişi olarak ya da çevrimiçi bir odada arkadaşlarla oynayabilirsin. Poz modeli cihazında çalışır, görüntü orada kalır.</p>
<p>İlgili: <a href="/tr/evde-spor-oyunlari">${c.total} oyunun hepsi ve hangisiyle başlayacağın</a>, <a href="/tr/oturarak-egzersiz-oyunlari">her oyunu sandalyeden oynamak</a>, <a href="/tr/ring-fit-adventure-alternatifi">tarayıcıda oynayabileceğin bir Ring Fit Adventure alternatifi</a>.</p>`,
    },
  ];
  const h1 = 'Kamera ile spor oyunları nasıl çalışır ve odanı nasıl hazırlarsın';
  // the title of a search result fits in 60 characters (release 3); the heading of the page keeps the whole question
  const title = 'Kamera ile spor oyunları: nasıl çalışır, oda nasıl kurulur';
  const description = 'Bir tarayıcının sıradan bir kamerayla bedenini nasıl okuduğu, neyi iyi okuduğu ve odanı bir kameralı spor oyunu ilk seferde çalışacak biçimde nasıl hazırlayacağın.';
  const lead = 'Kamera ile spor oyunu, sıradan bir kameranın önünde hareket ederek kontrol ettiğin bir oyundur: dizüstünün kapağındaki, monitörünün üstündeki ya da telefonunun önündeki kamera. Kumanda, bileklik ya da konsol yok. Kamera izler, yazılım gördüğünü birkaç vücut konumuna çevirir ve oyun bunlara, bir düğmeye basılmış gibi tepki verir.';
  const minutes = readMinutes(lead + sections.map((s) => s.html).join(' '));
  return {
    file: 'tr/kamera-ile-spor-oyunlari.html',
    url: '/tr/kamera-ile-spor-oyunlari',
    lang: 'tr',
    other: { lang: 'en', url: '/webcam-fitness-games' },
    og: 'article',
    title,
    description,
    h1,
    when: `Güncelleme: ${F.longDate(GUIDE_WEBCAM_EN.modified, 'tr')} &middot; ${minutes} dk okuma`,
    lead: `${lead} Bu rehber bunun bir tarayıcıda nasıl çalıştığını, neyi okuyup neyi okuyamadığını ve bir odanın nasıl hazırlanacağını anlatır. BodyArcade’i biz yapıyoruz, bu yüzden onu örnek olarak kullanıyoruz; öğütler kamera kullanan her oyun için geçerlidir.`,
    sections,
    toc: true,
    after: cta('Bir oyun aç, kameraya izin ver, geri çekil ve hareket et. İlk tur birkaç dakika sürer.', '/tr/', 'Bir oyun oyna'),
    crumbs: [{ name: 'BodyArcade', url: '/tr/' }, { name: 'Kamera ile spor oyunları', url: '/tr/kamera-ile-spor-oyunlari' }],
    jsonLd: [articleLd({ headline: h1, description, url: '/tr/kamera-ile-spor-oyunlari', published: GUIDE_WEBCAM_EN.published, modified: GUIDE_WEBCAM_EN.modified, lang: 'tr' })],
  };
}
