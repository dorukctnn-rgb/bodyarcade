// Hesabı ve verileri silme sayfası, Türkçe. delete-account.en.ts ile aynı şeyleri söyler; sayılar facts.ts'ten gelir ve düğmelerin
// adları uygulamanın Türkçe metinleridir (social/strings.ts, core/ui/i18n/tr.ts).
import { mail, ol, table, ul, type PageSpec } from '../chrome.ts';
import * as F from '../facts.ts';

export function deleteAccountTr(): PageSpec {
  const date = F.longDate(F.UPDATED, 'tr');
  return {
    file: 'tr/delete-account.html',
    url: '/tr/delete-account',
    lang: 'tr',
    other: { lang: 'en', url: '/delete-account' },
    title: 'Hesabını ve verilerini sil',
    description: 'BodyArcade çevrimiçi profilini ve sunucularımızdaki verilerini uygulamadan ya da e-postayla nasıl sileceğin; neyin silindiği, neyin neden kaldığı.',
    h1: 'Hesabını ve verilerini sil',
    when: `Son güncelleme: ${date}`,
    lead: `BodyArcade’ı ${F.STUDIO} adıyla çalışan ${F.OWNER} yapar. Bu sayfa bodyarcade.com’u ve BodyArcade Android uygulamasını kapsar. BodyArcade’da yaptığın çevrimiçi profili nasıl sileceğini, bunun neyi ne zaman sildiğini, neyin neden kaldığını anlatır. Nelerin saklandığının tam listesi <a href="/tr/privacy">gizlilik politikasında</a>.`,
    brief: {
      title: 'Kısaca',
      items: [
        '<strong>Profilini uygulamada kendin silersin.</strong> Arkadaşlar, sonra Profilim, sonra Profilimi sil. Profilin sunucularımızda tuttuğu her şey bir anda silinir.',
        '<strong>Önce bir kopya alabilirsin.</strong> Verilerimi indir sana tek bir dosya verir.',
        `<strong>Cihazı mı kaybettin?</strong> Arkadaş kodun ve kurtarma kodunla profili geri getir, sonra sil. Onlar yoksa arkadaş kodunla ${mail()} adresine yaz.`,
        '<strong>Birkaç şey bir süre kalır;</strong> sayfa hangileri olduğunu ve ne kadar süre kaldığını söyler: diğer oyuncuları koruyan bildirimler, güvenlik günlüğü, ödeme kayıtları ve Pro lisans kayıtları.',
        '<strong>Oynamak için profil gerekmez.</strong> Profilin yoksa ayarların ve sonuçların yalnızca cihazındadır.',
      ],
    },
    crumbs: [{ name: 'BodyArcade', url: '/tr/' }, { name: 'Hesabını ve verilerini sil', url: '/tr/delete-account' }],
    sections: [
      {
        id: 'uygulama',
        title: 'Profilini uygulamada sil',
        html: `${ol([
  '<strong>Arkadaşlar</strong>’ı, sonra <strong>Profilim</strong>’i aç.',
  'Verilerin bölümünde, önce bir kopya istersen <strong>Verilerimi indir</strong>’i seç. Profilini, arkadaşlarını, isteklerini, engellerini, haftalık skorlarını ve eşitlenen kayıtlarını, yaptığın ve hakkında yapılan bildirimlerin sayısını ve kabul ettiğin koşulların sürümünü içeren tek bir dosyadır. Dosya cihazına kaydedilir, hiçbir yere gönderilmez.',
  '<strong>Profilimi sil</strong>’i seç. Uygulama &ldquo;Profilin silinsin mi?&rdquo; diye sorar. <strong>Profilimi sil</strong> ile onayla.',
])}
<p>Silmek profili, cihazlarını, arkadaşlarını, isteklerini, engellerini, çevrimiçi durumunu, skorlarını ve eşitlenen kayıtlarını bir anda siler, bağlantılarını kapatır, arkadaşlarının cihazlarına gittiğini bildirir ve profili kullandığın cihazdan kaldırır. Geri alınamaz. Cihazındaki oyunların, ayarların ve sonuçların kalır.</p>
<p>Aynı iki düğme web’de ve Android uygulamasında çalışır; profil askıya alınmış ya da yasaklanmış olsa da çalışır.</p>`,
      },
      {
        id: 'cihaz-yok',
        title: 'Cihazın artık yanında değilse',
        html: `<p>Profili yaptığında uygulama bir kurtarma kodunu bir kez gösterdi. Onu sakladıysan profili herhangi bir tarayıcıda ya da telefonda geri getirebilirsin: Arkadaşlar’ı aç, <strong>Profilimi oluştur</strong>’u, sonra <strong>Zaten profilim var</strong>’ı seç ve arkadaş kodunu ve kurtarma kodunu gir. Sonra profili yukarıdaki gibi sil.</p>
<p>Ne cihazın ne de kurtarma kodun varsa ${mail()} adresine yaz. Konu olarak &ldquo;BodyArcade profilimi sil&rdquo; yaz ve arkadaş kodunu ver (<span class="nw">BA-7K2Q4X</span> gibi görünür). Profili arkadaş koduyla buluruz, bu yüzden o olmadan işlem yapamayız. Kod uygulamanın Arkadaşlar ekranında ve uygulamanın kaydetmeyi önerdiği kurtarma dosyasında durur. Profilin senin olduğunu gösteren bir şey isteyebiliriz. Emin olunca profili uygulamadaki düğmeyle aynı adımlarla sileriz. 30 gün içinde yanıtlarız.</p>
<p>${F.AGE.online} yaşından küçük bir çocuğun çevrimiçi profil yaptığını düşünüyorsan aynı adrese yaz, profili kaldırırız. Kimsenin kullanmadığı bir profil de, çevrimiçi son kullanımından ${F.UNUSED_PROFILE_DAYS} gün sonra kendiliğinden silinir.</p>`,
      },
      {
        id: 'silinen',
        title: 'Ne silinir, ne zaman',
        html: `${table(null, ['Ne', 'İçinde ne var', 'Ne zaman'], [
  ['Profil', 'Arkadaş kodun, görünen adın, yaş grubun, seviyen, bölgen, dilin, çevrimdışı görünme tercihin, varsa susturma ya da askıya alma, kabul ettiğin koşulların sürümü ve kurtarma kodunun özeti (hash).', '<span class="nw">Bir anda</span>'],
  ['Cihazlar', 'Profil adına imza atabilen her cihazın anahtarının açık yarısı.', '<span class="nw">Bir anda</span>'],
  ['Arkadaşlar ve istekler', 'Arkadaşlıkların (iki tarafta da), gönderdiğin ve aldığın istekler ve reddedilen istekler.', '<span class="nw">Bir anda</span>'],
  ['Engeller', 'Engellediğin oyuncular ve diğer oyuncuların sana karşı yaptığı engeller.', '<span class="nw">Bir anda</span>'],
  ['Çevrimiçi durum', 'Çevrimiçi, bir odada ya da bir oyunda olup olmadığın.', '<span class="nw">Bir anda</span>'],
  ['Haftalık skorlar', 'Bu hafta ve önceki hafta için her oyundaki en iyi skorun.', '<span class="nw">Bir anda</span>'],
  ['Eşitlenen kayıtlar', 'İkinci bir cihazın kaldığın yerden devam etmesini sağlayan küçük gün listeleri.', '<span class="nw">Bir anda</span>'],
  ['Bağlantılar', 'Arkadaş hizmetiyle açık bağlantın kapatılır ve arkadaşlarının uygulamalarına gittiğin bildirilir.', '<span class="nw">Bir anda</span>'],
])}
<p>Bu kayıtlar sen onayladığın anda canlı veritabanından kalkar. Onları bizim için saklayan Cloudflare bu depolamanın 30 güne kadar bir kurtarma geçmişini tutar; bu yüzden silinmiş bir kayıt, kalıcı olarak yok olmadan önce bu geçmişte en çok o kadar süre durabilir.</p>`,
      },
      {
        id: 'kalan',
        title: 'Ne kalır, neden',
        html: `${ul([
  `<strong>Bildirimler.</strong> Senin de içinde olduğun bildirimler, biz işledikten sonra en çok ${F.RESOLVED_REPORT_DAYS} gün kalır; çünkü diğer oyuncuları korurlar. Artık var olmayan bir profil hakkındaki bildirim yapıldıktan ${F.ORPHAN_REPORT_DAYS} gün sonra silinir. Senin yaptığın bir bildirim profiline olan bağını kaybeder; nedeni, odayı, isteğe bağlı notunu, bildirdiğin oyuncuyu ve kayıtlı sohbet satırlarını tutar. Hakkındaki bir bildirim görünen adını ve notunu kaybeder; nedeni, odayı, artık kimseye ait olmayan rastgele bir profil numarasını ve kayıtlı sohbet satırlarını tutar. Sohbet satırları odada kullanılan görünen adları ve sözleri yine taşır.`,
  `<strong>Güvenlik günlüğü.</strong> Bir moderatörün ya da otomatik bir kuralın yaptığı şey (susturma, askıya alma, yasaklama) ve nedeni ${F.AUDIT_DAYS} gün tutulur. Hakkındaki bir kayıt adını değil, rastgele profil numarasını ve moderatörün notunu taşır.`,
  `<strong>Odalar.</strong> Bulunduğun bir oda, son oyuncu çıktıktan ${F.ROOM_EMPTY_MINUTES} dakika sonra, her durumda son hareketten ${F.ROOM_IDLE_HOURS} saat sonra sohbeti ve sonuçlarıyla birlikte silinir. Oda listesindeki kaydı, oda güncellenmeyi bıraktıktan ${F.LOBBY_HIDE_MINUTES} dakika sonra gizlenir ve en geç son güncellemesinden ${F.LOBBY_GONE_HOURS} saat sonra kaldırılır.`,
  `<strong>Pro lisans kayıtları.</strong> Pro lisansı profiline bağlı değildir; bu yüzden profili silmek ona dokunmaz ve Pro çalışmaya devam eder. Lisans hizmetimiz lisans anahtarının (ya da Google Play satın alma jetonunun) parmak izini, planı, durumunu ve tarihlerini, her cihaz için de rastgele bir numarayı tutar. Bir cihaz ${F.SEAT_IDLE_DAYS} gün kullanılmazsa yerini geri verir; biten ve hiç cihazı kalmayan bir satın alma, son kontrolünden ${F.FORGET_PURCHASE_DAYS} gün sonra unutulur. Süren bir plan, sürdüğü sürece tutulur. Deneme hatırlatması için bırakılan e-posta adresi, hatırlatma gönderilince ya da deneme bitince ya da plan iptal edilince silinir. Bu kayıtlardan birinin daha erken kaldırılmasını istersen ${mail()} adresine yaz.`,
  '<strong>Ödeme kayıtları.</strong> Ödemeler web’de Gumroad, Android uygulamasında Google Play üzerinden geçer; ikisi de kendi kayıtlarını kendi politikalarına göre tutar. Satıcı olarak biz e-posta adresini ve siparişinin ayrıntılarını alırız ve vergi ve muhasebe yasasının gerektirdiği süre kadar saklarız.',
])}`,
      },
      {
        id: 'abonelik',
        title: 'Abonelikler',
        html: `<p>Profili silmek bir aboneliği iptal etmez. Web’de Gumroad kütüphanenden iptal et (BodyArcade’ı seç, sonra Manage membership). Android uygulamasında Google Play aboneliklerinden iptal et. Pro, ödediğin sürenin sonuna kadar açık kalır. İadeler <a href="/tr/terms">koşullarda</a> anlatılır.</p>`,
      },
      {
        id: 'cihaz',
        title: 'Cihazındaki veriler',
        html: `<p>Ayarların, sonuçların ve hayalet koşuların, profilin olsun olmasın yalnızca cihazında durur. Ayarlar ekranındaki <strong>Bu cihazdaki verileri sil</strong> düğmesi bunları temizler. Çevrimiçi profili silmez; onun için profil ekranının kendi düğmesi vardır. Tarayıcında sitenin verilerini temizlemek profilinin anahtarı dahil cihazdaki her şeyi siler; bu yüzden önce profili sil ya da kurtarma kodunu sakla.</p>`,
      },
      {
        id: 'iletisim',
        title: 'Sorular',
        html: `<p>${mail()} adresine yaz. BodyArcade’ın verileri nasıl işlediği <a href="/tr/privacy">gizlilik politikasında</a>; &ldquo;Seçimlerin ve haklarının&rdquo; bölümü GDPR, Birleşik Krallık GDPR’ı ve Türkiye’deki KVKK kapsamındaki haklarını sıralar.</p>`,
      },
    ],
  };
}
