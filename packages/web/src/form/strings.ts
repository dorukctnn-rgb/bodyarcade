// Words of the form coach page in the site's five languages. The coach (packages/core/form) gives codes only; this table
// turns them into sentences. Cues are short (read from 2-3 m away, one at a time). "Form tips" wording only: no health claims.
// Faz 1's moves are written here; the standing moves of Faz 3 are in strings-standing.ts and merged below.
import type { Lang } from '../../../core/ui/i18n/index.ts';
import type { FormMoveId } from '../../../core/form/types.ts';
import { STANDING_WORDS, type StandingUiKey } from './strings-standing.ts';
import { en as en45, tr as tr45, type Faz45UiKey, type Faz45Words } from './strings-faz45.ts';
import { de as de45, es as es45, fr as fr45 } from './strings-faz45-more.ts';

export interface MoveWords { name: string; setup: string; looks: string[]; cannot: string[] }

type BaseUiKey =
  | 'title' | 'formCount' | 'start' | 'stop' | 'finish' | 'again' | 'reps' | 'clean' | 'privacy' | 'looks' | 'cannot' | 'sound' | 'voice'
  | 'loading' | 'cameraError' | 'summaryTitle' | 'summaryLine' | 'topError' | 'allClean' | 'noReps' | 'notChecked' | 'tipsNote'
  | 'ready' | 'person' | 'parts' | 'closer' | 'farther' | 'lieDown' | 'wantFront' | 'wantSide' | 'wantDiag' | 'legend'
  | 'legendOk' | 'legendTip' | 'legendBad' | 'legendUnknown';

type Faz1MoveId = 'squat' | 'pushUp' | 'gluteBridge' | 'dbShoulderPress';

interface BaseWords {
  ui: Record<BaseUiKey, string>;
  parts: Record<'head' | 'shoulders' | 'elbows' | 'hands' | 'hips' | 'knees' | 'feet', string>;
  moves: Record<Faz1MoveId, MoveWords>;
  cues: Record<string, string>;
  rules: Record<string, string>;
}

export interface FormWords {
  ui: Record<BaseUiKey | StandingUiKey | Faz45UiKey, string>;
  parts: BaseWords['parts'];
  moves: Record<FormMoveId, MoveWords>;
  cues: Record<string, string>;
  /** What went wrong, as a short phrase for the set summary ("most often: knees caved in"). */
  rules: Record<string, string>;
}

