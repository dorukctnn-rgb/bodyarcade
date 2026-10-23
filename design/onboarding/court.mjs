// The Court: BodyArcade's 3D stage. A round sports-floor platform with painted lines
// (the flush target line under the player, a sky arc), props from the first games
// (Squat Flap columns and bird, Star Catch stars, a Pad Work pad) and a firework burst.
import * as THREE from 'three';

export const PALETTES = {
  light: {
    bg: '#F4F2F8', floor: '#E9E5F1', platform: '#FBFAFD', platformSide: '#DCD6E8', ringLine: '#CFC7E0',
    line: '#FF4F6E', arc: '#46B4FF', body: '#2B2248', head: '#FF4F6E', left: '#FFC53A', right: '#46B4FF',
    shoe: '#F4F2F8', highlight: '#FF4F6E', ice: '#CDEBFF', iceSide: '#46B4FF', star: '#FFC53A', pad: '#46B4FF', padRim: '#1C1433',
    bird: '#FF4F6E', hemiSky: '#FFFFFF', hemiGround: '#BDB3D6', key: '#FFF5EE', rim: '#FFC2CE', device: '#2B2248', screen: '#46B4FF',
  },
  dark: {
    bg: '#1A1430', floor: '#211A3B', platform: '#2B2248', platformSide: '#140F27', ringLine: '#40366E',
    line: '#FF4F6E', arc: '#46B4FF', body: '#F4F2F8', head: '#FF4F6E', left: '#FFC53A', right: '#46B4FF',
    shoe: '#1C1433', highlight: '#FF4F6E', ice: '#CFE9FF', iceSide: '#6FB7EE', star: '#FFC53A', pad: '#46B4FF', padRim: '#F4F2F8',
    bird: '#FF4F6E', hemiSky: '#8E85B8', hemiGround: '#140F27', key: '#FFF1E8', rim: '#FF8FA3', device: '#F4F2F8', screen: '#46B4FF',
  },
};

