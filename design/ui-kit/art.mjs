// Shared illustration helpers for the UI kit mockups: the camera placeholder (a stylised
// living room with a player and the tracked skeleton) and a Squat Flap scene.
// Placeholders only. In the product the camera image is the real camera, on the device.

const cap = (x1, y1, x2, y2, w, c, extra = '') =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="${w}" stroke-linecap="round" ${extra}/>`;

// Joints of the player in the camera frame (normalised 0..1), a squat seen from the front.
const POSES = {
  squat: {
    head: [0.5, 0.25], neck: [0.5, 0.35], hipL: [0.45, 0.58], hipR: [0.55, 0.58],
    shL: [0.43, 0.37], shR: [0.57, 0.37], elL: [0.38, 0.47], elR: [0.62, 0.47], haL: [0.44, 0.47], haR: [0.56, 0.47],
    knL: [0.37, 0.69], knR: [0.63, 0.69], ftL: [0.4, 0.86], ftR: [0.6, 0.86],
  },
  stand: {
    head: [0.5, 0.17], neck: [0.5, 0.27], hipL: [0.46, 0.52], hipR: [0.54, 0.52],
    shL: [0.43, 0.29], shR: [0.57, 0.29], elL: [0.41, 0.4], elR: [0.59, 0.4], haL: [0.41, 0.5], haR: [0.59, 0.5],
    knL: [0.46, 0.69], knR: [0.54, 0.69], ftL: [0.46, 0.86], ftR: [0.54, 0.86],
  },
  jack: {
    head: [0.5, 0.17], neck: [0.5, 0.27], hipL: [0.46, 0.52], hipR: [0.54, 0.52],
    shL: [0.43, 0.29], shR: [0.57, 0.29], elL: [0.35, 0.2], elR: [0.65, 0.2], haL: [0.31, 0.1], haR: [0.69, 0.1],
    knL: [0.41, 0.69], knR: [0.59, 0.69], ftL: [0.36, 0.86], ftR: [0.64, 0.86],
  },
  reach: {
    head: [0.5, 0.22], neck: [0.5, 0.32], hipL: [0.46, 0.56], hipR: [0.54, 0.56],
    shL: [0.43, 0.34], shR: [0.57, 0.34], elL: [0.36, 0.25], elR: [0.62, 0.43], haL: [0.31, 0.14], haR: [0.6, 0.52],
    knL: [0.45, 0.71], knR: [0.55, 0.71], ftL: [0.44, 0.87], ftR: [0.56, 0.87],
  },
};

function roomSvg(w, h, s) {
  return [
    `<rect width="${w}" height="${h}" fill="#D8CDBE"/>`,
    `<rect x="${w * 0.62}" y="${h * 0.08}" width="${w * 0.3}" height="${h * 0.36}" rx="${4 * s}" fill="#EFE8DA"/>`,
    `<rect x="${w * 0.62}" y="${h * 0.08}" width="${w * 0.3}" height="${h * 0.36}" rx="${4 * s}" fill="none" stroke="#B9AC98" stroke-width="${3 * s}"/>`,
    `<rect y="${h * 0.7}" width="${w}" height="${h * 0.3}" fill="#A8896B"/>`,
    `<rect y="${h * 0.7}" width="${w}" height="${h * 0.012}" fill="#8E7258"/>`,
    `<rect x="${w * 0.04}" y="${h * 0.5}" width="${w * 0.3}" height="${h * 0.22}" rx="${10 * s}" fill="#7B8088"/>`,
    `<rect x="${w * 0.04}" y="${h * 0.45}" width="${w * 0.3}" height="${h * 0.1}" rx="${10 * s}" fill="#8A8F97"/>`,
    `<ellipse cx="${w * 0.5}" cy="${h * 0.9}" rx="${w * 0.36}" ry="${h * 0.05}" fill="#C46B5A" opacity="0.55"/>`,
    `<rect x="${w * 0.86}" y="${h * 0.52}" width="${w * 0.08}" height="${h * 0.2}" rx="${3 * s}" fill="#6E5D4C"/>`,
    `<circle cx="${w * 0.9}" cy="${h * 0.48}" r="${w * 0.07}" fill="#5E7D58"/>`,
  ].join('');
}

/** A player in the camera frame: body box centred at cx, feet near the floor. */
function playerSvg({ pose, cx, bodyH, floorY, skeleton = true, jointColor = '#FF4F6E', clothes = ['#3E4B63', '#4A4A55'], skin = '#C98D6A', hair = '#2F2622' }) {
  const P = POSES[pose];
  const bx = cx - bodyH * 0.31, by = floorY - bodyH;
  const X = (p) => bx + p[0] * bodyH * 0.62, Y = (p) => by + p[1] * bodyH;
  const s = bodyH / 400;
  const [top, legs] = clothes;
  const out = [
    cap(X(P.hipL), Y(P.hipL), X(P.knL), Y(P.knL), 30 * s, legs), cap(X(P.knL), Y(P.knL), X(P.ftL), Y(P.ftL), 26 * s, legs),
    cap(X(P.hipR), Y(P.hipR), X(P.knR), Y(P.knR), 30 * s, legs), cap(X(P.knR), Y(P.knR), X(P.ftR), Y(P.ftR), 26 * s, legs),
    `<path d="M${X(P.shL)} ${Y(P.shL)} L${X(P.shR)} ${Y(P.shR)} L${X(P.hipR) + 6 * s} ${Y(P.hipR)} L${X(P.hipL) - 6 * s} ${Y(P.hipL)} Z" fill="${top}" stroke="${top}" stroke-width="${26 * s}" stroke-linejoin="round"/>`,
    cap(X(P.shL), Y(P.shL), X(P.elL), Y(P.elL), 20 * s, top), cap(X(P.elL), Y(P.elL), X(P.haL), Y(P.haL), 17 * s, skin),
    cap(X(P.shR), Y(P.shR), X(P.elR), Y(P.elR), 20 * s, top), cap(X(P.elR), Y(P.elR), X(P.haR), Y(P.haR), 17 * s, skin),
    `<circle cx="${X(P.head)}" cy="${Y(P.head)}" r="${27 * s}" fill="${skin}"/>`,
    `<path d="M${X(P.head) - 28 * s} ${Y(P.head) - 4 * s} a${28 * s} ${28 * s} 0 0 1 ${56 * s} 0 l0 ${-8 * s} a${28 * s} ${24 * s} 0 0 0 ${-56 * s} 0 z" fill="${hair}"/>`,
  ];
  if (skeleton) {
    const c = '#F4F2F8', lw = Math.max(2, 5 * s), jr = Math.max(2.5, 6 * s);
    const bones = [['shL', 'shR'], ['shL', 'elL'], ['elL', 'haL'], ['shR', 'elR'], ['elR', 'haR'], ['shL', 'hipL'], ['shR', 'hipR'], ['hipL', 'hipR'], ['hipL', 'knL'], ['knL', 'ftL'], ['hipR', 'knR'], ['knR', 'ftR']];
    for (const [a, b] of bones) out.push(cap(X(P[a]), Y(P[a]), X(P[b]), Y(P[b]), lw, c, 'opacity="0.95"'));
    for (const k of ['shL', 'shR', 'elL', 'elR', 'haL', 'haR', 'hipL', 'hipR', 'knL', 'knR', 'ftL', 'ftR']) out.push(`<circle cx="${X(P[k])}" cy="${Y(P[k])}" r="${jr}" fill="${jointColor}" stroke="#1C1433" stroke-width="${Math.max(1, 1.5 * s)}"/>`);
    out.push(`<circle cx="${X(P.head)}" cy="${Y(P.head)}" r="${jr * 1.25}" fill="${jointColor}" stroke="#1C1433" stroke-width="${Math.max(1, 1.5 * s)}"/>`);
  }
  return { svg: out.join(''), by, s, X, Y };
}

/**
 * Camera placeholder: room + player + skeleton.
 * opts: { w, h, pose, skeleton: bool, line: y (0..1) or null, lineLabel }
 */
export function cameraArt({ w = 300, h = 400, pose = 'squat', skeleton = true, line = null, lineLabel = 'Squat line', dim = false } = {}) {
  const bodyH = Math.min(h * 0.8, w * 1.45);
  const floorY = h - h * 0.03;
  const s = bodyH / 400;
  const pl = playerSvg({ pose, cx: w / 2, bodyH, floorY, skeleton });
  const sk = [];
  if (line != null) {
    const ly = pl.by + line * bodyH;
    sk.push(cap(w * 0.12, ly, w * 0.88, ly, Math.max(3, 7 * s), '#FF4F6E', `stroke-dasharray="${14 * s} ${10 * s}"`));
    if (lineLabel && w > 160) {
      const fs = Math.max(10, 16 * s);
      sk.push(`<rect x="${w * 0.88 - fs * 6}" y="${ly - fs * 1.9}" width="${fs * 6}" height="${fs * 1.5}" rx="${fs * 0.4}" fill="#FF4F6E"/>`);
      sk.push(`<text x="${w * 0.88 - fs * 3}" y="${ly - fs * 0.78}" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" font-weight="700" font-size="${fs}" fill="#1C1433">${lineLabel}</text>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice" width="100%" height="100%" aria-hidden="true"><g ${dim ? 'opacity="0.9"' : ''}>${roomSvg(w, h, s)}</g>${pl.svg}${sk.join('')}</svg>`;
}

