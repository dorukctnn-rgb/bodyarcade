// Catalogue art: one small 3D diorama per release 1 game, in the Court language of the
// onboarding (the Mover on a round puck, the flush target line, soft clay materials, one warm
// key light). Rendered offline to WebP by design/tools/render-tiles.mjs; nothing here runs in
// the product, so the scenes may use shadows and more triangles than the phone budget.
import * as THREE from 'three';
import { createMover, applyPose, POSES, groundMover } from '../onboarding/mover.mjs';

const INK = '#1C1433', CHALK = '#F4F2F8', FLUSH = '#FF4F6E', SKY = '#46B4FF', SUN = '#FFC53A', GO = '#22C383';

/** Per game: tile colour (the template world), whether the tile is dark, the pose and a camera. */
export const TILE_ART = {
  'squat-flap': { bg: '#B7BFF4', pose: 'squat', cam: { pos: [2.6, 2.2, 7.4], target: [0.75, 1.45, -0.4], fov: 30 } },
  'knee-sprint': { bg: '#FFC3A1', pose: 'highKnee', cam: { pos: [3.6, 2.2, 7.2], target: [0.1, 1.15, -0.6], fov: 28 } },
  'road-run': { bg: '#BFE3C8', pose: 'apex', lift: 0.32, cam: { pos: [3.4, 2.5, 7.8], target: [0, 1.3, -0.4], fov: 27 } },
  'star-catch': { bg: '#241C40', dark: true, pose: 'reachUp', cam: { pos: [2.2, 1.9, 7.6], target: [0.3, 1.45, 0], fov: 28 } },
  'pad-work': { bg: '#FFD45C', pose: 'jab', cam: { pos: [4.2, 2.1, 6.4], target: [0.35, 1.2, 0.2], fov: 28 } },
  'reaction-tag': { bg: '#CFF1E1', pose: 'tap', cam: { pos: [2.6, 2.6, 7.6], target: [-0.15, 1.05, 0], fov: 28 } },
  'firework-jacks': { bg: '#2B2248', dark: true, pose: 'jackOpen', lift: 0.16, cam: { pos: [2.4, 1.9, 8.2], target: [0, 1.6, 0], fov: 29 } },
  'twist-turbine': { bg: '#40366E', dark: true, pose: 'twist', cam: { pos: [3.2, 2.3, 8.4], target: [-0.3, 1.55, -0.8], fov: 29 } },
  'summit-climb': { bg: '#BFE3FF', pose: 'climb', back: true, cam: { pos: [2.6, 2.0, 6.9], target: [0, 1.45, -0.4], fov: 29 } },
  'limbo-bend': { bg: '#FFD6E0', pose: 'sideBend', cam: { pos: [2.5, 2.0, 7.6], target: [0, 1.2, 0], fov: 28 } },
  'pose-wall': { bg: '#E6E1F2', pose: 'tPose', cam: { pos: [3.1, 2.2, 8.6], target: [0, 1.35, -0.7], fov: 29 } },
};

const mix = (a, b, t) => '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();
const std = (color, roughness = 0.6, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra });
const glow = (color, k = 0.35) => std(color, 0.4, { emissive: color, emissiveIntensity: k });

