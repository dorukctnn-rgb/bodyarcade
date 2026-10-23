// The words of the three target-hit games, in the five languages of the shell. English is the source; Turkish is complete;
// German, Spanish and French are drafts (the shell marks them as such). Rules of the house (premium-web-style, design/LAYOUT.md
// section 8): sentence case, no em or en dashes, no arrows, no emoji, no exclamation marks; a command is one or two words
// and a reason during play at most 40 characters in English and 48 in translations.
//
// The games ask the shell's `t` for `target.<key>` first, so a shell that has called `i18n.extend('target', TARGET_STRINGS)`
// translates them; one that has not gets the English here (see `say` in game.ts). Variables are written {name}.
export type Lang = 'en' | 'tr' | 'de' | 'es' | 'fr';
export type Table = Readonly<Record<string, string>>;

const en = {
  round: 'Round {n}',
  rest: 'Rest',
  rest_hint: 'Arms down, shake them out',
  announce_round: 'Round {n} of {of}',
  announce_rest: 'Rest for a moment',
  tap_green: 'Tap green',
  combo: '{seq}',
  slip_left: 'Slip left',
  slip_right: 'Slip right',
  duck: 'Duck',
  'reason.wrong_hand.L': 'That one is for your left hand',
  'reason.wrong_hand.R': 'That one is for your right hand',
  'reason.wrong_hand': 'Use the other hand for that one',
  'reason.not_reached': 'Reach a little further',
  'reason.too_brief': 'Stay on it a moment longer',
  'reason.grab_higher': 'Reach higher for that one',
  'reason.hips_not_low': 'Bend your knees to go lower',
  'reason.hands_out_of_view': 'Keep your hands in the picture',
  'reason.feet_out_of_view': 'Step back so your feet show',
  'reason.foot_not_down': 'Put your foot down on the light',
  'reason.too_slow': 'Punch faster',
  'reason.early': 'A little early, wait for the beat',
  'reason.late': 'A little late, punch on the beat',
  'reason.wrong_direction': 'Lean the other way',
  'reason.bend_more': 'Lean further away from it',
  'reason.hold_still': 'That was red, keep your hands back',
  'grade.perfect': 'Perfect',
  'grade.good': 'Good',
  'grade.early': 'Early',
  'grade.late': 'Late',
  'ms': '{n} ms',
  'reason.other': 'Missed that one',
} as const satisfies Table;

const tr: Table = {
  round: 'Tur {n}',
  rest: 'Mola',
  rest_hint: 'Kollar aşağıda, salla gitsin',
  announce_round: 'Tur {n} / {of}',
  announce_rest: 'Kısa bir mola',
  tap_green: 'Yeşile dokun',
  combo: '{seq}',
  slip_left: 'Sola kaç',
  slip_right: 'Sağa kaç',
  duck: 'Eğil',
  'reason.wrong_hand.L': 'Bu sol elin için',
  'reason.wrong_hand.R': 'Bu sağ elin için',
  'reason.wrong_hand': 'Buna öbür elinle dokun',
  'reason.not_reached': 'Biraz daha uzan',
  'reason.too_brief': 'Üzerinde biraz daha kal',
  'reason.grab_higher': 'Buna daha yukarıdan uzan',
  'reason.hips_not_low': 'Dizlerini bük, daha alçal',
  'reason.hands_out_of_view': 'Ellerini görüntüde tut',
  'reason.feet_out_of_view': 'Ayakların görünsün diye geri çekil',
  'reason.foot_not_down': 'Ayağını ışığın üzerine bastır',
  'reason.too_slow': 'Daha hızlı vur',
  'reason.early': 'Biraz erken, ritmi bekle',
  'reason.late': 'Biraz geç, ritme vur',
  'reason.wrong_direction': 'Öbür yana yaslan',
  'reason.bend_more': 'Ondan biraz daha uzağa yaslan',
  'reason.hold_still': 'O kırmızıydı, ellerini geri çek',
  'grade.perfect': 'Mükemmel',
  'grade.good': 'İyi',
  'grade.early': 'Erken',
  'grade.late': 'Geç',
  'ms': '{n} ms',
  'reason.other': 'Onu kaçırdın',
};

const de: Table = {
  round: 'Runde {n}',
  rest: 'Pause',
  rest_hint: 'Arme runter, locker ausschütteln',
  announce_round: 'Runde {n} von {of}',
  announce_rest: 'Kurze Pause',
  tap_green: 'Grün antippen',
  combo: '{seq}',
  slip_left: 'Links weg',
  slip_right: 'Rechts weg',
  duck: 'Ducken',
  'reason.wrong_hand.L': 'Der ist für die linke Hand',
  'reason.wrong_hand.R': 'Der ist für die rechte Hand',
  'reason.wrong_hand': 'Nimm dafür die andere Hand',
  'reason.not_reached': 'Streck dich etwas weiter',
  'reason.too_brief': 'Bleib einen Moment länger dran',
  'reason.grab_higher': 'Greif dafür höher',
  'reason.hips_not_low': 'Knie beugen, geh tiefer',
  'reason.hands_out_of_view': 'Halte die Hände im Bild',
  'reason.feet_out_of_view': 'Tritt zurück, damit man die Füße sieht',
  'reason.foot_not_down': 'Setz den Fuß auf das Licht',
  'reason.too_slow': 'Schlag schneller',
  'reason.early': 'Etwas zu früh, warte auf den Beat',
  'reason.late': 'Etwas spät, schlag auf den Beat',
  'reason.wrong_direction': 'Lehn dich zur anderen Seite',
  'reason.bend_more': 'Lehn dich weiter weg davon',
  'reason.hold_still': 'Das war rot, Hände zurück',
  'grade.perfect': 'Perfekt',
  'grade.good': 'Gut',
  'grade.early': 'Früh',
  'grade.late': 'Spät',
  'ms': '{n} ms',
  'reason.other': 'Das war verpasst',
};

