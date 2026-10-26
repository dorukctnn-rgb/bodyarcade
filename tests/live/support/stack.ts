// The live suite's local stack, started and stopped by the suite itself (nothing is left running):
//   - the test pages, built once with Vite into a temp folder and served as the Worker's static assets,
//   - the Worker (packages/server, test entry) on workerd through `wrangler dev`, with a fresh Durable Object store,
//   - a UDP TURN server with fault injection (packet loss, black hole),
//   - two TCP link shapers in front of the Worker, one per player (delay, jitter, half-open freeze).
// Everything binds 127.0.0.1 (TURN on the LAN address when there is one: Chrome does not use loopback relays) and all
// processes are started without a console window.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { SITE_PORT } from '../../e2e/support/ports.ts';
import { makeProKit, type ProKit } from '../../../packages/server/src/live/prokit.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '../../..');

const BASE = Number(process.env.BA_LIVE_PORT) || SITE_PORT + 20;
export const PORTS = { worker: BASE, shaperA: BASE + 1, shaperB: BASE + 2, turn: BASE + 3, turnCtl: BASE + 4 };

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The first non-loopback IPv4 address (a relay on 127.0.0.1 is not used by Chrome), or null. */
export function lanAddress(): string | null {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return null;
}

function killTree(child: ChildProcess | null): void {
  if (!child || child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  else { try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } } }
}

/**
 * A TCP proxy that makes one player's link to the Worker behave like a mobile network: delay and jitter per direction
 * (order preserved: one FIFO queue per direction, because per-chunk timers reordered bytes and corrupted responses),
 * a freeze that leaves existing connections open but silent (a half-open socket: not even a FIN or a reset gets through,
 * like a phone that locked), and an outage during which new connections hang (accepted and never answered).
 */
export class Shaper {
  readonly port: number;
  private readonly cfg = { delay: 0, jitter: 0, freezeBefore: 0, outage: false };
  readonly st = { conns: 0, frozenDrops: 0, bytes: 0, held: 0 };
  private readonly server: net.Server;
  private readonly sockets = new Set<net.Socket>();

  constructor(listen: number, target: number) {
    this.port = listen;
    this.server = net.createServer((client) => {
      this.st.conns++;
      client.setNoDelay(true);
      if (this.cfg.outage) {                                    // the network swallows new connections: they hang until the page gives up
        this.st.held++;
        this.sockets.add(client);
        client.on('data', () => { /* never answered */ });
        client.on('error', () => client.destroy());
        client.on('close', () => this.sockets.delete(client));
        return;
      }
      const opened = Date.now();
      const upstream = net.connect(target, '127.0.0.1');
      upstream.setNoDelay(true);                                // Nagle plus delayed ACK would add fake 200 ms stalls
      this.sockets.add(client); this.sockets.add(upstream);
      this.pipe(client, upstream, opened);
      this.pipe(upstream, client, opened);
      const frozen = (): boolean => opened < this.cfg.freezeBefore;
      upstream.on('error', () => { if (!frozen()) client.destroy(); });
      client.on('error', () => { if (!frozen()) upstream.destroy(); });
      const gone = (): void => { this.sockets.delete(client); this.sockets.delete(upstream); };
      client.on('close', gone); upstream.on('close', gone);
    });
  }

