// The words of the strength games (Firework Jacks, Twist Turbine): commands on the HUD, the reasons the player is told,
// and the lines the screen reader speaks. Keys start with the game's short name (fj, tt) so that they cannot meet another
// game's keys whether the shell adds them under `game.<id>` or not. The shell's own `miss.<code>` lines say why a move
// did not count; these are only the words that belong to the game. A command is one or two words (design/LAYOUT.md 8):
// a word over eight letters carries a soft hyphen (U+00AD) so that a long language wraps instead of shrinking.
import type { Tables } from '../_shared/text.ts';

const S = '­';

export const FJ_STRINGS: Tables = {
  en: {
    'fj.prompt.ready': 'Ready',
    'fj.prompt.jack': 'Jack',
    'fj.prompt.arm': 'Arm jack',
    'fj.prompt.step': 'Step jack',
    'fj.prompt.rest': 'Rest',
    'fj.prompt.finale': 'Finale',
    'fj.announce.set': 'Set {n} of {of}, {bpm} jacks a minute.',
    'fj.announce.rest': 'Rest. Next is set {n} of {of}.',
    'fj.announce.finale': 'Finale. Every firework goes up again.',
    'fj.announce.double': 'Double firework.',
  },
  tr: {
    'fj.prompt.ready': 'Hazır',
    'fj.prompt.jack': 'Jack',
    'fj.prompt.arm': 'Kol jack',
    'fj.prompt.step': 'Adım jack',
    'fj.prompt.rest': 'Dinlen',
    'fj.prompt.finale': 'Final',
    'fj.announce.set': '{n}. set, toplam {of} set. Dakikada {bpm} jack.',
    'fj.announce.rest': 'Dinlen. Sıradaki {n}. set, toplam {of} set.',
    'fj.announce.finale': 'Final. Bütün havai fişekler yeniden patlıyor.',
    'fj.announce.double': 'Çift havai fişek.',
  },
  de: {
    'fj.prompt.ready': 'Bereit',
    'fj.prompt.jack': `Hampel${S}mann`,
    'fj.prompt.arm': 'Armhampeln',
    'fj.prompt.step': 'Schritt-Jack',
    'fj.prompt.rest': 'Pause',
    'fj.prompt.finale': 'Finale',
    'fj.announce.set': 'Satz {n} von {of}, {bpm} Jacks pro Minute.',
    'fj.announce.rest': 'Pause. Als Nächstes Satz {n} von {of}.',
    'fj.announce.finale': 'Finale. Jedes Feuerwerk steigt noch einmal auf.',
    'fj.announce.double': 'Doppeltes Feuerwerk.',
  },
  es: {
    'fj.prompt.ready': 'Listo',
    'fj.prompt.jack': 'Salto',
    'fj.prompt.arm': 'Brazos',
    'fj.prompt.step': 'Paso lateral',
    'fj.prompt.rest': 'Descanso',
    'fj.prompt.finale': 'Final',
    'fj.announce.set': 'Serie {n} de {of}, {bpm} saltos por minuto.',
    'fj.announce.rest': 'Descanso. Sigue la serie {n} de {of}.',
    'fj.announce.finale': 'Final. Todos los fuegos artificiales vuelven a estallar.',
    'fj.announce.double': 'Fuego artificial doble.',
  },
  fr: {
    'fj.prompt.ready': 'Prêt',
    'fj.prompt.jack': 'Jack',
    'fj.prompt.arm': 'Bras',
    'fj.prompt.step': 'Pas chassé',
    'fj.prompt.rest': 'Repos',
    'fj.prompt.finale': 'Final',
    'fj.announce.set': 'Série {n} sur {of}, {bpm} jacks par minute.',
    'fj.announce.rest': 'Repos. Prochaine série : {n} sur {of}.',
    'fj.announce.finale': 'Final. Tous les feux d’artifice repartent.',
    'fj.announce.double': 'Feu d’artifice double.',
  },
};
