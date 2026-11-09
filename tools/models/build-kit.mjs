// Builds packages/core/render3d/assets/scenery.glb, the modelled scenery and obstacles of the 3D worlds, from Polyfork's
// free GLB files (CC BY 4.0, credits in packages/core/render3d/assets/CREDITS.md; https://polyfork.dev/licensing).
//
// Every source model becomes ONE mesh node named by its key below: all of its parts are joined into one vertex-coloured
// primitive in model space (metres, y up, standing on y = 0), without normals (flat-shaded in the game), then the whole
// file is welded, quantized and compressed with meshopt. The game reads the nodes by name (render3d/models.ts) and scales each one to the size its prop needs.
//
// The tool needs glTF-Transform and meshoptimizer, which are not dependencies of the game. Run it from any folder that
// has them installed (npm i @gltf-transform/core@4 @gltf-transform/functions@4 @gltf-transform/extensions@4 meshoptimizer@0.22):
//
//   node tools/models/build-kit.mjs <folder with the downloaded .glb files> <out.glb> <node_modules folder>
//
// Download a model with: curl -o <id>.glb https://polyfork.dev/cdn/<id>.glb  (never the .mjs or HD versions).
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const MODELS = {
  pine: 'tall-pine-tree-ab4108',
  snowPine: 'snow-laden-spruce-36716e',
  tree: 'broadleaf-oak-997c22',
  treeB: 'maple-tree-65fa12',
  treeC: 'birch-tree-181b33',
  jungletree: 'tree-fern-78320e',
  fern: 'tropical-fern-bush-c70147',
  bush: 'round-bush-cd2ac0',
  rock: 'large-boulder-a29b99',
  rockB: 'medium-rock-e08405',
  cactus: 'saguaro-cactus-8b588d',
  palm: 'palm-tree-a307da',
  lamp: 'street-lamp-136745',
  seaLamp: 'seafront-lamp-post-28bada',
  building0: 'brownstone-row-house-1b84fd',
  building1: 'office-tower-1538cc',
  building2: 'art-deco-setback-tower-b3a788',
  log: 'fallen-log-1685fb',
  driftwood: 'driftwood-log-89a68f',
  barrier: 'crash-barrier-run-b47d1d',
  bus: 'city-bus-49fd97',
  truck: 'delivery-truck-a9537e',
};

const [src, outArg, modulesArg] = process.argv.slice(2);
if (!src || !outArg || !modulesArg) {
  console.error('usage: node tools/models/build-kit.mjs <source dir> <out.glb> <node_modules dir>');
  process.exit(2);
}
const req = createRequire(join(resolve(modulesArg), 'noop.js'));
const load = async (name) => import(pathToFileURL(req.resolve(name)).href);
const { NodeIO, Document } = await load('@gltf-transform/core');
const { weld, quantize, meshopt, dedup, prune } = await load('@gltf-transform/functions');
const { ALL_EXTENSIONS, EXTMeshoptCompression, KHRMeshQuantization } = await load('@gltf-transform/extensions');
const { MeshoptEncoder, MeshoptDecoder } = await load('meshoptimizer');
await MeshoptEncoder.ready;
await MeshoptDecoder.ready;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const out = new Document();
const buffer = out.createBuffer();
const scene = out.createScene('scenery');

const apply = (m, v, w) => [
  m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * w,
  m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * w,
  m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * w,
];

let total = 0;
for (const [key, id] of Object.entries(MODELS)) {
  const doc = await io.read(join(src, `${id}.glb`));
  const pos = [], nor = [], col = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const P = prim.getAttribute('POSITION'), N = prim.getAttribute('NORMAL'), C = prim.getAttribute('COLOR_0');
      const idx = prim.getIndices();
      const count = idx ? idx.getCount() : P.getCount();
      const a = [], b = [], c = [];
      for (let k = 0; k < count; k++) {
        const i = idx ? idx.getScalar(k) : k;
        const p = apply(m, P.getElement(i, a), 1);
        pos.push(...p);
        const n = N ? apply(m, N.getElement(i, b), 0) : [0, 1, 0];
        const l = Math.hypot(n[0], n[1], n[2]) || 1;
        nor.push(n[0] / l, n[1] / l, n[2] / l);
        const cc = C ? C.getElement(i, c) : [1, 1, 1];
        col.push(cc[0], cc[1], cc[2]);
      }
    }
  }
  // No normals: the models are flat-shaded, so the game derives the face normal in the shader (flatShading), and without
  // per-face normals the corners that faces share are stored once (about a third of the vertices).
  const prim = out.createPrimitive()
    .setAttribute('POSITION', out.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buffer))
    .setAttribute('COLOR_0', out.createAccessor().setType('VEC3').setArray(new Float32Array(col)).setBuffer(buffer));
  void nor;
  const node = out.createNode(key).setMesh(out.createMesh(key).addPrimitive(prim)).setExtras({ source: `https://polyfork.dev/asset/${id}` });
  scene.addChild(node);
  total += pos.length / 9;
  console.log(`${key.padEnd(11)} ${id.padEnd(32)} ${pos.length / 9} triangles`);
}

out.createExtension(KHRMeshQuantization).setRequired(true);
out.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
await out.transform(dedup(), weld(), quantize({ quantizePosition: 14, quantizeColor: 8 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }), prune());
await io.write(resolve(outArg), out);
console.log(`${Object.keys(MODELS).length} models, ${total} triangles -> ${outArg}`);