/**
 * Camera placeholder for 2 players, same camera: two people side by side, each skeleton in
 * the player colour (Player 1 left, sun; Player 2 right, sky). away: 'p1' | 'p2' hides one.
 * guide: draw the two framing outlines used by the 2-player calibration.
 */
export function cameraArtDuo({ w = 640, h = 360, away = null, guide = false, poses = ['squat', 'stand'] } = {}) {
  const bodyH = h * 0.8, floorY = h - h * 0.03, s = bodyH / 400;
  const p1 = away === 'p1' ? '' : playerSvg({ pose: poses[0], cx: w * 0.31, bodyH, floorY, jointColor: '#FFC53A' }).svg;
  const p2 = away === 'p2' ? '' : playerSvg({ pose: poses[1], cx: w * 0.69, bodyH, floorY, jointColor: '#46B4FF', clothes: ['#7A3F55', '#3F4650'], skin: '#E0B08E', hair: '#5A3B26' }).svg;
  const tag = (x, label, color) => `<g><rect x="${x - 34 * s}" y="${h * 0.035}" width="${68 * s}" height="${24 * s}" rx="${12 * s}" fill="${color}"/><text x="${x}" y="${h * 0.035 + 17 * s}" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" font-weight="800" font-size="${15 * s}" fill="#1C1433">${label}</text></g>`;
  const outlines = guide ? [[0.31, '#FFC53A'], [0.69, '#46B4FF']].map(([fx, c]) => `<rect x="${w * fx - bodyH * 0.22}" y="${floorY - bodyH - h * 0.02}" width="${bodyH * 0.44}" height="${bodyH + h * 0.02}" rx="${bodyH * 0.2}" fill="none" stroke="${c}" stroke-width="${Math.max(2, 3 * s)}" stroke-dasharray="${10 * s} ${8 * s}"/>`).join('') : '';
  const divider = `<line x1="${w / 2}" y1="${h * 0.04}" x2="${w / 2}" y2="${h * 0.97}" stroke="#F4F2F8" stroke-width="${Math.max(1.5, 2.5 * s)}" stroke-dasharray="${6 * s} ${6 * s}" opacity="0.85"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice" width="100%" height="100%" aria-hidden="true">${roomSvg(w, h, s)}${divider}${outlines}${p1}${p2}${away === 'p1' ? '' : tag(w * 0.31, 'P1', '#FFC53A')}${away === 'p2' ? '' : tag(w * 0.69, 'P2', '#46B4FF')}</svg>`;
}

