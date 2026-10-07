// BodyArcade 3D engine: a third-person runner built from procedural geometry.
// Everything is modelled in code (no asset downloads) and instanced where it repeats.
import * as THREE from '/vendor/three.module.min.js';
import { LANE_W } from './sim.js';
export { LANE_W };
const SPAN = 160;              // length of one scenery chunk; two chunks leapfrog
const ROAD_W = 5.6;
const RUNNER_H = 1.75;

const col = (hex) => new THREE.Color(hex);
const rand = (a, b) => a + Math.random() * (b - a);

// Seeded random so every world looks the same each time you load it.
function seeded(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// ───────────────────────── geometry helpers ─────────────────────────
function colorize(geo, color, jitter = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  const base = col(color);
  for (let i = 0; i < n; i++) {
    const j = jitter ? 1 + (Math.random() - 0.5) * jitter : 1;
    c[i * 3] = base.r * j; c[i * 3 + 1] = base.g * j; c[i * 3 + 2] = base.b * j;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
function place(geo, x, y, z, rx = 0, ry = 0, rz = 0, s = 1) {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(s, s, s));
  geo.applyMatrix4(m);
  return geo;
}
function merge(parts) {
  let total = 0;
  for (const p of parts) total += p.attributes.position.count;
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), clr = new Float32Array(total * 3);
  let o = 0;
  for (const p of parts) {
    pos.set(p.attributes.position.array, o * 3);
    nor.set(p.attributes.normal.array, o * 3);
    clr.set(p.attributes.color.array, o * 3);
    o += p.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(clr, 3));
  return g;
}
const vcMat = (opts = {}) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, ...opts });

