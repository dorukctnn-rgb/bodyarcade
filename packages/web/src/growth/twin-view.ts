// The 3D body twin on a canvas (three.js, the version the games already ship). It draws the twin shaped by the person's
// own tape (core/growth/twin/deform.ts), and optionally: the earlier shape as a ghost shell, the change between the two
// as a heat map (warm = more, cool = less, grey = no change; never red/green judgement colours), the tape bands as thin
// rings, and a time-lapse morph between two tapes. Drag turns it; it turns slowly by itself unless reduced motion is on.
import * as THREE from 'three';
import { blendTape, heat, prepare, shapeTwin, type Shaped, type TwinPrep } from '../../../core/growth/twin/deform.ts';
import { decodeTwin, type Tape, type TwinBase } from '../../../core/growth/twin/model.ts';
import femaleUrl from './assets/twin-female.bin?url';
import maleUrl from './assets/twin-male.bin?url';

const URLS: Record<TwinBase, string> = { female: femaleUrl, male: maleUrl };
const cache = new Map<TwinBase, Promise<TwinPrep>>();

export function loadTwin(base: TwinBase, fetcher: (u: string) => Promise<Response> = (u) => fetch(u)): Promise<TwinPrep> {
  let p = cache.get(base);
  if (!p) {
    p = fetcher(URLS[base]).then(async (r) => { if (!r.ok) throw new Error('twin:load'); return prepare(decodeTwin(await r.arrayBuffer())); });
    p.catch(() => cache.delete(base));
    cache.set(base, p);
  }
  return p;
}

export interface TwinScene {
  base: TwinBase;
  heightCm: number;
  now: Tape;
  then?: Tape | null;
  ghost?: boolean;
  heat?: boolean;
  /** 0..1: then -> now (time-lapse); default 1 */
  morph?: number;
}

export interface TwinPalette { body: string; ghost: string; floor: string; more: string; less: string; same: string; background: string | null }
export const DARK_PALETTE: TwinPalette = { body: '#E9E4F2', ghost: '#7FD8FF', floor: '#2A2148', more: '#FF9F43', less: '#3FA9F5', same: '#D9D4E4', background: null };

export interface TwinView {
  update(s: TwinScene): Promise<void>;
  /** per-frame numbers for tests: the heat range and whether a ghost is drawn */
  stats(): { heatMin: number; heatMax: number; ghost: boolean; frames: number; ready: boolean };
  resize(): void;
  dispose(): void;
  canvas: HTMLCanvasElement;
}