const tr: BaseWords = {
  ui: {
    title: 'Form koçu', formCount: 'Form + sayaç', start: 'Kamerayı aç', stop: 'Kamerayı kapat', finish: 'Seti bitir', again: 'Yeni set',
    reps: 'Tekrar', clean: 'Temiz', privacy: 'Kamera görüntüsü cihazından çıkmaz.', looks: 'Neye bakıyoruz', cannot: 'Bakamadığımız', sound: 'Tekrar sesi', voice: 'Sesli ipucu',
    loading: 'Kamera ve hareket modeli yükleniyor…', cameraError: 'Kamera açılamadı. İzni ve kamerayı kontrol et.', summaryTitle: 'Set özeti',
    summaryLine: '{reps} tekrar, {clean} temiz', topError: 'En sık: {what} ({n} tekrarda)', allClean: 'Bütün tekrarlar temiz.', noReps: 'Bu sette tekrar sayılmadı.',
    notChecked: 'Bu hareket henüz gerçek videoda ölçülmedi; ipuçları deneme aşamasında.', tipsNote: 'Bunlar form ipuçlarıdır.',
    ready: 'Hazırsın, başlayabilirsin.', person: 'Kameranın önüne geç.', parts: 'Görünmesi gereken: {parts}', closer: 'Biraz yaklaş.', farther: 'Biraz uzaklaş, tüm vücudun görünsün.',
    lieDown: 'Yere uzan: omuzların ve ayakların kadrajda olsun.', wantFront: 'Kameraya dön.', wantSide: 'Yana dön: kamera yanında olsun.', wantDiag: 'Kameraya hafif çapraz dur.',
    legend: 'Çizgi', legendOk: 'doğru', legendTip: 'ipucu', legendBad: 'düzelt', legendUnknown: 'ölçülemiyor',
  },
  parts: { head: 'baş', shoulders: 'omuzlar', elbows: 'dirsekler', hands: 'eller', hips: 'kalça', knees: 'dizler', feet: 'ayaklar' },
  moves: {
    squat: { name: 'Squat', setup: 'Telefonu kalça hizasında, 2-3 metre öne koy. Önden ya da hafif çapraz dur; yandan da olur.', looks: ['Derinlik: uyluklar yere paralele yakın', 'Önden: dizlerin içe kayması', 'Önden: ağırlığın bir yana kayması', 'Yandan: gövdenin fazla öne eğilmesi', 'Tempo'], cannot: ['Topuğun kalkması', 'Belin yuvarlanması'] },
    pushUp: { name: 'Şınav', setup: 'Telefonu yere, 2 metre yana koy; vücudun yandan, baştan ayağa görünsün.', looks: ['Göğsün yeterince inmesi', 'Vücut çizgisi: kalçanın sarkması ya da yukarıda kalması', 'Ellerin omuz altında olması', 'Tempo'], cannot: ['Dirseklerin yana açılması (yandan görülmez)', 'Baş ve boyun'] },
    gluteBridge: { name: 'Glute bridge', setup: 'Telefonu yere, 2 metre yana koy. Sırtüstü uzan, dizlerin bükülü, ayakların yerde.', looks: ['Kalçanın tam kalkması', 'Fazla kavis', 'Ayakların yeri'], cannot: ['Dizlerin içe ya da dışa açılması', 'Kalçayı sıkman'] },
    dbShoulderPress: { name: 'Dambıl omuz presi', setup: 'Telefonu önüne, 1,5-2,5 metreye koy; baştan kalçaya görün. Ayakta ya da oturarak.', looks: ['Kolların tam yukarı çıkması', 'İki kolun birlikte gitmesi', 'Dirseklerin bileklerin altında olması', 'Gövdenin yana eğilmemesi'], cannot: ['Belin geriye kavislenmesi (önden görülmez)', 'Omuz silkme'] },
  },
  cues: {
    'squat.deeper': 'Biraz daha derin otur', 'squat.kneesOut': 'Dizlerini ayak uçlarınla aynı yöne it', 'squat.even': 'Ağırlığını iki ayağına eşit ver', 'squat.chestUp': 'Göğsünü dik tut',
    'squat.standTall': 'Tam ayağa kalk, sonra tekrar in', 'tempo.slower': 'Daha yavaş in',
    'pushUp.lower': 'Göğsünü biraz daha aşağı indir', 'pushUp.hipsUp': 'Kalçanı kaldır, vücudun düz bir çizgi olsun', 'pushUp.hipsDown': 'Kalçanı biraz indir', 'pushUp.handsUnder': 'Ellerini omuzlarının altına koy', 'pushUp.armsStraight': 'Kollarını tam aç, sonra tekrar in',
    'bridge.higher': 'Kalçanı biraz daha kaldır', 'bridge.ribsDown': 'Kaburgalarını indir, beli fazla bükme', 'bridge.feetCloser': 'Ayaklarını kalçana biraz yaklaştır', 'bridge.feetFarther': 'Ayaklarını biraz uzaklaştır', 'bridge.lowerFully': 'Kalçanı yere indir, sonra tekrar kaldır',
    'press.higher': 'Dambılları tam yukarı it', 'press.together': 'İki kolu birlikte it', 'press.straighten': 'Yukarıda kollarını tam aç', 'press.elbowsUnder': 'Dirseklerini bileklerinin altında tut', 'press.stayUpright': 'Gövdeni dik tut', 'press.lowerToShoulders': 'Dambılları omuz hizasına kadar indir',
  },
  rules: {
    'squat.depth': 'derinlik yetmedi', 'squat.kneesIn': 'dizler içe kaydı', 'squat.shift': 'ağırlık bir yana kaydı', 'squat.chest': 'gövde fazla öne eğildi', 'squat.tempo': 'iniş çok hızlıydı',
    'pushUp.depth': 'göğüs yeterince inmedi', 'pushUp.line': 'vücut çizgisi bozuldu', 'pushUp.hands': 'eller omuzların önündeydi', 'pushUp.tempo': 'iniş çok hızlıydı',
    'bridge.height': 'kalça tam kalkmadı', 'bridge.arch': 'bel fazla büküldü', 'bridge.feet': 'ayaklar yanlış yerdeydi',
    'press.top': 'kollar tam yukarı çıkmadı', 'press.together': 'bir kol geride kaldı', 'press.lockout': 'kollar yukarıda tam açılmadı', 'press.stack': 'dirsekler bileklerin altında değildi', 'press.upright': 'gövde yana eğildi',
  },
};