function lineTexture(top, line, ring, size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const s = size / 2;
  g.fillStyle = top; g.fillRect(0, 0, size, size);
  g.lineCap = 'round';
  g.strokeStyle = ring; g.lineWidth = size * 0.012;
  g.beginPath(); g.arc(s, s, s * 0.9, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = line; g.lineWidth = size * 0.04;
  g.beginPath(); g.moveTo(s - s * 0.55, s + s * 0.3); g.lineTo(s + s * 0.55, s + s * 0.3); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function blobTexture(color, alpha = 0.32) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const col = new THREE.Color(color);
  const rgb = `${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)}`;
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, `rgba(${rgb},${alpha})`);
  grd.addColorStop(0.6, `rgba(${rgb},${alpha * 0.42})`);
  grd.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The puck: a small round court in the tile colour with the flush line painted on it. */
function puck(art, R = 1.25, H = 0.16) {
  const g = new THREE.Group();
  const top = art.dark ? mix(art.bg, '#FFFFFF', 0.1) : mix(art.bg, '#FFFFFF', 0.55);
  const side = art.dark ? mix(art.bg, '#000000', 0.35) : mix(art.bg, INK, 0.22);
  const ring = art.dark ? mix(art.bg, '#FFFFFF', 0.22) : mix(art.bg, INK, 0.12);
  const e = 0.05;
  const prof = [new THREE.Vector2(0, 0), new THREE.Vector2(R - e * 0.4, 0)];
  for (let i = 0; i <= 6; i++) {
    const a = -Math.PI / 2 + (i / 6) * (Math.PI / 2);
    prof.push(new THREE.Vector2(R - e + Math.cos(a) * e, H - e + e + Math.sin(a) * e));
  }
  prof.push(new THREE.Vector2(0, H));
  const sideMesh = new THREE.Mesh(new THREE.LatheGeometry(prof, 96), std(side, 0.85));
  sideMesh.receiveShadow = true; sideMesh.castShadow = true;
  const topMesh = new THREE.Mesh(new THREE.CircleGeometry(R - 0.015, 96), std('#ffffff', 0.85, { map: lineTexture(top, FLUSH, ring) }));
  topMesh.rotation.x = -Math.PI / 2; topMesh.position.y = H + 0.002; topMesh.receiveShadow = true;
  g.add(sideMesh, topMesh);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(R * 3.4, R * 3.4), new THREE.MeshBasicMaterial({ map: blobTexture(art.dark ? '#000000' : mix(art.bg, INK, 0.55), art.dark ? 0.5 : 0.4), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = -0.002;
  g.add(shadow);
  g.userData.H = H;
  return g;
}

function starGeometry(r1 = 0.2, r2 = 0.09, depth = 0.06) {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const r = i % 2 ? r2 : r1;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r); else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.022, bevelSegments: 3 });
  geo.center();
  return geo;
}

function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r); s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2); s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r); s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return s;
}

function bird(color = FLUSH, wingColor = INK) {
  const b = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.2, 28, 20), std(color, 0.3));
  const wing = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.22, 6, 12), std(wingColor, 0.55));
  wing.position.set(-0.07, 0.12, 0.1); wing.rotation.z = 1.05; wing.rotation.x = -0.3;
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.17, 14), std(SUN, 0.4));
  beak.rotation.z = -Math.PI / 2; beak.position.set(0.24, -0.01, 0.03);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), std(INK, 0.35));
  eye.position.set(0.12, 0.08, 0.14);
  b.add(body, wing, beak, eye);
  b.traverse((o) => { o.castShadow = true; });
  return b;
}

function iceColumn(y0, y1, capAt) {
  const g = new THREE.Group();
  const ice = std('#EEF8FF', 0.28, { emissive: '#CFE9FF', emissiveIntensity: 0.32 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, y1 - y0, 40), ice);
  body.position.y = (y0 + y1) / 2; body.castShadow = true; body.receiveShadow = true;
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.274, 0.274, y1 - y0, 40, 1, true, 0.9, 0.7), std('#9ED2F7', 0.35, { emissive: '#9ED2F7', emissiveIntensity: 0.15 }));
  stripe.position.y = (y0 + y1) / 2;
  const cap = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.52, 8, 24), std('#FFFFFF', 0.3, { emissive: '#FFFFFF', emissiveIntensity: 0.18 }));
  cap.rotation.z = Math.PI / 2; cap.position.y = capAt; cap.castShadow = true;
  g.add(body, stripe, cap);
  return g;
}

function burst(color, n = 14, r = 0.55) {
  const g = new THREE.Group();
  const mat = glow(color, 0.55);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const len = r * (0.62 + 0.38 * ((i * 7) % 3) / 2);
    const stick = new THREE.Mesh(new THREE.CapsuleGeometry(0.022, len * 0.55, 4, 8), mat);
    stick.position.set(Math.cos(a) * len * 0.55, Math.sin(a) * len * 0.55, 0);
    stick.rotation.z = a - Math.PI / 2;
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), mat);
    tip.position.set(Math.cos(a) * len, Math.sin(a) * len, 0);
    g.add(stick, tip);
  }
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 10), glow(color, 0.8));
  g.add(core);
  return g;
}

