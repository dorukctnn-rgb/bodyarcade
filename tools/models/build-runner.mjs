// Step 2 of building packages/core/render3d/assets/runner.glb (step 1: tools/models/runner-from-fbx.ts). Keeps the run and
// jump clips, drops the jump's own rise (the game lifts the runner), constant scale tracks and the normals (flat-shaded in
// the game), then welds, resamples, quantizes and compresses with meshopt.
//
// Needs glTF-Transform and meshoptimizer, which are not dependencies of the game (see build-kit.mjs for the install line):
//
//   node tools/models/build-runner.mjs <raw.glb> <out.glb> <node_modules folder>
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [src, dst, mods] = process.argv.slice(2);
const req = createRequire(join(resolve(mods), 'noop.js'));
const load = async (n) => import(pathToFileURL(req.resolve(n)).href);
const { NodeIO } = await load('@gltf-transform/core');
const { weld, quantize, meshopt, dedup, prune, resample } = await load('@gltf-transform/functions');
const { ALL_EXTENSIONS, EXTMeshoptCompression, KHRMeshQuantization } = await load('@gltf-transform/extensions');
const { MeshoptEncoder, MeshoptDecoder } = await load('meshoptimizer');
await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(src);
const root = doc.getRoot();
for (const a of root.listAnimations()) if (!['run', 'jump'].includes(a.getName())) a.dispose();
// Scale tracks that never change and the finger/toe-end bones' tracks are dropped.
for (const a of root.listAnimations()) {
  for (const ch of a.listChannels()) {
    const s = ch.getSampler(); const out = s.getOutput(); const arr = out.getArray();
    const path = ch.getTargetPath();
    // The jump's own rise is dropped: the game lifts the runner itself.
    if (a.getName() === 'jump' && path === 'translation' && ch.getTargetNode()?.getName() === 'Hips') { ch.dispose(); s.dispose(); continue; }
    if (path === 'scale') { let same = true; for (let i = 3; i < arr.length; i++) if (Math.abs(arr[i] - arr[i % 3]) > 1e-4) { same = false; break; } if (same) { ch.dispose(); s.dispose(); } }
  }
}
for (const m of root.listMeshes()) for (const p of m.listPrimitives()) { const n = p.getAttribute('NORMAL'); if (n) { p.setAttribute('NORMAL', null); } }
doc.createExtension(KHRMeshQuantization).setRequired(true);
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
await doc.transform(dedup(), weld(), resample({ tolerance: 1e-4 }), quantize({ quantizePosition: 14, quantizeColor: 8, quantizeWeight: 8 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }), prune());
await io.write(resolve(dst), doc);
const st = (await import('node:fs')).statSync(dst);
console.log('wrote', dst, st.size, 'bytes; verts', root.listMeshes()[0].listPrimitives()[0].getAttribute('POSITION').getCount(), 'anims', root.listAnimations().map((a) => a.getName() + ':' + a.listChannels().length).join(','));