const en: BaseWords = {
  ui: {
    title: 'Form coach', formCount: 'Form + count', start: 'Turn on the camera', stop: 'Turn off the camera', finish: 'End the set', again: 'New set',
    reps: 'Reps', clean: 'Clean', privacy: 'The camera picture never leaves your device.', looks: 'What we check', cannot: 'What we cannot check', sound: 'Rep sound', voice: 'Spoken tips',
    loading: 'Loading the camera and the movement model…', cameraError: 'The camera did not start. Check the permission and the camera.', summaryTitle: 'Set summary',
    summaryLine: '{reps} reps, {clean} clean', topError: 'Most often: {what} ({n} reps)', allClean: 'Every rep was clean.', noReps: 'No reps were counted in this set.',
    notChecked: 'This move has not been measured on real video yet; its tips are a trial.', tipsNote: 'These are form tips.',
    ready: 'You are set. Start when you like.', person: 'Step in front of the camera.', parts: 'Needs to be in view: {parts}', closer: 'Come a little closer.', farther: 'Step back a little so your whole body shows.',
    lieDown: 'Lie down: shoulders and feet in the picture.', wantFront: 'Face the camera.', wantSide: 'Turn sideways: the camera at your side.', wantDiag: 'Stand slightly angled to the camera.',
    legend: 'Line', legendOk: 'good', legendTip: 'tip', legendBad: 'fix', legendUnknown: 'not measured',
  },
  parts: { head: 'head', shoulders: 'shoulders', elbows: 'elbows', hands: 'hands', hips: 'hips', knees: 'knees', feet: 'feet' },
  moves: {
    squat: { name: 'Squat', setup: 'Put the phone at hip height, 2-3 metres in front of you. Face it or stand slightly angled; from the side works too.', looks: ['Depth: thighs close to level', 'From the front: knees caving in', 'From the front: weight shifting to one side', 'From the side: leaning too far forward', 'Tempo'], cannot: ['Heels lifting', 'A rounding back'] },
    pushUp: { name: 'Push-up', setup: 'Put the phone on the floor, 2 metres to your side, so it sees you head to feet from the side.', looks: ['Chest low enough', 'Body line: hips sagging or piked up', 'Hands under the shoulders', 'Tempo'], cannot: ['Elbows flaring out (not visible from the side)', 'Head and neck'] },
    gluteBridge: { name: 'Glute bridge', setup: 'Put the phone on the floor, 2 metres to your side. Lie on your back, knees bent, feet on the floor.', looks: ['Hips all the way up', 'Arching too much', 'Where the feet are'], cannot: ['Knees falling in or out', 'Squeezing the glutes'] },
    dbShoulderPress: { name: 'Dumbbell shoulder press', setup: 'Put the phone in front of you, 1.5-2.5 metres away, showing you from head to hips. Standing or seated.', looks: ['Arms all the way up', 'Both arms together', 'Elbows under the wrists', 'No sideways lean'], cannot: ['Lower back arching (not visible from the front)', 'Shrugging'] },
  },
  cues: {
    'squat.deeper': 'Sit a little deeper', 'squat.kneesOut': 'Push your knees out over your toes', 'squat.even': 'Keep your weight on both feet', 'squat.chestUp': 'Keep your chest up',
    'squat.standTall': 'Stand all the way up, then go down again', 'tempo.slower': 'Go down slower',
    'pushUp.lower': 'Lower your chest a little more', 'pushUp.hipsUp': 'Lift your hips: one straight line', 'pushUp.hipsDown': 'Bring your hips down a little', 'pushUp.handsUnder': 'Hands under your shoulders', 'pushUp.armsStraight': 'Straighten your arms, then go down again',
    'bridge.higher': 'Lift your hips a little higher', 'bridge.ribsDown': 'Ribs down, do not over-arch', 'bridge.feetCloser': 'Bring your feet a little closer', 'bridge.feetFarther': 'Move your feet a little farther', 'bridge.lowerFully': 'Lower your hips to the floor, then lift again',
    'press.higher': 'Press the dumbbells all the way up', 'press.together': 'Press both arms together', 'press.straighten': 'Straighten your arms at the top', 'press.elbowsUnder': 'Elbows under your wrists', 'press.stayUpright': 'Keep your body upright', 'press.lowerToShoulders': 'Lower the dumbbells to your shoulders',
  },
  rules: {
    'squat.depth': 'not deep enough', 'squat.kneesIn': 'knees caved in', 'squat.shift': 'weight shifted to one side', 'squat.chest': 'leaned too far forward', 'squat.tempo': 'went down too fast',
    'pushUp.depth': 'chest not low enough', 'pushUp.line': 'body line broke', 'pushUp.hands': 'hands ahead of the shoulders', 'pushUp.tempo': 'went down too fast',
    'bridge.height': 'hips not all the way up', 'bridge.arch': 'arched too much', 'bridge.feet': 'feet in the wrong place',
    'press.top': 'arms not all the way up', 'press.together': 'one arm lagged', 'press.lockout': 'arms not straight at the top', 'press.stack': 'elbows not under the wrists', 'press.upright': 'leaned to one side',
  },
};

