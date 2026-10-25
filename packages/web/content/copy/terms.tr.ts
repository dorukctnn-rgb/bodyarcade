// Kullanım koşulları, Türkçe. terms.en.ts ile aynı şeyleri söyler; fiyatlar, sınırlar ve yaşlar facts.ts'ten, oyunlar ve sayıları
// katalogdan (copy/games.ts) gelir.
import { mail, note, table, ul, type PageSpec } from '../chrome.ts';
import * as F from '../facts.ts';
import { gameCounts, titlesOf } from './games.ts';

export function termsTr(): PageSpec {
  const date = F.longDate(F.UPDATED, 'tr');
  const c = gameCounts();
  const W = F.ROAD_RUN_WORLDS;
  const free = titlesOf((g) => g.free, 'tr');
  const pro = titlesOf((g) => !g.free, 'tr');
  const $ = (n: number): string => F.usd(n, 'tr');
  const memberships = F.FAMILY_PLAN ? 'Pro aylık, Pro yıllık ve Aile yıllık' : 'Pro aylık ve Pro yıllık';
  return {
    file: 'tr/terms.html',
    url: '/tr/terms',
    lang: 'tr',
    other: { lang: 'en', url: '/terms' },
    title: 'Kullanım koşulları',
    description: 'BodyArcade’ı oynamanın koşulları: egzersiz güvenliği, başkalarıyla oynama, ücretsiz plan, Pro fiyatları, ücretsiz deneme, iptal, iade ve lisans anahtarları.',
    h1: 'Kullanım koşulları',
    when: `Son güncelleme: ${date}`,
    lead: `Bu koşullar BodyArcade’ı, çevrimiçi özelliklerini ve ücretli planlarını kullanmanı kapsar. Oynayarak bu koşulları kabul etmiş olursun. Kabul etmiyorsan lütfen BodyArcade’ı kullanma. Verilerinin nasıl işlendiği <a href="/tr/privacy">gizlilik politikasında</a> anlatılır.`,
    brief: {
      title: 'Kısaca',
      items: [
        `<strong>Oynaması ücretsiz.</strong> ${c.total} oyunun ${c.free} tanesi, oturarak ve sessiz sürümleriyle birlikte ücretsizdir ve reklam yoktur. Road Run’ın ${W.total} dünyasından ${W.free} tanesi ücretsizdir. Her Pro oyunu bir kez ücretsiz oynayabilirsin.`,
        '<strong>Kendi temponda egzersiz yap.</strong> Çevrene yer aç, ısın ve bir yerin ağrırsa dur. Aşağıdaki güvenlik uyarısını oku.',
        '<strong>Nazik ol ve adil oyna.</strong> Diğer oyuncuları rahatsız eden ya da hile yapan profilleri susturabilir, askıya alabilir ya da yasaklayabiliriz.',
        `<strong>Pro’nun ödemesi web’de Gumroad, Android uygulamasında Google Play üzerinden yapılır.</strong> Ödemeyi onlar alır, vergiyi onlar halleder. Web’den alınan bir plan ${F.REFUND_DAYS} gün içinde iade edilebilir.`,
        `<strong>Eski alıcılar ödedikleri fiyatı korur.</strong> ${$(F.PRICE.legacyMonthly)} aylık üyeler ${$(F.PRICE.legacyMonthly)} öder, ${$(F.PRICE.founder)} Ömür boyu alıcıları Kurucu olur.`,
      ],
    },
    crumbs: [{ name: 'BodyArcade', url: '/tr/' }, { name: 'Kullanım koşulları', url: '/tr/terms' }],
    sections: [
      {
        id: 'kim',
        title: 'Biz kimiz',
        html: `<p>BodyArcade (bodyarcade.com ve BodyArcade Android uygulaması), ${F.COUNTRY}’de ${F.STUDIO} adıyla çalışan gerçek kişi ${F.OWNER} tarafından yapılır. Bu koşullarda “biz” derken onu kastediyoruz. Bize ${mail()} adresinden ulaşabilirsin.</p>`,
      },
      {
        id: 'ne',
        title: 'BodyArcade nedir',
        html: `<p>BodyArcade, bedeninle oynadığın ${c.total} kısa oyundan oluşur. Bir kamera, yani web kameran ya da telefonunun ön kamerası, hareketlerini cihazında okur. Tarayıcında ya da Android uygulamasında oynayabilirsin. Hareketleri yapamıyorsan ya da kameran yoksa, izin veren oyunlarda klavye ya da dokunmatik kontroller vardır.</p>
<p><strong>Ücretsiz plan</strong> ${c.free} oyun (${free}), bunların oturarak ve sessiz sürümleri, Kolay ve Normal zorluk seviyeleri ve reklamsızlık içerir. Road Run’ın ${W.total} dünyası vardır ve ${W.free} tanesi ücretsizdir. Her Pro oyunu (${pro}) bir kez ücretsiz oynayabilirsin.</p>
<p><strong>Pro</strong>, aşağıdaki planlarla Pro oyunları, Road Run’ın diğer ${W.total - W.free} dünyasını, Zor ve Uzman zorluk seviyelerini ve daha sonra eklediğimiz oyunları ekler. Daha sonra eklenen oyunlar, ${memberships} üyeliklerinden biri etkin olduğu sürece ve Ömür boyu planda dahildir.</p>
<p>BodyArcade’ı çalışır tutuyor ve geliştiriyoruz; bu yüzden oyun ve özellik ekleyebilir, değiştirebilir ya da kaldırabiliriz. Ödediğin bir planın ana parçası olan bir şeyi kaldırırsak onu benzer değerde bir şeyle değiştirmeye çalışırız. Yasadan doğan tüketici haklarına bu durum dokunmaz. Çevrimiçi özellikler ağ bağlantısı gerektirir ve başka şirketlerin (Cloudflare, Gumroad, Google) hizmetlerine bağlıdır; bu yüzden her zaman erişilebilir olacaklarını vaat edemeyiz.</p>`,
      },
      {
        id: 'guvenlik',
        title: 'Güvenle oyna',
        html: `<p>Oyunlar senden çömelmeni, zıplamanı, dönmeni, uzanmanı, eğilmeni ve yumruk atmanı ister. Kendi riskinle ve kendi temponda oynarsın.</p>
${ul([
  'Çevrende yaklaşık 2 metre boş alan aç ve kaygan olmayan bir zeminde oyna.',
  'Hamileysen, kalp ya da eklem rahatsızlığın varsa, bir süredir egzersiz yapmadıysan ya da hareket ederken ağrı duyuyorsan önce doktoruna danış.',
  'Baş dönmesi, nefes darlığı ya da keskin bir ağrı hissedersen dur.',
  'Çocuklar yanlarında bir yetişkin varken oynasın.',
  `Her oyunun oturarak sürümü vardır ve ${c.total} oyunun ${c.quiet} tanesi zıplamadan ve yere vurmadan, sessiz oynanabilir. Ayakta durmak ya da zıplamak sorun olduğunda bunları kullan.`,
])}
${note('Tıbbi tavsiye değildir', 'BodyArcade kalp atış hızını ölçmez ve tıbbi tavsiye vermez. Kalori rakamları, girdiğin kiloya ve ne kadar süre hareket ettiğine göre tahminlerdir. Kamera takibi, özellikle ışık kötüyse, bir hareketi kaçırabilir ya da yanlış okuyabilir.')}`,
      },
      {
        id: 'yas',
        title: 'BodyArcade’ı kimler kullanabilir',
        html: `<p>Herkes kendi cihazında oynayabilir. Çevrimiçi özellikler (arkadaşlar, odalar, herkese açık lobiler ve haftalık sıralamalar) ${F.AGE.online} yaş ve üzeri kişiler içindir. ${F.AGE.online} yaşından küçüklerin çevrimiçi profili hiç olmaz: oyunlar cihazda çalışır ve uygulama oyuncu hakkında arkadaş hizmetine hiçbir şey göndermez. ${F.AGE.online} ile 17 yaş arasında profil, üretilmiş bir ad ve hazır mesajlarla sınırlıdır; görüntü ve yazılı metin yoktur. ${F.AGE.video} yaşından küçükse lütfen BodyArcade’ı bir ebeveynin ya da vasinin bilgisi dahilinde kullan ve bir şey satın almadan önce ona sor.</p>
<p>Uygulama, çevrimiçi profil oluşturmadan önce yaş grubunu bir kez sorar. Lütfen gerçek olanı ver: neleri kimlerle paylaşabileceğini bu belirler ve daha küçük oyuncuları korur. Yetişkinlere ayrılmış özellikleri almak için gerçekte olduğundan büyük olduğunu söylemek bu koşulları ihlal eder.</p>`,
      },
      {
        id: 'cevrimici',
        title: 'Başkalarıyla oynamak',
        html: `<p>Çevrimiçi profil isteğe bağlıdır ve parolası yoktur. Uygulama profili yapmadan önce bu koşulları ve aşağıdaki topluluk kurallarını kabul ettiğini söyleyen bir kutuyu işaretlemeni ister ve kabul ettiğin koşulların sürümünü profille birlikte saklar. Kurtarma kodunu güvende tut: arkadaş kodunla birlikte profilini geri getirir ve ikisine de sahip olan herkes profili ele geçirebilir.</p>
${ul([
  `<strong>Adlar.</strong> ${F.AGE.video} yaş ve üzeri oyuncular en çok ${F.NAME_MAX_CHARS} karakterlik bir görünen ad seçer. ${F.AGE.online} ile 17 yaş arasındaki oyunculara üretilmiş bir ad verilir. Ad, başkası gibi davranmamalı, kişisel bilgi taşımamalı ve kaba olmamalıdır.`,
  '<strong>Arkadaş kodları ve bağlantıları.</strong> Onları yalnızca haber almak istediğin kişilerle paylaş. Bir arkadaşlık isteği, karşı taraf kabul edene kadar arkadaşlık sayılmaz.',
  `<strong>Odalar.</strong> Bir odada ${F.SEATS.min} ile ${F.SEATS.max} oyuncu bulunur. Oyunu ev sahibi seçer; özel bir odada ev sahibi bir oyuncuyu odadan da çıkarabilir.`,
  '<strong>Herkese açık lobiler.</strong> Kendi yaş grubundaki oyuncularla karşılaşırsın. Onlar görünen adını ve renginde bir iskelet görür, sana hazır mesajlar ve tepkiler gönderebilir. Tanımadığın hiç kimse senden yazılı metin ya da görüntü almaz.',
  `<strong>Yazılı sohbet</strong> yalnızca her oyuncunun ${F.AGE.video} yaşında ya da daha büyük olduğu özel odalarda vardır. Arkadaşlar arasında <strong>görüntü</strong> isteğe bağlıdır, varsayılan olarak kapalıdır ve yalnızca böyle bir odada iki arkadaş da açtığında çalışır.`,
  'Başka birinin görüntüsünü ya da mesajlarını onun onayı olmadan kaydetme, ekran görüntüsünü alma ya da paylaşma.',
  'Bir kayda ya da bir antrenman arkadaşına (bir bota) karşı yarıştığında uygulama bunu söyler. Bir botu insan gibi göstermeyiz; lobiler ya da sıralamalar için uydurma oyuncu yaratmayız.',
])}`,
      },
      {
        id: 'davranis',
        title: 'Topluluk kuralları: davranış, adil oyun ve sıralamalar',
        html: `<p>Lütfen şunları yapma:</p>
${ul([
  'kimseyi rahatsız etme, tehdit etme, zorbalık yapma ya da ayrımcılık yapma; cinsel, nefret içerikli ya da şiddet içeren içerik paylaşma;',
  'bir ada ya da mesaja, kendinin ya da bir başkasının kişisel bilgilerini koyma ya da sohbet süzgecini aşmaya çalışma;',
  'istenmeyen ileti, reklam ya da bağlantı gönderme;',
  `BodyArcade’ı ${F.AGE.video} yaşından küçük oyuncularla iletişim kurmak için kullanma. Uygulama, bir yetişkinin ${F.AGE.video} yaşından küçük bir oyuncuya arkadaşlık isteği göndermesine izin vermez ve yetişkinler bunu aşmanın yollarını aramamalıdır;`,
  'hareketlerini ya da skorlarını sahtelemek için betik, değiştirilmiş uygulama ya da başka araç kullanma, skor alıp satma ya da skor yükseltme yapma, bir hatadan çıkar sağlama (hataları bunun yerine bize bildir);',
  'insanları art niyetle bildirme.',
])}
<p>Haftalık sıralamalar yalnızca gerçek oyuncuları listeler ve ödül içermez. Sunucu, bir skorun turun sürdüğü süre içinde mümkün olup olmadığını denetler ama oyununu yeniden oynatamaz; bu yüzden bir skor kanıt değildir. Bir skoru kaldırabilir ya da bir profili bir sıralamadan gizleyebiliriz.</p>`,
      },
      {
        id: 'yaptirim',
        title: 'Bildirimler, susturmalar, askıya almalar ve yasaklar',
        html: `<p>Karşılaştığın her oyuncuyu bildirebilir ya da engelleyebilirsin. Her bildirim, bizim kendimizin okuduğu bir kuyruğa girer; ciddi nedenler öne alınır. Biz bakana kadar otomatik adımlar diğer oyuncuları korur: ${F.MUTE_WINDOW_HOURS} saat içinde ${F.REPORTS_TO_MUTE} farklı oyuncu aynı oyuncuyu bildirirse o oyuncunun yazılı metni ${F.MUTE_HOURS} saat susturulur; ${F.SUSPEND_WINDOW_DAYS} gün içinde ${F.REPORTS_TO_SUSPEND} farklı oyuncu ya da bir gün içinde ciddi bir nedenle ${F.URGENT_REPORTERS_TO_SUSPEND} oyuncu bildirirse herkese açık lobiler o oyuncuya ${F.SUSPEND_DAYS} gün kapanır.</p>
<p>Bu kurallar çiğnendiğinde, ciddi durumlarda hemen, bir profili uyarabilir, susturabilir, askıya alabilir ya da yasaklayabilir; bir adı ya da skoru kaldırabiliriz. Yasak, çevrimiçi özellikleri bitirir; yerel oyun ve ücretli plan kalır. Yanlış yaptığımızı düşünüyorsan ${mail()} adresine yaz, yeniden bakarız.</p>`,
      },
      {
        id: 'planlar',
        title: 'Planlar ve fiyatlar',
        html: `${table(null, ['Plan', 'Web’deki fiyat', 'Ne alırsın'], [
  ['Ücretsiz', 'Ücret yok', `${c.free} oyun, bunların oturarak ve sessiz sürümleri, Kolay ve Normal zorluk, reklam yok, Road Run’ın ${W.total} dünyasından ${W.free} tanesi; her Pro oyun bir kez.`],
  ['Pro aylık', `<span class="nw">ayda ${$(F.PRICE.proMonthly)}</span>`, `${c.total} oyunun hepsi, Road Run’ın ${W.total} dünyasının hepsi, daha sonra eklediğimiz oyunlar ve her zorluk seviyesi. Sen iptal edene kadar her ay yenilenir. En çok ${F.DEVICES.pro} cihaz.`],
  ['Pro yıllık', `<span class="nw">yılda ${$(F.PRICE.proYearly)}</span>`, `Pro aylık ile aynı, ${F.TRIAL_DAYS} günlük ücretsiz denemeyle. Sen iptal edene kadar her yıl yenilenir.`],
  ...(F.FAMILY_PLAN ? [['Aile yıllık', `<span class="nw">yılda ${$(F.PRICE.familyYearly)}</span>`, `Pro ile aynı; en çok ${F.DEVICES.family} cihazın her birinde en çok ${F.FAMILY_PROFILES} profil, böylece evdeki herkes kendi sonuçlarını tutar.`]] : []),
  ['Ömür boyu', `<span class="nw">tek sefer ${$(F.PRICE.lifetime)}</span>`, `Yenileme olmadan Pro; BodyArcade sunulduğu sürece, daha sonra eklediğimiz oyunlarla birlikte. En çok ${F.DEVICES.pro} cihaz.`],
])}
<p><strong>Ömür boyu ne demek.</strong> Bir kez ödersin ve Pro, BodyArcade sunulduğu sürece yenileme olmadan sürer. BodyArcade’ı sonsuza kadar sunacağımız anlamına gelmez. Bir gün kapatırsak Ömür boyu plan ve diğer planlar onunla birlikte biter; elimizden geldiğince önceden haber veririz ve yenileme ödemelerini durdururuz. Yasadan doğan tüketici haklarına bu durum dokunmaz.</p>
<p><strong>Eski planlar.</strong> Yukarıdaki planlar satışa çıkmadan önce Pro aylığı ayda ${$(F.PRICE.legacyMonthly)} fiyatıyla aldıysan, o üyelik kesintisiz sürdüğü sürece Pro’yu ayda ${$(F.PRICE.legacyMonthly)} ile korursun. O tarihten önce Ömür boyu planını ${$(F.PRICE.founder)} karşılığında aldıysan Kurucu’sun: BodyArcade sunulduğu sürece Pro, daha sonra eklenen her oyun, ${F.FAMILY_PROFILES} profil ve en çok ${F.DEVICES.founder} cihaz.</p>
<p><strong>Android uygulaması.</strong> Orada fiyatları, para birimlerini ve ücretsiz denemeyi Google Play belirler; ülkeye göre değişebilir. Yukarıdaki fiyatlar web’deki liste fiyatlarıdır, ABD doları cinsindendir. Vergiler, satıcının gerektirdiği biçimde fiyata dahil edilir ya da ödemede eklenir.</p>
<p>Yeni alıcılar için plan fiyatlarını değiştirebiliriz. Süren bir üyeliğin fiyatını, Gumroad ya da Google Play’in gerektirdiği bildirim ve onay olmadan artırmayız.</p>`,
      },
      {
        id: 'odeme',
        title: 'Ödeme, yenileme ve iptal',
        html: `<p><strong>Web’de</strong> Pro’yu Gumroad satar. Gumroad’ın sayfasında ödersin ve Gumroad kayıtlı satıcıdır: KDV’yi ya da satış vergisini o toplar ve satın alman için kendi koşulları da geçerlidir. Ödedikten sonra Gumroad sana bir lisans anahtarı e-postalar. Pro’yu açmak için onu uygulamanın Pro ekranına yapıştır.</p>
<p><strong>Android uygulamasında</strong> Pro’yu Google Play satar ve onun koşulları geçerlidir.</p>
<p><strong>Üyelikler</strong> (Pro aylık, Pro yıllık ve Aile yıllık) sen iptal edene kadar yenilenir. Web’de Gumroad kütüphanenden iptal et (BodyArcade’ı seç, sonra Manage membership); makbuz e-postasında da aynı bağlantı var. Android uygulamasında Google Play aboneliklerinden iptal et. İptal etmek gelecekteki ödemeleri durdurur ve Pro, zaten ödediğin sürenin sonuna kadar açık kalır. Bir yenileme ödemesi başarısız olursa Pro, Gumroad ya da Google Play üyeliği bitirdiğinde biter.</p>
<p>Pro yıllık planının <strong>ücretsiz denemesi</strong> ${F.TRIAL_DAYS} gün sürer. Deneme sırasında hiçbir şey tahsil edilmez. Deneme bitmeden iptal etmezsen ilk yıl tahsil edilir ve plan her yıl yenilenir. Deneme, kişi ve abonelik başına bir kez verilir; kimin uygun olduğuna mağaza karar verir. Deneme bitmeden ${F.REMINDER_DAYS} gün önce sana hatırlatırız: uygulama her açılışta bir bildirim gösterir; web’de bir adres bırakırsan tek bir e-posta göndeririz (gizlilik politikasına bak). Google Play da kendi hatırlatmasını gönderir.</p>`,
      },
      {
        id: 'iade',
        title: 'İadeler',
        html: `<p>İadeler, planı satan mağazanın kurallarına göre yapılır.</p>
<p>Web’de her plan, satın alındığı günden başlayarak ${F.REFUND_DAYS} gün içinde iade edilebilir. İadeyi Gumroad yapar; iade süresi ürünün Gumroad sayfasında ve makbuzunda da yazar. İade istemek için makbuzundaki bağlantıyı kullan ya da ${mail()} adresine yaz; Gumroad’dan iade etmesini isteriz. İade edilen bir satın alma, bir sonraki kontrolde cihazlarındaki Pro’yu bitirir; uygulama bu kontrolü sen kullandıkça yaklaşık günde bir kez yapar.</p>
<p>Android uygulamasında Google Play’in iade kuralları geçerlidir ve kararı Google verir. Yardım gerekirse bize yaz.</p>
<p>Bu koşullardaki hiçbir şey, ülkenin hukukunun sana tüketici olarak verdiği iade ya da cayma hakkını ortadan kaldırmaz.</p>`,
      },
      {
        id: 'lisans',
        title: 'Lisans anahtarları ve cihazlar',
        html: `<p>Bir lisans anahtarı sana ve birlikte yaşadığın kişilere aittir. Lütfen onu gizli tut; paylaşma ya da satma. Bir satın alma aynı anda en çok ${F.DEVICES.pro} cihazda çalışır${F.FAMILY_PLAN ? `, Aile ile ${F.DEVICES.family}` : ''} ve Kurucular için ${F.DEVICES.founder}. ${F.SEAT_IDLE_DAYS} gün kullanmadığın bir cihaz yerini kendiliğinden bırakır. Daha önce bir yer gerekiyorsa, örneğin bir telefonu kaybettiysen, ${mail()} adresine yaz.</p>
<p>Uygulama lisans hizmetimize planın hâlâ etkin olup olmadığını yaklaşık günde bir kez sorar ve kontroller arasında Pro’yu açık tutar. Hizmete ulaşılamazsa Pro, son lisans bitene kadar, en çok ${F.LICENCE_DAYS} gün çalışmaya devam eder. Ondan sonra Pro o cihazda duraklar ve bir sonraki başarılı kontrolde geri gelir. Kaçırılan bir kontrol bir planı asla bitirmez.</p>`,
      },
      {
        id: 'kullanim',
        title: 'Kabul edilebilir kullanım',
        html: `<p>Lütfen şunları yapma:</p>
${ul([
  'lisans kontrolünü ya da cihaz sınırını aşma; lisans anahtarlarını herkese açık paylaşma;',
  'yasanın izin verdiği durumlar dışında oyunları, görselleri ya da kodu kopyalama, yeniden satma ya da yeniden yayımlama;',
  'hizmete saldırma, onu aşırı yükleme ya da yoklama; betiklerle toplu profil, oda ya da istek üretme;',
  'BodyArcade’ı yasaya aykırı bir şey için kullanma.',
])}`,
      },
      {
        id: 'mulkiyet',
        title: 'Mülkiyet ve atıflar',
        html: `<p>BodyArcade’ın kendisi, oyunları, görselleri, metinleri ve kodu, ${F.STUDIO} adıyla çalışan ${F.OWNER}’e aittir. Bu koşullar çerçevesinde onları kullanman için kişisel ve devredilemez bir hak alırsın. Senin olan sana ait kalır: adın ve sonuçların.</p>
<p>BodyArcade açık kaynaklı yazılımlarla yapılmıştır: Google’ın MediaPipe’ı ve poz modeli Apache Lisansı 2.0 ile; three.js ve qrcode-generator MIT Lisansı ile. Onlara kendi lisansları uygulanır.</p>`,
      },
      {
        id: 'garanti',
        title: 'Garanti verilmemesi',
        html: `<p>BodyArcade’ı eğlenceli ve çalışır tutmak için uğraşırız ama hizmet olduğu gibi ve mümkün olduğu ölçüde sunulur; yasanın dışlamamıza izin verdiği hiçbir garanti verilmez. Kamera takibi hareketleri kaçırabilir ya da yanlış okuyabilir; BodyArcade her cihazda ya da tarayıcıda çalışmayabilir. Hatasız, her zaman erişilebilir ya da özel amacına uygun olacağını vaat etmeyiz.</p>`,
      },
      {
        id: 'sorumluluk',
        title: 'Sorumluluğun sınırı',
        html: `<p>Yasanın izin verdiği ölçüde; dolaylı ya da sonuç olarak doğan zararlardan, oynarken olan yaralanma ya da hasardan (örneğin bir düşme ya da mobilyaya çarpma) sorumlu değiliz. Sana karşı toplam sorumluluğumuz, talepten önceki 12 ayda planlar için ödediğin tutarla sınırlıdır. Bu koşullardaki hiçbir şey, yasayla sınırlanamayan bir sorumluluğu, örneğin ihmalimizin ya da hilemizin yol açtığı yaralanma sorumluluğunu sınırlamaz ve tüketici olarak sahip olduğun hakları ortadan kaldırmaz.</p>`,
      },
      {
        id: 'bitirme',
        title: 'Kullanımı bitirmek',
        html: `<p>BodyArcade’ı istediğin an kullanmayı bırakabilir ve çevrimiçi profilini uygulamadan silebilirsin. Bu koşulları ihlal edersen çevrimiçi özelliklere erişimini askıya alabilir ya da bitirebiliriz. BodyArcade’ı bir gün kapatırsak, planlar bölümünde yazdığı gibi, elimizden geldiğince önceden haber veririz. Yasadan doğan tüketici haklarına bu durum dokunmaz.</p>`,
      },
      {
        id: 'hukuk',
        title: 'Uygulanacak hukuk',
        html: `<p>Bu koşullar Türkiye hukukuna tabidir. Bu, yaşadığın ülkenin emredici tüketici hukukunun sana verdiği korumayı ortadan kaldırmaz; o hukukun kendi ülkenin mahkemelerine ya da tüketici kurullarına başvurmana izin verdiği yerde bunu yapabilirsin.</p>`,
      },
      {
        id: 'degisiklik',
        title: 'Koşullardaki değişiklikler',
        html: `<p>BodyArcade ya da planları değiştiğinde bu koşulları güncelleyebiliriz. Üstteki tarih güncel sürümü gösterir; esaslı bir değişiklik olduğunda bu sayfada neyin değiştiğini söyleriz. Bir değişiklikten sonra oynamaya devam edersen güncel koşullar sana uygulanır.</p>`,
      },
      {
        id: 'iletisim',
        title: 'İletişim',
        html: `<p>Bu koşullarla ilgili sorular: ${mail()}. BodyArcade’ın verilerini nasıl işlediği <a href="/tr/privacy">gizlilik politikasında</a>, sık sorulan soruların yanıtları <a href="/tr/faq">SSS sayfasında</a> var.</p>`,
      },
    ],
  };
}
