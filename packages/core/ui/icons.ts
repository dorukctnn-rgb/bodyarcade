// The interface icons: 24 x 24 line icons, 2.2 stroke, round caps, the accent colour on the parts marked "ac".
// A port of ICON in the art director's UI kit (design/ui-kit/shell.mjs). Every icon is decorative (aria-hidden): the
// words next to it, or the aria-label of the button around it, carry the meaning.
import { raw, type SafeHtml } from './html.ts';

const I = (body: string): string =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const FILLED = (body: string): string => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;

const SOURCE = {
  arcade: I('<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle class="ac" cx="12" cy="8.6" r="2.4" fill="currentColor" stroke="none"/><path d="M12 11v5.2"/><path class="ac" d="M7.5 16.6h9"/>'),
  programs: I('<circle class="ac" cx="5.6" cy="6.5" r="1.8" fill="currentColor" stroke="none"/><path d="M9.6 6.5h9.4M5 12h14M5 17.5h9"/>'),
  friends: I('<circle cx="8.4" cy="8.2" r="3"/><circle class="ac" cx="16.4" cy="9" r="2.5"/><path d="M3 19c.4-3.2 2.6-5.2 5.4-5.2s5 2 5.4 5.2"/><path class="ac" d="M14.6 14.4c2.6-.6 5.4.9 6 4.6"/>'),
  profile: I('<circle class="ac" cx="12" cy="7.6" r="3.4"/><path d="M5 20c.6-4 3.3-6.6 7-6.6s6.4 2.6 7 6.6"/>'),
  settings: I('<circle cx="12" cy="12" r="3.1"/><path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3L5.5 5.5"/>'),
  close: I('<path d="M6 6l12 12M18 6L6 18"/>'),
  back: I('<path d="M15 5l-7 7 7 7"/>'),
  share: I('<path d="M12 3.5v11"/><path d="M7.8 7.4L12 3.4l4.2 4"/><path d="M5 12.5V18a2.5 2.5 0 002.5 2.5h9A2.5 2.5 0 0019 18v-5.5"/>'),
  copy: I('<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="3"/><path d="M15.5 8.5V6.5A2.5 2.5 0 0013 4H6.5A2.5 2.5 0 004 6.5V13a2.5 2.5 0 002.5 2.5h2"/>'),
  link: I('<path d="M10 14a4.3 4.3 0 006.1 0l2.8-2.8a4.3 4.3 0 00-6.1-6.1l-1.2 1.2"/><path d="M14 10a4.3 4.3 0 00-6.1 0l-2.8 2.8a4.3 4.3 0 006.1 6.1l1.2-1.2"/>'),
  qr: I('<rect x="4" y="4" width="6" height="6" rx="1.4"/><rect x="14" y="4" width="6" height="6" rx="1.4"/><rect x="4" y="14" width="6" height="6" rx="1.4"/><path d="M14 14h2.5v2.5M20 14v.01M14 20h.01M17.5 20H20v-3"/>'),
  camera: I('<rect x="3" y="6.5" width="13" height="11" rx="3"/><path d="M16 10.4l5-2.9v9l-5-2.9"/><circle class="ac" cx="7.2" cy="10.4" r="1.2" fill="currentColor" stroke="none"/>'),
  cameraOff: I('<path d="M16 10.4l5-2.9v9l-5-2.9M3.5 7.3A3 3 0 003 9v5.5a3 3 0 003 3h7.4M8.6 6.5H13a3 3 0 013 3v3"/><path class="ac" d="M3.5 3.5l17 17"/>'),
  chat: I('<path d="M4 6.8A2.8 2.8 0 016.8 4h10.4A2.8 2.8 0 0120 6.8v7.4a2.8 2.8 0 01-2.8 2.8H10l-4.6 3.6V17H6.8A2.8 2.8 0 014 14.2z"/>'),
  flag: I('<path d="M5.5 21V4.2"/><path class="ac" d="M5.5 4.5c4.5-2 7.5 2 13 0v9c-5.5 2-8.5-2-13 0"/>'),
  block: I('<circle cx="12" cy="12" r="8.2"/><path class="ac" d="M6.2 6.2l11.6 11.6"/>'),
  more: I('<circle cx="5.5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor"/>'),
  lock: I('<rect x="5" y="10.5" width="14" height="10" rx="3"/><path d="M8.5 10.5V8a3.5 3.5 0 017 0v2.5"/>'),
  play: FILLED('<path d="M8 5.6v12.8a1 1 0 001.5.86l10.4-6.4a1 1 0 000-1.72L9.5 4.74A1 1 0 008 5.6z" fill="currentColor"/>'),
  pause: FILLED('<rect x="6" y="4.5" width="4" height="15" rx="1.6" fill="currentColor"/><rect x="14" y="4.5" width="4" height="15" rx="1.6" fill="currentColor"/>'),
  plus: I('<path d="M12 5v14M5 12h14"/>'),
  check: I('<path d="M5 12.5l4.4 4.4L19 7.4"/>'),
  clock: I('<circle cx="12" cy="12.5" r="8"/><path d="M12 8.2v4.6l3 1.8"/>'),
  chair: I('<path d="M7 3.8v9.4h10M7 13.2V21M17 13.2V21M7 17.4h10"/>'),
  quiet: I('<path d="M4 9.5h3.5L12 5.6v12.8l-4.5-3.9H4z"/><path class="ac" d="M16 9.5l4.4 4.6M20.4 9.5L16 14.1"/>'),
  sound: I('<path d="M4 9.5h3.5L12 5.6v12.8l-4.5-3.9H4z"/><path class="ac" d="M15.6 9.2a4 4 0 010 5.6M18.2 6.8a7.6 7.6 0 010 10.4"/>'),
  info: I('<circle cx="12" cy="12" r="8.4"/><path d="M12 11v5.2"/><circle cx="12" cy="7.7" r="1.2" fill="currentColor" stroke="none"/>'),
  shield: I('<path d="M12 3.2l7.4 2.9v5.6c0 4.5-3.1 8-7.4 9.4-4.3-1.4-7.4-4.9-7.4-9.4V6.1z"/><path class="ac" d="M8.6 12.2l2.4 2.4 4.6-4.8"/>'),
  globe: I('<circle cx="12" cy="12" r="8.4"/><path d="M3.8 12h16.4M12 3.6c2.6 2.7 2.6 14.1 0 16.8M12 3.6c-2.6 2.7-2.6 14.1 0 16.8"/>'),
  star: FILLED('<path d="M12 2.8l2.7 5.7 6.2.8-4.6 4.3 1.2 6.2L12 16.8l-5.5 3 1.2-6.2-4.6-4.3 6.2-.8z" fill="currentColor"/>'),
  host: I('<path class="ac" d="M4 17.5l1.4-9.2 4.4 4.1L12 6l2.2 6.4 4.4-4.1 1.4 9.2z"/><path d="M4.5 20.5h15"/>'),
  search: I('<circle cx="10.8" cy="10.8" r="6.3"/><path d="M15.6 15.6L20 20"/>'),
  door: I('<path d="M14 4.5H7.5A2 2 0 005.5 6.5v11a2 2 0 002 2H14"/><path d="M10.5 12h9.5M17 8.8l3.2 3.2-3.2 3.2"/>'),
  user: I('<circle cx="12" cy="8" r="3.6"/><path d="M5 20c.6-4 3.3-6.6 7-6.6s6.4 2.6 7 6.6"/>'),
  users: I('<circle cx="8.4" cy="8.2" r="3"/><circle cx="16.4" cy="9" r="2.5"/><path d="M3 19c.4-3.2 2.6-5.2 5.4-5.2s5 2 5.4 5.2"/><path d="M14.6 14.4c2.6-.6 5.4.9 6 4.6"/>'),
  replay: I('<path d="M4.5 12a7.5 7.5 0 102.2-5.3"/><path d="M4.5 4.3v4.2h4.2"/><path class="ac" d="M10.5 9.2v5.6l4.4-2.8z" fill="currentColor" stroke="none"/>'),
  trophy: I('<path d="M7.5 4.5h9v4.8a4.5 4.5 0 01-9 0z"/><path d="M7.5 6.5H4.5a3 3 0 003 4M16.5 6.5h3a3 3 0 01-3 4M12 13.8v3.4M8.5 20.2h7"/>'),
  tv: I('<rect x="3" y="4.5" width="18" height="12.5" rx="2.5"/><path d="M8.5 20.5h7"/>'),
  download: I('<path d="M12 4v11M7.8 11l4.2 4.2 4.2-4.2M5 19.5h14"/>'),
  trash: I('<path d="M4.5 7h15M10 7V4.5h4V7M6.5 7l.9 12.2a1.8 1.8 0 001.8 1.6h5.6a1.8 1.8 0 001.8-1.6L17.5 7"/>'),
  mail: I('<rect x="3.5" y="5.5" width="17" height="13" rx="2.8"/><path d="M4.5 7.5l7.5 5.5 7.5-5.5"/>'),
  chevron: I('<path d="M9.5 6l6 6-6 6"/>'),
  wifi: I('<path d="M3.5 9.2a12.2 12.2 0 0117 0M6.6 12.5a7.8 7.8 0 0110.8 0"/><circle class="ac" cx="12" cy="16.6" r="1.6" fill="currentColor" stroke="none"/>'),
  key: I('<circle cx="8.2" cy="12" r="3.6"/><path d="M11.8 12H20M17 12v3M14.5 12v2"/>'),
  sparkle: I('<path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z"/>'),
  moon: I('<path d="M19.5 14.6A8 8 0 019.4 4.5a8 8 0 1010.1 10.1z"/>'),
  sun: I('<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4"/>'),
} as const;

export type IconName = keyof typeof SOURCE;
export const ICON_NAMES = Object.keys(SOURCE) as IconName[];

/** The icon as markup. `size` sets width and height in CSS px; otherwise the surrounding CSS decides. */
export function icon(name: IconName, o: { size?: number; className?: string } = {}): SafeHtml {
  let svg: string = SOURCE[name];
  const attrs = `${o.size ? ` width="${o.size}" height="${o.size}"` : ''}${o.className ? ` class="${o.className.replace(/[^a-zA-Z0-9 _-]/g, '')}"` : ''}`;
  if (attrs) svg = svg.replace('<svg ', `<svg${attrs} `);
  return raw(svg);
}
