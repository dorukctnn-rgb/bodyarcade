// The twelve pictures a profile can have (core/store/profiles.ts: AVATARS): round, flat, drawn in the brand's colours, no outline
// and no text, so they read at 40 px on a card and at 96 px on the picker. The store knows only their names; this is the drawing.
import { escapeHtml, raw, type SafeHtml } from './html.ts';

export const AVATAR_IDS = ['fox', 'owl', 'bear', 'panda', 'tiger', 'frog', 'koala', 'whale', 'robot', 'rocket', 'star', 'bolt'] as const;
export type AvatarId = (typeof AVATAR_IDS)[number];

const INK = '#1C1433';
const CHALK = '#F4F2F8';

/** Each picture: the colour of its disc and what is drawn on it, in a 64 by 64 box. */
const DRAWINGS: Readonly<Record<AvatarId, { bg: string; art: string }>> = {
  fox: {
    bg: '#FFE9C7',
    art: `<path d="M13 27 19 8 31 20Z" fill="#F26B3A"/><path d="M51 27 45 8 33 20Z" fill="#F26B3A"/><path d="M18 22 20 14 26 20Z" fill="#FFC9A8"/><path d="M46 22 44 14 38 20Z" fill="#FFC9A8"/>
      <path d="M9 28Q32 13 55 28Q53 49 32 57Q11 49 9 28Z" fill="#F26B3A"/><path d="M13 37Q32 29 51 37Q47 51 32 57Q17 51 13 37Z" fill="#FFF4E8"/>
      <circle cx="23.500" cy="34" r="2.500" fill="${INK}"/><circle cx="40.500" cy="34" r="2.500" fill="${INK}"/><path d="M28.500 45Q32 47 35.500 45Q35.500 49 32 50Q28.500 49 28.500 45Z" fill="${INK}"/>`,
  },
  owl: {
    bg: '#E7E0FA',
    art: `<path d="M15 20 19 8 27 17Z" fill="#7A63C9"/><path d="M49 20 45 8 37 17Z" fill="#7A63C9"/><ellipse cx="32" cy="35" rx="21" ry="22" fill="#7A63C9"/><ellipse cx="32" cy="49" rx="11" ry="8" fill="#B9A9F0"/>
      <circle cx="23.500" cy="30" r="9" fill="${CHALK}"/><circle cx="40.500" cy="30" r="9" fill="${CHALK}"/><circle cx="24" cy="31" r="4" fill="${INK}"/><circle cx="40" cy="31" r="4" fill="${INK}"/><path d="M28.500 37h7L32 44Z" fill="#FFC53A"/>`,
  },
  bear: {
    bg: '#FFE3E8',
    art: `<circle cx="16" cy="19" r="8" fill="#A8714B"/><circle cx="48" cy="19" r="8" fill="#A8714B"/><circle cx="16" cy="19" r="4" fill="#D9A783"/><circle cx="48" cy="19" r="4" fill="#D9A783"/>
      <ellipse cx="32" cy="35" rx="21" ry="20" fill="#A8714B"/><ellipse cx="32" cy="42" rx="10.500" ry="8" fill="#E8C7A5"/><ellipse cx="32" cy="38.500" rx="4" ry="3" fill="${INK}"/>
      <circle cx="23" cy="31" r="2.500" fill="${INK}"/><circle cx="41" cy="31" r="2.500" fill="${INK}"/>`,
  },
  panda: {
    bg: '#D3F5E6',
    art: `<circle cx="15" cy="18" r="8" fill="${INK}"/><circle cx="49" cy="18" r="8" fill="${INK}"/><ellipse cx="32" cy="35" rx="21" ry="20" fill="${CHALK}"/>
      <ellipse cx="23" cy="33" rx="6" ry="8" transform="rotate(20 23 33)" fill="${INK}"/><ellipse cx="41" cy="33" rx="6" ry="8" transform="rotate(-20 41 33)" fill="${INK}"/>
      <circle cx="24" cy="32" r="2.200" fill="${CHALK}"/><circle cx="40" cy="32" r="2.200" fill="${CHALK}"/><ellipse cx="32" cy="43" rx="3.800" ry="2.800" fill="${INK}"/>`,
  },
  tiger: {
    bg: '#FFF1C9',
    art: `<circle cx="16" cy="19" r="7" fill="#F59A23"/><circle cx="48" cy="19" r="7" fill="#F59A23"/><ellipse cx="32" cy="35" rx="21" ry="20" fill="#F59A23"/>
      <path d="M32 16v8M26 18l2 7M38 18l-2 7M12 32l7 2M52 32l-7 2M13 40l7 1M51 40l-7 1" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
      <ellipse cx="32" cy="44" rx="11" ry="8" fill="#FFF4E8"/><path d="M28.500 40h7L32 44.500Z" fill="#FF4F6E"/><circle cx="24" cy="32" r="2.500" fill="${INK}"/><circle cx="40" cy="32" r="2.500" fill="${INK}"/>`,
  },
  frog: {
    bg: '#D3F5E6',
    art: `<ellipse cx="32" cy="39" rx="23" ry="17" fill="#34B36B"/><circle cx="21" cy="23" r="9.500" fill="#34B36B"/><circle cx="43" cy="23" r="9.500" fill="#34B36B"/>
      <circle cx="21" cy="23" r="6.500" fill="${CHALK}"/><circle cx="43" cy="23" r="6.500" fill="${CHALK}"/><circle cx="21.500" cy="24" r="3.200" fill="${INK}"/><circle cx="42.500" cy="24" r="3.200" fill="${INK}"/>
      <path d="M15 41Q32 56 49 41" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/><circle cx="28.500" cy="35" r="1.300" fill="${INK}"/><circle cx="35.500" cy="35" r="1.300" fill="${INK}"/>`,
  },
  koala: {
    bg: '#D9EEFF',
    art: `<circle cx="13" cy="23" r="11" fill="#9AA3B5"/><circle cx="51" cy="23" r="11" fill="#9AA3B5"/><circle cx="13" cy="23" r="6" fill="#E6E9F0"/><circle cx="51" cy="23" r="6" fill="#E6E9F0"/>
      <ellipse cx="32" cy="37" rx="20" ry="19" fill="#9AA3B5"/><circle cx="23.500" cy="33" r="2.500" fill="${INK}"/><circle cx="40.500" cy="33" r="2.500" fill="${INK}"/><ellipse cx="32" cy="41" rx="5.500" ry="7.500" fill="${INK}"/>`,
  },
  whale: {
    bg: '#D9EEFF',
    art: `<path d="M26 22Q26 13 21 9M26 22Q26 13 31 9" fill="none" stroke="#46B4FF" stroke-width="3" stroke-linecap="round"/>
      <path d="M5 40Q6 22 29 22Q49 22 58 35Q53 33 49 34Q55 41 58 48Q50 46 44 42Q40 54 26 54Q7 54 5 40Z" fill="#2F8FE0"/><path d="M9 45Q26 53 43 44Q35 50 22 50Q13 49 9 45Z" fill="#BFE3FF"/><circle cx="17.500" cy="37" r="2.300" fill="${INK}"/>`,
  },
  robot: {
    bg: '#E7E0FA',
    art: `<path d="M32 15V7" stroke="${INK}" stroke-width="3" stroke-linecap="round"/><circle cx="32" cy="6.500" r="3.500" fill="#FF4F6E"/><rect x="6" y="27" width="6" height="11" rx="2.500" fill="#8D95A8"/><rect x="52" y="27" width="6" height="11" rx="2.500" fill="#8D95A8"/>
      <rect x="11" y="15" width="42" height="36" rx="10" fill="#C9CFDC"/><rect x="16" y="21" width="32" height="24" rx="7" fill="${INK}"/><circle cx="25" cy="31" r="4.500" fill="#46B4FF"/><circle cx="39" cy="31" r="4.500" fill="#46B4FF"/><rect x="26" y="39" width="12" height="2.500" rx="1.250" fill="#46B4FF"/>`,
  },
  rocket: {
    bg: INK,
    art: `<circle cx="10" cy="14" r="1.400" fill="${CHALK}"/><circle cx="54" cy="12" r="1.100" fill="${CHALK}"/><circle cx="52" cy="40" r="1.400" fill="${CHALK}"/><circle cx="9" cy="46" r="1.100" fill="${CHALK}"/><circle cx="46" cy="25" r="0.900" fill="${CHALK}"/>
      <path d="M27 47Q32 63 37 47Z" fill="#FFC53A"/><path d="M20 38 10 52 20 47Z" fill="#FF4F6E"/><path d="M44 38 54 52 44 47Z" fill="#FF4F6E"/>
      <path d="M32 5Q45 17 45 37V47H19V37Q19 17 32 5Z" fill="${CHALK}"/><path d="M32 5Q40 12 42 23H22Q24 12 32 5Z" fill="#FF4F6E"/><circle cx="32" cy="31" r="6.500" fill="#46B4FF"/><circle cx="32" cy="31" r="6.500" fill="none" stroke="#9AA3B5" stroke-width="2"/>`,
  },
  star: {
    bg: '#FFF1C9',
    art: `<path d="M32 7 39.500 24.500 58 26 44 38.500 48.500 57 32 47.500 15.500 57 20 38.500 6 26 24.500 24.500Z" fill="#FFC53A" stroke="#FFC53A" stroke-width="3" stroke-linejoin="round"/>
      <circle cx="26.500" cy="34" r="2.200" fill="${INK}"/><circle cx="37.500" cy="34" r="2.200" fill="${INK}"/><path d="M27.500 40.500Q32 45 36.500 40.500" fill="none" stroke="${INK}" stroke-width="2.600" stroke-linecap="round"/>`,
  },
  bolt: {
    bg: '#FFE3E8',
    art: `<path d="M37 5 15 35H29L25 59 49 26H34Z" fill="#FFC53A" stroke="#FFC53A" stroke-width="3" stroke-linejoin="round"/><path d="M36 11 23 31H32L30 44 42 29H31Z" fill="#FFE08A"/>`,
  },
};

export const isAvatar = (v: unknown): v is AvatarId => typeof v === 'string' && (AVATAR_IDS as readonly string[]).includes(v);

/**
 * The picture, as inline SVG. With `label` it is an image that has a name (the choice of a picture); without, it is only a
 * drawing beside the name it belongs to and a screen reader skips it.
 */
export function avatar(id: AvatarId, o: { size?: number; label?: string; className?: string } = {}): SafeHtml {
  const d = DRAWINGS[id];
  const size = o.size ?? 64;
  const cls = o.className ? ` class="${escapeHtml(o.className)}"` : '';
  const a11y = o.label ? `role="img" aria-label="${escapeHtml(o.label)}"` : 'aria-hidden="true" focusable="false"';
  return raw(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}"${cls} ${a11y}><circle cx="32" cy="32" r="32" fill="${d.bg}"/>${d.art}</svg>`);
}