function holdMesh(color, s = 1) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.1 * s, 16, 12), std(color, 0.55));
  m.scale.set(1.3, 0.8, 0.7);
  m.castShadow = true;
  return m;
}

/** Props per game, added around the puck. Returns nothing; adds to group. */
const PROPS = {
  'squat-flap'(g, art) {
    const cols = new THREE.Group();
    cols.position.set(1.85, 0, -1.2);
    cols.add(iceColumn(0, 1.25, 1.18), iceColumn(2.75, 5.5, 2.82));
    const cols2 = new THREE.Group();
    cols2.position.set(3.0, 0, -3.0);
    cols2.add(iceColumn(0, 1.9, 1.83), iceColumn(3.3, 6.0, 3.37));
    g.add(cols, cols2);
    const b = bird();
    b.position.set(1.2, 2.05, -0.7); b.rotation.z = 0.25; b.rotation.y = -0.3; b.scale.setScalar(1.1);
    g.add(b);
    // two wing-beat puffs behind the bird
    for (const [x, y, s] of [[0.72, 1.9, 0.075], [0.47, 1.8, 0.055]]) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(s, 12, 10), std('#FFFFFF', 0.4, { emissive: '#FFFFFF', emissiveIntensity: 0.2 }));
      p.position.set(x, y, -0.62); g.add(p);
    }
  },
  'knee-sprint'(g, art) {
    // Three lanes running away from the puck, and a finish gate.
    const lanes = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.06, 7.5), std('#3A3060', 0.8));
    lanes.position.set(0, 0.03, -3.6); lanes.receiveShadow = true;
    g.add(lanes);
    for (const x of [-0.8, 0, 0.8]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.008, 7.5), std(CHALK, 0.6));
      l.position.set(x + 0.4, 0.064, -3.6); g.add(l);
    }
    for (const x of [-1.15, 1.15]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 16), std(CHALK, 0.5));
      post.position.set(x, 1.3, -5.2); post.castShadow = true; g.add(post);
    }
    const tape = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.32, 0.06), std(FLUSH, 0.45));
    tape.position.set(0, 2.45, -5.2); g.add(tape);
  },
  'road-run'(g, art) {
    const road = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.05, 9), std('#3A3060', 0.85));
    road.position.set(0, 0.025, -4.3); road.receiveShadow = true; g.add(road);
    for (let i = 0; i < 7; i++) {
      const d = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.008, 0.45), std(CHALK, 0.6));
      d.position.set(0, 0.054, -1.6 - i * 1.05); g.add(d);
    }
    const bar = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 1.15, 6, 16), std(FLUSH, 0.45));
    bar.rotation.z = Math.PI / 2; bar.position.set(0, 0.42, 1.0); bar.castShadow = true; g.add(bar);
    for (const x of [-0.66, 0.66]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.42, 10), std(CHALK, 0.5));
      leg.position.set(x, 0.21 + 0.16, 1.0); g.add(leg);
    }
    const hill = (x, z, r, c) => { const h = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), std(c, 0.9)); h.position.set(x, 0, z); h.scale.y = 0.55; h.receiveShadow = true; g.add(h); };
    hill(-2.6, -4.2, 1.6, '#9FCFAE'); hill(2.9, -5.4, 2.0, '#8CC59D'); hill(-1.2, -8.5, 2.4, '#A9D7B7');
    const sun = new THREE.Mesh(new THREE.CircleGeometry(0.42, 40), new THREE.MeshBasicMaterial({ color: '#FFE7A8' }));
    sun.position.set(1.5, 3.2, -7); g.add(sun);
  },
  'star-catch'(g, art) {
    const geo = starGeometry(0.24, 0.105, 0.07);
    const add = (x, y, z, color, s = 1, rot = 0) => { const m = new THREE.Mesh(geo, glow(color, 0.42)); m.position.set(x, y, z); m.scale.setScalar(s); m.rotation.set(0.15, rot, 0.1); m.castShadow = true; g.add(m); return m; };
    add(0.86, 2.62, 0.05, SUN, 1.15, -0.3);
    add(-1.05, 1.42, 0.25, SKY, 0.95, 0.4);
    add(1.75, 1.7, -1.1, SUN, 0.7, 0.2);
    add(-1.65, 2.45, -1.3, SKY, 0.62, -0.2);
    add(0.0, 3.25, -2.2, SUN, 0.45, 0.1);
    // a faint trail from the caught star to the hand
    const trail = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.012, 6, 40, 1.4), new THREE.MeshBasicMaterial({ color: SUN, transparent: true, opacity: 0.6 }));
    trail.position.set(0.55, 2.45, 0.05); trail.rotation.z = 0.5; g.add(trail);
  },
  'pad-work'(g, art) {
    const pad = (x, y, z, color, s = 1, look = [0, 1.45, 0]) => {
      const p = new THREE.Group();
      const face = new THREE.Mesh(new THREE.CylinderGeometry(0.24 * s, 0.24 * s, 0.12, 40), std(color, 0.45));
      face.rotation.x = Math.PI / 2;
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.24 * s, 0.045, 12, 40), std(INK, 0.5));
      const dot = new THREE.Mesh(new THREE.CylinderGeometry(0.07 * s, 0.07 * s, 0.13, 24), std('#FFFFFF', 0.45));
      dot.rotation.x = Math.PI / 2;
      p.add(face, rim, dot);
      p.position.set(x, y, z); p.lookAt(...look);
      p.traverse((o) => { o.castShadow = true; });
      g.add(p);
      return p;
    };
    pad(1.05, 1.62, 0.55, SKY, 1.05);
    pad(-0.95, 1.5, 0.75, FLUSH, 0.82, [1.5, 1.6, 6]);
    // hit rings on the struck pad
    for (const [r, o] of [[0.36, 0.9], [0.5, 0.5]]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.016, 6, 48), new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: o }));
      ring.position.set(1.05, 1.62, 0.55); ring.lookAt(0, 1.45, 0); g.add(ring);
    }
  },
  'reaction-tag'(g, art) {
    const light = (x, y, z, color, on = true, s = 1) => {
      const l = new THREE.Group();
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.2 * s, 0.2 * s, 0.07, 36), on ? glow(color, 0.5) : std('#B8D8C9', 0.6));
      disc.rotation.x = Math.PI / 2;
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.2 * s, 0.03, 10, 36), std('#FFFFFF', 0.4));
      l.add(disc, rim);
      if (on) { const halo = new THREE.Mesh(new THREE.TorusGeometry(0.31 * s, 0.014, 6, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55 })); l.add(halo); }
      l.position.set(x, y, z); l.lookAt(0, 1.3, 2.5);
      l.traverse((o) => { o.castShadow = true; });
      g.add(l);
    };
    light(-1.2, 1.5, 0.4, GO);
    light(-0.55, 2.35, -0.3, GO, true, 0.9);
    light(1.25, 2.15, -0.5, FLUSH, true, 0.9);
    light(1.45, 1.05, 0.2, GO, false, 0.85);
    light(0.4, 2.85, -1.2, GO, true, 0.7);
  },
  'firework-jacks'(g, art) {
    const add = (x, y, z, c, r, n) => { const b = burst(c, n, r); b.position.set(x, y, z); b.lookAt(x * 0.2, y, 8); g.add(b); };
    add(-1.2, 3.05, -1.2, SUN, 0.75, 16);
    add(1.35, 3.35, -1.8, FLUSH, 0.62, 14);
    add(0.2, 3.85, -2.8, SKY, 0.5, 12);
    // small city skyline behind, unlit blocks with sun windows
    for (let i = 0; i < 9; i++) {
      const w = 0.5 + (i % 3) * 0.15, h = 0.6 + ((i * 5) % 4) * 0.28;
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.5), std('#1F1838', 0.9));
      b.position.set(-3.2 + i * 0.8, h / 2, -3.2 - (i % 2) * 0.5); g.add(b);
      for (let k = 0; k < 2; k++) {
        const win = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.02), glow(SUN, 0.9));
        win.position.set(b.position.x - 0.1 + k * 0.2, h * 0.65, b.position.z + 0.26); g.add(win);
      }
    }
  },
  'twist-turbine'(g, art) {
    const t = new THREE.Group();
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.11, 3.4, 20), std(CHALK, 0.5));
    tower.position.y = 1.7; tower.castShadow = true;
    const hub = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 14), std(FLUSH, 0.4));
    hub.position.set(0, 3.45, 0.12);
    t.add(tower, hub);
    for (let i = 0; i < 3; i++) {
      const blade = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 1.2, 6, 12), std(SKY, 0.45));
      blade.geometry.translate(0, 0.72, 0);
      blade.position.set(0, 3.45, 0.18); blade.rotation.z = i * (Math.PI * 2 / 3) + 0.4;
      blade.castShadow = true;
      t.add(blade);
    }
    t.position.set(-1.75, 0, -1.5); t.scale.setScalar(0.82);
    g.add(t);
    // the city that lights up
    for (let i = 0; i < 8; i++) {
      const w = 0.55, h = 0.7 + ((i * 3) % 5) * 0.3;
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.55), std('#31285A', 0.9));
      b.position.set(-0.4 + i * 0.66, h / 2, -3.4 - (i % 2) * 0.45); b.receiveShadow = true; g.add(b);
      for (let r = 0; r < Math.floor(h / 0.32); r++) {
        for (let k = 0; k < 2; k++) {
          const lit = (i + r + k) % 3 !== 0;
          const win = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.13, 0.02), lit ? glow(SUN, 0.95) : std('#40366E', 0.8));
          win.position.set(b.position.x - 0.12 + k * 0.24, 0.24 + r * 0.32, b.position.z + 0.28); g.add(win);
        }
      }
    }
    // twist arc on the puck
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.025, 8, 48, Math.PI * 0.9), new THREE.MeshBasicMaterial({ color: SKY }));
    arc.rotation.x = -Math.PI / 2; arc.rotation.z = 0.2; arc.position.y = 0.19; g.add(arc);
  },
  'summit-climb'(g, art) {
    // A faceted cliff in front of the climber (the camera looks at their back).
    const shape = new THREE.Shape();
    shape.moveTo(-2.4, 0); shape.lineTo(2.3, 0); shape.lineTo(2.0, 2.6); shape.lineTo(1.2, 4.1); shape.lineTo(0.2, 4.6); shape.lineTo(-1.1, 4.0); shape.lineTo(-2.1, 2.9); shape.closePath();
    const cliff = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.9, bevelEnabled: true, bevelThickness: 0.18, bevelSize: 0.16, bevelSegments: 2 }), std('#9C8BD6', 0.9, { flatShading: true }));
    cliff.position.set(0, 0, -1.65); cliff.receiveShadow = true; cliff.castShadow = true;
    g.add(cliff);
    const snow = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.45, 5), std('#FFFFFF', 0.6, { flatShading: true }));
    snow.position.set(0.2, 4.68, -1.2); g.add(snow);
    const flag = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.02), std(FLUSH, 0.5));
    flag.position.set(0.37, 5.15, -1.2); g.add(flag);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.6, 8), std(INK, 0.5));
    pole.position.set(0.2, 5.05, -1.2); g.add(pole);
    const holds = [[-0.42, 2.72, SUN], [0.55, 2.2, FLUSH], [-0.9, 1.75, FLUSH], [0.3, 1.2, SUN], [-0.35, 0.62, SUN], [0.95, 3.25, SUN], [-1.2, 3.0, FLUSH], [0.0, 3.7, FLUSH], [1.35, 1.6, SUN], [-1.5, 1.0, SUN]];
    for (const [x, y, c] of holds) { const h = holdMesh(c, 1.15); h.position.set(x, y, -0.56); g.add(h); }
  },
  'limbo-bend'(g, art) {
    const outer = roundedRectShape(1.75, 2.35, 0.42);
    const hole = roundedRectShape(1.35, 1.95, 0.24);
    outer.holes.push(new THREE.Path(hole.getPoints(24).reverse()));
    const gate = new THREE.Mesh(new THREE.ExtrudeGeometry(outer, { depth: 0.18, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 3, curveSegments: 18 }), std(SKY, 0.4));
    gate.geometry.center();
    gate.position.set(0.05, 1.32, -0.05); gate.rotation.z = -0.36;
    gate.castShadow = true;
    g.add(gate);
    const gate2 = gate.clone(); gate2.material = std(mix(SKY, art.bg, 0.55), 0.5);
    gate2.position.set(0.5, 1.36, -2.4); gate2.rotation.z = 0.3; g.add(gate2);
  },
  'pose-wall'(g, art) {
    // The flush wall with a T-shaped cut-out, sliding towards the player.
    const wall = new THREE.Shape();
    wall.moveTo(-2.1, 0); wall.lineTo(2.1, 0); wall.lineTo(2.1, 3.0); wall.lineTo(-2.1, 3.0); wall.closePath();
    const cut = new THREE.Path();
    const pts = [[-0.22, 0.12], [0.22, 0.12], [0.22, 1.25], [0.95, 1.25], [0.95, 1.62], [0.22, 1.62], [0.22, 1.78], [0.3, 1.86], [0.3, 2.22], [0.0, 2.42], [-0.3, 2.22], [-0.3, 1.86], [-0.22, 1.78], [-0.22, 1.62], [-0.95, 1.62], [-0.95, 1.25], [-0.22, 1.25]];
    cut.moveTo(pts[0][0] * 1.0, pts[0][1]);
    for (const [x, y] of pts.slice(1)) cut.lineTo(x, y);
    cut.closePath();
    wall.holes.push(cut);
    const w = new THREE.Mesh(new THREE.ExtrudeGeometry(wall, { depth: 0.32, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2 }), std(FLUSH, 0.5));
    w.position.set(0, 0.16, -1.25); w.scale.set(1.12, 1.0, 1); w.castShadow = true; w.receiveShadow = true;
    g.add(w);
    // rails it slides on
    for (const x of [-1.9, 1.9]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 5), std(mix(art.bg, INK, 0.3), 0.7));
      rail.position.set(x, 0.025, -2.0); g.add(rail);
    }
  },
};

