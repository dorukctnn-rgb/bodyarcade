// Spike: does MediaPipe detect a rendered 3D person? Renders a model in a few poses with three.js, runs the real
// pose backend on the canvas (and on a JPEG round trip), and returns detection facts plus a contact sheet.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { MainBackend } from '../../packages/core/pose/service.ts';
import { POSE_MODEL, WASM_BASE } from '../../packages/core/pose/assets.ts';
import { POSE_CONNECTIONS, type Landmark } from '../../packages/core/types/index.ts';

const W = 640, H = 480;
const canvas = document.getElementById('gl') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

function makeScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xb9b2a6);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: 0x6d6258, roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(20, 8), new THREE.MeshStandardMaterial({ color: 0xcfc8bb, roughness: 1 }));
  wall.position.set(0, 4, -3.2); wall.receiveShadow = true; scene.add(wall);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x887766, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(2, 4, 3); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.5, far: 12 });
  scene.add(sun);
  return scene;
}

async function loadModel(url: string): Promise<{ root: THREE.Object3D; clips: THREE.AnimationClip[] }> {
  if (url.endsWith('.fbx')) {
    const o = await new FBXLoader().loadAsync(url);
    return { root: o, clips: o.animations };
  }
  const g = await new GLTFLoader().loadAsync(url);
  return { root: g.scene, clips: g.animations };
}

function drawSkeleton(ctx: CanvasRenderingContext2D, lm: Landmark[], ox: number, oy: number, w: number, h: number): void {
  ctx.lineWidth = 2; ctx.strokeStyle = '#ff2d55'; ctx.fillStyle = '#00e5ff';
  for (const [a, b] of POSE_CONNECTIONS) {
    const p = lm[a], q = lm[b]; if (!p || !q) continue;
    ctx.beginPath(); ctx.moveTo(ox + p.x * w, oy + p.y * h); ctx.lineTo(ox + q.x * w, oy + q.y * h); ctx.stroke();
  }
  for (const p of lm) { ctx.beginPath(); ctx.arc(ox + p.x * w, oy + p.y * h, 2.5, 0, 7); ctx.fill(); }
}

export interface SpikeOpts { rotY?: number; url: string; height: number; fovY: number; frame: number; skin?: string; poses: { name: string; clip?: string; t?: number }[] }

