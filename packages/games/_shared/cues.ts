// The words of the reason strip, as a cue: "Feet wider" where the shell's line for the same code says "Feet not wide enough".
// The strip beside the self view is the narrowest plate of the HUD: on a 360 px phone with the view in the bottom left corner it
// holds two lines of about ten letters, and a longer reason would take a third line and be cut. The shell has one full sentence per
// miss code (`miss.<code>`, for the results and for the games that have no cue of their own); these are the lines a player can take
// in during a move, one per code the four games of this folder can give, in the five languages of the product. German, Spanish and
// French are drafts like the shell's (the shell has no `miss.*` lines in them yet, so without these a player would read English).
// Keys are `cue.<code>`; every game adds the table to its own (the shell keeps a game's lines under `game.<id>`), so that the
// same code says the same thing in all four. cues.test.ts holds them to the strip: two lines of ten letters, no longer word.
import type { Say, Table, Tables } from './text.ts';

const LANGS = ['en', 'tr', 'de', 'es', 'fr'] as const;

/** The codes a cue exists for (the same codes as MISS_EN in reasons.ts). */
export const CUE_CODES = [
  'person_out', 'hands_out_of_view', 'elbows_out_of_view', 'hips_out_of_view', 'knees_out_of_view', 'feet_out_of_view',
  'hips_not_low', 'feet_not_wide', 'feet_not_together', 'arms_not_up', 'arms_not_down', 'use_both_arms', 'hands_apart',
  'too_slow', 'too_fast', 'turn_more', 'turn_shoulders', 'bend_more', 'bend_less', 'wrong_side', 'hips_shifted',
  'bending_forward', 'limb_off', 'move_more', 'hold_still', 'held_too_short',
] as const;

type Cues = Readonly<Record<(typeof CUE_CODES)[number], string>>;

const EN: Cues = {
  person_out: 'Stay in view',
  hands_out_of_view: 'Hands in view',
  elbows_out_of_view: 'Elbows in view',
  hips_out_of_view: 'Hips in view',
  knees_out_of_view: 'Knees in view',
  feet_out_of_view: 'Feet in view',
  hips_not_low: 'Hips lower',
  feet_not_wide: 'Feet wider',
  feet_not_together: 'Feet together',
  arms_not_up: 'Arms higher',
  arms_not_down: 'Arms down',
  use_both_arms: 'Use both arms',
  hands_apart: 'Hands closer',
  too_slow: 'Too slow',
  too_fast: 'Too fast',
  turn_more: 'Turn further',
  turn_shoulders: 'Turn shoulders',
  bend_more: 'Bend further',
  bend_less: 'Bend less',
  wrong_side: 'Wrong side',
  hips_shifted: 'Keep hips still',
  bending_forward: 'Stay upright',
  limb_off: 'Match the shape',
  move_more: 'Move more',
  hold_still: 'Hold still',
  held_too_short: 'Hold longer',
};

const TR: Cues = {
  person_out: 'Görüntüde kal',
  hands_out_of_view: 'Elleri göster',
  elbows_out_of_view: 'Dirsekleri göster',
  hips_out_of_view: 'Kalçayı göster',
  knees_out_of_view: 'Dizleri göster',
  feet_out_of_view: 'Ayakları göster',
  hips_not_low: 'Daha alçal',
  feet_not_wide: 'Ayakları daha aç',
  feet_not_together: 'Ayakları birleştir',
  arms_not_up: 'Kolları kaldır',
  arms_not_down: 'Kolları indir',
  use_both_arms: 'İki kolu da kullan',
  hands_apart: 'Elleri yaklaştır',
  too_slow: 'Çok yavaş',
  too_fast: 'Çok hızlı',
  turn_more: 'Daha fazla dön',
  turn_shoulders: 'Omuzdan dön',
  bend_more: 'Daha fazla eğil',
  bend_less: 'Daha az eğil',
  wrong_side: 'Yanlış taraf',
  hips_shifted: 'Kalçayı sabit tut',
  bending_forward: 'Öne eğilme',
  limb_off: 'Şekle uy',
  move_more: 'Daha çok hareket et',
  hold_still: 'Sabit dur',
  held_too_short: 'Daha uzun tut',
};

