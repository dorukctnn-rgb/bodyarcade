// Simulation bot: plays every game of packages/games through the real Session (hand-turned clock, no browser, no camera)
// with players that need no knowledge of the game (profiles.ts) and checks what any game must keep to:
//   - it never throws and the session never ends in the error state,
//   - the round ends by itself within a fair time (the manifest's duration, with room for the countdown and pauses),
//   - the summary is sane (finite numbers, no negative score, time inside the round, an ordered log),
//   - the same seed and the same input give exactly the same round (summary, HUD writes, sounds),
//   - a simulated second costs little CPU (the game's step and the 2D view on a recording canvas).
//
//   node tools/simbot/run.ts [--game road-run,squat-flap] [--profile idle,chaos,mash,blackout,pauser] [--seeds 1,2]
//        [--difficulty normal] [--seated] [--local2] [--no-determinism] [--out qa-out/simbot]
// Games without a folder index.ts are skipped. Round times are simulated, so a whole run takes a few seconds.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { clockedSession } from '../../packages/games/_shared/testing/fakes.ts';
import { testScene } from '../../packages/games/kit-g1/testing/scene.ts';
import { mulberry32 } from '../../packages/core/loop/rng.ts';
import { SHAPE_FULL, SHAPE_UPPER } from '../../packages/core/moves/testing/rig.ts';
import { createChain } from '../../packages/games/kit-g1/testing/chain.ts';
import { flailer } from './body.ts';
import type { GameModule, MovementId, PlayerSlot, RunSummary } from '../../packages/core/types/index.ts';
import { PROFILES, PROFILE_IDS, type ProfileEnv } from './profiles.ts';
import { repoRoot } from '../page-check/servers.ts';
import { beNice } from '../page-check/nice.ts';

beNice();

export interface RunSpec { game: string; profile: string; seed: number; difficulty: string; seated: boolean; mode: 'solo' | 'local2' }

export interface RunReport {
  spec: RunSpec;
  ok: boolean;
  problems: string[];
  /** Simulated seconds from the start of the round to its end, steps, and the wall time the simulation took (ms). */
  simSeconds: number;
  frames: number;
  wallMs: number;
  msPerSimSecond: number;
  /** A fingerprint of everything the round showed and said, for the determinism check. */
  hash: string;
  summary: RunSummary | null;
}

const asNumber = (n: unknown): boolean => typeof n === 'number' && Number.isFinite(n);

/** What a summary must look like. Exported for the tests. */
export function summaryProblems(s: RunSummary, durationSec: number, mode: string): string[] {
  const p: string[] = [];
  for (const k of ['score', 'seconds', 'metSeconds'] as const) if (!asNumber(s[k])) p.push(`summary.${k} is not a number (${String(s[k])})`);
  if (asNumber(s.score) && s.score < 0) p.push(`negative score ${s.score}`);
  if (asNumber(s.seconds) && s.seconds < 0) p.push(`negative time ${s.seconds}`);
  if (asNumber(s.seconds) && s.seconds > durationSec * 1.5 + 10) p.push(`the round lasted ${s.seconds} s, the manifest says ${durationSec} s`);
  if (asNumber(s.metSeconds) && asNumber(s.seconds) && s.metSeconds > s.seconds * 14) p.push(`metSeconds ${s.metSeconds} is more than 14 MET over ${s.seconds} s`);
  for (const k of ['reps', 'cleared', 'hits', 'bestStreak', 'quality'] as const) { const v = s[k]; if (v !== undefined && (!asNumber(v) || v < 0)) p.push(`summary.${k} is ${String(v)}`); }
  if (!Array.isArray(s.log)) p.push('summary.log is not a list');
  else {
    let last = -Infinity;
    for (const e of s.log) {
      if (!asNumber(e.t) || e.t < last) { p.push(`the log is not in time order at t=${String(e.t)}`); break; }
      last = e.t;
    }
  }
  if (mode === 'local2' && !s.players) p.push('local2 round without a result per player');
  if (mode !== 'local2' && s.players && Object.keys(s.players).length > 1) p.push('solo round with a result for two players');
  return p;
}

/** Profiles that play with a body through the real chain (pose frames, calibration, detectors) instead of injected events. */
export const BODY_PROFILES = ['flail', 'leave'];