  listen(): Promise<void> {
    return new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(this.port, '127.0.0.1', () => resolve()); });
  }

  private pipe(from: net.Socket, to: net.Socket, opened: number): void {
    const q: { at: number; buf?: Buffer; end?: boolean }[] = [];
    let lastAt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const pump = (): void => {
      timer = null;
      while (q.length) {
        const head = q[0] as { at: number; buf?: Buffer; end?: boolean };
        const wait = head.at - Date.now();
        if (wait > 0) { timer = setTimeout(pump, wait); return; }
        q.shift();
        if (to.destroyed) continue;
        if (head.end) to.end(); else if (head.buf) to.write(head.buf);
      }
    };
    const push = (x: { buf?: Buffer; end?: boolean }): void => {
      const at = Math.max(Date.now() + this.cfg.delay + Math.random() * this.cfg.jitter, lastAt);
      lastAt = at;
      q.push({ at, ...x });
      if (!timer) pump();
    };
    from.on('data', (buf) => {
      if (opened < this.cfg.freezeBefore) { this.st.frozenDrops++; return; }         // swallowed: nothing closes, nothing arrives
      this.st.bytes += buf.length;
      push({ buf });
    });
    from.on('end', () => { if (opened < this.cfg.freezeBefore) return; push({ end: true }); });   // a frozen link carries no FIN either
  }

  /** One-way delay per direction, ms. */
  setDelay(ms: number, jitter = 0): void { this.cfg.delay = ms; this.cfg.jitter = jitter; }
  /** Connections that exist now go silent; connections opened later work normally. */
  freeze(on: boolean): void { this.cfg.freezeBefore = on ? Date.now() + 1 : 0; }
  /** While on, connections opened from now on hang (the network answers nothing). Connections that exist are not touched. */
  outage(on: boolean): void { this.cfg.outage = on; }

  close(): void {
    this.server.close();
    for (const s of this.sockets) s.destroy();
  }
}

export interface TurnChaos { loss: number; blackhole: boolean; sent: number; dropped: number }

export interface Stack {
  base: string;
  baseA: string;
  baseB: string;
  shaperA: Shaper;
  shaperB: Shaper;
  turn: boolean;
  turnIp: string | null;
  /** The entitlement key pair of this run: the Worker holds its private half as ENT_PRIV_JWK (and checks Pro tokens with the public half); `pro.mint()` makes a token the way the entitlement service does. */
  pro: ProKit;
  workerLog(): string;
  turnControl(path: string): Promise<TurnChaos | null>;
  /** A real deploy: the Worker's code changes, workerd restarts, every socket drops and the Room objects are rebuilt from storage. */
  redeploy(): Promise<void>;
  admin(pathAndQuery: string, method?: 'GET' | 'POST'): Promise<unknown>;
  stop(): Promise<void>;
}