const de: BaseWords = {
  ui: {
    title: 'Form-Coach', formCount: 'Form + Zähler', start: 'Kamera einschalten', stop: 'Kamera ausschalten', finish: 'Satz beenden', again: 'Neuer Satz',
    reps: 'Wdh.', clean: 'Sauber', privacy: 'Das Kamerabild verlässt dein Gerät nie.', looks: 'Was wir prüfen', cannot: 'Was wir nicht prüfen können', sound: 'Ton pro Wiederholung', voice: 'Gesprochene Tipps',
    loading: 'Kamera und Bewegungsmodell werden geladen…', cameraError: 'Die Kamera ist nicht gestartet. Prüfe die Berechtigung und die Kamera.', summaryTitle: 'Satz-Übersicht',
    summaryLine: '{reps} Wiederholungen, {clean} sauber', topError: 'Am häufigsten: {what} ({n} Wdh.)', allClean: 'Alle Wiederholungen waren sauber.', noReps: 'In diesem Satz wurde keine Wiederholung gezählt.',
    notChecked: 'Diese Übung wurde noch nicht an echten Videos gemessen; die Tipps sind ein Test.', tipsNote: 'Das sind Form-Tipps.',
    ready: 'Alles bereit. Leg los, wenn du willst.', person: 'Stell dich vor die Kamera.', parts: 'Muss im Bild sein: {parts}', closer: 'Komm etwas näher.', farther: 'Geh etwas zurück, damit du ganz zu sehen bist.',
    lieDown: 'Leg dich hin: Schultern und Füße im Bild.', wantFront: 'Schau zur Kamera.', wantSide: 'Dreh dich seitlich: die Kamera neben dir.', wantDiag: 'Stell dich leicht schräg zur Kamera.',
    legend: 'Linie', legendOk: 'gut', legendTip: 'Tipp', legendBad: 'korrigieren', legendUnknown: 'nicht messbar',
  },
  parts: { head: 'Kopf', shoulders: 'Schultern', elbows: 'Ellbogen', hands: 'Hände', hips: 'Hüfte', knees: 'Knie', feet: 'Füße' },
  moves: {
    squat: { name: 'Kniebeuge', setup: 'Stell das Handy auf Hüfthöhe, 2-3 Meter vor dich. Schau zur Kamera oder steh leicht schräg; von der Seite geht auch.', looks: ['Tiefe: Oberschenkel fast waagerecht', 'Von vorn: Knie fallen nach innen', 'Von vorn: Gewicht auf einer Seite', 'Von der Seite: zu weit nach vorn gelehnt', 'Tempo'], cannot: ['Fersen heben ab', 'Runder Rücken'] },
    pushUp: { name: 'Liegestütz', setup: 'Leg das Handy auf den Boden, 2 Meter neben dich, sodass es dich von der Seite von Kopf bis Fuß sieht.', looks: ['Brust tief genug', 'Körperlinie: Hüfte hängt durch oder ist zu hoch', 'Hände unter den Schultern', 'Tempo'], cannot: ['Ellbogen nach außen (von der Seite nicht sichtbar)', 'Kopf und Nacken'] },
    gluteBridge: { name: 'Glute Bridge', setup: 'Leg das Handy auf den Boden, 2 Meter neben dich. Leg dich auf den Rücken, Knie gebeugt, Füße am Boden.', looks: ['Hüfte ganz oben', 'Zu starkes Hohlkreuz', 'Position der Füße'], cannot: ['Knie fallen nach innen oder außen', 'Gesäß anspannen'] },
    dbShoulderPress: { name: 'Kurzhantel-Schulterdrücken', setup: 'Stell das Handy vor dich, 1,5-2,5 Meter entfernt, von Kopf bis Hüfte im Bild. Stehend oder sitzend.', looks: ['Arme ganz nach oben', 'Beide Arme gleichzeitig', 'Ellbogen unter den Handgelenken', 'Keine Seitneigung'], cannot: ['Hohlkreuz (von vorn nicht sichtbar)', 'Schultern hochziehen'] },
  },
  cues: {
    'squat.deeper': 'Etwas tiefer gehen', 'squat.kneesOut': 'Knie nach außen über die Zehen', 'squat.even': 'Gewicht auf beide Füße', 'squat.chestUp': 'Brust aufrecht',
    'squat.standTall': 'Ganz aufrichten, dann wieder runter', 'tempo.slower': 'Langsamer runter',
    'pushUp.lower': 'Brust etwas tiefer', 'pushUp.hipsUp': 'Hüfte hoch: eine gerade Linie', 'pushUp.hipsDown': 'Hüfte etwas senken', 'pushUp.handsUnder': 'Hände unter die Schultern', 'pushUp.armsStraight': 'Arme ganz strecken, dann wieder runter',
    'bridge.higher': 'Hüfte etwas höher', 'bridge.ribsDown': 'Rippen runter, kein Hohlkreuz', 'bridge.feetCloser': 'Füße etwas näher heran', 'bridge.feetFarther': 'Füße etwas weiter weg', 'bridge.lowerFully': 'Hüfte ablegen, dann wieder heben',
    'press.higher': 'Hanteln ganz nach oben drücken', 'press.together': 'Beide Arme gleichzeitig', 'press.straighten': 'Oben die Arme strecken', 'press.elbowsUnder': 'Ellbogen unter die Handgelenke', 'press.stayUpright': 'Oberkörper aufrecht', 'press.lowerToShoulders': 'Hanteln bis zu den Schultern senken',
  },
  rules: {
    'squat.depth': 'nicht tief genug', 'squat.kneesIn': 'Knie nach innen', 'squat.shift': 'Gewicht auf einer Seite', 'squat.chest': 'zu weit nach vorn gelehnt', 'squat.tempo': 'zu schnell runter',
    'pushUp.depth': 'Brust nicht tief genug', 'pushUp.line': 'Körperlinie gebrochen', 'pushUp.hands': 'Hände vor den Schultern', 'pushUp.tempo': 'zu schnell runter',
    'bridge.height': 'Hüfte nicht ganz oben', 'bridge.arch': 'zu starkes Hohlkreuz', 'bridge.feet': 'Füße falsch platziert',
    'press.top': 'Arme nicht ganz oben', 'press.together': 'ein Arm hing nach', 'press.lockout': 'Arme oben nicht gestreckt', 'press.stack': 'Ellbogen nicht unter den Handgelenken', 'press.upright': 'zur Seite geneigt',
  },
};

