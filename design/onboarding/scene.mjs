// Onboarding 3D stage: one continuous scene; each onboarding step is a camera view and a
// small change on the court. Phone budget (design/onboarding/BUDGET in index.html notes):
// under 60 draw calls, under 30k triangles, no post-processing, shadows only on tier 2.
import * as THREE from 'three';
import { createMover, applyPose, sampleLoop, HERO_LOOP, POSES, highlightRegions } from './mover.mjs';
import { createCourt, createDevice, PALETTES } from './court.mjs';

export const TIERS = {
  0: { dpr: 1.0, shadows: false, fps: 30, label: 'T0 low' },
  1: { dpr: 1.25, shadows: false, fps: 60, label: 'T1 mid' },
  2: { dpr: 1.6, shadows: true, fps: 60, label: 'T2 high' },
};

// Camera views per step: position, target, field of view, and the points that must stay in frame.
const VIEWS = {
  1: { pos: [2.4, 2.05, 8.6], target: [0, 1.22, 0], fov: 28, keep: 'hero', topLimit: 0.66 },
  2: { pos: [0.5, 1.55, 5.0], target: [0, 1.2, 0], fov: 30, keep: 'body' },
  3: { pos: [-1.4, 1.65, 6.0], target: [0, 1.05, 0], fov: 28, keep: 'body' },
  4: { pos: [5.2, 4.6, 7.2], target: [0, 0.65, 1.2], fov: 30, keep: 'space' },
  5: { pos: [0, 1.25, 4.6], target: [0, 1.12, 0], fov: 32, keep: 'device' },
};