export async function startStack(): Promise<Stack> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'ba-live-'));
  const pagesDir = path.join(tmp, 'pages');
  const log: string[] = [];
  const children: ChildProcess[] = [];
  const shapers: Shaper[] = [];
  const stop = async (): Promise<void> => {
    for (const s of shapers) s.close();
    for (const c of children) killTree(c);
    await sleep(300);
    try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* temp files */ }
  };
  try {
    await build({
      root: path.join(ROOT, 'tests/live/pages'), base: './', configFile: false, logLevel: 'warn',
      build: { outDir: pagesDir, emptyOutDir: true, minify: false, target: 'es2022', sourcemap: false, rollupOptions: { input: path.join(ROOT, 'tests/live/pages/duel.html') } },
    });
    const pro = await makeProKit();
    const turnIp = lanAddress();
    if (turnIp) {
      const turn = spawn(process.execPath, [path.join(here, 'turn-server.cjs'), turnIp, String(PORTS.turn), String(PORTS.turnCtl)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      turn.stdout.on('data', (d: Buffer) => log.push('[turn] ' + String(d)));
      turn.stderr.on('data', (d: Buffer) => log.push('[turn!] ' + String(d)));
      children.push(turn);
    }
    // The Worker's entry is a wrapper in the temp folder: rewriting it is a deploy (wrangler rebuilds and restarts workerd)
    // without touching any file of the repository.
    const entry = path.join(tmp, 'entry.ts');
    const testing = path.join(ROOT, 'packages/server/src/testing.ts').replace(/\\/g, '/');
    let version = 1;
    const writeEntry = (): void => writeFileSync(entry, `export * from '${testing}';\nexport { default } from '${testing}';\n// deploy ${version}\n`);
    writeEntry();
    const config = {
      name: 'bodyarcade-live-test', main: entry, compatibility_date: '2026-09-01',
      assets: { directory: pagesDir, binding: 'ASSETS', run_worker_first: ['/api/*'], html_handling: 'auto-trailing-slash' },
      durable_objects: { bindings: [{ name: 'ROOMS', class_name: 'Room' }] }, migrations: [{ tag: 'v1', new_sqlite_classes: ['Room'] }],
      vars: {
        TICKET_SECRET: 'test-only-ticket-secret-0123456789abcdef', LIVE_NO_LIMITS: '1', ENT_PRIV_JWK: pro.env.ENT_PRIV_JWK,
        ...(turnIp ? { ICE_LOCAL_TURN: `turn:${turnIp}:${PORTS.turn}?transport=udp`, ICE_LOCAL_USER: 'ba', ICE_LOCAL_PASS: 'ba-secret' } : {}),
      },
    };
    const configPath = path.join(tmp, 'wrangler.live.jsonc');
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    const wranglerJs = path.join(ROOT, 'node_modules/wrangler/bin/wrangler.js');
    const worker = spawn(process.execPath, [wranglerJs, 'dev', '-c', configPath, '--port', String(PORTS.worker), '--ip', '127.0.0.1', '--local', '--persist-to', path.join(tmp, 'state'), '--show-interactive-dev-session=false'], {
      cwd: tmp, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1', NO_COLOR: '1' },
    });
    worker.stdout.on('data', (d: Buffer) => log.push(String(d)));
    worker.stderr.on('data', (d: Buffer) => log.push(String(d)));
    children.push(worker);
    const base = `http://127.0.0.1:${PORTS.worker}`;
    let ready = false;
    for (let i = 0; i < 200 && !ready; i++) {
      if (worker.exitCode !== null) throw new Error('wrangler exited early:\n' + log.join('').slice(-1500));
      try { ready = (await fetch(base + '/api/ice', { method: 'POST' })).ok; } catch { ready = false; }
      if (!ready) await sleep(250);
    }
    if (!ready) throw new Error('the Worker did not start in 50 s:\n' + log.join('').slice(-1500));
    const shaperA = new Shaper(PORTS.shaperA, PORTS.worker); const shaperB = new Shaper(PORTS.shaperB, PORTS.worker);
    await shaperA.listen(); await shaperB.listen();
    shapers.push(shaperA, shaperB);
    const turnControl = async (p: string): Promise<TurnChaos | null> => {
      if (!turnIp) return null;
      try { return (await (await fetch(`http://127.0.0.1:${PORTS.turnCtl}${p}`)).json()) as TurnChaos; } catch { return null; }
    };
    if (turnIp) {
      for (let i = 0; i < 40 && !(await turnControl('/stats')); i++) await sleep(250);
    }
    return {
      base, baseA: `http://127.0.0.1:${PORTS.shaperA}`, baseB: `http://127.0.0.1:${PORTS.shaperB}`, shaperA, shaperB, turn: !!turnIp, turnIp, pro,
      workerLog: () => log.join(''),
      turnControl,
      redeploy: async () => {
        const mark = log.join('').length;
        version++;
        writeEntry();
        for (let i = 0; i < 120; i++) {                                 // wait until wrangler has rebuilt and reloaded
          await sleep(250);
          if (/Reloading|Rebuilt|reloaded|Ready on/i.test(log.join('').slice(mark))) break;
        }
        for (let i = 0; i < 80; i++) {                                  // and the new code answers
          try { if ((await fetch(base + '/api/ice', { method: 'POST' })).ok) return; } catch { /* restarting */ }
          await sleep(250);
        }
      },
      admin: async (p, method = 'GET') => (await fetch(base + p, { method })).json().catch(() => null),
      stop,
    };
  } catch (e) {
    await stop();
    throw e;
  }
}
