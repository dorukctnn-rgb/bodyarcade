// The sky, the ring of distant silhouettes and the clouds (split from site/game/engine.js:262-288, 436-447, 489-496).
//
// Three objects, all owned by the ResourceTracker that is passed in:
// - the sky: a big inside-out sphere with a three-colour gradient, a sun glow, optional stars and aurora, and a
//   flash for lightning (a uniform, not a light: dynamic lights cost every fragment, graphics-maps.md 3.4 item 5);
// - the horizon ring: mountains, dunes, forest, skyline, islands or hills drawn once into a 2048 x 256 texture;
// - the clouds: a few soft sprites far behind the horizon (a single Points draw call).
//
// The sky shader writes the gradient colours as they are, without the output colour conversion, exactly as the live
// game does: the ten worlds were tuned by eye against that look (their sky and fog colours meet at the horizon).
import * as THREE from 'three';
import type { Rng } from '../types/index.ts';
import type { ResourceTracker } from './dispose.ts';
import { horizonPixels, makeTexture, spritePixels } from './textures.ts';
import type { Theme } from './theme.ts';

export const SKY_RADIUS = 380;
export const HORIZON_RADIUS = 300;
export const HORIZON_HEIGHT = 70;
export const HORIZON_Y = 12;
export const CLOUD_COUNT = 26;

export const SKY_VERT = /* glsl */ `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;

export const SKY_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uTop, uMid, uBot, uSunColor, uSunDir; uniform float uStars, uAurora, uTime, uFlash;
varying vec3 vDir;
float hash(vec3 p){ p = fract(p*0.3183099+vec3(0.1,0.2,0.3)); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
void main(){
  vec3 d = normalize(vDir);
  float y = d.y;
  vec3 c = y < 0.12 ? mix(uBot, uMid, smoothstep(-0.05, 0.12, y)) : mix(uMid, uTop, smoothstep(0.12, 0.75, y));
  float s = max(dot(d, uSunDir), 0.0);
  c += uSunColor * (pow(s, 64.0) * 1.4 + pow(s, 6.0) * 0.22);
  if (uStars > 0.0) { float h = hash(floor(d * 180.0)); float st = step(0.996 - uStars*0.003, h) * smoothstep(0.08, 0.3, y); c += vec3(st) * (0.5 + 0.5*sin(uTime*2.0 + h*60.0)) * uStars; }
  if (uAurora > 0.0) { float band = exp(-pow((y - 0.42 + 0.07*sin(d.x*7.0 + uTime*0.25) + 0.05*sin(d.z*5.0 - uTime*0.2))/0.1, 2.0)); c += vec3(0.25, 0.9, 0.55) * band * 0.45 * uAurora * (0.6 + 0.4*sin(d.x*20.0 + uTime*0.6)); }
  c += vec3(0.55, 0.62, 0.8) * uFlash;
  gl_FragColor = vec4(c, 1.0);
}`;

/** Where the sun sits in the sky for a theme (unit vector). */
export function sunDirection(theme: Theme, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(theme.sun.pos[0], theme.sun.pos[1], theme.sun.pos[2]).normalize();
}

/** The warm end of the day: colours drift toward this over a run (graphics-maps.md 3.4 item 4). */
export const DUSK_COLOR = '#ff9a5a';
/** How far the day goes in a run: the sun sinks by this share of its height and its colour warms by DUSK_MIX. */
export const DAY_SINK = 0.2;
export const DUSK_MIX = 0.16;

const DUSK = new THREE.Color(DUSK_COLOR);
const clamp01 = (k: number): number => Math.min(1, Math.max(0, k));

/** The sun direction at a point of the day, k from 0 (as the theme says) to 1 (late): a little lower. Pure. */
export function dayDirection(theme: Theme, k: number, out: THREE.Vector3): THREE.Vector3 {
  const base = sunDirection(theme, out);
  const y = Math.max(-0.05, base.y * (1 - DAY_SINK * clamp01(k)));
  return out.set(base.x, y, base.z).normalize();
}

/**
 * A sun or glow colour at a point of the day: a little warmer. Pure; writes into `out`. Pass a THREE.Color for `base` in a
 * frame loop (a hex string is parsed again on every call).
 */
