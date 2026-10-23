// Vite config for the web shell (the app people open in a browser). Run it with
//   npx vite --config packages/web/vite.config.ts            development, with the practice session
//   npx vite build --config packages/web/vite.config.ts      the client bundle (then packages/web/generator makes the pages)
// The root of the repository has its own config for the platform's test pages; this one is only for the shell.
//
// BA_FIXTURES: 'fill' (the default in development) fills the catalogue with the fixtures for games that have no
// manifest yet; 'only' uses fixtures alone (screenshots and tests); 'none' (the default for a build) is the real thing.
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { poseAssets } from '../core/pose/vite-plugin.ts';
import { loadCatalogue, type FixtureMode } from './catalogue/load.ts';

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
const repo = here('../../');

const TYPES: Record<string, string> = { '.webp': 'image/webp', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

/** Serves the art director's pictures at the addresses the views use: /assets/tiles/... and /assets/brand/... */
function designAssets(): Plugin {
  const roots: [string, string][] = [['/assets/tiles/', join(repo, 'design', 'art', 'tiles')], ['/assets/brand/', join(repo, 'design', 'brand')]];
  return {
    name: 'bodyarcade-design-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0] ?? '';
        const hit = roots.find(([prefix]) => url.startsWith(prefix));
        if (!hit) { next(); return; }
        const rel = decodeURIComponent(url.slice(hit[0].length));
        const file = normalize(join(hit[1], rel));
        if (!file.startsWith(hit[1] + sep) || !existsSync(file) || !statSync(file).isFile()) { res.statusCode = 404; res.end('not found'); return; }
        res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-cache');
        createReadStream(file).pipe(res);
      });
    },
  };
}

/** import catalogue from 'virtual:catalogue': the validated catalogue, read at build or server start. */
function catalogueModule(mode: FixtureMode): Plugin {
  const id = 'virtual:catalogue';
  const resolved = `\0${id}`;
  return {
    name: 'bodyarcade-catalogue',
    resolveId(source) { return source === id ? resolved : null; },
    load(source) {
      if (source !== resolved) return null;
      const { catalogue, problems } = loadCatalogue({ fixtures: mode, requiredLangs: ['en'] });
      if (problems.length) throw new Error(`The catalogue has problems:\n${problems.map((p) => `  ${p.where}: ${p.message}`).join('\n')}`);
      return `export default ${JSON.stringify(catalogue)};`;
    },
    handleHotUpdate({ file, server }) {
      if (file.replace(/\\/g, '/').includes('/manifests/') || file.endsWith('manifest.json')) {
        const m = server.moduleGraph.getModuleById(resolved);
        if (m) { server.moduleGraph.invalidateModule(m); server.ws.send({ type: 'full-reload' }); }
      }
    },
  };
}

export default defineConfig(({ command }) => {
  const dev = command === 'serve';
  const fixtures = (process.env['BA_FIXTURES'] ?? (dev ? 'fill' : 'none')) as FixtureMode;
  const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')) as { version: string };
  return {
    root: here('.'),
    publicDir: false,
    plugins: [designAssets(), catalogueModule(fixtures), poseAssets()],
    resolve: { alias: { '@core': join(repo, 'packages', 'core'), '@games': join(repo, 'packages', 'games') } },
    define: {
      __BA_VERSION__: JSON.stringify(pkg.version),
      // The practice session and the test hooks exist in development and in builds made for screenshots and tests.
      __BA_DEMO__: JSON.stringify(dev || fixtures !== 'none'),
    },
    server: { host: '127.0.0.1', port: Number(process.env['BA_WEB_PORT'] ?? 5174), strictPort: true, open: false, fs: { allow: [repo] } },
    preview: { host: '127.0.0.1', port: Number(process.env['BA_WEB_PREVIEW_PORT'] ?? 4174), strictPort: true, open: false },
    worker: { format: 'es' },
    optimizeDeps: { exclude: ['@mediapipe/tasks-vision'] },
    build: {
      outDir: here('./dist'),
      emptyOutDir: true,
      target: 'es2022',
      sourcemap: true,
      manifest: true,
      assetsDir: 'static',
      assetsInlineLimit: 0,
      rollupOptions: { input: here('./src/main.ts') },
    },
  };
});
