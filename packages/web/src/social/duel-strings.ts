// The words of duel links (sprint arm E): the button on a game's page, the duel card of the room page, the guest window, the duel
// button of a friend, the rival's figure on the stage and the result card. They live under the `duel` namespace (registerGameStrings,
// the door the games' words and the friends screens use), so the shell's tables stay as they are. Every site language is complete here
// (the type says so). duel-strings.test.ts holds them to the copy rules. Nothing here claims a health effect, and no word says "AI".
import { registerGameStrings, type I18n, type Vars } from '../../../core/ui/i18n/index.ts';

export const en = {
  // ---- a game's page ----
  'cta': 'Duel link',
  'cta.note': 'Duel link: send it to a friend and you both play this game at the same time, each with your own camera. Only points and your pose go across. Your camera picture stays on your device.',
  // ---- the room page ----
  'card.title': 'Duel',
  'card.lead': 'Send this link to one friend. When you are both ready, the duel starts on both screens at the same moment.',
  'card.leadJoined': 'You are both here. Press Get ready, and the duel starts on both screens once you both are.',
  'card.share': 'Send the link',
  'card.left': 'The link closes in {time}',
  'card.closing': 'Too little time is left for another round. Make a new duel link.',
  'card.privacy': 'Your friend sees your points and a 3D figure that follows your pose. Your camera picture never leaves your device.',
  'card.race': 'Same course for both. The room counts every obstacle.',
  'card.score': 'Same round for both. The higher score wins.',
  'card.guest': 'You are playing as a guest: {name}',
  'card.new': 'New duel link',
  'card.shareText': 'Duel me in {game} on BodyArcade',
  // ---- the guest window ----
  'guest.title': 'Join the duel',
  'guest.titleNew': 'Start a duel',
  'guest.body': 'No sign-up needed. You play under the name below. You can make a profile later to keep friends.',
  'guest.go': 'Join as a guest',
  'guest.goNew': 'Make the duel link',
  'guest.profile': 'Make a profile instead',
  'guest.terms': 'Tick the box to agree to the rules first.',
  // ---- the friends list ----
  'friend.duel': 'Duel',
  'friend.duelLabel': 'Duel {name}',
  'friend.asked': '{name} was asked to a duel.',
  // ---- the stage ----
  'stage.figure': 'The pose of {name}',
  // ---- the result card ----
  'result.title': 'Duel result',
  'result.won': 'You won the duel',
  'result.lost': '{name} won the duel',
  'result.draw': 'The duel is a draw',
  'result.you': 'You',
  'result.rematch': 'Rematch',
  'result.closed': 'This duel room has closed. Make a new link for another round.',
  'result.points': '{n} points',
} as const;

export type DuelKey = keyof typeof en;
type Table = Readonly<Record<DuelKey, string>>;

export const tr: Table = {
  'cta': 'Düello linki',
  'cta.note': 'Düello linki: bir arkadaşına gönder, ikiniz de bu oyunu aynı anda, kendi kameranızla oynayın. Karşıya yalnız puanlar ve pozun gider. Kamera görüntün cihazında kalır.',
  'card.title': 'Düello',
  'card.lead': 'Bu linki bir arkadaşına gönder. İkiniz de hazır olunca düello iki ekranda aynı anda başlar.',
  'card.leadJoined': 'İkiniz de buradasınız. Hazırlan düğmesine basın; ikiniz de hazır olunca düello iki ekranda aynı anda başlar.',
  'card.share': 'Linki gönder',
  'card.left': 'Linkin kapanmasına {time} kaldı',
  'card.closing': 'Yeni bir tur için yeterli süre kalmadı. Yeni bir düello linki oluştur.',
  'card.privacy': 'Arkadaşın puanlarını ve pozunu izleyen 3D bir figür görür. Kamera görüntün cihazından hiç çıkmaz.',
  'card.race': 'İkiniz için aynı parkur. Oda her engeli sayar.',
  'card.score': 'İkiniz için aynı tur. Yüksek puan kazanır.',
  'card.guest': 'Misafir olarak oynuyorsun: {name}',
  'card.new': 'Yeni düello linki',
  'card.shareText': 'BodyArcade\'de {game} düellosuna var mısın?',
  'guest.title': 'Düelloya katıl',
  'guest.titleNew': 'Düello başlat',
  'guest.body': 'Kayıt gerekmez. Aşağıdaki adla oynarsın. Arkadaşlarını saklamak için sonra profil oluşturabilirsin.',
  'guest.go': 'Misafir olarak katıl',
  'guest.goNew': 'Düello linkini oluştur',
  'guest.profile': 'Bunun yerine profil oluştur',
  'guest.terms': 'Önce kuralları kabul etmek için kutuyu işaretle.',
  'friend.duel': 'Düello',
  'friend.duelLabel': '{name} ile düello',
  'friend.asked': '{name} düelloya çağrıldı.',
  'stage.figure': '{name} adlı oyuncunun pozu',
  'result.title': 'Düello sonucu',
  'result.won': 'Düelloyu kazandın',
  'result.lost': 'Düelloyu {name} kazandı',
  'result.draw': 'Düello berabere bitti',
  'result.you': 'Sen',
  'result.rematch': 'Rövanş',
  'result.closed': 'Bu düello odası kapandı. Yeni bir tur için yeni bir link oluştur.',
  'result.points': '{n} puan',
};