/** Build the whole tile scene. Returns { scene, camera }. */
export function buildTile(id, aspect = 4 / 3) {
  const art = TILE_ART[id];
  if (!art) throw new Error(`no tile art for ${id}`);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(art.bg);
  const hemi = new THREE.HemisphereLight('#FFFFFF', art.dark ? '#140F27' : mix(art.bg, INK, 0.35), art.dark ? 1.15 : 1.45);
  const key = new THREE.DirectionalLight('#FFF5EE', art.dark ? 2.0 : 2.45);
  key.position.set(-4.5, 7.5, 5.5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -4, right: 4, top: 5, bottom: -3, near: 1, far: 25 });
  key.shadow.bias = -0.0005; key.shadow.radius = 5;
  const rim = new THREE.DirectionalLight(art.dark ? '#FF8FA3' : '#FFFFFF', art.dark ? 1.4 : 0.7);
  rim.position.set(3, 2.4, -6);
  scene.add(hemi, key, rim);

  const g = new THREE.Group();
  scene.add(g);
  const p = puck(art);
  g.add(p);
  PROPS[id](g, art);

  const colors = art.dark
    ? { body: CHALK, head: FLUSH, left: SUN, right: SKY, shoe: INK, highlight: FLUSH }
    : { body: '#2B2248', head: FLUSH, left: SUN, right: SKY, shoe: CHALK, highlight: FLUSH };
  const mover = createMover(colors);
  applyPose(mover, POSES[art.pose]);
  if (art.back) mover.root.rotation.y = Math.PI;
  g.add(mover.root);
  groundMover(mover, p.userData.H, art.lift ?? 0);
  if ((art.lift ?? 0) > 0) {
    // airborne: a small shadow disc stays on the puck
    const s = new THREE.Mesh(new THREE.CircleGeometry(0.42, 32), new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0.12, depthWrite: false }));
    s.rotation.x = -Math.PI / 2; s.position.y = p.userData.H + 0.004; g.add(s);
  }
  scene.traverse((o) => { if (o.isMesh && o.castShadow === undefined) o.castShadow = true; });
  mover.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });

  const camera = new THREE.PerspectiveCamera(art.cam.fov, aspect, 0.1, 80);
  camera.position.set(...art.cam.pos);
  camera.lookAt(new THREE.Vector3(...art.cam.target));
  return { scene, camera, art };
}
