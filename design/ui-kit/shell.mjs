// Shared pieces for the UI kit pages: the app shell (top bar, bottom tab bar, side rail),
// icons, move glyphs, game tiles and the theme pin. The UI builder ports these to
// packages/core/ui; class names match kit.css and shell.css.
import { glyph } from '../brand/glyphs.mjs';
import { GAMES, REGION_LABEL } from './games.mjs';
import { duoAvailable } from '../tokens/layout.mjs';

export { GAMES, REGION_LABEL, glyph, duoAvailable };

export const q = new URLSearchParams(location.search);
export const theme = q.get('theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
document.documentElement.dataset.theme = theme;
export const bigScreen = () => duoAvailable({ w: innerWidth, h: innerHeight });

// 24 x 24 line icons: 2.2 stroke, round caps, the flush accent on parts with class "ac".
const I = (body, extra = '') => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${body}</svg>`;
export const ICON = {
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
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.6v12.8a1 1 0 001.5.86l10.4-6.4a1 1 0 000-1.72L9.5 4.74A1 1 0 008 5.6z" fill="currentColor"/></svg>',
  plus: I('<path d="M12 5v14M5 12h14"/>'),
  check: I('<path d="M5 12.5l4.4 4.4L19 7.4"/>'),
  clock: I('<circle cx="12" cy="12.5" r="8"/><path d="M12 8.2v4.6l3 1.8"/>'),
  chair: I('<path d="M7 3.8v9.4h10M7 13.2V21M17 13.2V21M7 17.4h10"/>'),
  quiet: I('<path d="M4 9.5h3.5L12 5.6v12.8l-4.5-3.9H4z"/><path class="ac" d="M16 9.5l4.4 4.6M20.4 9.5L16 14.1"/>'),
  info: I('<circle cx="12" cy="12" r="8.4"/><path d="M12 11v5.2"/><circle cx="12" cy="7.7" r="1.2" fill="currentColor" stroke="none"/>'),
  shield: I('<path d="M12 3.2l7.4 2.9v5.6c0 4.5-3.1 8-7.4 9.4-4.3-1.4-7.4-4.9-7.4-9.4V6.1z"/><path class="ac" d="M8.6 12.2l2.4 2.4 4.6-4.8"/>'),
  globe: I('<circle cx="12" cy="12" r="8.4"/><path d="M3.8 12h16.4M12 3.6c2.6 2.7 2.6 14.1 0 16.8M12 3.6c-2.6 2.7-2.6 14.1 0 16.8"/>'),
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.7 5.7 6.2.8-4.6 4.3 1.2 6.2L12 16.8l-5.5 3 1.2-6.2-4.6-4.3 6.2-.8z" fill="currentColor"/></svg>',
  host: I('<path class="ac" d="M4 17.5l1.4-9.2 4.4 4.1L12 6l2.2 6.4 4.4-4.1 1.4 9.2z"/><path d="M4.5 20.5h15"/>'),
  search: I('<circle cx="10.8" cy="10.8" r="6.3"/><path d="M15.6 15.6L20 20"/>'),
  door: I('<path d="M14 4.5H7.5A2 2 0 005.5 6.5v11a2 2 0 002 2H14"/><path d="M10.5 12h9.5M17 8.8l3.2 3.2-3.2 3.2"/>'),
  user: I('<circle cx="12" cy="8" r="3.6"/><path d="M5 20c.6-4 3.3-6.6 7-6.6s6.4 2.6 7 6.6"/>'),
  replay: I('<path d="M4.5 12a7.5 7.5 0 102.2-5.3"/><path d="M4.5 4.3v4.2h4.2"/><path class="ac" d="M10.5 9.2v5.6l4.4-2.8z" fill="currentColor" stroke="none"/>'),
  trophy: I('<path d="M7.5 4.5h9v4.8a4.5 4.5 0 01-9 0z"/><path d="M7.5 6.5H4.5a3 3 0 003 4M16.5 6.5h3a3 3 0 01-3 4M12 13.8v3.4M8.5 20.2h7"/>'),
  tv: I('<rect x="3" y="4.5" width="18" height="12.5" rx="2.5"/><path d="M8.5 20.5h7"/>'),
  download: I('<path d="M12 4v11M7.8 11l4.2 4.2 4.2-4.2M5 19.5h14"/>'),
  trash: I('<path d="M4.5 7h15M10 7V4.5h4V7M6.5 7l.9 12.2a1.8 1.8 0 001.8 1.6h5.6a1.8 1.8 0 001.8-1.6L17.5 7"/>'),
  mail: I('<rect x="3.5" y="5.5" width="17" height="13" rx="2.8"/><path d="M4.5 7.5l7.5 5.5 7.5-5.5"/>'),
  chevron: I('<path d="M9.5 6l6 6-6 6"/>'),
  wifi: I('<path d="M3.5 9.2a12.2 12.2 0 0117 0M6.6 12.5a7.8 7.8 0 0110.8 0"/><circle class="ac" cx="12" cy="16.6" r="1.6" fill="currentColor" stroke="none"/>'),
};

export const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
export const logoSrc = () => (theme === 'dark' ? '../brand/logo-dark.svg' : '../brand/logo.svg');

const TABS = [
  { id: 'arcade', label: 'Arcade', href: 'home.html', icon: 'arcade' },
  { id: 'programs', label: 'Programs', href: 'home.html#programs', icon: 'programs' },
  { id: 'friends', label: 'Friends', href: 'friends.html', icon: 'friends' },
  { id: 'profile', label: 'Profile', href: 'settings.html', icon: 'profile' },
];

/** Avatar: the player's move figure in their colour on a soft disc. */
export function avatar(color = '#FF4F6E', pose = 'stand', presence = null, size = '') {
  const dot = presence ? `<span class="dot ${presence}" aria-hidden="true"></span>` : '';
  return `<span class="ba-avatar ${size}" style="--av:${color}">${glyph(pose, { ink: 'currentColor', accent: color, ball: color, floor: false, highlight: [], size: 100, title: '' })}${dot}</span>`;
}

/** Top bar (wide screens), bottom tab bar (phones), side rail (landscape phones). */
export function mountShell(active = 'arcade', { me = 'Doruk' } = {}) {
  const tabs = TABS.map((t) => `<a class="ba-tab" href="${t.href}"${t.id === active ? ' aria-current="page"' : ''}>${ICON[t.icon]}<span>${t.label}</span></a>`).join('');
  const top = TABS.map((t) => `<a href="${t.href}"${t.id === active ? ' aria-current="page"' : ''}>${ICON[t.icon]}${t.label}</a>`).join('');
  document.body.prepend(el(`<header class="ba-topbar"><a href="home.html" aria-label="BodyArcade home"><img src="${logoSrc()}" alt="BodyArcade" width="170" height="32"></a><nav aria-label="Main">${top}</nav><a class="ba-me" href="settings.html">${avatar('#FF4F6E', 'stand', null, 'sm')}<span>${me}</span></a></header>`));
  document.body.append(el(`<nav class="ba-tabbar" aria-label="Main">${tabs}</nav>`));
}

/** Small header for phones: logo left, actions right. */
export function mobileHead(actions = '') {
  return `<div class="ba-mobilehead"><img src="${logoSrc()}" alt="BodyArcade" width="150" height="28"><div class="ba-row-wrap">${actions}</div></div>`;
}

/** Fill every [data-glyph] element with its move glyph. */
export function fillGlyphs(root = document) {
  for (const n of root.querySelectorAll('[data-glyph]')) {
    const hl = (n.dataset.hl || '').split(',').filter(Boolean);
    n.innerHTML = glyph(n.dataset.glyph, { ink: 'currentColor', highlight: hl, floor: n.dataset.floor !== '0', size: 100, title: n.dataset.title ?? '', ball: n.dataset.ball || undefined });
  }
}

/** Fill every [data-icon] element with its icon. */
export function fillIcons(root = document) {
  for (const n of root.querySelectorAll('[data-icon]')) n.insertAdjacentHTML('afterbegin', ICON[n.dataset.icon] || '');
}

const game = (id) => GAMES.find((g) => g.id === id);
export const artSrc = (id, small = true) => `../art/tiles/${id}${small ? '-400' : ''}.webp`;

/** A catalogue tile: 3D art, name, region and round length, Pro badge, seated marker. */
export function gameTile(id, { duo = false } = {}) {
  const g = game(id);
  const pro = g.tier === 'pro' ? '<span class="ba-badge ba-badge--pro">Pro</span>' : '';
  const two = duo && g.local2 ? '<span class="ba-tag2" title="2 players on one camera">2 players</span>' : '';
  return `<a class="ba-tile" href="game.html?game=${g.id}" data-region="${g.region}" data-template="${g.template}">
    <span class="art"><img src="${artSrc(g.id)}" srcset="${artSrc(g.id)} 400w, ${artSrc(g.id, false)} 800w" sizes="(min-width: 900px) 300px, 50vw" alt="" loading="lazy" width="400" height="300">${pro}</span>
    <span class="t">${g.name}</span>
    <span class="meta"><span data-glyph="${g.moves[0] === 'tPose' ? 'tPose' : g.moves[0]}" data-floor="0"></span><span class="r">${REGION_LABEL[g.region]}</span>${g.seated ? `<span class="ba-seat" title="Seated version">${ICON.chair}<span class="ba-visually-hidden">Seated version</span></span>` : ''}${two}</span>
  </a>`;
}

/** Page header for pushed screens: back button, title, actions on the right. */
export function pageHead(title, { back = null, actions = '' } = {}) {
  return `<div class="k-head">${back ? `<a class="ba-icon-btn" href="${back}" aria-label="Back">${ICON.back}</a>` : ''}<div class="grow">${title ? `<h1>${title}</h1>` : ''}</div>${actions}</div>`;
}

/** Our own drawn reactions for rooms and lobbies (no emoji glyphs): star, heart, flame, high five. */
export const REACTIONS = {
  star: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 4.5l3.5 7.2 7.9 1.1-5.7 5.5 1.4 7.8L16 22.4l-7.1 3.7 1.4-7.8-5.7-5.5 7.9-1.1z" fill="#C98F12" transform="translate(0 1.6)"/><path d="M16 4.5l3.5 7.2 7.9 1.1-5.7 5.5 1.4 7.8L16 22.4l-7.1 3.7 1.4-7.8-5.7-5.5 7.9-1.1z" fill="#FFC53A"/></svg>',
  heart: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 27.5s-10.5-6.3-10.5-13.6A5.8 5.8 0 0116 10.4a5.8 5.8 0 0110.5 3.5c0 7.3-10.5 13.6-10.5 13.6z" fill="#C7334F" transform="translate(0 1.6)"/><path d="M16 27.5s-10.5-6.3-10.5-13.6A5.8 5.8 0 0116 10.4a5.8 5.8 0 0110.5 3.5c0 7.3-10.5 13.6-10.5 13.6z" fill="#FF4F6E"/><path d="M10.2 13.2a2.6 2.6 0 012.4-1.9" stroke="#FFE3E9" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>',
  flame: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 29c-5.7 0-9.2-3.7-9.2-8.6 0-4.6 3.3-7.1 4.8-11.3.3-.9 1.5-1 2-.2 1 1.6 1.4 3.4 1.2 5.3 1.7-1.4 2.7-3.5 2.7-5.8 0-.8.9-1.3 1.6-.8 3.7 2.6 6.1 7.3 6.1 12.6 0 5-3.5 8.8-9.2 8.8z" fill="#FF4F6E"/><path d="M16.2 28.6c-2.7 0-4.4-1.8-4.4-4.1 0-2.6 2.2-3.8 3.1-6.4.6 1.5 1.6 2.3 2.6 2.3.4-.8.6-1.6.6-2.5 1.6 1.4 2.6 3.6 2.6 5.7 0 3-1.9 5-4.5 5z" fill="#FFC53A"/></svg>',
  hand: '<svg viewBox="0 0 32 32" aria-hidden="true"><g fill="#46B4FF"><rect x="9" y="5.5" width="3.6" height="13" rx="1.8"/><rect x="13.2" y="3.6" width="3.6" height="14" rx="1.8"/><rect x="17.4" y="4.6" width="3.6" height="13.5" rx="1.8"/><rect x="21.6" y="7.4" width="3.4" height="11.5" rx="1.7"/><path d="M8.6 16.5h16.4v4.5a7.4 7.4 0 01-7.4 7.4h-1.6a7.4 7.4 0 01-6.5-3.9l-3.3-6.3a2 2 0 013.4-2.1z"/></g><path d="M12 21.5c1.4 1 2.8 1.4 4.3 1.4" stroke="#1C1433" stroke-width="1.6" stroke-linecap="round" fill="none" opacity="0.35"/></svg>',
};

/** A QR-like code drawn from a seed. Prototype art only: the app draws a real QR for the link. */
export function qrArt(seed = 'BA-7K2Q', n = 25) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const rnd = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) / 4294967296);
  const finder = (x, y) => x < 8 && y < 8 || x >= n - 8 && y < 8 || x < 8 && y >= n - 8;
  let d = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!finder(x, y) && rnd() > 0.52) d += `M${x} ${y}h1v1h-1z`;
  const eye = (x, y) => `<rect x="${x + 0.5}" y="${y + 0.5}" width="6" height="6" rx="1.6" fill="none" stroke="#1C1433" stroke-width="1"/><rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="0.8" fill="#1C1433"/>`;
  return `<svg viewBox="-1 -1 ${n + 2} ${n + 2}" role="img" aria-label="QR code"><path d="${d}" fill="#1C1433"/>${eye(0, 0)}${eye(n - 7, 0)}${eye(0, n - 7)}<rect x="${n / 2 - 2.2}" y="${n / 2 - 2.2}" width="4.4" height="4.4" rx="1.2" fill="#FF4F6E" stroke="#fff" stroke-width="0.8"/></svg>`;
}

/** Mark the page ready for the headless checks once fonts and images are in. */
export async function ready() {
  await document.fonts.ready;
  await Promise.all([...document.images].filter((i) => !i.complete).map((i) => new Promise((ok) => { i.onload = i.onerror = ok; })));
  document.documentElement.dataset.ready = '1';
}