export const de: Table = {
  'cta': 'Duell-Link',
  'cta.note': 'Duell-Link: Schick ihn einer Freundin oder einem Freund, und ihr spielt dieses Spiel gleichzeitig, jede Person mit der eigenen Kamera. Übertragen werden nur Punkte und deine Haltung. Dein Kamerabild bleibt auf deinem Gerät.',
  'card.title': 'Duell',
  'card.lead': 'Schick diesen Link an eine Person. Wenn ihr beide bereit seid, startet das Duell auf beiden Bildschirmen im selben Moment.',
  'card.leadJoined': 'Ihr seid beide da. Sobald ihr beide bereit seid, startet das Duell auf beiden Bildschirmen im selben Moment.',
  'card.share': 'Link senden',
  'card.left': 'Der Link schließt in {time}',
  'card.closing': 'Für eine weitere Runde ist zu wenig Zeit übrig. Erstelle einen neuen Duell-Link.',
  'card.privacy': 'Dein Gegenüber sieht deine Punkte und eine 3D-Figur, die deiner Haltung folgt. Dein Kamerabild verlässt dein Gerät nie.',
  'card.race': 'Dieselbe Strecke für beide. Der Raum zählt jedes Hindernis.',
  'card.score': 'Dieselbe Runde für beide. Die höhere Punktzahl gewinnt.',
  'card.guest': 'Du spielst als Gast: {name}',
  'card.new': 'Neuer Duell-Link',
  'card.shareText': 'Duell mit mir in {game} auf BodyArcade',
  'guest.title': 'Dem Duell beitreten',
  'guest.titleNew': 'Ein Duell starten',
  'guest.body': 'Keine Anmeldung nötig. Du spielst unter dem Namen unten. Ein Profil, um Freunde zu behalten, kannst du später anlegen.',
  'guest.go': 'Als Gast beitreten',
  'guest.goNew': 'Duell-Link erstellen',
  'guest.profile': 'Lieber ein Profil anlegen',
  'guest.terms': 'Setze zuerst das Häkchen, um den Regeln zuzustimmen.',
  'friend.duel': 'Duell',
  'friend.duelLabel': 'Duell mit {name}',
  'friend.asked': '{name} wurde zum Duell eingeladen.',
  'stage.figure': 'Die Haltung von {name}',
  'result.title': 'Ergebnis des Duells',
  'result.won': 'Du hast das Duell gewonnen',
  'result.lost': '{name} hat das Duell gewonnen',
  'result.draw': 'Das Duell endet unentschieden',
  'result.you': 'Du',
  'result.rematch': 'Revanche',
  'result.closed': 'Dieser Duellraum ist geschlossen. Erstelle für eine weitere Runde einen neuen Link.',
  'result.points': '{n} Punkte',
};

