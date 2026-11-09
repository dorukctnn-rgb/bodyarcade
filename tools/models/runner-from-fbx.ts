// Step 1 of building packages/core/render3d/assets/runner.glb: converts Quaternius' "Animated Human" (CC0 1.0,
// https://opengameart.org/content/animated-human-low-poly; credits in packages/core/render3d/assets/CREDITS.md) from its
// FBX file to a plain GLB in headless Chromium, with three's own FBXLoader and GLTFExporter (MIT):
// - the palette texture becomes vertex colours (its five bands: skin, dark, hair, shirt, trousers), the UVs are dropped;
// - the figure is scaled to 1.8 m; only the run, idle and jump clips are kept (renamed run, idle, jump).
// Step 2 is tools/models/build-runner.mjs (drops idle, compresses).
//
//   node tools/models/runner-from-fbx.ts <worktree> "<...>/FBX/Animated Human.fbx" "<...>/Blend/Textures" export <raw.glb>
//   (mode "info" prints the clips, meshes and bones instead.)
import { pathToFileURL } from 'node:url';
import { join, basename } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';

const [wt, fbx, texDir, mode, out] = process.argv.slice(2) as [string, string, string, string, string?];
const imp = (p: string) => import(pathToFileURL(join(wt, p)).href);
const { chromium } = await imp('node_modules/@playwright/test/index.mjs');
const { baseLaunchOptions } = await imp('tests/e2e/support/browser.ts');
const three = join(wt, 'node_modules/three');
const browser = await chromium.launch(baseLaunchOptions);
try {
  const page = await browser.newPage();
  page.on('console', (m: any) => console.log('[page]', m.text()));
  await page.route('http://conv.local/**', async (route: any) => {
    const u = new URL(route.request().url());
    const p = decodeURIComponent(u.pathname);
    let file: string | null = null, type = 'application/octet-stream';
    if (p === '/index.html') return route.fulfill({ body: `<!doctype html><html><head><script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script></head><body></body></html>`, contentType: 'text/html' });
    if (p.startsWith('/three/')) { file = join(three, p.slice(7)); type = 'text/javascript'; }
    else if (p === '/m/human.fbx') file = fbx;
    else if (p.toLowerCase().endsWith('.png')) { file = join(texDir, basename(p.split(String.fromCharCode(92)).join("/"))); type = 'image/png'; }
    if (!file) return route.fulfill({ status: 404, body: '' });
    try { return route.fulfill({ body: readFileSync(file), contentType: type }); } catch { console.log('missing', p); return route.fulfill({ status: 404, body: '' }); }
  });
  await page.goto('http://conv.local/index.html');
  const res = await page.evaluate(async (mode: string) => {
    const THREE = await import('three');
    const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
    const obj: any = await new FBXLoader().loadAsync('/m/human.fbx');
    obj.updateMatrixWorld(true);
    const info: any = { anims: obj.animations.map((a: any) => [a.name, +a.duration.toFixed(2), a.tracks.length]), meshes: [], bones: [] as string[] };
    obj.traverse((o: any) => {
      if (o.isMesh) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        info.meshes.push({ name: o.name, skinned: !!o.isSkinnedMesh, verts: o.geometry.attributes.position.count, attrs: Object.keys(o.geometry.attributes), groups: o.geometry.groups.length, mats: mats.map((m: any) => [m.type, m.name, m.color?.getHexString(), m.map?.image?.src ?? null, m.vertexColors]) });
      }
      if (o.isBone) info.bones.push(o.name);
    });
    const bb = new THREE.Box3().setFromObject(obj);
    info.bbox = [bb.min.toArray().map((v: number) => +v.toFixed(2)), bb.max.toArray().map((v: number) => +v.toFixed(2))];
    info.rootScale = obj.scale.toArray();
    if (mode === 'info') return info;
    // Colours from the palette texture (horizontal bands, top row = v 1): skin, shoes, hair, shirt, trousers.
    const BANDS: [number, [number, number, number]][] = [[6, [255, 209, 159]], [11, [41, 41, 41]], [17, [124, 88, 35]], [23, [115, 167, 196]], [32, [21, 96, 189]]];
    let mesh: any = null;
    obj.traverse((o: any) => { if (o.isSkinnedMesh) mesh = o; });
    const g = mesh.geometry;
    const uv = g.attributes.uv, n = uv.count;
    const col = new Float32Array(n * 3);
    const hist = [0, 0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      const row = Math.min(31, Math.max(0, Math.floor((1 - uv.getY(i)) * 32)));
      const k = BANDS.findIndex(([end]) => row < end);
      hist[k] = (hist[k] ?? 0) + 1;
      const rgb = BANDS[k]![1];
      const c = new THREE.Color().setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.deleteAttribute('uv');
    mesh.material = new THREE.MeshStandardMaterial({ name: 'runner', vertexColors: true, roughness: 0.7 });
    mesh.name = 'runner';
    const H = bb.max.y - bb.min.y;
    obj.scale.setScalar(1.8 / H);
    obj.name = 'Runner';
    const pick: Record<string, string> = { 'Human Armature|Run': 'run', 'Human Armature|Idle': 'idle', 'Human Armature|Jump': 'jump' };
    const clips = obj.animations.filter((a: any) => pick[a.name]).map((a: any) => { const c = a.clone(); c.name = pick[a.name]; return c; });
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
    const buf: ArrayBuffer = await new GLTFExporter().parseAsync(obj, { binary: true, animations: clips, onlyVisible: true }) as ArrayBuffer;
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { hist, size: bytes.length, b64: btoa(bin) };
  }, mode);
  if (res.b64) { writeFileSync(out!, Buffer.from(res.b64, 'base64')); delete res.b64; }
  console.log(JSON.stringify(res));
} finally {
  await browser.close();
}
