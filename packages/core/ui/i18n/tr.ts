// Türkçe: tam ve gözden geçirilmiş. Bütün anahtarlar zorunlu (tür denetimi eksik anahtarı reddeder).
import type { en } from './en.ts';

export const tr: Readonly<Record<keyof typeof en, string>> = {
  'brand.name': 'BodyArcade',

  'common.close': 'Kapat',
  'common.cancel': 'Vazgeç',
  'common.back': 'Geri',
  'common.next': 'İleri',
  'common.continue': 'Devam et',
  'common.done': 'Tamam',
  'common.retry': 'Tekrar dene',
  'common.on': 'Açık',
  'common.off': 'Kapalı',
  'common.free': 'Ücretsiz',
  'common.pro': 'Pro',
  'common.skipToContent': 'İçeriğe geç',

  'nav.label': 'Ana gezinme',
  'nav.games': 'Oyunlar',
  'nav.friends': 'Arkadaşlar',
  'nav.settings': 'Ayarlar',
  'nav.pro': 'Pro',
};