export function createTwinView(host: HTMLElement, o: { palette?: TwinPalette; autoRotate?: boolean; interactive?: boolean } = {}): TwinView {
  const pal = o.palette ?? DARK_PALETTE;
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canvas = document.createElement('canvas');
  canvas.className = 'gc-twin-canvas';
  canvas.setAttribute('role', 'img');
  host.append(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: pal.background === null, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  if (pal.background) scene.background = new THREE.Color(pal.background);
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3150, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(2, 3, 3); scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fd8ff, 1.2); rim.position.set(-3, 2, -2); scene.add(rim);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(0.55, 48), new THREE.MeshBasicMaterial({ color: pal.floor, transparent: true, opacity: 0.85 }));
  floor.rotation.x = -Math.PI / 2; scene.add(floor);
  const turn = new THREE.Group(); scene.add(turn);

  let geo: THREE.BufferGeometry | null = null, ghostGeo: THREE.BufferGeometry | null = null;
  let mesh: THREE.Mesh | null = null, ghostMesh: THREE.Mesh | null = null;
  const bodyMat = new THREE.MeshStandardMaterial({ color: pal.body, roughness: 0.62, metalness: 0.02, vertexColors: false });
  const heatMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.02, vertexColors: true });
  const ghostMat = new THREE.MeshBasicMaterial({ color: pal.ghost, wireframe: true, transparent: true, opacity: 0.16, depthWrite: false });
  let prep: TwinPrep | null = null;
  let last: Shaped | null = null, lastThen: Shaped | null = null;
  let heatMin = 0, heatMax = 0, ghostOn = false, frames = 0, ready = false;
  let yaw = 0.5, dragging = false, lastX = 0, idleSince = performance.now();

  const fit = (heightM: number): void => {
    const d = heightM * 2.35;
    camera.position.set(0, heightM * 0.55, d);
    camera.lookAt(0, heightM * 0.5, 0);
  };

  function colours(h: Float32Array, n: number): Float32Array {
    const out = new Float32Array(n * 3);
    const more = new THREE.Color(pal.more), less = new THREE.Color(pal.less), same = new THREE.Color(pal.same), c = new THREE.Color();
    heatMin = 0; heatMax = 0;
    for (let i = 0; i < n; i++) {
      const v = h[i]!;
      heatMin = Math.min(heatMin, v); heatMax = Math.max(heatMax, v);
      const t = Math.min(1, Math.abs(v) / 0.08);
      c.copy(same).lerp(v >= 0 ? more : less, t);
      out[i * 3] = c.r; out[i * 3 + 1] = c.g; out[i * 3 + 2] = c.b;
    }
    return out;
  }

  async function update(s: TwinScene): Promise<void> {
    if (!prep || prep.model.header.base !== s.base) {
      prep = await loadTwin(s.base);
      geo?.dispose(); ghostGeo?.dispose();
      if (mesh) turn.remove(mesh);
      if (ghostMesh) turn.remove(ghostMesh);
      geo = new THREE.BufferGeometry();
      geo.setIndex(new THREE.BufferAttribute(prep.model.indices, 1));
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(prep.model.positions.length), 3));
      mesh = new THREE.Mesh(geo, bodyMat); turn.add(mesh);
      ghostGeo = new THREE.BufferGeometry();
      ghostGeo.setIndex(new THREE.BufferAttribute(prep.model.indices, 1));
      ghostGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(prep.model.positions.length), 3));
      ghostMesh = new THREE.Mesh(ghostGeo, ghostMat); ghostMesh.renderOrder = 2; turn.add(ghostMesh);
      last = null; lastThen = null;
    }
    const morph = s.morph ?? 1;
    const tape = s.then && morph < 1 ? blendTape(s.then, s.now, morph) : s.now;
    last = shapeTwin(prep, s.heightCm, tape, last ?? undefined);
    const pos = geo!.getAttribute('position') as THREE.BufferAttribute;
    (pos.array as Float32Array).set(last.positions); pos.needsUpdate = true;
    geo!.computeVertexNormals(); geo!.computeBoundingSphere();
    const n = prep.model.header.vertexCount;
    if (s.then && (s.heat || s.ghost)) lastThen = shapeTwin(prep, s.heightCm, s.then, lastThen ?? undefined);
    if (s.heat && s.then && lastThen) {
      geo!.setAttribute('color', new THREE.BufferAttribute(colours(heat(lastThen, last), n), 3));
      mesh!.material = heatMat;
    } else { mesh!.material = bodyMat; heatMin = 0; heatMax = 0; }
    ghostOn = !!(s.ghost && s.then && lastThen);
    ghostMesh!.visible = ghostOn;
    if (ghostOn) {
      const gp = ghostGeo!.getAttribute('position') as THREE.BufferAttribute;
      // the ghost shell sits a hair outside its own surface so the two never flicker into each other
      (gp.array as Float32Array).set(lastThen!.positions); gp.needsUpdate = true;
      ghostGeo!.computeBoundingSphere();
    }
    fit((s.heightCm / 100) * 1.0);
    ready = true;
    draw();
  }

  let raf = 0;
  function draw(): void {
    const w = host.clientWidth || 300, h = host.clientHeight || 400;
    if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    turn.rotation.y = yaw;
    renderer.render(scene, camera);
    frames++;
  }
  function loop(t: number): void {
    raf = requestAnimationFrame(loop);
    if (!ready) return;
    if ((o.autoRotate ?? true) && !reduce && !dragging && t - idleSince > 1500) yaw += 0.004;
    draw();
  }
  raf = requestAnimationFrame(loop);

  if (o.interactive ?? true) {
    canvas.style.touchAction = 'pan-y';
    canvas.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => { if (!dragging) return; yaw += (e.clientX - lastX) * 0.01; lastX = e.clientX; idleSince = performance.now(); });
    const up = (): void => { dragging = false; idleSince = performance.now(); };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.tabIndex = 0;
    canvas.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') yaw -= 0.2; if (e.key === 'ArrowRight') yaw += 0.2; idleSince = performance.now(); });
  }

  return {
    canvas,
    update,
    stats: () => ({ heatMin, heatMax, ghost: ghostOn, frames, ready }),
    resize: draw,
    dispose(): void {
      cancelAnimationFrame(raf);
      geo?.dispose(); ghostGeo?.dispose(); bodyMat.dispose(); heatMat.dispose(); ghostMat.dispose();
      floor.geometry.dispose(); (floor.material as THREE.Material).dispose();
      renderer.dispose(); canvas.remove();
    },
  };
}
