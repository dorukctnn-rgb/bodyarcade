// The peer layer of live play on each engine a player may have (builder N): the same PeerLink code the match uses, two of them in one
// page (tests/live/pages/peers.ts), on Chromium (Android Chrome, desktop Chrome and Edge), Firefox and WebKit (Safari on the iPhone is WebKit
// underneath). It judges what the match depends on: the state channel opens and carries messages both ways (the 15 Hz ghost and score, with the
// Room relay as the fall-back when it does not), and what the friend camera depends on: the picture arrives and starts. An engine that is not
// installed on this machine is skipped, never failed (`npx playwright install firefox webkit` adds them).
// Two rows go through a local TURN relay instead of host addresses: WebKit (it hides its host addresses behind made-up names, which a CI
// machine may not resolve, so with host addresses only no channel opens there) and Chromium (the row that proves the relay path of the page
// itself, on a machine that can run it). Nothing in a match depends on the relay: it is how two friends behind strict networks connect.
//   node node_modules/@playwright/test/cli.js test -c tests/live/playwright.config.ts --workers=1 tests/live/engines.spec.ts
import { expect, test, chromium, firefox, webkit, type BrowserType } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import dgram from 'node:dgram';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { baseLaunchOptions } from '../e2e/support/browser.ts';
import { canvasStreamPlays } from '../../tools/browsers/support/page.ts';
import { ROOT, lanAddress } from './support/stack.ts';
import type { PeersReport } from './pages/peers.ts';

test.skip(!!process.env.CI, 'the live suite runs on the local release gate, not on GitHub runners');

interface Row {
  type: BrowserType;
  prefs?: Record<string, string | number | boolean>;
  /** Every link of the page goes through a local TURN relay (relay candidates only). */
  relay?: boolean;
}

const ROWS: Record<string, Row> = {
  chromium: { type: chromium },
  'chromium through a relay': { type: chromium, relay: true },
  firefox: { type: firefox, prefs: { 'media.peerconnection.ice.obfuscate_host_addresses': false } },
  webkit: { type: webkit, relay: true },
};

let dir = '';
let server: http.Server | null = null;
let base = '';

const here = path.dirname(fileURLToPath(import.meta.url));

const freeTcp = (): Promise<number> => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); });
});
const freeUdp = (): Promise<number> => new Promise((resolve, reject) => {
  const s = dgram.createSocket('udp4');
  s.once('error', reject);
  s.bind(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

interface Relay { addr: string; stop: () => void }

/**
 * A TURN server of the live suite (support/turn-server.cjs) for this page alone. It listens on the machine's LAN address when there is one
 * (Chromium does not use a relay on loopback), else on loopback; `needLan` rows are skipped by the caller when there is no LAN address.
 */
async function startRelay(ip: string): Promise<Relay> {
  const udp = await freeUdp();
  const ctl = await freeTcp();
  const child: ChildProcess = spawn(process.execPath, [path.join(here, 'support/turn-server.cjs'), ip, String(udp), String(ctl)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const out: string[] = [];
  child.stderr?.on('data', (d: Buffer) => out.push(String(d)));
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the local TURN server did not start:\n' + out.join('').slice(-800))), 10_000);
    child.stdout?.on('data', (d: Buffer) => { out.push(String(d)); if (/TURN on/.test(String(d))) { clearTimeout(timer); resolve(); } });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the local TURN server exited (${code}):\n` + out.join('').slice(-800))); });
  });
  return { addr: `${ip}:${udp}`, stop: () => { try { child.kill(); } catch { /* gone */ } } };
}

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

for (const [name, spec] of Object.entries(ROWS)) {
  test(`peer layer on ${name}`, async () => {
    test.skip(spec.type !== chromium && !existsSync(spec.type.executablePath()), `${name} is not installed on this machine (npx playwright install ${spec.type.name()})`);
    const lan = lanAddress();
    test.skip(spec.relay === true && spec.type === chromium && !lan, 'this machine has no network address a relay can listen on (Chromium does not use a relay on loopback)');
    test.setTimeout(90_000);
    const browser = await spec.type.launch(spec.type === chromium ? baseLaunchOptions : { headless: true, ...(spec.prefs ? { firefoxUserPrefs: spec.prefs } : {}) });
    let relay: Relay | null = null;
    try {
      const page = await (await browser.newContext()).newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
      // a relay only where the engine has WebRTC at all (WebKit on Windows has none: nothing to relay, and the row is skipped below)
      if (spec.relay && (await page.evaluate(() => typeof RTCPeerConnection !== 'undefined'))) relay = await startRelay(lan ?? '127.0.0.1');
      await page.goto(`${base}/peers.html${relay ? `?turn=${relay.addr}` : ''}`);
      const rep = (await page.evaluate(() => (window as unknown as { __run: () => Promise<unknown> }).__run())) as PeersReport;
      console.log(JSON.stringify({ engine: name, webrtc: rep.webrtc, canCapture: rep.canCapture, relay: rep.relay, dcOpenMs: rep.dcOpenMs, aToB: rep.aToB, bToA: rep.bToA, ctrl: rep.ctrlAB, frames: rep.videoFrames, unmuted: rep.unmutedMs, path: rep.path, afterRestart: rep.afterRestart, error: rep.error }));
      test.skip(!rep.webrtc, `${name} here has no RTCPeerConnection: the client falls back to the Room relay (peersBroken), which video.test.ts covers`);
      expect(rep.error, 'page error').toBeNull();
      expect(errors, 'page errors').toEqual([]);
      expect(rep.relay, 'the row that asks for a relay goes through one').toBe(spec.relay === true);
      // what the match needs: the state channel and its messages (the Room relay covers it when this fails, but it should not)
      expect(rep.dcOpenMs[0], 'state channel opens on A').not.toBeNull();
      expect(rep.dcOpenMs[1], 'state channel opens on B').not.toBeNull();
      expect(rep.aToB && rep.bToA && rep.ctrlAB, 'messages cross both channels').toBe(true);
      // what the friend camera needs (when the engine can make a camera from a canvas at all)
      if (rep.canCapture) {
        expect(rep.tracks.a.some((t) => t.kind === 'video') && rep.tracks.b.some((t) => t.kind === 'video'), 'both sides get a video track').toBe(true);
        // The test's camera is a canvas. A WebKit build with no GPU (WebKitGTK on a GitHub Linux runner) shows no picture from a captured canvas even in ONE
        // page, with no link at all (the browser matrix skips its camera flows for the same reason): there the pictures over the link cannot be judged, and
        // the channel, the tracks and the ICE restart still are.
        if (await canvasStreamPlays(page)) expect(Math.min(rep.videoFrames.a, rep.videoFrames.b), 'the picture is painted').toBeGreaterThan(8);
        else console.log(JSON.stringify({ engine: name, note: 'a canvas camera shows no picture even in one page on this machine: the pictures over the link are not judged here' }));
      }
      // what a flaky link needs
      expect(rep.afterRestart.dcOpen && rep.afterRestart.roundTrip, 'an ICE restart keeps the channel').toBe(true);
    } finally {
      await browser.close().catch(() => undefined);
      relay?.stop();
    }
  });
}
