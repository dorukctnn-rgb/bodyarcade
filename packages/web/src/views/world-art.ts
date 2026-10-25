// A small picture of one Road Run world, drawn from the world's own theme (render3d/themes/classic-worlds.json): the three
// colours of its sky, where its sun stands, the shape and colours of its horizon, its ground, its road and the weather that
// falls on it. Nothing is invented here: change a colour in the theme and the picture follows. The picture is decoration (the
// name beside it says what it is), so it is hidden from assistive technology.
import { raw, type SafeHtml } from '../../../core/ui/html.ts';
import type { Theme } from '../../../core/render3d/theme.ts';

/** Where the road meets the horizon, in the picture's 160 x 100 box. */
const H = 54;
const W = 160;
const B = 100;

/** The aurora of the sky shader (render3d/sky.ts: vec3(0.25, 0.9, 0.55)). */
const AURORA = '#40e68c';

/** Positions in the picture (a share of its width and height) for stars and falling things: fixed, so the picture never changes. */
const SPECKS: readonly (readonly [number, number])[] = [
  [0.06, 0.1], [0.17, 0.46], [0.24, 0.2], [0.33, 0.62], [0.41, 0.08], [0.48, 0.38], [0.55, 0.74], [0.63, 0.16], [0.7, 0.52],
  [0.78, 0.3], [0.86, 0.82], [0.93, 0.12], [0.12, 0.84], [0.29, 0.9], [0.59, 0.94], [0.97, 0.58], [0.82, 0.66], [0.04, 0.68],
];

const n = (v: number): string => String(Math.round(v * 10) / 10);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** A colour from the theme. The theme parser has already held it to #rgb or #rrggbb; anything else becomes grey rather than markup. */
const hex = (c: string): string => (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c) ? c : '#808080');

function horizon(t: Theme): string {
  const far = hex(t.horizon.colorFar);
  const near = hex(t.horizon.colorNear);
  switch (t.horizon.kind) {
    case 'mountains': {
      const caps = t.horizon.snow
        ? ['44,27 38.4,33 41.4,32.2 44,34.6 46.6,32.2 49.6,33', '118,29 113,34 115.6,33.3 118,35.6 120.4,33.3 123,34', '80,31 76,35 78,34.4 80,36.2 82,34.4 84,35']
          .map((p) => `<polygon points="${p}" fill="#f4f8fb" opacity="0.92"/>`).join('')
        : '';
      return `<polygon points="0,${H} 0,43 14,34 26,41 44,27 62,40 80,31 98,42 118,29 138,40 160,33 160,${H}" fill="${far}"/>${caps}`
        + `<polygon points="0,${H} 0,48 20,41 38,49 60,40 84,50 108,42 132,49 160,43 160,${H}" fill="${near}"/>`;
    }
    case 'dunes':
      return `<path d="M0 ${H}V46Q22 38 46 45T96 44T160 42V${H}Z" fill="${far}"/><path d="M0 ${H}V50Q30 43 62 50T124 49T160 48V${H}Z" fill="${near}"/>`;
    case 'hills':
      return `<path d="M0 ${H}V45Q38 33 80 45T160 43V${H}Z" fill="${far}"/><path d="M0 ${H}V50Q46 41 96 50T160 48V${H}Z" fill="${near}"/>`;
    case 'forest': {
      const row = (step: number, off: number, base: number, wob: number, mod: number, half: number, color: string): string => {
        let d = '';
        for (let i = 0; i * step - 6 < W; i++) {
          const x = i * step + off;
          const h = base + ((i * wob) % mod);
          d += `M${n(x - half)} ${H}L${n(x)} ${n(H - h)}L${n(x + half)} ${H}Z`;
        }
        return `<path d="${d}" fill="${color}"/>`;
      };
      return row(10, 3, 13, 5, 7, 6.5, far) + row(10, 8, 8, 3, 5, 5.5, near);
    }
    case 'skyline': {
      let farRects = '';
      let nearRects = '';
      let windows = '';
      for (let i = 0; i * 11 < W; i++) farRects += `<rect x="${i * 11}" y="${n(H - (12 + ((i * 7) % 14)))}" width="9.4" height="${n(30)}" fill="${far}"/>`;
      for (let i = 0; i * 12 < W; i++) {
        const h = 7 + ((i * 5) % 10);
        const x = i * 12 + 5;
        nearRects += `<rect x="${x}" y="${n(H - h)}" width="8.4" height="${n(h)}" fill="${near}"/>`;
        if (i % 2 === 0) windows += `<rect x="${n(x + 1.6)}" y="${n(H - h + 2)}" width="1.3" height="1.7"/><rect x="${n(x + 4.6)}" y="${n(H - h + 4.6)}" width="1.3" height="1.7"/>`;
      }
      return `${farRects}${nearRects}<g fill="${hex(t.sky.sunGlow)}" opacity="0.8">${windows}</g>`;
    }
    case 'islands':
      return `<g fill="${far}"><ellipse cx="26" cy="${H}" rx="22" ry="3.6"/><ellipse cx="78" cy="${H}" rx="27" ry="4.8"/><ellipse cx="130" cy="${H}" rx="21" ry="3.2"/></g>`
        + `<g fill="${near}"><ellipse cx="52" cy="${H}" rx="13" ry="2.4"/><ellipse cx="108" cy="${H}" rx="16" ry="2.6"/></g>`;
  }
}

