// Road Run's ten worlds as the picker sees them, and the road from a chosen world to the scene: the entitlements say who
// may play which, StartOptions.world reaches the runner, and the runner builds exactly that world (a real scene kit on a
// fake renderer, in Node). The picker's own screens are packages/web/src/worlds.test.ts.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { AudioApi, Entitlement } from '../../core/types/index.ts';
import { canUse, DEFAULT_FREE_FEATURES } from '../../core/entitlements/features.ts';
import { createSession } from '../../core/loop/session.ts';
import { createScene3D, type RendererLike, type Scene3DKit } from '../../core/render3d/scene3d.ts';
import { pickWorld } from '../runner/game.ts';
import roadRun, { WORLDS } from './index.ts';
import { DEFAULT_WORLD_ID, ROAD_RUN_WORLDS } from './worlds.ts';

const FREE: Entitlement = { plan: 'free', source: 'none' };
const PRO: Entitlement = { plan: 'pro', source: 'gumroad' };

class FakeCanvas extends EventTarget { clientWidth = 1280; clientHeight = 720; }

function fakeRenderer(): RendererLike {
  const r = {
    domElement: new FakeCanvas(),
    shadowMap: { enabled: true, type: THREE.PCFShadowMap },
    info: { memory: { geometries: 0, textures: 0 }, render: { calls: 0, triangles: 0 } },
    capabilities: { getMaxAnisotropy: () => 16 },
    toneMappingExposure: 1,
    setPixelRatio() {},
    setSize() {},
    render() {},
    compile() {},
    dispose() {},
  };
  return r as unknown as RendererLike;
}

const makeKit = (): Scene3DKit => createScene3D({ renderer: fakeRenderer(), level: 2, mobile: false, devicePixelRatio: () => 1, seed: 0 });

/** A session of the real Road Run on the keyboard, a scene kit, and a clock the test moves. Resolves once the game has been started. */
async function startRound(kit: Scene3DKit, world: string | undefined): Promise<{ stop(): void }> {
  let t = 0;
  const raf = new Map<number, () => void>();
  let id = 0;
  const keys = new EventTarget();
  const session = createSession({
    games: () => roadRun,
    ui: () => ({ hud: { set() {}, announce() {}, toast() {} }, audio: {} as AudioApi, store: { get: <T>(_k: string, _s: unknown, f: T) => f, set() {}, remove() {} }, t: (k) => k, scene3d: kit }),
    raf: (cb) => { raf.set(++id, () => cb(t)); return id; },
    cancelRaf: (i) => { raf.delete(i); },
    now: () => t,
    doc: Object.assign(new EventTarget(), { hidden: false }),
    seed: () => 4,
    keyTarget: keys,
  });
  await session.start('road-run', { mode: 'solo', difficulty: 'easy', input: 'keyboard', seated: false, ...(world ? { world } : {}) });
  for (let i = 0; i < 400 && session.state !== 'running'; i++) {
    t += 1000 / 60;
    const due = [...raf.values()];
    raf.clear();
    for (const cb of due) cb();
  }
  expect(session.state).toBe('running');
  return { stop: () => session.quit() };
}

describe('the ten worlds of Road Run', () => {
  it('are the ten of the theme file the game plays in, three free and seven Pro, each with a name and a Turkish line', () => {
    expect(ROAD_RUN_WORLDS.map((w) => w.id)).toEqual(WORLDS.map((w) => w.id));
    expect(ROAD_RUN_WORLDS).toHaveLength(10);
    expect(ROAD_RUN_WORLDS.filter((w) => w.free).map((w) => w.id)).toEqual(['alps', 'desert', 'forest']);
    expect(new Set(ROAD_RUN_WORLDS.map((w) => w.id)).size).toBe(10);
    for (const w of ROAD_RUN_WORLDS) {
      const name = w.name as Record<string, string>;
      const tagline = w.tagline as Record<string, string>;
      expect(name['en'], w.id).toBe(WORLDS.find((x) => x.id === w.id)?.['name']);
      for (const lang of ['en', 'tr']) {
        expect(name[lang], `${w.id} name ${lang}`).toMatch(/\S/);
        expect(tagline[lang], `${w.id} tagline ${lang}`).toMatch(/\S/);
      }
      expect(name['tr'], w.id).toMatch(/^[A-ZÇĞİÖŞÜ]/);
    }
    expect(DEFAULT_WORLD_ID).toBe('alps');
  });

  it('follow the entitlements: the free worlds are the default free features, a Pro player may play all ten, a free player only those three', () => {
    const freeFeatures = [...DEFAULT_FREE_FEATURES].filter((f) => f.startsWith('world:')).sort();
    expect(ROAD_RUN_WORLDS.filter((w) => w.free).map((w) => `world:${w.id}`).sort()).toEqual(freeFeatures);
    for (const w of ROAD_RUN_WORLDS) {
      expect(canUse(`world:${w.id}`, PRO), `Pro ${w.id}`).toBe(true);
      expect(canUse(`world:${w.id}`, FREE), `free ${w.id}`).toBe(w.free);
    }
  });
});

describe('a chosen world reaches the runner', () => {
  it('pickWorld gives the world that was asked for, and a free one by the seed when none (or an unknown one) was', () => {
    for (const w of WORLDS) expect(pickWorld(WORLDS, 123, w.id)?.id).toBe(w.id);
    const free = new Set(WORLDS.filter((w) => w['free'] === true).map((w) => w.id));
    for (const seed of [0, 1, 2, 3, 99, 4_000_000_000]) {
      expect(free.has(pickWorld(WORLDS, seed)?.id ?? '')).toBe(true);
      expect(free.has(pickWorld(WORLDS, seed, 'no-such-world')?.id ?? '')).toBe(true);
    }
  });

  it('a session started with a world builds that world in the scene, for every one of the ten', async () => {
    for (const w of ROAD_RUN_WORLDS) {
      const kit = makeKit();
      const round = await startRound(kit, w.id);
      expect(kit.theme?.id, w.id).toBe(w.id);
      round.stop();
      kit.dispose();
    }
  });

  it('a session started without a world builds one of the free worlds', async () => {
    const kit = makeKit();
    const round = await startRound(kit, undefined);
    expect(['alps', 'desert', 'forest']).toContain(kit.theme?.id);
    round.stop();
    kit.dispose();
  });
});
