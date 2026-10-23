// Runner view on the scene kit, in Node with a fake renderer: obstacles are shared prototypes spawned and released by
// id, coins are one instanced batch, frames between steps are interpolated, and five runs in a row leave exactly the
// resources of one (B5). The real GPU run is tests/e2e/road-run.spec.ts.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { AudioApi, GameContext, InputEvent, Rng } from '../../core/types/index.ts';
import { FIXED_DT } from '../../core/types/index.ts';
import { rngStream } from '../../core/loop/rng.ts';
import { stepTime } from '../../core/loop/clock.ts';
import { createScene3D, type RendererLike, type Scene3DKit } from '../../core/render3d/scene3d.ts';
import roadRun, { WORLDS } from '../road-run/index.ts';
import type { RunnerGame } from './game.ts';
import { obstacleKey } from './view.ts';
import { botAction } from './testing/bot.ts';
import type { Run } from './sim.ts';

class FakeCanvas extends EventTarget { clientWidth = 1280; clientHeight = 720; }

function fakeRenderer(): RendererLike & { renders: number } {
  const canvas = new FakeCanvas();
  const r = {
    domElement: canvas,
    shadowMap: { enabled: true, type: THREE.PCFShadowMap },
    info: { memory: { geometries: 0, textures: 0 }, render: { calls: 0, triangles: 0 } },
    capabilities: { getMaxAnisotropy: () => 16 },
    toneMappingExposure: 1,
    renders: 0,
    setPixelRatio() {},
    setSize() {},
    render() { r.renders++; },
    compile() {},
    dispose() {},
  };
  return r;
}

function context(kit: Scene3DKit, seed: number): GameContext {
  const streams = new Map<string, Rng>();
  return {
    pose: {} as GameContext['pose'],
    input: {} as GameContext['input'],
    hud: { set() {}, announce() {}, toast() {} },
    audio: {} as AudioApi,
    store: { get: <T>(_k: string, _s: unknown, f: T) => f, set() {}, remove() {} },
    scene3d: kit,
    rng: (name) => { let s = streams.get(name); if (!s) { s = rngStream(seed, name); streams.set(name, s); } return s; },
    flags: { reducedMotion: false, silent: false, seated: false },
    t: (k) => k,
  };
}

async function runOnce(kit: Scene3DKit, seed: number, seconds: number, world?: string): Promise<RunnerGame> {
  const game = roadRun.create() as RunnerGame;
  await game.init(context(kit, seed));
  game.start({ seed, difficulty: 'medium', seated: false, mode: 'solo', profile: null, ...(world ? { world } : {}) });
  for (let k = 1; k <= seconds * 60 && game.run!.phase === 'running'; k++) {
    const a = botAction(game.run as Run, 'late');
    const ev: InputEvent[] = a.jump ? [{ id: 'jump', kind: 'rep', t: 0, source: 'test' }] : [];
    game.step(FIXED_DT, { t: stepTime(k), source: 'test', tracking: { ok: true }, channels: { lane: a.lane, crouch: a.crouch }, events: ev });
    game.render(0.5);
  }
  return game;
}

const make = () => {
  const r = fakeRenderer();
  const kit = createScene3D({ renderer: r, level: 2, mobile: false, devicePixelRatio: () => 1, seed: 0 });
  return { kit, r };
};

describe('runner view', () => {
  it('obstacles are prototype clones on the stage, one per live obstacle; coins are one batch; frames are drawn', async () => {
    const { kit, r } = make();
    const game = await runOnce(kit, 5, 25);
    const run = game.run!;
    const keys = new Set(run.obstacles.map((o) => obstacleKey(o)));
    const st = kit.prototypes.stats();
    expect(st.live).toBe(run.obstacles.length);
    expect(st.created).toBeLessThanOrEqual(st.live + st.pooled);
    expect(st.created).toBeLessThan(12);
    expect(keys.size).toBeGreaterThan(0);
    expect(kit.pickups!.count).toBeLessThanOrEqual(run.coins.length);
    expect(r.renders).toBeGreaterThan(0);   // the frame cap runs on real time; this loop is much faster than real time
    expect(kit.stage.getObjectByName('runner')).toBeTruthy();
    game.dispose();
    expect(kit.stage.getObjectByName('runner')).toBeUndefined();
    expect(kit.prototypes.stats().live).toBe(0);
    kit.dispose();
  });

  it('a frame between two steps is drawn between them (obstacles and runner interpolated with alpha)', async () => {
    const { kit } = make();
    const game = await runOnce(kit, 9, 8);
    const ob = game.run!.obstacles.find((o) => o.z < 0);
    expect(ob).toBeTruthy();
    const objAt = (alpha: number): number => {
      game.render(alpha);
      const objs = kit.stage.children.filter((c) => c.visible && c.name !== 'runner' && Math.abs(c.position.z - ob!.z) < 1);
      return objs[0]!.position.z;
    };
    const z0 = objAt(0), z1 = objAt(1);
    expect(z1).toBeCloseTo(ob!.z, 6);
    expect(z1 - z0).toBeCloseTo(game.run!.moveZ, 6);
    game.dispose();
    kit.dispose();
  });

  it('five runs in a row (new game each, same kit) leave exactly the resources of one; the world comes from the start options', async () => {
    const { kit } = make();
    const counts: string[] = [];
    for (let i = 0; i < 5; i++) {
      const game = await runOnce(kit, 100 + i, 12, 'desert');
      expect(kit.theme?.id).toBe('desert');
      game.dispose();
      counts.push(JSON.stringify(kit.counts()));
    }
    expect(new Set(counts).size).toBe(1);
    const free = WORLDS.filter((w) => w['free'] === true).map((w) => w.id);
    const game = await runOnce(kit, 7, 1);
    expect(free).toContain(kit.theme?.id);
    game.dispose();
    kit.dispose();
  });
});