function floorTexture(pal, size = 1024) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const s = size / 2;
  g.fillStyle = pal.platform; g.fillRect(0, 0, size, size);
  g.lineCap = 'round';
  // Outer ring line.
  g.strokeStyle = pal.ringLine; g.lineWidth = size * 0.008;
  g.beginPath(); g.arc(s, s, s * 0.93, 0, Math.PI * 2); g.stroke();
  // Sky arc: the reach zone, three quarters of a circle behind the player.
  g.strokeStyle = pal.arc; g.lineWidth = size * 0.016;
  g.beginPath(); g.arc(s, s, s * 0.6, Math.PI * 0.86, Math.PI * 2.14); g.stroke();
  // Small spots where the feet go.
  g.fillStyle = pal.ringLine;
  for (const dx of [-0.09, 0.09]) { g.beginPath(); g.arc(s + dx * s, s + 0.02 * s, s * 0.035, 0, Math.PI * 2); g.fill(); }
  // The line: the target line every game measures against.
  g.strokeStyle = pal.line; g.lineWidth = size * 0.03;
  g.beginPath(); g.moveTo(s - s * 0.5, s + s * 0.2); g.lineTo(s + s * 0.5, s + s * 0.2); g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function blobTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(28,20,51,0.42)');
  grd.addColorStop(0.55, 'rgba(28,20,51,0.18)');
  grd.addColorStop(1, 'rgba(28,20,51,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function starShape(r1 = 0.17, r2 = 0.075) {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const r = i % 2 ? r2 : r1;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}

export function createCourt(pal, opts = {}) {
  const group = new THREE.Group();
  const std = (color, roughness = 0.6, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra });

  // Floor that fades into the background with fog.
  // Seamless studio: the canvas is transparent over the page colour; the floor only shows the
  // soft shadow the platform casts, so there is no horizon line.
  const floor = new THREE.Mesh(new THREE.CircleGeometry(60, 48), new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity: 0.55 }));
  floor.rotation.x = -Math.PI / 2; floor.scale.setScalar(0.11); floor.position.y = 0.001;
  group.add(floor);

  // Platform: rounded side from a lathe profile, painted top from a canvas texture.
  const R = 2.6, H = 0.2, e = 0.07;
  const prof = [new THREE.Vector2(0, 0), new THREE.Vector2(R - e * 0.4, 0)];
  for (let i = 0; i <= 6; i++) {
    const a = -Math.PI / 2 + (i / 6) * Math.PI / 2;
    prof.push(new THREE.Vector2(R - e + Math.cos(a) * e, H - e + e + Math.sin(a) * e));
  }
  prof.push(new THREE.Vector2(0, H));
  const side = new THREE.Mesh(new THREE.LatheGeometry(prof, 72), std(pal.platformSide, 0.85));
  side.receiveShadow = true;
  group.add(side);
  const top = new THREE.Mesh(new THREE.CircleGeometry(R - 0.02, 72), std('#ffffff', 0.85, { map: floorTexture(pal) }));
  top.rotation.x = -Math.PI / 2; top.position.y = H + 0.002; top.receiveShadow = true;
  group.add(top);

  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 1.25), new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2; blob.position.y = H + 0.006;
  group.add(blob);

  // Squat Flap: two ice columns with a gap, and the bird.
  const flap = new THREE.Group();
  flap.position.set(-1.95, H, -1.05);
  const iceMat = std(pal.ice, 0.35), iceSide = std(pal.iceSide, 0.4);
  const column = (y0, y1) => {
    const g = new THREE.Group();
    const len = y1 - y0;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, len, 24), iceMat);
    body.position.y = (y0 + y1) / 2; body.castShadow = true;
    const capY = y0 < 0.5 ? y1 - 0.07 : y0 + 0.07;
    const cap = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.42, 6, 16), iceSide);
    cap.rotation.z = Math.PI / 2; cap.position.y = capY; cap.castShadow = true;
    g.add(body, cap);
    return g;
  };
  flap.add(column(0, 0.95), column(1.95, 3.4));
  const bird = new THREE.Group();
  const bBody = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 14), std(pal.bird, 0.3));
  const wing = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.14, 4, 8), std(pal.body, 0.6));
  wing.position.set(-0.06, 0.06, 0.04); wing.rotation.z = 0.9;
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.11, 10), std(pal.star, 0.4));
  beak.rotation.z = -Math.PI / 2; beak.position.set(0.15, 0.0, 0.02);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.024, 8, 6), std('#1C1433', 0.4));
  eye.position.set(0.08, 0.05, 0.1);
  bird.add(bBody, wing, beak, eye);
  bird.position.set(0.15, 1.45, 0.2);
  bird.castShadow = true;
  flap.add(bird);
  group.add(flap);

  // Star Catch: three stars around reach height.
  const starGeo = new THREE.ExtrudeGeometry(starShape(), { depth: 0.05, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.018, bevelSegments: 2 });
  starGeo.center();
  const starMat = std(pal.star, 0.4, { emissive: pal.star, emissiveIntensity: 0.12 });
  const stars = [[1.35, 2.25, -0.35], [-0.95, 2.62, -0.7], [1.95, 1.2, -0.9]].map(([x, y, z], i) => {
    const m = new THREE.Mesh(starGeo, starMat);
    m.position.set(x, y, z); m.userData.base = y; m.userData.phase = i * 1.9; m.castShadow = true;
    group.add(m); return m;
  });

  // Pad Work: a round pad on the jab side.
  const pad = new THREE.Group();
  const padFace = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.08, 32), std(pal.pad, 0.45));
  padFace.rotation.x = Math.PI / 2;
  const padRim = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.03, 10, 32), std(pal.padRim, 0.5));
  pad.add(padFace, padRim);
  pad.position.set(0.95, 1.5, 0.75);
  pad.lookAt(0, 1.45, 0);
  pad.castShadow = true;
  group.add(pad);

  // Firework burst at the top of the jump.
  const SPARKS = 26;
  const sparkGeo = new THREE.SphereGeometry(0.035, 8, 6);
  const sparkMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
  const sparks = new THREE.InstancedMesh(sparkGeo, sparkMat, SPARKS);
  const sparkCols = [pal.star, pal.line, pal.arc, '#FFFFFF'];
  const vel = [];
  for (let i = 0; i < SPARKS; i++) {
    sparks.setColorAt(i, new THREE.Color(sparkCols[i % sparkCols.length]));
    const a = (i / SPARKS) * Math.PI * 2, el = 0.35 + (i % 5) * 0.12;
    vel.push(new THREE.Vector3(Math.cos(a) * Math.cos(el), Math.sin(el) + 0.25, Math.sin(a) * Math.cos(el)).multiplyScalar(1.5 + (i % 3) * 0.3));
  }
  sparks.instanceColor.needsUpdate = true;
  sparks.visible = false;
  group.add(sparks);

  // Clear-space ring (step 4): dashes on the floor, 1 m radius around the player.
  const ring = new THREE.Group();
  const dashGeo = new THREE.BoxGeometry(0.16, 0.012, 0.05);
  const dashMat = new THREE.MeshBasicMaterial({ color: pal.line, transparent: true });
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const d = new THREE.Mesh(dashGeo, dashMat);
    d.position.set(Math.cos(a) * 1.0, H + 0.01, Math.sin(a) * 1.0);
    d.rotation.y = -a + Math.PI / 2;
    ring.add(d);
  }
  ring.visible = false;
  group.add(ring);

  const t0 = { burst: -10 };
  const tmp = new THREE.Object3D();
  return {
    group, blob, bird, stars, pad, sparks, ring, dashMat, top, H, flap,
    burst(t, at) { t0.burst = t; t0.at = at.clone(); },
    update(t, info = {}) {
      for (const s of stars) {
        s.rotation.y = t * 0.9 + s.userData.phase;
        s.position.y = s.userData.base + Math.sin(t * 1.4 + s.userData.phase) * 0.06;
      }
      // Bird rises when the player stands up out of the squat, then glides down.
      const flapT = info.flapT ?? -10;
      const k = Math.max(0, 1 - (t - flapT) / 1.2);
      bird.position.y = 1.32 + Math.sin(t * 2.2) * 0.04 + 0.32 * Math.sin(Math.min(1, (t - flapT) / 0.4) * Math.PI / 2) * k;
      bird.rotation.z = -0.15 + 0.35 * k;
      bird.children[1].rotation.z = 0.9 + Math.sin(t * 18) * 0.5 * k;
      // Pad pulse on a hit.
      const hit = Math.max(0, 1 - (t - (info.hitT ?? -10)) / 0.35);
      pad.scale.setScalar(1 + 0.16 * hit);
      // Sparks.
      const age = t - t0.burst;
      sparks.visible = age >= 0 && age < 1.3;
      if (sparks.visible) {
        for (let i = 0; i < SPARKS; i++) {
          const v = vel[i];
          tmp.position.set(t0.at.x + v.x * age, t0.at.y + v.y * age - 1.6 * age * age, t0.at.z + v.z * age);
          tmp.scale.setScalar(Math.max(0.001, 1 - age / 1.3));
          tmp.updateMatrix();
          sparks.setMatrixAt(i, tmp.matrix);
        }
        sparks.instanceMatrix.needsUpdate = true;
      }
    },
  };
}