/** Skeleton-only tile for strangers and for privacy mode: no image at all. */
export function ghostArt({ w = 300, h = 400, pose = 'squat', color = '#46B4FF' } = {}) {
  const P = POSES[pose];
  const bodyH = Math.min(h * 0.92, w * 1.6);
  const bx = (w - bodyH * 0.62) / 2, by = h - bodyH - h * 0.02;
  const X = (p) => bx + p[0] * bodyH * 0.62, Y = (p) => by + p[1] * bodyH;
  const s = bodyH / 400;
  const bones = [['shL', 'shR'], ['shL', 'elL'], ['elL', 'haL'], ['shR', 'elR'], ['elR', 'haR'], ['shL', 'hipL'], ['shR', 'hipR'], ['hipL', 'hipR'], ['hipL', 'knL'], ['knL', 'ftL'], ['hipR', 'knR'], ['knR', 'ftR'], ['neck', 'head']];
  const out = [`<rect width="${w}" height="${h}" fill="#241C40"/>`, `<line x1="${w * 0.1}" y1="${by + 0.86 * bodyH + 10 * s}" x2="${w * 0.9}" y2="${by + 0.86 * bodyH + 10 * s}" stroke="#40366E" stroke-width="${6 * s}" stroke-linecap="round"/>`];
  for (const [a, b] of bones) out.push(cap(X(P[a]), Y(P[a]), X(P[b]), Y(P[b]), Math.max(3, 9 * s), color));
  out.push(`<circle cx="${X(P.head)}" cy="${Y(P.head)}" r="${22 * s}" fill="${color}"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" width="100%" height="100%" aria-hidden="true">${out.join('')}</svg>`;
}

/** Squat Flap scene (template B, flight), drawn to the exact viewport so nothing is cropped oddly. */
export function squatFlapScene(w, h, opts = {}) {
  const ground = Math.round(h * 0.11);
  const gy = h - ground;
  const out = [];
  out.push(`<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#A9B6F2"/><stop offset="0.62" stop-color="#E7D3EE"/><stop offset="1" stop-color="#FBE1D6"/></linearGradient></defs>`);
  out.push(`<rect width="${w}" height="${h}" fill="url(#sky)"/>`);
  out.push(`<circle cx="${w * 0.78}" cy="${h * 0.24}" r="${Math.min(w, h) * 0.07}" fill="#FFE7B8"/>`);
  // Three mountain layers, flat shapes.
  const ridge = (yBase, amp, seed, fill) => {
    let d = `M0 ${h} L0 ${yBase}`;
    const n = 7;
    for (let i = 0; i <= n; i++) {
      const x = (i / n) * w;
      const y = yBase - amp * (0.55 + 0.45 * Math.sin(i * 1.7 + seed));
      d += ` L${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    return `<path d="${d} L${w} ${h} Z" fill="${fill}"/>`;
  };
  out.push(ridge(gy - h * 0.18, h * 0.22, 0.4, '#8C8FE0'));
  out.push(ridge(gy - h * 0.08, h * 0.16, 2.2, '#6C69C9'));
  out.push(ridge(gy - h * 0.02, h * 0.1, 4.1, '#4F49A8'));
  // Ice columns with a gap; the gap shrinks as levels go up.
  const colW = Math.max(54, Math.min(w, h) * 0.16);
  const gapH = h * (opts.gap ?? 0.3);
  const centres = opts.centres ?? [0.42, 0.56, 0.36];
  const xs = [0.58, 0.9, 1.22];
  xs.forEach((fx, i) => {
    const x = w * fx - colW / 2;
    const c = h * centres[i % centres.length];
    const topEnd = c - gapH / 2, botStart = c + gapH / 2;
    const col = (y, hh, capAtBottom) => {
      const r = colW * 0.5;
      return `<g><rect x="${x}" y="${y}" width="${colW}" height="${hh}" rx="${r}" fill="#E4F4FF"/>` +
        `<rect x="${x + colW * 0.62}" y="${y}" width="${colW * 0.38}" height="${hh}" rx="${r * 0.6}" fill="#B9E0FB"/>` +
        `<rect x="${x - colW * 0.08}" y="${capAtBottom ? y + hh - colW * 0.42 : y}" width="${colW * 1.16}" height="${colW * 0.42}" rx="${colW * 0.21}" fill="#FFFFFF" stroke="#8FCBF3" stroke-width="3"/></g>`;
    };
    out.push(col(-colW, topEnd + colW, true));
    out.push(col(botStart, gy - botStart + colW, false));
  });
  out.push(`<rect y="${gy}" width="${w}" height="${ground}" fill="#2B2248"/>`);
  out.push(`<rect y="${gy}" width="${w}" height="${Math.max(4, ground * 0.12)}" fill="#FF4F6E"/>`);
  // The bird: a flush ball with an ink wing and a sun beak.
  const br = Math.max(18, Math.min(w, h) * 0.045);
  const bx = w * 0.3, by = h * (opts.birdY ?? 0.44);
  out.push(`<g transform="translate(${bx} ${by}) rotate(-12)">` +
    `<ellipse cx="0" cy="${br * 1.15}" rx="${br * 0.8}" ry="${br * 0.18}" fill="#1C1433" opacity="0.12"/>` +
    `<circle r="${br}" fill="${opts.bird ?? '#FF4F6E'}"/>` +
    `<path d="M${br * 0.82} ${-br * 0.12} l${br * 0.62} ${br * 0.2} l${-br * 0.62} ${br * 0.22} z" fill="#FFC53A"/>` +
    `<circle cx="${br * 0.38}" cy="${-br * 0.3}" r="${br * 0.17}" fill="#1C1433"/>` +
    `<path d="M${-br * 0.55} ${-br * 0.05} q${-br * 0.9} ${-br * 0.95} ${-br * 0.25} ${-br * 1.25}" fill="none" stroke="#1C1433" stroke-width="${br * 0.36}" stroke-linecap="round"/></g>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">${out.join('')}</svg>`;
}


/** Squat Flap for two players: two lanes side by side with the same columns (same seed). */
export function squatFlapDuo(w, h) {
  const lane = (x0, birdY, color, id) => {
    let svg = squatFlapScene(w / 2, h, { birdY, centres: [0.44, 0.58, 0.38], bird: color });
    svg = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '').replaceAll('id="sky"', `id="sky-${id}"`).replace('url(#sky)', `url(#sky-${id})`);
    return `<svg x="${x0}" y="0" width="${w / 2}" height="${h}" viewBox="0 0 ${w / 2} ${h}" overflow="hidden">${svg}</svg>`;
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">${lane(0, 0.47, '#FFC53A', 'p1')}${lane(w / 2, 0.37, '#46B4FF', 'p2')}<rect x="${w / 2 - 3}" y="0" width="6" height="${h}" fill="#F4F2F8"/></svg>`;
}
