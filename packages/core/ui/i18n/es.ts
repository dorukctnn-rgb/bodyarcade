// Español: BORRADOR, marcado para revisión por una persona nativa.
import type { en } from './en.ts';

export const es: Readonly<Partial<Record<keyof typeof en, string>>> = {
  'common.close': 'Cerrar',
  'common.cancel': 'Cancelar',
  'common.back': 'Atrás',
  'common.next': 'Siguiente',
  'common.continue': 'Continuar',
  'common.done': 'Listo',
  'common.retry': 'Intentar de nuevo',
  'common.on': 'Activado',
  'common.off': 'Desactivado',
  'common.free': 'Gratis',
  'common.skipToContent': 'Saltar al contenido',

  'nav.label': 'Navegación principal',
  'nav.games': 'Juegos',
  'nav.friends': 'Amigos',
  'nav.settings': 'Ajustes',
  'runner.move.hurdle': 'Salta',
  'runner.move.duck': 'Agáchate',
  'runner.move.squat': 'Sentadilla',
  'runner.move.wallL': 'A la izquierda',
  'runner.move.wallR': 'A la derecha',
};