async function run(o: SpikeOpts): Promise<{ results: Record<string, unknown>[]; sheet: string; info: Record<string, unknown> }> {
  const backend = new MainBackend();
  await backend.load({ modelUrl: POSE_MODEL.url, wasmBase: WASM_BASE, prefer: 'CPU' });
  if (o.url.endsWith('.jpg')) {
    const img = new Image(); img.src = o.url; await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; (c.getContext('2d') as CanvasRenderingContext2D).drawImage(img, 0, 0);
    const a = await backend.detect(c as unknown as HTMLVideoElement, 1000);
    const b = await backend.detect(img as unknown as HTMLVideoElement, 1100);
    backend.dispose();
    return { results: [{ control: o.url, canvas: !!a.poses[0], image: !!b.poses[0] }], sheet: 'data:,', info: {} };
  }
  const scene = makeScene();
  const { root, clips } = await loadModel(o.url);
  scene.add(root);
  root.traverse((n) => { const m = n as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = false; } });
  if (o.skin) {
    const tex = await new THREE.TextureLoader().loadAsync(o.skin);
    tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = true;
    root.traverse((n) => { const m = n as THREE.Mesh; if (m.isMesh) { m.material = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0, side: THREE.DoubleSide }); } });
  }
  // normalise: height o.height metres, feet on the floor, facing the camera (+z)
  root.updateMatrixWorld(true);
  const box0 = new THREE.Box3().setFromObject(root, true);
  const k = o.height / (box0.max.y - box0.min.y);
  root.rotation.y = o.rotY ?? 0;
  root.scale.multiplyScalar(k);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root, true);
  root.position.y -= box.min.y; root.position.x -= (box.min.x + box.max.x) / 2;
  const cam = new THREE.PerspectiveCamera(o.fovY, W / H, 0.1, 50);
  const dist = (o.height / o.frame / 2) / Math.tan((o.fovY * Math.PI) / 360);
  cam.position.set(0, o.height * 0.5 + 0.1, dist); cam.lookAt(0, o.height * 0.5, 0);
  const mixer = new THREE.AnimationMixer(root);
  const results: Record<string, unknown>[] = [];
  const cols = 3, tw = 320, th = 240;
  const sheet = document.createElement('canvas');
  sheet.width = cols * tw; sheet.height = Math.ceil(o.poses.length / cols) * th;
  const sctx = sheet.getContext('2d') as CanvasRenderingContext2D;
  let ts = 1000;
  for (let i = 0; i < o.poses.length; i++) {
    const p = o.poses[i] as SpikeOpts['poses'][number];
    mixer.stopAllAction();
    const clip = p.clip ? clips.find((c) => c.name.toLowerCase().includes(p.clip as string)) : undefined;
    if (clip) { mixer.clipAction(clip).play(); mixer.setTime(p.t ?? 0); }
    else root.traverse((n) => { /* bind pose */ void n; });
    root.updateMatrixWorld(true);
    renderer.render(scene, cam);
    const direct = await backend.detect(canvas as unknown as HTMLVideoElement, (ts += 100));
    const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b as Blob), 'image/jpeg', 0.8));
    const bmp = await createImageBitmap(blob);
    const jpeg = await backend.detect(bmp as unknown as HTMLVideoElement, (ts += 100));
    const lm = direct.poses[0] ?? jpeg.poses[0] ?? null;
    sctx.drawImage(canvas, (i % cols) * tw, Math.floor(i / cols) * th, tw, th);
    if (lm) drawSkeleton(sctx, lm, (i % cols) * tw, Math.floor(i / cols) * th, tw, th);
    const vis = lm ? lm.filter((q) => q.visibility > 0.5).length : 0;
    results.push({ pose: p.name, clip: clip?.name ?? 'bind', direct: !!direct.poses[0], jpeg: !!jpeg.poses[0], visible: vis, ms: Math.round(direct.inferenceMs) });
  }
  backend.dispose();
  return { results, sheet: sheet.toDataURL('image/jpeg', 0.85), info: { clips: clips.map((c) => `${c.name}:${c.duration.toFixed(2)}s`), scale: k, dist } };
}

async function inspect(url: string): Promise<{ tree: string[]; box: number[]; clips: string[] }> {
  const { root, clips } = await loadModel(url);
  root.updateMatrixWorld(true);
  const tree: string[] = [];
  const walk = (o: THREE.Object3D, d: number): void => {
    const wp = new THREE.Vector3(); o.getWorldPosition(wp);
    tree.push(`${'  '.repeat(d)}${o.type} ${o.name} w=(${wp.x.toFixed(3)},${wp.y.toFixed(3)},${wp.z.toFixed(3)}) s=${o.scale.x.toFixed(3)}`);
    o.children.forEach((c) => walk(c, d + 1));
  };
  walk(root, 0);
  root.traverse((n) => {
    const m = n as THREE.SkinnedMesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mt of mats as THREE.MeshStandardMaterial[]) tree.push(`MATERIAL ${m.name}: ${mt.type} visible=${m.visible} transparent=${mt.transparent} opacity=${mt.opacity} side=${mt.side} color=${mt.color?.getHexString()} map=${!!mt.map} vis=${mt.visible} culled=${m.frustumCulled} skinned=${(m as THREE.SkinnedMesh).isSkinnedMesh} bones=${(m as THREE.SkinnedMesh).skeleton?.bones.length}`);
    const g = m.geometry; g.computeBoundingBox();
    tree.push(`GEOM ${m.name}: verts=${g.attributes.position?.count} box=${g.boundingBox?.min.toArray().map((x) => x.toFixed(2))} .. ${g.boundingBox?.max.toArray().map((x) => x.toFixed(2))} matScale=${m.matrixWorld.elements[0]?.toFixed(3)}`);
  });
  const b = new THREE.Box3().setFromObject(root, true);
  return { tree, box: [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z], clips: clips.map((c) => `${c.name}:${c.duration.toFixed(2)}`) };
}
(window as unknown as { spike: unknown }).spike = { run, inspect };
(window as unknown as { spikeReady: boolean }).spikeReady = true;