const es: BaseWords = {
  ui: {
    title: 'Entrenador de técnica', formCount: 'Técnica + conteo', start: 'Activar la cámara', stop: 'Apagar la cámara', finish: 'Terminar la serie', again: 'Nueva serie',
    reps: 'Reps', clean: 'Limpias', privacy: 'La imagen de la cámara nunca sale de tu dispositivo.', looks: 'Lo que revisamos', cannot: 'Lo que no podemos revisar', sound: 'Sonido por repetición', voice: 'Consejos hablados',
    loading: 'Cargando la cámara y el modelo de movimiento…', cameraError: 'La cámara no arrancó. Revisa el permiso y la cámara.', summaryTitle: 'Resumen de la serie',
    summaryLine: '{reps} repeticiones, {clean} limpias', topError: 'Lo más frecuente: {what} ({n} reps)', allClean: 'Todas las repeticiones fueron limpias.', noReps: 'No se contó ninguna repetición en esta serie.',
    notChecked: 'Este ejercicio aún no se ha medido con vídeo real; sus consejos son una prueba.', tipsNote: 'Son consejos de técnica.',
    ready: 'Todo listo. Empieza cuando quieras.', person: 'Ponte delante de la cámara.', parts: 'Debe verse: {parts}', closer: 'Acércate un poco.', farther: 'Aléjate un poco para que se vea todo tu cuerpo.',
    lieDown: 'Túmbate: hombros y pies dentro de la imagen.', wantFront: 'Mira a la cámara.', wantSide: 'Ponte de lado: la cámara a tu lado.', wantDiag: 'Ponte un poco en diagonal a la cámara.',
    legend: 'Línea', legendOk: 'bien', legendTip: 'consejo', legendBad: 'corregir', legendUnknown: 'sin medir',
  },
  parts: { head: 'cabeza', shoulders: 'hombros', elbows: 'codos', hands: 'manos', hips: 'cadera', knees: 'rodillas', feet: 'pies' },
  moves: {
    squat: { name: 'Sentadilla', setup: 'Pon el móvil a la altura de la cadera, a 2-3 metros delante de ti. De frente o un poco en diagonal; de lado también sirve.', looks: ['Profundidad: muslos casi paralelos al suelo', 'De frente: rodillas hacia dentro', 'De frente: peso hacia un lado', 'De lado: demasiado inclinado hacia delante', 'Ritmo'], cannot: ['Talones que se levantan', 'Espalda redondeada'] },
    pushUp: { name: 'Flexión', setup: 'Pon el móvil en el suelo, a 2 metros a tu lado, para que te vea de lado de la cabeza a los pies.', looks: ['Pecho lo bastante bajo', 'Línea del cuerpo: cadera hundida o muy alta', 'Manos bajo los hombros', 'Ritmo'], cannot: ['Codos abiertos hacia fuera (no se ven de lado)', 'Cabeza y cuello'] },
    gluteBridge: { name: 'Puente de glúteos', setup: 'Pon el móvil en el suelo, a 2 metros a tu lado. Túmbate boca arriba, rodillas dobladas, pies en el suelo.', looks: ['Cadera arriba del todo', 'Demasiado arco', 'Posición de los pies'], cannot: ['Rodillas que se abren o se cierran', 'Apretar los glúteos'] },
    dbShoulderPress: { name: 'Press de hombros con mancuernas', setup: 'Pon el móvil delante de ti, a 1,5-2,5 metros, que se vea de la cabeza a la cadera. De pie o sentado.', looks: ['Brazos arriba del todo', 'Los dos brazos a la vez', 'Codos bajo las muñecas', 'Sin inclinarse de lado'], cannot: ['Arco lumbar (no se ve de frente)', 'Encoger los hombros'] },
  },
  cues: {
    'squat.deeper': 'Baja un poco más', 'squat.kneesOut': 'Rodillas hacia fuera, sobre los pies', 'squat.even': 'Reparte el peso en los dos pies', 'squat.chestUp': 'Pecho arriba',
    'squat.standTall': 'Sube del todo y vuelve a bajar', 'tempo.slower': 'Baja más despacio',
    'pushUp.lower': 'Baja el pecho un poco más', 'pushUp.hipsUp': 'Sube la cadera: una línea recta', 'pushUp.hipsDown': 'Baja un poco la cadera', 'pushUp.handsUnder': 'Manos bajo los hombros', 'pushUp.armsStraight': 'Estira los brazos y vuelve a bajar',
    'bridge.higher': 'Sube la cadera un poco más', 'bridge.ribsDown': 'Costillas abajo, sin arquear de más', 'bridge.feetCloser': 'Acerca un poco los pies', 'bridge.feetFarther': 'Aleja un poco los pies', 'bridge.lowerFully': 'Baja la cadera al suelo y vuelve a subir',
    'press.higher': 'Empuja las mancuernas arriba del todo', 'press.together': 'Empuja con los dos brazos a la vez', 'press.straighten': 'Estira los brazos arriba', 'press.elbowsUnder': 'Codos bajo las muñecas', 'press.stayUpright': 'Mantén el cuerpo recto', 'press.lowerToShoulders': 'Baja las mancuernas hasta los hombros',
  },
  rules: {
    'squat.depth': 'poca profundidad', 'squat.kneesIn': 'rodillas hacia dentro', 'squat.shift': 'peso hacia un lado', 'squat.chest': 'demasiado inclinado', 'squat.tempo': 'bajada demasiado rápida',
    'pushUp.depth': 'el pecho no bajó lo bastante', 'pushUp.line': 'la línea del cuerpo se rompió', 'pushUp.hands': 'manos por delante de los hombros', 'pushUp.tempo': 'bajada demasiado rápida',
    'bridge.height': 'la cadera no subió del todo', 'bridge.arch': 'demasiado arco', 'bridge.feet': 'pies mal colocados',
    'press.top': 'los brazos no subieron del todo', 'press.together': 'un brazo se quedó atrás', 'press.lockout': 'brazos sin estirar arriba', 'press.stack': 'codos fuera de las muñecas', 'press.upright': 'inclinado hacia un lado',
  },
};