export const es: Table = {
  'cta': 'Enlace de duelo',
  'cta.note': 'Enlace de duelo: envíalo a un amigo y jugáis a este juego a la vez, cada uno con su cámara. Solo se envían los puntos y tu postura. La imagen de tu cámara se queda en tu dispositivo.',
  'card.title': 'Duelo',
  'card.lead': 'Envía este enlace a un amigo. Cuando los dos estéis listos, el duelo empieza en las dos pantallas en el mismo momento.',
  'card.leadJoined': 'Ya estáis los dos. Cuando los dos estéis listos, el duelo empieza en las dos pantallas en el mismo momento.',
  'card.share': 'Enviar el enlace',
  'card.left': 'El enlace se cierra en {time}',
  'card.closing': 'Queda poco tiempo para otra ronda. Crea un enlace de duelo nuevo.',
  'card.privacy': 'Tu amigo ve tus puntos y una figura 3D que sigue tu postura. La imagen de tu cámara nunca sale de tu dispositivo.',
  'card.race': 'El mismo recorrido para los dos. La sala cuenta cada obstáculo.',
  'card.score': 'La misma ronda para los dos. Gana la puntuación más alta.',
  'card.guest': 'Juegas como invitado: {name}',
  'card.new': 'Nuevo enlace de duelo',
  'card.shareText': 'Te reto a un duelo de {game} en BodyArcade',
  'guest.title': 'Unirse al duelo',
  'guest.titleNew': 'Empezar un duelo',
  'guest.body': 'No hace falta registrarse. Juegas con el nombre de abajo. Más adelante puedes crear un perfil para guardar a tus amigos.',
  'guest.go': 'Unirse como invitado',
  'guest.goNew': 'Crear el enlace de duelo',
  'guest.profile': 'Prefiero crear un perfil',
  'guest.terms': 'Marca la casilla para aceptar las normas primero.',
  'friend.duel': 'Duelo',
  'friend.duelLabel': 'Duelo con {name}',
  'friend.asked': 'Has invitado a {name} a un duelo.',
  'stage.figure': 'La postura de {name}',
  'result.title': 'Resultado del duelo',
  'result.won': 'Has ganado el duelo',
  'result.lost': '{name} ha ganado el duelo',
  'result.draw': 'El duelo termina en empate',
  'result.you': 'Tú',
  'result.rematch': 'Revancha',
  'result.closed': 'Esta sala de duelo se ha cerrado. Crea un enlace nuevo para otra ronda.',
  'result.points': '{n} puntos',
};

export const fr: Table = {
  'cta': 'Lien de duel',
  'cta.note': 'Lien de duel : envoie-le à un ami et vous jouez à ce jeu en même temps, chacun avec sa caméra. Seuls les points et ta posture sont envoyés. L\'image de ta caméra reste sur ton appareil.',
  'card.title': 'Duel',
  'card.lead': 'Envoie ce lien à un ami. Quand vous êtes prêts tous les deux, le duel démarre sur les deux écrans au même moment.',
  'card.leadJoined': 'Vous êtes là tous les deux. Dès que vous êtes prêts, le duel démarre sur les deux écrans au même moment.',
  'card.share': 'Envoyer le lien',
  'card.left': 'Le lien se ferme dans {time}',
  'card.closing': 'Il reste trop peu de temps pour une autre manche. Crée un nouveau lien de duel.',
  'card.privacy': 'Ton ami voit tes points et une figure 3D qui suit ta posture. L\'image de ta caméra ne quitte jamais ton appareil.',
  'card.race': 'Le même parcours pour les deux. La salle compte chaque obstacle.',
  'card.score': 'La même manche pour les deux. Le meilleur score gagne.',
  'card.guest': 'Tu joues en invité : {name}',
  'card.new': 'Nouveau lien de duel',
  'card.shareText': 'Un duel de {game} sur BodyArcade ?',
  'guest.title': 'Rejoindre le duel',
  'guest.titleNew': 'Lancer un duel',
  'guest.body': 'Pas d\'inscription. Tu joues sous le nom ci-dessous. Tu pourras créer un profil plus tard pour garder tes amis.',
  'guest.go': 'Rejoindre en invité',
  'guest.goNew': 'Créer le lien de duel',
  'guest.profile': 'Créer plutôt un profil',
  'guest.terms': 'Coche d\'abord la case pour accepter les règles.',
  'friend.duel': 'Duel',
  'friend.duelLabel': 'Duel avec {name}',
  'friend.asked': '{name} est invité à un duel.',
  'stage.figure': 'La posture de {name}',
  'result.title': 'Résultat du duel',
  'result.won': 'Tu as gagné le duel',
  'result.lost': '{name} a gagné le duel',
  'result.draw': 'Le duel se termine à égalité',
  'result.you': 'Toi',
  'result.rematch': 'Revanche',
  'result.closed': 'Cette salle de duel est fermée. Crée un nouveau lien pour une autre manche.',
  'result.points': '{n} points',
};

registerGameStrings('duel', { en, tr, de, es, fr });

/** `duel('card.left', { time })`: a word of duel links, in the page's language. */
export function duelText(i18n: Pick<I18n, 'tx'>): (key: DuelKey, vars?: Vars) => string {
  return (key, vars) => i18n.tx(`duel.${key}`, vars);
}

/** "9:05": minutes and seconds of the time a duel link has left. */
export function clockOf(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
