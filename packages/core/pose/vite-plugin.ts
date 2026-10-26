// Vite plugin: serves the pinned MediaPipe WASM files and the pose model under /vendor/mediapipe/ in dev, and
// copies them into every build at the same paths. Node-only (runs inside Vite), never shipped to the browser.
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { POSE_MODEL, WASM_BASE, WASM_FILES } from './assets.ts';

const TYPES: Record<string, string> = { '.js': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm', '.task': 'application/octet-stream' };

/** Every self-hosted pose file: URL path to file on disk. */
export function poseAssetFiles(): Map<string, string> {
  const pkg = createRequire(import.meta.url).resolve('@mediapipe/tasks-vision');
  const wasmDir = join(dirname(pkg), 'wasm');
  const files = new Map<string, string>();
  for (const f of WASM_FILES) files.set(`${WASM_BASE}/${f}`, join(wasmDir, f));
  files.set(POSE_MODEL.url, fileURLToPath(new URL(`./assets/${POSE_MODEL.file}`, import.meta.url)));
  return files;
}

export function poseAssets(): Plugin {
  const files = poseAssetFiles();
  return {
    name: 'bodyarcade-pose-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0] ?? '';
        const file = files.get(path);
        if (!file) { next(); return; }
        if (!existsSync(file)) { res.statusCode = 404; res.end('missing pose asset'); return; }
        const ext = path.slice(path.lastIndexOf('.'));
        res.setHeader('Content-Type', TYPES[ext] ?? 'application/octet-stream');
        res.setHeader('Content-Length', String(statSync(file).size));
        res.setHeader('Cache-Control', 'no-cache');
        createReadStream(file).pipe(res);
      });
    },
    // The published bundle points at a source map it does not ship; drop the comment so dev logs stay quiet.
    load(id) {
      const file = id.split('?')[0] ?? '';
      if (!file.replace(/\\/g, '/').endsWith('/@mediapipe/tasks-vision/vision_bundle.mjs')) return null;
      return { code: readFileSync(file, 'utf8').replace(/\/\/# sourceMappingURL=\S+\s*$/, ''), map: null };
    },
    generateBundle() {
      for (const [path, file] of files) this.emitFile({ type: 'asset', fileName: path.slice(1), source: readFileSync(file) });
    },
  };
}
