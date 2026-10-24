// Live-play smoke test against a Worker that is already running (the preview, later production): the release gate "the
// live suite passes against the deployed Worker" in a minute and without a browser.
//   node tests/live/support/smoke-remote.ts https://bodyarcade-v2-preview.railer-iot.workers.dev
// It asks for ICE servers, makes a room, opens the invite link, joins as a second player, plays one real 15 s match
// between two LiveClients over the Room's relay (no WebRTC), and checks that both got the same result and that each
// player's own count equals the Room's. Exit code 0 only when every step passed. It uses one room, so the per-IP
// limits of the Worker are not a concern.
import { LiveClient, codeFromInvite, createRoom, fetchIce, joinRoom, makeSchedule, previewRoom, scoreOf, specFor, type Identity } from '../../../packages/core/net/index.ts';
import type { JoinGrant, MatchInfo, MatchResult, ObstacleResult } from '../../../packages/core/types/net.ts';

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
const stamp = Date.now().toString(36);
const A: Identity = { pid: `smoke-a-${stamp}-device`, name: 'SmokeA', age: 'adult' };
const B: Identity = { pid: `smoke-b-${stamp}-device`, name: 'SmokeB', age: 'adult' };

interface Side { c: LiveClient; mine: ObstacleResult[]; results: MatchResult[]; match: MatchInfo | null; seat: string; errors: string[] }

function side(grant: JoinGrant, who: Identity): Side {
  const s: Side = { c: null as unknown as LiveClient, mine: [], results: [], match: null, seat: '', errors: [] };
  s.c = new LiveClient({ grant, origin: base, peers: 'none', refreshTicket: () => joinRoom(base, grant.code, who) });
  s.c.on('welcome', (w) => { s.seat = w.you; s.c.setReady(true); });
  s.c.on('match', (d) => { s.match = d.match; });
  s.c.on('result', (r) => { s.results.push(r); });
  s.c.on('fatal', (f) => { s.errors.push('fatal ' + f.reason + ' ' + f.code); });
  s.c.on('roomError', (e) => { s.errors.push('room error ' + e.code); });
  return s;
}

const ice = await step('ICE servers (STUN, and TURN when the key is set)', () => fetchIce(base), (g) => ({ servers: g.iceServers.length, turn: g.turn }));
if (ice && ice.iceServers.length < 1) steps.push({ step: 'ICE has at least one server', ok: false, ms: 0 });
const created = await step('create a room', () => createRoom(base, A, { gameId: 'squat-flap', durationMs: 15_000 }), (g) => ({ code: g.code, link: g.link }));
if (created) {
  await step('the invite link carries the room code', async () => { if (codeFromInvite(created.link) !== created.code) throw new Error('link ' + created.link); return true; });
  await step('preview the room', () => previewRoom(base, created.code), (p) => ({ game: p.gameId, size: p.size, players: p.players, phase: p.phase }));
  await step('the invite page answers (the Worker serves the start page under /r/<CODE>)', async () => {
    const r = await fetch(`${base}/r/${created.code}`, { headers: { Accept: 'text/html' } });
    const type = r.headers.get('Content-Type') ?? '';
    if (r.status !== 200 || !type.includes('text/html')) throw new Error(`status ${r.status} ${type}: "/r/*" must be in assets.run_worker_first of the wrangler config`);
    return { noindex: r.headers.get('X-Robots-Tag') };
  }, (v) => v);
  const joined = await step('join as the second player', () => joinRoom(base, created.code, B), (g) => ({ code: g.code }));
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

const failed = steps.filter((s) => !s.ok);
for (const s of steps) console.log(`${s.ok ? 'ok   ' : 'FAIL '} ${s.step} (${s.ms} ms)${s.detail !== undefined && JSON.stringify(s.detail) !== '{}' ? ' ' + JSON.stringify(s.detail) : ''}`);
console.log(failed.length ? `\n${failed.length} step(s) failed against ${base}` : `\nlive play works against ${base}`);
process.exit(failed.length ? 1 : 0);