const KEEP = {
  hero: [[0, 2.75, 0], [-0.55, 0.2, 0.3], [0.55, 0.2, 0.3], [1.35, 2.4, -0.35], [-0.95, 2.75, -0.7], [1.95, 1.05, -0.9], [0.95, 1.5, 0.75], [-1.95, 1.5, -1.05], [-1.95, 0.2, -1.05]],
  body: [[0, 2.2, 0], [-0.6, 0.15, 0.2], [0.6, 0.15, 0.2], [-0.75, 1.3, 0], [0.75, 1.3, 0]],
  heroNarrow: [[0, 2.85, 0], [-0.55, 0.18, 0.3], [0.55, 0.18, 0.3], [0.85, 1.5, 0.7], [-1.3, 1.45, -0.9]],
  space: [[0, 2.0, 0], [-1.1, 0.2, -1.1], [1.1, 0.2, 1.1], [0, 1.6, 2.5], [0, 0.2, 2.7], [-1.1, 0.2, 1.0], [1.1, 0.2, -1.0]],
  device: [[0, 2.15, 0], [-0.75, 0.15, 0.3], [0.75, 0.15, 0.3]],
};

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export function createStage(canvas, opts = {}) {
  const theme = opts.theme ?? 'light';
  const pal = PALETTES[theme];
  let tier = TIERS[opts.tier ?? 1] ? (opts.tier ?? 1) : 1;
  const reduced = opts.reducedMotion ?? matchMedia('(prefers-reduced-motion: reduce)').matches;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.capture });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Neutral keeps the brand colours true; AgX washed the flush ball out to salmon.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = theme === 'dark' ? 1.1 : 0.98;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  // The page colour shows through the canvas, so the stage matches light and dark themes exactly.
  renderer.setClearColor(pal.bg, opts.capture ? 1 : 0);

  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 80);

  // Light: one warm key from the upper left front, a soft sky and ground fill, a flush rim from behind.
  const hemi = new THREE.HemisphereLight(pal.hemiSky, pal.hemiGround, theme === 'dark' ? 1.1 : 1.35);
  const key = new THREE.DirectionalLight(pal.key, theme === 'dark' ? 2.3 : 2.5);
  key.position.set(-4.5, 7.5, 5.5);
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -3.2; key.shadow.camera.right = 3.2; key.shadow.camera.top = 3.6; key.shadow.camera.bottom = -2.4;
  key.shadow.camera.near = 2; key.shadow.camera.far = 20;
  key.shadow.bias = -0.0006; key.shadow.radius = 6;
  const rim = new THREE.DirectionalLight(pal.rim, theme === 'dark' ? 1.5 : 0.9);
  rim.position.set(3, 2.2, -6);
  scene.add(hemi, key, rim);

  const court = createCourt(pal);
  scene.add(court.group);
  const mover = createMover({ body: pal.body, head: pal.head, left: pal.left, right: pal.right, shoe: pal.shoe, highlight: pal.highlight });
  mover.root.position.y = court.H;
  scene.add(mover.root);

  // 33 tracking points for step 2 (the same count as the pose model): face 11, body 22.
  const mGeo = new THREE.SphereGeometry(0.032, 10, 8);
  const mMat = new THREE.MeshBasicMaterial({ color: pal.line, toneMapped: false });
  const addMarker = (parent, x, y, z, s = 1) => { const m = new THREE.Mesh(mGeo, mMat); m.position.set(x, y, z); m.scale.setScalar(s); parent.add(m); return m; };
  const markerList = [];
  const J = mover.joints;
  const head = mover.parts.head;
  for (const [x, y] of [[0, -0.02], [-0.05, 0.05], [-0.08, 0.055], [-0.11, 0.05], [0.05, 0.05], [0.08, 0.055], [0.11, 0.05], [-0.18, 0.02], [0.18, 0.02], [-0.04, -0.09], [0.04, -0.09]]) {
    const z = Math.sqrt(Math.max(0, 0.2 * 0.2 - x * x - y * y));
    markerList.push(addMarker(head, x, y, z + 0.004, 0.6));
  }
  for (const s of ['L', 'R']) {
    markerList.push(addMarker(J[`shoulder${s}`], 0, 0, 0.02));
    markerList.push(addMarker(J[`elbow${s}`], 0, 0, 0.03));
    markerList.push(addMarker(J[`elbow${s}`], 0, -0.25, 0.03));
    for (const [x, y] of [[0.04, -0.33], [-0.04, -0.33], [0.06, -0.28]]) markerList.push(addMarker(J[`elbow${s}`], x, y, 0.03, 0.7));
    markerList.push(addMarker(J[`hip${s}`], 0, 0, 0.06));
    markerList.push(addMarker(J[`knee${s}`], 0, 0, 0.06));
    markerList.push(addMarker(J[`ankle${s}`], 0, 0, 0.05));
    markerList.push(addMarker(J[`ankle${s}`], 0, -0.05, -0.05, 0.8));
    markerList.push(addMarker(J[`ankle${s}`], 0, -0.03, 0.17, 0.8));
  }
  markerList.forEach((m) => { m.visible = false; });

  const ghostMat = new THREE.MeshStandardMaterial({ color: pal.body, roughness: 0.6, transparent: true, opacity: 0.22, depthWrite: false });

  // Space and safety: device in front, sight cone, distance dashes.
  const devices = { phone: createDevice(pal, 'phone', 'portrait'), phoneLand: createDevice(pal, 'phone', 'landscape'), laptop: createDevice(pal, 'laptop') };
  for (const d of Object.values(devices)) { d.position.set(0, court.H, 2.45); d.scale.setScalar(1.5); d.visible = false; scene.add(d); }
  devices.laptop.rotation.y = Math.PI;
  // Field of view of the device camera: apex at the lens, opening towards the player.
  const cone = new THREE.Mesh(new THREE.ConeGeometry(1.15, 2.3, 40, 1, true), new THREE.MeshBasicMaterial({ color: pal.arc, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
  cone.rotation.x = Math.PI / 2; cone.visible = false;
  scene.add(cone);
  const dist = new THREE.Group();
  for (let i = 0; i < 9; i++) {
    const d = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.012, 0.14), new THREE.MeshBasicMaterial({ color: pal.body }));
    d.position.set(0.62, court.H + 0.012, 0.25 + i * 0.25); dist.add(d);
  }
  dist.visible = false;
  scene.add(dist);

  let step = 1, view = VIEWS[1];
  let logoBand = false; // step 1 has the logo and language button over the top of the stage
  let camFrom = null, camTo = null, camT = 1;
  let regions = new Set();
  let deviceKind = 'phone';
  let clock = 0, last = performance.now(), raf = 0, running = false;
  const frameTimes = [];
  let lastEvents = { flapT: -10, hitT: -10 };
  let lastLoopT = 0;
  const aspectRef = { v: 1 };

  function applyTier() {
    const t = TIERS[tier];
    renderer.setPixelRatio(Math.min(t.dpr, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = t.shadows;
    key.castShadow = t.shadows;
    court.blob.material.opacity = t.shadows ? 0.55 : 1;
    resize();
  }

  function fit(v) {
    // Keep every key point of this view inside the frame at any aspect ratio.
    const pos = new THREE.Vector3(...v.pos), target = new THREE.Vector3(...v.target);
    const dir = pos.clone().sub(target);
    camera.fov = v.fov; camera.aspect = aspectRef.v; camera.updateProjectionMatrix();
    const keep = v.keep === 'hero' && aspectRef.v < 1.05 ? 'heroNarrow' : v.keep;
    const pts = KEEP[keep].map((p) => new THREE.Vector3(...p));
    let scale = 1;
    for (let i = 0; i < 6; i++) {
      camera.position.copy(target).addScaledVector(dir, scale); camera.lookAt(target); camera.updateMatrixWorld();
      let worst = 0;
      for (const p of pts) {
        const q = p.clone().project(camera);
        worst = Math.max(worst, Math.abs(q.x) / 0.9, q.y > 0 ? q.y / (v.topLimit && logoBand ? v.topLimit : 0.86) : -q.y / 0.94);
      }
      if (Math.abs(worst - 1) < 0.02) break;
      scale *= 0.35 + 0.65 * worst;
    }
    return { pos: target.clone().addScaledVector(dir, scale), target };
  }

  function resize() {
    const w = canvas.clientWidth || canvas.parentElement.clientWidth, h = canvas.clientHeight || canvas.parentElement.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    aspectRef.v = w / h;
    // Narrow screens pull the props in so the player stays large.
    const k = aspectRef.v < 1.05 ? 0.72 : 1;
    court.stars.forEach((s, i) => { s.position.x = [1.35, -0.95, 1.95][i] * k; });
    court.pad.position.x = 0.95 * (aspectRef.v < 1.05 ? 0.86 : 1);
    court.flap.position.setX(-1.95 * k);
    court.flap.children[1].visible = aspectRef.v >= 1.05 && !logoBand;
    const f = fit(view);
    camTo = f; if (camT >= 1) { camera.position.copy(f.pos); camera.lookAt(f.target); }
  }

  function setStep(n, opts2 = {}) {
    step = n;
    logoBand = !!opts2.logoBand;
    court.flap.children[1].visible = aspectRef.v >= 1.05 && !logoBand;
    const v = VIEWS[Math.min(5, n)] ?? VIEWS[1];
    const target = fit(v);
    view = v;
    if (opts2.instant || reduced) { camT = 1; camTo = target; camera.position.copy(target.pos); camera.lookAt(target.target); }
    else { camFrom = { pos: camera.position.clone(), target: (camTo?.target ?? target.target).clone() }; camTo = target; camT = 0; }
    const skeleton = n === 2;
    for (const [name, mesh] of Object.entries(mover.parts)) {
      if (name === 'head') { mesh.material = skeleton ? ghostMat : mover.mats.head; continue; }
      if (name.startsWith('shoe')) { mesh.material = skeleton ? ghostMat : mover.mats.shoe; continue; }
      mesh.material = skeleton ? ghostMat : mover.mats.body;
    }
    markerList.forEach((m) => { m.visible = skeleton; });
    if (n === 3) highlightRegions(mover, regions);
    const space = n === 4;
    court.ring.visible = space; cone.visible = space; dist.visible = space;
    for (const [k, d] of Object.entries(devices)) d.visible = space && k === deviceKind;
    placeCone();
    court.stars.forEach((s) => { s.visible = n === 1; });
    court.pad.visible = n === 1;
    court.bird.parent.visible = n === 1;
  }

  function placeCone() {
    const d = devices[deviceKind];
    const lens = d.userData.lens.clone().multiplyScalar(d.scale.x).applyEuler(d.rotation).add(d.position);
    const toward = new THREE.Vector3(0, 1.05, 0);
    const len = lens.distanceTo(toward);
    cone.geometry.dispose();
    cone.geometry = new THREE.ConeGeometry(1.05, len, 40, 1, true);
    cone.position.copy(lens).lerp(toward, 0.5);
    cone.lookAt(toward);
    cone.rotateX(-Math.PI / 2);
  }

  function setRegions(list) { regions = new Set(list); if (step === 3) highlightRegions(mover, regions); }
  function setDevice(kind) { deviceKind = kind; if (step === 4) { for (const [k, d] of Object.entries(devices)) d.visible = k === kind; placeCone(); } }

  function poseFor(t) {
    if (step === 1) return sampleLoop(HERO_LOOP, t);
    if (step === 2) return sampleLoop({ length: 4, keys: [[0, 'stand', 'linear'], [1.6, 'tPose', 'inOut'], [2.4, 'tPose', 'linear'], [4, 'stand', 'inOut']] }, t);
    return sampleLoop({ length: 3.2, keys: [[0, 'stand', 'linear'], [1.6, 'breathe', 'inOut'], [3.2, 'stand', 'inOut']] }, t);
  }

  function update(dt) {
    clock += dt;
    const p = poseFor(clock);
    applyPose(mover, p);
    // Events in the hero loop drive the props.
    if (step === 1) {
      const lt = clock % HERO_LOOP.length;
      const ev = HERO_LOOP.events;
      const crossed = (at) => (lastLoopT <= at && lt > at) || (lt < lastLoopT && (lastLoopT <= at || lt > at));
      if (crossed(ev.flap)) lastEvents.flapT = clock;
      if (crossed(ev.jab) || crossed(ev.cross)) lastEvents.hitT = clock + 0.04;
      if (crossed(ev.jump)) court.burst(clock, new THREE.Vector3(0.1, 3.0, 0));
      lastLoopT = lt;
    }
    court.update(clock, lastEvents);
    // Blob shadow follows the pelvis and shrinks in the air.
    const pel = mover.joints.pelvis;
    const air = Math.max(0, pel.position.y - 0.93);
    court.blob.position.x = pel.position.x; court.blob.position.z = pel.position.z + 0.05;
    court.blob.scale.setScalar(1 - air * 0.9);
    // Camera: transition, then a slow sway.
    if (camT < 1 && camFrom) {
      camT = Math.min(1, camT + dt / 1.1);
      const e = easeInOut(camT);
      camera.position.lerpVectors(camFrom.pos, camTo.pos, e);
      const tg = new THREE.Vector3().lerpVectors(camFrom.target, camTo.target, e);
      camera.lookAt(tg);
    } else if (camTo && !reduced) {
      const a = Math.sin(clock * 0.45) * 0.035;
      const off = camTo.pos.clone().sub(camTo.target);
      off.applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
      camera.position.copy(camTo.target).add(off);
      camera.lookAt(camTo.target);
    }
    if (opts.onLabels) opts.onLabels(labels());
  }

  const project = (v) => { const q = v.clone().project(camera); return { x: (q.x + 1) / 2, y: (1 - q.y) / 2, front: q.z < 1 }; };
  function labels() {
    if (step !== 4) return null;
    const d = devices[deviceKind];
    return {
      distance: project(new THREE.Vector3(0.62, court.H, 1.3)),
      device: project(new THREE.Vector3(d.position.x, d.position.y + (deviceKind === 'laptop' ? 0.8 : 1.15), d.position.z)),
      space: project(new THREE.Vector3(1.0, court.H, -0.15)),
    };
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const minDt = 1000 / TIERS[tier].fps - 1;
    if (now - last < minDt) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    const t0 = performance.now();
    last = now;
    update(reduced && step === 1 ? 0 : dt);
    renderer.render(scene, camera);
    frameTimes.push(performance.now() - t0);
    if (frameTimes.length > 240) frameTimes.shift();
  }

  applyTier();
  setStep(opts.step ?? 1, { instant: true });
  if (reduced) { clock = 1.7; update(0); }
  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas.parentElement);

  return {
    renderer, scene, camera,
    start() { if (!running) { running = true; last = performance.now(); raf = requestAnimationFrame(frame); } },
    stop() { running = false; cancelAnimationFrame(raf); },
    setStep, setRegions, setDevice,
    setTier(n) { tier = n; applyTier(); },
    get tier() { return tier; },
    /** Deterministic render for capture: time in seconds since the loop start. */
    renderAt(t) { clock = t - 1 / 60; lastLoopT = (t - 1 / 60) % HERO_LOOP.length; update(1 / 60); renderer.render(scene, camera); },
    resetStats() { frameTimes.length = 0; },
    stats() {
      const s = [...frameTimes].sort((a, b) => a - b);
      const q = (p) => (s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0);
      return { frames: s.length, p50: q(0.5), p95: q(0.95), calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, tier };
    },
    dispose() { this.stop(); ro.disconnect(); renderer.dispose(); scene.traverse((o) => { o.geometry?.dispose?.(); }); },
  };
}