function weather(t: Theme): string {
  const w = t.weather;
  if (!w) return '';
  const c = hex(w.color);
  const at = ([x, y]: readonly [number, number]): readonly [number, number] => [x * W, y * B];
  switch (w.kind) {
    case 'rain':
      return `<g stroke="${c}" stroke-width="0.6" stroke-linecap="round" opacity="0.6">${SPECKS.map((s) => { const [x, y] = at(s); return `<line x1="${n(x)}" y1="${n(y)}" x2="${n(x - 1.4)}" y2="${n(y + 5)}"/>`; }).join('')}</g>`;
    case 'snow':
      return `<g fill="${c}" opacity="0.9">${SPECKS.map((s, i) => { const [x, y] = at(s); return `<circle cx="${n(x)}" cy="${n(y)}" r="${i % 3 === 0 ? 1.2 : 0.8}"/>`; }).join('')}</g>`;
    case 'dust':
      return `<g fill="${c}" opacity="0.3">${SPECKS.filter((_, i) => i % 2 === 0).map((s) => { const [x, y] = at(s); return `<ellipse cx="${n(x)}" cy="${n(H + 4 + y * 0.4)}" rx="6" ry="1"/>`; }).join('')}</g>`;
    case 'leaves':
      return `<g fill="${c}" opacity="0.85">${SPECKS.filter((_, i) => i % 2 === 1).map((s, i) => { const [x, y] = at(s); return `<ellipse cx="${n(x)}" cy="${n(y)}" rx="1.6" ry="0.9" transform="rotate(${i * 37 % 90 - 20} ${n(x)} ${n(y)})"/>`; }).join('')}</g>`;
    case 'embers':
      return `<g fill="${c}" opacity="0.9">${SPECKS.map((s, i) => { const [x, y] = at(s); return `<circle cx="${n(x)}" cy="${n(H - 6 + y * 0.6)}" r="${i % 3 === 0 ? 1 : 0.7}"/>`; }).join('')}</g>`;
  }
}

/** The road: a trapezoid from the horizon to the bottom edge, its edge lines, and the dashes between its lanes. */
function road(t: Theme): string {
  const topL = 78.6, topR = 81.4, botL = 30, botR = 130;
  const left = (s: number): number => topL + (botL - topL) * s;
  const right = (s: number): number => topR + (botR - topR) * s;
  const yAt = (s: number): number => H + (B - H) * s;
  const base = hex(t.road.base);
  const edge = hex(t.road.edge);
  const line = hex(t.road.line);
  let out = `<polygon points="${topL},${H} ${topR},${H} ${botR},${B} ${botL},${B}" fill="${base}"/>`;
  if (t.road.wet) out += `<polygon points="${topL},${H} ${topR},${H} ${botR},${B} ${botL},${B}" fill="url(#wa-${t.id}-wet)"/>`;
  out += `<g stroke="${edge}" stroke-linecap="round"><line x1="${topL}" y1="${H}" x2="${botL + 1}" y2="${B}" stroke-width="1.5"/><line x1="${topR}" y1="${H}" x2="${botR - 1}" y2="${B}" stroke-width="1.5"/></g>`;
  const lanes = Math.max(2, Math.min(5, Math.round(t.road.lanes)));
  const dashes: readonly (readonly [number, number])[] = [[0.07, 0.15], [0.27, 0.41], [0.56, 0.76], [0.89, 1.04]];
  let marks = '';
  for (let k = 1; k < lanes; k++) {
    const share = k / lanes;
    for (const [a, b] of dashes) {
      const x = (s: number): number => left(s) + (right(s) - left(s)) * share;
      marks += `<line x1="${n(x(a))}" y1="${n(yAt(a))}" x2="${n(x(b))}" y2="${n(yAt(b))}" stroke-width="${n(0.35 + 1.5 * ((a + b) / 2))}"/>`;
    }
  }
  return `${out}<g stroke="${line}" stroke-linecap="butt">${marks}</g>`;
}