const es: Table = {
  round: 'Ronda {n}',
  rest: 'Descanso',
  rest_hint: 'Brazos abajo, sacúdelos',
  announce_round: 'Ronda {n} de {of}',
  announce_rest: 'Un breve descanso',
  tap_green: 'Toca verde',
  combo: '{seq}',
  slip_left: 'Esquiva izquierda',
  slip_right: 'Esquiva derecha',
  duck: 'Agáchate',
  'reason.wrong_hand.L': 'Esa es para tu mano izquierda',
  'reason.wrong_hand.R': 'Esa es para tu mano derecha',
  'reason.wrong_hand': 'Usa la otra mano para esa',
  'reason.not_reached': 'Estírate un poco más',
  'reason.too_brief': 'Quédate un momento más',
  'reason.grab_higher': 'Alcanza más arriba',
  'reason.hips_not_low': 'Dobla las rodillas para bajar',
  'reason.hands_out_of_view': 'Mantén las manos en la imagen',
  'reason.feet_out_of_view': 'Retrocede para que se vean tus pies',
  'reason.foot_not_down': 'Pon el pie sobre la luz',
  'reason.too_slow': 'Golpea más rápido',
  'reason.early': 'Un poco pronto, espera el ritmo',
  'reason.late': 'Un poco tarde, golpea con el ritmo',
  'reason.wrong_direction': 'Inclínate hacia el otro lado',
  'reason.bend_more': 'Inclínate más lejos de él',
  'reason.hold_still': 'Era roja, retira las manos',
  'grade.perfect': 'Perfecto',
  'grade.good': 'Bien',
  'grade.early': 'Pronto',
  'grade.late': 'Tarde',
  'ms': '{n} ms',
  'reason.other': 'Esa se escapó',
};

const fr: Table = {
  round: 'Manche {n}',
  rest: 'Pause',
  rest_hint: 'Bras en bas, secoue-les',
  announce_round: 'Manche {n} sur {of}',
  announce_rest: 'Une courte pause',
  tap_green: 'Touche vert',
  combo: '{seq}',
  slip_left: 'Esquive gauche',
  slip_right: 'Esquive droite',
  duck: 'Baisse-toi',
  'reason.wrong_hand.L': 'Celle-ci est pour ta main gauche',
  'reason.wrong_hand.R': 'Celle-ci est pour ta main droite',
  'reason.wrong_hand': 'Utilise l\'autre main pour celle-ci',
  'reason.not_reached': 'Tends-toi un peu plus loin',
  'reason.too_brief': 'Reste dessus un instant de plus',
  'reason.grab_higher': 'Attrape plus haut',
  'reason.hips_not_low': 'Plie les genoux pour descendre',
  'reason.hands_out_of_view': 'Garde les mains dans l\'image',
  'reason.feet_out_of_view': 'Recule pour que tes pieds se voient',
  'reason.foot_not_down': 'Pose le pied sur la lumière',
  'reason.too_slow': 'Frappe plus vite',
  'reason.early': 'Un peu tôt, attends le rythme',
  'reason.late': 'Un peu tard, frappe sur le rythme',
  'reason.wrong_direction': 'Penche-toi de l\'autre côté',
  'reason.bend_more': 'Penche-toi plus loin',
  'reason.hold_still': 'C\'était rouge, retire les mains',
  'grade.perfect': 'Parfait',
  'grade.good': 'Bien',
  'grade.early': 'Tôt',
  'grade.late': 'Tard',
  'ms': '{n} ms',
  'reason.other': 'Celle-ci t\'a échappé',
};

export const TARGET_STRINGS: Readonly<Record<Lang, Table>> = { en, tr, de, es, fr };

/** The shell calls `i18n.extend(TARGET_NAMESPACE, TARGET_STRINGS)` once; the games ask for `target.<key>`. */
export const TARGET_NAMESPACE = 'target';

/** `{name}` placeholders only (no plurals): all these strings are written to need none. */
export function format(msg: string, vars?: Record<string, string | number>): string {
  return vars ? msg.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : msg;
}

/** The English text of a key, formatted: what a game shows when the shell has not been given the translations. */
export function english(key: string, vars?: Record<string, string | number>): string | null {
  const msg = (en as Table)[key];
  return msg === undefined ? null : format(msg, vars);
}