// ───────────────────────── prop builders (one geometry each) ─────────────────────────
const PROPS = {
  pine(o) {
    const trunk = colorize(place(new THREE.CylinderGeometry(0.12, 0.22, 2.2, 6), 0, 1.1, 0), '#4a3524', 0.1);
    const tint = o.tint || '#2f5a3a';
    const t1 = colorize(place(new THREE.ConeGeometry(1.5, 2.4, 7), 0, 2.6, 0), tint, 0.12);
    const t2 = colorize(place(new THREE.ConeGeometry(1.15, 2.0, 7), 0, 4.0, 0, 0, 0.4), tint, 0.12);
    const t3 = colorize(place(new THREE.ConeGeometry(0.75, 1.6, 7), 0, 5.2, 0, 0, 0.8), tint, 0.12);
    const parts = [trunk, t1, t2, t3];
    if (o.snow) parts.push(colorize(place(new THREE.ConeGeometry(0.78, 0.5, 7), 0, 5.75, 0, 0, 0.8), '#eef5fa', 0.03));
    return merge(parts);
  },
  tree(o) {
    const trunk = colorize(place(new THREE.CylinderGeometry(0.18, 0.3, 4.2, 7), 0, 2.1, 0), '#4b3a2a', 0.1);
    const c1 = colorize(place(new THREE.IcosahedronGeometry(1.7, 1), 0, 4.8, 0), '#3f7a3c', 0.14);
    const c2 = colorize(place(new THREE.IcosahedronGeometry(1.3, 1), 0.9, 4.1, 0.4), '#4f8a44', 0.14);
    const c3 = colorize(place(new THREE.IcosahedronGeometry(1.2, 1), -0.8, 4.3, -0.3), '#366f36', 0.14);
    return merge([trunk, c1, c2, c3]);
  },
  jungletree() {
    const trunk = colorize(place(new THREE.CylinderGeometry(0.22, 0.4, 7, 7), 0, 3.5, 0), '#5a4634', 0.1);
    const parts = [trunk];
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * Math.PI * 2;
      parts.push(colorize(place(new THREE.ConeGeometry(0.55, 3.2, 4), Math.cos(a) * 1.5, 6.4, Math.sin(a) * 1.5, Math.PI / 2 - 0.5 - Math.sin(a) * 0, -a + Math.PI / 2, 0), '#4c9a4a', 0.16));
    }
    parts.push(colorize(place(new THREE.IcosahedronGeometry(1.4, 1), 0, 7.2, 0), '#3f8a3e', 0.14));
    return merge(parts);
  },
  bush() {
    return merge([
      colorize(place(new THREE.IcosahedronGeometry(0.8, 1), 0, 0.6, 0), '#4b7d3a', 0.15),
      colorize(place(new THREE.IcosahedronGeometry(0.6, 1), 0.6, 0.45, 0.2), '#5a8c44', 0.15),
    ]);
  },
  fern() {
    const parts = [];
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * Math.PI * 2;
      parts.push(colorize(place(new THREE.ConeGeometry(0.28, 1.6, 3), Math.cos(a) * 0.5, 0.75, Math.sin(a) * 0.5, Math.PI / 2 - 0.9, -a + Math.PI / 2, 0), '#5ab35a', 0.18));
    }
    return merge(parts);
  },
  rock(o) {
    const g = colorize(place(new THREE.DodecahedronGeometry(1, 0), 0, 0.6, 0, rand(0, 3), rand(0, 3), rand(0, 3)), o.tint || '#6b655c', 0.2);
    return g;
  },
  ice() {
    return merge([
      colorize(place(new THREE.DodecahedronGeometry(1, 0), 0, 0.7, 0, 0.3, 0.6, 0.2), '#bfe3f2', 0.1),
      colorize(place(new THREE.DodecahedronGeometry(0.6, 0), 0.9, 0.35, 0.3, 0.8, 0.2, 0.5), '#d9f0f8', 0.1),
    ]);
  },
  cactus() {
    const body = colorize(place(new THREE.CylinderGeometry(0.28, 0.34, 3.0, 8), 0, 1.5, 0), '#4f8a3e', 0.12);
    const a1 = colorize(place(new THREE.CylinderGeometry(0.16, 0.18, 1.2, 7), 0.5, 1.9, 0, 0, 0, -0.2), '#55934a', 0.12);
    const a2 = colorize(place(new THREE.CylinderGeometry(0.16, 0.18, 0.9, 7), -0.5, 1.5, 0, 0, 0, 0.25), '#55934a', 0.12);
    const j1 = colorize(place(new THREE.CylinderGeometry(0.17, 0.17, 0.5, 7), 0.32, 1.35, 0, 0, 0, Math.PI / 2), '#4f8a3e', 0.12);
    return merge([body, a1, a2, j1]);
  },
  dune() {
    const g = new THREE.SphereGeometry(3, 10, 6);
    g.scale(1.6, 0.42, 1);
    return colorize(g, '#d7a35e', 0.08);
  },
  palm() {
    const parts = [];
    const segs = 6;
    for (let i = 0; i < segs; i++) {
      const y = i * 0.9 + 0.45, x = Math.pow(i / segs, 1.6) * 0.9;
      parts.push(colorize(place(new THREE.CylinderGeometry(0.13 - i * 0.008, 0.16 - i * 0.008, 0.95, 6), x, y, 0, 0, 0, -0.15 - i * 0.03), '#6b5134', 0.1));
    }
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      const g = new THREE.ConeGeometry(0.35, 2.4, 3);
      parts.push(colorize(place(g, 1.05 + Math.cos(a) * 1.0, 5.55 - Math.abs(Math.sin(a)) * 0.2, Math.sin(a) * 1.0, Math.PI / 2 + 0.55, -a + Math.PI / 2, 0), '#3f8a46', 0.16));
    }
    return merge(parts);
  },
  lamp() {
    const pole = colorize(place(new THREE.CylinderGeometry(0.06, 0.09, 4.6, 7), 0, 2.3, 0), '#2a2b30', 0.05);
    const arm = colorize(place(new THREE.BoxGeometry(1.0, 0.07, 0.07), -0.5, 4.55, 0), '#2a2b30', 0.05);
    return merge([pole, arm]);
  },
  lampHead() {
    return colorize(place(new THREE.BoxGeometry(0.5, 0.14, 0.26), -0.95, 4.5, 0), '#ffe3a3', 0);
  },
  building(o) {
    const h = 7 + (o.variant || 0) * 5;
    const body = colorize(place(new THREE.BoxGeometry(4, h, 4), 0, h / 2, 0), '#2b2f44', 0.08);
    const roof = colorize(place(new THREE.BoxGeometry(1.4, 0.8, 1.2), 0.8, h + 0.4, -0.6), '#1f2236', 0.05);
    return merge([body, roof]);
  },
  windows(o) {
    const h = 7 + (o.variant || 0) * 5;
    const parts = [];
    for (let f = 0; f < Math.floor(h / 1.6); f++) for (let c = 0; c < 3; c++) {
      if ((f * 7 + c * 3 + (o.variant || 0)) % 5 < 2) continue;
      for (const side of [0, 1]) {
        const g = new THREE.PlaneGeometry(0.55, 0.7);
        if (side === 0) place(g, -1.1 + c * 1.1, 1.1 + f * 1.6, 2.01); else place(g, -2.01, 1.1 + f * 1.6, -1.1 + c * 1.1, 0, -Math.PI / 2, 0);
        parts.push(colorize(g, c % 2 ? '#ffd58a' : '#ffecc0', 0.1));
      }
    }
    return merge(parts);
  },
  tuft(o) {
    const parts = [];
    for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; parts.push(colorize(place(new THREE.ConeGeometry(0.06, 0.45, 3), Math.cos(a) * 0.12, 0.2, Math.sin(a) * 0.12, Math.cos(a) * 0.35, 0, -Math.sin(a) * 0.35), o.tint || '#6f9a44', 0.25)); }
    return merge(parts);
  },
  post() { return colorize(place(new THREE.BoxGeometry(0.14, 1.0, 0.14), 0, 0.5, 0), '#8c8378', 0.08); },
  rail() { return colorize(place(new THREE.BoxGeometry(0.08, 0.08, 3.0), 0, 0.95, 0), '#9a9186', 0.05); },
  buoy() {
    return merge([
      colorize(place(new THREE.SphereGeometry(0.6, 10, 8), 0, 0.3, 0), '#ff4f24', 0.05),
      colorize(place(new THREE.CylinderGeometry(0.08, 0.08, 1.2, 6), 0, 1.2, 0), '#f3eee5', 0.05),
    ]);
  },
  lava() {
    const g = new THREE.PlaneGeometry(3, 1.2, 4, 2);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) + (Math.random() - 0.5) * 0.6);
    return colorize(place(g, 0, 0.02, 0), '#ff7a2a', 0.2);
  },
};

