// Gizlilik politikası, Türkçe. privacy.en.ts ile aynı olguları anlatır; sayılar facts.ts'ten gelir.
// KVKK aydınlatma metninin istediği başlıklar (veri sorumlusu, amaç, aktarım, yöntem ve hukuki sebep, haklar) kendi bölümlerinde.
// Buradaki her cümle 24 Ekim 2026'da kodla karşılaştırıldı (içerik oluşturucunun NOTLAR-content.md dosyasındaki "Doğrulama bulguları").
import { mail, table, ul, type PageSpec } from '../chrome.ts';
import * as F from '../facts.ts';

export function privacyTr(): PageSpec {
  const date = F.longDate(F.UPDATED, 'tr');
  const video = F.RELAY_ON
    ? 'Cihazlarınız birbirine doğrudan ulaşamazsa şifreli görüntü Cloudflare’in işlettiği bir aktarım sunucusundan geçebilir. Aktarım sunucusu veriyi yalnızca iletir, kopyasını tutmaz.'
    : 'Cihazlarınız birbirine doğrudan ulaşamazsa görüntü gösterilmez ve oyun iskeletinle devam eder.';
  const analytics = F.ANALYTICS_ON
    ? '<p>Bu web sitesine yapılan ziyaretleri, sayfa görüntülemelerini ve sayfa hızını sayan Cloudflare Web Analytics ile sayıyoruz. Cloudflare, bunun için çerez ya da yerel depolama kullanmadığını ve ziyaretçilerin parmak izini çıkarmadığını söylüyor.</p>'
    : '<p>Siteye yapılan ziyaretleri hiçbir betikle ölçmüyoruz. Cloudflare, sunduğu istekleri kendi tarafında sayar; örneğin kaç sayfanın hangi ülkelerden istendiğini.</p>';
  return {
    file: 'tr/privacy.html',
    url: '/tr/privacy',
    lang: 'tr',
    other: { lang: 'en', url: '/privacy' },
    title: 'Gizlilik politikası',
    description: 'BodyArcade senin hakkında neyi, nerede ve ne kadar süre saklar: kamera görüntüsü cihazında kalır; çevrimiçi oyunun tuttukları, ödemeler, çocuklar ve haklarının.',
    h1: 'Gizlilik politikası',
    when: `Son güncelleme: ${date}`,
    lead: `BodyArcade, ${F.COMPANY} tarafından yapılır. Bu sayfa, BodyArcade’ın senin hakkında neyi, nerede ve ne kadar süre sakladığını açık bir dille anlatır. bodyarcade.com’u ve BodyArcade Android uygulamasını kapsar. Sorular ve talepler için: ${mail()}.`,
    brief: {
      title: 'Kısaca',
      items: [
        '<strong>Kamera görüntün cihazında kalır.</strong> Görüntü orada vücut noktalarına dönüştürülür; yüklenmez, kaydedilmez, saklanmaz. Tek istisna isteğe bağlıdır: özel bir odada, ikisi de 18 yaşında ya da daha büyük iki arkadaş ikisi de açarsa aralarında canlı görüntü.',
        '<strong>Profil olmadan oynayabilirsin.</strong> Profil yalnızca arkadaşlar, başkalarıyla odalar, herkese açık lobiler ve haftalık sıralamalar için gerekir. Parola ve e-posta adresi yoktur; 13 yaşından küçük oyuncuların çevrimiçi profili olmaz.',
        `<strong>Canlı odalar kendiliğinden temizlenir.</strong> Bir oda, son oyuncu ayrıldıktan ${F.ROOM_EMPTY_MINUTES} dakika sonra, her durumda da son hareketinden ${F.ROOM_IDLE_HOURS} saat sonra; sohbeti ve sonuçlarıyla birlikte silinir.`,
        '<strong>Reklam yok, reklam izleyicisi yok, veri satışı yok.</strong> Ödemeler web’de Gumroad, Android uygulamasında Google Play üzerinden yapılır; kart bilgilerini biz hiç görmeyiz.',
        '<strong>Verin senin: indirebilir ya da silebilirsin.</strong> Uygulamadaki profil ekranı profil verini tek dosya olarak indirir ve hesabını siler.',
      ],
    },
    crumbs: [{ name: 'BodyArcade', url: '/tr/' }, { name: 'Gizlilik politikası', url: '/tr/privacy' }],
    sections: [
      {
        id: 'sorumlu',
        title: 'Veri sorumlusu kim',
        html: `<p>${F.COMPANY}, BodyArcade’ı işletir ve burada anlatılan verilerle ne yapılacağına karar verir. Veri koruma hukukunda bu onu veri sorumlusu yapar: GDPR’daki “data controller” ve 6698 sayılı Kişisel Verilerin Korunması Kanunu’ndaki (KVKK) “veri sorumlusu”. Bize ${mail()} adresinden ulaşabilirsin.</p>`,
      },
      {
        id: 'cihaz',
        title: 'Cihazında kalanlar',
        html: `<p>Bunlar, cihazındaki tarayıcının (ya da Android uygulamasının) depolama alanında tutulur. Sonraki bir bölüm aksini söylemedikçe bize gönderilmez.</p>
${ul([
  'Ayarların: dil, tema, oturarak ve sessiz mod, kamera görünümünün yeri, iskeletin açık ya da kapalı olması, ses, büyük yazı ve azaltılmış hareket.',
  'Girersen vücut ağırlığın. Yalnızca cihazında, kalori tahmini için kullanılır.',
  'Sonuçların: son turlar, en iyi skorlar, oynadığın dakikalar ve serin; bir kez denediğin Pro oyunlar.',
  'Hayalet koşular: bir oyundaki en iyi koşun; yani her engelde ne yaptığın ve kendi koşuların için iskeletinin noktalar olarak çizimi. Görüntü asla.',
  'Pro için: etkinleştirdiğin lisans anahtarı (web), cihazının aldığı imzalı lisans ve cihazlarını saymaya yarayan rastgele bir cihaz numarası.',
  'Deneme hatırlatması için: yazdığın e-posta adresinin maskelenmiş kopyası (örneğin a***@example.com); adresin kendisi değil.',
  'Çevrimiçi profil için: cihazının profil için ürettiği gizli anahtar (tarayıcının, sayfaların okuyamayacağı biçimde sakladığı bir anahtar), sunucumuzun gönderdiği son profil bilgileri ve engellediğin oyuncuların listesi.',
  'Oyunun kendi dosyalarının kopyaları; böylece ağ olmadan açılır. Poz modeli de buna dahildir.',
])}
<p>Ayarlar ekranında bu cihazdaki ayarları ve sonuçları temizleyen bir düğme vardır. Bu düğme çevrimiçi profili silmez; onun için profil ekranının kendi düğmesi vardır. Tarayıcında sitenin verilerini temizlemek yukarıdaki her şeyi, profilinin anahtarı dahil siler; bu yüzden kurtarma kodunu sakla (aşağıya bak).</p>`,
      },
      {
        id: 'kamera',
        title: 'Kameran',
        html: `<p>Kameraya izin verdiğinde tarayıcın görüntüyü cihazında çalışan bir poz modeline verir. Model her kareyi ${F.MODEL_POINTS} vücut noktasına çevirir (baş, omuzlar, dirsekler, bilekler, kalçalar, dizler, ayak bilekleri ve daha fazlası). Oyun, squat, zıplama, yumruk ve diğer hareketleri saymak için bu noktaları okur.</p>
<p>Görüntü ne bizim tarafımızdan ne başkası tarafından yüklenir, kaydedilir ya da saklanır. Kamera bir oyun açıkken çalışır; tarayıcının adres çubuğundan istediğin an kapatabilirsin. Tekrar oynatmalar ve hayalet koşular vücut noktalarından çizilir, hiçbir zaman görüntüden değil.</p>
<p>Poz modeli (Google’ın MediaPipe Pose Landmarker’ı) ve kodu, BodyArcade’ın bodyarcade.com üzerinden kendisinin sunduğu dosyalardır. Tarayıcın bunları yüklemek için Google’a ya da bir kod ağına bağlanmaz. Kütüphane Google’a görüntü içermeyen kısa bir kullanım raporu göndermeye çalışır; BodyArcade bu isteği cihazından çıkmadan durdurur.</p>`,
      },
      {
        id: 'goruntu',
        title: 'Arkadaşlar arasında görüntü (isteğe bağlı)',
        html: `<p>Özel bir odada kamera görüntünü bir arkadaşına gösterip onunkini görmeyi seçebilirsin. Varsayılan olarak kapalıdır ve yalnızca şunların hepsi doğruysa çalışır:</p>
${ul([
  'oda özeldir: davet bağlantısı, kod ya da QR kodla kurulmuştur, herkese açık bir lobi değildir;',
  `odadaki herkes ${F.AGE.video} yaşında ya da daha büyüktür (${F.AGE.video} yaşından küçük oyuncular hiç görüntü paylaşmaz);`,
  'ikiniz de odada kamera paylaşımını açtınız;',
  'hiçbiriniz ötekini engellemedi.',
])}
<p>İkinizden biri bunu istediği an kapatabilir; oda kimin kamera paylaştığını gösterir. Görüntü cihazından arkadaşının cihazına gider ve yolda şifrelidir. Biz onu almayız, kaydetmeyiz, saklamayız; başka kimse de görmez. ${video}</p>
<p>İki cihaz arasındaki doğrudan bağlantı, her cihazın ötekinin ağ (IP) adresini görmesine izin verir. Görüntünün birlikte oynamayı seçtiğin arkadaşlarla sınırlı olmasının bir nedeni de budur. Lütfen bir arkadaşının görüntüsünü kaydetme ya da ekran görüntüsünü alma: uygulama bunu yapmaz, koşullar da senden bunu yapmamanı ister.</p>`,
      },
      {
        id: 'canli',
        title: 'Canlı oyun: odalar, sohbet ve lobiler',
        html: `<p>Bir odada ${F.SEATS.min} ile ${F.SEATS.max} oyuncu bulunur. Odayı davet bağlantısı, ${F.ROOM_CODE_CHARS} karakterli bir kod ya da QR kodla açarsın ya da herkese açık bir lobiye katılırsın. Oda var olduğu sürece sunucusu şunları tutar:</p>
${ul([
  'rastgele bir oyuncu numarası (hiçbir oyuncunun görmediği bir cihaz numarası), görünen adın, yaş grubun ve diğer oyuncuların oyuncu numaran yerine gördüğü bir koltuk numarası;',
  'kimin hazır, kimin çevrimiçi olduğu, oyun ve ayarları, ve odadaki engellediğin oyuncular (karıştırılmış anahtarlar olarak);',
  'turların sonuçları ve skorları;',
  `son ${F.CHAT_KEEP_LINES} sohbet mesajı (her birinde yazanın görünen adıyla) ve odada yapılan bildirimler (hangi koltuktan hangi koltuğa, hangi nedenle ve ne zaman).`,
])}
<p>Bir tur sırasında cihazın diğer oyunculara skorunu ve ${F.SHARED_JOINTS} eklemli bir iskeleti saniyede yaklaşık ${F.SHARE_HZ} kez bildirir: burun, omuzlar, dirsekler, bilekler, kalçalar, dizler ve ayak bilekleri; görüntü yok. Bu veri doğrudan cihazlar arasında ya da onu ileten ama kopyasını tutmayan oda sunucumuz üzerinden gider. İki cihazın birbirini bulmak için değiştirdiği, ağ adresleri içeren bağlantı bilgileri için de aynısı geçerlidir.</p>
<p>Özel bir odada bir turun sonunda her oyuncunun cihazı, diğerlerinin her engelde ne yaptığını görünen adlarıyla birlikte alır. Arkadaşların bunu, daha sonra ona karşı yarışmak üzere bir kayıt olarak saklayabilir. Görüntü ve iskelet içermez. Bir arkadaşına kısa bir kod ya da bağlantı olarak gönderdiğin koşu, görünen adını ve ne yaptığını taşır; başka bir şey taşımaz.</p>
<p>Bir oda, içinde ${F.ROOM_EMPTY_MINUTES} dakika kimse kalmazsa ve her durumda son hareketinden ${F.ROOM_IDLE_HOURS} saat sonra silinir. Bir odanın silinmesi, onun sohbetini, sonuçlarını ve bildirimlerini de siler. İletilmiş bir bildirim, kendisini ilgilendiren sohbet satırlarının kendi kopyasını tutar; ne kadar süre tuttuğunu aşağıdaki tablo söyler.</p>
<p>Oyunu eş zamanlı tutmak için bir odadaki cihazlar birbirine doğrudan bağlanmaya çalışır. Bu, diğer cihazların ağ (IP) adresini görmesine izin verir. Tarayıcın ayrıca bir Cloudflare sunucusuna (STUN) internetin seni hangi adresten gördüğünü sorar; böylece cihazlar birbirini bulabilir. Bunu istemiyorsan bir odaya katılmadan oyna.</p>
<h3>Sohbet</h3>
<p>Yazılı sohbet yalnızca herkesin ${F.AGE.video} yaşında ya da daha büyük olduğu özel odalarda vardır. Süzgeçten geçer (bağlantı, e-posta adresi, telefon numarası, @ ile başlayan adlar ve kaba sözler olmaz), en çok ${F.CHAT_MAX_CHARS} karakter olabilir ve ${F.CHAT_GAP_SECONDS} saniyede bir mesaja izin verir. Diğer herkes hazır mesajları ve tepkileri kullanır.</p>
<h3>Herkese açık lobiler</h3>
<p>Herkese açık bir lobide kendi yaş grubundaki (${F.AGE.online} ile 17 yaş ya da ${F.AGE.video} ve üzeri) oyuncularla, seviyende karşılaşırsın. Onlar rengindeki bir iskeleti ve görünen adını görür, sana hazır mesajlar ve çizilmiş tepkiler gönderebilir. Görüntünü asla görmezler ve senden yazılı metin almazlar.</p>
<h3>Bildir ve engelle</h3>
<p>Bir odada ya da arkadaş listende bir oyuncuyu bildirebilir ya da engelleyebilirsin. Her bildirim, bizim kendimizin okuduğu bir kuyruğa girer; ciddi nedenler (cinsel içerik, ${F.AGE.online} yaşından küçük görünen bir oyuncu) öne alınır. Biz bakana kadar otomatik adımlar diğer oyuncuları korur:</p>
${ul([
  `${F.MUTE_WINDOW_HOURS} saat içinde ${F.REPORTS_TO_MUTE} farklı oyuncu aynı oyuncuyu bildirirse o oyuncunun yazılı metni ${F.MUTE_HOURS} saat susturulur;`,
  `${F.SUSPEND_WINDOW_DAYS} gün içinde ${F.REPORTS_TO_SUSPEND} farklı oyuncu ya da bir gün içinde ciddi bir nedenle ${F.URGENT_REPORTERS_TO_SUSPEND} oyuncu bildirirse herkese açık lobiler o oyuncuya ${F.SUSPEND_DAYS} gün kapanır;`,
  `bu adımlara yalnızca en az ${F.REPORTER_MIN_PROFILE_HOURS} saatlik profillerden gelen bildirimler sayılır.`,
])}
<p>Bunların hepsini bitirebilir ya da uzatabiliriz; bir profili uyarabilir, susturabilir, askıya alabilir ya da yasaklayabiliriz. Bildirdiğin oyuncu, onu kimin bildirdiğini öğrenmez. Otomatik adımları bir insan değil kurallar atar. Birinin yanlış olduğunu düşünüyorsan bize yaz, bir insan ona bakar.</p>`,
      },
      {
        id: 'profil',
        title: 'Çevrimiçi profilin',
        html: `<p>Arkadaşlar, başka insanlarla odalar, herkese açık lobiler ve haftalık sıralamalar için çevrimiçi bir profil gerekir. Uygulama, profili yapmadan önce yaş grubunu bir kez sorar: ${F.AGE.online} yaşından küçük, ${F.AGE.online} ile 17 yaş arası ya da ${F.AGE.video} yaş ve üzeri.</p>
${ul([
  `<strong>${F.AGE.online} yaşından küçük:</strong> çevrimiçi profil yok. ${F.AGE.online} yaşından küçük olduğunu söylersen uygulama sunucularımıza hiçbir şey kaydetmez ve yalnızca kendi cihazında oynarsın.`,
  `<strong>${F.AGE.online} ile 17 yaş arası:</strong> üretilmiş bir görünen ad, yalnızca hazır mesajlar, arkadaşlar yalnızca kod ya da bağlantıyla, herkese açık lobiler yalnızca aynı yaş grubundaki oyuncularla, görüntü yok, yazılı metin yok.`,
  `<strong>${F.AGE.video} yaş ve üzeri:</strong> kendi seçtiğin bir görünen ad (en çok ${F.NAME_MAX_CHARS} karakter, süzgeçten geçer), özel odalarda arkadaşlarla yazılı sohbet ve isteğe bağlı görüntü.`,
])}
<p>Parola ve e-posta adresi yoktur. Cihazın profil için bir anahtar çifti üretir; özel yarısı tarayıcıdan çıkarılamaz ve her isteği imzalar. Kimse seni arayamaz: insanlar seni arkadaş kodunla (BA-7K2Q4X gibi görünür) ya da davet bağlantınla bulur ya da yaş grubundaki herkese açık bir lobide karşılaşır. Arkadaş kodunu istediğin zaman yenileyebilirsin; eskisi çalışmaz olur.</p>
<p>Arkadaşların görünen adını ve çevrimiçi, bir odada, bir oyunda ya da çevrimdışı olup olmadığını görür; oda katılınabilir olduğu sürece odanın kodunu da. Uygulamaları ayrıca yaş grubunu öğrenir, çünkü aranızdaki sohbet ve görüntü buna bağlıdır. Çevrimdışı görünmeyi seçebilirsin.</p>
<p>Bir profilin olduğu sürece her oyunun her haftaki en iyi skoru haftalık sıralamalara gider. Arkadaşların bunu arkadaş sıralamasında görür; ülkendeki ve yaş grubundaki oyuncular da görünen adını ve skorunu ülke sıralamasında görür. Sunucu, bir skorun turun sürdüğü süre içinde mümkün olup olmadığını denetler ama oyunu yeniden oynatamaz; bu yüzden sıralamalarda ödül yoktur.</p>
<p>Profili yaptığında uygulama ${F.RECOVERY_CODE_CHARS} karakterli bir kurtarma kodunu bir kez gösterir. Biz yalnızca onun özetini (hash) sakladığımız için kodu sana yeniden gösteremez ya da senin için kurtaramayız. Kurtarma kodu ve arkadaş kodunla profili yeni bir tarayıcıda ya da telefonda geri getirebilirsin; bir profil aynı anda en çok ${F.PROFILE_DEVICES} cihazda durabilir. Kod, sen yenisini isteyene kadar geçerli kalır; yenisi eskisinin yerine geçer. Örneğin Safari, bir sitenin verilerini yedi gün ziyaret edilmezse silebilir; geri dönüş yolu kurtarma kodudur.</p>`,
      },
      {
        id: 'saklanan',
        title: 'Sunucularımızın sakladıkları ve ne kadar süre',
        html: `<p>Bunların hepsi Cloudflare’in BodyArcade için ayırdığı depolama alanında durur (SQLite’lı Durable Objects). İlk tablo çevrimiçi profildir. İkincisi odalar, lisanslar ve hatırlatmadır.</p>
${table('Çevrimiçi profil', ['Ne', 'Neyi tutar', 'Ne kadar süre'], [
  ['Profil', `Gizli bir profil numarası, arkadaş kodun, görünen adın, yaş grubun, seviyen (cihazının bildirdiği 1 ile ${F.LEVEL_MAX} arasında bir sayı; yalnızca lobilerde kiminle karşılaşacağını belirler), bölgen (bir kıta; senin seçtiğin ya da bağlantından tahmin edilen), dilin, çevrimdışı görünme tercihin, varsa susturma, askıya alma ya da yasak ve bitiş tarihi, profili yaptığın tarih ve en son kullandığın gün.`, `Hesabını silene kadar ya da en son çevrimiçi kullandığından ${F.UNUSED_PROFILE_DAYS} gün sonrasına kadar. Sonra kendiliğinden silinir.`],
  ['Cihazlar ve kurtarma', `Her cihaz için (en çok ${F.PROFILE_DEVICES}): anahtarının açık yarısı, onun kısa bir parmak izi ve eklendiği tarih. Kurtarma kodunun bir özeti (hash).`, 'Profil var olduğu sürece. Altıncı cihaz en eskisinin yerine geçer.'],
  ['Arkadaşlar ve engeller', 'Arkadaşlarının kim olduğu (iki tarafta birer satır) ve kimi engellediğin.', 'Onları çıkarana ya da engeli kaldırana ya da hesabını silene kadar.'],
  ['Arkadaşlık istekleri', 'Kimin kime, ne zaman ve kodla mı bağlantıyla mı sorduğu.', `Yanıtlanmayan istek ${F.REQUEST_DAYS} gün sonra silinir. Reddedilen bir istek göndereni ${F.DECLINE_DAYS} gün dışarıda tutar.`],
  ['Çevrimiçi durumu', 'Çevrimiçi, bir odada, bir oyunda ya da çevrimdışı; oyun; katılınabildiği sürece oda kodu.', `Bir oyuncu, ${F.PRESENCE_MINUTES} dakika sinyal vermezse çevrimdışı sayılır. Kayıt profille birlikte gider.`],
  ['Oda dizini', 'Oyuncusu olan her oda için, herkese açık ya da özel: oda kodu, oyun, seviye bandı, bölge, herkese açık odanın yaş grubu, koltuklar, oyuncuların görünen adları ve asla gösterilmeyen profil numaraları (yalnızca engellenen çiftleri gizlemek için). Yalnızca herkese açık odalar listelenir.', `Oda güncellenmeyi bıraktıktan ${F.LOBBY_HIDE_MINUTES} dakika sonra listeden gizlenir. Oda silinince kaldırılır; her durumda son güncellemeden ${F.LOBBY_GONE_HOURS} saat sonra silinir.`],
  ['Haftalık sıralamalar', 'Oyun ve hafta başına en iyi skorun, ne zaman yaptığın, yaş grubun ve bağlantından alınan iki harfli bir ülke kodu.', `Bu hafta ve önceki hafta (${F.BOARD_WEEKS} hafta). Daha eski satırlar silinir.`],
  ['Eşitlenen kayıtlar', 'İkinci bir cihazın kaldığın yerden devam etmesini sağlayan birkaç küçük gün listesi: etkin sayılacak kadar oynadığın günler, seri için kullanılan dinlenme günleri ve uygulama sunuyorsa günlük meydan okumayı yaptığın ya da bir çalışma planını bitirdiğin günler.', 'Hesabını silene kadar.'],
  ['Bildirimler', `Kimin kimi bildirdiği, neden, isteğe bağlı bir not (yalnızca yetişkinler, en çok ${F.REPORT_NOTE_MAX_CHARS} karakter), tarih, oda, bildirilen oyuncunun adı ve odadan en çok ${F.CHAT_KEEP_LINES} sohbet satırı (içlerinde görünen adlar var).`, `Biz bakana kadar, sonra ${F.RESOLVED_REPORT_DAYS} gün. Artık var olmayan bir profil hakkındaki bildirim, yapıldıktan ${F.ORPHAN_REPORT_DAYS} gün sonra silinir.`],
  ['Güvenlik günlüğü', 'Bir moderatörün ya da otomatik bir kuralın ne yaptığı (susturma, askıya alma, yasaklama) ve nedeni.', `${F.AUDIT_DAYS} gün.`],
  ['Sınır sayaçları', 'İstismarı durdurmak için profil başına ve bir ağ adresinin karıştırılmış biçimi başına (anahtarlı bir özet; adresin kendisi değil) eylem sayıları.', 'Yaklaşık bir gün.'],
])}
${table('Odalar, lisanslar ve hatırlatma', ['Ne', 'Neyi tutar', 'Ne kadar süre'], [
  ['Oda', 'Canlı oyun bölümünde anlatıldığı gibi: oyuncu numarası, görünen ad, yaş grubu, koltuk, hazır olma, sonuçlar, sohbet ve bildirimler.', `Son oyuncu ayrıldıktan ${F.ROOM_EMPTY_MINUTES} dakika sonra, her durumda son hareketten ${F.ROOM_IDLE_HOURS} saat sonra silinir.`],
  ['Pro lisansı', 'Lisans anahtarının ya da Google Play satın alma jetonunun bir parmak izi (SHA-256); anahtarın ya da jetonun kendisi asla. Plan, durumu ve tarihleri; her cihaz için rastgele numarası ve lisansı en son kullandığı gün.', `Kullanılmayan bir cihaz ${F.SEAT_IDLE_DAYS} gün sonra yerini bırakır. Biten ya da iade edilen ve hiç cihazı kalmayan bir satın alma, son kontrolünden ${F.FORGET_PURCHASE_DAYS} gün sonra unutulur. Süren bir plan, sürdüğü kadar tutulur.`],
  ['Deneme hatırlatması', 'Yazdığın e-posta adresi, dili ve gönderim günü.', 'Tek hatırlatma gönderilene kadar. Aşağıya bak.'],
])}
<p>Ağ adresi yalnızca kısa süre kullanılır. Arkadaş hizmetinde sayaçlar adresin kendisiyle değil karıştırılmış biçimiyle tutulur (örneğin bir adresin bir saatte kaç profil yaptığı) ve yaklaşık bir gün içinde silinir. Canlı oyun ve lisans hizmetleri adrese göre tuttukları kısa sayaçları yalnızca bellekte tutar, depolamaya hiç yazmaz; bunlar bir saat içinde ya da hizmet yeniden başlayınca yok olur. Siteyi sunan Cloudflare bunun için ağ adreslerini işler ve kendi işletim günlüklerini kendi politikası uyarınca tutar.</p>
<p>Bir şeyi sildiğinde canlı veritabanından hemen kalkar. Cloudflare bu depolamanın 30 güne kadar bir kurtarma geçmişini tutar; bu yüzden silinmiş bir kayıt, kalıcı olarak yok olmadan önce bu geçmişte en çok o kadar süre durabilir.</p>`,
      },
      {
        id: 'odeme',
        title: 'Ödemeler, Pro ve lisanslar',
        html: `<p><strong>Web’de</strong> Pro’yu Gumroad satar. Gumroad’ın sayfasında ödersin ve Gumroad kayıtlı satıcıdır: KDV’yi ya da satış vergisini o toplar. Kart bilgilerini biz almayız. Satıcı olarak e-posta adresini ve siparişinin ayrıntılarını (ne aldığın, ne zaman ve ne kadara) Gumroad’dan alırız; bunları sorulara yanıt vermek ve iade yapmak için kullanırız. Gumroad sana bir lisans anahtarı e-postalar.</p>
<p>Anahtarı Pro ekranına yapıştırdığında lisans hizmetimize gönderilir; o da Gumroad’a geçerli olup olmadığını sorar. Anahtarın bir parmak izini, planı, tarihleri ve cihazın için rastgele bir numarayı saklarız; böylece cihaz sınırını uygulayabiliriz: Pro ve Ömür boyu için ${F.DEVICES.pro} cihaz${F.FAMILY_PLAN ? `, Aile için ${F.DEVICES.family}` : ''} ve Kurucular için ${F.DEVICES.founder}. Hizmet, en çok ${F.LICENCE_DAYS} gün geçerli imzalı bir lisansla yanıt verir ve uygulama yaklaşık günde bir kez yeniden sorar. Hizmetimize ulaşılamazsa tarayıcın Gumroad’a doğrudan sorabilir; Gumroad bu durumda ağ adresini görür ve böyle yapılan bir kontrol ağ olmadan ${F.DIRECT_GRACE_DAYS} gün geçerlidir.</p>
<p><strong>Android uygulamasında</strong> ödemeyi ödeme verilerini işleyen Google Play üzerinden yaparsın. Uygulama, Google’ın verdiği satın alma jetonunu lisans hizmetimize gönderir; o da jetonu Google’la doğrular. Jetonun yalnızca bir parmak izini saklarız.</p>`,
      },
      {
        id: 'hatirlatma',
        title: 'Deneme hatırlatma e-postası',
        html: `<p>Pro yıllık planının ${F.TRIAL_DAYS} günlük denemesinde web’de isteğe bağlı bir e-posta hatırlatması vardır. Pro ekranına bir adres yazarsan adres, imzalı lisansınla birlikte sunucumuza gider. Onu, kullandığın dil ve gönderim günüyle birlikte, tek hatırlatma gönderilene kadar, yani deneme bitmeden ${F.REMINDER_DAYS} gün öncesine kadar saklarız. Sonra sileriz.</p>
<p>Hiçbir şey göndermeden de sileriz: uygulamada adresi geri alırsan, kayıtlarımız planın o günden önce iptal edildiğini ya da iade edildiğini gösterirse, deneme bittiğinde ya da ${F.REMINDER_TRIES} başarısız gönderimden sonra. E-posta düz metindir ve izleme içermez. Adresi başka hiçbir şey için kullanmaz ve ona bir daha yazmayız. E-posta, posta sağlayıcımız Forward Email üzerinden gönderilir.</p>
<p>Android uygulamasında adres istemeyiz. Google Play kendi hatırlatmasını gönderir; uygulama da denemenin son ${F.REMINDER_DAYS} gününde her açılışta bir bildirim gösterir.</p>`,
      },
      {
        id: 'analitik',
        title: 'Analitik, çerezler ve günlükler',
        html: `<p>BodyArcade’da reklam izleyicisi ve bizim kendi analitik kodumuz yoktur. Kendi kodu çerez koymaz; yukarıda sıralanan şeyler için tarayıcının depolama alanını kullanır. Siteyi sunan Cloudflare, insanları otomatik trafikten ayırmak için bir güvenlik çerezi koyabilir; Gumroad’ın sayfaları da kendi çerezlerini koyar.</p>
${analytics}
<p>Kendi kodumuz hizmetin günlüklerine kısa teknik satırlar yazar: olay adları, oda kodları, sayılar, bir lisans parmak izinin ilk sekiz karakteri ve hata iletileri. Bunlarda görünen ad, mesaj, görüntü ve ağ adresi olmaz. Tarayıcı güvenlik raporları (bir tarayıcının hangi dosyayı yüklemeyi reddettiği) aynı biçimde günlüğe yazılır. Cloudflare ayrıca hizmet için kendi politikası uyarınca istek günlükleri tutar.</p>`,
      },
      {
        id: 'baskalari',
        title: 'Verileri başka kimler işler',
        html: `${ul([
  'Cloudflare siteyi sunar; odaları, profilleri ve lisansları bizim için saklar. STUN hizmeti cihazların birbirini bulmasına yardım eder.' + (F.RELAY_ON ? ' Aktarım hizmeti arkadaş görüntüsünü taşıyabilir.' : '') + ' <a href="https://www.cloudflare.com/privacypolicy/" rel="noopener">Gizlilik politikası</a>.',
  'Gumroad, Pro’yu web’de satar, ödemeyi alır, vergiyi halleder ve lisans anahtarlarını doğrular. <a href="https://gumroad.com/privacy" rel="noopener">Gizlilik politikası</a>.',
  'Google, Android uygulamasında ödemeleri alan ve uygulamayı dağıtan Google Play’i ve adresimizin arkasındaki posta kutusunu işletir. Poz modeli Google’ın teknolojisidir ama cihazında çalışır. <a href="https://policies.google.com/privacy" rel="noopener">Gizlilik politikası</a>.',
  'Forward Email, adresimize gelen postayı iletir ve deneme hatırlatmasını gönderir. <a href="https://forwardemail.net/en/privacy" rel="noopener">Gizlilik politikası</a>.',
])}
<p>Verini satmıyoruz ve reklamverenlerle paylaşmıyoruz. Bize e-posta yazarsan adresini ve mesajını alırız; yalnızca sana yanıt vermek için kullanırız.</p>
<p>Bu şirketler veriyi ülken dışında, Avrupa Ekonomik Alanı, Birleşik Krallık ve Türkiye dışında da işleyebilir. Öyle yaptıklarında, standart sözleşme maddeleri gibi güvenceler içeren kendi veri koruma şartlarına dayanırlar. Politikaları bunun nasıl olduğunu anlatır. Kişisel verilerin yurt dışına aktarımı bakımından bu, 6698 sayılı Kanun’un 9. maddesi kapsamındadır.</p>`,
      },
      {
        id: 'haklar',
        title: 'Seçimlerin ve haklarının',
        html: `<p><strong>Uygulamada.</strong> Profil ekranında iki düğme vardır. Biri profil verini tek bir dosya olarak indirir: profilin, arkadaşların, isteklerin, engellerin, haftalık skorların ve eşitlenen kayıtların ile yaptığın ve hakkında yapılan bildirimlerin sayısı. Öteki hesabını siler. Silmek profili, cihazlarını, arkadaşlarını, isteklerini, engellerini, çevrimiçi durumunu, skorlarını ve eşitlenen kayıtlarını bir anda siler, bağlantılarını kapatır ve arkadaşlarının cihazlarına gittiğini bildirir.</p>
<p>Kalanlar: senin de içinde olduğun bildirimler, biz işledikten sonra en çok ${F.RESOLVED_REPORT_DAYS} gün kalır (artık var olmayan bir profil hakkındaki bildirim yapıldıktan ${F.ORPHAN_REPORT_DAYS} gün sonra silinir); çünkü diğer oyuncuları korurlar. Senin yaptığın bir bildirim profiline olan bağını kaybeder. Hakkındaki bir bildirim görünen adını ve notunu kaybeder ama nedeni, odayı, artık kimseye ait olmayan rastgele bir profil numarasını ve kayıtlı sohbet satırlarını tutar; sohbet satırları odada kullanılan görünen adları ve sözleri yine taşır. Bulunduğun odalar kendi takvimleriyle kaybolur (yukarıya bak).</p>
<p><strong>E-postayla.</strong> Aşağıdakilerden herhangi birini istemek için, dosyanın içermediği bir şey için ya da uygulamayı kullanamıyorsan ${mail()} adresine yaz. Profilin sana ait olduğunu gösteren bir şey isteyebiliriz. Bir ay içinde (KVKK kapsamında en geç 30 gün içinde) yanıtlarız. Başvuru ücretsizdir; işlem ayrıca bir maliyet gerektiriyorsa Kişisel Verileri Koruma Kurulu’nun belirlediği tarifedeki ücret alınabilir.</p>
<p>GDPR ya da Birleşik Krallık GDPR’ı sana uygulanıyorsa verilerine erişme, düzeltilmesini ya da silinmesini isteme, kullanımını kısıtlama ya da buna itiraz etme, onları taşınabilir biçimde alma ve verdiğin bir rızayı geri çekme hakkın vardır. Veri koruma otoritene, örneğin Birleşik Krallık’ta Information Commissioner’s Office’e ya da Türkiye’de Kişisel Verileri Koruma Kurulu’na şikâyet edebilirsin. Başka bir gizlilik yasasının sana hak verdiği bir yerde yaşıyorsan, örneğin Kaliforniya’da, aynı talepler geçerlidir: bize yaz.</p>
<h3>KVKK madde 11 kapsamındaki haklarının</h3>
<p>Veri sorumlusuna başvurarak şunları yapabilirsin:</p>
${ul([
  'kişisel verilerinin işlenip işlenmediğini öğrenmek ve işlenmişse bilgi istemek;',
  'işlenme amacını ve amacına uygun kullanılıp kullanılmadığını öğrenmek;',
  'yurt içinde ya da yurt dışında aktarıldığı üçüncü kişileri bilmek;',
  'eksik ya da yanlış işlenmişse düzeltilmesini, Kanun’daki şartlar çerçevesinde silinmesini ya da yok edilmesini istemek ve bunların aktarıldığı üçüncü kişilere bildirilmesini istemek;',
  'işlenen verilerin yalnızca otomatik sistemlerle analiz edilmesi sonucu aleyhine bir sonuç çıkmasına itiraz etmek;',
  'kanuna aykırı işleme nedeniyle zarara uğraman hâlinde zararın giderilmesini talep etmek.',
])}
<h3>Verileri neden işleriz</h3>
<p>Verileri, uygulamayı kullanırken cihazından otomatik yollarla ve senin yazdıklarından toplarız. Şu amaçlarla ve şu hukuki sebeplerle işleriz:</p>
${ul([
  'İstediğin hizmeti sağlamak için: oyun, profilin, odalar, lisansın ve sipariş ettiğin hatırlatma. (Sözleşme; KVKK madde 5/2-c.)',
  'Rızanla: tarayıcının sorduğu kamera izni, isteğe bağlı arkadaş görüntüsü ve hatırlatma e-postası. Rızanı istediğin an geri çekebilirsin. (Açık rıza; KVKK madde 5/1.)',
  'Hizmeti güvenli ve adil tutmak için: istismara karşı sınırlar, bildirimler, güvenlik günlüğü ve haftalık skorların denetimi. (Meşru menfaat; KVKK madde 5/2-f.)',
  'Vergi ve muhasebe için sipariş kayıtlarını yasanın gerektirdiği süre boyunca tutmak gibi yasal yükümlülükleri yerine getirmek için. (Hukuki yükümlülük; KVKK madde 5/2-ç.)',
])}`,
      },
      {
        id: 'cocuklar',
        title: 'Çocuklar ve gençler',
        html: `<p>Aileler BodyArcade oynayabilir. Çevrimiçi özellikler ${F.AGE.online} yaş ve üzeri oyuncular içindir; ${F.AGE.video} yaşına kadar sınırlarla:</p>
${ul([
  `${F.AGE.online} yaşından küçük: çevrimiçi profil yok ve sunucularımıza hiçbir şey kaydedilmez. Arkadaşlar, odalar, lobiler ve sıralamalar yoktur. Oyunlar cihazda çalışır.`,
  `${F.AGE.online} ile 17 yaş arası: üretilmiş bir ad, hazır mesajlar, arkadaşlar yalnızca kod ya da bağlantıyla, herkese açık lobiler yalnızca aynı yaş grubundaki oyuncularla, görüntü yok, yazılı metin yok. ${F.AGE.video} yaş ve üzeri biri, ${F.AGE.video} yaşından küçük bir oyuncuya arkadaşlık isteği gönderemez; isteği genç oyuncu gönderir.`,
  `${F.AGE.video} yaş ve üzeri: özel odalarda arkadaşlarla yazılı sohbet ve isteğe bağlı görüntü.`,
])}
<p>Yaş, senin söylediğin yaştır; uygulama bunu doğrulayamaz. Gumroad ve Google Play’in satın alma için kendi yaş kuralları vardır; bu yüzden satın alma bir yetişkine aittir ya da bir ebeveyn tarafından yapılır. Yaş grubunu sonradan düşürebilirsin ama yükseltemezsin: yeni bir profil baştan başlar.</p>
${F.FAMILY_PLAN ? `<p>Aile planı, bir cihazı paylaşan ${F.FAMILY_PROFILES} kişiye kendi sonuçlarını tutma imkânı verir. Bu profiller yalnızca o cihazda saklanır. Yalnızca ilk profil, yani sahibinin profili, çevrimiçi bir profile sahip olabilir; bir çocuğun profili sunucularımıza hiçbir şey kaydetmez.</p>` : ''}
<p>${F.AGE.online} yaşından küçük bir çocuğun çevrimiçi profil yaptığını düşünüyorsan ${mail()} adresine yaz, onu kaldıralım.</p>`,
      },
      {
        id: 'guvenlik',
        title: 'Güvenlik',
        html: `<p>Bütün trafik HTTPS kullanır. Bir profil isteklerini cihazda kalan bir anahtarla imzalar. Lisans anahtarları ve satın alma jetonları yalnızca özet olarak saklanır. Bildirimleri okuyan ve onlara işlem yapan araçlar yalnızca bizde bulunan gizli bir jeton ister. Hiçbir sistem tamamen güvenli değildir. Verini riske atan bir şey olursa bunu yetkililere bildirir ve yasanın gerektirdiği şekilde etkilenenleri bilgilendiririz.</p>`,
      },
      {
        id: 'degisiklik',
        title: 'Değişiklikler ve iletişim',
        html: `<p>BodyArcade’ın verileri ele alış biçimi değiştiğinde bu sayfayı ve üstündeki tarihi değiştiririz. Ayrıca <a href="/tr/terms">kullanım koşullarına</a> ve <a href="/tr/faq">sık sorulan sorulara</a> bak.</p>
<p>${F.COMPANY}, ${mail()}.</p>`,
      },
    ],
  };
}
