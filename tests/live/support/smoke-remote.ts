// Live-play smoke test against a Worker that is already running (the preview, later production): the release gate "the
// live suite passes against the deployed Worker" in a minute and without a browser.
//   node tests/live/support/smoke-remote.ts https://bodyarcade-v2-preview.railer-iot.workers.dev
// It asks for ICE servers, checks that a Pro game is refused to a host with no Pro token or a made-up one, makes a room, opens the invite link, joins as a second player, plays one real 15 s match
// between two LiveClients over the Room's relay (no WebRTC), and checks that both got the same result and that each
// player's own count equals the Room's. Exit code 0 only when every step passed. It uses one room, so the per-IP
// limits of the Worker are not a concern.
// The two players are SIGNED social profiles (tests/release/players.ts), as the shell's players are: a Worker with the social module
// takes no unsigned room call (401) once the preview bridge SOCIAL_ALLOW_UNSIGNED is gone, and bodyarcade.com never took one. Their keys
// are kept under tests/release/out/identities/<host>/ (the sign-up limit of an address), and on bodyarcade.com the two profiles are
// deleted again at the end (BA_RELEASE_KEEP_PROFILES=1 keeps them). BA_RELEASE_SIGNING=signed|guest forces a mode, as in the release checks.
import { fileURLToPath } from 'node:url';
import { LiveClient, codeFromInvite, createRoom, fetchIce, joinRoom, makeSchedule, previewRoom, scoreOf, specFor, type Identity } from '../../../packages/core/net/index.ts';
import type { JoinGrant, MatchInfo, MatchResult, ObstacleResult } from '../../../packages/core/types/net.ts';
import { chooseMode, identitiesDir, openPlayers, signedFetcher } from '../../release/players.ts';

const arg = process.argv[2];
if (!arg || !/^https?:\/\//.test(arg)) {
  console.error('usage: node tests/live/support/smoke-remote.ts <origin>   (for example https://bodyarcade-v2-preview.railer-iot.workers.dev)');
  process.exit(2);
}
const base = arg.replace(/\/+$/, '');
const steps: { step: string; ok: boolean; ms: number; detail?: unknown }[] = [];