// ───────────────────────── textures ─────────────────────────
function roadTexture(road) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 1024;
  const x = c.getContext('2d');
  x.fillStyle = road.base; x.fillRect(0, 0, 256, 1024);
  const img = x.getImageData(0, 0, 256, 1024);
  for (let i = 0; i < img.data.length; i += 4) { const n = (Math.random() - 0.5) * 22; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; }
  x.putImageData(img, 0, 0);
  x.fillStyle = road.edge; x.fillRect(4, 0, 6, 1024); x.fillRect(246, 0, 6, 1024);
  x.fillStyle = road.line;
  for (let y = 0; y < 1024; y += 128) { x.fillRect(85, y, 4, 64); x.fillRect(167, y, 4, 64); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 12); t.anisotropy = 8; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function noiseTexture(a, b) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  const ca = col(a), cb = col(b);
  const img = x.createImageData(128, 128);
  for (let i = 0; i < 128 * 128; i++) {
    const t = Math.random();
    const r = (ca.r + (cb.r - ca.r) * t), g = (ca.g + (cb.g - ca.g) * t), bl = (ca.b + (cb.b - ca.b) * t);
    const s = (v) => Math.round(Math.pow(v, 1 / 2.2) * 255);
    img.data[i * 4] = s(r); img.data[i * 4 + 1] = s(g); img.data[i * 4 + 2] = s(bl); img.data[i * 4 + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(60, 60); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function stripeTexture(a, b) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = a; x.fillRect(0, 0, 512, 64);
  x.fillStyle = b;
  for (let i = -1; i < 9; i++) { x.beginPath(); x.moveTo(i * 64, 0); x.lineTo(i * 64 + 32, 0); x.lineTo(i * 64 + 64, 64); x.lineTo(i * 64 + 32, 64); x.closePath(); x.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.repeat.set(1.2, 1);
  return t;
}
function arrowTexture(dir, bg, fg) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, 256, 256);
  x.fillStyle = fg;
  x.save(); x.translate(128, 128); if (dir < 0) x.scale(-1, 1);
  x.beginPath(); x.moveTo(-70, -34); x.lineTo(20, -34); x.lineTo(20, -70); x.lineTo(84, 0); x.lineTo(20, 70); x.lineTo(20, 34); x.lineTo(-70, 34); x.closePath(); x.fill();
  x.restore();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function spriteTexture(kind) {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const x = c.getContext('2d');
  if (kind === 'cloud') {
    c.width = c.height = 128; const x2 = c.getContext('2d');
    for (const [cx, cy, r] of [[64, 76, 34], [40, 84, 26], [92, 86, 26], [58, 60, 22], [78, 66, 20]]) { const g = x2.createRadialGradient(cx, cy, 0, cx, cy, r); g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.7, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x2.fillStyle = g; x2.fillRect(0, 0, 128, 128); }
    return new THREE.CanvasTexture(c);
  }
  if (kind === 'streak') { const g = x.createLinearGradient(0, 0, 0, 32); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(13, 0, 6, 32); }
  else { const g = x.createRadialGradient(16, 16, 0, 16, 16, 16); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.5, 'rgba(255,255,255,0.6)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 32, 32); }
  return new THREE.CanvasTexture(c);
}
function horizonTexture(h) {
  const c = document.createElement('canvas'); c.width = 2048; c.height = 256;
  const x = c.getContext('2d');
  const rnd = seeded(7);
  const layer = (color, base, amp, step, kind) => {
    x.fillStyle = color; x.beginPath(); x.moveTo(0, 256);
    let px = 0;
    if (kind === 'skyline') {
      while (px < 2048) { const w = 24 + rnd() * 70, hh = base + rnd() * amp; x.lineTo(px, 256 - hh); x.lineTo(px + w, 256 - hh); px += w; }
    } else if (kind === 'islands') {
      while (px < 2048) { const w = 120 + rnd() * 240; const hh = rnd() < 0.5 ? 0 : base + rnd() * amp; x.quadraticCurveTo(px + w / 2, 256 - hh * 2, px + w, 256); px += w; }
    } else if (kind === 'dunes' || kind === 'hills') {
      while (px < 2048) { const w = 160 + rnd() * 220; const hh = base + rnd() * amp; x.quadraticCurveTo(px + w / 2, 256 - hh, px + w, 256 - base * 0.5); px += w; }
    } else if (kind === 'forest') {
      while (px < 2048) { const w = 12 + rnd() * 16, hh = base + rnd() * amp; x.lineTo(px + w / 2, 256 - hh); x.lineTo(px + w, 256 - hh * 0.7); px += w; }
    } else {
      while (px <= 2048) { x.lineTo(px, 256 - (base + rnd() * amp)); px += step + rnd() * step; }
    }
    x.lineTo(2048, 256); x.closePath(); x.fill();
  };
  layer(h.colorFar, 70, 120, 60, h.kind);
  layer(h.colorNear, 30, 90, 90, h.kind);
  if (h.kind === 'skyline') { x.fillStyle = 'rgba(255,220,150,0.8)'; for (let i = 0; i < 900; i++) { const px = rnd() * 2048, py = 256 - rnd() * 150; x.fillRect(px, py, 2, 2); } }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.repeat.set(2, 1);
  return t;
}

// ───────────────────────── sky ─────────────────────────
const SKY_VERT = `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const SKY_FRAG = `
precision highp float;
uniform vec3 uTop, uMid, uBot, uSunColor, uSunDir; uniform float uStars, uAurora, uTime;
varying vec3 vDir;
float hash(vec3 p){ p = fract(p*0.3183099+vec3(0.1,0.2,0.3)); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
void main(){
  vec3 d = normalize(vDir);
  float y = d.y;
  vec3 c = y < 0.12 ? mix(uBot, uMid, smoothstep(-0.05, 0.12, y)) : mix(uMid, uTop, smoothstep(0.12, 0.75, y));
  float s = max(dot(d, uSunDir), 0.0);
  c += uSunColor * (pow(s, 64.0) * 1.4 + pow(s, 6.0) * 0.22);
  if (uStars > 0.0) { float h = hash(floor(d * 180.0)); float st = step(0.996 - uStars*0.003, h) * smoothstep(0.08, 0.3, y); c += vec3(st) * (0.5 + 0.5*sin(uTime*2.0 + h*60.0)) * uStars; }
  if (uAurora > 0.0) { float band = exp(-pow((y - 0.42 + 0.07*sin(d.x*7.0 + uTime*0.25) + 0.05*sin(d.z*5.0 - uTime*0.2))/0.1, 2.0)); c += vec3(0.25, 0.9, 0.55) * band * 0.45 * uAurora * (0.6 + 0.4*sin(d.x*20.0 + uTime*0.6)); }
  gl_FragColor = vec4(c, 1.0);
}`;

// ───────────────────────── runner (procedural humanoid) ─────────────────────────
export const SKINS = {
  runner:    { body: '#ff4f24', legs: '#15130f', skin: '#e8b68a', accent: '#ffc93c', head: 'cap' },
  ninja:     { body: '#1c1c22', legs: '#15130f', skin: '#d9a77c', accent: '#ff4f24', head: 'band' },
  knight:    { body: '#9aa2ad', legs: '#5b616b', skin: '#c9c9c9', accent: '#ffc93c', head: 'helm' },
  astronaut: { body: '#f0f2f5', legs: '#d5d9df', skin: '#1a2a44', accent: '#ff4f24', head: 'dome' },
  wizard:    { body: '#6b3fb5', legs: '#2d1b4e', skin: '#e8b68a', accent: '#ffc93c', head: 'hat' },
  robot:     { body: '#4a8ad8', legs: '#2a4a74', skin: '#b8c7dc', accent: '#5cdfff', head: 'box' },
  demon:     { body: '#b8232b', legs: '#3a0f12', skin: '#d94a4a', accent: '#ffb347', head: 'horns' },
  angel:     { body: '#fff7e0', legs: '#e8dcc0', skin: '#e8b68a', accent: '#ffd36b', head: 'halo' },
};

function buildRunner(skinId) {
  const sk = SKINS[skinId] || SKINS.runner;
  const mat = (c, extra = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0.05, ...extra });
  const mBody = mat(sk.body), mLegs = mat(sk.legs), mSkin = mat(sk.skin), mAcc = mat(sk.accent);
  const root = new THREE.Group();
  const hips = new THREE.Group(); hips.position.y = 0.95; root.add(hips);
  const mk = (geo, m, parent, x = 0, y = 0, z = 0) => { const mesh = new THREE.Mesh(geo, m); mesh.position.set(x, y, z); mesh.castShadow = true; parent.add(mesh); return mesh; };

  const pelvis = mk(new THREE.CapsuleGeometry(0.17, 0.08, 4, 10), mLegs, hips, 0, 0.02, 0); pelvis.scale.set(1, 0.7, 0.8);
  const torso = new THREE.Group(); torso.position.y = 0.12; hips.add(torso);
  const chest = mk(new THREE.CapsuleGeometry(0.19, 0.3, 4, 12), mBody, torso, 0, 0.3, 0); chest.scale.set(1, 1, 0.72);
  const neck = mk(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 8), mSkin, torso, 0, 0.6, 0);
  const headG = new THREE.Group(); headG.position.y = 0.78; torso.add(headG);
  const head = mk(new THREE.SphereGeometry(0.15, 14, 12), mSkin, headG, 0, 0, 0); head.scale.set(0.95, 1.05, 0.95);
  // headgear
  if (sk.head === 'cap') { const cap = mk(new THREE.SphereGeometry(0.155, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mAcc, headG, 0, 0.02, 0); const peak = mk(new THREE.BoxGeometry(0.2, 0.03, 0.14), mAcc, headG, 0, 0.03, 0.16); }
  else if (sk.head === 'band') { mk(new THREE.TorusGeometry(0.15, 0.025, 6, 16), mAcc, headG, 0, 0.03, 0).rotation.x = Math.PI / 2; }
  else if (sk.head === 'helm') { const h = mk(new THREE.SphereGeometry(0.18, 12, 10), mBody, headG, 0, 0.01, 0); mk(new THREE.BoxGeometry(0.03, 0.14, 0.2), mAcc, headG, 0, 0.17, 0); }
  else if (sk.head === 'dome') { mk(new THREE.SphereGeometry(0.2, 14, 12), mat('#9fd8ff', { transparent: true, opacity: 0.45, roughness: 0.2 }), headG, 0, 0, 0); }
  else if (sk.head === 'hat') { mk(new THREE.ConeGeometry(0.16, 0.42, 10), mBody, headG, 0, 0.3, 0).rotation.z = 0.15; mk(new THREE.CylinderGeometry(0.24, 0.24, 0.02, 12), mBody, headG, 0, 0.1, 0); }
  else if (sk.head === 'box') { head.visible = false; mk(new THREE.BoxGeometry(0.26, 0.26, 0.24), mSkin, headG, 0, 0, 0); mk(new THREE.BoxGeometry(0.18, 0.05, 0.02), mat(sk.accent, { emissive: sk.accent, emissiveIntensity: 1.2 }), headG, 0, 0.01, 0.13); }
  else if (sk.head === 'horns') { for (const s of [-1, 1]) mk(new THREE.ConeGeometry(0.04, 0.16, 6), mAcc, headG, s * 0.1, 0.16, 0).rotation.z = -s * 0.5; }
  else if (sk.head === 'halo') { const r = mk(new THREE.TorusGeometry(0.13, 0.018, 6, 20), mat(sk.accent, { emissive: sk.accent, emissiveIntensity: 1.5 }), headG, 0, 0.26, 0); r.rotation.x = Math.PI / 2; }

  const limb = (parent, x, y, z, upperR, upperL, lowerR, lowerL, mUp, mLow, endGeo, endMat) => {
    const up = new THREE.Group(); up.position.set(x, y, z); parent.add(up);
    const u = mk(new THREE.CapsuleGeometry(upperR, upperL, 4, 8), mUp, up, 0, -upperL / 2 - upperR * 0.5, 0);
    const low = new THREE.Group(); low.position.y = -upperL - upperR * 0.9; up.add(low);
    const l = mk(new THREE.CapsuleGeometry(lowerR, lowerL, 4, 8), mLow, low, 0, -lowerL / 2 - lowerR * 0.5, 0);
    const end = mk(endGeo, endMat, low, 0, -lowerL - lowerR * 0.8, endGeo.type === 'BoxGeometry' ? 0.05 : 0);
    return { up, low, end };
  };
  const armL = limb(torso, -0.27, 0.5, 0, 0.055, 0.24, 0.05, 0.22, mBody, mSkin, new THREE.SphereGeometry(0.055, 8, 6), mSkin);
  const armR = limb(torso, 0.27, 0.5, 0, 0.055, 0.24, 0.05, 0.22, mBody, mSkin, new THREE.SphereGeometry(0.055, 8, 6), mSkin);
  const legL = limb(hips, -0.11, -0.02, 0, 0.085, 0.36, 0.07, 0.34, mLegs, mLegs, new THREE.BoxGeometry(0.12, 0.07, 0.24), mAcc);
  const legR = limb(hips, 0.11, -0.02, 0, 0.085, 0.36, 0.07, 0.34, mLegs, mLegs, new THREE.BoxGeometry(0.12, 0.07, 0.24), mAcc);

  const mats = [mBody, mLegs, mSkin, mAcc];
  return { root, hips, torso, headG, armL, armR, legL, legR, mats };
}

// ───────────────────────── obstacles ─────────────────────────
function buildObstacleFactory(world) {
  const dark = new THREE.MeshStandardMaterial({ color: '#1b1917', roughness: 0.7, metalness: 0.2 });
  const stripeO = new THREE.MeshStandardMaterial({ map: stripeTexture('#f3eee5', '#ff4f24'), roughness: 0.6, side: THREE.DoubleSide });
  const stripeY = new THREE.MeshStandardMaterial({ map: stripeTexture('#15130f', '#ffc93c'), roughness: 0.6, side: THREE.DoubleSide });
  const wallMat = new THREE.MeshStandardMaterial({ color: '#2a2622', roughness: 0.8 });
  const arrowL = new THREE.MeshStandardMaterial({ map: arrowTexture(-1, '#15130f', '#ffc93c'), roughness: 0.6, emissive: '#ffc93c', emissiveMap: arrowTexture(-1, '#000000', '#ffc93c'), emissiveIntensity: 0.6 });
  const arrowR = new THREE.MeshStandardMaterial({ map: arrowTexture(1, '#15130f', '#ffc93c'), roughness: 0.6, emissive: '#ffc93c', emissiveMap: arrowTexture(1, '#000000', '#ffc93c'), emissiveIntensity: 0.6 });
  const mesh = (g, m, x, y, z) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = false; return o; };
  const W = ROAD_W - 0.4;
  return {
    hurdle() {
      const g = new THREE.Group();
      g.add(mesh(new THREE.BoxGeometry(W, 0.1, 0.1), dark, 0, 0.58, 0));
      g.add(mesh(new THREE.PlaneGeometry(W, 0.34), stripeO, 0, 0.36, 0));
      for (const x of [-W / 2 + 0.15, W / 2 - 0.15]) { g.add(mesh(new THREE.BoxGeometry(0.1, 0.62, 0.1), dark, x, 0.31, 0)); g.add(mesh(new THREE.BoxGeometry(0.1, 0.06, 0.7), dark, x, 0.03, 0)); }
      return g;
    },
    duck() {
      const g = new THREE.Group();
      for (const x of [-W / 2, W / 2]) g.add(mesh(new THREE.BoxGeometry(0.16, 2.3, 0.16), dark, x, 1.15, 0));
      g.add(mesh(new THREE.BoxGeometry(W + 0.3, 0.14, 0.14), dark, 0, 2.2, 0));
      g.add(mesh(new THREE.PlaneGeometry(W - 0.2, 0.62), stripeO, 0, 1.78, 0));
      return g;
    },
    squat() {
      const g = new THREE.Group();
      for (const x of [-W / 2, W / 2]) g.add(mesh(new THREE.BoxGeometry(0.16, 1.9, 0.16), dark, x, 0.95, 0));
      g.add(mesh(new THREE.BoxGeometry(W + 0.3, 0.14, 0.14), dark, 0, 1.8, 0));
      g.add(mesh(new THREE.PlaneGeometry(W - 0.2, 0.72), stripeY, 0, 1.36, 0));
      return g;
    },
    wall(side) { // side -1: wall covers centre+left (go right); +1: covers centre+right (go left)
      const g = new THREE.Group();
      const cx = side * LANE_W * 0.5;
      g.add(mesh(new THREE.BoxGeometry(LANE_W * 2 + 0.3, 2.3, 0.5), wallMat, cx, 1.15, 0));
      const strip = mesh(new THREE.PlaneGeometry(LANE_W * 2 + 0.3, 0.4), stripeO, cx, 2.05, 0.26); g.add(strip);
      const sign = mesh(new THREE.PlaneGeometry(0.9, 0.9), side < 0 ? arrowR : arrowL, cx, 1.2, 0.27); g.add(sign);
      return g;
    },
  };
}

// ───────────────────────── engine ─────────────────────────
export class Engine {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.opts = opts;
    this.reduced = !!opts.reducedMotion;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', alpha: false });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = renderer;
    this.quality = opts.quality || 'auto';
    this.level = this.quality === 'low' ? 0 : 2;  // 0 low · 1 medium · 2 high
    this.fpsSamples = []; this.fps = 60; this._lastQualityCheck = 0;
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 420);
    this.scene = new THREE.Scene();
    this.clockT = 0;
    this.shake = 0;
    this.obstacleMeshes = new Map();
    this.coinMesh = null;
    this.resize();
    this.applyLevel();
  }

  applyLevel() {
    const isMobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || innerWidth < 700;
    const prMax = [1, 1.5, isMobile ? 1.6 : 2][this.level];
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, prMax));
    this.renderer.shadowMap.enabled = this.level > 0;
    if (this.sun) { this.sun.castShadow = this.level > 0; this.sun.shadow.mapSize.setScalar(this.level === 2 ? 2048 : 1024); if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; } }
    if (this.weather) this.weather.visible = this.level > 0 || !this.weather.heavy;
    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 72 : 60;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.renderer.dispose();
  }

  // Build (or rebuild) the scene for a world.
  setWorld(world, skinId = 'runner') {
    this.world = world;
    this.renderer.toneMappingExposure = world.exposure || 1.05;
    const scene = new THREE.Scene();
    this.scene = scene;
    scene.fog = new THREE.FogExp2(col(world.fog.color), world.fog.density);
    this.fogBase = world.fog.density;

    // Sky
    const sunDir = new THREE.Vector3(...world.sun.pos).normalize();
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uTop: { value: col(world.sky.top) }, uMid: { value: col(world.sky.mid) }, uBot: { value: col(world.sky.bot) }, uSunColor: { value: col(world.sky.sunGlow) }, uSunDir: { value: sunDir }, uStars: { value: world.sky.stars || 0 }, uAurora: { value: world.sky.aurora ? 1 : 0 }, uTime: { value: 0 } },
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(380, 32, 16), this.skyMat);
    sky.renderOrder = -2; scene.add(sky); this.sky = sky;

    // Horizon silhouette ring
    const hz = new THREE.Mesh(new THREE.CylinderGeometry(300, 300, 70, 48, 1, true), new THREE.MeshBasicMaterial({ map: horizonTexture(world.horizon), transparent: true, side: THREE.BackSide, depthWrite: false, fog: false }));
    hz.position.y = 12; hz.renderOrder = -1; scene.add(hz); this.horizon = hz;

    // Lights
    // Fill: hemisphere + a cool-tinted ambient so shadows never go to pure black.
    const hemi = new THREE.HemisphereLight(col(world.hemi.sky), col(world.hemi.ground), world.hemi.intensity * 1.6);
    scene.add(hemi);
    scene.add(new THREE.AmbientLight(col(world.ambient || '#9db0cc'), world.ambientIntensity ?? 0.5));
    const sun = new THREE.DirectionalLight(col(world.sun.color), world.sun.intensity * 0.85);
    sun.position.copy(sunDir).multiplyScalar(40);
    sun.castShadow = this.level > 0;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 120;
    sun.shadow.camera.left = -9; sun.shadow.camera.right = 9; sun.shadow.camera.top = 12; sun.shadow.camera.bottom = -16;
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03; sun.shadow.radius = 3;
    scene.add(sun); scene.add(sun.target); this.sun = sun;
    this.lightningLight = null;
    if (world.lightning) { this.lightningLight = new THREE.DirectionalLight('#cfe4ff', 0); this.lightningLight.position.set(-20, 40, -60); scene.add(this.lightningLight); }
    if (world.glow) { const p = new THREE.PointLight(world.glow, 30, 30, 2); p.position.set(0, 1.5, -6); scene.add(p); this.glowLight = p; }

    // Ground
    const groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: noiseTexture('#ffffff', '#d8d8d8'), roughness: world.water ? 0.25 : 1, metalness: world.water ? 0.15 : 0 });
    const groundGeo = new THREE.PlaneGeometry(600, 600, 48, 48);
    { // soft patches so the ground isn't one flat colour
      const ga = col(world.ground), gb = col(world.groundNoise), pos = groundGeo.attributes.position, cols = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), y = pos.getY(i); const nz = 0.5 + 0.5 * Math.sin(x * 0.07 + Math.sin(y * 0.05) * 2) * Math.cos(y * 0.06 + Math.sin(x * 0.04) * 2); const t = world.water ? 0.5 : nz; cols[i * 3] = ga.r + (gb.r - ga.r) * t; cols[i * 3 + 1] = ga.g + (gb.g - ga.g) * t; cols[i * 3 + 2] = ga.b + (gb.b - ga.b) * t; }
      groundGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    }
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2; ground.position.y = world.water ? -0.6 : -0.02; ground.receiveShadow = true;
    scene.add(ground); this.ground = ground;

    // Road
    const roadTex = roadTexture(world.road);
    const roadMat = new THREE.MeshStandardMaterial({ map: roadTex, roughness: world.road.wet ? 0.3 : 0.95, metalness: world.road.wet ? 0.25 : 0 });
    const road = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, 320), roadMat);
    road.rotation.x = -Math.PI / 2; road.position.set(0, 0, -140); road.receiveShadow = true;
    scene.add(road); this.road = road; this.roadTex = roadTex;
    if (world.water) {
      const base = new THREE.Mesh(new THREE.BoxGeometry(ROAD_W + 1.2, 0.7, 320), new THREE.MeshStandardMaterial({ color: '#7b746a', roughness: 0.9 }));
      base.position.set(0, -0.36, -140); scene.add(base);
    }

    // Scenery chunks
    this.chunks = [];
    for (let i = 0; i < 2; i++) { const g = this.buildChunk(world, i); g.position.z = -i * SPAN; scene.add(g); this.chunks.push(g); }

    // Clouds: a few soft sprites far behind the horizon
    if (world.sky.clouds) {
      const n = 26, geo = new THREE.BufferGeometry(), pos = new Float32Array(n * 3);
      const rnd = seeded(99);
      for (let i = 0; i < n; i++) { pos[i * 3] = (rnd() - 0.5) * 520; pos[i * 3 + 1] = 42 + rnd() * 40; pos[i * 3 + 2] = -120 - rnd() * 200; }
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({ color: world.sky.clouds, size: 70, map: spriteTexture('cloud'), transparent: true, opacity: 0.85, depthWrite: false, sizeAttenuation: true, fog: false });
      const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = -1; scene.add(pts); this.clouds = pts;
    } else this.clouds = null;

    // Weather
    this.weather = null;
    if (world.weather && !this.reduced) this.buildWeather(world.weather);

    // Obstacles + coins
    this.factory = buildObstacleFactory(world);
    this.obstacleMeshes.clear();
    const coinGeo = new THREE.TorusGeometry(0.3, 0.09, 8, 18);
    const coinMat = new THREE.MeshStandardMaterial({ color: world.coin, emissive: world.coin, emissiveIntensity: 0.55, roughness: 0.3, metalness: 0.6 });
    this.coinMesh = new THREE.InstancedMesh(coinGeo, coinMat, 80);
    this.coinMesh.count = 0; this.coinMesh.castShadow = false; this.coinMesh.frustumCulled = false;
    scene.add(this.coinMesh);
    this._coinM = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1);

    // Runner
    this.setSkin(skinId);
    this.camera.position.set(0, 2.45, 5.4);
    this.camera.lookAt(0, 1.1, -7);
    this.applyLevel();
  }

  setSkin(skinId) {
    if (this.runner) this.scene.remove(this.runner.root);
    this.runner = buildRunner(skinId);
    this.runner.root.position.set(0, 0, 0);
    this.scene.add(this.runner.root);
    this.sun.target = this.runner.root;
  }

  buildChunk(world, index) {
    const g = new THREE.Group();
    const rnd = seeded(1234 + index * 77 + world.id.length * 13);
    const matFor = (kind) => kind === 'lampHead' || kind === 'windows' ? new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }) : kind === 'lava' ? new THREE.MeshBasicMaterial({ vertexColors: true }) : vcMat(kind === 'ice' ? { roughness: 0.3, metalness: 0.1 } : {});
    for (const p of world.props) {
      const n = Math.floor(SPAN / p.every) * 2;
      const variants = p.kind === 'building' ? 3 : 1;
      for (let v = 0; v < variants; v++) {
        const geo = PROPS[p.kind]({ ...p, variant: v });
        const mesh = new THREE.InstancedMesh(geo, matFor(p.kind), n);
        mesh.castShadow = p.kind !== 'lava' && p.kind !== 'dune'; mesh.receiveShadow = false;
        let extra = null;
        if (p.kind === 'lamp') { extra = new THREE.InstancedMesh(PROPS.lampHead({}), matFor('lampHead'), n); }
        if (p.kind === 'building') { extra = new THREE.InstancedMesh(PROPS.windows({ variant: v }), matFor('windows'), n); }
        const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3();
        let count = 0;
        for (let i = 0; i < n; i++) {
          if (variants > 1 && Math.floor(rnd() * variants) !== v) continue;
          const side = i % 2 === 0 ? -1 : 1;
          const z = -(Math.floor(i / 2) * p.every + rnd() * p.every * 0.6);
          const x = side * (p.side[0] + rnd() * (p.side[1] - p.side[0]));
          const s = p.scale[0] + rnd() * (p.scale[1] - p.scale[0]);
          const ry = p.kind === 'lamp' ? (side < 0 ? Math.PI : 0) : p.kind === 'building' ? Math.floor(rnd() * 4) * Math.PI / 2 : rnd() * Math.PI * 2;
          q.setFromEuler(new THREE.Euler(0, ry, 0)); pos.set(x, world.water && p.kind === 'buoy' ? -0.5 : 0, z); sc.set(s, s, s);
          m.compose(pos, q, sc);
          mesh.setMatrixAt(count, m);
          if (extra) extra.setMatrixAt(count, m);
          count++;
        }
        mesh.count = count; g.add(mesh);
        if (extra) { extra.count = count; g.add(extra); }
      }
    }
    // Coast railing between posts
    if (world.id === 'coast') {
      const geo = PROPS.rail(); const n = Math.floor(SPAN / 3) * 2;
      const mesh = new THREE.InstancedMesh(geo, vcMat(), n);
      const m = new THREE.Matrix4();
      for (let i = 0; i < n; i++) { const side = i % 2 === 0 ? -1 : 1; m.makeTranslation(side * 3.1, 0, -(Math.floor(i / 2) * 3 + 1.5)); mesh.setMatrixAt(i, m); }
      g.add(mesh);
    }
    return g;
  }

  buildWeather(w) {
    const n = w.count;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pos[i * 3] = rand(-22, 22); pos[i * 3 + 1] = rand(0, 16); pos[i * 3 + 2] = rand(-70, 8); }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: w.color, size: w.size * (w.kind === 'rain' ? 6 : 1), map: spriteTexture(w.kind === 'rain' ? 'streak' : 'dot'), transparent: true, opacity: w.opacity, depthWrite: false, sizeAttenuation: true, blending: w.kind === 'embers' ? THREE.AdditiveBlending : THREE.NormalBlending });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false; pts.heavy = n > 400; pts.def = w;
    this.scene.add(pts); this.weather = pts;
  }

  // Registers an obstacle object from the simulation and creates its mesh.
  addObstacle(ob) {
    const m = ob.type === 'wall' ? this.factory.wall(ob.side) : this.factory[ob.type]();
    m.position.set(0, 0, ob.z);
    this.scene.add(m);
    this.obstacleMeshes.set(ob.id, m);
  }
  removeObstacle(ob) {
    const m = this.obstacleMeshes.get(ob.id);
    if (m) { this.scene.remove(m); this.obstacleMeshes.delete(ob.id); }
  }
  clearObstacles() { for (const m of this.obstacleMeshes.values()) this.scene.remove(m); this.obstacleMeshes.clear(); this.coinMesh.count = 0; }

  flashLightning() { if (this.lightningLight) this.lightningLight.intensity = 6; }
  hit() { this.shake = 1; this._hitT = 0.5; }

  update(dt, sim) {
    const t = (this.clockT += dt);
    const r = this.runner;
    const moveZ = sim.moveZ;

    // scroll world
    for (const c of this.chunks) { c.position.z += moveZ; if (c.position.z > SPAN) c.position.z -= SPAN * 2; }
    this.roadTex.offset.y -= moveZ / (320 / 12);
    this.ground.material.map.offset.y -= moveZ / 10;
    this.skyMat.uniforms.uTime.value = t;
    if (this.horizon) this.horizon.rotation.y = sim.runner.x * 0.004;

    // obstacles follow the sim
    for (const ob of sim.obstacles) { const m = this.obstacleMeshes.get(ob.id); if (m) { m.position.z = ob.z; m.visible = ob.z < 3.2; } }
    // coins
    let ci = 0;
    for (const c of sim.coins) {
      if (c.taken || c.z > 0.2) continue;
      this._v.set(c.lane * LANE_W, 1.0 + Math.sin(t * 4 + c.id) * 0.06, c.z);
      this._q.setFromEuler(new THREE.Euler(0, t * 3 + c.id, 0));
      this._coinM.compose(this._v, this._q, this._s);
      this.coinMesh.setMatrixAt(ci++, this._coinM);
      if (ci >= 80) break;
    }
    this.coinMesh.count = ci; this.coinMesh.instanceMatrix.needsUpdate = true;

    // weather
    if (this.weather && this.weather.visible) {
      const w = this.weather.def, p = this.weather.geometry.attributes.position.array;
      const fall = w.fall * dt, drift = Math.sin(t * 0.7) * w.drift * dt;
      for (let i = 0; i < p.length; i += 3) {
        p[i + 1] -= fall; p[i] += drift; p[i + 2] += moveZ * (w.kind === 'rain' ? 0.35 : 0.8);
        if (p[i + 1] < 0) { p[i + 1] = 16; p[i] = rand(-22, 22); } else if (p[i + 1] > 16) { p[i + 1] = 0; }
        if (p[i + 2] > 8) p[i + 2] -= 78;
      }
      this.weather.geometry.attributes.position.needsUpdate = true;
    }
    if (this.lightningLight) { this.lightningLight.intensity *= Math.pow(0.02, dt); if (Math.random() < dt * 0.12) this.flashLightning(); }
    if (this.glowLight) this.glowLight.intensity = 26 + Math.sin(t * 7) * 6;

    // runner animation
    const rs = sim.runner;
    const speed = Math.max(0.1, rs.speed);
    this._phase = (this._phase || 0) + dt * speed * 1.15;
    const ph = this._phase;
    const crouch = rs.crouch;
    const jumpY = rs.y;
    r.root.position.x = rs.x;
    r.root.position.y = jumpY;
    r.root.rotation.z = -rs.lean * 0.18;
    r.root.rotation.y = -rs.lean * 0.12;
    r.hips.position.y = 0.95 - crouch * 0.5 + (jumpY > 0.01 ? 0 : Math.abs(Math.sin(ph)) * 0.035);
    r.torso.rotation.x = 0.12 + crouch * 0.55 + (rs.hitT > 0 ? Math.sin(rs.hitT * 20) * 0.2 : 0);
    r.headG.rotation.x = -0.1 - crouch * 0.3;
    const sw = Math.sin(ph), cw = Math.cos(ph);
    if (jumpY > 0.01) {
      const u = rs.jumpU;
      r.legL.up.rotation.x = -0.9 + u * 0.4; r.legR.up.rotation.x = -0.4 + u * 0.3;
      r.legL.low.rotation.x = 1.3 - u * 0.6; r.legR.low.rotation.x = 1.0 - u * 0.4;
      r.armL.up.rotation.x = -2.2 + u * 0.8; r.armR.up.rotation.x = -2.2 + u * 0.8;
      r.armL.low.rotation.x = -0.6; r.armR.low.rotation.x = -0.6;
    } else {
      const amp = 0.95 - crouch * 0.4;
      r.legL.up.rotation.x = sw * amp - crouch * 1.0; r.legR.up.rotation.x = -sw * amp - crouch * 1.0;
      r.legL.low.rotation.x = Math.max(0, cw) * 1.2 + 0.1 + crouch * 1.4; r.legR.low.rotation.x = Math.max(0, -cw) * 1.2 + 0.1 + crouch * 1.4;
      r.armL.up.rotation.x = -sw * 0.9 - 0.2; r.armR.up.rotation.x = sw * 0.9 - 0.2;
      r.armL.low.rotation.x = -1.3; r.armR.low.rotation.x = -1.3;
      r.armL.up.rotation.z = 0.25; r.armR.up.rotation.z = -0.25;
    }
    // hit tint
    const hitK = rs.hitT > 0 ? Math.min(1, rs.hitT * 2) : 0;
    for (const m of r.mats) { m.emissive.setRGB(hitK * 0.9, hitK * 0.1, hitK * 0.05); }
    if (rs.invuln > 0) r.root.visible = Math.floor(t * 14) % 2 === 0; else r.root.visible = true;

    // camera
    const camX = rs.x * 0.5, lookX = rs.x * 0.75;
    const bob = this.reduced ? 0 : Math.sin(ph * 2) * 0.025;
    this.shake *= Math.pow(0.001, dt);
    const sh = this.shake * (this.reduced ? 0.3 : 1);
    this.camera.position.x += ((camX + (Math.random() - 0.5) * sh * 0.3) - this.camera.position.x) * Math.min(1, dt * 6);
    this.camera.position.y = 2.45 + bob + (Math.random() - 0.5) * sh * 0.25 + jumpY * 0.22;
    this.camera.position.z = 5.4 - Math.min(0.5, (speed - 8) * 0.03);
    this.camera.lookAt(lookX, 1.1 + jumpY * 0.3, -7);
    this.camera.fov = (this.camera.aspect < 1 ? 72 : 60) + Math.min(10, Math.max(0, (speed - 9) * 0.9));
    this.camera.updateProjectionMatrix();
    this.sky.position.copy(this.camera.position);
    if (this.clouds) this.clouds.position.x = this.camera.position.x;
    this.sun.position.set(this.camera.position.x, 0, 0).add(new THREE.Vector3(...this.world.sun.pos).normalize().multiplyScalar(40));
    this.sun.target.position.set(rs.x, 0, -4);

    this.renderer.render(this.scene, this.camera);

    // adaptive quality
    if (this.quality === 'auto') {
      this.fpsSamples.push(1 / Math.max(dt, 1e-3));
      if (this.fpsSamples.length >= 90) {
        const avg = this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length;
        this.fps = avg; this.fpsSamples.length = 0;
        if (avg < 42 && this.level > 0) { this.level--; this.applyLevel(); }
        else if (avg > 58 && this.level < 2 && t - this._lastQualityCheck > 12) { this.level++; this.applyLevel(); this._lastQualityCheck = t; }
      }
    }
  }

  // Render a single frame without advancing (used after resize while paused).
  renderOnce() { this.renderer.render(this.scene, this.camera); }
}
