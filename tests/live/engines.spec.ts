// The peer layer of live play on each engine a player may have (builder N): the same PeerLink code the match uses, two of them in one
// page (tests/live/pages/peers.ts), on Chromium (Android Chrome, desktop Chrome and Edge), Firefox and WebKit (Safari on the iPhone is WebKit
// underneath). It judges what the match depends on: the state channel opens and carries messages both ways (the 15 Hz ghost and score, with the
// Room relay as the fall-back when it does not), and what the friend camera depends on: the picture arrives and starts. An engine that is not
// installed on this machine is skipped, never failed (`npx playwright install firefox webkit` adds them).
//   node node_modules/@playwright/test/cli.js test -c tests/live/playwright.config.ts --workers=1 tests/live/engines.spec.ts
import { expect, test, chromium, firefox, webkit, type BrowserType } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { baseLaunchOptions } from '../e2e/support/browser.ts';
import { ROOT } from './support/stack.ts';
import type { PeersReport } from './pages/peers.ts';

test.skip(!!process.env.CI, 'the live suite runs on the local release gate, not on GitHub runners');

const TYPES: Record<string, { type: BrowserType; prefs?: Record<string, string | number | boolean> }> = {
  chromium: { type: chromium },
  firefox: { type: firefox, prefs: { 'media.peerconnection.ice.obfuscate_host_addresses': false } },
  webkit: { type: webkit },
};

let dir = '';
let server: http.Server | null = null;
let base = '';

test.beforeAll(async () => {
  test.setTimeout(120_000);
  dir = mkdtempSync(path.join(os.tmpdir(), 'ba-engines-'));
  await build({
    root: path.join(ROOT, 'tests/live/pages'), base: './', configFile: false, logLevel: 'warn',
    build: { outDir: dir, emptyOutDir: true, minify: false, target: 'es2022', sourcemap: false, rollupOptions: { input: path.join(ROOT, 'tests/live/pages/peers.html') } },
  });
  server = http.createServer((req, res) => {
    const file = path.join(dir, decodeURIComponent((req.url ?? '/').split('?')[0] as string).replace(/^\/+/, '') || 'peers.html');
    if (!file.startsWith(dir) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    const ext = path.extname(file);
    res.writeHead(200, { 'Content-Type': ext === '.html' ? 'text/html' : ext === '.js' ? 'text/javascript' : 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server!.address() as { port: number }).port}`;
});

test.afterAll(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* temp files */ }
});

for (const [name, spec] of Object.entries(TYPES)) {
  test(`peer layer on ${name}`, async () => {
    test.skip(name !== 'chromium' && !existsSync(spec.type.executablePath()), `${name} is not installed on this machine (npx playwright install ${name})`);
    test.setTimeout(90_000);
    const browser = await spec.type.launch(name === 'chromium' ? baseLaunchOptions : { headless: true, ...(spec.prefs ? { firefoxUserPrefs: spec.prefs } : {}) });
    try {
      const page = await (await browser.newContext()).newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
      await page.goto(`${base}/peers.html`);
      const rep = (await page.evaluate(() => (window as unknown as { __run: () => Promise<unknown> }).__run())) as PeersReport;
      console.log(JSON.stringify({ engine: name, webrtc: rep.webrtc, canCapture: rep.canCapture, dcOpenMs: rep.dcOpenMs, aToB: rep.aToB, bToA: rep.bToA, ctrl: rep.ctrlAB, frames: rep.videoFrames, unmuted: rep.unmutedMs, path: rep.path, afterRestart: rep.afterRestart, error: rep.error }));
      test.skip(!rep.webrtc, `${name} here has no RTCPeerConnection: the client falls back to the Room relay (peersBroken), which video.test.ts covers`);
      expect(rep.error, 'page error').toBeNull();
      expect(errors, 'page errors').toEqual([]);
      // what the match needs: the state channel and its messages (the Room relay covers it when this fails, but it should not)
      expect(rep.dcOpenMs[0], 'state channel opens on A').not.toBeNull();
      expect(rep.dcOpenMs[1], 'state channel opens on B').not.toBeNull();
      expect(rep.aToB && rep.bToA && rep.ctrlAB, 'messages cross both channels').toBe(true);
      // what the friend camera needs (when the engine can make a camera from a canvas at all)
      if (rep.canCapture) {
        expect(rep.tracks.a.some((t) => t.kind === 'video') && rep.tracks.b.some((t) => t.kind === 'video'), 'both sides get a video track').toBe(true);
        expect(Math.min(rep.videoFrames.a, rep.videoFrames.b), 'the picture is painted').toBeGreaterThan(8);
      }
      // what a flaky link needs
      expect(rep.afterRestart.dcOpen && rep.afterRestart.roundTrip, 'an ICE restart keeps the channel').toBe(true);
    } finally {
      await browser.close().catch(() => undefined);
    }
  });
}