export function dayColor(base: string | THREE.Color, k: number, out: THREE.Color): THREE.Color {
  return (typeof base === 'string' ? out.set(base) : out.copy(base)).lerp(DUSK, DUSK_MIX * clamp01(k));
}

export interface SkyKit {
  /** Sky sphere, horizon ring and clouds. Add it to the scene. */
  readonly root: THREE.Group;
  readonly material: THREE.ShaderMaterial;
  /** Follows the camera (the sky never gets nearer), turns the horizon a little with the runner, advances sky time. */
  update(dtSeconds: number, cameraPosition: THREE.Vector3, focusX: number): void;
  /** Lightning: 0 (none) to 1 (full flash). */
  setFlash(v: number): void;
  /** The day: the sun direction and colour in the sky glow follow it. */
  setDay(k: number): void;
  readonly sunDir: THREE.Vector3;
  readonly sunColor: THREE.Color;
}

/** Builds the sky for a theme. `rng` makes the horizon and the cloud spread the same every time. */
export function buildSky(theme: Theme, rng: Rng, tracker: ResourceTracker): SkyKit {
  const glowBase = new THREE.Color(theme.sky.sunGlow);
  const root = new THREE.Group();
  root.name = 'sky';
  const sunDir = sunDirection(theme);
  const sunColor = new THREE.Color(theme.sky.sunGlow);
  const material = tracker.track(new THREE.ShaderMaterial({
    vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uTop: { value: new THREE.Color(theme.sky.top) }, uMid: { value: new THREE.Color(theme.sky.mid) }, uBot: { value: new THREE.Color(theme.sky.bot) },
      uSunColor: { value: sunColor }, uSunDir: { value: sunDir },
      uStars: { value: theme.sky.stars }, uAurora: { value: theme.sky.aurora ? 1 : 0 }, uTime: { value: 0 }, uFlash: { value: 0 },
    },
  }));
  const sky = new THREE.Mesh(tracker.track(new THREE.SphereGeometry(SKY_RADIUS, 32, 16)), material);
  sky.name = 'sky-dome';
  sky.renderOrder = -2;
  sky.frustumCulled = false;
  root.add(sky);

  // The horizon is drawn first so the seeded stream gives the same skyline whether or not there are clouds.
  const horizonTex = tracker.track(makeTexture(horizonPixels(theme.horizon, rng), { wrap: 'repeat-x', repeat: [2, 1] }));
  const ring = new THREE.Mesh(
    tracker.track(new THREE.CylinderGeometry(HORIZON_RADIUS, HORIZON_RADIUS, HORIZON_HEIGHT, 48, 1, true)),
    tracker.track(new THREE.MeshBasicMaterial({ map: horizonTex, transparent: true, side: THREE.BackSide, depthWrite: false, fog: false })),
  );
  ring.name = 'horizon';
  ring.position.y = HORIZON_Y;
  ring.renderOrder = -1;
  root.add(ring);

  let clouds: THREE.Points | null = null;
  if (theme.sky.clouds) {
    const pos = new Float32Array(CLOUD_COUNT * 3);
    for (let i = 0; i < CLOUD_COUNT; i++) {
      pos[i * 3] = (rng() - 0.5) * 520;
      pos[i * 3 + 1] = 42 + rng() * 40;
      pos[i * 3 + 2] = -120 - rng() * 200;
    }
    const geo = tracker.track(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = tracker.track(new THREE.PointsMaterial({
      color: theme.sky.clouds, size: 70, map: tracker.track(makeTexture(spritePixels('cloud'), { wrap: 'clamp' })),
      transparent: true, opacity: 0.85, depthWrite: false, sizeAttenuation: true, fog: false,
    }));
    clouds = new THREE.Points(geo, mat);
    clouds.name = 'clouds';
    clouds.frustumCulled = false;
    clouds.renderOrder = -1;
    root.add(clouds);
  }

  let time = 0;
  return {
    root, material, sunDir, sunColor,
    update(dt, cameraPosition, focusX) {
      time += dt;
      material.uniforms['uTime']!.value = time;
      sky.position.copy(cameraPosition);
      ring.rotation.y = focusX * 0.004;
      if (clouds) clouds.position.x = cameraPosition.x;
    },
    setFlash(v) { material.uniforms['uFlash']!.value = v; },
    setDay(k) { dayDirection(theme, k, sunDir); dayColor(glowBase, k, sunColor); },
  };
}