async function step<T>(name: string, fn: () => Promise<T>, check: (v: T) => unknown = () => ({})): Promise<T | null> {
  const t0 = Date.now();
  try {
    const v = await fn();
    steps.push({ step: name, ok: true, ms: Date.now() - t0, detail: check(v) });
    return v;
  } catch (e) {
    steps.push({ step: name, ok: false, ms: Date.now() - t0, detail: String(e instanceof Error ? e.message : e) });
    return null;
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const production = /^https:\/\/bodyarcade\.com$/.test(base);
const verdict = await chooseMode(base, { want: process.env['BA_RELEASE_SIGNING'] ?? 'auto', production });
console.log(`players: ${verdict.mode} (${verdict.why})`);
const out = fileURLToPath(new URL('../../release/out', import.meta.url));
const [pa, pb] = await openPlayers(base, ['Smoke A', 'Smoke B'], { mode: verdict.mode, dir: identitiesDir(base, out) });
if (!pa || !pb) throw new Error('two players expected');
const A: Identity = pa.identity();
const B: Identity = pb.identity();
const fetchA = signedFetcher(pa);
const fetchB = signedFetcher(pb);
const fetcherOf = (who: Identity): typeof fetch => (who === A ? fetchA : fetchB);

interface Side { c: LiveClient; mine: ObstacleResult[]; results: MatchResult[]; match: MatchInfo | null; seat: string; errors: string[] }

function side(grant: JoinGrant, who: Identity): Side {
  const s: Side = { c: null as unknown as LiveClient, mine: [], results: [], match: null, seat: '', errors: [] };
  s.c = new LiveClient({ grant, origin: base, peers: 'none', refreshTicket: () => joinRoom(base, grant.code, who, fetcherOf(who)) });
  s.c.on('welcome', (w) => { s.seat = w.you; s.c.setReady(true); });
  s.c.on('match', (d) => { s.match = d.match; });
  s.c.on('result', (r) => { s.results.push(r); });
  s.c.on('fatal', (f) => { s.errors.push('fatal ' + f.reason + ' ' + f.code); });
  s.c.on('roomError', (e) => { s.errors.push('room error ' + e.code); });
  return s;
}

const ice = await step('ICE servers (STUN, and TURN when the key is set)', () => fetchIce(base), (g) => ({ servers: g.iceServers.length, turn: g.turn }));
if (ice && ice.iceServers.length < 1) steps.push({ step: 'ICE has at least one server', ok: false, ms: 0 });
// The check of the host's signed Pro token is deployed: a Pro game is refused to a host with no token and to one with a made-up token, with the
// reason, and no room is made. A genuine token cannot be shown from here (it needs the entitlement key): that path is tests/live/pro.spec.ts.
const askPro = async (pro?: string): Promise<{ status: number; body: Record<string, unknown> }> => {
  const r = await pa.post(`${base}/api/rooms`, { gameId: 'limbo-bend', durationMs: 15_000, ...A, ...(pro ? { pro } : {}) });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> };
};
for (const [name, token, reason] of [['a free host is refused a Pro game (the check of the host\'s Pro token is deployed)', undefined, 'none'], ['a made-up Pro token is refused too', 'a.b.c', 'invalid']] as const) {
  await step(name, async () => {
    const r = await askPro(token);
    if (r.status !== 403 || r.body.error !== 'pro_required' || r.body.reason !== reason) throw new Error(`status ${r.status} ${JSON.stringify(r.body)}: a Pro game must need the signed Pro token of the host (is the Worker older than the Pro check?)`);
    return { reason: r.body.reason };
  }, (v) => v);
}
const created = await step('create a room', () => createRoom(base, A, { gameId: 'squat-flap', durationMs: 15_000 }, fetchA), (g) => ({ code: g.code, link: g.link }));
if (created) {
  await step('the invite link carries the room code', async () => { if (codeFromInvite(created.link) !== created.code) throw new Error('link ' + created.link); return true; });
  await step('preview the room', () => previewRoom(base, created.code), (p) => ({ game: p.gameId, size: p.size, players: p.players, phase: p.phase }));
  await step('the invite page answers (the Worker serves the start page under /r/<CODE>)', async () => {
    const r = await fetch(`${base}/r/${created.code}`, { headers: { Accept: 'text/html' } });
    const type = r.headers.get('Content-Type') ?? '';
    if (r.status !== 200 || !type.includes('text/html')) throw new Error(`status ${r.status} ${type}: "/r/*" must be in assets.run_worker_first of the wrangler config`);
    return { noindex: r.headers.get('X-Robots-Tag') };
  }, (v) => v);
  const joined = await step('join as the second player', () => joinRoom(base, created.code, B, fetchB), (g) => ({ code: g.code }));
  if (joined) {
    const a = side(created, A); const b = side(joined, B);
    await step('both players connect and the match starts', async () => {
      await Promise.all([a.c.start(), b.c.start()]);
      for (let i = 0; i < 300 && !(a.match && b.match); i++) await sleep(100);
      if (!a.match || !b.match) throw new Error('no match after 30 s: ' + JSON.stringify({ a: a.errors, b: b.errors }));
      return { seats: [a.seat, b.seat], seed: a.match.seed };
    }, (v) => v);
    if (a.match && b.match) {
      const course = makeSchedule(a.match.seed, a.match.duration, specFor(a.match.gameId));
      await step('play one match over the Room relay and get a result on both sides', async () => {
        const t0 = Date.now();
        let n = 0;
        const timer = setInterval(() => {
          for (const [k, s] of [a, b].entries()) {
            const mt = s.c.matchTime();
            if (mt < 0 || s.c.match?.phase === 'over') continue;
            for (const o of course) {
              if (o.t > mt || s.mine.some((e) => e.ob === o.id)) continue;
              const kind = (o.id + k) % 4 === 0 ? 'hit' : 'pass';
              s.mine.push({ ob: o.id, k: kind });
              s.c.reportResult(o.id, kind);
            }
            if (mt >= (a.match as MatchInfo).duration && !s.c.match?.result) s.c.finish(s.mine);
            if (++n % 4 === 0) s.c.sendState({ mt: Math.round(mt) });
          }
        }, 66);
        for (let i = 0; i < 600 && !(a.results.length && b.results.length); i++) await sleep(100);
        clearInterval(timer);
        if (!a.results.length || !b.results.length) throw new Error('no result after 60 s: ' + JSON.stringify({ a: a.errors, b: b.errors }));
        return { ms: Date.now() - t0, reason: a.results[0]?.reason, winner: a.results[0]?.winner };
      }, (v) => v);
      const ra = a.results[0]; const rb = b.results[0];
      if (ra && rb) {
        await step('both results are identical and complete', async () => {
          if (JSON.stringify(ra) !== JSON.stringify(rb)) throw new Error('results differ');
          if (ra.reason !== 'complete') throw new Error('reason ' + ra.reason);
          return true;
        });
        await step("each player's own count equals the Room's", async () => {
          for (const s of [a, b]) {
            const mine = scoreOf(course, s.mine).score;
            const theirs = ra.scores[s.seat]?.score;
            if (mine !== theirs) throw new Error(`${s.seat}: local ${mine}, Room ${theirs}`);
          }
          return true;
        });
        await step('no errors on either side', async () => { if (a.errors.length || b.errors.length) throw new Error(JSON.stringify([a.errors, b.errors])); return true; });
      }
    }
    a.c.stop(); b.c.stop();
  }
}

// bodyarcade.com keeps no test profiles (the preview keeps them, so the next run signs up nobody)
if (production && process.env['BA_RELEASE_KEEP_PROFILES'] !== '1') {
  await step('the two test profiles are deleted again', async () => { await pa.retire(); await pb.retire(); return true; });
}

const failed = steps.filter((s) => !s.ok);
for (const s of steps) console.log(`${s.ok ? 'ok   ' : 'FAIL '} ${s.step} (${s.ms} ms)${s.detail !== undefined && JSON.stringify(s.detail) !== '{}' ? ' ' + JSON.stringify(s.detail) : ''}`);
console.log(failed.length ? `\n${failed.length} step(s) failed against ${base}` : `\nlive play works against ${base}`);
process.exit(failed.length ? 1 : 0);