/** A person who flails at random (and, for 'leave', walks out of the picture now and then) in front of the real chain. */
export async function runBody(mod: GameModule, spec: RunSpec): Promise<RunReport> {
  const problems: string[] = [];
  const upper = spec.seated || mod.manifest.framing === 'upper';
  const base = { ...(upper ? SHAPE_UPPER : SHAPE_FULL), aspect: 16 / 9 };
  const two = spec.mode === 'local2';
  const shapes = two ? [{ ...base, cx: 0.68, T: base.T * 0.85 }, { ...base, cx: 0.32, T: base.T * 0.85 }] : [base];
  const people = shapes.map((shape, i) => flailer({ seed: spec.seed * 31 + i, shape, upper, leaver: spec.profile === 'leave' && i === (two ? 1 : 0) }));
  const scene = testScene(1280, 720);
  const chain = createChain({ module: mod, mode: spec.mode, difficulty: spec.difficulty, seated: spec.seated, seed: spec.seed, people, scene2d: scene.kit as never });
  const t0 = performance.now();
  let start = 0;
  try {
    await chain.start();
    start = chain.now();
    const cap = (mod.manifest.durationSec * 1.7 + 60) * 1000;
    const ended = chain.until(() => chain.session.state === 'results' || chain.session.state === 'error', cap);
    if (!ended) problems.push(`the round did not end within ${Math.round(cap / 1000)} simulated seconds (state: ${chain.session.state})`);
  } catch (e) {
    problems.push(`threw: ${(e as Error).stack?.split('\n').slice(0, 3).join(' | ') ?? String(e)}`);
  }
  const wallMs = performance.now() - t0;
  const summary = chain.seen.over[0] ?? null;
  if (chain.seen.errors.length) problems.push(`the session reported an error: ${chain.seen.errors.map((e) => `${e.code}: ${e.message}`).join('; ')}`);
  const simSeconds = Math.round(((chain.now() - start) / 1000) * 100) / 100;
  if (summary) problems.push(...summaryProblems(summary, mod.manifest.durationSec, spec.mode));
  else if (!problems.length) problems.push('the round ended without a summary');
  const hash = createHash('sha1').update(JSON.stringify({ summary, hud: chain.hudLog, plates: chain.plates, sounds: chain.sounds, states: chain.seen.states })).digest('hex').slice(0, 12);
  try { chain.stop(); } catch (e) { problems.push(`stop threw: ${(e as Error).message}`); }
  return { spec, ok: problems.length === 0, problems, simSeconds, frames: 0, wallMs: Math.round(wallMs), msPerSimSecond: simSeconds > 0 ? Math.round((wallMs / simSeconds) * 10) / 10 : 0, hash, summary };
}

export async function runOnce(mod: GameModule, spec: RunSpec): Promise<RunReport> {
  if (BODY_PROFILES.includes(spec.profile)) return runBody(mod, spec);
  const problems: string[] = [];
  const doc = Object.assign(new EventTarget(), { hidden: false });
  const scene = testScene(1280, 720);
  const c = clockedSession({ [spec.game]: mod }, { scene2d: scene.kit, seed: () => spec.seed, doc } as never);
  const { session } = c;
  const errors: string[] = [];
  let summary: RunSummary | null = null;
  const states: string[] = [];
  session.on('error', (e) => errors.push(`${e.code}: ${e.message}`));
  session.on('over', (s) => { summary = s; });
  session.on('state', (s) => { if (states[states.length - 1] !== s) states.push(s); });
  const rnd = mulberry32((spec.seed * 2654435761) ^ (PROFILE_IDS.indexOf(spec.profile) + 1) * 40503);
  const profile = PROFILES[spec.profile];
  if (!profile) throw new Error(`unknown profile ${spec.profile}`);
  const players: PlayerSlot[] = spec.mode === 'local2' ? [1, 2] : [1];
  const ids = (mod.manifest.detectors.map((d) => d.id) as MovementId[]);
  const t0 = performance.now();
  let frames = 0;
  let roundStart = 0;
  try {
    await session.start(spec.game, { mode: spec.mode, seed: spec.seed, difficulty: spec.difficulty, input: 'keyboard', seated: spec.seated });
    const ready = c.until('running', { maxMs: 60_000 });
    if (!ready) problems.push(`never reached the running state (state: ${session.state})`);
    roundStart = c.now();
    const capMs = (mod.manifest.durationSec * (spec.profile === 'pauser' ? 2.4 : 1.6) + 40) * 1000;
    let k = 0;
    const hub = c.hub();
    while (ready && hub && session.state !== 'results' && session.state !== 'error' && c.now() - roundStart < capMs) {
      const env: ProfileEnv = { hub, session, keys: c.keys, doc, ids, keyMap: mod.controls?.keys, players, rnd };
      if (session.state === 'running' || spec.profile === 'pauser') profile.act(k++, env);
      c.tick(1000 / 60);
      frames++;
      // Promises of the session (resume, start) go on between frames, as they do in a page.
      if (frames % 4 === 0) await Promise.resolve();
    }
    if (session.state !== 'results' && session.state !== 'error' && ready) problems.push(`the round did not end within ${Math.round(capMs / 1000)} simulated seconds (state: ${session.state})`);
  } catch (e) {
    problems.push(`threw: ${(e as Error).stack?.split('\n').slice(0, 3).join(' | ') ?? String(e)}`);
  }
  const wallMs = performance.now() - t0;
  if (session.state === 'error' || errors.length) problems.push(`the session reported an error: ${errors.join('; ') || 'state error'}`);
  const simSeconds = Math.round(((c.now() - roundStart) / 1000) * 100) / 100;
  if (summary) problems.push(...summaryProblems(summary, mod.manifest.durationSec, spec.mode));
  else if (!problems.length) problems.push('the round ended without a summary');
  const hash = createHash('sha1').update(JSON.stringify({ summary, hud: c.hudWrites, played: c.played, states, texts: scene.ctx.texts.length })).digest('hex').slice(0, 12);
  try { session.quit(); } catch (e) { problems.push(`quit threw: ${(e as Error).message}`); }
  return { spec, ok: problems.length === 0, problems, simSeconds, frames, wallMs: Math.round(wallMs), msPerSimSecond: simSeconds > 0 ? Math.round((wallMs / simSeconds) * 10) / 10 : 0, hash, summary };
}