const DE: Cues = {
  person_out: 'Bleib im Bild',
  hands_out_of_view: 'Hände zeigen',
  elbows_out_of_view: 'Ellbogen zeigen',
  hips_out_of_view: 'Hüfte zeigen',
  knees_out_of_view: 'Knie zeigen',
  feet_out_of_view: 'Füße zeigen',
  hips_not_low: 'Hüfte tiefer',
  feet_not_wide: 'Füße spreizen',
  feet_not_together: 'Füße zusammen',
  arms_not_up: 'Arme höher',
  arms_not_down: 'Arme runter',
  use_both_arms: 'Beide Arme nutzen',
  hands_apart: 'Hände näher',
  too_slow: 'Zu langsam',
  too_fast: 'Zu schnell',
  turn_more: 'Mehr drehen',
  turn_shoulders: 'Schultern drehen',
  bend_more: 'Mehr neigen',
  bend_less: 'Weniger neigen',
  wrong_side: 'Falsche Seite',
  hips_shifted: 'Hüfte stabil',
  bending_forward: 'Aufrecht bleiben',
  limb_off: 'Pose anpassen',
  move_more: 'Mehr bewegen',
  hold_still: 'Ruhig halten',
  held_too_short: 'Länger halten',
};

const ES: Cues = {
  person_out: 'Vuelve al cuadro',
  hands_out_of_view: 'Muestra las manos',
  elbows_out_of_view: 'Muestra los codos',
  hips_out_of_view: 'Muestra la cadera',
  knees_out_of_view: 'Muestra rodillas',
  feet_out_of_view: 'Muestra los pies',
  hips_not_low: 'Baja más',
  feet_not_wide: 'Pies más abiertos',
  feet_not_together: 'Junta los pies',
  arms_not_up: 'Brazos arriba',
  arms_not_down: 'Baja los brazos',
  use_both_arms: 'Usa ambos brazos',
  hands_apart: 'Manos más juntas',
  too_slow: 'Muy lento',
  too_fast: 'Muy rápido',
  turn_more: 'Gira más',
  turn_shoulders: 'Gira los hombros',
  bend_more: 'Inclínate más',
  bend_less: 'Inclínate menos',
  wrong_side: 'Lado contrario',
  hips_shifted: 'Cadera quieta',
  bending_forward: 'Mantente recto',
  limb_off: 'Ajusta la pose',
  move_more: 'Muévete más',
  hold_still: 'Sin moverte',
  held_too_short: 'Aguanta más',
};

const FR: Cues = {
  person_out: 'Reste dans le cadre',
  hands_out_of_view: 'Montre les mains',
  elbows_out_of_view: 'Montre les coudes',
  hips_out_of_view: 'Montre les hanches',
  knees_out_of_view: 'Montre les genoux',
  feet_out_of_view: 'Montre les pieds',
  hips_not_low: 'Descends plus',
  feet_not_wide: 'Pieds plus écartés',
  feet_not_together: 'Joins les pieds',
  arms_not_up: 'Bras plus haut',
  arms_not_down: 'Bras en bas',
  use_both_arms: 'Les deux bras',
  hands_apart: 'Mains plus près',
  too_slow: 'Trop lent',
  too_fast: 'Trop vite',
  turn_more: 'Tourne plus',
  turn_shoulders: 'Tourne les épaules',
  bend_more: 'Penche plus',
  bend_less: 'Penche moins',
  wrong_side: 'Mauvais côté',
  hips_shifted: 'Hanches fixes',
  bending_forward: 'Reste droit',
  limb_off: 'Ajuste la pose',
  move_more: 'Bouge plus',
  hold_still: 'Ne bouge pas',
  held_too_short: 'Tiens plus longtemps',
};

/** The key of a code's cue in a game's table. */
export const cueKey = (code: string): string => `cue.${code}`;

const tableOf = (cues: Cues): Table => Object.fromEntries(CUE_CODES.map((c) => [cueKey(c), cues[c]]));

/** Every cue in every language, as lines of a game's table. */
export const CUES: Tables = { en: tableOf(EN), tr: tableOf(TR), de: tableOf(DE), es: tableOf(ES), fr: tableOf(FR) };

/** A game's own words with the cues of the strip added in every language (the game's own lines win a clash, there is none today). */
export function withCues(own: Tables): Tables {
  const out = {} as Record<(typeof LANGS)[number], Table>;
  for (const l of LANGS) out[l] = { ...CUES[l], ...own[l] };
  return out;
}

/**
 * What the strip says for a miss code: the cue of the game's table, else the shell's full sentence for the code (a code a
 * detector gains later is still said, in the shell's words, until it has a cue).
 */
export function cueText(say: Say, code: string): string {
  const key = cueKey(code);
  const cue = say(key);
  return cue !== key ? cue : say(`miss.${code}`);
}