/** A phone on a small stand or a laptop on a low table, for the space and safety step. */
export function createDevice(pal, kind = 'phone', orientation = 'portrait') {
  const g = new THREE.Group();
  const std = (c, r = 0.5) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
  if (kind === 'phone') {
    // Group origin is on the floor; the phone sits on a stand at about hip height.
    const w = orientation === 'portrait' ? 0.17 : 0.34, h = orientation === 'portrait' ? 0.34 : 0.17;
    const standH = 0.62;
    const cy = standH + h / 2 + 0.03;
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.03), std(pal.device, 0.35));
    body.position.y = cy;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.88, h * 0.9), new THREE.MeshBasicMaterial({ color: pal.screen }));
    screen.position.z = -0.016; screen.rotation.y = Math.PI;
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.012, 16), new THREE.MeshBasicMaterial({ color: '#0E0A1C' }));
    lens.position.set(0, h / 2 - 0.03, -0.0165); lens.rotation.y = Math.PI;
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, standH, 10), std('#6B6385', 0.6));
    stand.position.y = standH / 2 + 0.015;
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.03, 24), std('#6B6385', 0.6));
    foot.position.y = 0.015;
    body.add(screen, lens);
    g.add(body, stand, foot);
    g.userData.lens = new THREE.Vector3(0, cy + h / 2 - 0.03, -0.02);
  } else {
    const table = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.04, 0.45), std('#C9B79C', 0.7));
    table.position.y = 0.5;
    for (const [x, z] of [[-0.3, -0.18], [0.3, -0.18], [-0.3, 0.18], [0.3, 0.18]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 8), std('#A8957A', 0.7));
      leg.position.set(x, 0.25, z); g.add(leg);
    }
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.015, 0.25), std(pal.device, 0.4));
    base.position.y = 0.53;
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.24, 0.012), std(pal.device, 0.4));
    lid.position.set(0, 0.65, -0.12); lid.rotation.x = -0.18;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.2), new THREE.MeshBasicMaterial({ color: pal.screen }));
    screen.position.z = 0.007; lid.add(screen);
    g.add(table, base, lid);
    g.userData.lens = new THREE.Vector3(0, 0.76, -0.1);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