/** The picture as an inline SVG that fills its box (it is cropped, never stretched). `id` keeps the gradients of two pictures apart. */
export function worldArt(t: Theme): SafeHtml {
  const id = `wa-${t.id}`;
  const sky = t.sky;
  const sx = clamp(80 + t.sun.pos[0] * 1.4, 18, 142);
  const sy = clamp(H - t.sun.pos[1] * 0.95, 9, 50);
  const water = t.water;
  const ground = hex(t.ground);
  const noise = hex(t.groundNoise);
  const parts: string[] = [];
  parts.push(`<defs>
    <linearGradient id="${id}-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hex(sky.top)}"/><stop offset="0.55" stop-color="${hex(sky.mid)}"/><stop offset="1" stop-color="${hex(sky.bot)}"/></linearGradient>
    <radialGradient id="${id}-sun"><stop offset="0" stop-color="${hex(sky.sunGlow)}" stop-opacity="0.95"/><stop offset="1" stop-color="${hex(sky.sunGlow)}" stop-opacity="0"/></radialGradient>
    <linearGradient id="${id}-haze" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hex(t.fog.color)}" stop-opacity="0"/><stop offset="0.5" stop-color="${hex(t.fog.color)}" stop-opacity="0.55"/><stop offset="1" stop-color="${hex(t.fog.color)}" stop-opacity="0"/></linearGradient>
    <linearGradient id="${id}-ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${ground}"/><stop offset="1" stop-color="${water ? noise : ground}"/></linearGradient>
    <linearGradient id="${id}-wet" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hex(sky.bot)}" stop-opacity="0"/><stop offset="1" stop-color="${hex(sky.bot)}" stop-opacity="0.32"/></linearGradient>
    ${t.glow ? `<radialGradient id="${id}-glow"><stop offset="0" stop-color="${hex(t.glow)}" stop-opacity="0.55"/><stop offset="1" stop-color="${hex(t.glow)}" stop-opacity="0"/></radialGradient>` : ''}
  </defs>`);
  parts.push(`<rect width="${W}" height="${H + 1}" fill="url(#${id}-sky)"/>`);
  if (sky.stars > 0) parts.push(`<g fill="#ffffff" opacity="${n(0.35 + 0.55 * clamp(sky.stars, 0, 1))}">${SPECKS.slice(0, 13).map(([x, y], i) => `<circle cx="${n(x * W)}" cy="${n(y * 38)}" r="${i % 4 === 0 ? 0.9 : 0.55}"/>`).join('')}</g>`);
  if (sky.aurora) parts.push(`<path d="M0 36Q36 20 76 30T160 24V33Q120 42 76 37T0 44Z" fill="${AURORA}" opacity="0.3"/><path d="M0 40Q40 28 80 36T160 31V35Q120 45 80 41T0 46Z" fill="${AURORA}" opacity="0.18"/>`);
  parts.push(`<circle cx="${n(sx)}" cy="${n(sy)}" r="24" fill="url(#${id}-sun)"/><circle cx="${n(sx)}" cy="${n(sy)}" r="3.2" fill="${hex(t.sun.color)}" opacity="0.95"/>`);
  if (sky.clouds) {
    const c = hex(sky.clouds);
    const cloud = (x: number, y: number): string => `<g fill="${c}" opacity="0.82"><ellipse cx="${x}" cy="${y}" rx="11" ry="3.6"/><ellipse cx="${x - 5}" cy="${y - 2.2}" rx="6" ry="3.4"/><ellipse cx="${x + 4.5}" cy="${y - 2.6}" rx="5" ry="3.1"/></g>`;
    parts.push(cloud(32, 20) + cloud(114, 13) + cloud(140, 31));
  }
  parts.push(horizon(t));
  parts.push(`<rect y="${H}" width="${W}" height="${B - H}" fill="url(#${id}-ground)"/>`);
  if (water) parts.push(`<g stroke="#ffffff" stroke-width="0.7" opacity="0.28" stroke-linecap="round"><line x1="6" y1="64" x2="30" y2="64"/><line x1="128" y1="62" x2="156" y2="62"/><line x1="14" y1="80" x2="40" y2="80"/><line x1="122" y1="86" x2="150" y2="86"/><line x1="4" y1="94" x2="22" y2="94"/></g>`);
  else parts.push(`<g fill="${noise}" opacity="0.6"><ellipse cx="18" cy="80" rx="26" ry="9"/><ellipse cx="144" cy="70" rx="22" ry="6.5"/><ellipse cx="128" cy="95" rx="30" ry="7"/><ellipse cx="34" cy="62" rx="16" ry="3.6"/></g>`);
  parts.push(`<rect y="${H - 10}" width="${W}" height="20" fill="url(#${id}-haze)"/>`);
  parts.push(road(t));
  parts.push(weather(t));
  if (t.glow) parts.push(`<ellipse cx="80" cy="${H + 2}" rx="78" ry="20" fill="url(#${id}-glow)"/>`);
  if (t.lightning) parts.push(`<polyline points="58,4 52,22 58,22 49,42" fill="none" stroke="#eef4ff" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" opacity="0.9"/>`);
  return raw(`<svg class="wa" viewBox="0 0 ${W} ${B}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">${parts.join('')}</svg>`);
}
