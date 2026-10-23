// English: the source of every interface string. Rules for copy (premium-web-style): sentence case, no em or en
// dashes, no arrows, no emoji, no exclamation marks, no hype words, one idea per string. Variables use {name}, plurals
// use {n, plural, one {...} other {...}}. Turkish must have every key; German, Spanish and French are drafts.
export const en = {
  'brand.name': 'BodyArcade',

  'common.close': 'Close',
  'common.cancel': 'Cancel',
  'common.back': 'Back',
  'common.next': 'Next',
  'common.continue': 'Continue',
  'common.done': 'Done',
  'common.retry': 'Try again',
  'common.on': 'On',
  'common.off': 'Off',
  'common.free': 'Free',
  'common.pro': 'Pro',
  'common.skipToContent': 'Skip to content',

  'nav.label': 'Main navigation',
  'nav.games': 'Games',
  'nav.friends': 'Friends',
  'nav.settings': 'Settings',
  'nav.pro': 'Pro',
} as const;
