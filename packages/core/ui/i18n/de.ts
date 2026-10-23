// Deutsch: ENTWURF, zur Prüfung durch eine Muttersprachlerin oder einen Muttersprachler markiert.
import type { en } from './en.ts';

export const de: Readonly<Partial<Record<keyof typeof en, string>>> = {
  'common.close': 'Schließen',
  'common.cancel': 'Abbrechen',
  'common.back': 'Zurück',
  'common.next': 'Weiter',
  'common.continue': 'Fortfahren',
  'common.done': 'Fertig',
  'common.retry': 'Erneut versuchen',
  'common.on': 'An',
  'common.off': 'Aus',
  'common.free': 'Kostenlos',
  'common.skipToContent': 'Zum Inhalt springen',

  'nav.label': 'Hauptnavigation',
  'nav.games': 'Spiele',
  'nav.friends': 'Freunde',
  'nav.settings': 'Einstellungen',
  'runner.move.hurdle': 'Spring',
  'runner.move.duck': 'Duck dich',
  'runner.move.squat': 'Kniebeuge',
  'runner.move.wallL': 'Nach links',
  'runner.move.wallR': 'Nach rechts',
};
