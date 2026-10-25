// Why does the peer layer test of live play (tests/live/engines.spec.ts, builder N) fail on WebKit? Two suspects, one switch each:
//  - the test page gives side B a clone() of side A's canvas camera: in WebKit's WebRTC the clone of a canvas capture track may paint nothing;
//  - the page has no STUN or TURN server, so only host candidates exist: WebKit hides them behind mDNS names (.local) that a GitHub macOS machine cannot
//    resolve, and the two peers never find each other.
// The same PeerLink code (packages/core/net/peer.ts) runs in one page on each engine in four variants: host candidates or a relay through the local
// TURN server of the live suite (tests/live/support/turn-server.cjs), one canvas cloned or a canvas for each side. A variant that passes says what the
// engine needs; the table shows where each engine stands. (N's spec and page are not touched; tools/browsers/pages/peers.ts is a copy with the switches.)
//   node tools/browsers/run.ts --set peers --engines webkit,firefox,chromium
import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import type { PeersReport } from './pages/peers.ts';
import { DEMO_PORT } from './support/ports.ts';
import { ROOT } from './support/sites.ts';

const TURN_PORT = DEMO_PORT + 20;
const TURN = { urls: `turn:127.0.0.1:${TURN_PORT}?transport=udp`, username: 'ba', credential: 'ba-secret' };

let dir = '';
let server: http.Server | null = null;
let base = '';
let turn: ChildProcess | null = null;

test.beforeAll(async () => {
  test.setTimeout(180_000);
  dir = mkdtempSync(path.join(os.tmpdir(), 'ba-peers-'));
  await build({
    root: path.join(ROOT, 'tools/browsers/pages'), base: './', configFile: false, logLevel: 'warn',
    build: { outDir: dir, emptyOutDir: true, minify: false, target: 'es2022', sourcemap: false, rollupOptions: { input: path.join(ROOT, 'tools/browsers/pages/peers.html') } },
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
  // the local TURN server of the live suite (UDP, long-term credentials ba / ba-secret)
  turn = spawn(process.execPath, [path.join(ROOT, 'tests/live/support/turn-server.cjs'), '127.0.0.1', String(TURN_PORT), String(TURN_PORT + 1)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true });
  await new Promise<void>((ok, fail) => {
    const timer = setTimeout(() => fail(new Error('the TURN server did not start')), 15_000);
    turn!.stdout!.on('data', (d: Buffer) => { if (/TURN on/.test(String(d))) { clearTimeout(timer); ok(); } });
    turn!.once('exit', (code) => { clearTimeout(timer); fail(new Error(`the TURN server stopped (${code})`)); });
  });
});

test.afterAll(async () => {
  turn?.kill();
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* temp files */ }
});

const VARIANTS: { id: string; o: Record<string, unknown> }[] = [
  { id: 'host candidates, one canvas cloned (the page of engines.spec)', o: {} },
  { id: 'host candidates, a canvas for each side', o: { separate: true } },
  { id: 'relay through the local TURN, one canvas cloned', o: { turn: TURN } },
  { id: 'relay through the local TURN, a canvas for each side', o: { turn: TURN, separate: true } },
];

for (const v of VARIANTS) {
  test(`peers: ${v.id}`, async ({ page }, info) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
    await page.goto(`${base}/peers.html?o=${encodeURIComponent(JSON.stringify(v.o))}`);
    const rep = (await page.evaluate(() => (window as unknown as { __run: () => Promise<unknown> }).__run())) as PeersReport;
    info.annotations.push({ type: 'peers', description: JSON.stringify({ webrtc: rep.webrtc, canCapture: rep.canCapture, dcOpenMs: rep.dcOpenMs, aToB: rep.aToB, bToA: rep.bToA, frames: rep.videoFrames, path: rep.path, afterRestart: rep.afterRestart, error: rep.error }) });
    test.skip(!rep.webrtc, 'this engine has no RTCPeerConnection');
    expect(rep.error, 'page error').toBeNull();
    expect(errors, 'page errors').toEqual([]);
    expect(rep.dcOpenMs[0], 'state channel opens on A').not.toBeNull();
    expect(rep.dcOpenMs[1], 'state channel opens on B').not.toBeNull();
    expect(rep.aToB && rep.bToA && rep.ctrlAB, 'messages cross both channels').toBe(true);
    if (rep.canCapture) {
      expect(rep.tracks.a.some((t) => t.kind === 'video') && rep.tracks.b.some((t) => t.kind === 'video'), 'both sides get a video track').toBe(true);
      expect(`${rep.videoFrames.a}/${rep.videoFrames.b}`, 'pictures painted on A / on B (more than 8 each)').toMatch(/^([9]|[1-9]\d+)\/([9]|[1-9]\d+)$/);
    }
    expect(rep.afterRestart.dcOpen && rep.afterRestart.roundTrip, 'an ICE restart keeps the channel').toBe(true);
  });
}
