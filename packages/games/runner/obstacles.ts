// Modelled obstacles of the runner: things that belong on the road of each world, with the same height and width as the
// built-in shapes (the simulation does not change; only the picture does).
// - Jump: a fallen log across the road in the wild, a row of water-filled barriers in the city, driftwood on the coast.
// - Duck and squat: a log gate (a beam on two upright trunks) in the wild; the striped height gate stays in the city.
// - Change lane: in the city a bus and a delivery van parked across two lanes, elsewhere a boulder fall; the arrow sign
//   stands in front of it on a post.
// They are kit prototypes like the built-in ones (defined once per kit, shared geometry), keyed by the world's family.
import * as THREE from 'three';
import type { Scene3DKit } from '../../core/render3d/scene3d.ts';
import { sizedModel, type ModelSet } from '../../core/render3d/models.ts';
import { arrowPixels, makeTexture } from '../../core/render3d/textures.ts';
import { LANE_W, type Obstacle } from './sim.ts';
import { ROAD_W } from './view.ts';

export type ObstacleFamily = 'wild' | 'city' | 'coast';

export function familyOf(themeId: string): ObstacleFamily {
  return themeId === 'city' || themeId === 'storm' ? 'city' : themeId === 'coast' || themeId === 'sunset' ? 'coast' : 'wild';
}

/** The modelled prototype key of an obstacle in a family, or null when that obstacle keeps its built-in shape there. */
export function modelledKey(o: Pick<Obstacle, 'type' | 'side'>, family: ObstacleFamily): string | null {
  if ((o.type === 'duck' || o.type === 'squat') && family !== 'wild') return null;
  const base = o.type === 'wall' ? (o.side < 0 ? 'wallR' : 'wallL') : o.type;
  return `runner.m.${family}.${base}`;
}

/** Defines the modelled obstacles of a family once per kit. False when a model is missing (the built-in ones stay). */
export function defineModelled(kit: Scene3DKit, models: ModelSet, family: ObstacleFamily): boolean {
  const probe = `runner.m.${family}.hurdle`;
  if (kit.prototypes.has(probe)) return true;
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.02 });
  const geo = (key: Parameters<typeof sizedModel>[1]['key'], size: { height?: number; width?: number }): THREE.BufferGeometry | null => sizedModel(models, { key, ...size }, null);
  const mesh = (g: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0, rz = 0, s: [number, number, number] = [1, 1, 1]): THREE.Mesh => {
    const m = new THREE.Mesh(g, mat);
    m.position.set(x, y, z); m.rotation.set(0, ry, rz); m.scale.set(...s);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  };
  const W = ROAD_W - 0.4;
  const log = geo('log', { width: 3.1 });
  const rock = geo('rock', { width: 2.4 });
  const barrier = geo('barrier', { width: 2.6 });
  const drift = geo('driftwood', { width: 2.7 });
  const bus = geo('bus', { width: 8.9 });
  const truck = geo('truck', { width: 4.0 });
  if (!log || !rock || !barrier || !drift || !bus || !truck) { mat.dispose(); return false; }

  const signTex = makeTexture(arrowPixels(-1, '#15130f', '#ffc93c'));
  const signTexR = makeTexture(arrowPixels(1, '#15130f', '#ffc93c'));
  const glowL = makeTexture(arrowPixels(-1, '#000000', '#ffc93c'));
  const glowR = makeTexture(arrowPixels(1, '#000000', '#ffc93c'));
  const sign = (dir: number): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ map: dir < 0 ? signTex : signTexR, emissive: '#ffc93c', emissiveMap: dir < 0 ? glowL : glowR, emissiveIntensity: 0.9, roughness: 0.55 });
  const signL = sign(-1), signR = sign(1);
  const pole = new THREE.MeshStandardMaterial({ color: '#2a2b30', roughness: 0.5, metalness: 0.6 });
  const poleGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.5, 8).translate(0, 0.75, 0);
  const plate = new THREE.PlaneGeometry(0.95, 0.95);

  // Jump: across the whole road, about 0.65 m high.
  kit.prototypes.define(`runner.m.${family}.hurdle`, () => {
    const g = new THREE.Group();
    if (family === 'wild') g.add(mesh(log, 0, 0, 0, 0, 0, [W / 3.1, 0.82, 0.9]));
    else if (family === 'city') for (const x of [-W / 4, W / 4]) g.add(mesh(barrier, x, 0, 0, 0, 0, [W / 2 / 2.6 * 1.02, 0.95, 1]));
    else { g.add(mesh(drift, -W / 4, 0, 0, Math.PI / 2, 0, [1, 0.8, W / 2 / 2.7 * 1.05])); g.add(mesh(drift, W / 4, 0, 0.1, -Math.PI / 2, 0, [1, 0.75, W / 2 / 2.7 * 1.05])); }
    return g;
  });

  if (family === 'wild') {
    // A log gate: a beam on two upright trunks. Duck: the beam's underside at about 1.85 m; squat: about 1.35 m.
    const gate = (beamY: number) => (): THREE.Group => {
      const g = new THREE.Group();
      // An upright trunk is the log turned a quarter about z: its length (centred) becomes its height, so it is lifted by half.
      const len = beamY + 0.75;
      for (const x of [-W / 2 - 0.2, W / 2 + 0.2]) g.add(mesh(log, x + 0.31, len / 2, 0, 0, Math.PI / 2, [len / 3.1, 0.7, 0.75]));   // turned, its thickness lies on -x: +0.31 centres it
      g.add(mesh(log, 0, beamY, 0, 0, 0, [(W + 0.9) / 3.1, 0.62, 0.7]));
      return g;
    };
    kit.prototypes.define(`runner.m.${family}.duck`, gate(1.86));
    kit.prototypes.define(`runner.m.${family}.squat`, gate(1.36));
  }

  // Change lane: the obstacle covers the centre lane and one side, 2.3 m high or more; the arrow points to the free side.
  for (const side of [-1, 1] as const) {
    kit.prototypes.define(`runner.m.${family}.${side < 0 ? 'wallR' : 'wallL'}`, () => {
      const g = new THREE.Group();
      const cx = side * LANE_W * 0.5;
      if (family === 'city') {
        // Each about 1.75 m wide: together exactly the two lanes; their fronts stand at the obstacle's line.
        g.add(mesh(bus, cx - LANE_W * 0.55, 0, -4.15));
        g.add(mesh(truck, cx + LANE_W * 0.55, 0, -1.7, 0, 0, [1, 1.15, 1]));
      } else {
        g.add(mesh(rock, cx - 0.9, 0, -0.4, 0.4, 0, [0.95, 2.0, 1.2]));
        g.add(mesh(rock, cx + 0.9, 0, -0.2, 2.1, 0, [0.9, 2.2, 1.1]));
        g.add(mesh(rock, cx + 0.05, 1.25, -0.6, 1.2, 0, [0.75, 1.6, 0.9]));
      }
      const p = new THREE.Mesh(poleGeo, pole); p.position.set(cx, 0, 0.9); g.add(p);
      const a = new THREE.Mesh(plate, side < 0 ? signR : signL); a.position.set(cx, 1.85, 0.95); g.add(a);
      return g;
    });
  }
  return true;
}