async function loadModules(only: string[]): Promise<Map<string, GameModule>> {
  const dir = join(repoRoot(), 'packages', 'games');
  const out = new Map<string, GameModule>();
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('_') || (only.length && !only.includes(name))) continue;
    const file = join(dir, name, 'index.ts');
    if (!existsSync(file)) continue;
    const mod = (await import(pathToFileURL(file).href) as { default?: GameModule }).default;
    if (mod && typeof mod.create === 'function' && mod.manifest) out.set(name, mod);
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  const args = process.argv.slice(2);
  const opt = (k: string): string | undefined => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
  const list = (k: string, d: string): string[] => (opt(k) ?? d).split(',').map((s) => s.trim()).filter(Boolean);
  const only = list('game', '');
  const profiles = list('profile', [...PROFILE_IDS, ...BODY_PROFILES].join(','));
  const seeds = list('seeds', '1,2').map(Number);
  const difficulties = list('difficulty', 'normal');
  const mods = await loadModules(only);
  const reports: RunReport[] = [];
  const t00 = Date.now();
  for (const [id, mod] of mods) {
    const specs: RunSpec[] = [];
    // The body profiles run through the whole chain and cost the most: one seed unless --all-seeds.
    for (const profile of profiles) for (const seed of BODY_PROFILES.includes(profile) && !args.includes('--all-seeds') ? seeds.slice(0, 1) : seeds) for (const difficulty of difficulties) {
      specs.push({ game: id, profile, seed, difficulty, seated: false, mode: 'solo' });
      if (args.includes('--seated') && mod.manifest.seated) specs.push({ game: id, profile, seed, difficulty, seated: true, mode: 'solo' });
      if (!args.includes('--no-local2') && mod.manifest.modes.includes('local2') && BODY_PROFILES.includes(profile)) specs.push({ game: id, profile, seed, difficulty, seated: false, mode: 'local2' });
    }
    let bad = 0;
    let slowest = 0;
    for (const spec of specs) {
      const r = await runOnce(mod, spec);
      // The same round again must be the same round.
      if (r.ok && !args.includes('--no-determinism') && spec.seed === (seeds[0] ?? 1)) {
        const again = await runOnce(mod, spec);
        if (again.hash !== r.hash) { r.ok = false; r.problems.push(`not deterministic: the same seed and input gave two different rounds (${r.hash} and ${again.hash})`); }
      }
      reports.push(r);
      slowest = Math.max(slowest, r.msPerSimSecond);
      if (!r.ok) { bad++; console.log(`FAIL ${id} ${spec.profile} seed ${spec.seed} ${spec.difficulty}${spec.seated ? ' seated' : ''} ${spec.mode}:\n  ${r.problems.slice(0, 4).join('\n  ')}`); }
    }
    console.log(`${bad ? 'FAIL' : 'ok  '} ${id}: ${specs.length} round(s), ${bad} with problems, slowest ${slowest} ms of CPU per simulated second`);
  }
  const out = resolve(opt('out') ?? join(repoRoot(), 'qa-out', 'simbot'));
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'report.json'), JSON.stringify({ generated: new Date().toISOString(), reports: reports.map((r) => ({ ...r, summary: r.summary && { score: r.summary.score, seconds: r.summary.seconds, reps: r.summary.reps, hits: r.summary.hits } })) }, null, 1));
  const failed = reports.filter((r) => !r.ok);
  console.log(`${reports.length} round(s) of ${mods.size} game(s) in ${((Date.now() - t00) / 1000).toFixed(0)} s: ${failed.length} with problems. ${join(out, 'report.json')}`);
  process.exit(failed.length ? 1 : 0);
}
