// Français : BROUILLON, à faire relire par une personne de langue maternelle.
import type { en } from './en.ts';

export const fr: Readonly<Partial<Record<keyof typeof en, string>>> = {
  'common.close': 'Fermer',
  'common.cancel': 'Annuler',
  'common.back': 'Retour',
  'common.next': 'Suivant',
  'common.continue': 'Continuer',
  'common.done': 'Terminé',
  'common.retry': 'Réessayer',
  'common.on': 'Activé',
  'common.off': 'Désactivé',
  'common.free': 'Gratuit',
  'common.skipToContent': 'Aller au contenu',

  'nav.label': 'Navigation principale',
  'nav.games': 'Jeux',
  'nav.friends': 'Amis',
  'nav.settings': 'Réglages',
};