const fr: BaseWords = {
  ui: {
    title: 'Coach de posture', formCount: 'Posture + compteur', start: 'Activer la caméra', stop: 'Couper la caméra', finish: 'Terminer la série', again: 'Nouvelle série',
    reps: 'Rép.', clean: 'Propres', privacy: "L'image de la caméra ne quitte jamais ton appareil.", looks: 'Ce que nous vérifions', cannot: 'Ce que nous ne pouvons pas vérifier', sound: 'Son à chaque répétition', voice: 'Conseils à voix haute',
    loading: 'Chargement de la caméra et du modèle de mouvement…', cameraError: "La caméra n'a pas démarré. Vérifie l'autorisation et la caméra.", summaryTitle: 'Résumé de la série',
    summaryLine: '{reps} répétitions, {clean} propres', topError: 'Le plus souvent : {what} ({n} rép.)', allClean: 'Toutes les répétitions étaient propres.', noReps: "Aucune répétition n'a été comptée dans cette série.",
    notChecked: "Cet exercice n'a pas encore été mesuré sur une vraie vidéo ; ses conseils sont un essai.", tipsNote: 'Ce sont des conseils de posture.',
    ready: 'Tout est prêt. Commence quand tu veux.', person: 'Place-toi devant la caméra.', parts: 'Doit être visible : {parts}', closer: 'Approche-toi un peu.', farther: 'Recule un peu pour que tout ton corps soit visible.',
    lieDown: "Allonge-toi : épaules et pieds dans l'image.", wantFront: 'Mets-toi face à la caméra.', wantSide: 'Mets-toi de profil : la caméra à côté de toi.', wantDiag: 'Place-toi un peu en biais face à la caméra.',
    legend: 'Ligne', legendOk: 'bien', legendTip: 'conseil', legendBad: 'à corriger', legendUnknown: 'non mesuré',
  },
  parts: { head: 'tête', shoulders: 'épaules', elbows: 'coudes', hands: 'mains', hips: 'hanches', knees: 'genoux', feet: 'pieds' },
  moves: {
    squat: { name: 'Squat', setup: 'Pose le téléphone à hauteur de hanches, à 2-3 mètres devant toi. De face ou un peu en biais ; de profil, ça marche aussi.', looks: ['Profondeur : cuisses presque parallèles au sol', 'De face : genoux qui rentrent', 'De face : poids sur un côté', 'De profil : buste trop penché', 'Tempo'], cannot: ['Talons qui se lèvent', 'Dos arrondi'] },
    pushUp: { name: 'Pompe', setup: 'Pose le téléphone au sol, à 2 mètres sur le côté, pour qu’il te voie de profil de la tête aux pieds.', looks: ['Poitrine assez basse', 'Ligne du corps : hanches qui tombent ou trop hautes', 'Mains sous les épaules', 'Tempo'], cannot: ['Coudes écartés (invisibles de profil)', 'Tête et nuque'] },
    gluteBridge: { name: 'Pont fessier', setup: 'Pose le téléphone au sol, à 2 mètres sur le côté. Allonge-toi sur le dos, genoux pliés, pieds au sol.', looks: ['Hanches tout en haut', 'Cambrure excessive', 'Position des pieds'], cannot: ['Genoux qui rentrent ou s’ouvrent', 'Serrer les fessiers'] },
    dbShoulderPress: { name: 'Développé épaules aux haltères', setup: 'Pose le téléphone devant toi, à 1,5-2,5 mètres, de la tête aux hanches. Debout ou assis.', looks: ['Bras tout en haut', 'Les deux bras ensemble', 'Coudes sous les poignets', 'Pas de penché sur le côté'], cannot: ['Cambrure du bas du dos (invisible de face)', 'Haussement des épaules'] },
  },
  cues: {
    'squat.deeper': 'Descends un peu plus', 'squat.kneesOut': 'Pousse les genoux vers l’extérieur, au-dessus des pieds', 'squat.even': 'Poids sur les deux pieds', 'squat.chestUp': 'Garde la poitrine haute',
    'squat.standTall': 'Redresse-toi complètement, puis redescends', 'tempo.slower': 'Descends plus lentement',
    'pushUp.lower': 'Descends la poitrine un peu plus', 'pushUp.hipsUp': 'Remonte les hanches : une ligne droite', 'pushUp.hipsDown': 'Baisse un peu les hanches', 'pushUp.handsUnder': 'Mains sous les épaules', 'pushUp.armsStraight': 'Tends les bras, puis redescends',
    'bridge.higher': 'Monte les hanches un peu plus', 'bridge.ribsDown': 'Côtes basses, ne cambre pas trop', 'bridge.feetCloser': 'Rapproche un peu les pieds', 'bridge.feetFarther': 'Éloigne un peu les pieds', 'bridge.lowerFully': 'Repose les hanches au sol, puis remonte',
    'press.higher': 'Pousse les haltères tout en haut', 'press.together': 'Pousse avec les deux bras ensemble', 'press.straighten': 'Tends les bras en haut', 'press.elbowsUnder': 'Coudes sous les poignets', 'press.stayUpright': 'Garde le buste droit', 'press.lowerToShoulders': 'Descends les haltères jusqu’aux épaules',
  },
  rules: {
    'squat.depth': 'pas assez profond', 'squat.kneesIn': 'genoux qui rentrent', 'squat.shift': 'poids sur un côté', 'squat.chest': 'buste trop penché', 'squat.tempo': 'descente trop rapide',
    'pushUp.depth': 'poitrine pas assez basse', 'pushUp.line': 'ligne du corps cassée', 'pushUp.hands': 'mains devant les épaules', 'pushUp.tempo': 'descente trop rapide',
    'bridge.height': 'hanches pas tout en haut', 'bridge.arch': 'cambrure excessive', 'bridge.feet': 'pieds mal placés',
    'press.top': 'bras pas tout en haut', 'press.together': 'un bras en retard', 'press.lockout': 'bras pas tendus en haut', 'press.stack': 'coudes pas sous les poignets', 'press.upright': 'penché sur le côté',
  },
};

// Faz 4 (floor) and Faz 5 (dumbbell) words: en and tr in strings-faz45.ts, de, es and fr in strings-faz45-more.ts
const FAZ45: Readonly<Record<Lang, Faz45Words>> = { en: en45, tr: tr45, de: de45, es: es45, fr: fr45 };

const merge = (b: BaseWords, lang: Lang): FormWords => {
  const x = STANDING_WORDS[lang], y = FAZ45[lang];
  return {
    ui: { ...b.ui, ...x.ui, ...y.ui }, parts: b.parts, moves: { ...b.moves, ...x.moves, ...y.moves },
    cues: { ...b.cues, ...x.cues, ...y.cues }, rules: { ...b.rules, ...x.rules, ...y.rules },
  };
};

export const FORM_WORDS: Readonly<Record<Lang, FormWords>> = { en: merge(en, 'en'), tr: merge(tr, 'tr'), de: merge(de, 'de'), es: merge(es, 'es'), fr: merge(fr, 'fr') };

/** Fills {name} placeholders. */
export const fill = (s: string, v: Record<string, string | number>): string => s.replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? String(v[k]) : m));
